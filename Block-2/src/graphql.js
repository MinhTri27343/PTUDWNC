import { buildSchema, graphql, GraphQLError } from 'graphql';
import DataLoader from 'dataloader';
import { application, ports, upstream, positiveId } from './common.js';
const { app, events } = application('graphql');
const mode = process.env.GRAPHQL_MODE || 'batched';
if (!['naive', 'batched'].includes(mode)) throw new Error('Invalid GRAPHQL_MODE');
const schema = buildSchema(`
  type Query { user(id: ID!): User }
  type User { id: ID!, name: String!, orders: [Order!]! }
  type Order { id: ID!, user_id: ID!, product_id: ID!, status: String!, quantity: Int!, total_cents: Int!, created_at: String!, product: Product }
  type Product { id: ID!, name: String!, price_cents: Int!, thumbnail_url: String! }
`);
const productError = error => new GraphQLError(error.message, { extensions: { code: error.status === 404 ? 'PRODUCT_NOT_FOUND' : 'PRODUCT_UNAVAILABLE' } });
app.post('/graphql', async (req, res) => {
  if (typeof req.body?.query !== 'string') return res.status(400).json({ errors: [{ message: 'query must be a string' }] });
  const call = (name, path) => upstream(name, path, req.run_id, events);
  const loader = new DataLoader(async keys => {
    try {
      const rows = await call('product', `/products?ids=${keys.join(',')}`);
      const map = new Map(rows.map(row => [String(row.id), row]));
      return keys.map(key => map.get(String(key)) || productError(Object.assign(new Error(`Product ${key} missing`), { status: 404 })));
    } catch (error) { return keys.map(() => productError(error)); }
  });
  const rootValue = { user: async ({ id }) => {
    let user;
    try { user = await call('user', `/users/${positiveId(id)}`); }
    catch (error) { throw new GraphQLError(error.message, { extensions: { code: 'USER_UNAVAILABLE' } }); }
    return { ...user, orders: async () => {
      let orders;
      try { orders = await call('order', `/orders?user_id=${user.id}`); }
      catch (error) { throw new GraphQLError(error.message, { extensions: { code: 'ORDER_UNAVAILABLE' } }); }
      return orders.map(order => ({ ...order, product: async () => {
        if (mode === 'batched') return loader.load(order.product_id);
        try { return await call('product', `/products/${order.product_id}`); }
        catch (error) { throw productError(error); }
      } }));
    } };
  } };
  res.json(await graphql({ schema, source: req.body.query, variableValues: req.body.variables, operationName: req.body.operationName, rootValue }));
});
app.listen(ports.graphql, '127.0.0.1', () => console.log(`graphql ${mode} ready ${ports.graphql}`));
