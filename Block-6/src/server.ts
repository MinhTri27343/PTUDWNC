import { createApp } from './app.js';
import { createStores } from './db.js';
import { persistentSecret } from './auth.js';
const stores = createStores();
const lab = createApp({ stores, secret: persistentSecret() });
const port = Number(process.env.PORT ?? 4006);
const server = lab.app.listen(port, '127.0.0.1', () => console.log(`Block-6 lab: http://localhost:${port} — Starter/V1 cố ý chưa an toàn, chỉ demo localhost.`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => { lab.close(); process.exit(0); }));
