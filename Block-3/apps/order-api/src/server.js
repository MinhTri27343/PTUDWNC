const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const grpc = require('@grpc/grpc-js');
const crypto = require('node:crypto');
const { init, run } = require('./db');
const swaggerDocument = require('./swagger');
const { reserveStockGrpc } = require('./grpc-client');

const app = express();
const port = Number(process.env.PORT || 3000);
const inventoryUrl = process.env.INVENTORY_URL || 'http://localhost:3001';
const inventoryTransport = process.env.INVENTORY_TRANSPORT || 'grpc';
const inventoryGrpcUrl = process.env.INVENTORY_GRPC_URL || 'localhost:50051';
const inventoryDeadlineMs = Math.max(1, Number(process.env.INVENTORY_DEADLINE_MS || 3000));
app.use(cors());
app.use(express.json());
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

function log(event, fields = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: 'order-api', event, ...fields }));
}

app.get('/health', (_req, res) => res.json({ service: 'order-api', status: 'ok' }));

app.post('/orders', async (req, res) => {
  const correlationId = crypto.randomUUID();
  const { sku, quantity } = req.body || {};
  log('order.request', { correlationId, method: 'POST', path: '/orders', sku, quantity });

  if (typeof sku !== 'string' || !sku.trim() || !Number.isInteger(quantity) || quantity <= 0) {
    const body = { success: false, error: 'INVALID_REQUEST', message: 'sku and a positive integer quantity are required' };
    log('order.response', { correlationId, status: 400, body });
    return res.status(400).json(body);
  }

  const inventoryStartedAt = Date.now();
  try {
    let inventoryBody;
    let inventoryStatus = 200;
    if (inventoryTransport === 'grpc') {
      log('inventory.grpc.request', { correlationId, method: 'ReserveStock', sku: sku.trim(), quantity, deadline_ms: inventoryDeadlineMs });
      inventoryBody = await reserveStockGrpc({ sku: sku.trim(), quantity, correlationId, target: inventoryGrpcUrl });
      log('inventory.grpc.response', { correlationId, proto_version: 'v2', success: inventoryBody.success, error: inventoryBody.error, remaining_stock: inventoryBody.remaining_stock });
      if (!inventoryBody.success) inventoryStatus = inventoryBody.error === 'INSUFFICIENT_STOCK' ? 409 : inventoryBody.error === 'SKU_NOT_FOUND' ? 404 : 400;
    } else {
      log('inventory.request', { correlationId, method: 'POST', path: '/inventory/reserve', sku: sku.trim(), quantity });
      const inventoryResponse = await fetch(inventoryUrl + '/inventory/reserve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Correlation-Id': correlationId },
        body: JSON.stringify({ sku: sku.trim(), quantity })
      });
      inventoryStatus = inventoryResponse.status;
      inventoryBody = await inventoryResponse.json();
      log('inventory.response', { correlationId, status: inventoryResponse.status, body: inventoryBody });
    }

    if (!inventoryBody.success) {
      const status = inventoryStatus === 409 ? 409 : inventoryStatus === 404 ? 404 : inventoryStatus === 400 ? 400 : 502;
      const body = inventoryStatus === 409
        ? { success: false, error: 'INSUFFICIENT_STOCK', message: 'Not enough stock' }
        : { success: false, error: inventoryBody.error || 'INVENTORY_UNAVAILABLE', message: inventoryBody.message || 'Inventory request failed' };
      log('order.response', { correlationId, status, body });
      return res.status(status).json(body);
    }

    const orderId = await run('INSERT INTO orders (sku, quantity, status) VALUES (?, ?, ?)', [sku.trim(), quantity, 'CREATED']);
    const body = { success: true, order_id: String(orderId.lastID), sku: sku.trim(), quantity, message: 'Order created' };
    log('order.response', { correlationId, status: 201, body });
    return res.status(201).json(body);
  } catch (error) {
    if (inventoryTransport === 'grpc') {
      const elapsedMs = Date.now() - inventoryStartedAt;
      const isTimeout = error.code === grpc.status.DEADLINE_EXCEEDED;
      const httpStatus = isTimeout ? 504 : 502;
      const body = isTimeout
        ? { success: false, error: 'INVENTORY_TIMEOUT', message: 'Inventory service timed out' }
        : { success: false, error: 'INVENTORY_UNAVAILABLE', message: 'Inventory service unavailable' };
      log('inventory.grpc.error', {
        correlationId,
        grpc_code: error.grpc_code || error.code || 'UNKNOWN',
        http_status: httpStatus,
        error: body.error,
        elapsed_ms: elapsedMs
      });
      log('order.response', { correlationId, status: httpStatus, body });
      return res.status(httpStatus).json(body);
    }
    log('order.error', { correlationId, status: 502, message: error.message });
    const body = { success: false, error: 'INVENTORY_UNAVAILABLE', message: 'Inventory service unavailable' };
    log('order.response', { correlationId, status: 502, body });
    return res.status(502).json(body);
  }
});

init().then(() => app.listen(port, () => log('service.started', { port, inventoryUrl, inventoryTransport, inventoryGrpcUrl }))).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
