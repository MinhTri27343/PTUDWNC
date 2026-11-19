# PLAN — Block 5: Wallet AS (OAuth2 + PKCE)

> Nguồn: `teacher-requirements.md` (block-05-assignment) + `knowledge.md` (api-security-interactive, trang 27–40).
> Trạng thái: **v2 — đã approve và implement xong P0–P7** (xem README, REPORT, evidence/).
> Ghi chú khi implement: với `authorization_code` / `refresh_token`, kiểm tra chủ sở hữu (code/refresh thuộc client nào) đặt TRƯỚC grant gate để case 7 và 9 trả đúng `invalid_grant` (`taxi-m2m` chỉ có `client_credentials`); chi tiết ở REPORT §2.
> Đã chốt: Node + TypeScript · SQLite · **làm đủ toàn bộ yêu cầu đề (kể cả Revocation, Client Credentials)** · demo được qua Swagger UI + giao diện Taxi · script tự sinh evidence + REPORT.md.
> Sản phẩm cuối là AS **đúng chuẩn OAuth2 + PKCE**. Mốc "before" (chưa có check) chỉ là một bước trung gian để lấy output so sánh theo đề, được viết đè thành bản đúng ở P1–P3.

---

## 0. Phạm vi

| Giai đoạn                | Nội dung                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| P0 Khung                 | 3 app + attack script; `/authorize`, `/token` chưa có check → chạy attack, lưu output _before_                                 |
| P1 `/authorize`          | Check client/redirect/PKCE/scope, login, consent, phát code                                                                    |
| P2 `/token` (code)       | Client auth, check code, transaction dùng-một-lần, reuse → thu hồi                                                             |
| P3 Refresh + payment job | Rotation, family revoke, check client/consent/scope, job chạy không session                                                    |
| P4 Rerun attack          | Output _after_ (9 case đều bị chặn đúng mã lỗi)                                                                                |
| P5 Revocation            | Trang account của AS, revoke consent + mọi refresh family, Taxi chuyển unlinked, tài liệu policy access token còn hạn          |
| P6 Client Credentials    | `taxi-m2m`, scope ⊆ allowed, `sub=client_id`, `principal_type=client`, không refresh; `/public/rates`, 403 ở `/wallet/charges` |
| P7 Demo & evidence       | Swagger UI, giao diện Taxi, grant table từ response thật, redirect trace, payment log, REPORT.md                               |

### Khả năng demo

- **Swagger UI** (OpenAPI 3.1, `swagger-ui-express`):
  - AS `http://localhost:4000/docs`: `POST /token` (Basic auth, thử `authorization_code`, `refresh_token`, `client_credentials`), `GET /.well-known/jwks.json`.
  - Wallet API `http://localhost:4001/docs`: nút Authorize dán Bearer token, thử `balance`, `charges`, `rates`.
  - `/authorize` là redirect qua trình duyệt nên Swagger không chạy tới cuối được; trong docs có link mở thẳng và mô tả tham số.
- **Taxi UI** `http://localhost:4002`: nút Link wallet, Xem số dư, Chạy payment job, Hiển thị trạng thái link/unlink và counter. Token không bao giờ hiện ra trình duyệt.
- **Trang account AS** `/account`: Alice xem và revoke quyền của Taxi.
- **Attack script** + **payment job** chạy bằng npm script, in bảng kết quả.

---

## 1. Stack & cấu trúc repo

Node ≥ 20, TypeScript, ESM, `tsx`, `vitest` (giống Block-1). Một `package.json`, 3 app chạy 3 port.

| App           | Port | Thư viện chính                                                                        |
| ------------- | ---- | ------------------------------------------------------------------------------------- |
| Wallet AS     | 4000 | `express`, `better-sqlite3`, `jose` (ES256/JWKS), `argon2` (argon2id)                 |
| Wallet API    | 4001 | `express`, `jose` (`createRemoteJWKSet`, verify offline), `better-sqlite3`            |
| Taxi          | 4002 | `express`, `express-session`, **`openid-client` v6** (state + PKCE), `better-sqlite3` |
| Attack script | —    | `fetch` thuần + cookie jar tự viết nhỏ (gọi AS trực tiếp qua HTTP)                    |

Libs chỉ lo JWT / hash / random; **logic giao thức (check list, thứ tự, transaction, rotation) tự viết**.

```
Block-5/
  PLAN.md  README.md  REPORT.md  .env.example
  src/
    as/        app.ts server.ts config.ts db.ts keys.ts
               routes/{authorize,token,jwks,login}.ts
               services/{codes,tokens,refresh,consent}.ts
               views/{login,consent,error}.ts
    wallet-api/  app.ts server.ts verify.ts routes/{wallet,public}.ts
    taxi/        app.ts server.ts oauthClient.ts store.ts paymentJob.ts
  migrations/    as/001_init.sql  api/001_init.sql  taxi/001_init.sql
  scripts/       keygen.ts  seed.ts  reset.ts  attack.ts  evidence.ts
  evidence/      (sinh tự động, đã redact)
  tests/         vitest cho từng check
```

---

## 2. Quyết định thiết kế

### 2.1 Access token contract

- JWT **ES256**, header `kid` = RFC 7638 thumbprint của public key (tự sinh).
- Claims: `iss=http://localhost:4000`, `aud=wallet-api`, `sub`, `client_id`, `scope` (chuỗi cách nhau bằng dấu cách), `iat`, `exp = +120s`, `jti`, `principal_type=user|client`.
- Private key trong env `AS_PRIVATE_KEY_PEM` (PKCS8); `npm run keygen` ghi vào `.env` (gitignore). `/.well-known/jwks.json` chỉ chứa public JWK.
- Wallet API verify: chữ ký (JWKS, cache), `iss`, `aud`, `exp`, rồi check scope + `principal_type` theo route.
- TTL: code 60s, access 120s, refresh 7 ngày — đọc từ env để attack script có chế độ `--fast` (xem case expired code).

### 2.2 Schema AS (SQLite)

- `users(id, username, password_hash)` — alice, bob (argon2id, dữ liệu giả).
- `clients(client_id, secret_hash, redirect_uri, allowed_scopes, grant_types)` — `taxi-web`, `taxi-m2m`.
- `consents(id, user_id, client_id, scope, created_at, revoked_at)` — unique (user, client) còn hiệu lực.
- `auth_codes(code_hash, client_id, user_id, redirect_uri, scope, code_challenge, expires_at, used_at, family_id)` — `family_id` ghi lại family refresh token sinh từ code này (để thu hồi khi reuse).
- `refresh_tokens(token_hash, family_id, client_id, user_id, scope, expires_at, revoked_at, replaced_by, created_at)`.
- Code / refresh token: random 32 byte base64url, **DB chỉ lưu SHA-256**. Secret client: argon2id.

### 2.3 `/authorize` — thứ tự check & nơi báo lỗi

| #   | Check                                                                                                | Lỗi                         | Cách báo                              |
| --- | ---------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------- |
| 1   | `client_id` tồn tại                                                                                  | —                           | **Trang lỗi AS**, 400, không redirect |
| 2   | `redirect_uri` khớp **chính xác** chuỗi đã đăng ký                                                   | —                           | **Trang lỗi AS**, 400, không redirect |
| 3   | `response_type=code`                                                                                 | `unsupported_response_type` | redirect + `state`                    |
| 4   | `code_challenge` có và `code_challenge_method=S256` (reject `plain`)                                 | `invalid_request`           | redirect + `state`                    |
| 5   | `scope` ⊆ `allowed_scopes` của client, không rỗng                                                    | `invalid_scope`             | redirect + `state`                    |
| 6   | Chưa login → form login (CSRF token), argon2 verify                                                  | —                           | trang AS                              |
| 7   | Consent screen; **Deny**                                                                             | `access_denied`             | redirect + `state`                    |
| 8   | Approve → lưu consent, sinh code, lưu `SHA-256(code)` + client, redirect_uri, user, scope, challenge | —                           | 302 `redirect_uri?code=…&state=…`     |

`state` được trả nguyên vẹn ở **mọi** redirect (kể cả lỗi); nếu client không gửi `state` thì không thêm.

### 2.4 `/token` — authorization_code

1. Xác thực client bằng HTTP Basic (urldecode `id:secret`) so với hash → sai: **401 `invalid_client`** + `WWW-Authenticate: Basic`.
2. `grant_type` được hỗ trợ và client được phép dùng → else `unsupported_grant_type` / `unauthorized_client`.
3. Trong **một transaction** (`BEGIN IMMEDIATE`):
   - `UPDATE auth_codes SET used_at=now WHERE code_hash=? AND used_at IS NULL` → `changes==1` mới đi tiếp (chặn 2 request đồng thời cùng đổi code).
   - Nếu `changes==0` mà row tồn tại với `used_at` ≠ null → **reuse**: revoke family refresh sinh từ code đó → 400 `invalid_grant`.
   - Check: code tồn tại, chưa hết hạn, `client_id` khớp, `redirect_uri` khớp, `base64url(SHA-256(code_verifier)) == code_challenge` (so sánh timing-safe) → sai: 400 `invalid_grant` (rollback thì code vẫn bị đánh dấu dùng? → **Quyết định:** code bị đốt ngay khi có bất kỳ lần đổi nào _tới được bước check_, kể cả verifier sai, để attacker không thử verifier nhiều lần).
   - Phát access token; nếu scope có `offline_access` → sinh refresh token + family mới, ghi `family_id` vào auth_code.
4. Response `Cache-Control: no-store`, `Pragma: no-cache`, body `{access_token, token_type:"Bearer", expires_in:120, scope, refresh_token?}`. Mọi lỗi theo RFC 6749 §5.2.

### 2.5 `/token` — refresh_token

- Tìm theo hash → transaction: `UPDATE … SET replaced_by=? WHERE token_hash=? AND replaced_by IS NULL AND revoked_at IS NULL`.
- Token không tồn tại / hết hạn / `client_id` ≠ client xác thực → `invalid_grant` (case khác client: **không** thu hồi family, chỉ từ chối).
- Token đã `replaced_by` (bị dùng lại) → **revoke cả family** → `invalid_grant`.
- Consent đã `revoked_at` → `invalid_grant`.
- `scope` yêu cầu (nếu có) ⊆ scope của token cũ **và** ⊆ scope consent → else `invalid_scope`; mặc định giữ scope cũ.
- Thành công: cấp access mới + refresh mới cùng `family_id`.

### 2.6 Wallet API

- `GET /wallet/balance` (`wallet:read`), `POST /wallet/charges` (`wallet:charge` + `principal_type=user`), `GET /public/rates` (`rates:read`).
- 401 (thiếu/sai/hết hạn token, `WWW-Authenticate: Bearer`), 403 (thiếu scope / sai principal_type).
- `POST /wallet/charges` bắt buộc header `Idempotency-Key`; bảng `idempotency_keys` + `charge_counter`; cùng key → trả lại kết quả cũ, **không** tăng counter. `GET /wallet/charges/stats` (hoặc `/debug/counter`) trả counter để làm bằng chứng.

### 2.7 Taxi

- `/link` → `openid-client` (cấu hình thủ công `Configuration`, không cần discovery) sinh `state` + `code_verifier` PKCE, lưu trong session phía server → redirect AS.
- `/callback` → `authorizationCodeGrant` (gửi qua back-channel, Basic auth); lưu refresh token + access token trong `taxi.db` (server-side), **trình duyệt không thấy token**; log redact.
- `/balance` → dùng access token, tự refresh nếu hết hạn.
- `paymentJob.ts` (`npm run taxi:job`): không cần session; với mỗi user _tuần tự_ (mutex per user) → access hết hạn → refresh → lưu **refresh mới ngay** (ghi đè trước khi gọi charge) → `POST /wallet/charges` với `Idempotency-Key = ride-id`. Log `exp` trước/sau + counter.
- Refresh trả `invalid_grant` → đánh dấu unlinked (chuẩn bị cho P5).

### 2.8 Attack script (`scripts/attack.ts`)

Gọi AS trực tiếp qua HTTP, tự đăng nhập Alice (cookie jar), in `case | HTTP status | error | kết luận (BLOCKED/NOT BLOCKED)`:

| #   | Case                                  | Mong đợi (sau khi làm)                                   |
| --- | ------------------------------------- | -------------------------------------------------------- |
| 1   | `redirect_uri` chưa đăng ký           | 400 trang lỗi AS, không có `Location`                    |
| 2   | Thiếu `code_challenge`                | 302 → `error=invalid_request&state=…`                    |
| 3   | Reuse code                            | 400 `invalid_grant` (+ refresh family từ code bị revoke) |
| 4   | Code hết hạn                          | 400 `invalid_grant` (`--fast`: TTL 2s; mặc định chờ 61s) |
| 5   | Sai `code_verifier`                   | 400 `invalid_grant`                                      |
| 6   | Sai client secret                     | 401 `invalid_client`                                     |
| 7   | Code đổi bởi client khác (`taxi-m2m`) | 400 `invalid_grant`                                      |
| 8   | Replay refresh cũ                     | 400 `invalid_grant` + family bị revoke                   |
| 9   | Refresh bằng client khác              | 400 `invalid_grant`                                      |

---

## 3. Thứ tự thực hiện

1. **P0:** scaffold, keygen, seed, migrations, JWKS, Wallet API, Taxi tối thiểu, AS ngây thơ (không check) + `attack.ts` → chạy, lưu `evidence/attack-before.txt` (kết quả đa số `NOT BLOCKED`).
2. **P1** `/authorize` + login/consent + test.
3. **P2** `/token` code exchange + test (gồm test race 2 request đồng thời).
4. **P3** refresh + payment job; kiểm tra counter = 1.
5. **P4** chạy lại attack → `evidence/attack-after.txt`.
6. `evidence.ts` sinh: redirect trace (redact), payment job log (kèm `exp`), AS check table, bảng grant (phần đã có). Viết README + REPORT.md (trade-off lab AS vs Keycloak).
7. P5 Revocation, P6 Client Credentials, P7 Swagger + Taxi UI + grant table đủ dòng.

Thêm vào các phần trước:

- **Revocation (2.9):** `POST /account/revoke` set `consents.revoked_at`, revoke mọi `refresh_tokens` của cặp (Alice, taxi-web); refresh kế tiếp → `invalid_grant`, Taxi chuyển unlinked. Policy: Wallet API verify offline nên access token còn hiệu lực tới `exp` (≤120s); ghi rõ vào REPORT.
- **Client Credentials (2.10):** chỉ client có `client_credentials` trong `grant_types`; scope yêu cầu ⊆ allowed (sai → `invalid_scope`); không trả `refresh_token`; `principal_type=client`.

Mỗi bước: inspect → implement → run → test → verify. Không đưa secret/key/token thật vào prompt, log hay evidence (chỉ nhãn + timestamp).

---

## 4. Rủi ro / ghi chú

- Access token đã phát không thu hồi được ngay (verify offline) → ghi vào revocation policy ở P5.
- Lab dùng `http://localhost`; production bắt buộc HTTPS, cookie `Secure`, rate limit, audit log, key rotation, HSM/KMS — đưa vào trade-off note.
- `openid-client` v6 chặn HTTP không-TLS theo mặc định → dùng option `allowInsecureRequests` chỉ cho lab (ghi rõ trong README).
