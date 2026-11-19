/**
 * ctl :3000 — process manager + static UI (CONTRACT §6).
 *
 * Spawns order / inventory / payment as REAL child processes:
 *   process.execPath --import tsx src/<svc>/server.ts   (cwd = project root)
 * stdout/stderr -> console with a colored [svc] prefix + appended to logs/<svc>.log with timestamps.
 * No auto-restart: a process that dies stays dead until POST /ctl/:svc/start.
 */
import express from "express";
import cors from "cors";
import { spawn, execFile, execFileSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOST, PORTS, SERVICES, URLS, type ServiceName } from "../src/shared/config.js";
import { rawJson, sleep } from "../src/shared/http.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG_DIR = path.join(ROOT, "logs");
const UI_DIR = path.join(ROOT, "src", "ui");
fs.mkdirSync(LOG_DIR, { recursive: true });

const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 5_000;

const COLORS: Record<ServiceName | "ctl", string> = {
  order: "\x1b[36m", // cyan
  inventory: "\x1b[35m", // magenta
  payment: "\x1b[33m", // yellow
  ctl: "\x1b[32m", // green
};
const RESET = "\x1b[0m";

type Proc = {
  child: ChildProcess | null;
  running: boolean;
  pid: number | null;
  started_at: string | null;
  exited_at: string | null;
  exit_code: number | null;
  signal: string | null;
  busy: Promise<unknown> | null;
};

const procs: Record<ServiceName, Proc> = Object.fromEntries(
  SERVICES.map((s) => [
    s,
    { child: null, running: false, pid: null, started_at: null, exited_at: null, exit_code: null, signal: null, busy: null },
  ]),
) as Record<ServiceName, Proc>;

const isSvc = (s: string): s is ServiceName => (SERVICES as string[]).includes(s);

function logFile(svc: ServiceName) {
  return path.join(LOG_DIR, `${svc}.log`);
}

function appendLog(svc: ServiceName, line: string) {
  try {
    fs.appendFileSync(logFile(svc), `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* logging must never kill ctl */
  }
}

function ctlLog(text: string, svc?: ServiceName) {
  console.log(`${COLORS.ctl}[ctl]${RESET} ${text}`);
  if (svc) appendLog(svc, `[ctl] ${text}`);
}

/** Splits a stream into lines, echoes them with prefix and appends them to the svc log. */
function pipeLines(svc: ServiceName, stream: NodeJS.ReadableStream | null, isErr: boolean) {
  if (!stream) return;
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      emit(line);
    }
  });
  stream.on("end", () => {
    if (buf) emit(buf);
    buf = "";
  });
  function emit(line: string) {
    const prefix = `${COLORS[svc]}[${svc}]${RESET}`;
    (isErr ? process.stderr : process.stdout).write(`${prefix} ${line}\n`);
    appendLog(svc, isErr ? `[stderr] ${line}` : line);
  }
}

function statusOf(svc: ServiceName) {
  const p = procs[svc];
  return {
    running: p.running,
    pid: p.running ? p.pid : null,
    last_pid: p.pid,
    started_at: p.started_at,
    exited_at: p.exited_at,
    exit_code: p.exit_code,
    signal: p.signal,
  };
}

function allStatus() {
  return Object.fromEntries(SERVICES.map((s) => [s, statusOf(s)])) as Record<ServiceName, ReturnType<typeof statusOf>>;
}

async function healthOk(svc: ServiceName, timeoutMs = 1000): Promise<any | null> {
  try {
    const { status, data } = await rawJson(`${URLS[svc]}/health`, { method: "GET", timeoutMs });
    return status === 200 && data?.ok ? data : null;
  } catch {
    return null;
  }
}

/** Run one start/stop at a time per service. */
function serialize<T>(svc: ServiceName, fn: () => Promise<T>): Promise<T> {
  const prev = procs[svc].busy ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  procs[svc].busy = next.catch(() => undefined);
  return next;
}

async function doStart(svc: ServiceName) {
  const p = procs[svc];
  if (p.running) return { already: true };

  const foreign = await healthOk(svc, 500);
  if (foreign) {
    throw new Error(
      `port ${PORTS[svc]} already answers /health (pid ${foreign.pid}) but it is not managed by ctl — stop that process first`,
    );
  }

  const entry = path.join("src", svc, "server.ts");
  const child = spawn(process.execPath, ["--import", "tsx", entry], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
    windowsHide: true,
  });
  p.child = child;
  p.running = true;
  p.pid = child.pid ?? null;
  p.started_at = new Date().toISOString();
  p.exited_at = null;
  p.exit_code = null;
  p.signal = null;
  ctlLog(`spawned ${svc} pid=${p.pid} (${process.execPath} --import tsx ${entry})`, svc);

  pipeLines(svc, child.stdout, false);
  pipeLines(svc, child.stderr, true);
  child.on("error", (e) => ctlLog(`${svc} spawn error: ${e.message}`, svc));
  child.on("exit", (code, signal) => {
    if (p.child !== child) return;
    p.running = false;
    p.child = null;
    p.exited_at = new Date().toISOString();
    p.exit_code = code;
    p.signal = signal;
    ctlLog(`${svc} pid=${child.pid} EXITED code=${code} signal=${signal ?? "-"} (no auto-restart)`, svc);
  });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!p.running || p.child !== child) {
      throw new Error(`${svc} exited during startup (code=${p.exit_code}) — see logs/${svc}.log`);
    }
    const h = await healthOk(svc, 800);
    if (h) {
      ctlLog(`${svc} healthy pid=${h.pid}`, svc);
      return { already: false };
    }
    await sleep(200);
  }
  throw new Error(`${svc} did not report /health OK within ${START_TIMEOUT_MS}ms`);
}

function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => resolve());
    } else {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
      resolve();
    }
  });
}

async function doStop(svc: ServiceName) {
  const p = procs[svc];
  const child = p.child;
  if (!p.running || !child || !child.pid) return { already: true };
  ctlLog(`killing ${svc} pid=${child.pid} (${process.platform === "win32" ? "taskkill /T /F" : "SIGKILL"})`, svc);
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  await killTree(child.pid);
  await Promise.race([exited, sleep(STOP_TIMEOUT_MS)]);
  if (p.running && p.child === child) {
    // exit event never arrived — mark it dead anyway if the port is gone
    if (!(await healthOk(svc, 500))) {
      p.running = false;
      p.child = null;
      p.exited_at = new Date().toISOString();
    } else {
      throw new Error(`${svc} pid=${child.pid} still alive after kill`);
    }
  }
  return { already: false };
}

const startSvc = (svc: ServiceName) => serialize(svc, () => doStart(svc));
const stopSvc = (svc: ServiceName) => serialize(svc, () => doStop(svc));

// ---------------------------------------------------------------- HTTP
const app = express();
app.use(cors());
app.use(express.json());

app.get("/ctl/status", (_req, res) => {
  res.json(allStatus());
});

app.post("/ctl/:svc/start", async (req, res) => {
  const svc = String(req.params.svc);
  if (!isSvc(svc)) {
    res.status(404).json({ ok: false, error: `UNKNOWN_SERVICE ${svc}` });
    return;
  }
  try {
    const r = await startSvc(svc);
    res.json({ ok: true, service: svc, already: r.already, ...allStatus() });
  } catch (e: any) {
    ctlLog(`start ${svc} failed: ${e.message}`, svc);
    res.status(500).json({ ok: false, service: svc, error: e.message, ...allStatus() });
  }
});

app.post("/ctl/:svc/stop", async (req, res) => {
  const svc = String(req.params.svc);
  if (!isSvc(svc)) {
    res.status(404).json({ ok: false, error: `UNKNOWN_SERVICE ${svc}` });
    return;
  }
  try {
    const r = await stopSvc(svc);
    res.json({ ok: true, service: svc, already: r.already, ...allStatus() });
  } catch (e: any) {
    res.status(500).json({ ok: false, service: svc, error: e.message, ...allStatus() });
  }
});

app.post("/ctl/reset", async (_req, res) => {
  const results: Record<string, any> = {};
  let ok = true;
  // 1. start anything that is down (dependencies first)
  for (const svc of ["inventory", "payment", "order"] as ServiceName[]) {
    if (!procs[svc].running) {
      try {
        await startSvc(svc);
        results[`${svc}_start`] = "started";
      } catch (e: any) {
        ok = false;
        results[`${svc}_start`] = `FAILED: ${e.message}`;
      }
    }
  }
  // 2. clear faults + reset data on all 3 (order first so the resumer stops driving old sagas)
  for (const svc of ["order", "inventory", "payment"] as ServiceName[]) {
    const r: any = {};
    try {
      const f = await rawJson(`${URLS[svc]}/admin/faults`, { method: "DELETE", timeoutMs: 5000 });
      r.faults = f.status;
      const z = await rawJson(`${URLS[svc]}/admin/reset`, { method: "POST", body: {}, timeoutMs: 10000 });
      r.reset = z.status;
      if (f.status >= 300 || z.status >= 300) ok = false;
    } catch (e: any) {
      ok = false;
      r.error = e.message;
    }
    results[svc] = r;
  }
  ctlLog(`reset fixture ${ok ? "OK" : "WITH ERRORS"} ${JSON.stringify(results)}`);
  res.status(ok ? 200 : 500).json({ ok, results, status: allStatus() });
});

app.use("/", express.static(UI_DIR));

// ---------------------------------------------------------------- lifecycle
let shuttingDown = false;
function shutdown(reason: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  ctlLog(`shutting down (${reason}) — killing children`);
  for (const svc of SERVICES) {
    const c = procs[svc].child;
    if (!c?.pid) continue;
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(c.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(c.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGBREAK", () => shutdown("SIGBREAK"));
process.on("SIGHUP", () => shutdown("SIGHUP"));

const server = app.listen(PORTS.ctl, HOST, async () => {
  ctlLog(`listening on ${URLS.ctl}  (UI: ${URLS.ctl}/ , status: ${URLS.ctl}/ctl/status)`);
  // dependencies first, then the orchestrator (its startup resume calls them)
  const results = await Promise.allSettled([startSvc("inventory"), startSvc("payment")]);
  const o = await Promise.allSettled([startSvc("order")]);
  [...results, ...o].forEach((r, i) => {
    const svc = (["inventory", "payment", "order"] as const)[i];
    if (r.status === "rejected") ctlLog(`initial start of ${svc} FAILED: ${(r.reason as Error).message}`, svc);
  });
  ctlLog(`status ${JSON.stringify(allStatus())}`);
});
server.on("error", (e: any) => {
  console.error(`[ctl] cannot listen on ${HOST}:${PORTS.ctl}: ${e.message}`);
  process.exit(1);
});
