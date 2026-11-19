/** Order service :3001 — orders API + Saga orchestrator (CONTRACT §5). */
import express from "express";
import cors from "cors";
import { randomBytes, randomUUID } from "node:crypto";
import { HOST, PORTS } from "../shared/config.js";
import { nowIso } from "../shared/db.js";
import { installFaults } from "../shared/faults.js";
import { getOp } from "../shared/operations.js";
import { sleep } from "../shared/http.js";
import { db, getOrder, getOrderByKey, getSaga, listOrders, sagaEvents, addEvent, resetDb, type Order } from "./store.js";
import { drive, resumeAll, startResumer } from "./resume.js";

const app = express();
app.use(cors());
app.use(express.json());
installFaults(app, "order");

const hex6 = () => randomBytes(3).toString("hex");

/** Create order + saga (PENDING) in ONE txn. All op ids are minted here, once, and stored. */
function createOrder(create_op_id: string, account_id: string, item_id: string, quantity: number): { order: Order; created: boolean } {
  return db.transaction(() => {
    const existing = getOrderByKey(create_op_id);
    if (existing) return { order: existing, created: false };
    const order_id = `O-${hex6()}`, saga_id = `S-${hex6()}`, at = nowIso();
    const op_ids = { create: create_op_id, ...Object.fromEntries(
      ["reserve", "charge", "confirm", "refund", "release", "cancel"].map((st) => [st, `${saga_id}:${st}`])) };
    db.prepare(`INSERT INTO orders (order_id, saga_id, create_op_id, account_id, item_id, quantity, amount, status, created_at, updated_at)
                VALUES (?,?,?,?,?,?,NULL,'PENDING',?,?)`).run(order_id, saga_id, create_op_id, account_id, item_id, quantity, at, at);
    db.prepare(`INSERT INTO sagas (saga_id, order_id, phase, intent, pending, op_ids, created_at, updated_at)
                VALUES (?,?,'PENDING',NULL,'[]',?,?,?)`).run(saga_id, order_id, JSON.stringify(op_ids), at, at);
    addEvent(saga_id, "PENDING", "STATE", null, create_op_id, `created order ${order_id} -> PENDING (key=${create_op_id})`);
    return { order: getOrder(order_id)!, created: true };
  })();
}

function sagaView(saga_id: string) {
  const s = getSaga(saga_id);
  return s && { ...s, events: sagaEvents(saga_id) };
}

app.get("/health", (_req, res) => { res.json({ ok: true, service: "order", pid: process.pid }); });

app.post("/orders", async (req, res) => {
  const key = req.header("Idempotency-Key") || `auto-${randomUUID()}`;
  const dup = getOrderByKey(key);
  if (dup) { res.status(200).json(dup); return; } // same key -> same order, no second saga
  const { account_id, item_id, quantity } = req.body ?? {};
  if (typeof account_id !== "string" || !account_id || typeof item_id !== "string" || !item_id || !Number.isInteger(quantity)) {
    res.status(400).json({ error: "MISSING_FIELDS", need: ["account_id", "item_id", "quantity:int"] }); return;
  }
  const { order, created } = createOrder(key, account_id, item_id, quantity);
  const run = drive(order.saga_id); // saga runs in the background
  if (req.query.wait === "1") {
    await Promise.race([run, sleep(10_000)]); // until terminal or blocked (RECOVERING/COMPENSATING)
    res.status(created ? 201 : 200).json(getOrder(order.order_id)); return;
  }
  res.status(created ? 201 : 200).json(order);
});

app.get("/orders", (req, res) => {
  res.json(listOrders(typeof req.query.status === "string" && req.query.status ? req.query.status : undefined));
});

// Must be registered before /orders/:order_id.
app.get("/orders/operations/:op_id", (req, res) => {
  const r = getOp(db, req.params.op_id);
  res.status(r.http_status).json(r.body);
});

app.get("/orders/:order_id", (req, res) => {
  const o = getOrder(req.params.order_id);
  if (!o) { res.status(404).json({ error: "UNKNOWN_ORDER" }); return; }
  res.json(o);
});

app.get("/orders/:order_id/saga", (req, res) => {
  const o = getOrder(req.params.order_id);
  if (!o) { res.status(404).json({ error: "UNKNOWN_ORDER" }); return; }
  res.json(sagaView(o.saga_id));
});

app.post("/sagas/:saga_id/resume", async (req, res) => {
  if (!getSaga(req.params.saga_id)) { res.status(404).json({ error: "UNKNOWN_SAGA" }); return; }
  await drive(req.params.saga_id, "manual");
  res.json(sagaView(req.params.saga_id));
});

app.post("/admin/resume", async (_req, res) => { res.json(await resumeAll("admin")); });

app.post("/admin/reset", (_req, res) => { resetDb(); res.json({ ok: true, service: "order" }); });

app.listen(PORTS.order, HOST, () => {
  console.log(`[order] listening on http://${HOST}:${PORTS.order} pid=${process.pid}`);
  startResumer(); // startup = crash recovery, then the periodic resumer
});
