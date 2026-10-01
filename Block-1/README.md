# Cart API

RESTful API giỏ hàng cho Block 1: **contract-first OpenAPI 3.1**, validation chạy từ chính file spec, error contract thống nhất và logging có `request_id`.

Stack: Node.js + TypeScript + Express 5, SQLite (`better-sqlite3`, SQL thuần), `express-openapi-validator`, Swagger UI, `pino`. **Không cần Docker hay DB server.**

## Setup (máy sạch)

Yêu cầu: Node.js ≥ 20.12.

```bash
npm ci
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
npm run db:migrate          # tạo data/cart.db + bảng
npm run db:seed             # nạp 5 product, 2 cart
npm run dev                 # server tại http://localhost:3000
```

Mở **http://localhost:3000/docs** (Swagger UI). Spec gốc: `http://localhost:3000/openapi.yaml`.

| Lệnh | Việc |
|---|---|
| `npm run db:reset` | Xoá file DB → migrate → seed (chạy lại bao nhiêu lần cũng được) |
| `npm run dev` / `npm start` | Chạy server (`PORT`, `DB_PATH`, `LOG_LEVEL`, `JWT_SECRET` trong `.env`) |
| `npm test` | Chạy test ma trận nghiệm thu |
| `npm run evidence` | `db:reset` + toàn bộ test + kịch bản "DB không dùng được" qua HTTP thật |
| `npm run lint:spec` | Lint `openapi/openapi.yaml` |
| `LOG_PRETTY=true npm run dev` | Log dễ đọc khi demo (mặc định là JSON) |

## Dùng API với Bearer token

1. Mở `/docs` → `POST /login` → Try it out với `{"username":"user","password":"1234"}` (user duy nhất, gán cứng).
2. Copy `access_token` → nút **Authorize** → dán token.
3. Gọi các endpoint `/carts/...`. (`/login` và `GET /products` không cần token.)

Hoặc dùng [requests.http](requests.http) (VS Code REST Client) / curl:

```bash
TOKEN=$(curl -s -X POST localhost:3000/login -H 'Content-Type: application/json' \
  -d '{"username":"user","password":"1234"}' | jq -r .access_token)
curl -s -X POST localhost:3000/carts/c0000000-0000-4000-8000-000000000001/items \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"product_id":"a0000000-0000-4000-8000-000000000001","quantity":2}'
```

## Endpoint

| Method | Path | Auth | Thành công |
|---|---|---|---|
| POST | `/login` | – | 200 `{access_token, token_type, expires_in}` |
| GET | `/products?limit=&offset=` | – | 200 mảng product đang bán (limit 1–50, mặc định 20) |
| POST | `/carts` | Bearer | 201 + header `Location` |
| GET | `/carts/{cartId}` | Bearer | 200 cart + `subtotal_cents` |
| POST | `/carts/{cartId}/items` | Bearer | 201 trả cart |
| PATCH | `/carts/{cartId}/items/{productId}` | Bearer | 200 trả cart |
| DELETE | `/carts/{cartId}/items/{productId}` | Bearer | 204 |

## Dữ liệu seed (UUID cố định)

| Product | id | price_cents | stock | is_active |
|---|---|---|---|---|
| SKU-001 | `a0000000-0000-4000-8000-000000000001` | 15000 | 20 | ✔ |
| SKU-002 | `a0000000-0000-4000-8000-000000000002` | 25000 | 5 | ✔ |
| SKU-003 | `a0000000-0000-4000-8000-000000000003` | 9900 | 100 | ✔ |
| SKU-004 | `a0000000-0000-4000-8000-000000000004` | 50000 | **0** | ✔ |
| SKU-005 | `a0000000-0000-4000-8000-000000000005` | 30000 | 10 | **✘** |

| Cart | id | status |
|---|---|---|
| open | `c0000000-0000-4000-8000-000000000001` | `open` (rỗng) |
| closed | `c0000000-0000-4000-8000-000000000002` | `checked_out` (có sẵn 1 × SKU-001) |

Tính tay: SKU-001 ×2 + SKU-003 ×3 = 15000·2 + 9900·3 = **59700**.

## Error contract

Mọi lỗi 4xx/5xx (kể cả lỗi do thư viện validator và lỗi 500) đều có đúng dạng:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Request không hợp lệ",
  "details": [{ "field": "quantity", "issue": "must be <= 10" }],
  "request_id": "7f3c2a9e-1b4d-4c8a-9e21-5d6f0a3b8c10"
}
```

`code` là chuỗi cố định để client rẽ nhánh; `message` chỉ để hiển thị; `details` chỉ có với `VALIDATION_ERROR`; `request_id` trùng header `X-Request-Id` và dòng log. 500 không chứa stack trace, SQL hay đường dẫn.

| Status | code |
|---|---|
| 400 | `VALIDATION_ERROR` |
| 401 | `INVALID_CREDENTIALS` (login), `UNAUTHORIZED` (thiếu/sai/hết hạn token) |
| 404 | `CART_NOT_FOUND`, `ITEM_NOT_FOUND`, `NOT_FOUND` (route lạ) |
| 409 | `CART_CLOSED`, `ITEM_ALREADY_IN_CART`, `INSUFFICIENT_STOCK` |
| 422 | `PRODUCT_UNAVAILABLE` |
| 500 | `INTERNAL_ERROR` |

Thứ tự kiểm tra: 401 (token) → 400 (schema, **không chạm DB**) → nghiệp vụ. Chi tiết thứ tự nghiệp vụ nằm trong `description` của spec.

## Logging

`pino` + `pino-http`. Mỗi request có `request_id` (dùng lại `X-Request-Id` của client nếu là uuid hợp lệ, không thì server tự sinh), trả trong header và error body. Từ `request_id` trong response lỗi, tìm dòng log tương ứng:

```bash
npm run dev 2>&1 | grep 7f3c2a9e-1b4d-4c8a-9e21-5d6f0a3b8c10
```

Header `Authorization`, `cookie`, `password`, `token` bị thay bằng `[REDACTED]`. Lỗi 500 được log đầy đủ (kèm stack) ở server, không trả ra client.

## Cấu trúc

```
openapi/openapi.yaml   nguồn schema DUY NHẤT (validator + Swagger UI + test đối chiếu response đều đọc file này)
migrations/            SQL thuần, runner ghi bảng schema_migrations
src/app.ts             pino-http → json → /docs → openapi-validator → routes → error handler
src/errors.ts          AppError + error handler chung (mọi lỗi đi qua đây)
src/services/          rule nghiệp vụ cần đọc DB (transaction)
src/repositories/      SQL
tests/                 ma trận nghiệm thu (vitest + supertest, SQLite tạm cho mỗi test)
```

## Quyết định & trade-off

- **Contract-first**: `openapi.yaml` viết tay, `express-openapi-validator` đọc thẳng file đó để chặn request sai và (trong test) đối chiếu response. Không có schema thứ hai trong code → spec không thể lệch âm thầm. Handler không validate lại kiểu. Nếu backend đổi kiểu một field mà không sửa spec, test `validateResponses` sẽ fail.
- **SQLite thay PostgreSQL**: không cần cài DB server. Giữ đúng tên bảng/cột/constraint của đề; `uuid` → `TEXT` (format kiểm tra ở validator), `boolean` → `INTEGER 0/1` (đổi về `true/false` ở repository), bảng `STRICT` để không tự ép kiểu. Phải bật `PRAGMA foreign_keys = ON` cho mỗi kết nối. "Tắt PostgreSQL" được giả lập bằng cách cho DB không mở được (kết nối được mở lazy nên server vẫn chạy và trả 500).
- **Swagger UI** (`swagger-ui-express`) cho `/docs`, có nút Authorize cho Bearer token.
- **Auth**: user cứng `user`/`1234`, JWT HS256 (`jsonwebtoken`), so sánh timing-safe. Validator chạy bước security trước validate schema nên 401 luôn đến trước 400.
- **Giá lấy từ DB**: client không gửi giá; `additionalProperties: false` từ chối `price`.
- **Thêm vào giỏ không trừ stock**; stock chỉ kiểm tra lúc thêm/sửa. Giữ chỗ tồn kho và race condition ngoài phạm vi (Block 6).

## Chưa kiểm tra / giới hạn

- Chưa có test cho concurrent request (hai người cùng thêm món cuối cùng).
- Chưa kiểm tra trên PostgreSQL thật — chỉ SQLite.
- `JWT_SECRET` mặc định chỉ dùng cho local; đặt giá trị riêng trong `.env` nếu deploy.
- Không có refresh token / logout; token hết hạn sau `JWT_EXPIRES_IN` giây (mặc định 3600).
