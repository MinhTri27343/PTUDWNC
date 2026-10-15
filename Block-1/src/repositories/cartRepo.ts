import { randomUUID } from 'node:crypto';
import { getDb } from '../db';

export interface CartItem {
  product_id: string;
  name: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
}

export interface Cart {
  id: string;
  status: 'open' | 'checked_out';
  items: CartItem[];
  subtotal_cents: number;
}

export function createCart(): string {
  const id = randomUUID();
  getDb().prepare('INSERT INTO carts (id) VALUES (?)').run(id);
  return id;
}

export function findCartStatus(cartId: string): Cart['status'] | undefined {
  return getDb().prepare('SELECT status FROM carts WHERE id = ?').pluck().get(cartId) as Cart['status'] | undefined;
}

export function findItemQuantity(cartId: string, productId: string): number | undefined {
  return getDb()
    .prepare('SELECT quantity FROM cart_items WHERE cart_id = ? AND product_id = ?')
    .pluck()
    .get(cartId, productId) as number | undefined;
}

export function insertItem(cartId: string, productId: string, quantity: number): void {
  getDb()
    .prepare('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)')
    .run(cartId, productId, quantity);
}

export function updateItemQuantity(cartId: string, productId: string, quantity: number): void {
  getDb()
    .prepare('UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND product_id = ?')
    .run(quantity, cartId, productId);
}

export function deleteItem(cartId: string, productId: string): void {
  getDb().prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?').run(cartId, productId);
}

/** Giá và thành tiền luôn tính từ products.price_cents trong DB, không tin client. */
export function getCart(cartId: string): Cart | undefined {
  const status = findCartStatus(cartId);
  if (!status) return undefined;
  const items = getDb()
    .prepare(
      `SELECT p.id AS product_id, p.name, p.price_cents AS unit_price_cents, ci.quantity,
              p.price_cents * ci.quantity AS line_total_cents
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
       WHERE ci.cart_id = ? ORDER BY p.sku`,
    )
    .all(cartId) as CartItem[];
  const subtotal_cents = items.reduce((sum, i) => sum + i.line_total_cents, 0);
  return { id: cartId, status, items, subtotal_cents };
}
