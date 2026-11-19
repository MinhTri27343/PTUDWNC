import type { Db, Version } from '../src/types.js';
export interface Scenario {
  name: string; user: string | null; method: string; path: string; body?: object;
  headers?: Record<string,string>; setup?: (db: Db) => void; expected: Record<Version, number>;
}
const expected = (starter: number, v1: number, v2: number, v3: number, v4: number) => ({starter,v1,v2,v3,v4});
export const ORACLE: Scenario[] = [
  {name:'01 Anonymous đọc A1',user:null,method:'GET',path:'/tasks/A1',expected:expected(401,401,401,401,401)},
  {name:'02 Alice đọc A1',user:'alice',method:'GET',path:'/tasks/A1',expected:expected(200,200,200,200,200)},
  {name:'03 Alice đọc B1 (IDOR)',user:'alice',method:'GET',path:'/tasks/B1',expected:expected(200,403,403,403,403)},
  {name:'04 Charlie đọc B1',user:'charlie',method:'GET',path:'/tasks/B1',expected:expected(200,200,200,200,200)},
  {name:'05 Viewer sửa A1',user:'bob',method:'PATCH',path:'/tasks/A1',body:{title:'Viewer sửa'},setup:db=>{db.prepare("UPDATE project_members SET role='Viewer' WHERE userId='bob'").run();},expected:expected(200,200,403,403,403)},
  {name:'06 Member xóa Alpha',user:'bob',method:'DELETE',path:'/projects/alpha',expected:expected(200,200,403,403,403)},
  {name:'07 Member quản lý thành viên',user:'bob',method:'GET',path:'/projects/alpha/members',expected:expected(200,200,403,403,403)},
  {name:'08 Owner xóa Alpha',user:'alice',method:'DELETE',path:'/projects/alpha',expected:expected(200,200,200,200,200)},
  {name:'09 Owner quản lý thành viên',user:'alice',method:'GET',path:'/projects/alpha/members',expected:expected(200,200,200,200,200)},
  {name:'10 Bob giả role Admin',user:'bob',method:'DELETE',path:'/projects/alpha',body:{role:'Admin'},expected:expected(200,200,403,403,403)},
  {name:'11 Member sửa task được giao Open',user:'bob',method:'PATCH',path:'/tasks/A1',body:{title:'Bob cập nhật'},expected:expected(200,200,200,200,200)},
  {name:'12 Member sửa task chưa giao',user:'bob',method:'PATCH',path:'/tasks/A2',body:{title:'Bob cập nhật'},expected:expected(200,200,200,403,403)},
  {name:'13 Member sửa task Closed',user:'bob',method:'PATCH',path:'/tasks/A1',body:{title:'Bob cập nhật'},setup:db=>{db.prepare("UPDATE tasks SET status='Closed' WHERE id='A1'").run();},expected:expected(200,200,200,403,403)},
  {name:'14 Member sửa task project khác',user:'bob',method:'PATCH',path:'/tasks/B1',body:{title:'Bob cập nhật'},expected:expected(200,200,403,403,403)},
  {name:'15 Admin Alpha đọc A1',user:'dana',method:'GET',path:'/tasks/A1',expected:expected(200,403,200,200,200)},
  {name:'16 Admin Alpha đọc B1',user:'dana',method:'GET',path:'/tasks/B1',expected:expected(200,403,200,200,403)},
  {name:'17 Admin giả X-Tenant-Id beta',user:'dana',method:'GET',path:'/tasks/B1',headers:{'X-Tenant-Id':'beta'},expected:expected(200,403,200,200,403)},
];
