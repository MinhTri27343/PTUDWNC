# Block 5 — Wallet Authorization Server (OAuth 2.0 + PKCE)

Three small services plus a visualizer, one repo. Scenario: **Taxi** charges **Alice**'s wallet after each ride, even when she is not in the app.

| App | URL | Role |
|---|---|---|
| Wallet AS | http://localhost:4000 | Authorization server: login, consent, `/authorize`, `/token`, JWKS, account page. **The focus of this lab.** |
| Wallet API | http://localhost:4001 | Resource server: verifies ES256 access tokens offline via JWKS |
| Taxi | http://localhost:4002 | OAuth client backend (`openid-client`): JSON API, `/callback`, payment job. **No UI of its own.** |
| **Flow UI** | http://localhost:4003 | **Independent visualizer** of the OAuth2 + PKCE flow. Not the frontend of any service. |

Swagger UI: AS `http://localhost:4000/docs`, Wallet API `http://localhost:4001/docs`.
Lab accounts (fake): `alice` / `alice-pass`, `bob` / `bob-pass`. Lab only — use a vetted AS such as Keycloak in production.

## Requirements

Node.js >= 20.12 (tested on 22). SQLite is embedded (`better-sqlite3`), no Docker.

```bash
npm install
```

## 1. Generate keys and secrets

```bash
npm run keygen
```

Writes `.env` (git-ignored) with a fresh **ES256** private key (PKCS8 PEM; `kid` is derived at start-up as the RFC 7638 thumbprint, so there is nothing to set) and random lab client secrets. Re-run with `-- --force` to rotate. Never commit `.env`.

## 2. Create and seed the databases

```bash
npm run db:reset
```

Deletes `data/*.db`, applies the migrations (`migrations/{as,api,taxi}`) and seeds users, the two clients (`taxi-web`, `taxi-m2m`; secrets stored as argon2id hashes), wallets and one pending ride.

## 3. Start the apps (one terminal each)

```bash
npm run as
```

```bash
npm run api
```

```bash
npm run taxi
```

```bash
npm run flow
```

## 4. Flow UI — the way to demo (http://localhost:4003)

The Flow UI shows **real traffic**: your browser calls Taxi, the Wallet AS and the Wallet API directly, and each of them streams the HTTP exchanges and decisions it really handled (`GET /_flow/stream`, Server-Sent Events). The page draws them as a sequence diagram with lanes *Browser · Taxi · Wallet AS · Wallet API (· Attacker)*. Click any arrow for the full request/response and a plain-language explanation. Codes, states, challenges and tokens are shown only as fingerprints such as `<code:867d63bf>`; **click a fingerprint to follow the same value through the flow** (e.g. `state` returns unchanged; the `code` in the redirect is the one sent to `/token`).

**Reset demo (start over)** (top right) puts all three services back to their freshly seeded state without restarting anything or running `db:reset`: consents, codes and refresh tokens wiped, Taxi unlinked, balances restored, charge counter 0, one pending ride, everyone signed out, diagram cleared. **Clear diagram** only wipes the picture.

Buttons on the left, in presentation order:

1. **Link wallet** → opens the Wallet AS in a popup (allow popups for `localhost:4003`). Sign in `alice` / `alice-pass`, press **Allow**. Diagram: `POST /api/link/start` → `/authorize` → `/login` → `/consent` → `/callback` → Taxi→AS `POST /token` (+ `pkce_check`, `code_burned` decisions) → *Wallet linked*. Then **Show balance** (Taxi → API, JWT verified offline).
2. **Make access token stale** + **Run payment job** (or the one-click button): refresh with rotation, then a single charge; the live-state panel shows the access/refresh token fingerprints change and the API charge counter.
3. **Open AS account page** → *Revoke access*, then run the job again: `invalid_grant`, Taxi becomes *unlinked*.
4. **Taxi M2M reads public rates** / **Try to charge with a client token** (`client_credentials`; the charge gets 403).
5. **What the browser can't do**: call the API without a token or with a fake one (401), call `/token` directly (the browser blocks the response — no CORS — yet the AS still logged and rejected it), read the public JWKS.
6. **Run attacks**: runs `scripts/attack.ts`; its requests show up on the *Attacker* lane with the AS's decisions (`token_rejected reason=…`, `refresh_family_revoked`). "Fast" skips the 60 s expired-code case.

The services expose `/_flow/*` and CORS for the Flow UI origin only for this lab; they must not exist in production.

## 5. Demo from the command line (no UI)

1. **Link wallet:** use the Flow UI (§4) — the Taxi backend has no screen of its own. The browser only ever sees `code` and `state`; Taxi exchanges the code server-to-server.
2. **Payment job (no user session, expired access token):**
   ```bash
   npm run taxi:job -- --expire
   ```
   `--expire` simulates "Alice left more than 2 minutes ago". The job refreshes, charges, and the Wallet API counter goes 0 → 1; running it again charges nothing.
3. **Attack script** (calls the AS directly; the "expired code" case waits CODE_TTL+2 = 62 s):
   ```bash
   npm run attack
   ```
   For a quick run start the AS with `CODE_TTL_SECONDS=2` and use `npm run attack -- --wait=3`.
4. **Revocation:** sign in at http://localhost:4000/account as Alice → *Revoke access*. Taxi's next refresh gets `invalid_grant` and Taxi becomes *unlinked*.
5. **Client Credentials:** in Swagger (`:4000/docs`) *Authorize* with `taxi-m2m` and call `POST /token` with `grant_type=client_credentials`, then use the token on the Wallet API (`/public/rates` 200, `/wallet/charges` 403).

## 6. Generate all evidence

With a **fresh** `npm run db:reset` and the three apps running:

```bash
npm run evidence
```

Writes into `evidence/`: `attack-after.txt`, `redirect-trace.txt`, `payment-job-log.txt`, `grant-table.md`, `revocation.txt`. `evidence/attack-before.txt` was captured earlier, against the baseline AS that had no `/authorize` / `/token` checks.
Codes, states, challenges and tokens are replaced by labelled fingerprints (e.g. `<code:867d63bf>`); nothing secret is written.

## Tests

```bash
npm test
```

60 tests on a throw-away SQLite file per suite (authorize, token, refresh/revocation/client-credentials, flow redaction/tap). `npm run typecheck` runs `tsc`.

## Libraries (versions as installed)

express 5.3.0 · express-session 1.19.0 · better-sqlite3 11.10.0 · **jose 5.10.0** (ES256 sign/verify, JWKS) · **argon2 0.41.1** (argon2id) · **openid-client 6.8.8** (Taxi: state + PKCE S256 + client_secret_basic) · swagger-ui-express 5.0.1 · yaml 2.9.1 · dotenv 16.6.1 · tsx 4.23.15 · typescript 5.9.3 · vitest 2.1.9 · supertest 7.3.1.
Libraries only do JWT, hashing, randomness and Taxi's client side. The protocol logic (check order, single-use code transaction, refresh rotation and family revocation, consent/scope checks) is hand-written in `src/as/routes/authorize.ts`, `src/as/routes/token.ts` and `src/as/services/grants.ts`.

## Layout

```
src/as/          Authorization server (routes/, services/grants.ts, keys.ts, views/)
src/wallet-api/  Resource server (verify.ts = offline JWT verification)
src/taxi/        OAuth client backend: app.ts (JSON API), oauthClient.ts, tokenManager.ts (per-user lock), paymentJob.ts
src/flow/        Event tap (bus.ts) + redaction (redact.ts) shared by the three services
src/flow-ui/     The Flow UI: server.ts + public/ (index.html, app.js, style.css)
migrations/      as/ api/ taxi/ (.sql)
openapi/         as.yaml, wallet-api.yaml (Swagger UI)
scripts/         keygen, seed, reset, attack, evidence
evidence/        generated output (before/after attack, trace, job log, grant table, revocation)
tests/           vitest suites
```

See `PLAN.md` (decisions agreed before coding) and `REPORT.md` (check table, revocation policy, trade-offs).
