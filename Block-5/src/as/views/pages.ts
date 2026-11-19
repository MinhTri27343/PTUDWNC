import { escapeHtml as h } from '../../util.js';

const SCOPE_LABELS: Record<string, string> = {
  'wallet:read': 'View your wallet balance',
  'wallet:charge': 'Charge your wallet',
  offline_access: 'Keep access when you are not using the app',
};

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(title)} — Wallet</title>
<style>
  body{font-family:system-ui,sans-serif;background:#f4f6f8;margin:0;display:flex;justify-content:center;padding:48px 16px;color:#1b2430}
  main{background:#fff;border-radius:12px;box-shadow:0 2px 12px #0001;padding:32px;max-width:420px;width:100%}
  h1{font-size:1.25rem;margin:0 0 4px} p.sub{color:#5b6775;margin:0 0 20px}
  label{display:block;font-size:.85rem;margin:12px 0 4px} input[type=text],input[type=password]{width:100%;padding:10px;border:1px solid #c5ccd5;border-radius:8px;box-sizing:border-box}
  button{padding:10px 18px;border:0;border-radius:8px;font-size:1rem;cursor:pointer}
  .primary{background:#0b5fff;color:#fff} .ghost{background:#e8ecf1;color:#1b2430}
  .row{display:flex;gap:10px;margin-top:20px} ul{padding-left:20px} .err{color:#b3261e} .hint{font-size:.8rem;color:#7a8594;margin-top:16px}
  code{background:#eef1f5;padding:1px 5px;border-radius:4px}
</style></head><body><main>${body}</main></body></html>`;
}

export function loginPage(opts: { csrf: string; clientName?: string; error?: string }): string {
  return layout(
    'Sign in',
    `<h1>Sign in to Wallet</h1>
<p class="sub">${opts.clientName ? `${h(opts.clientName)} wants to access your wallet.` : 'Manage the apps connected to your wallet.'}</p>
${opts.error ? `<p class="err">${h(opts.error)}</p>` : ''}
<form method="post" action="/login">
  <input type="hidden" name="csrf" value="${h(opts.csrf)}">
  <label for="u">Username</label><input id="u" name="username" type="text" autocomplete="username" required>
  <label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
  <div class="row"><button class="primary" type="submit">Sign in</button></div>
</form>
<p class="hint">Lab accounts: <code>alice</code> / <code>alice-pass</code>, <code>bob</code> / <code>bob-pass</code></p>`,
  );
}

export function consentPage(opts: {
  csrf: string;
  clientName: string;
  userName: string;
  scopes: string[];
}): string {
  const items = opts.scopes
    .map((s) => `<li><strong>${h(SCOPE_LABELS[s] ?? s)}</strong> <code>${h(s)}</code></li>`)
    .join('');
  return layout(
    'Authorize',
    `<h1>Authorize ${h(opts.clientName)}</h1>
<p class="sub">Signed in as ${h(opts.userName)}. ${h(opts.clientName)} is requesting permission to:</p>
<ul>${items || '<li>(no scopes)</li>'}</ul>
<form method="post" action="/consent">
  <input type="hidden" name="csrf" value="${h(opts.csrf)}">
  <div class="row">
    <button class="primary" type="submit" name="decision" value="approve">Allow</button>
    <button class="ghost" type="submit" name="decision" value="deny">Deny</button>
  </div>
</form>`,
  );
}

export function accountPage(opts: {
  csrf: string;
  userName: string;
  apps: { client_id: string; name: string; scope: string }[];
  message?: string;
}): string {
  const rows = opts.apps
    .map(
      (a) => `<li><strong>${h(a.name)}</strong> <code>${h(a.scope)}</code>
  <form method="post" action="/account/revoke" style="display:inline">
    <input type="hidden" name="csrf" value="${h(opts.csrf)}"><input type="hidden" name="client_id" value="${h(a.client_id)}">
    <button class="ghost" type="submit">Revoke access</button></form></li>`,
    )
    .join('');
  return layout(
    'Account',
    `<h1>Connected apps</h1>
<p class="sub">Signed in as ${h(opts.userName)}.</p>
${opts.message ? `<p>${h(opts.message)}</p>` : ''}
<ul>${rows || '<li>No apps have access to your wallet.</li>'}</ul>
<form method="post" action="/logout"><input type="hidden" name="csrf" value="${h(opts.csrf)}"><button class="ghost" type="submit">Sign out</button></form>`,
  );
}

/** Shown on the AS itself (never redirected to the client) for unsafe redirect situations. */
export function errorPage(opts: { title: string; message: string }): string {
  return layout(opts.title, `<h1 class="err">${h(opts.title)}</h1><p>${h(opts.message)}</p>`);
}
