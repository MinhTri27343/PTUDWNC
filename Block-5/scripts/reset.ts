import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../src/db.js';

const dataDir = path.join(ROOT, 'data');
if (fs.existsSync(dataDir)) {
  for (const f of fs.readdirSync(dataDir)) {
    if (/\.db(-wal|-shm)?$/.test(f)) fs.rmSync(path.join(dataDir, f));
  }
}

const result = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'scripts', 'seed.ts')], {
  stdio: 'inherit',
  cwd: ROOT,
});
process.exit(result.status ?? 1);
