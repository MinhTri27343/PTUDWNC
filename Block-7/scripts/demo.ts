/**
 * npm run demo -- F4 | F5 | F6 | H0 | F1 | F2 | F3 | all
 * Runs scenarios against the REAL processes managed by ctl (kill/start through ctl) and writes evidence/<code>.md.
 * `all` runs H0–F3 (-> evidence/H0-F3.md) then F4, F5, F6. Exit code 1 if any oracle check fails.
 */
import fs from "node:fs";
import path from "node:path";
import { CODES, EVIDENCE_DIR, ensureCtl, runScenario, type Code, type ScenarioResult, type Snapshot } from "./lib.js";

const arg = (process.argv[2] ?? "").toUpperCase();
if (!arg || (arg !== "ALL" && !(CODES as string[]).includes(arg))) {
  console.error("usage: npm run demo -- F4|F5|F6|H0|F1|F2|F3|all");
  process.exit(2);
}

// ------------------------------------------------------------------ markdown
const esc = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
};

function table(rows: any[], cols: string[]): string {
  if (!rows?.length) return "_(empty)_\n";
  const head = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |\n`;
  return head + rows.map((r) => `| ${cols.map((c) => esc(r[c])).join(" | ")} |`).join("\n") + "\n";
}

function snapshotMd(label: string, s: Snapshot): string {
  let md = `### Snapshot: ${label}\n\n_taken at ${s.at}_\n\n`;
  if (s.ctl) {
    md += "**Processes (ctl)**\n\n";
    md += table(
      Object.entries(s.ctl).map(([svc, st]) => ({ svc, ...st })),
      ["svc", "running", "pid", "started_at", "exit_code"],
    );
    md += "\n";
  }
  md += "#### Order store (data/order.db via Order API)\n\n";
  if (s.order.ok) {
    md += table(s.order.data.orders, ["order_id", "saga_id", "account_id", "item_id", "quantity", "amount", "status", "updated_at"]);
    const g = s.order.data.saga;
    if (g) {
      md += "\n**Saga record**\n\n";
      md += table(
        [{ saga_id: g.saga_id, phase: g.phase, pending: g.pending, intent: g.intent, reservation_id: g.reservation_id, charge_id: g.charge_id, refund_id: g.refund_id, last_error: g.last_error }],
        ["saga_id", "phase", "pending", "intent", "reservation_id", "charge_id", "refund_id", "last_error"],
      );
      md += `\nop_ids: \`${JSON.stringify(g.op_ids)}\`\n\n**Saga events**\n\n`;
      md += table(g.events ?? [], ["id", "at", "phase", "kind", "step", "op_id", "detail"]);
    }
  } else md += `> **UNAVAILABLE** — Order process is down, its DB can only be read through its API (${s.order.error}).\n`;
  md += "\n#### Inventory store (data/inventory.db via Inventory API)\n\n";
  if (s.inventory.ok) {
    md += "**Items**\n\n" + table(s.inventory.data.items, ["item_id", "name", "price", "available", "reserved", "initial"]);
    md += "\n**Reservations**\n\n" + table(s.inventory.data.reservations, ["reservation_id", "order_id", "item_id", "quantity", "amount", "status", "reserve_op_id", "release_op_id"]);
    md += "\n**Movements**\n\n" + table(s.inventory.data.movements, ["movement_id", "order_id", "reservation_id", "op_id", "type", "item_id", "quantity", "available_after", "created_at"]);
  } else md += `> **UNAVAILABLE** (${s.inventory.error})\n`;
  md += "\n#### Payment store (data/payment.db via Payment API)\n\n";
  if (s.payment.ok) {
    md += "**Accounts**\n\n" + table(s.payment.data.accounts, ["account_id", "name", "balance", "initial"]);
    const l = s.payment.data.ledger;
    md += "\n**Ledger**\n\n" + table(l.entries, ["entry_id", "type", "charge_id", "refund_id", "order_id", "account_id", "amount", "op_id", "created_at"]);
    md += `\ntotal_charged=${l.total_charged}, total_refunded=${l.total_refunded}, net=${l.net}\n`;
  } else md += `> **UNAVAILABLE** — Payment process is down (${s.payment.error}).\n`;
  return md + "\n";
}

function resultMd(r: ScenarioResult, full: boolean): string {
  let md = `## ${r.code} — ${r.title}\n\n**Result: ${r.pass ? "PASS" : "FAIL"}**${r.error ? ` (error: ${esc(r.error)})` : ""}\n\n`;
  md += `- order_id: \`${r.order_id ?? "-"}\`, saga_id: \`${r.saga_id ?? "-"}\`, Idempotency-Key: \`${r.idempotency_key ?? "-"}\`\n`;
  md += `- started ${r.started_at}, finished ${r.finished_at}\n\n`;
  md += "### Timeline (commands and observations)\n\n" + table(r.timeline, ["at", "what"]) + "\n";
  md += "### Oracle checks (CONTRACT §7)\n\n" + table(r.checks.map((c) => ({ result: c.ok ? "PASS" : "FAIL", check: c.name, detail: c.detail })), ["result", "check", "detail"]) + "\n";
  md += "### op_ids\n\n```\nbefore: " + JSON.stringify(r.op_ids_before) + "\nafter:  " + JSON.stringify(r.op_ids_after) + "\n```\n\n";
  md += "### [FAULT-MARKER] lines (logs/*.log since scenario start)\n\n```\n" + (r.markers.length ? r.markers.join("\n") : "(none)") + "\n```\n\n";
  const peek = (r as any).order_db_peek;
  if (peek) md += "### Read-only peek of data/order.db while Order was dead (evidence only)\n\n```json\n" + JSON.stringify(peek, null, 2) + "\n```\n\n";
  if (r.notes.length) md += "### Notes\n\n" + r.notes.map((n) => `- ${n}`).join("\n") + "\n\n";
  const snaps = full ? r.snapshots : r.snapshots.slice(-1);
  for (const s of snaps) md += snapshotMd(s.label, s.snap);
  return md;
}

function write(name: string, content: string) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const f = path.join(EVIDENCE_DIR, name);
  fs.writeFileSync(f, content);
  console.log(`  evidence -> ${path.relative(process.cwd(), f)}`);
}

function header(title: string) {
  return `# ${title}\n\nGenerated by \`npm run demo -- ${arg.toLowerCase() === "all" ? "all" : arg}\` at ${new Date().toISOString()} (real processes via ctl :3000).\n\n`;
}

function summary(r: ScenarioResult) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.code}  ${r.title}`);
  for (const c of r.checks.filter((c) => !c.ok)) console.log(`      FAIL ${c.name}  ${c.detail ?? ""}`);
}

// ------------------------------------------------------------------ main
const stopCtl = await ensureCtl({ verbose: false });
const results: ScenarioResult[] = [];
try {
  const quick: Code[] = ["H0", "F1", "F2", "F3"];
  const heavy: Code[] = ["F4", "F5", "F6"];
  const todo: Code[] = arg === "ALL" ? [...quick, ...heavy] : [arg as Code];

  const quickResults: ScenarioResult[] = [];
  for (const code of todo) {
    console.log(`\n=== ${code} ${"=".repeat(60)}`);
    const r = await runScenario(code, { log: true });
    results.push(r);
    summary(r);
    if (arg === "ALL" && quick.includes(code)) quickResults.push(r);
    else write(`${code}.md`, header(`Evidence ${code}`) + resultMd(r, true));
  }
  if (quickResults.length) {
    let md = header("Evidence H0–F3");
    md += table(quickResults.map((r) => ({ code: r.code, result: r.pass ? "PASS" : "FAIL", title: r.title, order_id: r.order_id })), ["code", "result", "title", "order_id"]) + "\n";
    for (const r of quickResults) md += resultMd(r, false);
    write("H0-F3.md", md);
  }
} finally {
  await stopCtl();
}

console.log("\n=== SUMMARY");
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.code}`);
const failed = results.filter((r) => !r.pass);
process.exit(failed.length ? 1 : 0);
