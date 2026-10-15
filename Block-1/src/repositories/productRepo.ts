import { getDb } from '../db';

export interface Product {
  id: string;
  sku: string;
  name: string;
  price_cents: number;
  stock: number;
  is_active: boolean;
}

interface ProductRow extends Omit<Product, 'is_active'> {
  is_active: number;
}

// SQLite lưu boolean là 0/1 → đổi về true/false để response khớp spec.
const toProduct = (r: ProductRow): Product => ({ ...r, is_active: r.is_active === 1 });

export function listActiveProducts(limit: number, offset: number): Product[] {
  const rows = getDb()
    .prepare(
      `SELECT id, sku, name, price_cents, stock, is_active FROM products
       WHERE is_active = 1 ORDER BY sku LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as ProductRow[];
  return rows.map(toProduct);
}

export function findProduct(id: string): Product | undefined {
  const row = getDb()
    .prepare('SELECT id, sku, name, price_cents, stock, is_active FROM products WHERE id = ?')
    .get(id) as ProductRow | undefined;
  return row && toProduct(row);
}
