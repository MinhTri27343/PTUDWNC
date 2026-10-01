# PLAN — Cart API (Block 1: OpenAPI, validation, error contract, logging)

> Nguồn: `RESTful API có contract_ OpenAPI, validation và logging.html`
> Trạng thái: **DRAFT v2** — đã cập nhật theo góp ý (SQLite, không Docker, Swagger UI, cấu trúc response chung, chốt các câu hỏi mở).

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

## 1. Quyết định kỹ thuật (đã chốt)

| Vấn đề | Lựa chọn | Ghi chú |
|---|---|---|
| Runtime | Node.js 20+ + **TypeScript** + Express 4 | Đã chốt |
| Hướng tiếp cận | **Contract-first**: `openapi/openapi.yaml` viết tay là nguồn schema duy nhất | Đã chốt |
| Validator | `express-openapi-validator` (đọc trực tiếp `openapi.yaml`) | Validate request **và** response từ cùng file. ⚠ Kiểm tra hỗ trợ 3.1 ở bước 2.0 |
| DB | **SQLite** (file `data/cart.db`), **không dùng Docker** | Máy sạch chỉ cần Node; không cần cài DB server |
| Driver | `better-sqlite3`, **SQL thuần** | API đồng bộ, có `db.transaction()`. Không dùng ORM |
| Migration | File `.sql` trong `migrations/` + runner tự viết (`scripts/migrate.ts`) ghi bảng `schema_migrations` | Không cần thư viện migration |
| Docs UI | **Swagger UI** (`swagger-ui-express`) tại `/docs`, load từ `openapi.yaml` | Swagger UI v5 hỗ trợ OpenAPI 3.1; có "Try it out" để demo |
| Logging | `pino` + `pino-http` (+ `pino-pretty` khi dev) | JSON log, có `genReqId`, `redact` |
| Evidence | `vitest` + `supertest` + file `requests.http` để demo tay | 1 lệnh `npm run evidence` |
| Vị trí code | **Đặt thẳng trong `Block-1/`** | Đã chốt |

### Chuyển DDL PostgreSQL trên slide sang SQLite

Giữ **đúng tên bảng, cột, constraint** để GV chấm bằng cùng ma trận; chỉ đổi kiểu dữ liệu:

| PostgreSQL (slide) | SQLite | Xử lý |
|---|---|---|
| `uuid` | `TEXT` | UUID sinh ở app bằng `crypto.randomUUID()`; validator đã chặn format sai |
| `boolean` | `INTEGER` `CHECK (is_active IN (0,1))` | Map sang `true/false` ở repository |
| `integer`, `text` | giữ nguyên | |
| `CHECK`, `UNIQUE`, `PRIMARY KEY`, `REFERENCES … ON DELETE CASCADE` | giữ nguyên | **Bắt buộc** `PRAGMA foreign_keys = ON` mỗi khi mở kết nối |

---

## 2. Cấu trúc response chung (error contract — slide 10)

### 2.1 Response thành công
Không bọc envelope — trả đúng resource theo spec:

| Endpoint | Body |
|---|---|
| `GET /products` | **Mảng** `Product[]` |
| `POST /carts`, `GET /carts/{id}`, `POST …/items`, `PATCH …/items/{productId}` | Object `Cart` |
| `DELETE …/items/{productId}` | 204, không body |

Mọi response (thành công **và** lỗi) đều có header `X-Request-Id`.

```json
// Cart
{
  "id": "c0000000-0000-4000-8000-000000000001",
  "status": "open",
  "items": [
    { "product_id": "…", "name": "…", "unit_price_cents": 15000, "quantity": 2, "line_total_cents": 30000 }
  ],
  "subtotal_cents": 30000
}
```

### 2.2 Response lỗi — một dạng duy nhất cho mọi status 4xx/5xx

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Request body không hợp lệ",
  "details": [{ "field": "quantity", "issue": "must be <= 10" }],
  "request_id": "7f3c2a9e-1b4d-4c8a-9e21-5d6f0a3b8c10"
}
```

| Field | Kiểu | Bắt buộc | Quy tắc |
|---|---|---|---|
| `code` | string (enum) | ✔ | Chuỗi cố định để client rẽ nhánh — **không bao giờ đổi** |
| `message` | string | ✔ | Chỉ để hiển thị, có thể đổi câu chữ |
| `details` | `[{ field, issue }]` | chỉ khi `VALIDATION_ERROR` | `field` là tên field/param (vd. `quantity`, `cartId`), mỗi field xuất hiện 1 lần |
| `request_id` | string (uuid) | ✔ | Trùng với header `X-Request-Id` và dòng log |

**Bảng mã lỗi (enum `code`)**

| Status | `code` | Khi nào |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Sai schema body/path/query, JSON hỏng |
| 404 | `CART_NOT_FOUND` | `cartId` hợp lệ nhưng không có trong DB |
| 404 | `ITEM_NOT_FOUND` | Product không có trong cart (PATCH/DELETE) |
| 404 | `NOT_FOUND` | Route không tồn tại |
| 405 / 415 | `METHOD_NOT_ALLOWED` / `UNSUPPORTED_MEDIA_TYPE` | Lỗi của validator, vẫn đưa về contract |
| 409 | `CART_CLOSED` | Ghi vào cart `checked_out` |
| 409 | `ITEM_ALREADY_IN_CART` | POST item đã có trong cart |
| 409 | `INSUFFICIENT_STOCK` | `quantity > stock` |
| 422 | `PRODUCT_UNAVAILABLE` | Product không tồn tại hoặc `is_active = false` |
| 500 | `INTERNAL_ERROR` | Lỗi server/DB — message chung, **không** stack trace, câu SQL, đường dẫn file hay secret |

**Cách hiện thực**
- Spec: `components.schemas.Error` (enum `code`, `details` chỉ bắt buộc qua `if/then` khi `code = VALIDATION_ERROR` — JSON Schema 2020-12 của 3.1) + `components.responses` cho từng status, mỗi cái có **example**.
- Code: class `AppError(status, code, message, details?)` + **một** error handler cuối chuỗi middleware; mọi đường lỗi (validator, JSON parse, nghiệp vụ, DB, route lạ) đều đi qua đây.

---

## 3. Thứ tự implementation

### Bước 3.0 — Spike kiểm tra công cụ (15')
- [ ] Cài `express-openapi-validator`, thử load spec `openapi: 3.1.0` tối thiểu.
- [ ] Xác nhận: `format: uuid` được validate (`validateFormats`), body `"2"` **không** bị ép thành `2`, `if/then` trong schema Error chạy được.
- [ ] Xác nhận `swagger-ui-express` render được spec 3.1.
- [ ] Xác nhận `better-sqlite3` cài được (prebuilt binary) trên Windows + Node hiện tại.
- [ ] Nếu validator không ổn với 3.1 → phương án dự phòng: Ajv 2020 + middleware tự viết, vẫn đọc từ `openapi.yaml`. **Ghi kết quả vào README (trade-off).**

### Bước 3.1 — Khởi tạo project trong `Block-1/` (10')
- [ ] `package.json`, `tsconfig.json`, `.env.example` (`PORT`, `DB_PATH=./data/cart.db`, `LOG_LEVEL`), `.gitignore` (`node_modules`, `data/*.db`, `.env`).
- [ ] Cấu trúc:
  ```
  Block-1/
    openapi/openapi.yaml
    migrations/001_init.sql
    scripts/migrate.ts, seed.ts, reset.ts
    src/app.ts            # build Express app (không listen) → dùng cho test
    src/server.ts         # listen
    src/db.ts             # mở SQLite, PRAGMA foreign_keys = ON
    src/logger.ts
    src/errors.ts         # AppError + error handler
    src/routes/products.ts, carts.ts
    src/services/cartService.ts
    src/repositories/*.ts
    tests/*.test.ts
    requests.http
    data/                 # file .db (gitignore)
  ```

### Bước 3.2 — Database: migration + seed + reset (20')
- [ ] `migrations/001_init.sql`: `products`, `carts`, `cart_items` theo bảng chuyển đổi ở mục 1.
- [ ] `scripts/migrate.ts`: tạo `schema_migrations`, chạy các file `.sql` chưa áp dụng theo thứ tự tên, mỗi file trong 1 transaction.
- [ ] Seed với **UUID cố định**:
  | Product | price_cents | stock | is_active | Mục đích |
  |---|---|---|---|---|
  | P1 | 15000 | 20 | 1 | happy path |
  | P2 | 25000 | 5 | 1 | happy path / vượt stock |
  | P3 | 9900 | 100 | 1 | happy path |
  | P4 | 50000 | **0** | 1 | INSUFFICIENT_STOCK |
  | P5 | 30000 | 10 | **0** | PRODUCT_UNAVAILABLE |
  - Cart `C_OPEN` (`open`, rỗng) và `C_CLOSED` (`checked_out`).
- [ ] `scripts/reset.ts`: xoá file `.db` → migrate → seed.
- [ ] npm scripts: `db:migrate`, `db:seed`, `db:reset` (thư mục `data/` tự tạo nếu chưa có).

### Bước 3.3 — Viết `openapi.yaml` (OpenAPI 3.1) — NGUỒN SCHEMA DUY NHẤT (40')
- [ ] `components.schemas`:
  - `Product` (id, sku, name, price_cents, stock, is_active), `ProductList` = `type: array, items: Product`
  - `AddItemRequest` — `additionalProperties: false`, required `[product_id, quantity]`, `product_id: uuid`, `quantity: integer 1..10`
  - `UpdateItemRequest` — `additionalProperties: false`, required `[quantity]`
  - `CartItem`, `Cart` (theo mục 2.1)
  - `Error` (theo mục 2.2)
- [ ] `components.parameters`: `CartId`, `ProductId` (uuid), `Limit` (1..50, default 20), `Offset` (≥0, default 0).
- [ ] `components.responses`: `Cart`, `ValidationError` (400), `NotFound` (404), `Conflict` (409), `Unprocessable` (422), `InternalError` (500) — có example cho **từng** `code`.
- [ ] `components.headers`: `X-Request-Id` (mọi response), `Location` (201 POST /carts).
- [ ] 6 operation với `operationId`, khai báo **đủ mọi status**:
  | Endpoint | Status |
  |---|---|
  | `GET /products` | 200, 400, 500 |
  | `POST /carts` | 201 (+Location), 500 |
  | `GET /carts/{cartId}` | 200, 400, 404, 500 |
  | `POST /carts/{cartId}/items` | 201, 400, 404, 409 (CART_CLOSED, ITEM_ALREADY_IN_CART, INSUFFICIENT_STOCK), 422, 500 |
  | `PATCH /carts/{cartId}/items/{productId}` | 200, 400, 404 (CART_NOT_FOUND, ITEM_NOT_FOUND), 409 (CART_CLOSED, INSUFFICIENT_STOCK), 422, 500 |
  | `DELETE /carts/{cartId}/items/{productId}` | 204, 400, 404, 409 (CART_CLOSED), 500 |
- [ ] Ghi chú trong spec: PATCH chỉ nhận `quantity` (không nhận `null`); client không gửi giá.
- [ ] Lint spec: `npx @redocly/cli lint openapi/openapi.yaml`.

### Bước 3.4 — Khung app: request_id, logging, error contract (25')
Thứ tự middleware trong `app.ts`:
1. `pino-http` với `genReqId`: dùng `X-Request-Id` của client nếu là uuid hợp lệ, nếu không thì `crypto.randomUUID()`; set header `X-Request-Id` trên response. `redact`: `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.token`.
2. `express.json({ limit: '100kb' })` — JSON hỏng → 400 `VALIDATION_ERROR`.
3. **Swagger UI**: `app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec))` + `GET /openapi.yaml` trả file spec gốc.
4. `express-openapi-validator`: `apiSpec: openapi.yaml`, `validateRequests` (không coerce body, không cho query lạ), `validateFormats: true`, `validateResponses: true` **khi NODE_ENV=test**. Bỏ qua path `/docs`, `/openapi.yaml`.
5. Routes.
6. Route lạ → 404 `NOT_FOUND`.
7. **Error handler chung** (`errors.ts`) theo mục 2.2:
   - `AppError` → giữ nguyên status/code.
   - Lỗi validator → `VALIDATION_ERROR`, map `errors[].path` → `details[].field` (bỏ tiền tố `/body/`, `/params/`, `/query/`), **gộp trùng theo field**.
   - Còn lại → 500 `INTERNAL_ERROR`; log đầy đủ ở server (`req.log.error({ err })`), không lộ ra response.
   - Luôn gắn `request_id = req.id`.
- [ ] Unit test cho error mapper.

### Bước 3.5 — Repository + service nghiệp vụ (40')
- [ ] `db.ts`: mở `better-sqlite3` **lazy** (lần query đầu) với `fileMustExist: true`, `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`. Server vẫn khởi động được khi DB lỗi → request trả 500 (phục vụ kịch bản C1).
- [ ] Repositories (prepared statement, tham số hoá):
  - `listActiveProducts(limit, offset)`
  - `findProduct(id)`, `findCart(id)`, `findCartItem(cartId, productId)`
  - `createCart()`, `insertItem`, `updateItemQuantity`, `deleteItem`
  - `getCartWithItems(cartId)` — JOIN products, `line_total_cents = price_cents * quantity`, `subtotal_cents = SUM` **từ DB**.
- [ ] `cartService` — thứ tự kiểm tra (đã chốt):
  - **Add item**: CART_NOT_FOUND (404) → CART_CLOSED (409) → PRODUCT_UNAVAILABLE (422: không tồn tại hoặc ngừng bán) → ITEM_ALREADY_IN_CART (409) → INSUFFICIENT_STOCK (409) → insert → trả cart.
  - **Update item**: CART_NOT_FOUND → CART_CLOSED → ITEM_NOT_FOUND (404) → PRODUCT_UNAVAILABLE (422) → INSUFFICIENT_STOCK → update → trả cart.
  - **Delete item**: CART_NOT_FOUND → CART_CLOSED → ITEM_NOT_FOUND → delete → 204.
  - Không trừ stock khi thêm vào giỏ.
- [ ] Bọc kiểm tra + ghi + đọc lại cart trong `db.transaction(...)`.

### Bước 3.6 — Routes (20')
- [ ] `GET /products` → 200, **mảng** product active, sắp theo `sku`, áp `limit/offset`.
- [ ] `POST /carts` → 201, `Location: /carts/{id}`, body `Cart` rỗng.
- [ ] `GET /carts/{cartId}` → 200 `Cart`.
- [ ] `POST /carts/{cartId}/items` → 201 `Cart`.
- [ ] `PATCH /carts/{cartId}/items/{productId}` → 200 `Cart`.
- [ ] `DELETE /carts/{cartId}/items/{productId}` → 204.
- [ ] Handler **không** validate lại kiểu (tránh "hai nguồn schema").

### Bước 3.7 — Evidence: test tự động theo ma trận nghiệm thu (40')
`tests/` dùng vitest + supertest, mỗi test dùng **file SQLite tạm** (reset bằng migrate + seed). Mỗi test kiểm tra: status, `code`, đúng shape error contract, `request_id` khớp header `X-Request-Id`; với lỗi ghi → **query DB chứng minh không đổi**.

| # | Kịch bản | Kỳ vọng |
|---|---|---|
| A1 | quantity = 0 / 11 / `"2"` (3 case) | 400 VALIDATION_ERROR, `details` chỉ có field `quantity` |
| A2 | thiếu `product_id` | 400, `cart_items` không đổi |
| A3 | body có field lạ (vd. `price`) | 400, DB không đổi |
| A4 | `cartId` không phải uuid | 400 VALIDATION_ERROR |
| A5 | `cartId` uuid nhưng không tồn tại | 404 CART_NOT_FOUND |
| A6 | `product_id` sai định dạng uuid | 400 (chứng minh format được bật) |
| B1 | thêm P1×2 + P3×3 rồi GET | `subtotal_cents` = 15000·2 + 9900·3 = **59700** |
| B2 | thêm P5 (ngừng bán) | 422 PRODUCT_UNAVAILABLE |
| B3 | P2 quantity 6 > stock 5; P4 (stock 0) | 409 INSUFFICIENT_STOCK |
| B4 | ghi vào C_CLOSED (POST/PATCH/DELETE) | 409 CART_CLOSED |
| B5 | thêm trùng product | 409 ITEM_ALREADY_IN_CART |
| B6 | PATCH/DELETE item không có | 404 ITEM_NOT_FOUND |
| B7 | POST /carts | 201 + header Location |
| B8 | GET /products limit 0 / 51 / mặc định | 400 / 400 / mảng ≤ 20 phần tử, chỉ product active |
| C1 | **DB không dùng được** (thay cho "tắt PostgreSQL"): `DB_PATH` trỏ tới file không tồn tại, hoặc đóng kết nối giữa chừng | 500 INTERNAL_ERROR, đúng contract, không có stack/SQL/đường dẫn |
| C2 | Mọi response ở trên | Khớp schema (`validateResponses` bật trong test → lệch là fail) |
| C3 | Log | Response lỗi có `request_id`, tìm được dòng log cùng id |

- [ ] `npm run evidence` = `db:reset` + `vitest run`.
- [ ] `scripts/evidence-db-down.ts`: khởi động server với `DB_PATH` hỏng, gọi API thật, in response 500.
- [ ] `requests.http` chứa đủ các request trên để demo tay / trong Swagger.

### Bước 3.8 — README (15')
- [ ] Yêu cầu: Node 20+ (không cần Docker / DB server).
- [ ] Lệnh: `npm ci` → `cp .env.example .env` → `npm run db:migrate` → `npm run db:seed` → `npm run dev` → mở `http://localhost:3000/docs`.
- [ ] `npm run db:reset`, `npm run evidence`.
- [ ] Bảng UUID seed + giá để tính tay subtotal.
- [ ] Mục **Error contract** (copy mục 2.2).
- [ ] Mục **Quyết định & trade-off**: contract-first, SQLite thay PostgreSQL (khác biệt kiểu dữ liệu, cách giả lập "tắt DB"), thư viện + lý do, thứ tự kiểm tra lỗi, các kịch bản **chưa kiểm tra**.
- [ ] **Kiểm thử trên máy sạch**: clone vào thư mục mới, làm theo README từng dòng.

### Bước 3.9 — Chuẩn bị trình bày (10')
- [ ] Problem → Solution (contract-first, lý do) → Demo: gửi `quantity: 0` từ Swagger `/docs`, chỉ response lỗi + dòng log có cùng `request_id` → Evidence (`npm run evidence`) + trade-off.
- [ ] Trả lời sẵn: *"Nếu backend đổi kiểu một field trong code, cơ chế nào phát hiện spec lệch?"* → `validateResponses` trong test + validator đọc trực tiếp spec cho request.

---

## 4. Các bẫy cần kiểm tra

- [ ] Hai nguồn schema → handler không có validate thủ công trùng spec.
- [ ] Lỗi thư viện lọt ra format riêng → A1–A6 kiểm tra đúng shape error contract.
- [ ] Tin client → không đọc `price` từ body; `additionalProperties: false` chặn luôn.
- [ ] Dựa vào lỗi DB (CHECK constraint → 500) → quantity 11 bị validator chặn trước khi tới DB.
- [ ] Validator ép `"2"` → `2` → A1 bắt được.
- [ ] `format: uuid` không được kiểm tra nếu chưa bật → A6 (đặc biệt quan trọng vì SQLite lưu uuid là TEXT, không tự kiểm tra).
- [ ] SQLite mặc định **tắt** foreign key → luôn `PRAGMA foreign_keys = ON`.
- [ ] Boolean SQLite là 0/1 → map sang `true/false` trước khi trả, nếu không response lệch spec (C2 bắt được).
- [ ] Không log password/token/Authorization → `redact`.
