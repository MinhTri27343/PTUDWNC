# REPORT - REST và gRPC giữa Order API và Inventory Service

## 1. Mục tiêu

Nhóm xây dựng một flow đặt hàng gồm Browser, Order API và Inventory Service.
API mà Browser sử dụng được giữ nguyên; chỉ thay đổi giao tiếp nội bộ giữa
Order API và Inventory Service từ REST sang gRPC.

## 2. Kiến trúc đã chọn

~~~text
React Browser
    |
    | REST/JSON - POST /orders
    v
Order API :3000
    |
    | gRPC - ReserveStock
    v
Inventory Service :50051
    |
    v
SQLite
~~~

Nhóm chọn React và Express.js vì bài cần một UI đơn giản và hai HTTP service
dễ quan sát. SQLite được chọn vì dễ reset fixture và không cần cài database
riêng.

Inventory Service vẫn mở HTTP port 3001 để giữ health check, Swagger và chạy
baseline REST. Transport mặc định của Order API là gRPC; REST nội bộ vẫn có
thể bật lại bằng INVENTORY_TRANSPORT=rest để đối chiếu.

## 3. Fixture và contract bên ngoài

Nhóm dùng fixture cố định:

- A001 có 10 sản phẩm.
- A002 có 1 sản phẩm.

Hai request chuẩn:

- A001 quantity 2: đủ hàng.
- A002 quantity 2: thiếu hàng.

Contract ngoài được giữ ổn định:

- Đủ hàng trả HTTP 201.
- Thiếu hàng trả HTTP 409.
- Browser vẫn gọi POST /orders bằng JSON.
- Body response không phụ thuộc vào việc bên trong dùng REST hay gRPC.

Việc giữ contract ngoài giúp chứng minh rằng thay đổi transport nội bộ không
buộc Browser hoặc consumer bên ngoài phải cập nhật.

## 4. Lựa chọn biểu diễn lỗi

Thiếu hàng là lỗi nghiệp vụ, không phải lỗi kết nối. Vì vậy Inventory trả
response gRPC bình thường với:

~~~text
success = false
error = INSUFFICIENT_STOCK
~~~

Order API ánh xạ response này thành HTTP 409. Cách này tránh biến lỗi thiếu
hàng thành HTTP 500.

Các lỗi hạ tầng được ánh xạ riêng:

- DEADLINE_EXCEEDED -> HTTP 504 INVENTORY_TIMEOUT.
- UNAVAILABLE hoặc lỗi kết nối -> HTTP 502 INVENTORY_UNAVAILABLE.

Order API đặt deadline để request luôn kết thúc trong thời gian hữu hạn. Nhóm
không thêm retry để tránh làm thay đổi kết quả đo hoặc reserve cùng một order
nhiều lần.

## 5. Lựa chọn proto và tương thích

Proto v1 không có remaining_stock. Proto v2 thêm:

~~~proto
int32 remaining_stock = 4;
~~~

Các field cũ giữ nguyên tag, kiểu và ý nghĩa. Nhóm tách proto v1 và v2 để mô
phỏng hai thế hệ client:

- Client v1 không biết field mới nhưng vẫn gọi được server v2.
- Client v2 biết field mới và đọc được remaining_stock.

Với scalar proto3 không có presence, giá trị 0 và field vắng không phân biệt
được. Vì vậy client không kết luận rằng stock chắc chắn bằng 0 khi nhận giá
trị mặc định; trạng thái được xử lý là unknown_or_zero.

## 6. Lựa chọn cách load/generate proto

Theo thiết kế ban đầu, nhóm dự định dùng grpc-tools để sinh JavaScript client
và server. Trên Windows runtime hiện tại, binary protoc bundled không chạy
được, nên implementation cuối cùng dùng @grpc/proto-loader để load contract
khi chạy.

Đây là giới hạn môi trường build, không phải thay đổi thiết kế RPC. Lệnh kiểm
tra proto và output lỗi native được lưu trong:

~~~text
evidence/05-proto-diff/
~~~

Nếu cần đáp ứng nghiêm ngặt yêu cầu generated code, có thể chạy grpc-tools
trong WSL hoặc Docker, sinh inventory_pb.js và inventory_grpc_pb.js cho cả
proto v1 và v2, sau đó thay import proto-loader bằng các file generated.

## 7. Logging và evidence

Nhóm dùng correlation ID để nối một request qua các boundary.

REST baseline có các event như:

~~~text
inventory.request
inventory.response
~~~

Phiên bản gRPC có:

~~~text
inventory.grpc.request
grpc.reserve.request
grpc.reserve.response
~~~

Timestamp, order ID và correlation ID được xem là giá trị động khi so sánh
snapshot. Evidence được sắp xếp theo đầu mục yêu cầu trong:

~~~text
evidence/
~~~

Các thư mục chính gồm snapshot API, log nội bộ, proto diff, client
compatibility, failure handling, payload, developer experience và trade-off.

## 8. Kết quả lỗi

Nhóm đã kiểm tra:

- Thiếu hàng: HTTP 409, stock không giảm, không tạo order.
- Inventory chậm: HTTP 504 sau khi hết deadline.
- Inventory tắt: HTTP 502, request không treo vô hạn.
- Regression đủ hàng: HTTP 201 và stock giảm đúng.

Các kết quả có timestamp, status và response ngoài nằm trong:

~~~text
evidence/07-failure-handling/
~~~

## 9. Lựa chọn phép đo payload

Nhóm đo application-level payload trên cùng một request và response:

- REST request JSON: 27 bytes.
- gRPC request protobuf: 8 bytes.
- REST response JSON: 98 bytes.
- gRPC response protobuf: 28 bytes.

Không tính HTTP/2 headers, HTTP headers, TLS, TCP hoặc compression. Vì vậy
đây là phép đo kích thước message/payload, không phải tổng số byte mạng.

Kết quả và cách đo được ghi trong:

~~~text
evidence/08-payload/payload-measurement.md
~~~

## 10. Developer experience và trade-off

REST dễ gọi và debug hơn vì body là JSON và có thể dùng Browser, curl hoặc
Swagger trực tiếp. gRPC có contract rõ hơn và payload compact hơn, nhưng cần
quản lý proto, codegen hoặc proto-loader, deadline và tương thích version.

Nhóm không kết luận rằng gRPC luôn nhanh hơn REST. Phép đo hiện tại chỉ mô tả
serialization với fixture nhỏ trên máy local. Các giới hạn và trade-off được
ghi trong:

~~~text
evidence/09-developer-experience/
evidence/10-tradeoffs/
~~~

## 11. Kết luận

Kết quả cuối cùng đạt được mục tiêu chính của bài:

- Browser vẫn dùng API REST cũ.
- Order API gọi Inventory bằng gRPC trong mode mặc định.
- Response ngoài giữ nguyên cho đủ hàng và thiếu hàng.
- Client cũ vẫn hoàn tất flow với server mới.
- Client mới đọc được remaining_stock.
- Lỗi thiếu hàng, timeout và Inventory unavailable được ánh xạ rõ ràng.

Giới hạn còn lại là generated code thật chưa được chạy thành công trên Windows
runtime hiện tại; project đang dùng @grpc/proto-loader và đã lưu lại output
để giải thích quyết định này.
