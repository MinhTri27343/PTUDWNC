import type { Express } from "express";
import express from "express";

/**
 * Named fault hooks (test-only). A service checks `takeFault("charge.crash_after_commit")`
 * at a precise point in its code. Hooks are armed through HTTP:
 *   POST   /admin/faults  { "hook": "refund.fail", "count": 3 }   (count default 1, -1 = until cleared)
 *   GET    /admin/faults  -> [{ hook, remaining }]
 *   DELETE /admin/faults  -> clear all
 * Faults live in process memory only: a restarted process has no armed faults.
 */
const armed = new Map<string, number>();
let serviceName = "?";

export function installFaults(app: Express, service: string) {
  serviceName = service;
  app.get("/admin/faults", (_req, res) => {
    res.json([...armed].map(([hook, remaining]) => ({ hook, remaining })));
  });
  app.post("/admin/faults", express.json(), (req, res) => {
    const hook = String(req.body?.hook ?? "");
    if (!hook) { res.status(400).json({ error: "HOOK_REQUIRED" }); return; }
    const count = Number(req.body?.count ?? 1);
    armed.set(hook, count);
    marker(`armed fault ${hook} count=${count}`);
    res.json({ hook, remaining: count });
  });
  app.delete("/admin/faults", (_req, res) => { armed.clear(); res.json({ ok: true }); });
}

/** Returns true (and consumes one use) if the hook is armed. */
export function takeFault(hook: string): boolean {
  const n = armed.get(hook);
  if (!n) return false;
  if (n > 0) { if (n === 1) armed.delete(hook); else armed.set(hook, n - 1); }
  marker(`FAULT FIRED ${hook}`);
  return true;
}

/** Fault marker line. grep "[FAULT-MARKER]" in logs/<svc>.log for evidence. */
export function marker(text: string) {
  console.log(`[FAULT-MARKER] ${new Date().toISOString()} ${serviceName} ${text}`);
}

/** Simulate a real crash: the process dies immediately, no response is sent. */
export function crashNow(reason: string): never {
  marker(`CRASH ${reason} (process.exit)`);
  process.exit(1);
}
