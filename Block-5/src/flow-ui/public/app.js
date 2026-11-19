// OAuth2 + PKCE Flow Lab — talks to the three real services; draws what each of them reports it did.
const cfg = await (await fetch('/config.json')).json();

const LANES = [
  { id: 'browser', title: 'Browser', sub: 'Alice (user agent)' },
  { id: 'taxi', title: 'Taxi', sub: 'OAuth client (backend)' },
  { id: 'as', title: 'Wallet AS', sub: 'authorization server' },
  { id: 'api', title: 'Wallet API', sub: 'resource server' },
  { id: 'attacker', title: 'Attacker', sub: 'attack script' },
];
const SERVICES = { as: 'Wallet AS', api: 'Wallet API', taxi: 'Taxi' };
const SERVICE_LANE = { as: 'as', api: 'api', taxi: 'taxi' };
const ACTOR_LANE = { browser: 'browser', taxi: 'taxi', api: 'api', attacker: 'attacker' };

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const records = new Map();
let selectedId = null;
let highlightFp = null;

// ---------- explanations (what each step means in OAuth2 terms) ----------

const NOTE_HELP = {
  pkce_started: 'Taxi created a random code_verifier (kept server-side) and will only send its SHA-256 challenge to the AS.',
  link_redirect: 'Taxi sends the browser to the AS authorization endpoint.',
  authorize_rejected: 'The AS refused the authorization request. Unknown client / unregistered redirect_uri are shown on the AS page (never redirected); other errors go back to the client with state.',
  login_ok: 'Alice authenticated at the AS. Taxi never sees her password.',
  login_failed: 'Wrong username or password.',
  consent_denied: 'Alice pressed Deny: the client gets error=access_denied.',
  code_issued: 'Alice approved. The AS stored the SHA-256 hash of a one-time code (60 s) bound to client, redirect_uri, user, scope and the PKCE challenge.',
  code_burned: 'The code is marked used before any other check, in the same transaction that issues tokens: it can never be redeemed twice, even by concurrent requests.',
  pkce_check: 'The AS recomputes BASE64URL(SHA-256(code_verifier)) and compares it with the stored code_challenge. Equal fingerprints mean the caller is the party that started the flow.',
  token_issued: 'Tokens were issued. The access token is a short-lived ES256 JWT; a refresh token is only returned with offline_access.',
  token_rejected: 'The token endpoint refused the request; see the reason/error fields.',
  refresh_rotated: 'Refresh rotation: the old refresh token is marked used and replaced. Presenting it again revokes the whole family.',
  refresh_family_revoked: 'Replay/reuse detected (or consent revoked): every refresh token in the family is revoked.',
  consent_revoked: 'Alice withdrew Taxi’s access: consent and all refresh families revoked.',
  wallet_linked: 'Taxi stored the tokens server-side. The browser never saw a token.',
  wallet_unlinked: 'The AS answered invalid_grant to the refresh: Taxi marks the wallet unlinked.',
  access_token_aged: 'Simulation: the stored access token is treated as expired (as if Alice left for a while).',
  access_token_expired: 'Taxi sees its access token has expired and will use the refresh token.',
  token_refreshed: 'Taxi stored the rotated token pair immediately (the old refresh token is now dead).',
  jwt_verified: 'The API verified the JWT offline: signature (JWKS), iss, aud, exp. No call to the AS per request.',
  jwt_rejected: 'The API rejected the access token (missing, malformed, expired or wrong signature/audience).',
  scope_denied: 'The token is valid but lacks the scope this route needs → 403.',
  principal_denied: 'The token belongs to a client (no user), but this route needs a user → 403.',
  charge_applied: 'The wallet was charged and the charge counter incremented.',
  charge_replayed: 'Same Idempotency-Key seen before: the stored result is returned, nothing is charged twice.',
};

function explain(r) {
  if (r.kind === 'note') return NOTE_HELP[r.event] || 'A decision the service logged while handling a request.';
  const grant = r.req?.body?.grant_type;
  const key = `${r.service} ${r.method} ${r.path}`;
  if (key === 'taxi POST /api/link/start') return 'Taxi (OAuth client) creates state + PKCE code_verifier, keeps them server-side and returns the authorization URL containing only the S256 challenge.';
  if (key === 'as GET /authorize') return 'FRONT CHANNEL. The browser arrives at the AS. Checks in order: client_id → exact redirect_uri (errors here are shown on the AS page, no redirect) → response_type → PKCE S256 challenge → scope. Then login and consent.';
  if (key === 'as POST /login') return 'Alice signs in on the AS page (argon2id check, CSRF token). Taxi is not part of this step.';
  if (key === 'as POST /consent') return 'Alice decides. Allow → 302 to Taxi’s redirect_uri with code + the unchanged state. Deny → error=access_denied.';
  if (key === 'taxi GET /callback') return 'FRONT CHANNEL return. The browser brings code + state to Taxi. Taxi checks state, then exchanges the code on the back channel.';
  if (key === 'as POST /token' && grant === 'authorization_code') return 'BACK CHANNEL. Taxi authenticates (HTTP Basic) and sends code + code_verifier + redirect_uri. The browser never sees this call or the tokens.';
  if (key === 'as POST /token' && grant === 'refresh_token') return 'Refresh grant with rotation: the old refresh token is consumed, a new pair is issued. Replaying the old one revokes the family.';
  if (key === 'as POST /token' && grant === 'client_credentials') return 'Machine-to-machine: the client gets a token for itself (principal_type=client, sub=client_id), no refresh token.';
  if (key === 'as POST /token') return 'Token endpoint request. Browser JavaScript is not meant to call it (client secret!).';
  if (key === 'as GET /.well-known/jwks.json') return r.actor === 'api'
    ? 'The Wallet API downloads the AS public keys once and caches them: this is why it can verify tokens offline.'
    : 'Public signing keys (ES256) — anyone may read them.';
  if (key === 'as GET /account') return 'Alice’s account page on the AS: connected apps and the Revoke button.';
  if (key === 'as POST /account/revoke') return 'Revocation: consent.revoked_at and every refresh family of (Alice, Taxi) are revoked. Access tokens already issued stay valid until exp.';
  if (r.service === 'api' && r.path === '/wallet/balance') return 'Resource server call. Needs scope wallet:read; the JWT is verified offline.';
  if (r.service === 'api' && r.path === '/wallet/charges') return 'Charge. Needs scope wallet:charge AND principal_type=user; Idempotency-Key makes retries safe.';
  if (r.service === 'api' && r.path === '/public/rates') return 'Public rates. Needs scope rates:read (client tokens allowed).';
  return `${r.method} ${r.path}`;
}

// ---------- summaries for the diagram ----------

const FP_KEYS = ['code', 'state', 'code_challenge', 'code_verifier', 'refresh_token', 'client_secret'];
const PLAIN_KEYS = ['client_id', 'response_type', 'scope', 'grant_type', 'code_challenge_method', 'decision', 'username', 'amount_cents'];

function reqSummary(r) {
  const src = { ...(r.query || {}), ...(r.req?.body || {}) };
  const out = [];
  const a = r.req?.authorization;
  if (a) out.push(a.scheme === 'Basic' ? `Basic ${a.client_id}` : `Bearer ${a.claims?.principal_type || ''} ${a.claims?.sub || ''}`.trim());
  for (const k of PLAIN_KEYS) if (src[k] !== undefined) out.push(`${k}=${src[k]}`);
  for (const k of FP_KEYS) if (src[k] !== undefined) out.push(`${k}=${src[k]}`);
  return out.join('  ');
}

function respSummary(r) {
  if (r.pending) return '…';
  const bits = [String(r.status)];
  const res = r.res || {};
  if (res.location) bits.push(`→ ${res.location.replace(/^https?:\/\/[^/]+/, '')}`);
  if (res.page) bits.push(`page: ${res.page}`);
  const b = res.body;
  if (b && typeof b === 'object') {
    if (b.error) bits.push(`error=${b.error}`);
    else if (b.access_token) bits.push(`token_type=${b.token_type} expires_in=${b.expires_in} scope=${b.scope}${b.refresh_token ? ' + refresh_token ' + b.refresh_token : ''}`);
    else if (b.authorize_url) bits.push('authorize_url');
    else bits.push(Object.keys(b).slice(0, 4).join(', '));
  }
  return bits.join('  ');
}

const statusClass = (r) => (r.pending ? 's-pend' : r.status >= 400 ? 's-rej' : r.status >= 300 ? 's-redir' : 's-ok');
const clip = (s, n) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

// ---------- diagram ----------

const W = 900;
const SIDE = 80;
const svgNS = 'http://www.w3.org/2000/svg';
let pendingRender = false;
const schedule = () => {
  if (!pendingRender) {
    pendingRender = true;
    // setTimeout, not requestAnimationFrame: rAF is paused while the tab is in the background
    setTimeout(() => {
      pendingRender = false;
      render();
    }, 30);
  }
};

function render() {
  const showNotes = $('#show-notes').checked;
  const list = [...records.values()].filter((r) => r.kind === 'http' || showNotes).sort((a, b) => a.t - b.t);
  const lanes = LANES.filter((l) => l.id !== 'attacker' || list.some((r) => r.actor === 'attacker'));
  const step = (W - 2 * SIDE) / (lanes.length - 1);
  const x = Object.fromEntries(lanes.map((l, i) => [l.id, SIDE + i * step]));

  // lane header (fixed)
  $('#lane-head').innerHTML = `<svg viewBox="0 0 ${W} 54">${lanes
    .map(
      (l) => `<g><rect x="${x[l.id] - 70}" y="6" width="140" height="42" rx="8" fill="none" stroke="var(--line)"/>
      <text x="${x[l.id]}" y="25" text-anchor="middle" style="font-weight:600;fill:var(--text);font-size:12px">${l.title}</text>
      <text x="${x[l.id]}" y="40" text-anchor="middle" style="fill:var(--muted);font-size:10px">${l.sub}</text></g>`,
    )
    .join('')}</svg>`;

  const scroller = $('#scroll');
  const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;

  let y = 8;
  const rows = list.map((r) => {
    const h = r.kind === 'http' ? 66 : 30;
    const row = { r, y, h };
    y += h;
    return row;
  });
  const H = y + 16;

  const lifelines = lanes.map((l) => `<line class="lifeline" x1="${x[l.id]}" x2="${x[l.id]}" y1="0" y2="${H}"/>`).join('');
  const body = rows.map(({ r, y: top }) => {
    const sel = r.id === selectedId ? ' sel' : '';
    const hl = highlightFp && JSON.stringify(r).includes(`<${highlightFp}>`) ? ' hl' : '';
    if (r.kind === 'note') {
      const lx = x[SERVICE_LANE[r.service]] ?? x.as;
      const cls = r.level === 'reject' ? 'rej' : r.level === 'ok' ? 'ok' : '';
      const extra = r.data && typeof r.data === 'object' ? Object.entries(r.data).filter(([k]) => k !== 'note').slice(0, 2).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ') : '';
      const text = clip(`${r.event}${extra ? '  ' + extra : ''}`, 44);
      return `<g class="row${sel}${hl}" data-id="${r.id}"><rect class="hit" x="0" y="${top}" width="${W}" height="30"/>
        <rect class="note-box ${cls}" x="${lx - 105}" y="${top + 4}" width="210" height="22" rx="5"/>
        <text x="${lx}" y="${top + 19}" text-anchor="middle">${esc(text)}</text><title>${esc(r.event)}</title></g>`;
    }
    const from = x[ACTOR_LANE[r.actor] ?? 'browser'] ?? x.browser;
    const to = x[SERVICE_LANE[r.service]];
    const dir = to >= from ? 1 : -1;
    const mid = (from + to) / 2;
    const span = Math.max(Math.abs(to - from), 120);
    const chars = Math.floor(span / 5.4);
    const cls = statusClass(r);
    const reqY = top + 22;
    const respY = top + 48;
    const head = (px, py, d, c) => `<polygon class="${c}" points="${px},${py} ${px - 8 * d},${py - 4} ${px - 8 * d},${py + 4}"/>`;
    const req = reqSummary(r);
    return `<g class="row${sel}${hl}" data-id="${r.id}"><rect class="hit" x="0" y="${top}" width="${W}" height="66"/>
      <text x="${mid}" y="${top + 13}" text-anchor="middle" style="font-weight:600">${esc(clip(`${r.method} ${r.path}`, chars))}</text>
      <line class="req" x1="${from}" y1="${reqY}" x2="${to - 8 * dir}" y2="${reqY}"/>${head(to, reqY, dir, 'req" style="fill:var(--text)')}
      <text class="muted" x="${mid}" y="${top + 34}" text-anchor="middle">${esc(clip(req, chars + 8))}</text>
      <line class="resp ${cls}" x1="${to}" y1="${respY}" x2="${from + 8 * dir}" y2="${respY}"/>${head(from, respY, -dir, cls)}
      <text class="resp-label ${cls}" x="${mid}" y="${top + 61}" text-anchor="middle">${esc(clip(respSummary(r), chars + 8))}</text>
      <title>${esc(`${r.actor} → ${r.service}\n${r.method} ${r.path}\n${req}\n${respSummary(r)}`)}</title></g>`;
  });

  $('#canvas').setAttribute('viewBox', `0 0 ${W} ${H}`);
  $('#canvas').innerHTML = `<defs></defs>${lifelines}${body.join('')}`;
  if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
  if (selectedId && records.has(selectedId)) showDetails(records.get(selectedId));
}

$('#canvas').addEventListener('click', (e) => {
  const g = e.target.closest('.row');
  if (!g) return;
  selectedId = g.dataset.id;
  render();
});
$('#show-notes').addEventListener('change', render);
function clearDiagram() {
  records.clear();
  selectedId = null;
  highlightFp = null;
  $('#detail-body').innerHTML = '';
  $('#explain').textContent = 'Select a message in the diagram.';
  render();
}
$('#clear').addEventListener('click', clearDiagram);

// Reset demo: every service returns to its freshly seeded state (no restart, no db:reset needed).
$('#reset').addEventListener('click', async () => {
  const btn = $('#reset');
  btn.disabled = true;
  try {
    const results = await Promise.all(
      // no cookies needed: each service wipes its own server-side sessions
      [cfg.as, cfg.api, cfg.taxi].map((base) => fetch(`${base}/_flow/reset`, { method: 'POST', credentials: 'omit' }).then((r) => r.ok)),
    );
    if (!results.every(Boolean)) throw new Error('a service refused the reset');
    clearDiagram();
    $('#last').textContent = '—';
    $('#attack-out').hidden = true;
    await refreshState();
    toast('Demo reset: wallet unlinked, balances restored, one pending ride, everyone signed out.');
  } catch (err) {
    toast(`Reset failed: ${err}`);
  } finally {
    btn.disabled = false;
  }
});

// ---------- details panel ----------

function jsonHtml(obj) {
  const s = esc(JSON.stringify(obj, null, 2));
  return s.replace(/&lt;([a-z_]+:[0-9a-f]{8})&gt;/g, (_m, fp) => `<span class="fp${fp === highlightFp ? ' on' : ''}" data-fp="${fp}">&lt;${fp}&gt;</span>`);
}

function showDetails(r) {
  $('#explain').textContent = explain(r);
  const parts = [];
  const sect = (title, obj) => {
    if (obj === undefined || (typeof obj === 'object' && obj !== null && Object.keys(obj).length === 0)) return;
    parts.push(`<div class="sect">${title}</div><pre class="json">${jsonHtml(obj)}</pre>`);
  };
  if (r.kind === 'note') {
    sect(`Decision at ${SERVICES[r.service]}`, { event: r.event, level: r.level, ...(typeof r.data === 'object' ? r.data : {}) });
  } else {
    sect('Message', { from: r.actor, to: SERVICES[r.service], request: `${r.method} ${r.path}`, durationMs: r.durationMs });
    sect('Request query', r.query);
    sect('Request Authorization', r.req?.authorization);
    sect('Request body', r.req?.body);
    sect('Response', r.pending ? { status: 'pending…' } : { status: r.status, location: r.res?.location, page: r.res?.page });
    sect('Response body', r.res?.body);
  }
  $('#detail-body').innerHTML = parts.join('');
}

$('#detail-body').addEventListener('click', (e) => {
  const chip = e.target.closest('.fp');
  if (!chip) return;
  highlightFp = highlightFp === chip.dataset.fp ? null : chip.dataset.fp;
  render();
});

// ---------- event streams from the three services ----------

const health = {};
function renderHealth() {
  $('#health').innerHTML = Object.entries(health)
    .map(([name, up]) => `<span class="${up ? 'up' : 'down'}">${name}</span>`)
    .join('');
}
for (const [name, base] of [['Taxi', cfg.taxi], ['Wallet AS', cfg.as], ['Wallet API', cfg.api]]) {
  health[name] = false;
  const es = new EventSource(`${base}/_flow/stream`);
  es.onopen = () => {
    health[name] = true;
    renderHealth();
  };
  es.onerror = () => {
    health[name] = false;
    renderHealth();
  };
  es.onmessage = (m) => {
    const rec = JSON.parse(m.data);
    records.set(rec.id, rec);
    schedule();
  };
}
renderHealth();

// ---------- calling the real services ----------

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3500);
}
const setLast = (title, value) => {
  $('#last').textContent = `${title}\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`;
};

async function call(base, path, { method = 'POST', body, headers = {}, credentials } = {}) {
  const h = { ...headers };
  if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
  const res = await fetch(base + path, {
    method,
    headers: h,
    credentials,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body: parsed };
}
const taxi = (path, opts = {}) => call(cfg.taxi, path, { credentials: 'include', ...opts });

function openPopup(url) {
  return window.open(url, 'wallet-popup', 'width=480,height=780');
}

window.addEventListener('message', (e) => {
  if (e.origin !== cfg.taxi || e.data?.type !== 'taxi:link') return;
  toast(e.data.ok ? 'Wallet linked — Taxi holds the tokens server-side.' : 'Linking failed — see the diagram.');
  refreshState();
});

const ACTIONS = {
  async link() {
    const popup = openPopup('about:blank'); // opened inside the click so the popup is not blocked
    const r = await taxi('/api/link/start');
    if (!popup) {
      setLast('Popup blocked — open this URL manually', r.body.authorize_url);
      return;
    }
    popup.location.href = r.body.authorize_url;
    setLast('Opened the Wallet AS in a popup', { authorize_url: r.body.authorize_url.replace(/(code_challenge|state)=[^&]+/g, '$1=…') });
  },
  async balance() { setLast('Taxi → Wallet API: balance', await taxi('/api/balance')); },
  async ride() { setLast('New ride', await taxi('/api/rides')); },
  async expire() { setLast('Access token made stale', await taxi('/api/expire')); },
  async job() { setLast('Payment job', await taxi('/api/payment-job')); },
  async 'job-all'() {
    await taxi('/api/rides');
    await taxi('/api/expire');
    setLast('Payment job (new ride + stale token)', await taxi('/api/payment-job'));
  },
  account() { openPopup(`${cfg.as}/account`); },
  async 'm2m-rates'() { setLast('Taxi M2M → rates', await taxi('/api/m2m/rates')); },
  async 'm2m-charge'() { setLast('Client token → /wallet/charges (expect 403)', await taxi('/api/m2m/try-charge')); },
  async 'api-notoken'() { setLast('Browser → API, no token', await call(cfg.api, '/wallet/balance', { method: 'GET' })); },
  async 'api-fake'() {
    setLast('Browser → API, fake token', await call(cfg.api, '/wallet/balance', { method: 'GET', headers: { Authorization: 'Bearer not.a.real-token' } }));
  },
  async 'as-token-direct'() {
    try {
      await call(cfg.as, '/token', { body: 'grant_type=authorization_code&code=fake', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    } catch {
      setLast('Browser → AS /token', 'The browser blocked the response (the AS sends no CORS headers for /token),\nbut the request WAS delivered: look at the diagram — the AS rejected it with 401 invalid_client.');
    }
  },
  async jwks() { setLast('AS public keys', await call(cfg.as, '/.well-known/jwks.json', { method: 'GET' })); },
  async attack() { await runAttack(false); },
  async 'attack-full'() { await runAttack(true); },
};

async function runAttack(full) {
  const out = $('#attack-out');
  out.hidden = false;
  out.textContent = full ? 'Running all 9 cases (about a minute)…' : 'Running…';
  const r = await call('', '/run/attack', { body: { full } });
  out.textContent = r.body.output ?? JSON.stringify(r.body);
}

document.querySelectorAll('button[data-action]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await ACTIONS[btn.dataset.action]();
    } catch (err) {
      setLast('Error', String(err));
      toast(String(err));
    } finally {
      btn.disabled = false;
      refreshState();
    }
  });
});

// ---------- live state ----------

let lastState = null;
async function refreshState() {
  try {
    const [s, c] = await Promise.all([taxi('/api/state', { method: 'GET' }), call(cfg.api, '/debug/counter', { method: 'GET' })]);
    lastState = { ...s.body, counter: c.body.charge_counter, fetchedAt: Date.now() };
    const select = $('#user');
    if (select.options.length !== s.body.users.length) {
      select.innerHTML = s.body.users.map((u) => `<option value="${u.id}">${esc(u.display_name)}</option>`).join('');
    }
    select.value = s.body.user;
    paintState();
  } catch {
    $('#state').textContent = 'Taxi or Wallet API not reachable. Are all three services running?';
  }
}

function paintState() {
  if (!lastState) return;
  const { link, rides, counter } = lastState;
  const left = link.access_exp ? Math.round(link.access_exp - (lastState.now + (Date.now() - lastState.fetchedAt) / 1000)) : null;
  const exp = left === null ? '—' : left > 0 ? `in ${left}s` : `expired ${-left}s ago`;
  const pending = rides.filter((r) => r.status === 'pending').length;
  const charged = rides.filter((r) => r.status === 'charged').length;
  $('#state').innerHTML = [
    ['Wallet link', `<span class="badge ${link.status}">${link.status}</span>`],
    ['Scope', link.scope ? esc(link.scope) : '—'],
    ['Access token', link.access_fp ? `<code>${link.access_fp}</code> exp ${exp}` : '—'],
    ['Refresh token', link.refresh_fp ? `<code>${link.refresh_fp}</code>` : '—'],
    ['Rides', `${pending} pending / ${charged} charged`],
    ['API charge counter', `<b>${counter}</b>`],
  ].map(([k, v]) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`).join('');
}

$('#user').addEventListener('change', async (e) => {
  await taxi('/api/user', { body: { user: e.target.value } });
  refreshState();
});

setInterval(refreshState, 2500);
setInterval(paintState, 1000);
refreshState();
render();
