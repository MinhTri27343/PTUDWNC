import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export function seed(dataset = 'small', directory = 'data') {
  if (!['small', 'large'].includes(dataset)) throw new Error('Dataset must be small or large');
  mkdirSync(directory, { recursive: true });
  const count = dataset === 'small' ? 5 : 100;
  const product_count = dataset === 'small' ? 3 : 10;
  for (const name of ['user', 'order', 'product']) {
    const db = new DatabaseSync(resolve(directory, `${name}s.sqlite`));
    if (name === 'user') {
      db.exec('CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL); DELETE FROM users;');
      db.prepare('INSERT INTO users VALUES (?, ?)').run(1, 'Nguyen An');
      db.prepare('INSERT INTO users VALUES (?, ?)').run(2, 'User without orders');
    }
    if (name === 'product') {
      db.exec('CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, name TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents >= 0), thumbnail_url TEXT NOT NULL); DELETE FROM products;');
      const insert = db.prepare('INSERT INTO products VALUES (?, ?, ?, ?)');
      for (let id = 1; id <= product_count; id++) insert.run(id, `Product ${id}`, id * 1250, '/thumbnail.svg');
    }
    if (name === 'order') {
      db.exec("CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, product_id INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','paid','shipped','cancelled')), quantity INTEGER NOT NULL CHECK(quantity > 0), total_cents INTEGER NOT NULL CHECK(total_cents >= 0), created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS orders_user_id ON orders(user_id); DELETE FROM orders;");
      const insert = db.prepare('INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (let id = 1; id <= count; id++) {
        const product_id = (id - 1) % product_count + 1, quantity = (id - 1) % 3 + 1;
        insert.run(id, 1, product_id, ['pending', 'paid', 'shipped', 'cancelled'][(id - 1) % 4], quantity, quantity * product_id * 1250, '2026-10-08T00:00:00.000Z');
      }
    }
    db.close();
  }
  console.log(`Seeded ${dataset}: ${count} orders / ${product_count} products in ${directory}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) seed(process.argv[2] || 'small', process.env.DATA_DIR || 'data');
