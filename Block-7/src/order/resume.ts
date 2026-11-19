/**
 * ONE function drives every saga: the POST /orders background run, startup recovery, the periodic
 * resumer, POST /sagas/:id/resume and POST /admin/resume all call `drive(saga_id)`.
 * Because state + intent are durable, "resume after a crash" is just "drive again".
 */
import { RESUME_INTERVAL_MS } from "../shared/config.js";
import { queryOp } from "../shared/http.js";
import { isTerminal } from "./stateMachine.js";
import { getSaga, mustSaga, saveSaga, addEvent, nonTerminalSagaIds, type Saga } from "./store.js";
import { applyOutcome, finishCancel, perform, runStep, confirmLocal, PROVIDER, OPS_URL, type Progress } from "./saga.js";

/** In-memory lock: at most one driver per saga inside this process (a second caller awaits the first). */
const locks = new Map<string, Promise<Saga | undefined>>();

export function drive(saga_id: string, source = "create"): Promise<Saga | undefined> {
  const running = locks.get(saga_id);
  if (running) return running;
  const p = (async () => {
    try {
      await driveLoop(saga_id, source); // always awaits => locks.set below happens before finally
    } catch (e: any) {
      try { // guard violation or bug: record it, keep the state as is (never "fix" it by guessing)
        const s = getSaga(saga_id);
        if (s) { saveSaga({ ...s, last_error: String(e?.message ?? e) }); addEvent(saga_id, s.phase, "ERROR", s.intent?.step ?? null, s.intent?.op_id ?? null, String(e?.message ?? e)); }
      } catch { /* saga deleted by reset */ }
    } finally {
      locks.delete(saga_id);
    }
    return getSaga(saga_id);
  })();
  locks.set(saga_id, p);
  return p;
}

async function driveLoop(saga_id: string, source: string) {
  let s = getSaga(saga_id);
  if (!s || isTerminal(s.phase)) return;
  if (source !== "create") addEvent(saga_id, s.phase, "RESUME", null, null, `resume (${source}) phase=${s.phase}`, true);

  // 1) An unresolved intent means "I may have called the provider": find out before doing anything else.
  if (s.intent && (await recoverIntent(s)) !== "next") return;

  // 2) Continue by phase until terminal or blocked.
  for (let i = 0; i < 10; i++) {
    s = mustSaga(saga_id);
    let p: Progress;
    switch (s.phase) {
      case "PENDING":      p = await runStep(saga_id, "reserve"); break;
      case "RESERVED":     p = await runStep(saga_id, "charge"); break;
      case "CHARGED":      p = await runStep(saga_id, "confirm"); break;
      case "COMPENSATING": // pending work first, in order (refund before release); then cancel
        p = s.pending.length ? await runStep(saga_id, s.pending[0]) : finishCancel(saga_id); break;
      case "RECOVERING":   throw new Error("RECOVERING without an intent (nothing to recover)");
      default:             return; // terminal
    }
    if (p !== "next") return;
  }
}

/** Resolve a dangling intent: ask the provider's durable op table what happened to OUR op id. */
async function recoverIntent(s: Saga): Promise<Progress> {
  const { step, op_id, request } = s.intent!;
  if (step === "confirm") {
    // Local op: our own operations table is the truth. runOp replays a stored result or runs it now.
    addEvent(s.saga_id, s.phase, "QUERY", step, op_id, `QUERY order(local) op=${op_id} -> re-run local op`);
    return applyOutcome(s.saga_id, step, confirmLocal(s));
  }
  const provider = PROVIDER[step];
  const q = await queryOp(OPS_URL[provider], op_id);
  const why = q.kind === "UNREACHABLE" ? ` (${q.reason})` : q.kind === "NOT_FOUND" ? " -> replay same op" : "";
  addEvent(s.saga_id, s.phase, "QUERY", step, op_id, `${provider} op=${op_id} -> ${q.kind}${why}`, true);
  switch (q.kind) {
    case "SUCCEEDED": return applyOutcome(s.saga_id, step, { kind: "SUCCEEDED", data: q.data.result }); // ids from result
    case "FAILED":    return applyOutcome(s.saga_id, step, { kind: "FAILED", data: q.data.result });
    case "NOT_FOUND": // not seen yet: safe to send again with the SAME op id + SAME request (idempotent)
      return applyOutcome(s.saga_id, step, await perform(s, step, request));
    default: // PENDING / UNREACHABLE: still unknown. Stay RECOVERING / COMPENSATING and try later.
      if (s.phase === "RECOVERING" || s.phase === "COMPENSATING") return "blocked";
      // Forward phase with a dangling intent (crashed after intent): it is now officially unknown.
      return applyOutcome(s.saga_id, step, { kind: "UNKNOWN", reason: `query ${q.kind}` });
  }
}

/** Drive every non-terminal saga once; returns their phases afterwards. */
export async function resumeAll(source: string) {
  const ids = nonTerminalSagaIds();
  const out = await Promise.all(ids.map((id) => drive(id, source)));
  return out.filter(Boolean).map((s) => ({ saga_id: s!.saga_id, phase: s!.phase }));
}

/** Startup = crash recovery: resume everything right away, then keep a background resumer. */
export function startResumer() {
  resumeAll("startup")
    .catch((e) => console.error("[resumer] startup error", e))
    .finally(() => {
      setInterval(() => { resumeAll("interval").catch((e) => console.error("[resumer] error", e)); }, RESUME_INTERVAL_MS);
    });
}
