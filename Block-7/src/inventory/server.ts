// Inventory service (:3002) - the "reserve" participant of the Checkout Saga.
//   reserve  = forward step   (POST /inventory/reservations)
//   release  = compensation   (POST /inventory/reservations/:id/release)
// Both are idempotent by op_id: runOp() commits the business change AND the op record
// in ONE local transaction, so a replay returns the stored result and never deducts twice.
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOST, PORTS } from "../shared/config.js";
import { openDb, nowIso } from "../shared/db.js";
import { ensureOpsTable, runOp, getOp } from "../shared/operations.js";
import { installFaults, takeFault, marker } from "../shared/faults.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = openDb("inventory", path.join(here, "schema.sql"));
ensureOpsTable(db);

const SEED = [
  { item_id: "A", name: "Tai nghe Bluetooth", price: 100000, initial: 10 },
  { item_id: "B", name: "Đồng hồ thông minh", price: 300000, initial: 5 },
  { item_id: "C", name: "Laptop", price: 800000, initial: 2 },
];
function seed() {
  const n = (db.prepare(`SELECT COUNT(*) n FROM items`).get() as any).n;
  if (n > 0) return;
  const ins = db.prepare(`INSERT INTO items (item_id,name,price,available,initial) VALUES (?,?,?,?,?)`);
  for (const s of SEED) ins.run(s.item_id, s.name, s.price, s.initial, s.initial);
}
seed();

const hex6 = () => crypto.randomBytes(3).toString("hex");

const app = express();
app.use(cors());
app.use(express.json());
installFaults(app, "inventory");

app.get("/health", (_req, res) => res.json({ ok: true, service: "inventory", pid: process.pid }));

// ---- Forward step: reserve stock -------------------------------------------------
app.post("/inventory/reservations", (req, res) => {
  const { order_id, item_id, quantity, reserve_op_id } = req.body ?? {};
  if (!order_id || !item_id || quantity === undefined || quantity === null || !reserve_op_id) {
    res.status(400).json({ error: "MISSING_FIELDS" });
    return;
  }
  const op_id = String(reserve_op_id);
  const r = runOp(db, { op_id, type: "reserve", request: { order_id, item_id, quantity } }, () => {
    // Definitive rejections are recorded as FAILED: they can never commit later.
    if (takeFault("reserve.reject")) {
      return { op_status: "FAILED", http_status: 409, body: { error: "RESERVE_REJECTED" } };
    }
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      return { op_status: "FAILED", http_status: 422, body: { error: "BAD_QUANTITY" } };
    }
    const item = db.prepare(`SELECT * FROM items WHERE item_id = ?`).get(item_id) as any;
    if (!item) return { op_status: "FAILED", http_status: 409, body: { error: "UNKNOWN_ITEM" } };
    if (item.available < qty) return { op_status: "FAILED", http_status: 409, body: { error: "OUT_OF_STOCK" } };

    const reservation_id = `R-${hex6()}`;
    const amount = item.price * qty;
    const after = item.available - qty;
    const now = nowIso();
    db.prepare(`UPDATE items SET available = ? WHERE item_id = ?`).run(after, item_id);
    db.prepare(`INSERT INTO reservations (reservation_id,order_id,item_id,quantity,amount,status,reserve_op_id,release_op_id,created_at,updated_at)
                VALUES (?,?,?,?,?,'ACTIVE',?,NULL,?,?)`).run(reservation_id, order_id, item_id, qty, amount, op_id, now, now);
    db.prepare(`INSERT INTO movements (order_id,reservation_id,op_id,type,item_id,quantity,available_after,created_at)
                VALUES (?,?,?,'RESERVE',?,?,?,?)`).run(order_id, reservation_id, op_id, item_id, qty, after, now);
    return {
      op_status: "SUCCEEDED", http_status: 201,
      body: { reservation_id, order_id, item_id, quantity: qty, unit_price: item.price, amount, status: "ACTIVE" },
    };
  });
  const b = r.body as any;
  console.log(`[inventory] reserve op=${op_id} order=${order_id} ${item_id} x${quantity} -> ` +
    `${b.reservation_id ?? "-"} ${b.status ?? b.op_status ?? ""}${b.error ? " " + b.error : ""}` +
    `${r.replayed ? " (replay)" : ""}`);
  res.status(r.http_status).json(r.body);
});

// ---- Compensation: release a reservation -----------------------------------------
app.post("/inventory/reservations/:reservation_id/release", (req, res) => {
  const { release_op_id } = req.body ?? {};
  if (!release_op_id) { res.status(400).json({ error: "MISSING_FIELDS" }); return; }
  // Transient failure: answered BEFORE runOp, so nothing is recorded and nothing changes.
  if (takeFault("release.fail")) {
    console.log(`[inventory] release op=${release_op_id} -> 503 (hook release.fail)`);
    res.status(503).json({ error: "TEMPORARY_FAILURE" });
    return;
  }
  const reservation_id = req.params.reservation_id;
  const op_id = String(release_op_id);
  const r = runOp(db, { op_id, type: "release", request: { reservation_id } }, () => {
    const resv = db.prepare(`SELECT * FROM reservations WHERE reservation_id = ?`).get(reservation_id) as any;
    if (!resv) return { op_status: "FAILED", http_status: 404, body: { error: "UNKNOWN_RESERVATION" } };
    // Already released (by another op) -> still SUCCEEDED, no second effect.
    if (resv.status === "RELEASED") {
      return { op_status: "SUCCEEDED", http_status: 200, body: { reservation_id, status: "RELEASED" } };
    }
    const item = db.prepare(`SELECT * FROM items WHERE item_id = ?`).get(resv.item_id) as any;
    const after = item.available + resv.quantity;
    const now = nowIso();
    db.prepare(`UPDATE items SET available = ? WHERE item_id = ?`).run(after, resv.item_id);
    db.prepare(`UPDATE reservations SET status='RELEASED', release_op_id=?, updated_at=? WHERE reservation_id=?`)
      .run(op_id, now, reservation_id);
    db.prepare(`INSERT INTO movements (order_id,reservation_id,op_id,type,item_id,quantity,available_after,created_at)
                VALUES (?,?,?,'RELEASE',?,?,?,?)`).run(resv.order_id, reservation_id, op_id, resv.item_id, resv.quantity, after, now);
    return { op_status: "SUCCEEDED", http_status: 200, body: { reservation_id, status: "RELEASED" } };
  });
  const b = r.body as any;
  console.log(`[inventory] release op=${op_id} ${reservation_id} -> ${b.status ?? b.error}` +
    `${r.replayed ? " (replay)" : ""}`);
  res.status(r.http_status).json(r.body);
});

// ---- Queries ---------------------------------------------------------------------
// Orchestrator uses this to learn the durable truth of an op after a timeout/crash.
app.get("/inventory/operations/:op_id", (req, res) => {
  const r = getOp(db, req.params.op_id);
  res.status(r.http_status).json(r.body);
});
app.get("/inventory/items", (_req, res) => {
  res.json(db.prepare(`
    SELECT i.item_id, i.name, i.price, i.available,
           COALESCE((SELECT SUM(quantity) FROM reservations r WHERE r.item_id = i.item_id AND r.status='ACTIVE'),0) AS reserved,
           i.initial
    FROM items i ORDER BY i.item_id`).all());
});
app.get("/inventory/reservations", (_req, res) => {
  res.json(db.prepare(`
    SELECT reservation_id, order_id, item_id, quantity, amount, status, reserve_op_id, release_op_id, created_at, updated_at
    FROM reservations ORDER BY rowid DESC`).all());
});
app.get("/inventory/movements", (_req, res) => {
  res.json(db.prepare(`
    SELECT movement_id, order_id, reservation_id, op_id, type, item_id, quantity, available_after, created_at
    FROM movements ORDER BY movement_id DESC`).all());
});

// Fixture reset between scenarios (NOT a restart simulation).
app.post("/admin/reset", (_req, res) => {
  db.transaction(() => {
    db.exec(`DELETE FROM movements; DELETE FROM reservations; DELETE FROM items; DELETE FROM operations;`);
    seed();
  })();
  marker("admin reset");
  res.json({ ok: true });
});

app.listen(PORTS.inventory, HOST, () =>
  console.log(`[inventory] listening on http://${HOST}:${PORTS.inventory} pid=${process.pid}`));
