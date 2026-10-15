import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import request from 'supertest';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { getDb, setDb } from '../src/db';
import { resetDatabase } from '../src/dbSetup';
import { createLogger } from '../src/logger';

export { CART_IDS, PRODUCT_IDS } from '../src/seedData';

export interface TestContext {
  app: ReturnType<typeof createApp>;
  /** Các dòng log (đã parse JSON) ghi bởi app trong test này. */
  logs: Record<string, any>[];
  token: string;
  auth: { Authorization: string };
  cleanup: () => void;
}

/** Mỗi test: file SQLite tạm đã migrate + seed, app có validateResponses bật (so response thật với spec). */
export async function setupTest(): Promise<TestContext> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cart-api-'));
  const dbPath = path.join(dir, 'test.db');
  resetDatabase(dbPath);
  const previousPath = config.dbPath;
  config.dbPath = dbPath;
  setDb(undefined);

  const logs: Record<string, any>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      logs.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  const app = createApp({ logger: createLogger(stream, 'info'), validateResponses: true });

  const res = await request(app).post('/login').send({ username: 'user', password: '1234' });
  const token = res.body.access_token as string;

  return {
    app,
    logs,
    token,
    auth: { Authorization: `Bearer ${token}` },
    cleanup: () => {
      try {
        getDb().close();
      } catch {
        // DB không mở được (kịch bản C1) — bỏ qua
      }
      setDb(undefined);
      config.dbPath = previousPath;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Đếm số dòng cart_items trong DB — dùng để chứng minh "DB không đổi" sau request lỗi. */
export function countCartItems(): number {
  return getDb().prepare('SELECT COUNT(*) FROM cart_items').pluck().get() as number;
}

export function snapshotDb(): string {
  const db = getDb();
  return JSON.stringify({
    items: db.prepare('SELECT * FROM cart_items ORDER BY cart_id, product_id').all(),
    carts: db.prepare('SELECT * FROM carts ORDER BY id').all(),
    products: db.prepare('SELECT * FROM products ORDER BY id').all(),
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Kiểm tra body đúng error contract và request_id trùng header X-Request-Id. */
export function expectErrorContract(res: request.Response, status: number, code: string): void {
  if (res.status !== status || res.body.code !== code) {
    throw new Error(`Expected ${status} ${code}, got ${res.status} ${JSON.stringify(res.body)}`);
  }
  const keys = Object.keys(res.body).sort();
  const allowed = ['code', 'details', 'message', 'request_id'];
  if (!keys.every((k) => allowed.includes(k))) throw new Error(`Error body có field lạ: ${keys}`);
  if (typeof res.body.message !== 'string') throw new Error('message phải là string');
  if (!UUID_RE.test(res.body.request_id)) throw new Error('request_id phải là uuid');
  if (res.headers['x-request-id'] !== res.body.request_id) throw new Error('X-Request-Id khác request_id');
  if (code === 'VALIDATION_ERROR' && !Array.isArray(res.body.details)) throw new Error('thiếu details');
  const text = JSON.stringify(res.body);
  if (/stack|SELECT |INSERT |sqlite|node_modules|\.ts:/i.test(text)) throw new Error(`Lộ thông tin nội bộ: ${text}`);
}
