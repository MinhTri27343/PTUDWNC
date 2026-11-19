import { config } from '../config.js';
import { openDb } from '../db.js';
import { log } from '../util.js';
import { createTaxiApp } from './app.js';
import { TaxiStore } from './store.js';

const app = createTaxiApp(new TaxiStore(openDb('taxi')));

app.listen(config.taxiPort, () => {
  log('taxi', 'listening', { url: config.taxiUrl });
});
