import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { seed } from '../scripts/seed.js';
import { startCluster } from '../scripts/cluster.js';
import { url } from '../src/common.js';
import { queries } from '../public/queries.js';

const directory = mkdtempSync(join(tmpdir(), 'block02-test-'));
const normalize = value => JSON.parse(JSON.stringify(value), (key, v) => ['id','user_id','product_id'].includes(key) ? Number(v) : v);
async function get(service, path, run_id) {
  const response = await fetch(url(service) + path, { headers: { 'X-Run-Id': run_id } });
  return { status: response.status, body: await response.json() };
}
async function gql(query, user_id = '1', run_id = crypto.randomUUID()) {
  const response = await fetch(url('graphql') + '/graphql', { method:'POST', headers:{'Content-Type':'application/json','X-Run-Id':run_id}, body:JSON.stringify({query,variables:{user_id}}) });
  return response.json();
}
test('REST, GraphQL equivalence, batching and faults', async t => {
  try {
    for (const dataset of ['small','large']) {
      seed(dataset, directory);
      const n = dataset === 'small' ? 5 : 100;
      for (const mode of ['naive','batched']) {
        const cluster = await startCluster({DATA_DIR:directory,GRAPHQL_MODE:mode,PRODUCT_FAIL:'0',PRODUCT_DELAY_MS:'0',QUIET:'1'});
        try {
          await t.test(`${dataset}/${mode}: equality, counts, mobile projection and request cache scope`, async () => {
            const user = (await get('user','/users/1','baseline')).body;
            const orders = (await get('order','/orders?user_id=1','baseline')).body;
            for (const order of orders) order.product = (await get('product',`/products/${order.product_id}`,'baseline')).body;
            assert.equal(orders.length, n);
            const expected = {user:{...user,orders}};
            for (const client of ['web','mobile']) {
              const run_id = `${dataset}-${mode}-${client}`;
              const result = await gql(queries[client],'1',run_id);
              assert.equal(result.errors, undefined);
              if (client === 'web') assert.deepEqual(normalize(result.data), expected);
              else assert.deepEqual(normalize(result.data), {user:{orders:orders.map(o => ({id:o.id,status:o.status,product:{name:o.product.name,thumbnail_url:o.product.thumbnail_url}}))}});
              const events = (await get('product',`/metrics?run_id=${run_id}`)).body;
              assert.equal(events.filter(e => e.kind === 'request').length, mode === 'naive' ? n : 1);
              assert.equal(events.filter(e => e.kind === 'db_query').length, mode === 'naive' ? n : 1);
            }
            const second = `${dataset}-${mode}-second`;
            await gql(queries.web,'1',second);
            assert.equal((await get('product',`/metrics?run_id=${second}`)).body.filter(e => e.kind === 'db_query').length, mode === 'naive' ? n : 1);
            assert.deepEqual((await gql(queries.web,'2')).data.user.orders, []);
            assert.equal((await get('user','/users/0')).status,400);
            assert.equal((await get('user','/users/999')).status,404);
            assert.equal((await get('order','/orders?user_id=abc')).status,400);
            assert.equal((await get('product','/products?ids=1,no')).status,400);
            assert.equal((await get('product','/products/999')).status,404);
            const batch = (await get('product','/products?ids=1,2,1,999')).body;
            assert.deepEqual(batch.map(p => p.id),[2,1]);
            const invalid = await gql(queries.web,'abc');
            assert.ok(invalid.errors);
            const missingUser = await gql(queries.web,'999');
            assert.equal(missingUser.data.user,null);
            assert.equal(missingUser.errors[0].extensions.code,'USER_UNAVAILABLE');
          });
          if (mode === 'batched') await t.test(`${dataset}: missing product and stored total_cents`, async () => {
            const db = new DatabaseSync(join(directory,'products.sqlite'));
            db.prepare('UPDATE products SET price_cents = price_cents + 100 WHERE id = 1').run();
            const result = await gql(queries.web);
            assert.equal(result.data.user.orders[0].total_cents,1250);
            assert.equal(result.data.user.orders[0].product.price_cents,1350);
            db.prepare('DELETE FROM products WHERE id = 1').run(); db.close();
            const missing = await gql(queries.web);
            assert.equal(missing.data.user.orders[0].product,null);
            assert.equal(missing.data.user.orders[1].product.name,'Product 2');
            assert.ok(missing.errors.every(e => e.extensions.code === 'PRODUCT_NOT_FOUND' && e.path.at(-1) === 'product'));
          });
        } finally { await cluster.stop(); }
      }
    }
    seed('small',directory);
    for (const mode of ['naive','batched']) for (const scenario of ['delay','timeout','error']) {
      const cluster = await startCluster({DATA_DIR:directory,GRAPHQL_MODE:mode,PRODUCT_DELAY_MS:scenario === 'delay' ? '300' : scenario === 'timeout' ? '1500' : '0',PRODUCT_FAIL:scenario === 'error' ? '1' : '0',QUIET:'1'});
      try {
        await t.test(`${mode}/${scenario}: GraphQL policy`, async () => {
          const run_id = `${mode}-${scenario}`;
          const result = await gql(queries.web,'1',run_id);
          assert.equal(result.data.user.orders.length,5);
          assert.equal(result.data.user.orders[0].total_cents,1250);
          if (scenario === 'delay') assert.equal(result.errors,undefined);
          else {
            assert.ok(result.data.user.orders.every(o => o.product === null));
            assert.equal(result.errors.length,5);
            assert.ok(result.errors.every(e => e.extensions.code === 'PRODUCT_UNAVAILABLE'));
          }
          if (scenario === 'timeout') await new Promise(r => setTimeout(r,650));
          const events = (await get('product',`/metrics?run_id=${run_id}`)).body;
          assert.equal(events.filter(e => e.kind === 'db_query').length,scenario === 'error' ? 0 : mode === 'naive' ? 5 : 1);
        });
      } finally { await cluster.stop(); }
    }
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
