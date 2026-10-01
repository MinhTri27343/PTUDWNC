# PLAN — Cart API (Block 1: OpenAPI, validation, error contract, logging)

> Nguồn: `RESTful API có contract_ OpenAPI, validation và logging.html`
> Trạng thái: **DRAFT — chờ bạn chỉnh**. Các mục đánh dấu `[CHỌN]` là quyết định mặc định của tôi, bạn có thể đổi.

---

## 0. Tóm tắt yêu cầu (để đối chiếu khi chấm)

| Hạng mục | Yêu cầu bắt buộc |
|---|---|
| Setup | README: lệnh tạo DB, migration, seed, reset, chạy server — chạy được trên máy sạch |
| API | 6 endpoint đúng method / path / status |
| Documentation | OpenAPI **3.1**, đủ mọi status, có example, `/docs` chạy được |
| Validation | **Cùng một nguồn schema** với spec; request sai **không chạm DB** |
| Error & logging | Mọi lỗi theo error contract (kể cả 500, lỗi của thư viện validator); log kèm `request_id` |
| Evidence | Script chạy lại được cho **mọi dòng** ma trận nghiệm thu |

Ngoài phạm vi: đăng nhập, checkout, thanh toán, frontend, giữ chỗ tồn kho / race condition.

---

## 1. Quyết định kỹ thuật `[CHỌN]`

| Vấn đề | Mặc định | Lý do / phương án thay thế |
|---|---|---|
| Runtime | Node.js 20+ + **TypeScript** + Express 4 | Phổ biến, nhiều thư viện OpenAPI. (Thay thế: JS thuần) |
| Hướng tiếp cận | **Contract-first**: `openapi.yaml` viết tay là nguồn duy nhất | Đúng tinh thần bài; spec dễ đọc khi trình bày. (Thay thế: code-first với zod + `@asteasolutions/zod-to-openapi` `OpenApiGeneratorV31`) |
| Validator | `express-openapi-validator` (đọc trực tiếp `openapi.yaml`) | Validate request **và** response từ cùng file. ⚠ Phải kiểm tra hỗ trợ 3.1 ở bước 2.0 |
| DB | PostgreSQL 16 chạy bằng **docker compose** | Máy sạch chỉ cần Docker; dễ "tắt PostgreSQL" để test 500 |
| Driver | `pg` (node-postgres), SQL thuần | Ít "ma thuật", dễ kiểm soát lỗi. (Thay thế: Knex / Drizzle / Prisma) |
| Migration | `node-pg-migrate` (file SQL) | Đúng tên bảng/cột/constraint của slide |
| Docs UI | Scalar (`@scalar/express-api-reference`) tại `/docs` | Hỗ trợ 3.1 tốt, "Try it" gửi request được. (Thay thế: swagger-ui-express) |
| Logging | `pino` + `pino-http` | JSON log, có `genReqId`, `redact` |
| Evidence | `vitest` + `supertest` chạy với DB thật + file `requests.http` để demo | Chạy lại được bằng 1 lệnh `npm run evidence` |

---

## 2. Thứ tự implementation

### Bước 2.0 — Spike kiểm tra công cụ (15')
- [ ] Cài `express-openapi-validator`, thử load 1 file spec `openapi: 3.1.0` tối thiểu.
- [ ] Xác nhận: `type: [string, 'null']` được chấp nhận; `format: uuid` được validate (`validateFormats: 'full'`/`true`); body `"2"` **không** bị ép thành `2`.
- [ ] Nếu 3.1 không chạy ổn → quyết định: (a) chuyển code-first zod, hoặc (b) dùng Ajv 2020 tự viết middleware đọc từ `openapi.yaml`. **Ghi lại kết quả vào README (trade-off).**

### Bước 2.1 — Khởi tạo project (10')
- [ ] `package.json`, `tsconfig.json`, ESLint (tuỳ chọn), `.env.example` (`DATABASE_URL`, `PORT`, `LOG_LEVEL`).
- [ ] `docker-compose.yml`: service `db` (postgres:16, port 5432, volume, healthcheck).
- [ ] Cấu trúc thư mục:
  ```
  openapi/openapi.yaml
  migrations/
  scripts/seed.ts, scripts/reset.ts
  src/app.ts            # build Express app (không listen) → dùng cho test
  src/server.ts         # listen
  src/db.ts             # pg Pool
  src/logger.ts
  src/errors.ts         # AppError + error handler
  src/routes/products.ts, src/routes/carts.ts
  src/services/cartService.ts
  src/repositories/*.ts
  tests/*.test.ts
  requests.http
  ```

### Bước 2.2 — Database: migration + seed + reset (20')
- [ ] Migration 001: tạo `products`, `carts`, `cart_items` **đúng nguyên văn** DDL trên slide (tên cột, CHECK, PK, FK `ON DELETE CASCADE`).
- [ ] Seed với **UUID cố định** (để test và `requests.http` dùng lại):
  | Product | price_cents | stock | is_active | Mục đích |
  |---|---|---|---|---|
  | P1 | 15000 | 20 | true | happy path |
  | P2 | 25000 | 5 | true | happy path / vượt stock |
  | P3 | 9900 | 100 | true | happy path |
  | P4 | 50000 | **0** | true | INSUFFICIENT_STOCK |
  | P5 | 30000 | 10 | **false** | PRODUCT_UNAVAILABLE |
  - Cart C_OPEN (`open`, rỗng) và C_CLOSED (`checked_out`).
- [ ] Script `reset`: drop schema → migrate up → seed (idempotent).
- [ ] npm scripts: `db:up`, `db:migrate`, `db:seed`, `db:reset`.

### Bước 2.3 — Viết `openapi.yaml` (OpenAPI 3.1) — NGUỒN SCHEMA DUY NHẤT (40')
- [ ] `components.schemas`:
  - `Product` (id, sku, name, price_cents, stock, is_active)
  - `ProductList` (`items`, `limit`, `offset`, `total`)
  - `AddItemRequest` — `additionalProperties: false`, required `[product_id, quantity]`, `product_id: uuid`, `quantity: integer 1..10`
  - `UpdateItemRequest` — `additionalProperties: false`, required `[quantity]`
  - `CartItem` (product_id, name, unit_price_cents, quantity, line_total_cents)
  - `Cart` (id, status enum, items[], subtotal_cents)
  - `Error` (code enum, message, details?: `[{field, issue}]`, request_id) — `details` chỉ bắt buộc khi `VALIDATION_ERROR`
- [ ] `components.parameters`: `CartId`, `ProductId` (uuid), `Limit` (1..50, default 20), `Offset` (≥0, default 0).
- [ ] `components.responses`: `Cart`, `ValidationError` (400), `NotFound` (404), `Conflict` (409), `Unprocessable` (422), `InternalError` (500) — mỗi cái có **example** đúng mã code.
- [ ] `components.headers`: `X-Request-Id` (gắn vào mọi response), `Location` (cho 201 POST /carts).
- [ ] 6 operation với `operationId`, khai báo **đủ mọi status**:
  | Endpoint | Status |
  |---|---|
  | `GET /products` | 200, 400, 500 |
  | `POST /carts` | 201 (+Location), 500 |
  | `GET /carts/{cartId}` | 200, 400, 404, 500 |
  | `POST /carts/{cartId}/items` | 201, 400, 404, 409 (CART_CLOSED, ITEM_ALREADY_IN_CART, INSUFFICIENT_STOCK), 422, 500 |
  | `PATCH /carts/{cartId}/items/{productId}` | 200, 400, 404 (CART_NOT_FOUND, ITEM_NOT_FOUND), 409 (CART_CLOSED, INSUFFICIENT_STOCK), 422, 500 |
  | `DELETE /carts/{cartId}/items/{productId}` | 204, 400, 404, 409 (CART_CLOSED), 500 |
- [ ] Ghi chú trong spec (description): PATCH chỉ có `quantity`, không nhận `null`; client không gửi giá.
- [ ] Lint spec: `npx @redocly/cli lint openapi/openapi.yaml`.

### Bước 2.4 — Khung app: request_id, logging, error contract (25')
Thứ tự middleware trong `app.ts`:
1. `pino-http` với `genReqId`: lấy `X-Request-Id` từ client nếu là uuid hợp lệ, nếu không thì `crypto.randomUUID()`; set header `X-Request-Id` trên response. `redact`: `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.token`.
2. `express.json({ limit: '100kb' })` — JSON hỏng → error handler map thành 400 `VALIDATION_ERROR`.
3. `/docs` (Scalar) + `GET /openapi.yaml` (serve file spec).
4. `express-openapi-validator`: `apiSpec: openapi.yaml`, `validateRequests: { allowUnknownQueryParameters: false, coerceTypes: false (body) }`, `validateFormats: true`, `validateResponses: true` **khi NODE_ENV=test** (để chứng minh dòng "so response thật với spec").
5. Routes.
6. 404 cho route không có trong spec → `NOT_FOUND` theo error contract.
7. **Error handler chung** (`errors.ts`):
   - `AppError(status, code, message, details?)` cho lỗi nghiệp vụ.
   - Lỗi của validator (status 400) → `VALIDATION_ERROR`, map `errors[].path` → `details[].field` (bỏ tiền tố `/body/`, `/params/`), **gộp trùng theo field** để "details chỉ quantity".
   - Lỗi 405/415 của validator → giữ status, code tương ứng.
   - Mọi lỗi khác → 500 `INTERNAL_ERROR`, message chung, **không** stack/SQL; log đầy đủ ở server (`req.log.error({ err })`).
   - Luôn gắn `request_id = req.id`.
- [ ] Unit test nhỏ cho error mapper.

### Bước 2.5 — Repository + service nghiệp vụ (40')
- [ ] `db.ts`: `Pool` với `connectionTimeoutMillis: 2000` (để khi tắt PostgreSQL trả 500 nhanh, không treo).
- [ ] Repositories (SQL tham số hoá):
  - `listActiveProducts(limit, offset)` + `countActiveProducts()`
  - `findProduct(id)`, `findCart(id)`, `findCartItem(cartId, productId)`
  - `createCart()`, `insertItem`, `updateItemQuantity`, `deleteItem`
  - `getCartWithItems(cartId)` — JOIN products, tính `line_total_cents = price_cents * quantity`, `subtotal_cents = SUM` **từ DB**.
- [ ] `cartService` — **thứ tự kiểm tra** `[CHỌN]` (ghi vào spec/README):
  - **Add item**: cart tồn tại (404 CART_NOT_FOUND) → cart open (409 CART_CLOSED) → product tồn tại & active (422 PRODUCT_UNAVAILABLE) → chưa có trong cart (409 ITEM_ALREADY_IN_CART) → `quantity ≤ stock` (409 INSUFFICIENT_STOCK) → insert → trả cart.
  - **Update item**: CART_NOT_FOUND → CART_CLOSED → item có trong cart (404 ITEM_NOT_FOUND) → product active (422) → `quantity ≤ stock` (409) → update → trả cart.
  - **Delete item**: CART_NOT_FOUND → CART_CLOSED → ITEM_NOT_FOUND → delete → 204.
  - Không trừ stock khi thêm vào giỏ.
- [ ] Chạy trong transaction (`BEGIN … COMMIT`) cho thao tác ghi + đọc lại cart.

### Bước 2.6 — Routes (20')
- [ ] `GET /products` → 200 `ProductList` (chỉ `is_active = true`, sắp theo `sku`).
- [ ] `POST /carts` → 201, `Location: /carts/{id}`, body là `Cart` rỗng.
- [ ] `GET /carts/{cartId}` → 200 `Cart`.
- [ ] `POST /carts/{cartId}/items` → 201 `Cart`.
- [ ] `PATCH /carts/{cartId}/items/{productId}` → 200 `Cart`.
- [ ] `DELETE /carts/{cartId}/items/{productId}` → 204 không body.
- [ ] Handler **không** tự validate lại kiểu (đã có validator) — tránh "hai nguồn schema".

### Bước 2.7 — Evidence: test tự động theo ma trận nghiệm thu (40')
`tests/` dùng vitest + supertest, `beforeEach` → reset DB. Mỗi test kiểm tra: status, `code`, `request_id` khớp header `X-Request-Id`, và với lỗi ghi → **query DB chứng minh không đổi**.

| # | Kịch bản | Kỳ vọng |
|---|---|---|
| A1 | quantity = 0 / 11 / `"2"` (3 case) | 400 VALIDATION_ERROR, `details` chỉ có field `quantity` |
| A2 | thiếu `product_id` | 400, DB `cart_items` không đổi |
| A3 | body có field lạ | 400, DB không đổi |
| A4 | `cartId` không phải uuid | 400 VALIDATION_ERROR |
| A5 | `cartId` uuid nhưng không tồn tại | 404 CART_NOT_FOUND |
| A6 | `product_id` sai định dạng uuid | 400 (chứng minh format được bật) |
| B1 | thêm P1×2 + P3×3 rồi GET | `subtotal_cents` = 15000·2 + 9900·3 = **59700** |
| B2 | thêm P5 (ngừng bán) | 422 PRODUCT_UNAVAILABLE |
| B3 | thêm P2 quantity 6 > stock 5; thêm P4 (stock 0) | 409 INSUFFICIENT_STOCK |
| B4 | ghi vào C_CLOSED (POST/PATCH/DELETE) | 409 CART_CLOSED |
| B5 | thêm trùng product | 409 ITEM_ALREADY_IN_CART |
| B6 | PATCH/DELETE item không có | 404 ITEM_NOT_FOUND |
| B7 | POST /carts | 201 + header Location |
| B8 | GET /products limit 0 / 51 / mặc định | 400 / 400 / 20 items tối đa, chỉ product active |
| C1 | DB không kết nối được (app trỏ tới port sai / `docker compose stop db`) | 500 INTERNAL_ERROR, đúng contract, không có `stack`/SQL |
| C2 | Mọi response ở trên | Khớp schema (`validateResponses` bật trong test → lệch là test fail) |
| C3 | Log | Response lỗi có `request_id`, tìm được dòng log cùng id (test bắt log stream) |

- [ ] `npm run evidence` = `db:reset` + `vitest run` → in bảng pass/fail.
- [ ] Script riêng `scripts/evidence-db-down.sh` cho C1 bằng cách dừng container thật (bổ sung cho test giả lập).
- [ ] `requests.http` chứa đủ các request trên để demo tay / trong `/docs`.

### Bước 2.8 — README (15')
- [ ] Yêu cầu: Node 20+, Docker.
- [ ] Lệnh theo thứ tự: `npm ci` → `cp .env.example .env` → `npm run db:up` → `npm run db:migrate` → `npm run db:seed` → `npm run dev` → mở `http://localhost:3000/docs`.
- [ ] `npm run db:reset`, `npm run evidence`.
- [ ] Bảng UUID seed + giá để tính tay subtotal.
- [ ] Mục **Quyết định & trade-off**: contract-first vs code-first, thư viện + lý do, thứ tự kiểm tra lỗi, các kịch bản **chưa kiểm tra**.
- [ ] **Kiểm thử trên máy sạch**: clone vào thư mục mới, làm theo README từng dòng.

### Bước 2.9 — Chuẩn bị trình bày (10')
- [ ] Problem → Solution (contract-first, lý do) → Demo: gửi `quantity: 0` từ `/docs`, chỉ response lỗi + dòng log có cùng `request_id` → Evidence (kết quả `npm run evidence`) + trade-off.
- [ ] Trả lời sẵn câu hỏi GV: *"Nếu backend đổi kiểu một field trong code, cơ chế nào phát hiện spec lệch?"* → `validateResponses` trong test + validator đọc trực tiếp spec cho request.

---

## 3. Các bẫy cần kiểm tra (từ slide "lỗi thường gặp" + speaker note)

- [ ] Hai nguồn schema → handler không có validate thủ công nào trùng spec.
- [ ] Lỗi thư viện lọt ra format riêng → test A1–A6 kiểm tra đúng shape `{code,message,details,request_id}`.
- [ ] Tin client → không đọc `price` từ body; `additionalProperties: false` sẽ chặn luôn.
- [ ] Dựa vào lỗi DB (CHECK constraint → 500) → quantity 11 bị validator chặn trước khi tới DB.
- [ ] Validator ép `"2"` → `2` → test A1 bắt được.
- [ ] `format: uuid` không được kiểm tra nếu chưa bật → test A6.
- [ ] Pool treo khi DB tắt → `connectionTimeoutMillis`.
- [ ] Không log password/token/Authorization → `redact`.

---

## 4. Câu hỏi mở cho bạn
1. Giữ **TypeScript + Express + contract-first** hay đổi (code-first zod / NestJS / Fastify / ngôn ngữ khác)?
2. ORM/migration: SQL thuần + `node-pg-migrate` có ổn không, hay muốn Prisma/Drizzle?
3. Thứ tự kiểm tra lỗi ở 2.5 có đúng ý nhóm không (vd. PATCH với product đã ngừng bán → 422 hay cho phép)?
4. Response `GET /products`: bọc `{items, limit, offset, total}` hay trả mảng thuần?
5. Code dự án đặt ở đâu — ngay trong `Block-1/` hay thư mục con (vd. `Block-1/cart-api/`) để dùng lại cho các tuần sau?
