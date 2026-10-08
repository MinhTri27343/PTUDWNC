import express from 'express';
import { randomUUID } from 'node:crypto';
export const ports = { user: 4101, order: 4102, product: 4103, graphql: 4104, web: 4100 };
export const url = name => `http://127.0.0.1:${ports[name]}`;
export function application(service) {
  const app = express();
  const events = [];
  app.disable('etag');
  app.use(express.json());
  app.use((req, res, next) => {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Run-Id', 'Cache-Control': 'no-store' });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    req.run_id = req.get('X-Run-Id') || randomUUID();
    if (!['/health', '/metrics'].includes(req.path)) {
      const event = { kind: 'request', service, run_id: req.run_id, method: req.method, path: req.originalUrl, start_ms: Date.now() };
      events.push(event);
      res.on('close', () => Object.assign(event, { end_ms: Date.now(), status: res.statusCode, aborted: !res.writableFinished }));
    }
    next();
  });
  app.get('/health', (_, res) => res.json({ service, ready: true }));
  app.get('/metrics', (req, res) => res.json(events.filter(e => !req.query.run_id || e.run_id === req.query.run_id)));
  return { app, events };
}
export function positiveId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw Object.assign(new Error('Invalid positive integer id'), {status:400});
  return Number(value);
}
export async function upstream(service, path, run_id, events) {
  const event = { kind: 'call', service: 'graphql', target: service, run_id, path, start_ms: Date.now() };
  events.push(event);
  try {
    const response = await fetch(url(service) + path, { headers: { 'X-Run-Id': run_id }, signal: AbortSignal.timeout(1000) });
    event.status = response.status;
    if (!response.ok) { const error = new Error(`${service}: HTTP ${response.status}`); error.status = response.status; throw error; }
    return await response.json();
  } catch (error) { event.error = error.message; throw error; }
  finally { event.end_ms = Date.now(); }
}
