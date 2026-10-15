const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('node:path');

const packageDefinition = protoLoader.loadSync(path.join(__dirname, '..', '..', 'inventory-service', 'proto', 'v2', 'inventory.proto'), {
  keepCase: false, longs: String, enums: String, defaults: false, oneofs: true
});
const inventory = grpc.loadPackageDefinition(packageDefinition).inventory;

function reserveStockV2({ sku, quantity, correlationId, target }) {
  const client = new inventory.InventoryService(target, grpc.credentials.createInsecure());
  const metadata = new grpc.Metadata();
  metadata.set('x-correlation-id', correlationId);
  return new Promise((resolve, reject) => {
    const deadlineMs = Math.max(1, Number(process.env.INVENTORY_DEADLINE_MS || 3000));
    client.reserveStock({ sku, quantity }, metadata, { deadline: new Date(Date.now() + deadlineMs) }, (error, response) => {
      client.close();
      if (error) {
        error.grpc_code = Object.keys(grpc.status).find((key) => grpc.status[key] === error.code) || 'UNKNOWN';
        return reject(error);
      }
      const hasRemainingStock = Object.prototype.hasOwnProperty.call(response, 'remainingStock');
      resolve({
        success: response.success === true,
        sku: response.sku,
        reserved_quantity: response.reservedQuantity,
        error: response.error,
        message: response.message,
        remaining_stock: response.remainingStock,
        remaining_stock_read_by_client: hasRemainingStock,
        remaining_stock_status: hasRemainingStock ? 'present' : 'unknown_or_zero'
      });
    });
  });
}

module.exports = { reserveStockV2 };
