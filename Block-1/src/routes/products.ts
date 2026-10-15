import { Router } from 'express';
import { listActiveProducts } from '../repositories/productRepo';

export const productsRouter = Router();

productsRouter.get('/products', (req, res) => {
  // limit/offset đã được validator kiểm tra (1..50, >= 0); ở đây chỉ chuyển chuỗi query thành số.
  const limit = Number(req.query.limit ?? 20);
  const offset = Number(req.query.offset ?? 0);
  res.json(listActiveProducts(limit, offset));
});
