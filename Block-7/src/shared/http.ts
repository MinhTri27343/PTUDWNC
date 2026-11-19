import { CALL_TIMEOUT_MS } from "./config.js";

/**
 * Classified result of calling a remote operation.
 *  SUCCEEDED : 2xx with op_status SUCCEEDED
 *  FAILED    : provider answered op_status FAILED (definitive, can never commit later)
 *  UNKNOWN   : timeout, connection refused/reset, 5xx, anything else -> we DON'T know.
 *              Never treat UNKNOWN as FAILED: query the op or replay the same op_id.
 */
export type CallResult =
  | { kind: "SUCCEEDED"; data: any }
  | { kind: "FAILED"; data: any; status: number }
  | { kind: "UNKNOWN"; reason: string };

export async function callOp(url: string, body: unknown, timeoutMs = CALL_TIMEOUT_MS): Promise<CallResult> {
  try {
    const { status, data } = await rawJson(url, { method: "POST", body, timeoutMs });
    if (data?.op_status === "SUCCEEDED" && status < 300) return { kind: "SUCCEEDED", data };
    if (data?.op_status === "FAILED") return { kind: "FAILED", data, status };
    return { kind: "UNKNOWN", reason: `http ${status} ${data?.error ?? ""}`.trim() };
  } catch (e: any) {
    return { kind: "UNKNOWN", reason: e.message };
  }
}

/** Result of GET /<svc>/operations/:op_id */
export type QueryResult =
  | { kind: "SUCCEEDED" | "FAILED" | "PENDING"; data: any }
  | { kind: "NOT_FOUND" } // not seen YET at this query; not a proof it will never commit
  | { kind: "UNREACHABLE"; reason: string };

export async function queryOp(opsBaseUrl: string, op_id: string): Promise<QueryResult> {
  try {
    const { status, data } = await rawJson(`${opsBaseUrl}/${encodeURIComponent(op_id)}`, { method: "GET" });
    if (status === 404 && data?.op_status === "NOT_FOUND") return { kind: "NOT_FOUND" };
    if (status === 200 && ["SUCCEEDED", "FAILED", "PENDING"].includes(data?.op_status)) return { kind: data.op_status, data };
    return { kind: "UNREACHABLE", reason: `http ${status}` };
  } catch (e: any) {
    return { kind: "UNREACHABLE", reason: e.message };
  }
}

/** Low-level JSON fetch with timeout. Throws Error("timeout ...") / Error("network ...") on transport problems. */
export async function rawJson(
  url: string,
  opts: { method?: string; body?: unknown; timeoutMs?: number; headers?: Record<string, string> } = {},
) {
  const ctrl = new AbortController();
  const ms = opts.timeoutMs ?? CALL_TIMEOUT_MS;
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { status: res.status, data };
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`timeout after ${ms}ms`);
    throw new Error(`network ${e?.cause?.code ?? e?.message ?? "error"}`);
  } finally {
    clearTimeout(t);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
