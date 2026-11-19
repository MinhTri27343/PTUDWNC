/** All services bind to loopback only (lab requirement). */
export const HOST = "127.0.0.1";

export const PORTS = { ctl: 3000, order: 3001, inventory: 3002, payment: 3003 } as const;
export type ServiceName = "order" | "inventory" | "payment";
export const SERVICES: ServiceName[] = ["order", "inventory", "payment"];

export const URLS = {
  ctl: `http://${HOST}:${PORTS.ctl}`,
  order: `http://${HOST}:${PORTS.order}`,
  inventory: `http://${HOST}:${PORTS.inventory}`,
  payment: `http://${HOST}:${PORTS.payment}`,
} as const;

/** Orchestrator -> service call timeout. No answer within this = outcome UNKNOWN (not FAILED). */
export const CALL_TIMEOUT_MS = 2000;
/** Background resumer in Order: how often it re-drives non-terminal sagas (RECOVERING / COMPENSATING ...). */
export const RESUME_INTERVAL_MS = 2000;
