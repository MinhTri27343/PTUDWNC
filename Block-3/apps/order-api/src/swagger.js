module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Order API',
    version: '1.0.0',
    description: 'Public REST API for creating orders.'
  },
  servers: [{ url: 'http://localhost:3000' }],
  tags: [{ name: 'Orders' }, { name: 'Health' }],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Check Order API health',
        responses: { '200': { description: 'Service is healthy' } }
      }
    },
    '/orders': {
      post: {
        tags: ['Orders'],
        summary: 'Create an order and reserve inventory',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { '$ref': '#/components/schemas/CreateOrderRequest' }, examples: { enoughStock: { value: { sku: 'A001', quantity: 2 } }, insufficientStock: { value: { sku: 'A002', quantity: 2 } } } } }
        },
        responses: {
          '201': { description: 'Order created', content: { 'application/json': { schema: { '$ref': '#/components/schemas/OrderCreated' } } } },
          '400': { description: 'Invalid request', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '409': { description: 'Insufficient stock', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '502': { description: 'Inventory service unavailable', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } }
        }
      }
    }
  },
  components: {
    schemas: {
      CreateOrderRequest: {
        type: 'object', required: ['sku', 'quantity'],
        properties: { sku: { type: 'string', example: 'A001' }, quantity: { type: 'integer', minimum: 1, example: 2 } }
      },
      OrderCreated: {
        type: 'object',
        properties: { success: { type: 'boolean', example: true }, order_id: { type: 'string', example: '1' }, sku: { type: 'string', example: 'A001' }, quantity: { type: 'integer', example: 2 }, message: { type: 'string', example: 'Order created' } }
      },
      ErrorResponse: {
        type: 'object',
        properties: { success: { type: 'boolean', example: false }, error: { type: 'string', example: 'INSUFFICIENT_STOCK' }, message: { type: 'string', example: 'Not enough stock' } }
      }
    }
  }
};
