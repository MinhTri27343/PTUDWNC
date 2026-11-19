/**
 * Shared helpers for scripts/demo.ts and tests/ (CONTRACT §6, §7).
 * Everything goes through HTTP (ctl + the 3 services); the only exception is an
 * optional read-only peek into data/order.db while the Order process is dead (F6 evidence).
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVICES, URLS, type ServiceName } from "../src/shared/config.js";
import { rawJson, sleep } from "../src/shared/http.js";

export { sleep };
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const LOG_DIR = path.join(ROOT, "logs");
export const EVIDENCE_DIR = path.join(ROOT, "evidence");

export const nowIso = () => new Date().toISOString();

// ====================================================================== HTTP
export class HttpError extends Error {
  constructor(
    msg: string,
    public status: number,
    public data: any,
  ) {
    super(msg);
  }
}

export async function http(method: string, url: string, body?: unknown, timeoutMs = 5000, headers?: Record<string, string>) {
  return rawJson(url, { method, body, timeoutMs, headers });
}

/** JSON request that throws on transport error or HTTP >= 400. */
export async function json<T = any>(method: string, url: string, body?: unknown, timeoutMs = 5000, headers?: Record<string, string>): Promise<T> {
  const { status, data } = await http(method, url, body, timeoutMs, headers);
  if (status >= 400) throw new HttpError(`${method} ${url} -> HTTP ${status} ${JSON.stringify(data)}`, status, data);
  return data as T;
}

/** Same as json() but returns null instead of throwing. */
export async function tryJson<T = any>(method: string, url: string, body?: unknown, timeoutMs = 3000): Promise<T | null> {
  try {
    return await json<T>(method, url, body, timeoutMs);
  } catch {
    return null;
  }
}

// ====================================================================== ctl
export type SvcStatus = { running: boolean; pid: number | null; started_at: string | null; exit_code: number | null; [k: string]: any };
export type CtlStatus = Record<ServiceName, SvcStatus>;

export class CtlUnavailableError extends Error {}

async function ctlCall<T = any>(method: string, p: string, timeoutMs = 15000): Promise<T> {
  let r: { status: number; data: any };
  try {
    r = await http(method, `${URLS.ctl}${p}`, method === "GET" ? undefined : {}, timeoutMs);
  } catch (e: any) {
    throw new CtlUnavailableError(`ctl is not reachable at ${URLS.ctl} (${e.message}). Start it first with: npm start`);
  }
  if (r.status >= 400) throw new HttpError(`ctl ${method} ${p} -> HTTP ${r.status}: ${r.data?.error ?? JSON.stringify(r.data)}`, r.status, r.data);
  return r.data as T;
}

export const ctl = {
  status: () => ctlCall<CtlStatus>("GET", "/ctl/status", 3000),
  start: (svc: ServiceName) => ctlCall("POST", `/ctl/${svc}/start`, 20000),
  stop: (svc: ServiceName) => ctlCall("POST", `/ctl/${svc}/stop`, 15000),
  reset: () => ctlCall("POST", "/ctl/reset", 60000),
};

export async function ctlReachable() {
  try {
    await ctl.status();
    return true;
  } catch {
    return false;
  }
}

export async function healthOk(svc: ServiceName) {
  const h = await tryJson(`GET`, `${URLS[svc]}/health`, undefined, 1000);
  return !!h?.ok;
}

function killTreeSync(pid: number) {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(pid, "SIGTERM"); // ctl handles SIGTERM by killing its children
  } catch {
    /* already gone */
  }
}

/**
 * Make sure ctl + all 3 services are up.
 * - ctl already running: start any stopped service, return a no-op stop fn.
 * - ctl not running: spawn `scripts/ctl.ts` as a child (output -> logs/ctl.log), wait until all 3 /health OK,
 *   return a stop fn that kills ctl and its service tree.
 */
export async function ensureCtl(opts: { verbose?: boolean; timeoutMs?: number } = {}): Promise<() => Promise<void>> {
  const timeoutMs = opts.timeoutMs ?? 45000;
  if (await ctlReachable()) {
    const st = await ctl.status();
    for (const svc of SERVICES) if (!st[svc]?.running) await ctl.start(svc);
    await waitFor(async () => (await Promise.all(SERVICES.map(healthOk))).every(Boolean), 15000, "all services healthy");
    return async () => {};
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logPath = path.join(LOG_DIR, "ctl.log");
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", path.join("scripts", "ctl.ts")], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let exited: number | null | undefined;
  child.on("exit", (code) => (exited = code));
  const sink = (d: Buffer) => {
    try {
      fs.appendFileSync(logPath, d);
    } catch {
      /* ignore */
    }
    if (opts.verbose) process.stdout.write(d);
  };
  child.stdout?.on("data", sink);
  child.stderr?.on("data", sink);

  try {
    await waitFor(
      async () => {
        if (exited !== undefined) throw new Error(`ctl exited early (code ${exited}); see logs/ctl.log`);
        if (!(await ctlReachable())) return false;
        return (await Promise.all(SERVICES.map(healthOk))).every(Boolean);
      },
      timeoutMs,
      "ctl + 3 services healthy",
      300,
      true,
    );
  } catch (e) {
    if (child.pid) killTreeSync(child.pid);
    throw e;
  }

  return async () => {
    if (exited !== undefined || !child.pid) return;
    const done = new Promise<void>((r) => child.once("exit", () => r()));
    killTreeSync(child.pid);
    await Promise.race([done, sleep(5000)]);
  };
}

// ====================================================================== waiting
/**
 * Polls `predicate` until it returns a truthy value (returned) or the timeout expires (throws).
 * Errors thrown by the predicate count as "not yet" unless `rethrow` is set.
 */
export async function waitFor<T>(
  predicate: () => Promise<T | null | undefined | false> | T | null | undefined | false,
  timeoutMs: number,
  label = "condition",
  intervalMs = 200,
  rethrow = false,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: any;
  while (true) {
    try {
      const v = await predicate();
      if (v) return v as T;
    } catch (e) {
      if (rethrow) throw e;
      lastErr = e;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timeout after ${timeoutMs}ms waiting for ${label}${lastErr ? ` (last error: ${lastErr.message})` : ""}`);
    }
    await sleep(intervalMs);
  }
}

// ====================================================================== service API
export const TERMINAL = ["CONFIRMED", "CANCELLED"];

export type OrderBody = { account_id: string; item_id: string; quantity: number };

export async function placeOrder(body: OrderBody, opts: { wait?: boolean; key?: string } = {}) {
  const key = opts.key ?? `demo-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const url = `${URLS.order}/orders${opts.wait ? "?wait=1" : ""}`;
  const data = await json<any>("POST", url, body, opts.wait ? 20000 : 5000, { "Idempotency-Key": key });
  return { ...data, idempotency_key: key } as { order_id: string; saga_id: string; status: string; idempotency_key: string; [k: string]: any };
}

export const getOrder = (order_id: string) => json<any>("GET", `${URLS.order}/orders/${order_id}`);
export const getSaga = (order_id: string) => json<any>("GET", `${URLS.order}/orders/${order_id}/saga`);

export async function armFault(svc: ServiceName, hook: string, count = 1) {
  return json("POST", `${URLS[svc]}/admin/faults`, { hook, count });
}

export async function waitOrderStatus(order_id: string, statuses: string[], timeoutMs: number) {
  return waitFor(
    async () => {
      const o = await getOrder(order_id);
      return statuses.includes(o.status) ? o : null;
    },
    timeoutMs,
    `order ${order_id} status in [${statuses.join(",")}]`,
    250,
  );
}

export async function resetFixture() {
  const r = await ctl.reset();
  if (!r?.ok) throw new Error(`ctl reset failed: ${JSON.stringify(r)}`);
  await waitFor(async () => (await Promise.all(SERVICES.map(healthOk))).every(Boolean), 15000, "services healthy after reset");
  return r;
}

/** GET /<svc>/operations/:op_id -> op_status or "UNREACHABLE" */
export async function opStatus(svc: "inventory" | "payment" | "order", op_id: string): Promise<string> {
  const base = svc === "order" ? `${URLS.order}/orders/operations` : `${URLS[svc]}/${svc === "payment" ? "payments" : "inventory"}/operations`;
  try {
    const { data } = await http("GET", `${base}/${encodeURIComponent(op_id)}`, undefined, 2000);
    return data?.op_status ?? "UNKNOWN";
  } catch {
    return "UNREACHABLE";
  }
}

// ====================================================================== snapshot
export type Part<T> = { ok: true; data: T } | { ok: false; error: string };

export type Snapshot = {
  at: string;
  order_id?: string;
  ctl?: CtlStatus | null;
  order: Part<{ orders: any[]; order: any | null; saga: any | null }>;
  inventory: Part<{ items: any[]; reservations: any[]; movements: any[] }>;
  payment: Part<{ accounts: any[]; ledger: { entries: any[]; total_charged: number; total_refunded: number; net: number } }>;
};

async function part<T>(fn: () => Promise<T>): Promise<Part<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function snapshot(order_id?: string): Promise<Snapshot> {
  const [order, inventory, payment, ctlSt] = await Promise.all([
    part(async () => {
      const orders = await json<any[]>("GET", `${URLS.order}/orders`, undefined, 3000);
      const order = order_id ? await json("GET", `${URLS.order}/orders/${order_id}`, undefined, 3000) : null;
      const saga = order_id ? await json("GET", `${URLS.order}/orders/${order_id}/saga`, undefined, 3000) : null;
      return { orders, order, saga };
    }),
    part(async () => {
      const [items, reservations, movements] = await Promise.all([
        json<any[]>("GET", `${URLS.inventory}/inventory/items`, undefined, 3000),
        json<any[]>("GET", `${URLS.inventory}/inventory/reservations`, undefined, 3000),
        json<any[]>("GET", `${URLS.inventory}/inventory/movements`, undefined, 3000),
      ]);
      return { items, reservations, movements };
    }),
    part(async () => {
      const [accounts, ledger] = await Promise.all([
        json<any[]>("GET", `${URLS.payment}/payments/accounts`, undefined, 3000),
        json<any>("GET", `${URLS.payment}/payments/ledger`, undefined, 3000),
      ]);
      return { accounts, ledger };
    }),
    ctl.status().catch(() => null),
  ]);
  return { at: nowIso(), order_id, ctl: ctlSt, order, inventory, payment };
}

/** Order-scoped view of a snapshot (for assertions). */
export function viewOf(snap: Snapshot, order_id: string) {
  const o = snap.order.ok ? snap.order.data : null;
  const inv = snap.inventory.ok ? snap.inventory.data : null;
  const pay = snap.payment.ok ? snap.payment.data : null;
  const entries = pay?.ledger?.entries ?? [];
  const mine = entries.filter((e: any) => e.order_id === order_id);
  return {
    status: o?.order?.status as string | undefined,
    phase: o?.saga?.phase as string | undefined,
    pending: o?.saga?.pending as string[] | undefined,
    intent: o?.saga?.intent ?? null,
    op_ids: o?.saga?.op_ids,
    events: [...(o?.saga?.events ?? [])].sort(eventOrder),
    reservations: (inv?.reservations ?? []).filter((r: any) => r.order_id === order_id),
    movements: (inv?.movements ?? []).filter((m: any) => m.order_id === order_id),
    charges: mine.filter((e: any) => e.type === "CHARGE"),
    refunds: mine.filter((e: any) => e.type === "REFUND"),
    allEntries: entries,
  };
}

function eventOrder(a: any, b: any) {
  if (typeof a.id === "number" && typeof b.id === "number") return a.id - b.id;
  return String(a.at).localeCompare(String(b.at));
}

// ====================================================================== invariants & oracle
export type Check = { name: string; ok: boolean; detail?: string };
const chk = (name: string, ok: boolean, detail?: unknown): Check => ({
  name,
  ok: !!ok,
  detail: detail === undefined ? undefined : typeof detail === "string" ? detail : JSON.stringify(detail),
});

export function invariantChecks(snap: Snapshot): Check[] {
  const out: Check[] = [];
  if (snap.payment.ok) {
    const { accounts, ledger } = snap.payment.data;
    const sumBal = accounts.reduce((s: number, a: any) => s + Number(a.balance), 0);
    const sumInit = accounts.reduce((s: number, a: any) => s + Number(a.initial), 0);
    const net = Number(ledger.net);
    const charged = ledger.entries.filter((e: any) => e.type === "CHARGE").reduce((s: number, e: any) => s + Number(e.amount), 0);
    const refunded = ledger.entries.filter((e: any) => e.type === "REFUND").reduce((s: number, e: any) => s + Number(e.amount), 0);
    out.push(chk("invariant money: Σbalance + net == Σinitial", sumBal + net === sumInit, `${sumBal} + ${net} = ${sumBal + net} vs ${sumInit}`));
    out.push(chk("ledger totals match entries", charged === Number(ledger.total_charged) && refunded === Number(ledger.total_refunded) && charged - refunded === net, { charged, refunded, ledger_total_charged: ledger.total_charged, ledger_total_refunded: ledger.total_refunded, net }));
  } else out.push(chk("invariant money", false, `payment unavailable: ${snap.payment.error}`));
  if (snap.inventory.ok) {
    const bad = snap.inventory.data.items.filter((i: any) => Number(i.available) + Number(i.reserved) !== Number(i.initial));
    out.push(chk("invariant stock: available + reserved == initial (every item)", bad.length === 0, snap.inventory.data.items.map((i: any) => `${i.item_id}:${i.available}+${i.reserved}=${i.initial}`).join(" ")));
  } else out.push(chk("invariant stock", false, `inventory unavailable: ${snap.inventory.error}`));
  return out;
}

export type Code = "H0" | "F1" | "F2" | "F3" | "F4" | "F5" | "F6";
export const CODES: Code[] = ["H0", "F1", "F2", "F3", "F4", "F5", "F6"];

type Expect = {
  status: "CONFIRMED" | "CANCELLED";
  reservations: number;
  reservationStatus?: "ACTIVE" | "RELEASED";
  movements: string[]; // sorted types
  charges: number;
  refunds: number;
  refundBeforeRelease?: boolean;
  balance: [string, number];
  stock: [string, number];
};

export const SCENARIOS: Record<Code, { title: string; body: OrderBody; faults: [ServiceName, string, number][]; expect: Expect }> = {
  H0: {
    title: "Happy path",
    body: { account_id: "alice", item_id: "A", quantity: 1 },
    faults: [],
    expect: { status: "CONFIRMED", reservations: 1, reservationStatus: "ACTIVE", movements: ["RESERVE"], charges: 1, refunds: 0, balance: ["alice", 900000], stock: ["A", 9] },
  },
  F1: {
    title: "Reserve FAILED (quantity 11 > stock 10)",
    body: { account_id: "alice", item_id: "A", quantity: 11 },
    faults: [],
    expect: { status: "CANCELLED", reservations: 0, movements: [], charges: 0, refunds: 0, balance: ["alice", 1000000], stock: ["A", 10] },
  },
  F2: {
    title: "Charge FAILED (carol 50 000 < item B 300 000) -> release",
    body: { account_id: "carol", item_id: "B", quantity: 1 },
    faults: [],
    expect: { status: "CANCELLED", reservations: 1, reservationStatus: "RELEASED", movements: ["RELEASE", "RESERVE"], charges: 0, refunds: 0, balance: ["carol", 50000], stock: ["B", 5] },
  },
  F3: {
    title: "Confirm FAILED (order hook confirm.reject) -> refund then release",
    body: { account_id: "alice", item_id: "A", quantity: 1 },
    faults: [["order", "confirm.reject", 1]],
    expect: { status: "CANCELLED", reservations: 1, reservationStatus: "RELEASED", movements: ["RELEASE", "RESERVE"], charges: 1, refunds: 1, refundBeforeRelease: true, balance: ["alice", 1000000], stock: ["A", 10] },
  },
  F4: {
    title: "Payment crashes after committing the charge (real process death)",
    body: { account_id: "alice", item_id: "A", quantity: 1 },
    faults: [["payment", "charge.crash_after_commit", 1]],
    expect: { status: "CONFIRMED", reservations: 1, reservationStatus: "ACTIVE", movements: ["RESERVE"], charges: 1, refunds: 0, balance: ["alice", 900000], stock: ["A", 9] },
  },
  F5: {
    title: "F3 + refund fails 4 times (stays COMPENSATING, resumer retries)",
    body: { account_id: "alice", item_id: "A", quantity: 1 },
    faults: [
      ["order", "confirm.reject", 1],
      ["payment", "refund.fail", 4],
    ],
    expect: { status: "CANCELLED", reservations: 1, reservationStatus: "RELEASED", movements: ["RELEASE", "RESERVE"], charges: 1, refunds: 1, refundBeforeRelease: true, balance: ["alice", 1000000], stock: ["A", 10] },
  },
  F6: {
    title: "Order (orchestrator) crashes after Payment answered charge (real process death)",
    body: { account_id: "alice", item_id: "A", quantity: 1 },
    faults: [["order", "crash.after_call.charge", 1]],
    expect: { status: "CONFIRMED", reservations: 1, reservationStatus: "ACTIVE", movements: ["RESERVE"], charges: 1, refunds: 0, balance: ["alice", 900000], stock: ["A", 9] },
  },
};

/** Final-state oracle (§7) for one order. */
export function oracleChecks(code: Code, snap: Snapshot, order_id: string, saga_id: string): Check[] {
  const e = SCENARIOS[code].expect;
  const v = viewOf(snap, order_id);
  const out: Check[] = [];
  out.push(chk(`order status == ${e.status}`, v.status === e.status, v.status));
  out.push(chk("orders.status == sagas.phase", v.status === v.phase, `${v.status} / ${v.phase}`));
  out.push(chk("saga pending == []", Array.isArray(v.pending) && v.pending.length === 0, v.pending));
  out.push(chk("saga intent cleared", v.intent == null, v.intent));
  out.push(chk(`reservations for order == ${e.reservations}${e.reservationStatus ? ` (${e.reservationStatus})` : ""}`, v.reservations.length === e.reservations && (!e.reservationStatus || v.reservations.every((r: any) => r.status === e.reservationStatus)), v.reservations.map((r: any) => `${r.reservation_id}:${r.status}`)));
  const movTypes = v.movements.map((m: any) => m.type).sort();
  out.push(chk(`movements for order == [${e.movements.join(", ")}]`, JSON.stringify(movTypes) === JSON.stringify(e.movements), movTypes));
  out.push(chk(`ledger CHARGE for order == ${e.charges}`, v.charges.length === e.charges, v.charges.map((c: any) => c.op_id)));
  out.push(chk(`ledger REFUND for order == ${e.refunds}`, v.refunds.length === e.refunds, v.refunds.map((c: any) => c.op_id)));
  if (e.charges) out.push(chk(`CHARGE op_id == ${saga_id}:charge`, v.charges.every((c: any) => c.op_id === `${saga_id}:charge`), v.charges.map((c: any) => c.op_id)));
  if (e.refunds) {
    out.push(chk(`REFUND op_id == ${saga_id}:refund`, v.refunds.every((c: any) => c.op_id === `${saga_id}:refund`), v.refunds.map((c: any) => c.op_id)));
    out.push(chk("REFUND references the original charge", v.refunds.every((r: any) => v.charges.some((c: any) => c.charge_id === r.charge_id)), v.refunds.map((r: any) => r.charge_id)));
  }
  // no unexpected money movement anywhere (fixture was reset, so the whole ledger belongs to this order)
  const foreign = v.allEntries.filter((x: any) => x.order_id !== order_id);
  const totalCharges = v.allEntries.filter((x: any) => x.type === "CHARGE").length;
  const totalRefunds = v.allEntries.filter((x: any) => x.type === "REFUND").length;
  out.push(chk("no unexpected CHARGE/REFUND in the whole ledger", foreign.length === 0 && totalCharges === e.charges && totalRefunds === e.refunds, { entries: v.allEntries.length, charges: totalCharges, refunds: totalRefunds, foreign: foreign.length }));
  if (e.refundBeforeRelease) {
    const iRefund = v.events.findIndex((x: any) => x.step === "refund");
    const iRelease = v.events.findIndex((x: any) => x.step === "release");
    out.push(chk("saga events: refund precedes release", iRefund >= 0 && iRelease >= 0 && iRefund < iRelease, `refund@${iRefund} release@${iRelease}`));
    const refundAt = v.refunds[0]?.created_at;
    const releaseAt = v.movements.find((m: any) => m.type === "RELEASE")?.created_at;
    out.push(chk("REFUND ledger time <= RELEASE movement time", !!refundAt && !!releaseAt && String(refundAt) <= String(releaseAt), `${refundAt} <= ${releaseAt}`));
  }
  if (snap.payment.ok) {
    const acc = snap.payment.data.accounts.find((a: any) => a.account_id === e.balance[0]);
    out.push(chk(`balance ${e.balance[0]} == ${e.balance[1]}`, Number(acc?.balance) === e.balance[1], acc?.balance));
  }
  if (snap.inventory.ok) {
    const it = snap.inventory.data.items.find((i: any) => i.item_id === e.stock[0]);
    out.push(chk(`available ${e.stock[0]} == ${e.stock[1]}`, Number(it?.available) === e.stock[1], it?.available));
  }
  out.push(...invariantChecks(snap));
  return out;
}

// ====================================================================== logs / markers
/** [FAULT-MARKER] lines from logs/<svc>.log whose ctl timestamp is >= sinceIso. */
export function faultMarkers(sinceIso: string): string[] {
  const out: { ts: string; line: string }[] = [];
  for (const svc of SERVICES) {
    const f = path.join(LOG_DIR, `${svc}.log`);
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      if (!line.includes("[FAULT-MARKER]")) continue;
      const ts = line.split(" ", 1)[0];
      if (ts >= sinceIso) out.push({ ts, line: `${svc}.log: ${line}` });
    }
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts)).map((x) => x.line);
}

// ====================================================================== op ids helpers
export function stableStringify(v: any): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
}
export function opIdValues(op_ids: any): string[] {
  if (!op_ids) return [];
  if (typeof op_ids === "string") {
    try {
      return opIdValues(JSON.parse(op_ids));
    } catch {
      return [op_ids];
    }
  }
  return (Array.isArray(op_ids) ? op_ids : Object.values(op_ids)).map(String).sort();
}

/** Read-only peek into data/order.db (evidence only, used while the Order process is dead). */
export async function peekOrderDb(saga_id: string): Promise<any | null> {
  try {
    const mod: any = await import("better-sqlite3");
    const Database = mod.default ?? mod;
    const db = new Database(path.join(ROOT, "data", "order.db"), { readonly: true, fileMustExist: true });
    try {
      return db.prepare("SELECT saga_id, order_id, phase, intent, pending, op_ids, charge_id, reservation_id FROM sagas WHERE saga_id = ?").get(saga_id) ?? null;
    } finally {
      db.close();
    }
  } catch (e: any) {
    return { peek_error: e.message };
  }
}

// ====================================================================== scenario runner
export type ScenarioResult = {
  code: Code;
  title: string;
  pass: boolean;
  started_at: string;
  finished_at?: string;
  order_id?: string;
  saga_id?: string;
  idempotency_key?: string;
  timeline: { at: string; what: string }[];
  checks: Check[];
  snapshots: { label: string; snap: Snapshot }[];
  op_ids_before?: any;
  op_ids_after?: any;
  markers: string[];
  notes: string[];
  final?: Snapshot;
  error?: string;
};

class Run {
  r: ScenarioResult;
  constructor(
    code: Code,
    private log: boolean,
  ) {
    this.r = { code, title: SCENARIOS[code].title, pass: false, started_at: nowIso(), timeline: [], checks: [], snapshots: [], markers: [], notes: [] };
  }
  step(what: string) {
    const at = nowIso();
    this.r.timeline.push({ at, what });
    if (this.log) console.log(`  [${this.r.code}] ${at}  ${what}`);
  }
  check(name: string, ok: boolean, detail?: unknown) {
    const c = chk(name, ok, detail);
    this.r.checks.push(c);
    if (this.log) console.log(`  [${this.r.code}]   ${c.ok ? "ok  " : "FAIL"} ${name}${c.detail ? `  (${c.detail})` : ""}`);
  }
  checks(cs: Check[]) {
    for (const c of cs) this.check(c.name, c.ok, c.detail);
  }
  note(n: string) {
    this.r.notes.push(n);
    if (this.log) console.log(`  [${this.r.code}]   note: ${n}`);
  }
  async snap(label: string) {
    const s = await snapshot(this.r.order_id);
    this.r.snapshots.push({ label, snap: s });
    this.step(`snapshot: ${label}`);
    return s;
  }
}

async function svcDead(svc: ServiceName, timeoutMs: number) {
  return waitFor(
    async () => {
      const st = await ctl.status();
      return !st[svc].running ? st[svc] : null;
    },
    timeoutMs,
    `${svc} process to exit`,
    150,
  );
}

async function armAll(run: Run, code: Code) {
  for (const [svc, hook, count] of SCENARIOS[code].faults) {
    await armFault(svc, hook, count);
    run.step(`arm hook ${svc}:${hook} count=${count}`);
  }
}

function compareOpIds(run: Run, label = "op_ids identical before stop / after restart") {
  const b = run.r.op_ids_before;
  const a = run.r.op_ids_after;
  const ok = b != null && a != null && (stableStringify(b) === stableStringify(a) || stableStringify(opIdValues(b)) === stableStringify(opIdValues(a)));
  run.check(label, ok, { before: b, after: a });
}

export async function runScenario(code: Code, opts: { log?: boolean } = {}): Promise<ScenarioResult> {
  const run = new Run(code, opts.log ?? false);
  try {
    await resetFixture();
    run.step("reset fixture (POST /ctl/reset)");
    if (code === "F4") await runF4(run);
    else if (code === "F5") await runF5(run);
    else if (code === "F6") await runF6(run);
    else await runSimple(run, code);
  } catch (e: any) {
    run.r.error = e.message;
    run.check("scenario ran without error", false, e.message);
    try {
      if (!run.r.final) run.r.final = await run.snap("at failure");
    } catch {
      /* ignore */
    }
  }
  await sleep(150); // let ctl flush the last log lines
  run.r.markers = faultMarkers(run.r.started_at);
  checkMarkers(run, code);
  run.r.finished_at = nowIso();
  run.r.pass = run.r.checks.length > 0 && run.r.checks.every((c) => c.ok);
  return run.r;
}

function checkMarkers(run: Run, code: Code) {
  const m = run.r.markers.join("\n");
  const fired = (hook: string) => (m.match(new RegExp(`FAULT FIRED ${hook.replace(/\./g, "\\.")}`, "g")) ?? []).length;
  if (code === "F3") run.check("marker: FAULT FIRED confirm.reject", fired("confirm.reject") >= 1, fired("confirm.reject"));
  if (code === "F4") {
    run.check("marker: FAULT FIRED charge.crash_after_commit", fired("charge.crash_after_commit") >= 1, fired("charge.crash_after_commit"));
    run.check("marker: CRASH in payment log", /payment\.log:.*CRASH/.test(m));
  }
  if (code === "F5") {
    run.check("marker: FAULT FIRED confirm.reject", fired("confirm.reject") >= 1, fired("confirm.reject"));
    run.check("marker: FAULT FIRED refund.fail x4", fired("refund.fail") === 4, fired("refund.fail"));
  }
  if (code === "F6") {
    run.check("marker: FAULT FIRED crash.after_call.charge", fired("crash.after_call.charge") >= 1, fired("crash.after_call.charge"));
    run.check("marker: CRASH in order log", /order\.log:.*CRASH/.test(m));
  }
}

async function startOrder(run: Run, code: Code, wait: boolean) {
  const o = await placeOrder(SCENARIOS[code].body, { wait, key: `${code}-${Date.now()}` });
  run.r.order_id = o.order_id;
  run.r.saga_id = o.saga_id;
  run.r.idempotency_key = o.idempotency_key;
  run.step(`POST /orders${wait ? "?wait=1" : ""} ${JSON.stringify(SCENARIOS[code].body)} -> ${o.order_id} / ${o.saga_id} status=${o.status}`);
  return o;
}

async function runSimple(run: Run, code: Code) {
  await armAll(run, code);
  const o = await startOrder(run, code, true);
  run.r.op_ids_before = (await getSaga(o.order_id)).op_ids;
  const t = await waitOrderStatus(o.order_id, TERMINAL, 20000);
  run.step(`terminal status ${t.status}`);
  const fin = await run.snap("final");
  run.r.final = fin;
  run.r.op_ids_after = viewOf(fin, o.order_id).op_ids;
  run.checks(oracleChecks(code, fin, o.order_id, o.saga_id));
  compareOpIds(run, "op_ids stable for the whole saga");
  if (code === "F1") {
    const st = await opStatus("payment", `${o.saga_id}:charge`);
    run.check("charge never called (payment op S-…:charge NOT_FOUND)", st === "NOT_FOUND", st);
  }
}

async function runF4(run: Run) {
  await armAll(run, "F4");
  const o = await startOrder(run, "F4", true);
  run.r.op_ids_before = (await getSaga(o.order_id)).op_ids;
  run.step(`op_ids before stop: ${JSON.stringify(run.r.op_ids_before)}`);
  const dead = await svcDead("payment", 15000);
  run.step(`Payment process died detected (pid ${dead.last_pid ?? "?"} gone, exit_code=${dead.exit_code})`);
  run.check("Payment /health unreachable", !(await healthOk("payment")));
  const rec = await waitOrderStatus(o.order_id, ["RECOVERING", "CONFIRMED", "CANCELLED"], 15000);
  run.check("while Payment is dead: order RECOVERING", rec.status === "RECOVERING", rec.status);
  const s1 = await run.snap("1. Payment dead (before start)");
  run.check("snapshot 1: payment API unavailable", !s1.payment.ok, s1.payment.ok ? "payment answered" : s1.payment.error);
  await sleep(4000);
  const still = await getOrder(o.order_id);
  run.step(`after 4s with Payment dead: status=${still.status}`);
  run.check("still RECOVERING after 4s (not CANCELLED/CONFIRMED)", still.status === "RECOVERING", still.status);
  await ctl.start("payment");
  run.step("start command: POST /ctl/payment/start (healthy)");
  const s2 = await run.snap("2. right after Payment restart");
  run.r.op_ids_after = viewOf(s2, o.order_id).op_ids;
  const conv = await waitOrderStatus(o.order_id, TERMINAL, 30000);
  run.step(`convergence: status=${conv.status}`);
  const s3 = await run.snap("3. after convergence");
  run.r.final = s3;
  run.checks(oracleChecks("F4", s3, o.order_id, o.saga_id));
  compareOpIds(run);
  const v = viewOf(s3, o.order_id);
  const kinds = v.events.filter((x: any) => x.step === "charge").map((x: any) => x.kind);
  run.note(`saga events for step charge: ${kinds.join(", ")}`);
}

async function runF5(run: Run) {
  await armAll(run, "F5");
  const o = await startOrder(run, "F5", true);
  run.r.op_ids_before = (await getSaga(o.order_id)).op_ids;
  const sg = await waitFor(
    async () => {
      const s = await getSaga(o.order_id);
      return s.phase === "COMPENSATING" && JSON.stringify(s.pending) === JSON.stringify(["refund", "release"]) ? s : null;
    },
    15000,
    "COMPENSATING with pending [refund, release]",
    150,
  );
  run.step(`COMPENSATING detected, pending=${JSON.stringify(sg.pending)}, last_error=${sg.last_error ?? "-"}`);
  run.check("while refund fails: COMPENSATING, pending [refund, release]", true, sg.pending);
  const s1 = await run.snap("1. while COMPENSATING (refund failing)");
  const v1 = viewOf(s1, o.order_id);
  run.check("snapshot 1: still 1 reservation ACTIVE, 0 REFUND", v1.reservations.length === 1 && v1.reservations[0].status === "ACTIVE" && v1.refunds.length === 0, { res: v1.reservations.map((r: any) => r.status), refunds: v1.refunds.length });
  const conv = await waitOrderStatus(o.order_id, TERMINAL, 45000);
  run.step(`convergence: status=${conv.status}`);
  const s3 = await run.snap("2. after convergence");
  run.r.final = s3;
  run.r.op_ids_after = viewOf(s3, o.order_id).op_ids;
  run.checks(oracleChecks("F5", s3, o.order_id, o.saga_id));
  compareOpIds(run, "op_ids identical during retries / after convergence");
  run.note("F5 kills no process: refund.fail returns 503 (temporary); the resumer retries with the same refund op_id.");
}

async function runF6(run: Run) {
  await armAll(run, "F6");
  const o = await startOrder(run, "F6", false);
  const early = await tryJson("GET", `${URLS.order}/orders/${o.order_id}/saga`, undefined, 1000);
  if (early?.op_ids) {
    run.r.op_ids_before = early.op_ids;
    run.step(`op_ids before stop (GET saga right after POST): ${JSON.stringify(early.op_ids)}`);
  }
  const dead = await svcDead("order", 15000);
  run.step(`Order process died detected (pid ${dead.last_pid ?? "?"} gone, exit_code=${dead.exit_code})`);
  run.check("Order /health unreachable", !(await healthOk("order")));
  const s1 = await run.snap("1. Order dead (before start)");
  run.check("snapshot 1: order API unavailable", !s1.order.ok, s1.order.ok ? "order answered" : s1.order.error);
  run.note("While Order is dead its data is NOT readable via API (each service owns its DB). Payment/Inventory are read via their APIs.");
  const v1 = viewOf(s1, o.order_id);
  run.check("Payment already CHARGED this order (ledger has 1 CHARGE)", v1.charges.length === 1, v1.charges.map((c: any) => c.op_id));
  const chargeOp = await opStatus("payment", `${o.saga_id}:charge`);
  run.check(`payment op ${o.saga_id}:charge SUCCEEDED`, chargeOp === "SUCCEEDED", chargeOp);
  const peek = await peekOrderDb(o.saga_id);
  (run.r as any).order_db_peek = peek;
  if (peek && !peek.peek_error) {
    let intent: any = peek.intent;
    try {
      intent = typeof intent === "string" ? JSON.parse(intent) : intent;
    } catch {
      /* keep raw */
    }
    run.check("Order DB (read-only peek) still holds intent step=charge", intent?.step === "charge", { phase: peek.phase, intent });
    if (!run.r.op_ids_before) {
      run.r.op_ids_before = typeof peek.op_ids === "string" ? JSON.parse(peek.op_ids) : peek.op_ids;
      run.step(`op_ids before restart (read-only peek of data/order.db): ${JSON.stringify(run.r.op_ids_before)}`);
    }
  } else {
    run.note(`read-only peek of data/order.db not possible: ${peek?.peek_error ?? "no row"}`);
  }
  if (!run.r.op_ids_before) {
    run.r.op_ids_before = { charge: v1.charges[0]?.op_id ?? null };
    run.note("op_ids before restart reconstructed from Payment ledger (Order down).");
  }
  await ctl.start("order");
  run.step("start command: POST /ctl/order/start (healthy; startup runs resume)");
  const s2 = await run.snap("2. right after Order restart");
  run.r.op_ids_after = viewOf(s2, o.order_id).op_ids;
  const conv = await waitOrderStatus(o.order_id, TERMINAL, 30000);
  run.step(`convergence: status=${conv.status}`);
  const s3 = await run.snap("3. after convergence");
  run.r.final = s3;
  if (!run.r.op_ids_after) run.r.op_ids_after = viewOf(s3, o.order_id).op_ids;
  run.checks(oracleChecks("F6", s3, o.order_id, o.saga_id));
  const b = run.r.op_ids_before;
  if (b && Object.keys(b).length === 1 && "charge" in b) {
    run.check("charge op_id identical before/after restart", opIdValues(run.r.op_ids_after).includes(b.charge), { before: b, after: run.r.op_ids_after });
  } else compareOpIds(run);
  const kinds = viewOf(s3, o.order_id).events.filter((x: any) => x.step === "charge").map((x: any) => x.kind);
  run.note(`saga events for step charge: ${kinds.join(", ")}`);
}
