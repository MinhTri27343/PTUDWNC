import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

/** PKCE S256 transform: BASE64URL(SHA-256(ASCII(value))) — RFC 7636 §4.2 */
export const sha256B64Url = (value: string): string =>
  createHash('sha256').update(value).digest('base64url');

export const nowSec = (): number => Math.floor(Date.now() / 1000);

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Non-reversible label for logs/evidence so secrets never appear in full. */
export const fingerprint = (secret: string): string => `tok:${sha256Hex(secret).slice(0, 8)}`;

export const iso = (epochSec: number): string => new Date(epochSec * 1000).toISOString();

export function log(component: string, event: string, data: Record<string, unknown> = {}): void {
  if (process.env.LOG_SILENT) return;
  console.log(JSON.stringify({ ts: new Date().toISOString(), component, event, ...data }));
}

export const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
