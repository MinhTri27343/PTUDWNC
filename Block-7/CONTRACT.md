# CONTRACT v2 — Block 7 Checkout Saga

Bám theo đề: https://pub.nndkhoa9.win/webadv/w6/block-07-saga-interactive.html (slide 25–31).
Đây là nguồn sự thật duy nhất cho mọi agent. Nếu thấy sai/thiếu: ghi vào báo cáo, **không tự đổi**.

## 0. Quy ước chung
- 3 process, 3 DB SQLite riêng: `data/order.db`, `data/inventory.db`, `data/payment.db`. Service **chỉ mở DB của mình**; dữ liệu service khác chỉ đọc qua HTTP API.
- Ports (`src/shared/config.ts`): ctl **3000** (process manager + UI), order **3001**, inventory **3002**, payment **3003**. **Chỉ bind loopback**: `app.listen(PORTS.x, HOST)` với `HOST = "127.0.0.1"`.
- ESM + TS chạy bằng `tsx`; import nội bộ dùng đuôi `.js`. Lấy thư mục file bằng `path.dirname(fileURLToPath(import.meta.url))`.
- Shared có sẵn — dùng, không sửa:
  - `src/shared/db.ts` → `openDb(name, schemaFile)`, `nowIso()`
  - `src/shared/operations.ts` → `ensureOpsTable(db)`, `runOp(db, {op_id,type,request}, work)`, `getOp(db, op_id)` (idempotency theo operation ID + bảng `operations`)
  - `src/shared/faults.ts` → `installFaults(app, svc)`, `takeFault(hook)`, `marker(text)`, `crashNow(reason)`
  - `src/shared/http.ts` → `callOp(url, body)` (SUCCEEDED / FAILED / UNKNOWN), `queryOp(opsBaseUrl, op_id)` (SUCCEEDED/FAILED/PENDING/NOT_FOUND/UNREACHABLE), `rawJson`, `sleep`
- Khung server mỗi service: `cors()`, `express.json()`, `installFaults(app, "<svc>")`, `GET /health → {ok:true, service, pid}`, routes, listen trên HOST.
- Thời gian ISO. Tiền là số nguyên VND. Field JSON dùng **snake_case**.
- Body response của mọi operation: `{ op_id, op_status: "SUCCEEDED"|"FAILED", ...domain fields, error? }`.
  - `FAILED` = từ chối **dứt khoát** (không bao giờ commit về sau) → HTTP 409/402/422.
  - 5xx / mất kết nối / timeout **không** phải FAILED → orchestrator coi là UNKNOWN.
- Operation status khi query: `PENDING | SUCCEEDED | FAILED`; chưa có bản ghi → 404 `{op_id, op_status:"NOT_FOUND"}` (chỉ nghĩa là "chưa thấy ở lần query này").
- Mỗi service có `POST /admin/reset` → xoá toàn bộ bảng của nó (kể cả `operations`) + seed lại. Chỉ dùng để reset fixture giữa các tình huống, **không** dùng để mô phỏng restart.

## 1. Operation ID (ổn định, sinh từ saga_id)
Orchestrator sinh **một lần** khi tạo saga và lưu trong saga record, mọi lần retry/replay/resume đều dùng lại:
| Bước | op_id |
|---|---|
| create order | `create_op_id` = header `Idempotency-Key` (client gửi; không có thì Order tự sinh) |
| reserve | `${saga_id}:reserve` |
| charge | `${saga_id}:charge` |
| confirm (local Order) | `${saga_id}:confirm` |
| refund | `${saga_id}:refund` |
| release | `${saga_id}:release` |
| cancel (local Order) | `${saga_id}:cancel` |

`order_id` = `O-` + 6 ký tự hex, `saga_id` = `S-` + 6 ký tự hex.

## 2. Fault hooks (arm qua `POST /admin/faults {hook, count?}`)
| Service | hook | Hành vi | Dùng cho |
|---|---|---|---|
| inventory | `reserve.reject` | reserve trả FAILED `RESERVE_REJECTED` (409), có ghi op FAILED | F1 (cách 2; cách 1 = đặt quá tồn) |
| inventory | `release.fail` | release trả **503** không ghi op, không đổi dữ liệu (lỗi tạm thời) | thêm |
| payment | `charge.reject` | charge trả FAILED `CHARGE_DECLINED` (402), ghi op FAILED | F2 (cách 2; cách 1 = carol không đủ tiền) |
| payment | `charge.crash_after_commit` | commit charge + ghi op SUCCEEDED, **rồi `crashNow()` trước khi gửi response** | F4 |
| payment | `refund.fail` | refund trả **503** không ghi op, không đổi dữ liệu (lỗi tạm thời) | F5 (`count` = 4) |
| order | `confirm.reject` | confirm local trả FAILED `CONFIRM_REJECTED` | F3, F5 |
| order | `crash.after_intent.<step>` | sau khi ghi intent bền vững, **trước** khi gọi → `crashNow()` | F6 |
| order | `crash.after_call.<step>` | sau khi provider đã trả lời, **trước** khi ghi outcome → `crashNow()` | F6 (mặc định dùng `crash.after_call.charge`) |

`<step>` ∈ `reserve | charge | confirm | refund | release`. Mỗi lần hook bắn: gọi `marker(...)`.

## 3. Inventory :3002 — `data/inventory.db`
Seed items (`initial` = tồn ban đầu):
| item_id | name | price | initial |
|---|---|---|---|
| `A` | Tai nghe Bluetooth | 100000 | 10 |
| `B` | Đồng hồ thông minh | 300000 | 5 |
| `C` | Laptop | 800000 | 2 |

Bảng gợi ý: `items(item_id PK, name, price, available, initial)`, `reservations(reservation_id PK 'R-xxxxxx', order_id, item_id, quantity, amount, status ACTIVE|RELEASED, reserve_op_id, release_op_id NULL, created_at, updated_at)`, `movements(movement_id INTEGER PK, order_id, reservation_id, op_id, type RESERVE|RELEASE, item_id, quantity, available_after, created_at)`, `operations` (qua `ensureOpsTable`).

| Method | Path | Body / Trả về |
|---|---|---|
| POST | `/inventory/reservations` | `{order_id, item_id, quantity, reserve_op_id}` → **201** `{op_id, op_status:"SUCCEEDED", reservation_id, order_id, item_id, quantity, unit_price, amount, status:"ACTIVE"}`. Thiếu hàng → **409** `{op_status:"FAILED", error:"OUT_OF_STOCK"}`. item lạ → 409 FAILED `UNKNOWN_ITEM`. quantity ≤0 → 422 FAILED `BAD_QUANTITY`. Thiếu field → 400 (không phải op). Thành công: `available -= quantity`, insert reservation + movement RESERVE, tất cả trong `runOp` (1 transaction). |
| POST | `/inventory/reservations/:reservation_id/release` | `{release_op_id}` → 200 `{op_id, op_status:"SUCCEEDED", reservation_id, status:"RELEASED"}`; `available += quantity`, movement RELEASE. Reservation đã RELEASED bởi op khác → vẫn SUCCEEDED, không tác động thêm. reservation lạ → 404 FAILED `UNKNOWN_RESERVATION`. Replay cùng op → kết quả cũ. |
| GET | `/inventory/operations/:op_id` | `getOp()` |
| GET | `/inventory/items` | `[{item_id, name, price, available, reserved, initial}]` (`reserved` = Σ quantity ACTIVE) |
| GET | `/inventory/reservations` | `[{reservation_id, order_id, item_id, quantity, amount, status, reserve_op_id, release_op_id, created_at, updated_at}]` mới nhất trước |
| GET | `/inventory/movements` | `[{movement_id, order_id, reservation_id, op_id, type, item_id, quantity, available_after, created_at}]` mới nhất trước |

Invariant: mỗi item `available + reserved == initial`.

## 4. Payment :3003 — `data/payment.db`
Seed accounts: `alice` 1 000 000, `bob` 200 000, `carol` 50 000.
Bảng gợi ý: `accounts(account_id PK, name, balance, initial)`, `ledger(entry_id INTEGER PK, type CHARGE|REFUND, charge_id 'C-xxxxxx', refund_id NULL 'RF-xxxxxx', order_id, account_id, amount, op_id, created_at)` — **append-only, không bao giờ xoá/sửa dòng**, `operations`.

| Method | Path | Body / Trả về |
|---|---|---|
| POST | `/payments/charges` | `{order_id, account_id, amount, charge_op_id}` → **201** `{op_id, op_status:"SUCCEEDED", charge_id, order_id, account_id, amount, status:"CHARGED", balance_after}`. Không đủ tiền → **402** FAILED `INSUFFICIENT_FUNDS`. account lạ → 404 FAILED `UNKNOWN_ACCOUNT`. Hook `charge.crash_after_commit`: sau khi `runOp` commit xong → `crashNow()` (không gửi response). |
| POST | `/payments/charges/:charge_id/refund` | `{refund_op_id}` → 200 `{op_id, op_status:"SUCCEEDED", refund_id, charge_id, amount, status:"REFUNDED"}`; `balance += amount`, ledger REFUND tham chiếu charge gốc. Đã refund bởi op khác → SUCCEEDED trả refund cũ. charge lạ → 404 FAILED `UNKNOWN_CHARGE`. Hook `refund.fail` → 503 trước khi làm gì. |
| GET | `/payments/operations/:op_id` | `getOp()` |
| GET | `/payments/accounts` | `[{account_id, name, balance, initial}]` |
| GET | `/payments/ledger` | `{entries:[{entry_id, type, charge_id, refund_id, order_id, account_id, amount, op_id, created_at}] (mới nhất trước), total_charged, total_refunded, net}` |

Invariant: `Σ balance + net == Σ initial`.

## 5. Order :3001 — `data/order.db` (orchestrator + Saga record)
### State machine (guard bắt buộc — chuyển trạng thái sai thì throw)
```
PENDING     --reserve OK-->           RESERVED
PENDING     --reserve FAILED-->       CANCELLED      (chưa có gì để bù)
PENDING     --reserve UNKNOWN-->      RECOVERING
RESERVED    --charge OK-->            CHARGED
RESERVED    --charge FAILED-->        COMPENSATING   (pending: [release])
RESERVED    --charge UNKNOWN-->       RECOVERING
RECOVERING  --biết SUCCEEDED-->       RESERVED / CHARGED   (tuỳ intent đang dở)
RECOVERING  --biết FAILED-->          CANCELLED (reserve) / COMPENSATING (charge)
CHARGED     --confirm OK-->           CONFIRMED
CHARGED     --confirm FAILED-->       COMPENSATING   (pending: [refund, release])
COMPENSATING --pending rỗng-->        CANCELLED
```
Terminal: `CONFIRMED`, `CANCELLED`. Guard terminal:
- CONFIRMED cần có `reservation_id` + `charge_id`, pending rỗng.
- CANCELLED cần pending rỗng, không còn reservation ACTIVE chưa release và không còn charge chưa refund (theo saga record).

Không có trạng thái "COMPENSATION_FAILED": bù lỗi tạm thời ⇒ **giữ COMPENSATING + pending**, resumer thử lại.

### Saga record (Order DB)
- `orders(order_id PK, saga_id UNIQUE, create_op_id UNIQUE, account_id, item_id, quantity, amount NULL, status, created_at, updated_at)`
- `sagas(saga_id PK, order_id, phase, intent JSON NULL, pending JSON '[]', reservation_id, charge_id, refund_id, amount, last_error, op_ids JSON, created_at, updated_at)`
  - `intent` = `{step, op_id, request, at}` — ghi **trước** khi gọi provider (durable intent).
  - `pending` = danh sách bước bù còn thiếu, theo thứ tự: `["refund","release"]`.
- `saga_events(id PK, saga_id, at, phase, kind INTENT|OUTCOME|STATE|RESUME|QUERY|ERROR|MARKER, step, op_id, detail)` — lịch sử cho UI/evidence.
- `operations` (ensureOpsTable) cho confirm/cancel local.
- `orders.status` luôn = `sagas.phase`.

### Mỗi bước remote = intent → call → outcome
1. Ghi `intent` (transaction local) + event INTENT.
2. `takeFault("crash.after_intent.<step>")` → crash.
3. `callOp(...)` với op_id cố định.
4. `takeFault("crash.after_call.<step>")` → crash.
5. Ghi outcome + chuyển trạng thái (1 transaction) + event OUTCOME, xoá intent.
- SUCCEEDED → bước tiếp. FAILED → nhánh bù. UNKNOWN (forward step) → **RECOVERING**, giữ intent. UNKNOWN (bước bù) → giữ COMPENSATING + pending + intent.
- Không bao giờ tạo op_id mới để "vượt qua" timeout.

### Resume (cùng một hàm cho: resumer nền mỗi `RESUME_INTERVAL_MS`, startup, `POST /sagas/:saga_id/resume`, `POST /admin/resume`)
- Saga không terminal, đang không được drive (lock trong RAM theo saga_id).
- Có `intent` dở → `queryOp(provider ops url, intent.op_id)`:
  - SUCCEEDED → áp outcome như call thành công.
  - FAILED → áp nhánh thất bại.
  - NOT_FOUND → **replay cùng op_id + cùng request** (an toàn nhờ idempotency).
  - PENDING / UNREACHABLE → giữ nguyên (RECOVERING/COMPENSATING), event QUERY, thử lại lần sau.
- Hết intent → tiếp tục theo phase: PENDING→reserve, RESERVED→charge, CHARGED→confirm, COMPENSATING→chạy pending theo thứ tự (refund trước, release sau), xong → cancel → CANCELLED.
- Confirm/cancel là op local trong Order DB qua `runOp` (`confirm_op_id`, `cancel_op_id`).

### API
| Method | Path | Ghi chú |
|---|---|---|
| POST | `/orders` | header `Idempotency-Key` (= create_op_id). Body `{account_id, item_id, quantity}`. Tạo order + saga (PENDING) trong 1 transaction, rồi **drive saga nền** và trả **201** `{order_id, saga_id, status}` ngay. Query `?wait=1` → đợi tới terminal hoặc bị chặn (RECOVERING/COMPENSATING) tối đa 10s rồi trả order hiện tại. Trùng Idempotency-Key → 200 order cũ. Thiếu field → 400. |
| GET | `/orders` | `?status=` lọc tuỳ chọn. `[{order_id, saga_id, account_id, item_id, quantity, amount, status, created_at, updated_at}]` mới nhất trước |
| GET | `/orders/:order_id` | order |
| GET | `/orders/:order_id/saga` | `{saga_id, order_id, phase, intent, pending, op_ids, reservation_id, charge_id, refund_id, amount, last_error, events:[...]}` |
| POST | `/sagas/:saga_id/resume` | drive ngay 1 lần, trả saga |
| POST | `/admin/resume` | resume tất cả saga dở, trả `[{saga_id, phase}]` |
| GET | `/orders/operations/:op_id` | `getOp()` cho confirm/cancel |
| POST | `/admin/reset` | xoá dữ liệu Order DB |

Startup: listen xong → chạy resume ngay (đây là phục hồi sau crash) → bật interval resumer.

## 6. Ctl :3000 — process manager + UI (`scripts/ctl.ts`)
- Spawn 3 service là **3 child process thật** (`node --import tsx src/<svc>/server.ts`), stdout/stderr → console (có prefix) + `logs/<svc>.log`. **Không tự restart** khi process chết.
- Serve UI tĩnh từ `src/ui/` tại `/`.
- `GET /ctl/status` → `{order:{running, pid, started_at, exit_code}, inventory:{...}, payment:{...}}`
- `POST /ctl/:svc/start` | `POST /ctl/:svc/stop` (kill thật) → trả status; start đợi `/health` OK (tối đa 10s).
- `POST /ctl/reset` → gọi `/admin/reset` + `DELETE /admin/faults` trên cả 3 service (start service nào đang tắt trước).
- `npm start` = chạy ctl + start cả 3 service.

## 7. Oracle các tình huống (test + demo + UI dùng chung)
Order mặc định: `alice`, item `A`, quantity 1 (amount 100 000). Reset fixture trước mỗi tình huống.
| Mã | Thiết lập | Oracle cuối |
|---|---|---|
| H0 | không fault | CONFIRMED; 1 reservation ACTIVE; ledger đúng 1 CHARGE, 0 REFUND; pending [] |
| F1 | quantity 11 (> tồn 10) | CANCELLED; 0 reservation; 0 movement; ledger trống; không gọi charge |
| F2 | `carol`, item `B` (300 000 > 50 000) | CANCELLED; reservation RELEASED (movement RESERVE + RELEASE); 0 CHARGE, 0 REFUND |
| F3 | order hook `confirm.reject` | CANCELLED; ledger 1 CHARGE + 1 REFUND (refund **trước** release); reservation RELEASED |
| F4 | payment hook `charge.crash_after_commit` → Payment process chết | **Trong lúc Payment chết: RECOVERING** (không CANCELLED/CONFIRMED). Start lại Payment → resumer query `S-…:charge` → SUCCEEDED → CONFIRMED. Ledger đúng 1 CHARGE, cùng op_id. |
| F5 | F3 + payment hook `refund.fail` count 4 | Trong lúc refund lỗi: **COMPENSATING**, pending `["refund","release"]`. Sau đó: CANCELLED; đúng 1 REFUND rồi 1 RELEASE. |
| F6 | order hook `crash.after_call.charge` → Order process chết | Payment đã CHARGED, Order DB còn intent charge. Start lại Order → resume query/replay cùng op → CONFIRMED; đúng 1 CHARGE. |
Invariant chung sau mỗi tình huống: tiền (`Σbalance + net == Σinitial`), kho (`available + reserved == initial`), không có CHARGE/REFUND ngoài dự kiến.
