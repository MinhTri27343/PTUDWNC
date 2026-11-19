const $ = id => document.getElementById(id);
let token = '', currentUser = null, editing = null, memberProject = '';
let generation = 0;
const version = () => $('version').value;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const notes = {
  starter: 'Starter: chỉ kiểm token, người đăng nhập có thể đọc/sửa/xóa ngoài quyền. Dùng làm bằng chứng lỗi.',
  v1: 'V1: đọc task phải là thành viên project. Thao tác ghi, xóa và quản lý thành viên chưa được bảo vệ.',
  v2: 'V2: quyền lấy từ membership của từng project. Admin còn là toàn cục ở phiên bản này.',
  v3: 'V3: thêm điều kiện Member là assignee và task Open. Admin vẫn chưa bị giới hạn tenant.',
  v4: 'V4: thêm ranh giới tenant. Dana chỉ là Admin của Alpha; giả role/user/tenant không cấp thêm quyền.',
};
function status(message, error = false) { $('status').textContent = message; $('status').className = error ? 'error' : ''; }
function highlightAccount(id) {
  document.querySelectorAll('#accounts button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.user === id)));
}
function syncRequestFields() {
  $('request-payload').open = $('method').value !== 'GET' || $('extra-headers').value.trim() !== '{}';
}
function setResultExpanded(expanded) {
  $('result').dataset.expanded = String(expanded);
  $('result-toggle').setAttribute('aria-expanded', String(expanded));
  $('result-toggle').textContent = expanded ? 'Thu gọn' : 'Mở kết quả';
}
function revealResult() {
  if (window.matchMedia('(max-width: 900px)').matches) setResultExpanded(true);
}
$('result-toggle').onclick = () => setResultExpanded($('result').dataset.expanded !== 'true');
function clearData() {
  $('projects').innerHTML = '<tr><td colspan="4">Chưa có dữ liệu.</td></tr>';
  $('tasks').innerHTML = '<tr><td colspan="5">Chưa có dữ liệu.</td></tr>';
  $('member-panel').hidden = true;
  $('member-list').textContent = '';
  memberProject = '';
}
async function call(path, {method = 'GET', body, headers = {}, authenticated = true, show = true} = {}) {
  const allHeaders = { ...(body !== undefined ? {'Content-Type':'application/json'} : {}), ...headers };
  if (authenticated && token) allHeaders.Authorization = `Bearer ${token}`;
  else delete allHeaders.Authorization;
  const response = await fetch(path, { method, headers: allHeaders, ...(body !== undefined ? {body:JSON.stringify(body)} : {}) });
  const data = await response.json();
  if (show) {
    if (path !== '/auth/login' || !response.ok) revealResult();
    $('result-request').textContent = `${method} ${path}`;
    $('http-status').textContent = `${response.status} ${response.ok ? 'Thành công' : 'Bị từ chối / lỗi'}`;
    $('http-status').className = `badge ${response.ok ? 'ok' : 'no'}`;
    const safe = path === '/auth/login' && data.token ? {...data, token:'<token đã che>'} : data;
    $('response').textContent = JSON.stringify(safe, null, 2);
    const safeHeaders = Object.fromEntries(Object.entries(allHeaders).map(([k,v]) => [k, /authorization/i.test(k) ? 'Bearer <TOKEN>' : v]));
    const safeBody = path === '/auth/login' ? {username:body?.username, password:'<mật khẩu đã che>'} : body;
    const quote = s => "'" + String(s).replaceAll("'", "'\\''") + "'";
    $('request-preview').textContent = `curl -i -X ${method} ${quote(location.origin + path)}` + Object.entries(safeHeaders).map(([k,v]) => ` \\\n  -H ${quote(k + ': ' + v)}`).join('') + (safeBody !== undefined ? ` \\\n  --data ${quote(JSON.stringify(safeBody))}` : '');
  }
  return {ok:response.ok, status:response.status, data};
}
async function login(username, password = `${username}-pass`) {
  highlightAccount(null);
  token = ''; currentUser = null; generation++; clearData(); $('identity').textContent = 'Chưa đăng nhập';
  const result = await call('/auth/login', {method:'POST', body:{username,password}, authenticated:false});
  if (!result.ok) { status('Đăng nhập thất bại. Kiểm tra tài khoản và mật khẩu.', true); return false; }
  token = result.data.token;
  const me = await call('/auth/me', {show:false}); currentUser = me.data;
  highlightAccount(me.data.id);
  $('identity').textContent = `${me.data.name} · tenant ${me.data.tenantId}${me.data.admin ? ' · Admin' : ''}`;
  status(`Đã đăng nhập ${me.data.name}. Token chỉ được giữ trong bộ nhớ trình duyệt.`);
  await refresh(); return true;
}
async function refresh() {
  const ticket = ++generation, selected = version();
  if (!token) {clearData(); return;}
  const [projects, tasks] = await Promise.all([
    call(`/api/${selected}/projects`, {show:false}), call(`/api/${selected}/tasks`, {show:false}),
  ]);
  if (ticket !== generation) return;
  if (!projects.ok || !tasks.ok) {clearData(); status('Không tải được dữ liệu. Hãy đăng nhập lại nếu token đã hết hạn.', true); return;}
  $('projects').innerHTML = projects.data.map(p => `<tr><td>${esc(p.id)}</td><td>${esc(p.name)}<small>Tenant ${esc(p.tenantId)}</small></td><td>${esc(p.role || 'Không có membership')}</td><td><button data-members="${esc(p.id)}">Thành viên</button><button class="danger" data-delete="${esc(p.id)}">Xóa project</button></td></tr>`).join('') || '<tr><td colspan="4">Không có project được phép xem.</td></tr>';
  $('tasks').innerHTML = tasks.data.map(t => `<tr><td><strong>${esc(t.id)}</strong><small>${esc(t.projectId)}</small></td><td>${esc(t.title)}</td><td>${esc(t.assigneeId || 'Chưa giao')}</td><td><span class="badge ${t.status === 'Open' ? 'ok' : ''}">${esc(t.status)}</span></td><td><button data-read="${esc(t.id)}">Đọc</button><button class="secondary" data-edit="${esc(t.id)}">Sửa</button></td></tr>`).join('') || '<tr><td colspan="5">Không có task được phép xem.</td></tr>';
}
function versionChanged() {
  $('version-note').textContent = notes[version()];
  document.querySelectorAll('.current-version').forEach(el => el.textContent = version());
  clearData(); refresh().catch(handleError);
}
function handleError(error) {
  const message = error.message || 'Không kết nối được server.';
  status(message, true);
  $('http-status').textContent = 'Chưa nhận được HTTP response';
  $('http-status').className = 'badge no';
  $('result-request').textContent = 'Kiểm tra nội dung request hoặc kết nối.';
  $('response').textContent = message;
  revealResult();
}
$('login-form').addEventListener('submit', e => {e.preventDefault(); login($('username').value, $('password').value).catch(handleError);});
$('accounts').addEventListener('click', e => { const user = e.target.dataset.user; if (user) { $('username').value = user; $('password').value = `${user}-pass`; login(user).catch(handleError); } });
$('logout').onclick = () => {token=''; currentUser=null; highlightAccount(null); generation++; clearData(); $('identity').textContent='Chưa đăng nhập'; $('response').textContent='Đã xóa phiên đăng nhập.'; $('http-status').textContent='Chưa gửi'; $('result-request').textContent='Chưa có request.'; $('request-preview').textContent=''; status('Đã đăng xuất.');};
$('version').onchange = versionChanged;
$('refresh').onclick = () => refresh().catch(handleError);
$('tasks').addEventListener('click', async e => {
  try {
    const id = e.target.dataset.read || e.target.dataset.edit; if (!id) return;
    const result = await call(`/api/${version()}/tasks/${encodeURIComponent(id)}`);
    if (!result.ok || !e.target.dataset.edit) return;
    editing = result.data; $('edit-id').textContent=editing.id; $('edit-title').value=editing.title;
    $('edit-description').value=editing.description; $('edit-assignee').value=editing.assigneeId || ''; $('edit-status').value=editing.status;
    $('edit-dialog').showModal();
  } catch(error) {handleError(error);}
});
$('cancel-edit').onclick = () => $('edit-dialog').close();
$('edit-form').onsubmit = async e => {
  e.preventDefault();
  try {
    const values={title:$('edit-title').value, description:$('edit-description').value, assigneeId:$('edit-assignee').value || null, status:$('edit-status').value};
    const body=Object.fromEntries(Object.entries(values).filter(([k,v]) => v !== editing[k]));
    if (!Object.keys(body).length) {status('Chưa có trường nào thay đổi.'); return;}
    const r=await call(`/api/${version()}/tasks/${encodeURIComponent(editing.id)}`, {method:'PATCH',body});
    status(r.ok ? 'Đã cập nhật task.' : r.data.message, !r.ok); $('edit-dialog').close(); await refresh();
  } catch(error) {handleError(error);}
};
async function showMembers(id) {
  memberProject=id; $('member-project').textContent=id; $('member-panel').hidden=false;
  const r=await call(`/api/${version()}/projects/${encodeURIComponent(id)}/members`);
  $('member-list').textContent=JSON.stringify(r.data,null,2);
}
$('projects').addEventListener('click', async e => {
  try {
    if(e.target.dataset.members) await showMembers(e.target.dataset.members);
    const id=e.target.dataset.delete;
    if(id && confirm(`Xóa project ${id} và tất cả task của project trong ${version()}? Có thể khôi phục bằng lệnh reset.`)) {
      const r=await call(`/api/${version()}/projects/${encodeURIComponent(id)}`,{method:'DELETE'});
      status(r.ok?'Đã xóa project.':r.data.message,!r.ok); await refresh();
    }
  } catch(error) {handleError(error);}
});
$('close-members').onclick=() => {$('member-panel').hidden=true; memberProject='';};
$('member-form').onsubmit=async e => {
  e.preventDefault();
  try {
    const method=$('member-method').value, user=$('member-user').value;
    if(method==='DELETE' && !confirm(`Gỡ ${user} khỏi ${memberProject}?`)) return;
    const path=`/api/${version()}/projects/${encodeURIComponent(memberProject)}/members${method==='POST'?'':'/'+encodeURIComponent(user)}`;
    const r=await call(path,{method,...(method==='DELETE'?{}:{body:{userId:user,role:$('member-role').value}})});
    status(r.ok?'Đã thay đổi thành viên.':r.data.message,!r.ok);
    if(r.ok) {
      const id=memberProject; await refresh();
      const members=await call(`/api/${version()}/projects/${encodeURIComponent(id)}/members`,{show:false});
      $('member-list').textContent=JSON.stringify(members.data,null,2);
    }
  } catch(error) {handleError(error);}
};
function jsonObject(id) {const value=JSON.parse($(id).value || '{}'); if(!value || Array.isArray(value) || typeof value!=='object') throw new Error('Body và headers phải là JSON object.'); return value;}
$('method').onchange = syncRequestFields;
$('request-form').onsubmit=async e => {
  e.preventDefault();
  try {
    const path=$('path').value;
    if(!path.startsWith('/') || path.includes('..') || path.includes('?') || path.includes('#') || path.includes('\\')) throw new Error('Path phải bắt đầu bằng / và không chứa .., query hoặc fragment.');
    const method=$('method').value, headers=jsonObject('extra-headers');
    if(Object.keys(headers).some(k=>/authorization/i.test(k))) throw new Error('Dùng ô Gửi token để điều khiển Authorization.');
    await call(`/api/${version()}${path}`,{method,headers,authenticated:$('with-token').checked,...(['PATCH','POST','DELETE'].includes(method)?{body:jsonObject('body')}:{})});
    await refresh();
  } catch(error) {handleError(error);}
};
const scenarios={
  idor:['alice','GET','/tasks/B1'], allow:['alice','GET','/tasks/A1'],
  assigned:['bob','PATCH','/tasks/A1',{title:'Bob cập nhật A1'}], unassigned:['bob','PATCH','/tasks/A2',{title:'Bob thử sửa A2'}],
  closed:['bob','PATCH','/tasks/A3',{title:'Bob thử sửa task Closed'}], viewer:['eve','PATCH','/tasks/A1',{title:'Viewer thử sửa'}],
  'forge-role':['bob','DELETE','/projects/alpha',null,{'X-Role':'Admin'}],
  'forge-user':['alice','PATCH','/tasks/B1',{title:'Giả danh Charlie',userId:'charlie',role:'Owner',tenantId:'beta'}],
  'admin-own':['dana','GET','/tasks/A1'], tenant:['dana','GET','/tasks/B1'],
  'forge-tenant':['dana','GET','/tasks/B1',null,{'X-Tenant-Id':'beta'}], anonymous:[null,'GET','/tasks/A1'],
};
$('scenarios').onchange=async e => {
  const key=e.target.value; if(!key) return;
  const label=e.target.selectedOptions[0].textContent;
  try {
    const [user,method,path,body,headers]=scenarios[key];
    if(user) { $('username').value=user; $('password').value=`${user}-pass`; if(!await login(user)) return; }
    $('method').value=method; $('path').value=path;
    // DELETE bodies are supported by the API and fetch for role-forgery evidence.
    $('body').value=JSON.stringify(key==='forge-role'?{role:'Admin'}:body || {},null,2);
    $('extra-headers').value=JSON.stringify(headers || {},null,2); $('with-token').checked=!!user;
    syncRequestFields();
    $('selected-scenario').textContent = `Tình huống đang chọn: ${label}. Kiểm tra request bên dưới rồi bấm Gửi request.`;
    status(`Đã chuẩn bị tình huống “${label}” ở ${version()}. Bấm Gửi request để thực hiện.`);
  } catch(error) {handleError(error);}
};
versionChanged();
