import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hashPassword } from './password.js';
import { VERSIONS, type Db, type Version } from './types.js';
export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DATA = path.join(ROOT, 'data');
export const DEMO_USERS = [
  ['alice', 'Alice', 'alpha', 0], ['bob', 'Bob', 'alpha', 0],
  ['charlie', 'Charlie', 'beta', 0], ['dana', 'Dana', 'alpha', 1],
  ['eve', 'Eve (Viewer)', 'alpha', 0],
] as const;
// Compute seed hashes once per process, rather than once for each fixture database.
const passwords = new Map(DEMO_USERS.map(([id]) => [id, hashPassword(`${id}-pass`)]));
export function openDb(file = ':memory:'): Db {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  db.exec(readFileSync(path.join(ROOT, 'migrations/001_init.sql'), 'utf8'));
  if (!(db.prepare('SELECT count(*) AS n FROM users').get() as {n: number}).n) seed(db);
  return db;
}
function seed(db: Db) {
  db.transaction(() => {
    db.prepare('INSERT INTO tenants VALUES (?, ?)').run('alpha', 'Tenant Alpha');
    db.prepare('INSERT INTO tenants VALUES (?, ?)').run('beta', 'Tenant Beta');
    for (const [id, name, tenant, admin] of DEMO_USERS)
      db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)').run(id, name, tenant, admin, passwords.get(id));
    db.prepare('INSERT INTO projects VALUES (?, ?, ?)').run('alpha', 'Project Alpha', 'alpha');
    db.prepare('INSERT INTO projects VALUES (?, ?, ?)').run('beta', 'Project Beta', 'beta');
    for (const [project, user, role] of [['alpha', 'alice', 'Owner'], ['alpha', 'bob', 'Member'], ['alpha', 'eve', 'Viewer'], ['beta', 'charlie', 'Owner']])
      db.prepare('INSERT INTO project_members VALUES (?, ?, ?)').run(project, user, role);
    const tasks = [
      ['A1', 'alpha', 'Thiết kế màn hình đăng nhập', 'Task Open được giao cho Bob.', 'bob', 'Open'],
      ['A2', 'alpha', 'Viết tài liệu API', 'Task chưa được giao cho ai.', null, 'Open'],
      ['A3', 'alpha', 'Kiểm tra bản phát hành cũ', 'Task Closed được giao cho Bob.', 'bob', 'Closed'],
      ['B1', 'beta', 'Ngân sách dự án Beta', 'Dữ liệu riêng của project Beta.', 'charlie', 'Open'],
      ['B2', 'beta', 'Kế hoạch phát hành Beta', 'Task chưa được giao cho ai.', null, 'Open'],
    ];
    for (const task of tasks) db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?)').run(...task);
  })();
}
export function createStores(memory = false): Record<Version, Db> {
  if (!memory) mkdirSync(DATA, { recursive: true });
  return Object.fromEntries(VERSIONS.map(v => [v, openDb(memory ? ':memory:' : path.join(DATA, `${v}.db`))])) as Record<Version, Db>;
}
