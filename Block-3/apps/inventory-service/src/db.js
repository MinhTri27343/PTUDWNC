const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'inventory.sqlite');
fs.mkdirSync(dataDir, { recursive: true });
const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row)));
  });
}

async function init() {
  await run('CREATE TABLE IF NOT EXISTS inventory (sku TEXT PRIMARY KEY, stock INTEGER NOT NULL CHECK (stock >= 0))');
}

async function reserveStock(sku, quantity) {
  await run('BEGIN IMMEDIATE TRANSACTION');
  try {
    const row = await get('SELECT sku, stock FROM inventory WHERE sku = ?', [sku]);
    if (!row) {
      await run('ROLLBACK');
      return { kind: 'NOT_FOUND' };
    }
    if (row.stock < quantity) {
      await run('ROLLBACK');
      return { kind: 'INSUFFICIENT_STOCK', stock: row.stock };
    }
    const remainingStock = row.stock - quantity;
    await run('UPDATE inventory SET stock = ? WHERE sku = ?', [remainingStock, sku]);
    await run('COMMIT');
    return { kind: 'RESERVED', sku, reservedQuantity: quantity, remainingStock };
  } catch (error) {
    try { await run('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

module.exports = { db, dbPath, run, init, reserveStock };
