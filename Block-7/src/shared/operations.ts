import type Database from "better-sqlite3";
import { nowIso } from "./db.js";

/**
 * Durable, idempotent operations (reserve_op_id, charge_op_id, refund_op_id, ...).
 * Every mutating endpoint runs through runOp():
 *  - first call : do the work + store the op result IN THE SAME local transaction
 *  - replay     : same op_id + same request -> the stored result, no second effect
 *  - same op_id, different request -> 409 OP_CONFLICT
 * GET /<svc>/operations/:op_id answers from this table (the provider's durable truth),
 * so the orchestrator never has to guess from a broken HTTP connection.
 *
 * Response body convention: { op_id, op_status: "SUCCEEDED" | "FAILED", ...domain fields, error? }
 * FAILED = definitive rejection that can never commit later (OUT_OF_STOCK, INSUFFICIENT_FUNDS, ...).
 */
export type OpStatus = "PENDING" | "SUCCEEDED" | "FAILED";
export interface OpOutcome { op_status: "SUCCEEDED" | "FAILED"; http_status: number; body: Record<string, unknown> }

export function ensureOpsTable(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS operations (
    op_id TEXT PRIMARY KEY, type TEXT NOT NULL, op_status TEXT NOT NULL,
    request TEXT NOT NULL, http_status INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)`);
}

function stable(v: Record<string, unknown>) {
  return JSON.stringify(v, Object.keys(v).sort());
}

export function runOp(
  db: Database.Database,
  op: { op_id: string; type: string; request: Record<string, unknown> },
  work: () => OpOutcome,
): { http_status: number; body: Record<string, unknown>; replayed: boolean } {
  return db.transaction(() => {
    const row = db.prepare(`SELECT * FROM operations WHERE op_id = ?`).get(op.op_id) as any;
    if (row) {
      if (row.type !== op.type || row.request !== stable(op.request)) {
        return { http_status: 409, body: { op_id: op.op_id, error: "OP_CONFLICT" }, replayed: true };
      }
      return { http_status: row.http_status, body: { ...JSON.parse(row.body), replayed: true }, replayed: true };
    }
    const out = work();
    const body = { op_id: op.op_id, op_status: out.op_status, ...out.body };
    db.prepare(`INSERT INTO operations (op_id, type, op_status, request, http_status, body, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(op.op_id, op.type, out.op_status, stable(op.request), out.http_status, JSON.stringify(body), nowIso());
    return { http_status: out.http_status, body, replayed: false };
  })();
}

/** For GET /<svc>/operations/:op_id */
export function getOp(db: Database.Database, op_id: string) {
  const row = db.prepare(`SELECT * FROM operations WHERE op_id = ?`).get(op_id) as any;
  if (!row) return { http_status: 404, body: { op_id, op_status: "NOT_FOUND" } };
  return {
    http_status: 200,
    body: { op_id, type: row.type, op_status: row.op_status as OpStatus, result: JSON.parse(row.body), created_at: row.created_at },
  };
}
