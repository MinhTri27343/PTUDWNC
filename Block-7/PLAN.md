# Block 7 — Checkout Saga (Order · Inventory · Payment)

> Mục tiêu: ứng dụng checkout dùng **Saga (Orchestration)** với 3 service, **mỗi service một DB SQLite riêng**, có UI đơn giản để xem **số dư tài khoản, tồn kho, lịch sử giao dịch / saga log**, và **demo được các case rủi ro** (lỗi → Saga gọi API bù trừ).
>
> Thời gian: ≤ 60 phút. Stack giống Block-5: TypeScript + Express 5 + better-sqlite3 + tsx (không Docker, không broker).

---

## 1. Kiến trúc

```
                 ┌──────────────────────────────┐
  Browser UI ──▶ │ Order Service :3001          │──▶ data/order.db
  (public/)      │  - POST /checkout            │      orders, saga_log, idempotency_keys
                 │  - Saga Orchestrator         │
                 └──────┬──────────────┬────────┘
                   HTTP │              │ HTTP
                        ▼              ▼
     ┌─────────────────────────┐   ┌─────────────────────────┐
     │ Inventory Service :3002 │   │ Payment Service :3003   │
     │  data/inventory.db      │   │  data/payment.db        │
     │  products, reservations │   │  accounts, transactions │
     └─────────────────────────┘   └─────────────────────────┘
```

**Luật cứng — Database per service**
- Mỗi service chỉ mở file `.db` của chính nó. **Không** service nào đọc/ghi DB của service khác.
- Muốn dữ liệu của service khác → gọi HTTP API của nó.
- Mỗi service có `schema.sql` + `seed.ts` riêng trong thư mục của mình.
- `npm run reset` xoá cả 3 file `.db` rồi seed lại (chạy trước mỗi lần demo).

## 2. Cấu trúc thư mục

```
Block-7/
  PLAN.md  CONTRACT.md  README.md
  package.json  tsconfig.json
  data/                      # *.db (gitignore)
  src/
    shared/                  # db helper, faults middleware, http client (retry/timeout)
    inventory/               # server.ts, schema.sql, seed.ts, routes
    payment/                 # server.ts, schema.sql, seed.ts, routes
    order/                   # server.ts, saga.ts, recovery.ts, schema.sql, seed.ts
      public/                # index.html, app.js, style.css  (UI)
  scripts/
    reset.ts
    scenarios.ts             # chạy 9 case rủi ro tự động
  evidence/                  # output của scenarios
```

Scripts `package.json`: `inventory`, `payment`, `order`, `dev` (dùng `concurrently` chạy cả 3), `reset`, `scenarios`, `typecheck`.

## 3. API contract (tóm tắt — chi tiết nằm ở CONTRACT.md)

### Inventory :3002
| Method | Path | Body | Ghi chú |
|---|---|---|---|
| GET | `/products` | – | `[{id, name, price, available, reserved}]` |
| POST | `/reserve` | `{orderId, items:[{productId, qty}]}` | `available -= qty`, `reserved += qty`. Thiếu hàng → `409 OUT_OF_STOCK`. Idempotent theo `orderId` |
| POST | `/release` | `{orderId}` | **Bù trừ**: trả hàng từ `reserved` về `available`. Không có reservation → `200 noop` |
| POST | `/commit` | `{orderId}` | Khi order CONFIRMED: `reserved -= qty` (hàng đã bán) |
| GET | `/reservations` | – | Lịch sử reserve/release/commit |

### Payment :3003
| Method | Path | Body | Ghi chú |
|---|---|---|---|
| GET | `/accounts` | – | `[{id, name, balance}]` |
| GET | `/transactions` | – | `[{id, orderId, accountId, type: CHARGE\|REFUND, amount, createdAt}]` |
| POST | `/charge` | `{orderId, accountId, amount}` | Không đủ tiền → `402 INSUFFICIENT_FUNDS`. Idempotent theo `orderId` |
| POST | `/refund` | `{orderId}` | **Bù trừ**: hoàn đúng số đã charge. Chưa charge → `200 noop`. Idempotent |

### Order :3001
| Method | Path | Ghi chú |
|---|---|---|
| POST | `/checkout` | Header `Idempotency-Key`. Body `{accountId, items, simulate?: {failAt?: "confirm", crashAfter?: "reserve"\|"charge"}}` |
| GET | `/orders` | Danh sách order + trạng thái saga |
| GET | `/orders/:id/saga-log` | Log từng bước |
| POST | `/orders/:id/retry-compensation` | Retry bù trừ cho order `COMPENSATION_FAILED` |
| GET | `/` | Serve UI |

### Fault injection (cả 3 service)
`POST /admin/faults` `{ mode, endpoint? }` — `GET /admin/faults` để xem.

| mode | Ý nghĩa |
|---|---|
| `none` | Bình thường |
| `down` | Mọi request (trừ `/admin/*`, `GET`) trả `503` |
| `fail_next` | Request kế tiếp vào `endpoint` trả `500`, sau đó tự về `none` |
| `timeout` | Treo 5s **trước** khi xử lý (không commit) |
| `timeout_after_commit` | **Commit xong** rồi treo 5s → client timeout nhưng tiền đã trừ |

Http client của orchestrator: timeout 2s, retry 3 lần với backoff (200ms, 400ms, 800ms) cho lệnh bù trừ.

Mọi service bật CORS để UI gọi trực tiếp các endpoint `GET`.

## 4. Saga

### Các bước & bù trừ
| # | Bước (action) | Bù trừ (compensation) |
|---|---|---|
| 1 | Order: tạo order `PENDING` | Order → `CANCELLED` |
| 2 | Inventory `/reserve` | Inventory `/release` |
| 3 | Payment `/charge` | Payment `/refund` |
| 4 | Order confirm + Inventory `/commit` | (pivot — sau bước này không bù trừ) |

Khi lỗi ở bước k → chạy bù trừ của các bước `k-1 … 1` theo **thứ tự ngược**.

### Máy trạng thái (bảng `orders.status`)
```
PENDING → INVENTORY_RESERVED → PAYMENT_CHARGED → CONFIRMED
   │              │                    │
   └──── lỗi ─────┴────── lỗi ─────────┘
                  ▼
            COMPENSATING ──(refund → release)──▶ CANCELLED
                  │
                  └─ bù trừ lỗi sau 3 lần retry ─▶ COMPENSATION_FAILED
                                                   (UI: nút "Retry compensation")
```

### `saga_log` (order.db)
`id, orderId, step, kind (ACTION|COMPENSATION), status (STARTED|OK|FAILED), error, attempt, createdAt`

Ghi `STARTED` **trước** khi gọi service khác, ghi `OK/FAILED` sau → dùng cho recovery khi crash.

### Recovery khi khởi động Order service
Quét các order có status không phải `CONFIRMED | CANCELLED | COMPENSATION_FAILED`:
- Đang ở `PENDING` / `INVENTORY_RESERVED` / `PAYMENT_CHARGED` / `COMPENSATING` → chạy bù trừ (refund + release, cả hai idempotent nên gọi thừa vẫn an toàn) → `CANCELLED`.
- (Chiến lược đơn giản: **backward recovery** — luôn rollback saga dang dở.)

### Quy tắc idempotency (bắt buộc)
- `reserve / release / commit / charge / refund` đều khoá theo `orderId` (UNIQUE trong DB). Gọi lại → trả kết quả cũ, không thay đổi số liệu.
- `/checkout` lưu `Idempotency-Key → orderId`; gửi trùng key → trả order cũ.

## 5. Các case rủi ro phải demo

| # | Case | Cách gây | Kết quả mong đợi |
|---|---|---|---|
| 0 | Happy path | – | `CONFIRMED`, tiền giảm, `available` giảm, có 1 CHARGE |
| 1 | Hết hàng | qty > available | Fail ở bước 2, không cần bù trừ → `CANCELLED`, số liệu không đổi |
| 2 | Không đủ tiền | user số dư thấp | `402` ở bước 3 → **`/release`** → `CANCELLED`, kho trở lại như cũ |
| 3 | Payment sập | Payment fault `down` | `503` → `/release` → `CANCELLED` |
| 4 | **Timeout mơ hồ** | Payment fault `timeout_after_commit` | Orchestrator timeout → gọi **`/refund` + `/release`** → tiền được hoàn (có CHARGE + REFUND), kho trở lại |
| 5 | Lỗi sau payment | `simulate.failAt = "confirm"` | Hoàn **toàn bộ**: `/refund` → `/release` → `CANCELLED` |
| 6 | **Bù trừ cũng lỗi** | Payment fail (case 2) + Inventory fault `down` | Retry 3 lần → `COMPENSATION_FAILED`; tắt fault → bấm Retry → `CANCELLED` |
| 7 | **Orchestrator crash** | `simulate.crashAfter = "reserve"` (process.exit) | Restart Order → recovery → `/release` → `CANCELLED` |
| 8 | Request trùng | Gửi 2 lần cùng `Idempotency-Key` | 1 order, 1 lần CHARGE |
| 9 | Tranh nhau hàng cuối | 2 checkout song song, kho còn 1 | 1 `CONFIRMED`, 1 `CANCELLED` (semantic lock `available/reserved`) |

**Invariant kiểm tra sau mọi case** (in ra trong evidence):
- `Σ balance + Σ(CHARGE − REFUND)` = tổng số dư ban đầu.
- `available + reserved + đã bán` = tồn kho ban đầu cho từng sản phẩm.
- Không order nào kẹt ở trạng thái trung gian (trừ lúc đang chạy).

## 6. Seed data
- Accounts: `alice` 1 000 000, `bob` 200 000, `carol` 50 000 (số dư thấp → case 2).
- Products: `Laptop` 800 000 ×3, `Mouse` 150 000 ×10, `Keyboard` 300 000 ×5, `Last Item` 100 000 ×1 (case 9).

## 7. UI (`src/order/public/index.html`, HTML/JS thuần)
Tự refresh mỗi 2s. Gồm các panel:
1. **Accounts** — số dư từng user (Payment `/accounts`).
2. **Inventory** — `available / reserved` từng sản phẩm (Inventory `/products`).
3. **Checkout form** — chọn user, sản phẩm, qty, checkbox simulate (`failAt=confirm`, `crashAfter=reserve`).
4. **Fault panel** — dropdown mode cho từng service (gọi `/admin/faults`), hiển thị fault hiện tại.
5. **Orders** — danh sách order + status (màu), click để xem **saga log** dạng timeline (ACTION xanh, COMPENSATION cam, FAILED đỏ); nút Retry compensation nếu `COMPENSATION_FAILED`.
6. **Transactions** — CHARGE/REFUND (Payment `/transactions`) + reservations (Inventory).
7. **Scenario buttons** — mỗi nút chạy 1 case ở mục 5 (set fault + checkout + reset fault).

---

## 8. Kế hoạch thực hiện & chia agent song song

### Phase 0 — Khung + Contract (1 agent, ~10 phút, làm TRƯỚC)
- `package.json` (đủ dependency: express, better-sqlite3, cors, concurrently, tsx, typescript, @types/*), `tsconfig.json`, `.gitignore` (`data/*.db`).
- `src/shared/`: `db.ts` (mở DB theo tên + chạy schema), `faults.ts` (middleware + route `/admin/faults`), `http.ts` (fetch có timeout + retry/backoff).
- `CONTRACT.md`: chép mục 3–4–6 thành bản chính thức với ví dụ JSON request/response và mã lỗi.
- Stub `server.ts` rỗng cho 3 service (chỉ listen + `/health`), `npm install`, chạy `npm run dev` thấy 3 service lên.

### Phase 1 — 5 agent song song (~25 phút)
Mỗi agent **chỉ sửa thư mục của mình** → không xung đột, có thể dùng chung checkout.

| Agent | Phạm vi file | Việc chính | Case |
|---|---|---|---|
| **A – Inventory** | `src/inventory/**` | schema, seed, reserve/release/commit idempotent, semantic lock, gắn faults | 1, 6, 9 |
| **B – Payment** | `src/payment/**` | schema, seed, charge/refund idempotent, transactions, `timeout_after_commit` | 2, 3, 4 |
| **C – Order/Orchestrator** | `src/order/*.ts`, `src/order/schema.sql` | `/checkout`, máy trạng thái, saga_log, bù trừ ngược, retry/backoff, recovery khi start, idempotency key, simulate | 5, 6, 7, 8 |
| **D – UI** | `src/order/public/**` | các panel ở mục 7, chỉ gọi API theo CONTRACT | – |
| **E – Scenarios** | `scripts/scenarios.ts`, `scripts/reset.ts` | chạy case 0–9 qua HTTP, in before/after + kiểm tra invariant → `evidence/scenarios.md` | tất cả |

Agent C nặng nhất → dùng model mạnh nhất. D, E có thể dùng model rẻ hơn.
Case 7 (crash): E chạy Order service như child process để kill + restart.

**Prompt mẫu cho mỗi agent** (thay phần `[...]`):
```
Làm trong Block-7. Đọc PLAN.md và CONTRACT.md trước.
Bạn là Agent [X – tên]. CHỈ được sửa: [phạm vi file].
KHÔNG sửa package.json, CONTRACT.md, src/shared/ hay thư mục của agent khác.
Nếu contract thiếu/sai, ghi vào cuối báo cáo, không tự đổi.
Việc cần làm: [cột "Việc chính" + các case liên quan ở mục 5].
Xong thì tự chạy service của bạn và curl thử các endpoint, báo lại kết quả.
Không commit.
```

### Phase 2 — Ghép & chứng minh (1 agent, ~10–15 phút)
1. `npm run reset && npm run dev`, mở `http://localhost:3001`.
2. `npm run scenarios` → cả 10 case pass, invariant đúng.
3. Bấm thử vài case trên UI, chụp màn hình vào `evidence/`.
4. Viết `README.md`: cách chạy, sơ đồ, bảng case rủi ro + cách Saga xử lý, ghi chú "HTTP đồng bộ có thể thay bằng message broker (outbox + Kafka/RabbitMQ)".

### Cắt giảm nếu trễ giờ
1. Bỏ case 9 và 8.
2. Bỏ Agent E → demo bằng nút trên UI.
3. Bỏ Agent D → Order service trả HTML đơn giản dạng bảng.
Giữ lại tối thiểu: case 0, 2, 4, 6, 7 (thể hiện rõ nhất bù trừ, timeout mơ hồ, bù trừ lỗi và crash recovery).
