import { config } from '../config.js';
import { openDb } from '../db.js';
import { log } from '../util.js';
import { createApiApp } from './app.js';

const app = createApiApp(openDb('api'));

app.listen(config.apiPort, () => {
  log('wallet-api', 'listening', { url: config.apiUrl });
});
