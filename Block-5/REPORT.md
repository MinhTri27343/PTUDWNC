# Block 5 — Report

Evidence files referenced here are generated from real runs (see README §5) and live in `evidence/`.

## 1. Access token contract

ES256 JWT, header `kid` (RFC 7638 thumbprint), `typ: at+jwt`. Claims: `iss` = AS URL, `aud` = `wallet-api`, `sub`, `client_id`, `scope`, `iat`, `exp` (+120 s), `jti`, `principal_type` (`user` | `client`).
Lab TTLs: authorization code 60 s, access token 120 s, refresh token 7 days (env-overridable).

## 2. AS check table

| # | Endpoint | Check (in order) | Response on failure | Attack it blocks |
|---|---|---|---|---|
| A1 | `/authorize` | `client_id` exists and has a browser flow | 400 AS error page, **no redirect** | Phishing via unknown client |
| A2 | `/authorize` | `redirect_uri` equals the registered string exactly | 400 AS error page, **no redirect** | Open redirect / code theft to attacker URI (case 1) |
| A3 | `/authorize` | `response_type=code` | 302 `error=unsupported_response_type` + `state` | Implicit-flow token leakage |
| A4 | `/authorize` | `code_challenge` present (43-char base64url) and `code_challenge_method=S256` | 302 `error=invalid_request` + `state` | Authorization-code interception without PKCE (case 2) |
| A5 | `/authorize` | `scope` non-empty and ⊆ client `allowed_scopes` | 302 `error=invalid_scope` + `state` | Scope escalation by the client |
| A6 | `/authorize` | login (argon2id verify, CSRF token, session regenerated) | 401 login page | Credential stuffing surface, CSRF, session fixation |
| A7 | `/consent` | Alice explicitly approves (CSRF); Deny | 302 `error=access_denied` + `state` | Silent grants |
| A8 | `/authorize` | every redirect echoes `state` unchanged | — | CSRF on the client's callback |
| T1 | `/token` | HTTP Basic client auth vs argon2id hash (timing equalised for unknown clients) | 401 `invalid_client` + `WWW-Authenticate` | Wrong/stolen client id (case 6) |
| T2 | `/token` code | code exists | 400 `invalid_grant` | Guessed codes |
| T3 | `/token` code | not already used; **single transaction** burns it | 400 `invalid_grant`, refresh family issued from it revoked | Code replay, double redemption race (case 3) |
| T4 | `/token` code | not expired | 400 `invalid_grant` | Late use of a stolen code (case 4) |
| T5 | `/token` code | issued to the authenticated client | 400 `invalid_grant` | Another client redeeming the code (case 7) |
| T6 | `/token` code | `redirect_uri` equals the authorize request | 400 `invalid_grant` | Redirect substitution |
| T7 | `/token` code | `BASE64URL(SHA-256(code_verifier)) == code_challenge` (timing-safe) | 400 `invalid_grant` | Intercepted code without the verifier (case 5) |
| T8 | `/token` refresh | token exists, belongs to this client, not revoked, not expired | 400 `invalid_grant` | Stolen refresh token used by another client (case 9) |
| T9 | `/token` refresh | not already used (rotation) | 400 `invalid_grant` + **whole family revoked** | Replay of an old refresh token (case 8) |
| T10 | `/token` refresh | consent not revoked; requested scope ⊆ original ∩ approved | 400 `invalid_grant` / `invalid_scope` | Using access after revocation; scope widening |
| T11 | `/token` client_credentials | client registered for the grant; scope ⊆ allowed | 400 `unauthorized_client` / `invalid_scope` | Wrong client minting tokens, over-broad scope |

Design decisions (see `PLAN.md`):

- A code is **burned by the first attempt that passes client authentication**, even when a later check fails (verifier, client, redirect URI). An attacker therefore cannot try several `code_verifier` values against one code. Trade-off: anyone holding valid client credentials who knows a code can burn it (denial of service, no token disclosure). Bad client credentials never touch the code (T1 runs first).
- For `authorization_code` and `refresh_token` the artifact-ownership check (T5, T8) comes **before** any grant-type gate. `taxi-m2m` is only allowed `client_credentials`, so a gate-first order would answer `unauthorized_client` instead of the `invalid_grant` the assignment expects for cases 7 and 9. Ownership implies the client was authorized for the grant when the artifact was issued.
- A refresh attempt by a different client is rejected **without** revoking the owner's family (otherwise any registered client could log Alice out of Taxi). Reuse of the owner's own old token does revoke the family.
- Refresh tokens and codes are random 32-byte strings; the DB stores only SHA-256 hashes. Client secrets are argon2id hashes.
- The new refresh token keeps the original scope ceiling even when the access token was narrowed on refresh.

## 3. Attack script before / after

- Before (baseline AS without checks): `evidence/attack-before.txt` — control OK, **0/9 blocked**.
- After: `evidence/attack-after.txt` — control OK, **9/9 blocked** with the expected status and OAuth error code.

## 4. Redirect trace, payment job, grant table, revocation

- `evidence/redirect-trace.txt` — Taxi → AS → Taxi, codes/states/challenges redacted; the browser never sees a token.
- `evidence/payment-job-log.txt` — no session, stale access token (`exp` timestamps shown), refresh then charge; Wallet API counter 0 → 1, a second run keeps it at 1.
- `evidence/grant-table.md` — filled from observed `/token` responses and the decoded claims, with the RFC 6749 §5.1 check (`Cache-Control: no-store`, `Pragma: no-cache`, `token_type`, `expires_in`, `refresh_token` rules).
- `evidence/revocation.txt` — Alice revokes Taxi; the next refresh returns `invalid_grant` and Taxi becomes *unlinked*.

## 5. Revocation policy

Alice revokes Taxi at `/account`. The AS, in one transaction, sets `consents.revoked_at` and `refresh_tokens.revoked_at` for **every** refresh family of the (Alice, Taxi) pair. Taxi's next refresh gets `400 invalid_grant` and Taxi marks the wallet *unlinked*; other apps' consents are untouched.

**Access tokens already issued remain valid until `exp`** (≤ 120 s in the lab). The Wallet API verifies JWTs offline against the JWKS and does not ask the AS per request, so revocation cannot reach it earlier. `evidence/revocation.txt` shows a balance call succeeding right after revocation. Mitigations: keep the access token lifetime short (chosen), or add token introspection (RFC 7662) / a revocation list for sensitive endpoints such as `POST /wallet/charges`, at the cost of a per-request dependency on the AS.

## 6. Trade-offs and limitations: lab AS vs a production AS (e.g. Keycloak)

| Topic | This lab | Production AS |
|---|---|---|
| Scope of protocol | auth code + PKCE, refresh, client credentials | Also OIDC (ID token, discovery, userinfo), device flow, token exchange, DPoP/mTLS sender-constrained tokens |
| Key management | One ES256 key from an env var, no rotation; JWKS has a single key | KMS/HSM, scheduled rotation with overlapping keys in the JWKS |
| Transport | `http://localhost` (openid-client run with `allowInsecureRequests`) | HTTPS everywhere, `Secure` cookies, HSTS |
| Sessions / CSRF | In-memory `express-session`, CSRF token on forms | Persistent session store, SameSite policy, logout, SSO, MFA |
| Abuse protection | None (no rate limit, lockout, bot defence) | Rate limiting, brute-force lockout, audit trail, alerting |
| Client registration | Two seeded clients, one redirect URI each | Admin UI / dynamic registration, multiple URIs, client policies |
| Token storage in Taxi | Refresh token in SQLite as plaintext, server side only | Encrypted at rest (KMS), secrets manager |
| Revocation | Consent + refresh families; access tokens live to `exp` | Plus introspection/revocation endpoints (RFC 7009/7662), back-channel logout |
| Concurrency | SQLite immediate transactions in one process | Database-level locking across replicas |
| Testing | Hand-written unit/acceptance tests and an attack script | Conformance suites, pen tests, long-term maintenance by a vendor/community |

Known limitations of this lab: `/authorize` accepts only a single registered `redirect_uri`; a code is delivered to the browser by redirect and is therefore visible in the address bar (mitigated by single use, 60 s TTL and PKCE); the burn-on-first-attempt rule allows a registered client to waste a victim's code; `GET /debug/counter` and `GET /lab/pkce` are unauthenticated lab helpers and must not exist in production.
