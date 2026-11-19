/** Order DB access: the Saga record (orders + sagas + saga_events + operations). Only Order opens order.db. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, nowIso } from "../shared/db.js";
import { ensureOpsTable } from "../shared/operations.js";
import type { Phase } from "./stateMachine.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const db = openDb("order", path.join(here, "schema.sql"));
ensureOpsTable(db); // local idempotent ops: `${saga_id}:confirm`, `${saga_id}:cancel`

export type Step = "reserve" | "charge" | "confirm" | "refund" | "release";
export interface Intent { step: Step; op_id: string; request: Record<string, unknown>; at: string }
export interface Saga {
  saga_id: string; order_id: string; phase: Phase; intent: Intent | null; pending: Step[];
  reservation_id: string | null; charge_id: string | null; refund_id: string | null; released_at: string | null;
  amount: number | null; last_error: string | null; op_ids: Record<string, string>;
  created_at: string; updated_at: string;
}
export interface Order {
  order_id: string; saga_id: string; account_id: string; item_id: string; quantity: number;
  amount: number | null; status: Phase; created_at: string; updated_at: string;
}

const ORDER_COLS = "order_id, saga_id, account_id, item_id, quantity, amount, status, created_at, updated_at";

export function getSaga(saga_id: string): Saga | undefined {
  const r = db.prepare(`SELECT * FROM sagas WHERE saga_id = ?`).get(saga_id) as any;
  if (!r) return undefined;
  return { ...r, intent: r.intent ? JSON.parse(r.intent) : null, pending: JSON.parse(r.pending), op_ids: JSON.parse(r.op_ids) };
}
export function mustSaga(saga_id: string): Saga {
  const s = getSaga(saga_id);
  if (!s) throw new Error(`saga ${saga_id} not found`);
  return s;
}
export const getOrder = (order_id: string) =>
  db.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE order_id = ?`).get(order_id) as Order | undefined;
export const getOrderByKey = (create_op_id: string) =>
  db.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE create_op_id = ?`).get(create_op_id) as Order | undefined;
export function listOrders(status?: string): Order[] {
  return status
    ? (db.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE status = ? ORDER BY created_at DESC, rowid DESC`).all(status) as Order[])
    : (db.prepare(`SELECT ${ORDER_COLS} FROM orders ORDER BY created_at DESC, rowid DESC`).all() as Order[]);
}
export const nonTerminalSagaIds = () =>
  (db.prepare(`SELECT saga_id FROM sagas WHERE phase NOT IN ('CONFIRMED','CANCELLED') ORDER BY created_at`).all() as any[])
    .map((r) => r.saga_id as string);

/** Persist the whole saga row and mirror phase/amount into orders (orders.status always == sagas.phase). */
export function saveSaga(s: Saga) {
  const at = nowIso();
  db.prepare(`UPDATE sagas SET phase=?, intent=?, pending=?, reservation_id=?, charge_id=?, refund_id=?, released_at=?,
              amount=?, last_error=?, updated_at=? WHERE saga_id=?`)
    .run(s.phase, s.intent ? JSON.stringify(s.intent) : null, JSON.stringify(s.pending), s.reservation_id, s.charge_id,
         s.refund_id, s.released_at, s.amount, s.last_error, at, s.saga_id);
  db.prepare(`UPDATE orders SET status=?, amount=?, updated_at=? WHERE order_id=?`).run(s.phase, s.amount, at, s.order_id);
}

export type EventKind = "INTENT" | "OUTCOME" | "STATE" | "RESUME" | "QUERY" | "ERROR" | "MARKER";

/**
 * Append a saga event (history for UI/evidence) + a console line `[saga S-..] KIND detail`.
 * `dedupe`: skip if the same kind/step/detail is among the last 3 events (keeps the periodic
 * resumer from flooding the log with identical "QUERY ... -> UNREACHABLE" lines).
 */
export function addEvent(saga_id: string, phase: Phase | null, kind: EventKind, step: string | null,
                         op_id: string | null, detail: string, dedupe = false) {
  if (dedupe) {
    const recent = db.prepare(`SELECT kind, step, detail FROM saga_events WHERE saga_id=? ORDER BY id DESC LIMIT 3`).all(saga_id) as any[];
    if (recent.some((e) => e.kind === kind && e.step === step && e.detail === detail)) return;
  }
  db.prepare(`INSERT INTO saga_events (saga_id, at, phase, kind, step, op_id, detail) VALUES (?,?,?,?,?,?,?)`)
    .run(saga_id, nowIso(), phase, kind, step, op_id, detail);
  console.log(`[saga ${saga_id}] ${kind} ${detail}`);
}

export const sagaEvents = (saga_id: string) =>
  db.prepare(`SELECT * FROM saga_events WHERE saga_id=? ORDER BY id`).all(saga_id);

export function resetDb() {
  db.transaction(() => {
    for (const t of ["saga_events", "sagas", "orders", "operations"]) db.prepare(`DELETE FROM ${t}`).run();
  })();
}
