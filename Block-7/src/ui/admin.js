// Admin: compact service control + the main "service behaviour flow" (swimlanes per service) of a Saga.
$("nav").innerHTML = navbar("admin");
const SVC = { order: "Order", inventory: "Inventory", payment: "Payment" };
// [hook, label, default count, when it fires]
const FAULTS = {
  order: [
    ["confirm.reject", "Từ chối xác nhận đơn", 1, "Nổ ở bước cuối của đơn kế tiếp → Saga hoàn tiền + trả hàng"],
    ["crash.after_call.charge", "Sập sau khi Payment thu tiền", 1, "Order chết thật ngay sau khi Payment trả lời → bấm Bật lại Order"],
    ["crash.after_intent.charge", "Sập trước khi gọi thu tiền", 1, "Order chết thật trước khi gọi Payment → bấm Bật lại Order"],
  ],
  inventory: [
    ["reserve.reject", "Từ chối giữ hàng", 1, "Nổ ở bước đầu của đơn kế tiếp → hủy ngay"],
    ["release.fail", "Trả hàng lỗi tạm thời", 4, "Chỉ nổ khi đơn BỊ HỦY (bước bù trả hàng). Dùng kèm Payment → Từ chối thanh toán"],
  ],
  payment: [
    ["charge.reject", "Từ chối thanh toán", 1, "Nổ ở bước thu tiền của đơn kế tiếp → Saga trả hàng"],
    ["charge.crash_after_commit", "Sập ngay sau khi thu tiền", 1, "Payment trừ tiền xong thì chết thật → bấm Bật lại Payment"],
    ["refund.fail", "Hoàn tiền lỗi tạm thời", 4, "Chỉ nổ khi Saga HOÀN TIỀN. Dùng kèm Order → Từ chối xác nhận đơn"],
  ],
};
const chosen = {}; // remembers the dropdown choice across auto-refresh
const STATUS = {
  PENDING: "busy", RESERVED: "busy", CHARGED: "busy", CONFIRMED: "ok", CANCELLED: "cancel", RECOVERING: "recover", COMPENSATING: "comp",
};
const pill = (st) => `<span class="pill ${STATUS[st] ?? "busy"}">${st}</span>`;
let selected = null, pinned = false;

// ---------- compact service control ----------
async function renderServices() {
  const box = $("services");
  if (box.contains(document.activeElement) && ["INPUT", "SELECT"].includes(document.activeElement.tagName)) return;
  const ctl = (await tryApi("/ctl/status")) ?? {};
  const rows = await Promise.all(Object.keys(SVC).map(async (s) => {
    const up = !!(await tryApi(`${API[s]}/health`));
    const armed = up ? (await tryApi(`${API[s]}/admin/faults`)) ?? [] : [];
    const cur = chosen[s] ?? { hook: FAULTS[s][0][0], count: FAULTS[s][0][2] };
    const info = FAULTS[s].find((f) => f[0] === cur.hook);
    const label = (h) => FAULTS[s].find((f) => f[0] === h)?.[1] ?? h;
    return `<div class="svc-row ${up ? "" : "down"}">
      <span class="dot"></span><b>${SVC[s]}</b><span class="muted">${up ? `pid ${ctl[s]?.pid ?? "?"}` : "ĐÃ TẮT"}</span>
      ${up ? `<button class="btn danger sm" data-svc="${s}" data-ctl="stop">Tắt</button>` : `<button class="btn ok sm" data-svc="${s}" data-ctl="start">Bật lại</button>`}
      <select id="f-${s}" data-svc="${s}" ${up ? "" : "disabled"}>${FAULTS[s].map(([h, t]) => `<option value="${h}" ${h === cur.hook ? "selected" : ""}>${t}</option>`).join("")}</select>
      <span class="muted" style="width:auto">×</span><input type="number" id="c-${s}" data-svc="${s}" min="1" value="${cur.count}" title="Số lần lỗi" ${up ? "" : "disabled"}>
      <button class="btn sm" data-svc="${s}" data-ctl="fault" ${up ? "" : "disabled"}>Cài lỗi</button>
      <span class="armed-inline">${armed.map((a) => `<span class="tag">⚠ ${esc(label(a.hook))}${a.remaining > 1 ? " ×" + a.remaining : ""}</span>`).join("")}
        ${armed.length ? `<button class="btn ghost sm" data-svc="${s}" data-ctl="clear">Gỡ</button>` : ""}</span>
      <div class="when">ⓘ ${esc(info?.[3] ?? "")}</div></div>`;
  }));
  setHtml(box, rows.join(""));
}

// ---------- orders + flow ----------
async function renderFlow() {
  const [orders, acc, led, items] = await Promise.all([
    tryApi(`${API.order}/orders`), tryApi(`${API.payment}/payments/accounts`), tryApi(`${API.payment}/payments/ledger`), tryApi(`${API.inventory}/inventory/items`),
  ]);
  const okMoney = acc && led ? acc.reduce((s, a) => s + a.balance, 0) + led.net === acc.reduce((s, a) => s + a.initial, 0) : null;
  const okStock = items ? items.every((i) => i.available + i.reserved === i.initial) : null;
  const chip = (ok, t) => ok == null ? "" : `<span class="pill ${ok ? "ok" : "cancel"}">${ok ? "✔" : "✖"} ${t}</span> `;
  $("checks").innerHTML = chip(okMoney, "Tiền khớp") + chip(okStock, "Kho khớp");

  if (!orders) { $("orders").innerHTML = `<div class="down-note">Order đang tắt</div>`; return; }
  if (!pinned || !orders.some((o) => o.order_id === selected)) selected = orders[0]?.order_id ?? null; // follow newest order
  setHtml($("orders"), orders.length ? orders.map((o) => `<div class="olist ${o.order_id === selected ? "sel" : ""}" data-order="${o.order_id}">
      <div><b>#${o.order_id}</b> <span class="muted">${o.account_id} · ${o.item_id}×${o.quantity}</span></div>${pill(o.status)}</div>`).join("")
    : `<div class="empty">Chưa có đơn.</div>`);
  if (!selected) { $("flow").innerHTML = `<div class="empty">Chưa có đơn hàng.</div>`; return; }
  const saga = await tryApi(`${API.order}/orders/${selected}/saga`);
  if (saga) setHtml($("flow"), flowView(saga, orders.find((o) => o.order_id === selected)), selected);
}

// Turn saga events into rows placed in the lane of the service that acted.
const ACT = { reserve: ["Giữ hàng", "inventory"], charge: ["Thu tiền", "payment"], confirm: ["Xác nhận đơn", "order"], refund: ["Hoàn tiền", "payment"], release: ["Trả hàng", "inventory"], cancel: ["Hủy đơn", "order"] };
const COMP = new Set(["refund", "release"]);
function flowRows(events) {
  const rows = [];
  for (const e of events) {
    const [name, lane] = ACT[e.step] ?? [e.step, "order"];
    const comp = COMP.has(e.step) ? " comp" : "";
    if (e.kind === "STATE") {
      if (/^created/.test(e.detail)) { rows.push({ at: e.at, lane: "order", cls: "call", html: `📝 <b>Tạo đơn</b> → PENDING<div class="op">Saga ${esc(e.saga_id ?? "")} · lưu op_id cho mọi bước</div>` }); continue; }
      const m = e.detail.match(/^(\w+) -> (\w+)/);
      rows.push({ at: e.at, lane: "order", cls: "state", html: m ? `trạng thái: ${m[1]} → <b>${m[2]}</b>` : esc(e.detail) });
    } else if (e.kind === "INTENT") {
      if (lane === "order") continue; // local step: shown at OUTCOME
      rows.push({ at: e.at, lane: "order", cls: "call" + comp, html: `ghi intent → gọi <b>${name}</b> <span class="arrow">➜ ${SVC[lane]}</span><div class="op">${esc(e.op_id)}</div>` });
    } else if (e.kind === "OUTCOME") {
      const r = / SUCCEEDED/.test(e.detail) ? ["ok", "✔ thành công"] : / FAILED/.test(e.detail) ? ["fail", `✖ từ chối ${e.detail.match(/\(([A-Z_]+)\)/)?.[1] ?? ""}`] : ["unknown", `? không rõ kết quả <small>${esc(e.detail.match(/\((.*)\)/)?.[1] ?? "")}</small>`];
      if (r[0] === "unknown") rows.push({ at: e.at, lane: "order", cls: "res unknown", html: `<b>${name}</b>: ${r[1]}` });
      else rows.push({ at: e.at, lane, cls: `res ${r[0]}${comp}`, html: `<b>${name}</b> ${r[1]}` });
    } else if (e.kind === "QUERY") {
      const res = e.detail.match(/-> (\w+)/)?.[1] ?? "";
      rows.push({ at: e.at, lane: "order", cls: "query", html: `hỏi lại ${esc(e.detail.split(" ")[0])} theo op_id → <b>${res}</b>${/replay/.test(e.detail) ? " → gọi lại cùng op_id" : ""}` });
    } else if (e.kind === "RESUME" && /startup/.test(e.detail)) {
      rows.push({ at: e.at, lane: "order", cls: "query", html: `🔄 khởi động lại → đọc Saga record, resume` });
    } else if (e.kind === "ERROR") {
      rows.push({ at: e.at, lane: "order", cls: "res fail", html: esc(e.detail) });
    }
  }
  return rows;
}
function flowView(s, o) {
  const rows = flowRows(s.events ?? []).reverse(); // newest first
  const lanes = ["order", "inventory", "payment"];
  const extra = [s.intent && `intent đang dở: <b>${s.intent.step}</b> <span class="mono">${esc(s.intent.op_id)}</span>`,
    (s.pending ?? []).length && `bù còn chờ: <b>${s.pending.join(" → ")}</b>`].filter(Boolean).join(" · ");
  return `<div class="detail-head"><h2>Flow hành vi các service · #${s.order_id}</h2>${pill(s.phase)}
      <span class="muted">${o ? `${o.account_id} mua ${o.item_id}×${o.quantity} · ${money(o.amount)}` : ""}</span></div>
    ${extra ? `<div class="explain ${s.phase === "RECOVERING" ? "recover" : "comp"}">${extra}</div>` : ""}
    <div class="scroll" style="max-height:640px"><table class="flow"><tr><th>Thời gian</th><th>Order <small>(orchestrator)</small></th><th>Inventory</th><th>Payment</th></tr>
      ${rows.map((r) => `<tr><td class="t">${time(r.at)}</td>${lanes.map((l) => `<td>${l === r.lane ? `<div class="ev ${r.cls}">${r.html}</div>` : ""}</td>`).join("")}</tr>`).join("")}
    </table></div>
    <p class="muted" style="font-size:12.5px;margin:10px 0 0">Màu cam = bước bù (chạy ngược khi phải hủy). Tím = chưa rõ kết quả, Order hỏi lại theo op_id thay vì làm mới.</p>`;
}

// ---------- actions ----------
document.addEventListener("change", (ev) => {
  const el = ev.target, s = el.dataset?.svc; if (!s) return;
  if (el.tagName === "SELECT") {
    const f = FAULTS[s].find((x) => x[0] === el.value);
    chosen[s] = { hook: el.value, count: f[2] };
    el.blur(); $("services")._html = null; renderServices(); // re-render now: update hint + default count
  } else if (el.tagName === "INPUT") {
    chosen[s] = { hook: $("f-" + s).value, count: Number(el.value || 1) };
  }
});
document.addEventListener("click", async (ev) => {
  const o = ev.target.closest("[data-order]");
  if (o) { selected = o.dataset.order; pinned = selected !== null; renderFlow(); return; }
  const b = ev.target.closest("button[data-svc]"); if (!b) return;
  const s = b.dataset.svc; b.disabled = true;
  try {
    if (b.dataset.ctl === "stop" || b.dataset.ctl === "start") {
      toast(b.dataset.ctl === "stop" ? `Đang tắt ${SVC[s]}…` : `Đang bật ${SVC[s]}…`);
      await api(`/ctl/${s}/${b.dataset.ctl}`, { method: "POST", timeout: 15000, allowError: true });
    } else if (b.dataset.ctl === "clear") {
      await api(`${API[s]}/admin/faults`, { method: "DELETE" });
    } else if (b.dataset.ctl === "fault") {
      const hook = $("f-" + s).value, count = Number($("c-" + s).value || 1);
      await api(`${API[s]}/admin/faults`, { body: { hook, count } });
      toast(`Đã cài lỗi "${FAULTS[s].find((f) => f[0] === hook)?.[1]}" ×${count} — giờ hãy đặt hàng ở Cửa hàng`);
      pinned = false; // next order will be followed automatically
    }
  } catch (e) { toast("Lỗi: " + e.message); }
  renderServices();
});
$("resetBtn").addEventListener("click", async () => {
  if (!confirm("Reset dữ liệu mẫu của cả 3 service?")) return;
  await api("/ctl/reset", { method: "POST", timeout: 20000 }).catch(() => {}); selected = null; pinned = false; toast("Đã reset dữ liệu mẫu");
});

poll(() => Promise.all([renderServices(), renderFlow()]));
