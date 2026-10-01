import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config';

export type Db = Database.Database;

/**
 * Mở kết nối SQLite với các PRAGMA bắt buộc.
 * - create = false (dùng cho app): file DB phải tồn tại sẵn, nếu không sẽ throw → request trả 500.
 * - create = true (dùng cho script migrate/seed/reset): tạo file nếu chưa có.
 */
export function openDatabase(dbPath: string, { create = false } = {}): Db {
  if (create) fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { fileMustExist: !create });
  // SQLite mặc định TẮT foreign key — phải bật cho mỗi kết nối.
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  return db;
}

let instance: Db | undefined;

/**
 * Kết nối dùng chung cho app, mở lazy ở lần query đầu tiên.
 * Server vẫn khởi động được khi DB hỏng/thiếu; lỗi chỉ xuất hiện khi request chạm DB (→ 500).
 */
export function getDb(): Db {
  if (!instance || !instance.open) {
    instance = openDatabase(config.dbPath);
  }
  return instance;
}

/** Dùng trong test để thay DB (file tạm) hoặc giả lập DB không dùng được. */
export function setDb(db: Db | undefined): void {
  instance = db;
}
