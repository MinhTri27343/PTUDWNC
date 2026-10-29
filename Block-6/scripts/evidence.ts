import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fixture } from '../tests/helpers.js';
import { ORACLE } from '../tests/oracle.js';
import { ROOT } from '../src/db.js';
import { VERSIONS } from '../src/types.js';
const out = path.join(ROOT, 'evidence');
mkdirSync(out, {recursive:true});
const save = (name: string, text: string) => writeFileSync(path.join(out,name), text.replace(/\u001b\[[0-9;]*m/g, '').trimEnd() + '\n');
const env: NodeJS.ProcessEnv = {...process.env, NO_COLOR:'1'};
delete env.FORCE_COLOR;
delete env.TEST_VERSION;
function tests(name: string, args: string[], version?: string) {
  const run=spawnSync(process.execPath,[path.join(ROOT,'node_modules/vitest/vitest.mjs'),'run',...args],{
    cwd:ROOT,env:{...env,...(version?{TEST_VERSION:version}:{})},encoding:'utf8',timeout:120000,
  });
  if(run.error) throw run.error;
  const text=`$ ${version?`TEST_VERSION=${version} `:''}vitest run ${args.join(' ')}\nExit code: ${run.status}\n\n${run.stdout}\n${run.stderr}`;
  save(name,text);
  if(run.status!==(version==='starter'?1:0)) throw new Error(`Unexpected test result for ${name}; see evidence.`);
  if(version==='starter' && !run.stdout.includes('Alice đọc B1 phải bị chặn')) throw new Error('Baseline must fail the IDOR assertion specifically.');
}
tests('idor-before.txt',['tests/idor.test.ts','--reporter=verbose'],'starter');
tests('idor-after.txt',['tests/idor.test.ts','--reporter=verbose'],'v4');
tests('test-results.txt',['--reporter=verbose']);
const lab=fixture();
try {
  const records=[];
  for(const version of ['starter','v1','v4'] as const) {
    const r=await lab.send(version,'GET','/tasks/B1','alice');
    records.push(`GET /api/${version}/tasks/B1\nAuthorization: Bearer <token đã che>\nSubject: alice\n\nHTTP ${r.status}\n${JSON.stringify(r.body,null,2)}`);
  }
  save('idor-http.txt',records.join('\n\n'+'='.repeat(60)+'\n\n')+'\n');
} finally {lab.close();}
const table=['# HTTP oracle — request thật đến các phiên bản', '',
  'Các mã ở Starter/V1/V2/V3 phản ánh giới hạn cố ý của từng giai đoạn. Cột Đích là kết quả yêu cầu ở V4.', '',
  '| Tình huống | Starter | V1 | V2 | V3 | V4 | Đích |','|---|---|---|---|---|---|---|'];
for(const scenario of ORACLE) {
  const instance=fixture();
  try {
    const cells=[];
    for(const version of VERSIONS) {
      scenario.setup?.(instance.stores[version]);
      const r=await instance.send(version,scenario.method,scenario.path,scenario.user,scenario.body,scenario.headers);
      if(r.status!==scenario.expected[version]) throw new Error(`Oracle mismatch: ${version}/${scenario.name}`);
      cells.push(r.status);
    }
    table.push(`| ${scenario.name} | ${cells.join(' | ')} | ${scenario.expected.v4} |`);
  } finally {instance.close();}
}
save('oracle.md',table.join('\n')+'\n');
const diff=spawnSync('git',['diff','--no-index','--','src/starter-policy.ts','src/authorization.ts'],{cwd:ROOT,encoding:'utf8'});
if(diff.status!==1) throw new Error('Could not generate actual source diff');
save('authorization.diff',diff.stdout);
console.log('Đã tạo evidence/: IDOR HTTP, test đỏ/xanh, toàn bộ test, oracle 17 tình huống và diff chính sách thực tế. Token đã được che; dữ liệu demo không bị thay đổi.');
