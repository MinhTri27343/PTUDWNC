const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('node:path');
const { reserveStock } = require('./db');

const packageDefinition = protoLoader.loadSync(path.join(__dirname, '..', 'proto', 'v2', 'inventory.proto'), {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});
const inventory = grpc.loadPackageDefinition(packageDefinition).inventory;

function readCorrelationId(call) {
  const values = call.metadata.get('x-correlation-id');
  return values.length ? String(values[0]) : 'missing-correlation-id';
}

function log(event, fields = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: 'inventory-service', event, ...fields }));
}

async function reserveStockRpc(call, callback) {
  const request = call.request;
  const correlationId = readCorrelationId(call);
  const sku = request.sku;
  const quantity = request.quantity;
  const delayMs = Math.max(0, Number(process.env.INVENTORY_DELAY_MS || 0));
  log('grpc.reserve.request', { correlationId, proto_version: 'v2', method: 'ReserveStock', sku, quantity, delay_ms: delayMs });

  if (!sku.trim() || !Number.isInteger(quantity) || quantity <= 0) {
    const response = { success: false, error: 'INVALID_REQUEST', message: 'sku and a positive integer quantity are required' };
    log('grpc.reserve.response', { correlationId, proto_version: 'v2', success: false, error: 'INVALID_REQUEST' });
    return callback(null, response);
  }

  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  if (call.cancelled) {
    log('grpc.reserve.cancelled', { correlationId, proto_version: 'v2', delay_ms: delayMs });
    return;
  }

  reserveStock(sku.trim(), quantity).then((result) => {
    const response = {};
    if (result.kind === 'NOT_FOUND') {
      response.success = false;
      response.error = 'SKU_NOT_FOUND';
      response.message = 'SKU not found';
    } else if (result.kind === 'INSUFFICIENT_STOCK') {
      response.success = false;
      response.error = 'INSUFFICIENT_STOCK';
      response.message = 'Not enough stock';
    } else {
      response.success = true;
      response.sku = result.sku;
      response.reservedQuantity = result.reservedQuantity;
      response.remainingStock = result.remainingStock;
      response.message = 'Stock reserved';
    }
    log('grpc.reserve.response', {
      correlationId,
      proto_version: 'v2',
      success: response.success,
      error: response.error,
      remaining_stock: response.remainingStock
    });
    callback(null, response);
  }).catch((error) => {
    log('grpc.reserve.error', { correlationId, message: error.message });
    callback({ code: grpc.status.INTERNAL, message: 'Inventory service error' });
  });
}

function startGrpcServer(port) {
  const server = new grpc.Server();
  server.addService(inventory.InventoryService.service, { reserveStock: reserveStockRpc });
  server.bindAsync(port, grpc.ServerCredentials.createInsecure(), (error, boundPort) => {
    if (error) throw error;
    server.start();
    log('grpc.started', { port: boundPort });
  });
  return server;
}

module.exports = { startGrpcServer };
