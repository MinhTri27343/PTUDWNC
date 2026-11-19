import { generateKeyPairSync } from 'node:crypto';

// Throw-away test key and fake secrets, set before any module reads config (dotenv never overrides these).
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
process.env.AS_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
process.env.LOG_SILENT = '1';
process.env.AS_URL = 'http://as.test';
process.env.TAXI_URL = 'http://taxi.test';
process.env.TAXI_WEB_SECRET = 'test-web-secret';
process.env.TAXI_M2M_SECRET = 'test-m2m-secret';
process.env.CODE_TTL_SECONDS = '60';
process.env.ACCESS_TTL_SECONDS = '120';
