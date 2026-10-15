# Kết quả các tình huống lỗi

Các kết quả dưới đây là response ngoài mà Order API trả cho client.
Timestamp và thời gian được lấy từ script verify:failure-modes.

| Case | Bắt đầu | Kết thúc | Thời gian | HTTP status | Response ngoài |
|---|---|---|---:|---:|---|
| Thiếu hàng | 2026-10-12T13:28:39.627Z | 2026-10-12T13:28:39.671Z | 44 ms | 409 | {"success":false,"error":"INSUFFICIENT_STOCK","message":"Not enough stock"} |
| Inventory chậm | 2026-10-12T13:28:40.625Z | 2026-10-12T13:28:41.648Z | 1023 ms | 504 | {"success":false,"error":"INVENTORY_TIMEOUT","message":"Inventory service timed out"} |
| Inventory tắt | 2026-10-12T13:28:42.239Z | 2026-10-12T13:28:42.269Z | 30 ms | 502 | {"success":false,"error":"INVENTORY_UNAVAILABLE","message":"Inventory service unavailable"} |

## Ý nghĩa

- Thiếu hàng là lỗi nghiệp vụ và được ánh xạ thành HTTP 409.
- Inventory chậm quá deadline 1000 ms và được ánh xạ thành HTTP 504.
- Inventory tắt/mất kết nối và được ánh xạ thành HTTP 502.
- Cả ba trường hợp đều không tạo order mới.

File JSON gốc và log chi tiết nằm cùng thư mục evidence/07-failure-handling.
