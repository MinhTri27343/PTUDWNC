import { startCluster } from './cluster.js';
const cluster = await startCluster();
console.log('Dashboard: http://127.0.0.1:4100');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await cluster.stop(); process.exit(); });
