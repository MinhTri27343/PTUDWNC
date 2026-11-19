import express, { type ErrorRequestHandler } from 'express';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROOT, createStores } from './db.js';
import { authenticate, issueToken } from './auth.js';
import { verifyPassword } from './password.js';
import { TaskService } from './service.js';
import { fail, HttpError, VERSIONS, type Db, type User, type Version } from './types.js';
export function createApp(options: { stores?: Record<Version, Db>; secret?: Uint8Array } = {}) {
  const stores = options.stores ?? createStores(true);
  const secret = options.secret ?? randomBytes(32);
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '16kb' }));
  app.get('/health', (_req, res) => res.json({ ok: true, lab: true }));
  app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 200) fail(400, 'invalid_credentials_format');
    const user = stores.v4.prepare('SELECT * FROM users WHERE id = ?').get(username) as User | undefined;
    // Run password verification for missing users as well.
    const hash = user?.passwordHash ?? (stores.v4.prepare('SELECT passwordHash FROM users LIMIT 1').get() as {passwordHash: string}).passwordHash;
    if (!verifyPassword(password, hash) || !user) fail(401, 'invalid_credentials');
    res.json({ token: await issueToken(user.id, secret), tokenType: 'Bearer', expiresIn: 3600 });
  });
  app.get('/auth/me', authenticate(secret), (_req, res) => {
    const user = stores.v4.prepare('SELECT id, name, tenantId, admin FROM users WHERE id = ?').get(res.locals.uid);
    if (!user) fail(401, 'unauthenticated');
    res.json(user);
  });
  app.use('/api/:version', authenticate(secret), (req, res, next) => {
    const version = req.params.version as Version;
    if (!VERSIONS.includes(version)) return next(new HttpError(404, 'unknown_version'));
    res.locals.service = new TaskService({ db: stores[version], version });
    next();
  });
  const service = (res: express.Response): TaskService => res.locals.service;
  app.get('/api/:version/projects', (_req, res) => res.json(service(res).listProjects(res.locals.uid)));
  app.get('/api/:version/tasks', (_req, res) => res.json(service(res).listTasks(res.locals.uid)));
  app.get('/api/:version/tasks/:id', (req, res) => res.json(service(res).getTask(res.locals.uid, req.params.id)));
  app.patch('/api/:version/tasks/:id', (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) fail(400, 'invalid_body');
    res.json(service(res).editTask(res.locals.uid, req.params.id, req.body));
  });
  app.delete('/api/:version/projects/:id', (req, res) => res.json(service(res).deleteProject(res.locals.uid, req.params.id)));
  app.get('/api/:version/projects/:id/members', (req, res) => res.json(service(res).listMembers(res.locals.uid, req.params.id)));
  app.post('/api/:version/projects/:id/members', (req, res) => res.status(201).json(service(res).changeMember(res.locals.uid, req.params.id, 'POST', req.body?.userId, req.body?.role)));
  app.patch('/api/:version/projects/:id/members/:userId', (req, res) => res.json(service(res).changeMember(res.locals.uid, req.params.id, 'PATCH', req.params.userId, req.body?.role)));
  app.delete('/api/:version/projects/:id/members/:userId', (req, res) => res.json(service(res).changeMember(res.locals.uid, req.params.id, 'DELETE', req.params.userId)));
  app.use(express.static(path.join(ROOT, 'public')));
  app.use((_req, _res, next) => next(new HttpError(404, 'not_found')));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error instanceof HttpError ? error.status : error.status === 400 ? 400 : error.status === 413 ? 413 : 500;
    if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    if (status === 500) console.error('Unexpected API error:', error.message);
    res.status(status).json({ error: error instanceof HttpError ? error.code : status === 500 ? 'internal_error' : 'invalid_request',
      message: error instanceof HttpError ? error.message : status === 500 ? 'Lỗi máy chủ.' : 'Request không hợp lệ.' });
  };
  app.use(errors);
  return { app, stores, secret, close: () => Object.values(stores).forEach(db => db.close()) };
}
