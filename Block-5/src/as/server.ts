import { config } from '../config.js';
import { openDb } from '../db.js';
import { log } from '../util.js';
import { createAsApp } from './app.js';
import { initKeys } from './keys.js';

await initKeys();
const db = openDb('as');
const app = createAsApp(db);

app.listen(config.asPort, () => {
  log('as', 'listening', { url: config.asUrl });
});
