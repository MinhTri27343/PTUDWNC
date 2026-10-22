import { config } from '../src/config';
import { resetDatabase } from '../src/db/setup';

resetDatabase(config.dbPath);
console.log(`Đã reset DB (xoá file → migrate → seed): ${config.dbPath}`);
