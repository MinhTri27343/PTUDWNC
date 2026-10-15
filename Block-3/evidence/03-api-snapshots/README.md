# Snapshot API ngoài

Mỗi case có request, HTTP status và body mà Browser nhận được.

- before-rest: phiên bản Order API gọi Inventory bằng REST.
- after-grpc: phiên bản Order API gọi Inventory bằng gRPC.

Hai case:

- A001 quantity 2: đủ hàng, HTTP 201.
- A002 quantity 2: thiếu hàng, HTTP 409.

order_id, timestamp và correlationId là giá trị động; khi đối chiếu cần chuẩn hóa
hoặc bỏ qua các giá trị này.
