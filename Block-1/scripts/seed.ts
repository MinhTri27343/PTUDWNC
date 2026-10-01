import { config } from '../src/config';
import { openDatabase } from '../src/db';
import { seed } from '../src/dbSetup';
import { SEED_CART_ITEMS, SEED_CARTS, SEED_PRODUCTS } from '../src/seedData';

// fileMustExist: phải chạy db:migrate trước.
const db = openDatabase(config.dbPath);
try {
  seed(db);
  console.log(
    `Đã seed ${SEED_PRODUCTS.length} products, ${SEED_CARTS.length} carts, ${SEED_CART_ITEMS.length} cart_items vào ${config.dbPath}`,
  );
} finally {
  db.close();
}
