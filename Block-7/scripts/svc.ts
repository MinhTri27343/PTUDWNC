/**
 * npm run svc -- <start|stop|kill|status> [order|inventory|payment|all]
 * Thin CLI over ctl (:3000). `kill` = `stop` (real process kill).
 */
import { SERVICES, type ServiceName } from "../src/shared/config.js";
import { CtlUnavailableError, ctl, type CtlStatus } from "./lib.js";

const [actionRaw, targetRaw = "all"] = process.argv.slice(2);
const action = (actionRaw ?? "").toLowerCase();
const target = targetRaw.toLowerCase();

function usage(): never {
  console.error("usage: npm run svc -- <start|stop|kill|status> [order|inventory|payment|all]");
  process.exit(2);
}

if (!["start", "stop", "kill", "status"].includes(action)) usage();
if (target !== "all" && !(SERVICES as string[]).includes(target)) usage();
const targets: ServiceName[] = target === "all" ? (action === "start" ? ["inventory", "payment", "order"] : [...SERVICES]) : [target as ServiceName];

function print(st: CtlStatus) {
  console.log("service     running  pid      started_at                exit_code");
  for (const s of SERVICES) {
    const x = st[s];
    console.log(
      `${s.padEnd(11)} ${String(x?.running).padEnd(8)} ${String(x?.pid ?? "-").padEnd(8)} ${String(x?.started_at ?? "-").padEnd(25)} ${x?.exit_code ?? "-"}`,
    );
  }
}

try {
  if (action !== "status") {
    for (const svc of targets) {
      const r = action === "start" ? await ctl.start(svc) : await ctl.stop(svc);
      console.log(`${action} ${svc}: ${r.already ? "(already " + (action === "start" ? "running" : "stopped") + ")" : "done"}`);
    }
  }
  print(await ctl.status());
} catch (e: any) {
  console.error(e instanceof CtlUnavailableError ? e.message : `error: ${e.message}`);
  process.exit(1);
}
