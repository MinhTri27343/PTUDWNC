import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOST, PORTS } from "../shared/config.js";
import { openDb, nowIso } from "../shared/db.js";
import { ensureOpsTable, runOp, getOp, type OpOutcome } from "../shared/operations.js";
import { installFaults, takeFault, crashNow } from "../shared/faults.js";

// Payment = Saga PARTICIPANT. charge = forward step (compensable), refund = its compensation.
const dir = path.dirname(fileURLToPath(import.meta.url));
const db = openDb("payment", path.join(dir, "schema.sql"));
ensureOpsTable(db);

const hex = () => Math.random().toString(16).slice(2, 8).padStart(6, "0");

function seed() {
  if ((db.prepare(`SELECT COUNT(*) n FROM accounts`).get() as any).n > 0) return;
  const ins = db.prepare(`INSERT INTO accounts (account_id, name, balance, initial) VALUES (?, ?, ?, ?)`);
  for (const [id, name, bal] of [["alice", "Alice", 1_000_000], ["bob", "Bob", 200_000], ["carol", "Carol", 50_000]] as const)
    ins.run(id, name, bal, bal);
}
seed();

const app = express();
app.use(cors());
app.use(express.json());
installFaults(app, "payment");

app.get("/health", (_req, res) => res.json({ ok: true, service: "payment", pid: process.pid }));

const fail = (http_status: number, error: string): OpOutcome => ({ op_status: "FAILED", http_status, body: { error } });

// Saga forward step: charge. Business change + op record happen in ONE local transaction (runOp).
app.post("/payments/charges", (req, res) => {
  const { order_id, account_id, amount, charge_op_id } = req.body ?? {};
  if (!order_id || !account_id || !charge_op_id || !Number.isInteger(amount) || amount <= 0) {
    res.status(400).json({ error: "BAD_REQUEST" }); return;
  }
  const r = runOp(db, { op_id: charge_op_id, type: "charge", request: { order_id, account_id, amount } }, () => {
    if (takeFault("charge.reject")) return fail(402, "CHARGE_DECLINED");
    const acc = db.prepare(`SELECT * FROM accounts WHERE account_id = ?`).get(account_id) as any;
    if (!acc) return fail(404, "UNKNOWN_ACCOUNT");
    if (acc.balance < amount) return fail(402, "INSUFFICIENT_FUNDS");
    const charge_id = `C-${hex()}`;
    db.prepare(`UPDATE accounts SET balance = balance - ? WHERE account_id = ?`).run(amount, account_id);
    db.prepare(`INSERT INTO ledger (type, charge_id, order_id, account_id, amount, op_id, created_at)
                VALUES ('CHARGE', ?, ?, ?, ?, ?, ?)`).run(charge_id, order_id, account_id, amount, charge_op_id, nowIso());
    return { op_status: "SUCCEEDED", http_status: 201,
      body: { charge_id, order_id, account_id, amount, status: "CHARGED", balance_after: acc.balance - amount } };
  });
  console.log(`[payment] charge op=${charge_op_id} ${account_id} -${amount} -> ${r.body.charge_id ?? r.body.error}` +
    ` ${r.body.status ?? r.body.op_status}${r.replayed ? " (replay)" : ""}`);

  // F4: money taken + op recorded, but the response is lost (process dies before replying).
  if (!r.replayed && r.body.op_status === "SUCCEEDED" && takeFault("charge.crash_after_commit"))
    crashNow(`charge committed op=${charge_op_id} charge_id=${r.body.charge_id}`);

  res.status(r.http_status).json(r.body);
});

// Saga compensation: refund. Idempotent per refund_op_id AND per charge (never a 2nd REFUND row).
app.post("/payments/charges/:charge_id/refund", (req, res) => {
  const { charge_id } = req.params;
  const { refund_op_id } = req.body ?? {};
  if (!refund_op_id) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  // transient failure: nothing recorded, no effect (orchestrator must retry the same op)
  if (takeFault("refund.fail")) {
    console.log(`[payment] refund op=${refund_op_id} ${charge_id} -> 503 (fault)`);
    res.status(503).json({ error: "REFUND_TEMPORARILY_UNAVAILABLE" }); return;
  }
  const r = runOp(db, { op_id: refund_op_id, type: "refund", request: { charge_id } }, () => {
    const ch = db.prepare(`SELECT * FROM ledger WHERE type='CHARGE' AND charge_id = ?`).get(charge_id) as any;
    if (!ch) return fail(404, "UNKNOWN_CHARGE");
    const old = db.prepare(`SELECT * FROM ledger WHERE type='REFUND' AND charge_id = ?`).get(charge_id) as any;
    if (old) // already refunded by another op -> report the existing refund, no second effect
      return { op_status: "SUCCEEDED", http_status: 200,
        body: { refund_id: old.refund_id, charge_id, amount: old.amount, status: "REFUNDED" } };
    const refund_id = `RF-${hex()}`;
    db.prepare(`UPDATE accounts SET balance = balance + ? WHERE account_id = ?`).run(ch.amount, ch.account_id);
    db.prepare(`INSERT INTO ledger (type, charge_id, refund_id, order_id, account_id, amount, op_id, created_at)
                VALUES ('REFUND', ?, ?, ?, ?, ?, ?, ?)`)
      .run(charge_id, refund_id, ch.order_id, ch.account_id, ch.amount, refund_op_id, nowIso());
    return { op_status: "SUCCEEDED", http_status: 200,
      body: { refund_id, charge_id, amount: ch.amount, status: "REFUNDED" } };
  });
  console.log(`[payment] refund op=${refund_op_id} ${charge_id} -> ${r.body.refund_id ?? r.body.error} ${r.body.status ?? r.body.op_status}${r.replayed ? " (replay)" : ""}`);
  res.status(r.http_status).json(r.body);
});

// Provider's durable truth for the orchestrator's recovery queries.
app.get("/payments/operations/:op_id", (req, res) => {
  const r = getOp(db, req.params.op_id);
  res.status(r.http_status).json(r.body);
});

app.get("/payments/accounts", (_req, res) => {
  res.json(db.prepare(`SELECT account_id, name, balance, initial FROM accounts ORDER BY rowid`).all());
});

app.get("/payments/ledger", (_req, res) => {
  const entries = db.prepare(`SELECT entry_id, type, charge_id, refund_id, order_id, account_id, amount, op_id, created_at
                              FROM ledger ORDER BY entry_id DESC`).all() as any[];
  const sum = (t: string) => entries.filter((e) => e.type === t).reduce((s, e) => s + e.amount, 0);
  const total_charged = sum("CHARGE"), total_refunded = sum("REFUND");
  res.json({ entries, total_charged, total_refunded, net: total_charged - total_refunded });
});

app.post("/admin/reset", (_req, res) => {
  db.transaction(() => {
    db.exec(`DELETE FROM ledger; DELETE FROM accounts; DELETE FROM operations;`);
    seed();
  })();
  console.log("[payment] reset");
  res.json({ ok: true });
});

app.listen(PORTS.payment, HOST, () => console.log(`[payment] listening on ${HOST}:${PORTS.payment} pid=${process.pid}`));
