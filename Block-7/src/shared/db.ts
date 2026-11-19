import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DATA_DIR = path.join(ROOT, "data");

/**
 * Open the service's OWN database (database-per-service).
 * `name` = "order" | "inventory" | "payment" -> data/<name>.db
 * `schemaFile` = absolute path to the service's schema.sql (executed on every start, use IF NOT EXISTS).
 */
export function openDb(name: string, schemaFile: string): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, `${name}.db`));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(schemaFile, "utf8"));
  return db;
}

export const nowIso = () => new Date().toISOString();
