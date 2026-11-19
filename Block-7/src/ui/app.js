// Shared helpers for the 4 front-end apps: shop / inventory / payment (business UIs) + admin (technical UI).
// Every app reads data ONLY through the service HTTP APIs; process control goes through ctl (:3000).
const API = { order: "http://127.0.0.1:3001", inventory: "http://127.0.0.1:3002", payment: "http://127.0.0.1:3003" };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => (n == null ? "—" : Number(n).toLocaleString("vi-VN") + " đ");
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString("vi-VN") : "");

async function api(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout ?? 1500);
  try {
    const res = await fetch(url, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers: { "content-type": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok && !opts.allowError) throw new Error(data?.error ?? `HTTP ${res.status}`);
    return data;
  } finally { clearTimeout(t); }
}
async function tryApi(url) { try { return await api(url); } catch { return undefined; } }
function toast(msg) {
  let el = $("toast");
  if (!el) { document.body.insertAdjacentHTML("beforeend", `<div id="toast" class="toast" hidden></div>`); el = $("toast"); }
  el.textContent = msg; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2500);
}

const ITEM_LOOK = { A: ["🎧", "#e0e7ff"], B: ["⌚", "#fce7f3"], C: ["💻", "#dcfce7"] };
const look = (id) => ITEM_LOOK[id] ?? ["📦", "#f3f4f6"];

// Simple, customer-facing order status.
const SIMPLE = {
  CONFIRMED: ["Thành công", "ok"], CANCELLED: ["Đã hủy", "cancel"],
  PENDING: ["Đang xử lý", "busy"], RESERVED: ["Đang xử lý", "busy"], CHARGED: ["Đang xử lý", "busy"],
  RECOVERING: ["Đang xử lý", "busy"], COMPENSATING: ["Đang hủy", "comp"],
};
const simplePill = (st) => { const [t, c] = SIMPLE[st] ?? ["Đang xử lý", "busy"]; return `<span class="pill ${c}">${t}</span>`; };

function navbar(active, extra = "") {
  const link = (href, ic, t, key) => `<a href="${href}" class="${key === active ? "active" : ""}">${ic} ${t}</a>`;
  const sub = { shop: "Cửa hàng", inventory: "Kho hàng", payment: "Thanh toán", admin: "Admin kỹ thuật" }[active];
  return `<div class="brand"><span class="logo">S</span>SagaShop<small>${sub}</small></div>
    <nav class="apps">${link("shop.html", "🛒", "Cửa hàng", "shop")}${link("inventory.html", "📦", "Kho hàng", "inventory")}${link("payment.html", "💳", "Thanh toán", "payment")}${link("admin.html", "⚙️", "Admin", "admin")}</nav>${extra}`;
}

function table(head, rows, down) {
  return (down ? `<div class="down-note">Hệ thống đang gián đoạn — hiển thị dữ liệu gần nhất</div>` : "") +
    `<div class="scroll ${down ? "stale" : ""}"><table class="tbl"><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>
    ${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${head.length}" class="muted">Chưa có dữ liệu</td></tr>`}</table></div>`;
}

/** Replace content only if it changed, keeping the inner `.scroll` position (so polling never jumps to top). */
function setHtml(el, html, key = "") {
  if (el._html === html) return;
  const sc = el.querySelector(".scroll"), top = sc?.scrollTop ?? 0, same = el._key === key;
  el.innerHTML = html; el._html = html; el._key = key;
  const sc2 = el.querySelector(".scroll"); if (sc2 && same) sc2.scrollTop = top;
}

/** Poll every 1.5s. */
function poll(refresh) { refresh(); setInterval(refresh, 1500); }
