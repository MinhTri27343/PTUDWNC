import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { seed } from './seed.js';
import { startCluster } from './cluster.js';
import { url } from '../src/common.js';

const quick = process.argv.includes('--quick');
const repetitions = quick ? 1 : 5;
const output = quick ? 'evidence/quick' : 'evidence/full';
mkdirSync(output,{recursive:true});
const directory = mkdtempSync(join(tmpdir(),'block02-measure-'));
const rows = [], traces = [], comparisons = [];
const browser_requests = new Map();
const normalize = value => JSON.parse(JSON.stringify(value), (k,v) => ['id','user_id','product_id'].includes(k) ? Number(v) : v);
const project = data => ({user:{orders:data.user.orders.map(o => ({id:o.id,status:o.status,product:o.product ? {name:o.product.name,thumbnail_url:o.product.thumbnail_url} : null}))}});
let browser, cluster, page;
const launch = async (variant, scenario = 'normal') => {
  if (cluster) await cluster.stop();
  cluster = await startCluster({DATA_DIR:directory,GRAPHQL_MODE:variant === 'naive' ? 'naive' : 'batched',PRODUCT_DELAY_MS:scenario === 'delay' ? '300' : scenario === 'timeout' ? '1500' : '0',PRODUCT_FAIL:scenario === 'error' ? '1' : '0',QUIET:'1'});
  await page.goto(url('web'));
  await page.waitForFunction(() => !!window.runDashboard);
};
async function run(variant,client,dataset,mode,scenario,record = true) {
  const run_id = `${variant}-${client}-${dataset}-${mode}-${scenario}-${crypto.randomUUID()}`;
  const result = await page.evaluate(options => window.runDashboard(options),{variant:variant === 'baseline' ? 'baseline' : 'graphql',client,run_id});
  assert.equal(browser_requests.get(run_id), result.metrics.client_requests, 'Browser network events must agree with instrumented client count');
  assert.equal(await page.locator('.order').count(), dataset === 'small' ? 5 : 100);
  // The final aborted Product request can still execute SQL after screen completion.
  if (scenario === 'timeout') await new Promise(r => setTimeout(r,650));
  if (!record) return result;
  const events = (await Promise.all(['user','order','product','graphql'].map(async service => (await fetch(url(service)+`/metrics?run_id=${run_id}`)).json()))).flat();
  const row = {run_id,variant,client,dataset,mode,scenario,client_requests:result.metrics.client_requests,payload_bytes:result.metrics.payload_bytes,screen_complete_ms:result.metrics.screen_complete_ms,result:result.metrics.result};
  for (const name of ['user','order','product']) {
    row[`${name}_calls`] = events.filter(e => e.kind === 'request' && e.service === name).length;
    row[`${name}_db_queries`] = events.filter(e => e.kind === 'db_query' && e.service === name).length;
  }
  row.notes = scenario === 'timeout' ? 'Includes SQL completed after caller timeout; waited 650ms.' : '';
  const n = dataset === 'small' ? 5 : 100;
  assert.equal(row.client_requests,variant === 'baseline' ? 2+n : 1);
  assert.equal(row.product_calls,variant === 'batched' ? 1 : n);
  assert.equal(row.product_db_queries,scenario === 'error' ? 0 : variant === 'batched' ? 1 : n);
  assert.equal(row.result,['error','timeout'].includes(scenario) ? 'partial' : 'ok');
  rows.push(row); traces.push({row,client:result.metrics,events});
  return result;
}
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function waterfall(trace) {
  const client = trace.client;
  const spans = [...client.spans.map(s => ({...s,label:`browser → ${s.service} ${s.path}`})), ...trace.events.filter(e => e.kind === 'call').map(e => ({label:`GraphQL → ${e.target} ${e.path}`,start_ms:e.start_ms-client.start_epoch_ms,end_ms:e.end_ms-client.start_epoch_ms}))];
  const max = Math.max(client.screen_complete_ms,...spans.map(s => s.end_ms));
  const scale = 800 / max, height = 90 + spans.length*23;
  const bars = spans.map((s,i) => `<text x="12" y="${59+i*23}" font-size="11">${escape(s.label)}</text><rect x="${360+Math.max(0,s.start_ms)*scale}" y="${47+i*23}" width="${Math.max(2,(s.end_ms-s.start_ms)*scale)}" height="15" fill="#167c78"/>`).join('');
  const mark = 360 + client.screen_complete_ms*scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}"><rect width="100%" height="100%" fill="white"/><text x="12" y="22" font-size="16">${escape(trace.row.variant)} / ${trace.row.client} / ${trace.row.dataset} / ${trace.row.mode}</text>${bars}<line x1="${mark}" x2="${mark}" y1="35" y2="${height-25}" stroke="#c23434"/><text x="360" y="${height-8}" font-size="12">screen_complete ${client.screen_complete_ms.toFixed(2)} ms (red); scale 0–${max.toFixed(2)} ms</text></svg>`;
}
function save() {
  writeFileSync(`${output}/measurements.json`,JSON.stringify(rows,null,2));
  writeFileSync(`${output}/traces.json`,JSON.stringify(traces,null,2));
  writeFileSync(`${output}/comparisons.json`,JSON.stringify(comparisons,null,2));
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  writeFileSync(`${output}/measurements.csv`,[keys.join(','),...rows.map(r => keys.map(k => JSON.stringify(r[k])).join(','))].join('\n'));
  const groups = Map.groupBy(rows,r => [r.variant,r.client,r.dataset,r.mode,r.scenario].join('/'));
  const median = values => { const a = [...values].sort((a,b)=>a-b); return a.length%2 ? a[Math.floor(a.length/2)] : (a[a.length/2-1]+a[a.length/2])/2; };
  const summary = ['# Actual browser measurements','',`Generated ${new Date().toISOString()}; ${rows.length} measured runs; ${repetitions} repetitions per cell. Browser: installed Chrome, headless. Node: ${process.version}; OS: ${process.platform}/${process.arch}.`,'','| Variant/client/dataset/mode/scenario | n | Client req | Product calls/SQL | Median ms | Min–max ms | Median bytes |','|---|---:|---:|---:|---:|---:|---:|'];
  for (const [key,group] of groups) {
    const values = group.map(r=>r.screen_complete_ms);
    summary.push(`| ${key} | ${group.length} | ${group[0].client_requests} | ${group[0].product_calls}/${group[0].product_db_queries} | ${median(values).toFixed(2)} | ${Math.min(...values).toFixed(2)}–${Math.max(...values).toFixed(2)} | ${median(group.map(r=>r.payload_bytes))} |`);
  }
  summary.push('','Counts exclude preflight/assets/health/metrics. Payload is uncompressed response-body UTF-8 bytes, not wire traffic. Cold restarts all service processes and the web process but retains OS/browser caches. Warm has one unrecorded warm-up per cell. Screen completion is measured after two animation frames, excluding image loading. Fault runs use small/warm; timed-out service SQL may finish after the screen marker. REST baseline is deliberately sequential and does not dedup. These results do not prove GraphQL is always faster than REST.','',`Data equivalence checks: ${comparisons.length}, all passed if this script completed successfully.`);
  writeFileSync(`${output}/summary.md`,summary.join('\n'));
  for (const variant of ['baseline','naive','batched']) {
    const trace = traces.find(t=>t.row.variant === variant && t.row.client === 'web' && t.row.dataset === 'small' && t.row.scenario === 'normal');
    if (trace) writeFileSync(`${output}/waterfall-${variant}.svg`,waterfall(trace));
  }
}
try {
  browser = await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'chrome',headless:true});
  page = await browser.newPage();
  page.on('request', request => {
    const run_id = request.headers()['x-run-id'];
    if (run_id && request.method() !== 'OPTIONS') browser_requests.set(run_id,(browser_requests.get(run_id) || 0) + 1);
  });
  for (const dataset of ['small','large']) {
    seed(dataset,directory);
    const reference = {};
    for (const variant of ['baseline','naive','batched']) for (const client of ['web','mobile']) for (const mode of ['cold','warm']) {
      if (mode === 'warm') { await launch(variant); await run(variant,client,dataset,mode,'normal',false); }
      for (let index=0;index<repetitions;index++) {
        if (mode === 'cold') await launch(variant);
        const result = await run(variant,client,dataset,mode,'normal');
        const data = normalize(client === 'mobile' && variant === 'baseline' ? project(result.data) : result.data);
        if (!reference[client]) reference[client] = data;
        assert.deepEqual(data,reference[client]);
        comparisons.push({run_id:result.metrics.run_id,passed:true});
      }
      save(); console.log(`Measured ${dataset}/${variant}/${client}/${mode}`);
    }
  }
  seed('small',directory);
  for (const scenario of ['delay','timeout','error']) for (const variant of ['baseline','naive','batched']) for (const client of ['web','mobile']) {
    await launch(variant,scenario); await run(variant,client,'small','warm',scenario,false);
    for (let index=0;index<repetitions;index++) {
      const result = await run(variant,client,'small','warm',scenario);
      assert.equal(result.data.user.orders.length,5);
      if (scenario !== 'delay') assert.ok(result.data.user.orders.every(o=>o.product === null));
      if (client === 'web') assert.equal(result.data.user.orders[0].total_cents,1250);
    }
    save(); console.log(`Measured ${scenario}/${variant}/${client}`);
  }
  await page.screenshot({path:`${output}/dashboard-error.png`,fullPage:true});
  await launch('batched');
  await run('batched','web','small','warm','normal',false);
  await page.screenshot({path:`${output}/dashboard.png`,fullPage:true});
  await run('batched','mobile','small','warm','normal',false);
  await page.screenshot({path:`${output}/mobile.png`,fullPage:true});
  console.log(`Complete: ${rows.length} runs saved to ${output}`);
} finally {
  save(); if (cluster) await cluster.stop(); if (browser) await browser.close();
  rmSync(directory,{recursive:true,force:true});
}
