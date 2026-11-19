# Block 7 — Checkout Saga

Ứng dụng checkout dùng **Saga (orchestration)** với 3 service chạy thành **3 process thật**, mỗi service **một DB SQLite riêng**. Không Docker, không broker. Mọi service chỉ bind `127.0.0.1`.

```
            UI (http://127.0.0.1:3000)  ── chỉ đọc qua API ──┐
                       │                                     │
  ctl :3000  ── spawn/kill process thật ──┬──────────────┬───┘
                                          ▼              ▼              ▼
                               Order :3001        Inventory :3002   Payment :3003
                               orchestrator +     reservations,     ledger charge/refund
                               Saga record        lịch sử kho
                               data/order.db      data/inventory.db data/payment.db
```

## 1. Cài đặt (một lần)
Yêu cầu Node.js ≥ 20.

```bash
npm install
```

## 2. Chạy
```bash
npm start
```
Lệnh này bật process manager (ctl) và 3 service. Mở **http://127.0.0.1:3000** → có link tới **4 app**:
| App | URL | Dành cho |
|---|---|---|
| 🛒 Cửa hàng | `/shop.html` | Khách đặt hàng ("Bạn đang là" alice/bob/carol), xem đơn, số dư ví, lịch sử ví |
| 📦 Kho hàng | `/inventory.html` | Tồn kho, lịch sử nhập/xuất |
| 💳 Thanh toán | `/payment.html` | Số dư khách, giao dịch thu/hoàn tiền |
| ⚙️ Admin kỹ thuật | `/admin.html` | Bật/tắt (kill thật) từng service, cài/gỡ lỗi, reset dữ liệu mẫu, Saga record từng đơn (bước, intent, pending, op_id, nhật ký), dữ liệu kỹ thuật 3 DB, đối soát tiền/kho |

3 app đầu chỉ có giao diện nghiệp vụ; mọi thao tác kỹ thuật để dựng tình huống lỗi nằm ở **Admin**.

Thứ tự demo khi trình bày: xem [demo.md](demo.md).

Log từng service: `logs/order.log`, `logs/inventory.log`, `logs/payment.log` (tìm `[FAULT-MARKER]`).

## 3. Các lệnh tiện ích (mở terminal khác, giữ `npm start` đang chạy)
| Lệnh | Tác dụng |
|---|---|
| `npm run svc -- status` | Xem process nào đang chạy |
| `npm run svc -- kill payment` | Kill **thật** process Payment (`order` / `inventory` / `payment` / `all`) |
| `npm run svc -- start payment` | Bật lại process |
| `npm run reset` | Reset dữ liệu mẫu (fixture) + xoá fault của cả 3 service |
| `npm run resume` | Bắt Order resume mọi saga đang dở (`npm run resume -- S-xxxxxx` cho 1 saga) |
| `npm test` | Automated tests H0, F1, F2, F3 (+ F4–F6 bonus) |
| `npm run demo -- F4` | Demo F4/F5/F6 bằng kill/start process thật, ghi evidence vào `evidence/F4.md` (`all` = chạy hết) |

`npm test` và `npm run demo` tự bật ctl nếu chưa chạy.

## 4. Các tình huống
Mặc định: `alice` mua 1 × Tai nghe Bluetooth (item A, 100 000 đ).

| Mã | Lỗi | Kết quả đúng |
|---|---|---|
| H0 | Không lỗi | CONFIRMED, 1 charge, giữ hàng |
| F1 | Reserve bị từ chối (mua 11 > tồn 10) | CANCELLED, không charge |
| F2 | Charge bị từ chối (carol không đủ tiền) | release hàng → CANCELLED |
| F3 | Confirm bị từ chối sau khi đã charge | **refund rồi release** → CANCELLED |
| F4 | Payment chết **sau khi commit charge, trước khi trả response** | **RECOVERING** khi Payment chết → Start Payment → query lại cùng `charge_op_id` → CONFIRMED (không charge lần 2) |
| F5 | F3 nhưng refund lỗi tạm thời | **COMPENSATING** + pending `[refund, release]` → tự thử lại → CANCELLED |
| F6 | Order (orchestrator) crash giữa "đã gọi charge" và "ghi kết quả" | Start Order → đọc intent trong DB → query/replay cùng op_id → CONFIRMED |

Demo tay: cài lỗi ở Admin → đặt hàng ở Cửa hàng → quan sát ở 3 app + Admin → bật lại service ở Admin nếu cần. Các bước chi tiết: [demo.md](demo.md).

## 5. Thiết kế chính
- **State machine có guard** (`src/order/stateMachine.ts`): `PENDING → RESERVED → CHARGED → CONFIRMED`; lỗi dứt khoát → `COMPENSATING → CANCELLED`; không rõ kết quả → `RECOVERING`.
- **Durable intent**: trước mỗi lời gọi remote, Order ghi `intent {step, op_id}` vào Order DB. Crash ở đâu thì khởi động lại vẫn biết đang dở bước nào.
- **Operation ID ổn định**: `S-xxxxxx:reserve`, `:charge`, `:refund`, `:release`, … Retry, replay, resume đều dùng lại đúng ID → provider idempotent, không trừ tiền 2 lần.
- **Timeout ≠ thất bại**: kết quả UNKNOWN thì không hủy, không charge mới, mà query `GET /payments/operations/:op_id` (hoặc `/inventory/operations/:op_id`).
- **Bù trừ theo thứ tự ngược**: refund trước, release sau. Lỗi tạm thời → giữ `pending`, resumer thử lại mỗi 2 s.
- Ledger Payment chỉ ghi thêm (charge và refund đều giữ lại).

| Bước tiến (local commit) | DB | Bước bù |
|---|---|---|
| CreateOrder | Order | CancelOrder |
| ReserveInventory | Inventory | ReleaseInventory |
| ChargePayment | Payment | RefundPayment |
| ConfirmOrder (pivot) | Order | — (không bù trong lab) |

Cấu hình (`src/shared/config.ts`): timeout gọi service 2 s, resumer chạy mỗi 2 s.
Chi tiết API: [CONTRACT.md](CONTRACT.md).

## 6. Cấu trúc thư mục
```
src/shared/    helper chung: config, db, operations (idempotency), faults, http
src/order/     Order service + orchestrator + state machine + resume
src/inventory/ Inventory service
src/payment/   Payment service
src/ui/        Web UI (ctl serve)
scripts/       ctl (process manager), svc, reset, resume, demo
tests/         automated tests
data/          3 file SQLite (tự tạo)
logs/          log từng service
evidence/      kết quả demo F4–F6
```
