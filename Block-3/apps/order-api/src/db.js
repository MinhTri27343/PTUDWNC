const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'orders.sqlite');
fs.mkdirSync(dataDir, { recursive: true });
const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function callback(error) {
    if (error) reject(error);
    else resolve({ lastID: this.lastID, changes: this.changes });
  }));
}

async function init() {
  await run('CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT NOT NULL, quantity INTEGER NOT NULL, status TEXT NOT NULL)');
}

module.exports = { db, dbPath, run, init };
