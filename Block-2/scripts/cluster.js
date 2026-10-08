import { spawn } from 'node:child_process';
import { url } from '../src/common.js';
export async function startCluster(options = {}) {
  const children = [];
  const env = { ...process.env, ...options, GRAPHQL_MODE: options.GRAPHQL_MODE || process.env.GRAPHQL_MODE || 'batched' };
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await Promise.all(children.map(child => new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve); child.kill();
    })));
  };
  try {
    for (const name of ['user', 'order', 'product', 'graphql', 'web']) {
      // Refuse to measure a stale/foreign server on the chosen ports.
      try { await fetch(url(name) + '/health', { signal: AbortSignal.timeout(150) }); throw new Error(`Port for ${name} already occupied`); }
      catch (error) { if (error.message.includes('occupied')) throw error; }
      const child = spawn(process.execPath, [name === 'graphql' ? 'src/graphql.js' : name === 'web' ? 'src/web.js' : 'src/rest.js', ...( ['user', 'order', 'product'].includes(name) ? [name] : [])], { env, stdio: options.QUIET ? 'ignore' : 'inherit', windowsHide: true });
      children.push(child);
      child.on('error', error => console.error(error));
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error(`${name} exited with ${child.exitCode}`);
        try { if ((await fetch(url(name) + '/health')).ok) { ready = true; break; } } catch {}
        await new Promise(r => setTimeout(r, 50));
      }
      if (!ready) throw new Error(`${name} did not start`);
    }
    return { stop };
  } catch (error) { await stop(); throw error; }
}
