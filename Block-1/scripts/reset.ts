import { config } from '../src/config';
import { resetDatabase } from '../src/dbSetup';

resetDatabase(config.dbPath);
console.log(`Đã reset DB (xoá file → migrate → seed): ${config.dbPath}`);
