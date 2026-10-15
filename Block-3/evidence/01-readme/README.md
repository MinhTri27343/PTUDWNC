# Block 3 - REST và gRPC
## 1. Cài đặt và reset dữ liệu

Chạy tại thư mục gốc project:

~~~powershell
npm install
npm run seed
~~~

## 2. Sinh hoặc kiểm tra code từ proto
Proto của Inventory Service:

- apps/inventory-service/proto/v1/inventory.proto: contract cũ, chưa có remaining_stock.
- apps/inventory-service/proto/v2/inventory.proto: contract mới, có remaining_stock = 4.

Chạy lệnh project cung cấp:

~~~powershell
npm run proto:generate --workspace apps/inventory-service
~~~

Trên môi trường Windows hiện tại, lệnh này kiểm tra proto contract và xác nhận các file v1/v2 tồn tại. Binary protoc đi kèm grpc-tools không chạy được do lỗi native runtime, nên implementation hiện tại load proto lúc chạy bằng @grpc/proto-loader.

Nếu máy có grpc_tools_node_protoc hoạt động, có thể sinh JavaScript từ proto v2 bằng lệnh sau, chạy trong apps/inventory-service:

~~~powershell
grpc_tools_node_protoc --js_out=import_style=commonjs,binary:src/generated --grpc_out=grpc_js:src/generated -I proto/v2 proto/v2/inventory.proto
~~~

Không sửa file generated thủ công. Khi proto thay đổi, sửa file .proto rồi chạy lại code generation.

## 3. Chạy toàn bộ hệ thống

~~~powershell
npm run seed
npm run dev
~~~

Các địa chỉ:

- React: http://localhost:5173
- Order API: http://localhost:3000
- Inventory HTTP/REST: http://localhost:3001
- Inventory gRPC: localhost:50051

## 4. Mô phỏng Inventory chậm hoặc bị tắt

Inventory chậm 5 giây, nhưng Order API chỉ chờ 1 giây:

~~~powershell
$env:INVENTORY_DELAY_MS="5000"
$env:INVENTORY_DEADLINE_MS="1000"
npm run dev
~~~

Kết quả mong đợi: Browser nhận HTTP 504 với error=INVENTORY_TIMEOUT trong thời gian hữu hạn.

Để kiểm tra Inventory bị tắt, chỉ chạy Order API hoặc dừng Inventory Service, sau đó gọi POST /orders. Kết quả mong đợi: HTTP 502 với error=INVENTORY_UNAVAILABLE; request không bị treo vô hạn.

## 5. Swagger

- Order API Swagger: http://localhost:3000/docs
- Inventory Service Swagger: http://localhost:3001/docs



