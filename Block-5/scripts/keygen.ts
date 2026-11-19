import { generateKeyPairSync, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/db.js';

const envPath = path.join(ROOT, '.env');
const force = process.argv.includes('--force');

if (fs.existsSync(envPath) && !force) {
  console.error('.env already exists. Re-run with --force to overwrite (this rotates the signing key and secrets).');
  process.exit(1);
}

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim();

const secret = () => randomBytes(24).toString('base64url');

const template = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
const values: Record<string, string> = {
  AS_PRIVATE_KEY_PEM: `"${pem.replace(/\n/g, '\\n')}"`,
  TAXI_WEB_SECRET: secret(),
  TAXI_M2M_SECRET: secret(),
  TAXI_SESSION_SECRET: secret(),
};

const out = template
  .split('\n')
  .map((line) => {
    const key = line.split('=')[0];
    return key in values ? `${key}=${values[key]}` : line;
  })
  .join('\n');

fs.writeFileSync(envPath, out);
console.log('Wrote .env with a fresh ES256 key and lab client secrets (never commit this file).');
console.log('Next: npm run db:reset');
