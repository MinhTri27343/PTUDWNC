import { config } from '../src/config';
import { openDatabase } from '../src/db';
import { migrate } from '../src/dbSetup';

const db = openDatabase(config.dbPath, { create: true });
try {
  const ran = migrate(db);
  console.log(ran.length ? `Đã chạy migration: ${ran.join(', ')}` : 'Không có migration mới.');
  console.log(`DB: ${config.dbPath}`);
} finally {
  db.close();
}
