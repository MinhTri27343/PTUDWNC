module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Inventory Service API',
    version: '1.0.0',
    description: 'Internal REST API for reserving inventory.'
  },
  servers: [{ url: 'http://localhost:3001' }],
  tags: [{ name: 'Inventory' }, { name: 'Health' }],
  paths: {
    '/health': {
      get: { tags: ['Health'], summary: 'Check Inventory Service health', responses: { '200': { description: 'Service is healthy' } } }
    },
    '/inventory/reserve': {
      post: {
        tags: ['Inventory'],
        summary: 'Reserve stock for an SKU',
        parameters: [{ name: 'X-Correlation-Id', in: 'header', required: false, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/ReserveRequest' }, examples: { enoughStock: { value: { sku: 'A001', quantity: 2 } }, insufficientStock: { value: { sku: 'A002', quantity: 2 } } } } } },
        responses: {
          '200': { description: 'Stock reserved', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ReserveSuccess' } } } },
          '400': { description: 'Invalid request', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '404': { description: 'SKU not found', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '409': { description: 'Insufficient stock', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } }
        }
      }
    }
  },
  components: {
    schemas: {
      ReserveRequest: { type: 'object', required: ['sku', 'quantity'], properties: { sku: { type: 'string', example: 'A001' }, quantity: { type: 'integer', minimum: 1, example: 2 } } },
      ReserveSuccess: { type: 'object', properties: { success: { type: 'boolean', example: true }, sku: { type: 'string', example: 'A001' }, reserved_quantity: { type: 'integer', example: 2 }, remaining_stock: { type: 'integer', example: 8 } } },
      ErrorResponse: { type: 'object', properties: { success: { type: 'boolean', example: false }, error: { type: 'string', example: 'INSUFFICIENT_STOCK' }, message: { type: 'string', example: 'Not enough stock' } } }
    }
  }
};
