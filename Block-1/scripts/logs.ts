// Xem và tìm log trong logs/app.log.
//   npm run logs                          50 dòng cuối
//   npm run logs -- <request_id>          mọi dòng của một request (khớp một phần cũng được)
//   npm run logs -- --status 400          chỉ response có status 400
//   npm run logs -- --level warn          từ mức warn trở lên (warn, error, fatal)
//   npm run logs -- --limit 200 --raw     200 dòng cuối, in JSON thô
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { config } from '../src/config';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    status: { type: 'string' },
    level: { type: 'string' },
    limit: { type: 'string', default: '50' },
    file: { type: 'string' },
    raw: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`Dùng: npm run logs -- [request_id] [--status 400] [--level warn] [--limit 50] [--raw] [--file đường_dẫn]`);
  process.exit(0);
}

const LEVELS: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
const NAMES: Record<number, string> = { 10: 'TRACE', 20: 'DEBUG', 30: 'INFO', 40: 'WARN', 50: 'ERROR', 60: 'FATAL' };
const COLORS: Record<number, string> = { 30: '\x1b[32m', 40: '\x1b[33m', 50: '\x1b[31m', 60: '\x1b[41m' };
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const useColor = process.stdout.isTTY;
const paint = (code: string, s: string) => (useColor ? `${code}${s}${RESET}` : s);

const file = values.file ?? config.logFile;
if (!fs.existsSync(file)) {
  console.error(`Chưa có file log: ${file}\nChạy server (npm run dev) và gọi vài request để tạo log.`);
  process.exit(1);
}

let minLevel = 0;
if (values.level) {
  minLevel = LEVELS[values.level.toLowerCase()] ?? NaN;
  if (Number.isNaN(minLevel)) {
    console.error(`--level không hợp lệ: ${values.level} (trace, debug, info, warn, error, fatal)`);
    process.exit(1);
  }
}
const status = values.status ? Number(values.status) : undefined;
const requestId = positionals[0]?.toLowerCase();
const limit = Math.max(1, Number(values.limit) || 50);

type Entry = Record<string, any>;
const entries: { raw: string; e: Entry }[] = [];
for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!raw.trim()) continue;
  try {
    entries.push({ raw, e: JSON.parse(raw) });
  } catch {
    // dòng không phải JSON (ví dụ bị cắt dở) — bỏ qua
  }
}

const matched = entries.filter(({ e }) => {
  if (e.level < minLevel) return false;
  if (status !== undefined && e.res?.statusCode !== status) return false;
  if (requestId && !String(e.req?.id ?? '').toLowerCase().includes(requestId)) return false;
  return true;
});

const shown = matched.slice(-limit);

function format(e: Entry): string {
  const time = new Date(e.time).toLocaleTimeString('vi-VN', { hour12: false });
  const level = paint(COLORS[e.level] ?? '', (NAMES[e.level] ?? String(e.level)).padEnd(5));
  const parts = [paint(DIM, time), level];
  if (e.req) {
    parts.push(`${e.req.method} ${e.req.url}`);
    if (e.res?.statusCode) parts.push(String(e.res.statusCode));
    if (e.responseTime !== undefined) parts.push(`${e.responseTime}ms`);
    parts.push(paint(DIM, `id=${e.req.id}`));
  }
  if (e.code) parts.push(`code=${e.code}`);
  if (e.details) parts.push(`details=${JSON.stringify(e.details)}`);
  if (e.err?.message) parts.push(`err="${e.err.message}"`);
  if (e.msg && !['request completed', 'request errored'].includes(e.msg)) parts.push(`— ${e.msg}`);
  return parts.join('  ');
}

for (const { raw, e } of shown) console.log(values.raw ? raw : format(e));

const hidden = matched.length - shown.length;
console.error(
  paint(DIM, `\n${shown.length} dòng${hidden > 0 ? ` (còn ${hidden} dòng cũ hơn, dùng --limit để xem thêm)` : ''} · ${file}`),
);
