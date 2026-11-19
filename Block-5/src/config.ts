import 'dotenv/config';

const num = (key: string, fallback: number): number => {
  const raw = process.env[key];
  return raw === undefined || raw === '' ? fallback : Number(raw);
};

const str = (key: string, fallback = ''): string => process.env[key] || fallback;

export const config = {
  asUrl: str('AS_URL', 'http://localhost:4000'),
  apiUrl: str('API_URL', 'http://localhost:4001'),
  taxiUrl: str('TAXI_URL', 'http://localhost:4002'),

  asPort: num('AS_PORT', 4000),
  apiPort: num('API_PORT', 4001),
  taxiPort: num('TAXI_PORT', 4002),

  /** Flow UI: the independent visualizer app (not part of any of the three services). */
  flowUrl: str('FLOW_URL', 'http://localhost:4003'),
  flowPort: num('FLOW_PORT', 4003),

  /** PKCS8 PEM; newlines may be stored escaped as \n in .env */
  privateKeyPem: str('AS_PRIVATE_KEY_PEM').replace(/\\n/g, '\n'),

  codeTtl: num('CODE_TTL_SECONDS', 60),
  accessTtl: num('ACCESS_TTL_SECONDS', 120),
  refreshTtl: num('REFRESH_TTL_SECONDS', 7 * 24 * 3600),

  taxiWebSecret: str('TAXI_WEB_SECRET'),
  taxiM2mSecret: str('TAXI_M2M_SECRET'),
  taxiSessionSecret: str('TAXI_SESSION_SECRET', 'dev-only-session-secret'),

  audience: 'wallet-api',
} as const;

export function requireConfig(...keys: (keyof typeof config)[]): void {
  const missing = keys.filter((k) => !config[k]);
  if (missing.length > 0) {
    throw new Error(`Missing config: ${missing.join(', ')}. Run "npm run keygen" first.`);
  }
}
