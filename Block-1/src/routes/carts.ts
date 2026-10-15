import { Router } from 'express';
import * as service from '../services/cartService';

export const cartsRouter = Router();

cartsRouter.post('/carts', (_req, res) => {
  const cart = service.createCart();
  res.status(201).location(`/carts/${cart.id}`).json(cart);
});

cartsRouter.get('/carts/:cartId', (req, res) => {
  res.json(service.getCart(req.params.cartId));
});

cartsRouter.post('/carts/:cartId/items', (req, res) => {
  const { product_id, quantity } = req.body as { product_id: string; quantity: number };
  res.status(201).json(service.addItem(req.params.cartId, product_id, quantity));
});

cartsRouter.patch('/carts/:cartId/items/:productId', (req, res) => {
  const { quantity } = req.body as { quantity: number };
  res.json(service.updateItem(req.params.cartId, req.params.productId, quantity));
});

cartsRouter.delete('/carts/:cartId/items/:productId', (req, res) => {
  service.removeItem(req.params.cartId, req.params.productId);
  res.status(204).end();
});
