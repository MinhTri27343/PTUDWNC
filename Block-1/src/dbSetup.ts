import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { openDatabase, type Db } from './db';
import { SEED_CART_ITEMS, SEED_CARTS, SEED_PRODUCTS } from './seedData';

/** Chạy các file migrations/*.sql chưa áp dụng, theo thứ tự tên file. Trả về danh sách file vừa chạy. */
export function migrate(db: Db, migrationsDir = config.migrationsDir): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT`);

  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').pluck().all() as string[],
  );
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
        file,
        new Date().toISOString(),
      );
    })();
    ran.push(file);
  }
  return ran;
}

/** Xoá dữ liệu cũ và nạp lại seed — chạy lại bao nhiêu lần cũng cho cùng kết quả. */
export function seed(db: Db): void {
  db.transaction(() => {
    db.exec('DELETE FROM cart_items; DELETE FROM carts; DELETE FROM products;');

    const insertProduct = db.prepare(
      'INSERT INTO products (id, sku, name, price_cents, stock, is_active) VALUES (@id, @sku, @name, @price_cents, @stock, @is_active)',
    );
    const insertCart = db.prepare('INSERT INTO carts (id, status) VALUES (@id, @status)');
    const insertItem = db.prepare(
      'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (@cart_id, @product_id, @quantity)',
    );

    SEED_PRODUCTS.forEach((p) => insertProduct.run(p));
    SEED_CARTS.forEach((c) => insertCart.run(c));
    SEED_CART_ITEMS.forEach((i) => insertItem.run(i));
  })();
}

/** Xoá file DB (kèm -wal, -shm) → migrate → seed. */
export function resetDatabase(dbPath = config.dbPath): void {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
  const db = openDatabase(dbPath, { create: true });
  try {
    migrate(db);
    seed(db);
  } finally {
    db.close();
  }
}
