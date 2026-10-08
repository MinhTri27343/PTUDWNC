import { queries } from './queries.js';
const base = name => `http://127.0.0.1:${{ user:4101, order:4102, product:4103, graphql:4104 }[name]}`;
const text = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; };
const money = cents => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(cents / 100);
function render(data, client) {
  const dashboard = document.querySelector('#dashboard'); dashboard.replaceChildren();
  if (!data?.user) return;
  if (client === 'web') dashboard.append(text('h2', data.user.name));
  const list = document.createElement('div'); list.className = `orders ${client === 'mobile' ? 'mobile' : ''}`;
  for (const order of data.user.orders) {
    const card = document.createElement('article'); card.className = 'order';
    if (order.product) { const image = document.createElement('img'); image.src = order.product.thumbnail_url; image.alt = ''; card.append(image); }
    const content = document.createElement('div'); content.append(text('h3', `Đơn #${order.id} · ${order.status}`));
    if (order.product) content.append(text('p', order.product.name)); else content.append(text('p', 'Không tải được thông tin sản phẩm', 'error'));
    if (client === 'web') {
      if (order.product) content.append(text('p', `Giá hiện tại: ${money(order.product.price_cents)}`));
      content.append(text('p', `Số lượng: ${order.quantity} · Tổng đơn: ${money(order.total_cents)}`), text('p', `Ngày tạo: ${order.created_at}`), text('p', `User: ${order.user_id} · Product: ${order.product_id}`));
    }
    card.append(content); list.append(card);
  }
  if (!data.user.orders.length) list.append(text('p', 'Chưa có đơn hàng.'));
  dashboard.append(list);
}
export async function runDashboard({ variant = 'baseline', client = 'web', user_id = '1', run_id = crypto.randomUUID() } = {}) {
  document.querySelector('#variant').value = variant;
  document.querySelector('#client').value = client;
  document.querySelector('#user_id').value = user_id;
  const start = performance.now(), start_epoch_ms = Date.now(), spans = [];
  let payload_bytes = 0, data = null, errors = [];
  async function request(service, path, body) {
    const span = { service, path, start_ms:performance.now() - start }; spans.push(span);
    try {
      // Product timeout is per upstream call. A GraphQL operation has its own larger budget.
      const response = await fetch(base(service) + path, { method:body ? 'POST' : 'GET', headers:{ 'X-Run-Id':run_id, ...(body ? {'Content-Type':'application/json'} : {}) }, body:body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(service === 'graphql' ? 10000 : 1000) });
      span.status = response.status;
      const raw = await response.text(); payload_bytes += new TextEncoder().encode(raw).length;
      if (!response.ok) throw new Error(`${service}: HTTP ${response.status}`);
      return JSON.parse(raw);
    } catch (error) { span.error = error.message; throw error; }
    finally { span.end_ms = performance.now() - start; }
  }
  document.querySelector('#status').textContent = 'Đang tải…';
  try {
    if (variant === 'baseline') {
      const user = await request('user', `/users/${user_id}`);
      const orders = await request('order', `/orders?user_id=${user_id}`);
      for (const order of orders) {
        try { order.product = await request('product', `/products/${order.product_id}`); }
        catch (error) { order.product = null; errors.push({ message:error.message, path:['user','orders',orders.indexOf(order),'product'] }); }
      }
      data = { user:{...user,orders} };
    } else {
      const result = await request('graphql', '/graphql', { query:queries[client], variables:{user_id:String(user_id)} });
      data = result.data; errors = result.errors || [];
    }
  } catch (error) { errors.push({message:error.message}); }
  render(data, client);
  const result = !data?.user ? 'error' : errors.length ? 'partial' : 'ok';
  document.querySelector('#status').textContent = result === 'error' ? 'Không tải được dashboard' : result === 'partial' ? 'Hoàn tất với lỗi sản phẩm' : 'Đã tải đầy đủ';
  // Two frames: first commits DOM, second establishes a paint opportunity.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const screen_complete_ms = performance.now() - start;
  const metrics = {run_id,variant,client,start_epoch_ms,client_requests:spans.length,payload_bytes,screen_complete_ms,result,spans,errors};
  document.querySelector('#metrics').textContent = JSON.stringify(metrics, null, 2);
  const waterfall = document.querySelector('#waterfall'); waterfall.replaceChildren();
  for (const span of spans) {
    const row = document.createElement('div'); row.className = 'bar-row'; row.append(text('span', `${span.service} ${span.path}`, 'bar-label'));
    const track = document.createElement('div'); track.className = 'bar-track'; const bar = document.createElement('div'); bar.className = 'bar'; bar.style.marginLeft = `${100 * span.start_ms / screen_complete_ms}%`; bar.style.width = `${100 * (span.end_ms-span.start_ms) / screen_complete_ms}%`; track.append(bar); row.append(track); waterfall.append(row);
  }
  waterfall.append(text('p', `screen_complete: ${screen_complete_ms.toFixed(2)} ms`));
  return { data, metrics };
}
window.runDashboard = runDashboard;
document.querySelector('#controls').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
  try { await runDashboard({variant:document.querySelector('#variant').value,client:document.querySelector('#client').value,user_id:document.querySelector('#user_id').value}); }
  finally { button.disabled = false; }
});
