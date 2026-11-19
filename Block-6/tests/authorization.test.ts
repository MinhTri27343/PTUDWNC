import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import request from 'supertest';
import { fixture, type Lab } from './helpers.js';
import { ORACLE } from './oracle.js';
import { VERSIONS, type Role, type Version } from '../src/types.js';
import { TaskService } from '../src/service.js';
import { issueToken, ISSUER, AUDIENCE } from '../src/auth.js';
let lab: Lab;
beforeEach(()=>{lab=fixture();}); afterEach(()=>lab.close());

describe.each(VERSIONS)('17 tình huống học liệu / %s',version=>{
  it.each(ORACLE)('$name',async s=>{
    s.setup?.(lab.stores[version]);
    const before=JSON.stringify(lab.stores[version].prepare('SELECT * FROM tasks ORDER BY id').all());
    const result=await lab.send(version,s.method,s.path,s.user,s.body,s.headers);
    expect(result.status).toBe(s.expected[version]);
    if(result.status===403) {
      expect(result.body).not.toHaveProperty('title');
      expect(JSON.stringify(lab.stores[version].prepare('SELECT * FROM tasks ORDER BY id').all())).toBe(before);
    }
  });
});

describe.each(['v2','v3','v4'] as Version[])('12 ô ma trận / %s',version=>{
  // Independent oracle: do not derive expected results from the production matrix.
  const allowed: Record<Role, string[]> = {Viewer:['read'],Member:['read','edit'],Owner:['read','edit','delete','members']};
  for(const [role,user] of [['Viewer','eve'],['Member','bob'],['Owner','alice']] as [Role,string][]) {
    const actions=[['read','GET','/tasks/A1',undefined],['edit','PATCH','/tasks/A1',{title:'Đã sửa'}],['delete','DELETE','/projects/alpha',undefined],['members','GET','/projects/alpha/members',undefined]] as const;
    for(const [action,method,path,body] of actions) it(`${role} / ${action}`,async()=>{
      expect((await lab.send(version,method,path,user,body)).status).toBe(allowed[role].includes(action)?200:403);
    });
  }
});

describe('Authentication và lỗi đầu vào',()=>{
  it('đăng nhập mẫu; token chỉ chứa sub, không nhúng role/tenant',async()=>{
    const login=await request(lab.app).post('/auth/login').send({username:'alice',password:'alice-pass'});
    expect(login.status).toBe(200);
    const payload=JSON.parse(Buffer.from(login.body.token.split('.')[1],'base64url').toString());
    expect(payload.sub).toBe('alice'); expect(payload).not.toHaveProperty('role'); expect(payload).not.toHaveProperty('tenantId');
    const me=await request(lab.app).get('/auth/me').set('Authorization',`Bearer ${login.body.token}`);
    expect(me.body).toEqual({id:'alice',name:'Alice',tenantId:'alpha',admin:0});
  });
  it.each(['sai',''])('mật khẩu sai %s',async password=>{expect((await request(lab.app).post('/auth/login').send({username:'alice',password})).status).toBe(401);});
  it('user không tồn tại',async()=>{expect((await request(lab.app).post('/auth/login').send({username:'nobody',password:'wrong'})).status).toBe(401);});
  it('password không phải string',async()=>{expect((await request(lab.app).post('/auth/login').send({username:'alice',password:[]})).status).toBe(400);});
  it.each(['missing','broken','expired','wrong-key','wrong-audience','wrong-issuer','unknown-user','missing-exp'])('từ chối token %s',async kind=>{
    let token='broken';
    if(kind==='expired') token=await issueToken('alice',lab.secret,'-1s');
    if(kind==='wrong-key') token=await issueToken('alice',new Uint8Array(32));
    if(kind==='unknown-user') token=await issueToken('nobody',lab.secret);
    if(['wrong-audience','wrong-issuer','missing-exp'].includes(kind)) {
      let jwt=new SignJWT({}).setProtectedHeader({alg:'HS256'}).setSubject('alice').setIssuedAt().setAudience(kind==='wrong-audience'?'other':AUDIENCE).setIssuer(kind==='wrong-issuer'?'other':ISSUER);
      if(kind!=='missing-exp') jwt=jwt.setExpirationTime('1h');
      token=await jwt.sign(lab.secret);
    }
    const req=request(lab.app).get('/api/v4/tasks/A1');
    if(kind!=='missing') req.set('Authorization',`Bearer ${token}`);
    const r=await req; expect(r.status).toBe(401); expect(r.headers['www-authenticate']).toBe('Bearer');
  });
  it('resource không tồn tại trả 404',async()=>{expect((await lab.send('v4','GET','/tasks/Z9','alice')).status).toBe(404);});
  it('phiên bản không hợp lệ trả 404',async()=>{expect((await request(lab.app).get('/api/v99/tasks/A1').set('Authorization',`Bearer ${await lab.token('alice')}`)).status).toBe(404);});
  it('JSON sai trả 400',async()=>{expect((await request(lab.app).patch('/api/v4/tasks/A1').set('Content-Type','application/json').send('{')).status).toBe(400);});
});

describe('Trust boundary, ABAC và ghi dữ liệu',()=>{
  it('không tin userId/role/tenantId do Alice tự khai khi sửa B1',async()=>{
    const r=await lab.send('v4','PATCH','/tasks/B1','alice',{title:'Hacked',userId:'charlie',role:'Owner',tenantId:'beta'},{'X-Tenant-Id':'beta','X-Role':'Admin'});
    expect(r.status).toBe(403); expect((lab.stores.v4.prepare("SELECT title FROM tasks WHERE id='B1'").get() as any).title).toBe('Ngân sách dự án Beta');
  });
  it('claim role/tenant trong JWT ký hợp lệ cũng không cấp quyền',async()=>{
    const token=await new SignJWT({role:'Admin',tenantId:'beta'}).setProtectedHeader({alg:'HS256'}).setSubject('bob').setIssuedAt().setExpirationTime('1h').setIssuer(ISSUER).setAudience(AUDIENCE).sign(lab.secret);
    const r=await request(lab.app).delete('/api/v4/projects/alpha').set('Authorization',`Bearer ${token}`); expect(r.status).toBe(403);
  });
  it.each([{assigneeId:'bob'},{status:'Open'},{title:'X',status:'Open'}])('Member không được sửa trường quản trị %j',async body=>{
    const before=lab.stores.v4.prepare("SELECT * FROM tasks WHERE id='A1'").get();
    expect((await lab.send('v4','PATCH','/tasks/A1','bob',body)).status).toBe(403);
    expect(lab.stores.v4.prepare("SELECT * FROM tasks WHERE id='A1'").get()).toEqual(before);
  });
  it.each([['A2',{assigneeId:'bob',title:'Chiếm task'}],['A3',{status:'Open',title:'Mở lại'}]])('Member không thể tự vượt điều kiện trên %s',async(id,body)=>{expect((await lab.send('v4','PATCH',`/tasks/${id}`,'bob',body as object)).status).toBe(403);});
  it('Owner sửa Closed và gán task; Member sửa sau khi được giao',async()=>{
    expect((await lab.send('v4','PATCH','/tasks/A3','alice',{description:'Owner sửa Closed'})).status).toBe(200);
    expect((await lab.send('v4','PATCH','/tasks/A2','alice',{assigneeId:'bob'})).status).toBe(200);
    expect((await lab.send('v4','PATCH','/tasks/A2','bob',{description:'Được giao nên được sửa'})).status).toBe(200);
  });
  it('Owner đóng task, token cũ của Bob lập tức không sửa được',async()=>{
    const token=await lab.token('bob');
    await lab.send('v4','PATCH','/tasks/A1','alice',{status:'Closed'});
    expect((await request(lab.app).patch('/api/v4/tasks/A1').set('Authorization',`Bearer ${token}`).send({title:'X'})).status).toBe(403);
  });
  it.each([{projectId:'beta'},{id:'B1'},{title:''},{title:42},{status:'Done'},{assigneeId:'charlie'},{description:[]},{}])('Owner gửi patch sai %j',async body=>{
    const before=lab.stores.v4.prepare("SELECT * FROM tasks WHERE id='A1'").get();
    expect((await lab.send('v4','PATCH','/tasks/A1','alice',body)).status).toBe(400);
    expect(lab.stores.v4.prepare("SELECT * FROM tasks WHERE id='A1'").get()).toEqual(before);
  });
  it('ghi dữ liệu thật và không ảnh hưởng phiên bản khác',async()=>{
    await lab.send('v4','PATCH','/tasks/A1','alice',{title:'Mới'});
    expect((await lab.send('v4','GET','/tasks/A1','alice')).body.title).toBe('Mới');
    expect((await lab.send('v3','GET','/tasks/A1','alice')).body.title).not.toBe('Mới');
    await lab.send('v4','DELETE','/projects/alpha','alice');
    expect((await lab.send('v4','GET','/tasks/A1','alice')).status).toBe(404);
    expect((lab.stores.v4.prepare("SELECT count(*) n FROM project_members WHERE projectId='alpha'").get() as any).n).toBe(0);
    expect((await lab.send('v3','GET','/tasks/A1','alice')).status).toBe(200);
  });
  it('gọi trực tiếp business layer vẫn bị kiểm quyền',()=>{
    const service=new TaskService({db:lab.stores.v4,version:'v4'});
    expect(()=>service.getTask('alice','B1')).toThrow('Bạn không có quyền');
    expect(()=>service.editTask('bob','A2',{title:'X'})).toThrow('Bạn không có quyền');
    expect(()=>service.deleteProject('bob','alpha')).toThrow('Bạn không có quyền');
    expect(()=>service.listMembers('bob','alpha')).toThrow('Bạn không có quyền');
  });
});

describe('Danh sách khớp quyền đọc đơn lẻ',()=>{
  for(const version of VERSIONS) for(const user of ['alice','bob','eve','charlie','dana']) it(`${version}/${user}`,async()=>{
    const tasks=await lab.send(version,'GET','/tasks',user), projects=await lab.send(version,'GET','/projects',user);
    const readable:string[]=[];
    for(const id of ['A1','A2','A3','B1','B2']) if((await lab.send(version,'GET',`/tasks/${id}`,user)).status===200) readable.push(id);
    expect(tasks.body.map((t:any)=>t.id)).toEqual(readable);
    expect(projects.body.map((p:any)=>p.id)).toEqual([...new Set(readable.map(id=>id.startsWith('A')?'alpha':'beta'))]);
    if(version==='v4' && user!=='charlie') expect(JSON.stringify(tasks.body)).not.toContain('Ngân sách');
  });
});

describe('Quản lý thành viên',()=>{
  it.each(['POST','PATCH','DELETE'] as const)('Viewer/Member không có quyền %s và không thay đổi DB',async method=>{
    const before=lab.stores.v4.prepare('SELECT * FROM project_members ORDER BY projectId,userId').all();
    for(const user of ['bob','eve']) {
      const path='/projects/alpha/members'+(method==='POST'?'':'/bob');
      expect((await lab.send('v4',method,path,user,{userId:'dana',role:'Owner'})).status).toBe(403);
    }
    expect(lab.stores.v4.prepare('SELECT * FROM project_members ORDER BY projectId,userId').all()).toEqual(before);
  });
  it('Owner thêm, đổi role, gỡ thành viên',async()=>{
    expect((await lab.send('v4','POST','/projects/alpha/members','alice',{userId:'dana',role:'Viewer'})).status).toBe(201);
    expect((await lab.send('v4','PATCH','/projects/alpha/members/dana','alice',{role:'Member'})).status).toBe(200);
    expect((await lab.send('v4','DELETE','/projects/alpha/members/dana','alice')).status).toBe(200);
  });
  it('gỡ Bob thu hồi ngay cả với token đã cấp và xóa assignee',async()=>{
    const token=await lab.token('bob');
    await lab.send('v4','DELETE','/projects/alpha/members/bob','alice');
    const r=await request(lab.app).get('/api/v4/tasks/A1').set('Authorization',`Bearer ${token}`);
    expect(r.status).toBe(403);
    expect((await lab.send('v4','GET','/tasks','bob')).body).toEqual([]);
    expect((await lab.send('v4','GET','/tasks/A1','alice')).body.assigneeId).toBeNull();
  });
  it.each(['DELETE','PATCH'])('không được %s Owner cuối cùng',async method=>{expect((await lab.send('v4',method,'/projects/alpha/members/alice','alice',{role:'Member'})).status).toBe(409);});
  it('gỡ một Owner khi đã có Owner khác',async()=>{
    await lab.send('v4','PATCH','/projects/alpha/members/bob','alice',{role:'Owner'});
    expect((await lab.send('v4','DELETE','/projects/alpha/members/alice','alice')).status).toBe(200);
    expect((await lab.send('v4','GET','/tasks/A1','alice')).status).toBe(403);
  });
  it.each([['nobody','Viewer',400],['charlie','Viewer',400],['dana','Admin',400],['bob','Viewer',409]])('thêm %s/%s trả %s',async(userId,role,status)=>{expect((await lab.send('v4','POST','/projects/alpha/members','alice',{userId,role})).status).toBe(status);});
  it('Admin Alpha không quản lý project Beta',async()=>{
    expect((await lab.send('v4','POST','/projects/beta/members','dana',{userId:'dana',role:'Owner'},{'X-Tenant-Id':'beta'})).status).toBe(403);
    expect((await lab.send('v4','DELETE','/projects/beta','dana')).status).toBe(403);
  });
  it('Admin quản lý project cùng tenant không cần membership',async()=>{expect((await lab.send('v4','PATCH','/projects/alpha/members/bob','dana',{role:'Viewer'})).status).toBe(200);});
});
