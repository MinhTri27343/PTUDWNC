/**
 * Automated oracle tests (CONTRACT §7) against the REAL 3 processes managed by ctl.
 * Each scenario: reset fixture -> arm hooks -> POST /orders?wait=1 -> poll to terminal -> assert.
 */
import { describe, expect, it } from "vitest";
import { runScenario, viewOf, type ScenarioResult } from "../scripts/lib.js";

function expectAllChecks(r: ScenarioResult) {
  const failed = r.checks.filter((c) => !c.ok).map((c) => `${c.name} :: ${c.detail ?? ""}`);
  expect(r.error, "scenario error").toBeUndefined();
  expect(failed, `${r.code} failed oracle checks`).toEqual([]);
  expect(r.pass).toBe(true);
}

function view(r: ScenarioResult) {
  expect(r.final, "final snapshot").toBeDefined();
  expect(r.order_id).toBeTruthy();
  return viewOf(r.final!, r.order_id!);
}

describe("Saga oracle §7 — core (H0, F1, F2, F3)", () => {
  it("H0 happy path: CONFIRMED, 1 ACTIVE reservation, exactly 1 CHARGE, 0 REFUND", async () => {
    const r = await runScenario("H0");
    const v = view(r);
    expect(v.status).toBe("CONFIRMED");
    expect(v.pending).toEqual([]);
    expect(v.reservations.map((x: any) => x.status)).toEqual(["ACTIVE"]);
    expect(v.movements.map((x: any) => x.type)).toEqual(["RESERVE"]);
    expect(v.charges).toHaveLength(1);
    expect(v.charges[0].op_id).toBe(`${r.saga_id}:charge`);
    expect(v.refunds).toHaveLength(0);
    expect(v.allEntries).toHaveLength(1);
    expectAllChecks(r);
  });

  it("F1 reserve FAILED (qty 11): CANCELLED, 0 reservation, 0 movement, empty ledger, charge never called", async () => {
    const r = await runScenario("F1");
    const v = view(r);
    expect(v.status).toBe("CANCELLED");
    expect(v.pending).toEqual([]);
    expect(v.reservations).toHaveLength(0);
    expect(v.movements).toHaveLength(0);
    expect(v.allEntries).toHaveLength(0);
    expectAllChecks(r);
  });

  it("F2 charge FAILED (carol/B): CANCELLED, reservation RELEASED, RESERVE+RELEASE, NO CHARGE and NO REFUND", async () => {
    const r = await runScenario("F2");
    const v = view(r);
    expect(v.status).toBe("CANCELLED");
    expect(v.pending).toEqual([]);
    expect(v.reservations.map((x: any) => x.status)).toEqual(["RELEASED"]);
    expect(v.movements.map((x: any) => x.type).sort()).toEqual(["RELEASE", "RESERVE"]);
    expect(v.charges).toHaveLength(0);
    expect(v.refunds).toHaveLength(0);
    expect(v.allEntries).toHaveLength(0);
    expectAllChecks(r);
  });

  it("F3 confirm.reject: CANCELLED, exactly 1 CHARGE + 1 REFUND, refund event precedes release event", async () => {
    const r = await runScenario("F3");
    const v = view(r);
    expect(v.status).toBe("CANCELLED");
    expect(v.pending).toEqual([]);
    expect(v.reservations.map((x: any) => x.status)).toEqual(["RELEASED"]);
    expect(v.movements.map((x: any) => x.type).sort()).toEqual(["RELEASE", "RESERVE"]);
    expect(v.charges).toHaveLength(1);
    expect(v.refunds).toHaveLength(1);
    expect(v.refunds[0].charge_id).toBe(v.charges[0].charge_id);
    expect(v.allEntries).toHaveLength(2);
    const iRefund = v.events.findIndex((e: any) => e.step === "refund");
    const iRelease = v.events.findIndex((e: any) => e.step === "release");
    expect(iRefund).toBeGreaterThanOrEqual(0);
    expect(iRelease).toBeGreaterThan(iRefund);
    expectAllChecks(r);
  });
});

// ---------------------------------------------------------------------------------------------
// BONUS: F4–F6 kill / restart REAL processes through ctl (POST /ctl/:svc/stop|start).
// ---------------------------------------------------------------------------------------------
describe("BONUS — F4–F6 with real process death (ctl)", () => {
  it("BONUS F4 payment crash after commit: RECOVERING while Payment is dead, then CONFIRMED with exactly 1 CHARGE", async () => {
    const r = await runScenario("F4");
    const v = view(r);
    expect(r.checks.find((c) => c.name.startsWith("while Payment is dead"))?.ok).toBe(true);
    expect(r.checks.find((c) => c.name.startsWith("still RECOVERING after 4s"))?.ok).toBe(true);
    expect(v.status).toBe("CONFIRMED");
    expect(v.charges).toHaveLength(1);
    expect(v.charges[0].op_id).toBe(`${r.saga_id}:charge`);
    expect(v.refunds).toHaveLength(0);
    expectAllChecks(r);
  }, 90000);

  it("BONUS F5 refund fails x4: COMPENSATING with pending [refund, release], then CANCELLED with 1 REFUND before RELEASE", async () => {
    const r = await runScenario("F5");
    const v = view(r);
    expect(r.checks.find((c) => c.name.startsWith("while refund fails"))?.ok).toBe(true);
    expect(v.status).toBe("CANCELLED");
    expect(v.charges).toHaveLength(1);
    expect(v.refunds).toHaveLength(1);
    expectAllChecks(r);
  }, 90000);

  it("BONUS F6 order crash after charge call: Payment CHARGED while Order dead, restart -> CONFIRMED, exactly 1 CHARGE", async () => {
    const r = await runScenario("F6");
    const v = view(r);
    expect(r.checks.find((c) => c.name.startsWith("Payment already CHARGED"))?.ok).toBe(true);
    expect(v.status).toBe("CONFIRMED");
    expect(v.charges).toHaveLength(1);
    expect(v.refunds).toHaveLength(0);
    expectAllChecks(r);
  }, 90000);
});
