import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { application, ports, positiveId } from './common.js';
const service = process.argv[2];
if (!['user', 'order', 'product'].includes(service)) throw new Error('Unknown service');
const db = new DatabaseSync(resolve(process.env.DATA_DIR || 'data', `${service}s.sqlite`), { readOnly: true });
const { app, events } = application(service);
function select(req, sql, args) {
  const event = { kind: 'db_query', service, run_id: req.run_id, sql, start_ms: Date.now() };
  events.push(event);
  try { return db.prepare(sql).all(...args); } finally { event.end_ms = Date.now(); }
}
app.use(async (req, res, next) => {
  if (service !== 'product') return next();
  const delay = Number(process.env.PRODUCT_DELAY_MS || 0);
  if (delay > 0) await new Promise(r => setTimeout(r, delay));
  if (process.env.PRODUCT_FAIL === '1') return res.status(503).json({ error: 'PRODUCT_UNAVAILABLE' });
  next();
});
if (service === 'user') app.get('/users/:id', (req, res) => {
  const rows = select(req, 'SELECT * FROM users WHERE id = ?', [positiveId(req.params.id)]);
  res.status(rows.length ? 200 : 404).json(rows[0] || { error: 'USER_NOT_FOUND' });
});
if (service === 'order') app.get('/orders', (req, res) => res.json(select(req, 'SELECT * FROM orders WHERE user_id = ? ORDER BY id', [positiveId(req.query.user_id)])));
if (service === 'product') {
  app.get('/products', (req, res) => {
    const values = String(req.query.ids || '').split(',');
    if (values.length > 200) return res.status(400).json({ error: 'Max 200 ids' });
    const ids = [...new Set(values.map(positiveId))];
    // Deliberately reverse DB response to exercise the loader's key mapping.
    res.json(select(req, `SELECT * FROM products WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id DESC`, ids));
  });
  app.get('/products/:id', (req, res) => {
    const rows = select(req, 'SELECT * FROM products WHERE id = ?', [positiveId(req.params.id)]);
    res.status(rows.length ? 200 : 404).json(rows[0] || { error: 'PRODUCT_NOT_FOUND' });
  });
}
app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
const server = app.listen(ports[service], '127.0.0.1', () => console.log(`${service} ready ${ports[service]}`));
process.on('SIGTERM', () => server.close(() => { db.close(); process.exit(); }));
