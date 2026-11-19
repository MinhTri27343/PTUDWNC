// Shop app (customer): browse products, place orders, see own orders and wallet.
const S = {
  me: (() => { try { return localStorage.getItem("me") || "alice"; } catch { return "alice"; } })(),
  filter: "all", items: [], orders: [], ledger: [], accounts: [], up: { order: true, inventory: true, payment: true },
};
const filterOf = (st) => (st === "CONFIRMED" ? "ok" : st === "CANCELLED" ? "cancel" : "busy");
const itemName = (id) => S.items.find((i) => i.item_id === id)?.name ?? `Sản phẩm ${id}`;

async function refresh() {
  const [items, orders, ledger, accounts] = await Promise.all([
    tryApi(`${API.inventory}/inventory/items`), tryApi(`${API.order}/orders`),
    tryApi(`${API.payment}/payments/ledger`), tryApi(`${API.payment}/payments/accounts`),
  ]);
  S.up = { inventory: !!items, order: !!orders, payment: !!accounts };
  if (items) S.items = items; if (orders) S.orders = orders; if (ledger) S.ledger = ledger.entries; if (accounts) S.accounts = accounts;
  render();
}

function render() {
  const acc = S.accounts.find((a) => a.account_id === S.me);
  $("me").value = S.me;
  $("avatar").textContent = S.me[0].toUpperCase();
  $("hello").textContent = `Xin chào, ${acc?.name ?? S.me} 👋`;
  $("myBalance").textContent = S.up.payment ? money(acc?.balance) : "Tạm thời không xem được";

  if (!document.activeElement?.id?.startsWith("q-")) {
    $("products").innerHTML = S.items.map((it) => { const [ic, bg] = look(it.item_id);
      const stock = it.available === 0 ? `<span class="badge out">Hết hàng</span>` : it.available <= 2 ? `<span class="badge low">Chỉ còn ${it.available} sản phẩm</span>` : `<span class="badge in">Còn ${it.available} sản phẩm</span>`;
      return `<div class="product"><div class="img" style="background:${bg}">${ic}</div><div class="body">
        <div class="name">${esc(it.name)}</div><div class="price">${money(it.price)}</div><div class="stock">${stock}</div>
        <div class="buy"><input type="number" min="1" value="1" id="q-${it.item_id}"><button class="btn" data-buy="${it.item_id}">Đặt hàng</button></div></div></div>`; }).join("");
  }

  const mine = S.orders.filter((o) => o.account_id === S.me && (S.filter === "all" || filterOf(o.status) === S.filter));
  $("myOrders").innerHTML = (S.up.order ? "" : `<div class="down-note">Hệ thống đơn hàng đang gián đoạn</div>`) +
    (mine.length ? mine.map((o) => { const [ic, bg] = look(o.item_id);
      return `<div class="order"><div class="thumb" style="background:${bg}">${ic}</div>
      <div class="what">${esc(itemName(o.item_id))} × ${o.quantity}</div>
      <div class="right"><b>${money(o.amount)}</b>${simplePill(o.status)}</div>
      <div class="sub">#${o.order_id} · ${time(o.created_at)}</div></div>`; }).join("")
      : `<div class="empty">Bạn chưa có đơn hàng nào.</div>`);

  const tx = S.ledger.filter((e) => e.account_id === S.me);
  $("myTx").innerHTML = tx.length ? tx.map((e) => `<div class="tx"><div class="l"><span class="ic" style="background:${e.type === "CHARGE" ? "var(--red-bg)" : "var(--green-bg)"}">${e.type === "CHARGE" ? "↗" : "↙"}</span>
      <div>${e.type === "CHARGE" ? "Thanh toán" : "Hoàn tiền"} đơn #${esc(e.order_id)}<div class="muted" style="font-size:12px">${time(e.created_at)}</div></div></div>
      <div class="amt ${e.type === "CHARGE" ? "minus" : "plus"}">${e.type === "CHARGE" ? "−" : "+"}${money(e.amount)}</div></div>`).join("")
    : `<div class="empty">Chưa có giao dịch.</div>`;
}

document.addEventListener("click", async (ev) => {
  const t = ev.target.closest("[data-buy], [data-f]"); if (!t) return;
  if (t.dataset.f) { S.filter = t.dataset.f; document.querySelectorAll("#filters .chip").forEach((b) => b.classList.toggle("active", b === t)); render(); }
  else if (t.dataset.buy) {
    const qty = Number($("q-" + t.dataset.buy).value || 1);
    try { const o = await api(`${API.order}/orders`, { body: { account_id: S.me, item_id: t.dataset.buy, quantity: qty } }); toast(`Đã đặt đơn #${o.order_id}`); refresh(); }
    catch (e) { toast("Không đặt được đơn, vui lòng thử lại"); }
  }
});
$("me").addEventListener("change", (e) => { S.me = e.target.value; try { localStorage.setItem("me", S.me); } catch {} render(); });

poll(refresh);
