import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixture, type Lab } from './helpers.js';
import type { Version } from '../src/types.js';
const version = (process.env.TEST_VERSION ?? 'v4') as Version;
describe(`IDOR regression — ${version}`, () => {
  let lab: Lab;
  beforeEach(()=>{lab=fixture();}); afterEach(()=>lab.close());
  it('Alice đọc B1 phải bị chặn và không lộ nội dung task',async()=>{
    const result=await lab.send(version,'GET','/tasks/B1','alice');
    expect(result.status).toBe(403);
    expect(result.body).not.toHaveProperty('title');
    expect(JSON.stringify(result.body)).not.toContain('Ngân sách');
  });
  it('Alice vẫn đọc được A1',async()=>{expect((await lab.send(version,'GET','/tasks/A1','alice')).status).toBe(200);});
  it('Charlie vẫn đọc được B1',async()=>{expect((await lab.send(version,'GET','/tasks/B1','charlie')).status).toBe(200);});
});
