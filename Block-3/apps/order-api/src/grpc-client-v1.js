const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('node:path');

const packageDefinition = protoLoader.loadSync(path.join(__dirname, '..', '..', 'inventory-service', 'proto', 'v1', 'inventory.proto'), {
  keepCase: false, longs: String, enums: String, defaults: false, oneofs: true
});
const inventory = grpc.loadPackageDefinition(packageDefinition).inventory;

function reserveStockV1({ sku, quantity, correlationId, target }) {
  const client = new inventory.InventoryService(target, grpc.credentials.createInsecure());
  const metadata = new grpc.Metadata();
  metadata.set('x-correlation-id', correlationId);
  return new Promise((resolve, reject) => {
    client.reserveStock({ sku, quantity }, metadata, { deadline: new Date(Date.now() + 3000) }, (error, response) => {
      client.close();
      if (error) return reject(error);
      resolve({
        success: response.success === true,
        sku: response.sku,
        reserved_quantity: response.reservedQuantity,
        error: response.error,
        message: response.message,
        remaining_stock_read_by_client: false,
        remaining_stock: undefined
      });
    });
  });
}

module.exports = { reserveStockV1 };
