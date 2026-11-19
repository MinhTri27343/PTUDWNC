import express from 'express';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { config } from '../config.js';
import { ROOT } from '../db.js';
import { log } from '../util.js';

/**
 * Flow UI: an independent visualizer for the OAuth2 + PKCE flow. It is not the frontend of any of the three
 * services — the browser talks to Taxi, the Wallet AS and the Wallet API directly, and listens to the event
 * stream each of them exposes (/_flow/stream). This tiny server only hosts the static page and can run the
 * attack script so that its requests show up in the diagram.
 */
const app = express();
app.disable('x-powered-by');
app.use(express.json());
// no-cache: while presenting/editing, the browser must always revalidate the page and its script
app.use(
  express.static(path.join(ROOT, 'src/flow-ui/public'), {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }),
);

app.get('/config.json', (_req, res) => {
  res.json({ as: config.asUrl, api: config.apiUrl, taxi: config.taxiUrl });
});

let running = false;
app.post('/run/attack', (req, res) => {
  if (running) {
    res.status(409).json({ error: 'attack already running' });
    return;
  }
  running = true;
  const full = req.body?.full === true;
  const args = ['--import', 'tsx', path.join(ROOT, 'scripts/attack.ts'), ...(full ? [] : ['--skip-expiry'])];
  const child = spawn(process.execPath, args, { cwd: ROOT });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  child.on('close', (code) => {
    running = false;
    res.json({ exit_code: code, output: output.trim() });
  });
});

app.listen(config.flowPort, () => {
  log('flow-ui', 'listening', { url: config.flowUrl });
});
