const { dbPath, db, run, init } = require('./db');

async function main() {
  await init();
  await run('DELETE FROM orders');
  console.log(JSON.stringify({ event: 'seed.complete', dbPath, orders: 0 }));
  db.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
