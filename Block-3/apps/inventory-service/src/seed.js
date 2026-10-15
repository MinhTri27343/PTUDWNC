const { dbPath, db, run, init } = require('./db');

async function main() {
  await init();
  await run('DELETE FROM inventory');
  await run('INSERT INTO inventory (sku, stock) VALUES (?, ?), (?, ?)', ['A001', 10, 'A002', 1]);
  console.log(JSON.stringify({ event: 'seed.complete', dbPath, fixture: { A001: 10, A002: 1 } }));
  db.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
