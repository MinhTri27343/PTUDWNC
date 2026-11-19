import { rmSync } from 'node:fs';
import path from 'node:path';
import { DATA, createStores } from '../src/db.js';
import { VERSIONS } from '../src/types.js';
// Offline CLI: stop the server first; no reset endpoint exposed by the application.
for (const version of VERSIONS) for (const suffix of ['', '-wal', '-shm'])
  rmSync(path.join(DATA, `${version}.db${suffix}`), { force: true });
const stores = createStores();
Object.values(stores).forEach(db => db.close());
console.log('Đã reset cả 5 database. Khởi động lại bằng npm start. Mật khẩu: <username>-pass.');
