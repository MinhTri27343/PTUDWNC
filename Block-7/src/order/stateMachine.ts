/**
 * Saga state machine (CONTRACT §5). The table IS the design: any transition not listed is a bug,
 * so `assertTransition` throws instead of silently writing a wrong state.
 */
export type Phase = "PENDING" | "RESERVED" | "CHARGED" | "RECOVERING" | "COMPENSATING" | "CONFIRMED" | "CANCELLED";

export const ALLOWED: Record<Phase, Phase[]> = {
  PENDING:      ["RESERVED", "CANCELLED", "RECOVERING"],       // reserve OK / FAILED / UNKNOWN
  RESERVED:     ["CHARGED", "COMPENSATING", "RECOVERING"],     // charge  OK / FAILED / UNKNOWN
  RECOVERING:   ["RESERVED", "CHARGED", "CANCELLED", "COMPENSATING"], // learned the real outcome
  CHARGED:      ["CONFIRMED", "COMPENSATING"],                 // confirm OK / FAILED
  COMPENSATING: ["CANCELLED"],                                 // only when pending is empty
  CONFIRMED:    [],
  CANCELLED:    [],
};

export const isTerminal = (p: Phase) => p === "CONFIRMED" || p === "CANCELLED";

/** The saga fields the terminal guards look at (the record AFTER the transition). */
export interface GuardView {
  reservation_id: string | null; charge_id: string | null; refund_id: string | null;
  released_at: string | null; pending: string[];
}

export function assertTransition(from: Phase, to: Phase, s: GuardView): void {
  if (!ALLOWED[from].includes(to)) throw new Error(`illegal transition ${from} -> ${to}`);
  // Terminal guards: a saga may only END in a state that is consistent with what it did remotely.
  if (to === "CONFIRMED" && (!s.reservation_id || !s.charge_id || s.pending.length > 0))
    throw new Error("guard: CONFIRMED needs reservation_id + charge_id and no pending work");
  if (to === "CANCELLED") {
    if (s.pending.length > 0) throw new Error(`guard: CANCELLED with pending work ${JSON.stringify(s.pending)}`);
    if (s.reservation_id && !s.released_at) throw new Error("guard: CANCELLED with an unreleased reservation");
    if (s.charge_id && !s.refund_id) throw new Error("guard: CANCELLED with an unrefunded charge");
  }
}
