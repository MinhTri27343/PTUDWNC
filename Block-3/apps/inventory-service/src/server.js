const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const crypto = require('node:crypto');
const { init, reserveStock } = require('./db');
const swaggerDocument = require('./swagger');
const { startGrpcServer } = require('./grpc-server');

const app = express();
const port = Number(process.env.PORT || 3001);
const grpcPort = process.env.GRPC_PORT || '0.0.0.0:50051';
app.use(cors());
app.use(express.json());
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

function log(event, fields = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: 'inventory-service', event, ...fields }));
}

app.get('/health', (_req, res) => res.json({ service: 'inventory-service', status: 'ok' }));

app.post('/inventory/reserve', async (req, res) => {
  const correlationId = req.get('X-Correlation-Id') || crypto.randomUUID();
  const { sku, quantity } = req.body || {};
  log('inventory.request', { correlationId, method: 'POST', path: '/inventory/reserve', sku, quantity });

  if (typeof sku !== 'string' || !sku.trim() || !Number.isInteger(quantity) || quantity <= 0) {
    const body = { success: false, error: 'INVALID_REQUEST', message: 'sku and a positive integer quantity are required' };
    log('inventory.response', { correlationId, status: 400, body });
    return res.status(400).json(body);
  }

  try {
    const result = await reserveStock(sku.trim(), quantity);
    if (result.kind === 'NOT_FOUND') {
      const body = { success: false, error: 'SKU_NOT_FOUND', message: 'SKU not found' };
      log('inventory.response', { correlationId, status: 404, body });
      return res.status(404).json(body);
    }
    if (result.kind === 'INSUFFICIENT_STOCK') {
      const body = { success: false, error: 'INSUFFICIENT_STOCK', message: 'Not enough stock' };
      log('inventory.response', { correlationId, status: 409, stockBefore: result.stock, body });
      return res.status(409).json(body);
    }
    const body = { success: true, sku: result.sku, reserved_quantity: result.reservedQuantity, remaining_stock: result.remainingStock };
    log('inventory.response', { correlationId, status: 200, stockAfter: result.remainingStock, body });
    return res.status(200).json(body);
  } catch (error) {
    log('inventory.error', { correlationId, status: 500, message: error.message });
    return res.status(500).json({ success: false, error: 'INVENTORY_ERROR', message: 'Inventory service error' });
  }
});

init().then(() => {
  app.listen(port, () => log('http.started', { port }));
  startGrpcServer(grpcPort);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
