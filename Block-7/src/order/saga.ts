/**
 * Saga steps. Every remote step follows the same 5 beats (CONTRACT §5):
 *   1. durable INTENT   — write {step, op_id, request} in a local txn BEFORE calling. After a crash we know
 *                         "I may have asked Payment to charge op S-..:charge" and can find out what happened.
 *   2. crash.after_intent.<step>
 *   3. callOp with the FIXED op_id from saga.op_ids — retries/replays reuse it, so the provider's
 *      idempotency (runOp) guarantees at most one effect. We NEVER mint a new op id to "get past" a timeout.
 *   4. crash.after_call.<step>
 *   5. OUTCOME + state transition in ONE local txn.
 * Outcomes: SUCCEEDED -> next step; FAILED (definitive) -> compensate; UNKNOWN (timeout/5xx/conn reset)
 * is NOT failed: the charge may have committed. Forward step -> RECOVERING keeping the intent;
 * compensation step -> stay COMPENSATING keeping pending + intent. The resumer finds out later.
 */
import { URLS } from "../shared/config.js";
import { callOp } from "../shared/http.js";
import { runOp } from "../shared/operations.js";
import { takeFault, crashNow, marker } from "../shared/faults.js";
import { nowIso } from "../shared/db.js";
import { assertTransition, isTerminal, type Phase } from "./stateMachine.js";
import { db, mustSaga, getOrder, saveSaga, addEvent, type Saga, type Step } from "./store.js";

export type Outcome =
  | { kind: "SUCCEEDED"; data: any }
  | { kind: "FAILED"; data: any }
  | { kind: "UNKNOWN"; reason: string };
/** next = keep driving; blocked = waiting on an unknown/stuck step (resumer retries); done = terminal. */
export type Progress = "next" | "blocked" | "done";

export const PROVIDER = { reserve: "inventory", release: "inventory", charge: "payment", refund: "payment" } as const;
export const OPS_URL = { inventory: `${URLS.inventory}/inventory/operations`, payment: `${URLS.payment}/payments/operations` };
const isCompensation = (step: Step) => step === "refund" || step === "release";

/** Provider endpoint for a step (ids come from the saga record, so a replay hits the same resource). */
export function stepUrl(s: Saga, step: Step): string {
  switch (step) {
    case "reserve": return `${URLS.inventory}/inventory/reservations`;
    case "charge":  return `${URLS.payment}/payments/charges`;
    case "refund":  return `${URLS.payment}/payments/charges/${s.charge_id}/refund`;
    case "release": return `${URLS.inventory}/inventory/reservations/${s.reservation_id}/release`;
    case "confirm": return "local";
  }
}

/** Request body for a step. Built once, stored in the intent, and replayed byte-for-byte. */
function buildRequest(s: Saga, step: Step): Record<string, unknown> {
  const o = getOrder(s.order_id)!;
  const op_id = s.op_ids[step];
  switch (step) {
    case "reserve": return { order_id: o.order_id, item_id: o.item_id, quantity: o.quantity, reserve_op_id: op_id };
    case "charge":  return { order_id: o.order_id, account_id: o.account_id, amount: s.amount, charge_op_id: op_id };
    case "refund":  return { refund_op_id: op_id };
    case "release": return { release_op_id: op_id };
    case "confirm": return { saga_id: s.saga_id, order_id: s.order_id };
  }
}

/** Confirm is a LOCAL op in Order's own `operations` table: idempotent like the remote ones. */
export function confirmLocal(s: Saga): Outcome {
  const r = runOp(db, { op_id: s.op_ids.confirm, type: "confirm", request: buildRequest(s, "confirm") }, () =>
    takeFault("confirm.reject")
      ? { op_status: "FAILED", http_status: 409, body: { error: "CONFIRM_REJECTED" } }
      : { op_status: "SUCCEEDED", http_status: 200, body: { order_id: s.order_id, status: "CONFIRMED" } });
  if (r.body.op_status === "SUCCEEDED") return { kind: "SUCCEEDED", data: r.body };
  if (r.body.op_status === "FAILED") return { kind: "FAILED", data: r.body };
  return { kind: "UNKNOWN", reason: String(r.body.error ?? "local op error") };
}

/** Send the step (remote callOp or local confirm). Used by the first call AND by a NOT_FOUND replay. */
export async function perform(s: Saga, step: Step, request: Record<string, unknown>): Promise<Outcome> {
  if (step === "confirm") return confirmLocal(s);
  return callOp(stepUrl(s, step), request);
}

/** Write the new record; the guard runs on every phase change (throws => txn rolls back). */
function commit(before: Saga, after: Saga, to: Phase) {
  const from = before.phase;
  if (to !== from) assertTransition(from, to, after);
  after.phase = to;
  saveSaga(after);
  if (to !== from) addEvent(after.saga_id, to, "STATE", null, null, `${from} -> ${to}`);
}

/** Local cancel op, recorded in the same txn as the move to CANCELLED. */
function runCancelOp(s: Saga) {
  runOp(db, { op_id: s.op_ids.cancel, type: "cancel", request: { saga_id: s.saga_id, order_id: s.order_id } },
    () => ({ op_status: "SUCCEEDED", http_status: 200, body: { order_id: s.order_id, status: "CANCELLED" } }));
}

/** Step 5: apply an outcome (from a call, a query or a replay) + transition, in ONE transaction. */
export function applyOutcome(saga_id: string, step: Step, out: Outcome): Progress {
  return db.transaction((): Progress => {
    const s = mustSaga(saga_id);
    const n: Saga = { ...s, pending: [...s.pending] };
    let to: Phase = s.phase;
    let progress: Progress = "next";
    let why = "";

    if (out.kind === "UNKNOWN") {
      // Unknown != failed. Keep the intent (same op id), let the resumer query/replay.
      why = ` (${out.reason})`;
      n.last_error = `${step} UNKNOWN: ${out.reason}`;
      if (!isCompensation(step)) to = "RECOVERING"; // compensation stays COMPENSATING with pending + intent
      progress = "blocked";
    } else {
      const ok = out.kind === "SUCCEEDED";
      const d = out.data ?? {};
      n.intent = null; // the outcome is known: intent is resolved
      if (!ok) { n.last_error = `${step} FAILED: ${d.error ?? "?"}`; why = ` (${d.error ?? "?"})`; }
      switch (step) {
        case "reserve":
          if (ok) { n.reservation_id = d.reservation_id; n.amount = d.amount; to = "RESERVED"; }
          else to = "CANCELLED"; // nothing to compensate
          break;
        case "charge":
          if (ok) { n.charge_id = d.charge_id; to = "CHARGED"; }
          else { to = "COMPENSATING"; n.pending = ["release"]; }
          break;
        case "confirm":
          if (ok) to = "CONFIRMED";
          else { to = "COMPENSATING"; n.pending = ["refund", "release"]; } // refund first, then release
          break;
        case "refund":
        case "release":
          if (ok) {
            n.pending = n.pending.filter((p) => p !== step);
            if (step === "refund") n.refund_id = d.refund_id;
            else n.released_at = nowIso();
          } else {
            // Definitive rejection of a compensation (should not happen: UNKNOWN_CHARGE/RESERVATION).
            // No COMPENSATION_FAILED state: keep COMPENSATING + pending, visible for an operator.
            progress = "blocked";
          }
          break;
      }
    }
    if (to === "CANCELLED") runCancelOp(n);
    addEvent(saga_id, to, "OUTCOME", step, s.op_ids[step], `${step} ${out.kind}${why} -> ${to}`);
    commit(s, n, to); // guard throws => whole txn (outcome event included) rolls back
    if (out.kind === "FAILED" && isCompensation(step))
      addEvent(saga_id, n.phase, "ERROR", step, s.op_ids[step], `compensation ${step} rejected: ${n.last_error}`);
    return isTerminal(n.phase) ? "done" : progress;
  })();
}

/** Run one step: intent -> hook -> call -> hook -> outcome. */
export async function runStep(saga_id: string, step: Step): Promise<Progress> {
  const s = mustSaga(saga_id);
  const op_id = s.op_ids[step]; // fixed op id, minted at saga creation
  const request = buildRequest(s, step);
  db.transaction(() => {
    saveSaga({ ...s, intent: { step, op_id, request, at: nowIso() } });
    addEvent(saga_id, s.phase, "INTENT", step, op_id, `${step} op=${op_id}`);
  })();
  if (takeFault(`crash.after_intent.${step}`)) crashNow(`crash.after_intent.${step} saga=${saga_id}`);
  const out = await perform(s, step, request);
  if (takeFault(`crash.after_call.${step}`)) {
    marker(`provider answered ${step} ${out.kind} saga=${saga_id}, crashing before recording outcome`);
    crashNow(`crash.after_call.${step} saga=${saga_id}`);
  }
  return applyOutcome(saga_id, step, out);
}

/** COMPENSATING with nothing pending -> local cancel op -> CANCELLED (guard checks refund/release done). */
export function finishCancel(saga_id: string): Progress {
  return db.transaction((): Progress => {
    const s = mustSaga(saga_id);
    const n: Saga = { ...s, pending: [...s.pending] };
    runCancelOp(n);
    commit(s, n, "CANCELLED");
    return "done";
  })();
}
