# Log lời gọi nội bộ

## before-rest

Order API có event inventory.request và Inventory Service có HTTP POST
/inventory/reserve.

## after-grpc

Order API có event inventory.grpc.request với method ReserveStock và Inventory
Service có event grpc.reserve.request/grpc.reserve.response.

Correlation ID trong log dùng để nối một request từ Order API sang Inventory.
Các timestamp và correlation ID chỉ dùng để theo dõi, không dùng khi so sánh
nội dung nghiệp vụ.
