// Evidence cho dòng "Tắt DB rồi gọi API → 500 đúng error contract, không có stack trace".
// Khởi động server THẬT với DB_PATH trỏ tới file không tồn tại, gọi API qua HTTP, in kết quả.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { createLogger } from '../src/logger';
import { CART_IDS } from '../src/seedData';

config.dbPath = path.join(os.tmpdir(), 'cart-api-does-not-exist', 'missing.db');
const server = createApp({ logger: createLogger(), validateResponses: true }).listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://localhost:${(server.address() as { port: number }).port}`;

try {
  const login = await (
    await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'user', password: '1234' }),
    })
  ).json();

  const res = await fetch(`${base}/carts/${CART_IDS.OPEN}`, {
    headers: { Authorization: `Bearer ${login.access_token}` },
  });
  const text = await res.text();
  console.log(`\nGET /carts/${CART_IDS.OPEN} (DB không dùng được)`);
  console.log(`  status      : ${res.status}`);
  console.log(`  X-Request-Id: ${res.headers.get('x-request-id')}`);
  console.log(`  body        : ${text}`);

  const body = JSON.parse(text);
  const leaked = /stack|sqlite|SELECT |\.ts:|node_modules|missing\.db/i.test(text);
  const ok =
    res.status === 500 &&
    body.code === 'INTERNAL_ERROR' &&
    body.request_id === res.headers.get('x-request-id') &&
    !leaked;
  console.log(ok ? '\nPASS: 500 đúng error contract, không lộ stack/SQL/đường dẫn' : '\nFAIL');
  process.exitCode = ok ? 0 : 1;
} finally {
  server.close();
  fs.rmSync(path.dirname(config.dbPath), { recursive: true, force: true });
}
