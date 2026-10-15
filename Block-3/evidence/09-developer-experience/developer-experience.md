# Developer experience

## REST

- Dễ gọi bằng Browser, curl hoặc Swagger.
- Dễ xem request và response vì dữ liệu là JSON.
- Không cần bước sinh code.
- Debug lỗi HTTP trực tiếp và quen thuộc.
- Nhược điểm là phải tự thống nhất schema giữa client và server.

## gRPC

- Cần viết và quản lý file proto.
- Cần load hoặc sinh code client/server.
- Contract rõ ràng và kiểu dữ liệu được chia sẻ giữa hai bên.
- Payload protobuf nhỏ hơn trong phép đo này.
- Debug trực tiếp khó hơn JSON; thường cần log RPC hoặc công cụ hỗ trợ gRPC.
- Khi proto thay đổi phải giữ nguyên tag và kiểm tra tương thích client cũ.

## Kết luận thực tế

REST thuận tiện hơn cho demo và debug nhanh. gRPC yêu cầu nhiều bước chuẩn bị hơn
nhưng có contract rõ ràng và serialization compact hơn cho giao tiếp nội bộ.
