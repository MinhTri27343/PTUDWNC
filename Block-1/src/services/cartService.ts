import { getDb } from '../db';
import { errors } from '../errors';
import * as carts from '../repositories/cartRepo';
import { findProduct } from '../repositories/productRepo';

// Chỉ chứa rule cần đọc DB. Kiểu/định dạng/giới hạn đã được validator chặn từ spec, không kiểm tra lại ở đây.
// Mỗi hàm ghi chạy trong 1 transaction: ném lỗi → rollback.

function requireOpenCart(cartId: string): void {
  const status = carts.findCartStatus(cartId);
  if (!status) throw errors.cartNotFound();
  if (status !== 'open') throw errors.cartClosed();
}

function requireCart(cartId: string): carts.Cart {
  const cart = carts.getCart(cartId);
  if (!cart) throw errors.cartNotFound();
  return cart;
}

export function createCart(): carts.Cart {
  return getDb().transaction(() => requireCart(carts.createCart()))();
}

export function getCart(cartId: string): carts.Cart {
  return requireCart(cartId);
}

export function addItem(cartId: string, productId: string, quantity: number): carts.Cart {
  return getDb().transaction(() => {
    requireOpenCart(cartId);
    const product = findProduct(productId);
    if (!product || !product.is_active) throw errors.productUnavailable();
    if (carts.findItemQuantity(cartId, productId) !== undefined) throw errors.itemAlreadyInCart();
    if (quantity > product.stock) throw errors.insufficientStock();
    carts.insertItem(cartId, productId, quantity);
    return requireCart(cartId);
  })();
}

export function updateItem(cartId: string, productId: string, quantity: number): carts.Cart {
  return getDb().transaction(() => {
    requireOpenCart(cartId);
    if (carts.findItemQuantity(cartId, productId) === undefined) throw errors.itemNotFound();
    const product = findProduct(productId);
    if (!product || !product.is_active) throw errors.productUnavailable();
    if (quantity > product.stock) throw errors.insufficientStock();
    carts.updateItemQuantity(cartId, productId, quantity);
    return requireCart(cartId);
  })();
}

export function removeItem(cartId: string, productId: string): void {
  getDb().transaction(() => {
    requireOpenCart(cartId);
    if (carts.findItemQuantity(cartId, productId) === undefined) throw errors.itemNotFound();
    carts.deleteItem(cartId, productId);
  })();
}
