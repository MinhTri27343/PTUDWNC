# Plan đã chốt trước khi hiện thực gRPC



## Các quyết định đã thống nhất

- Dùng Express.js cho Order API và Inventory Service.
- Dùng React cho giao diện Browser.
- Dùng SQLite làm database.
- Inventory Service chạy HTTP ở port 3001 cho health check, Swagger và baseline REST.
- Inventory Service chạy thêm gRPC ở port 50051.
- Order API chạy ở port 3000.
- React chạy ở port 5173.
- Order API mặc định gọi Inventory bằng gRPC.
- Giữ REST nội bộ để chạy lại baseline và so sánh.

## Contract bên ngoài

Endpoint chính:

~~~text
POST /orders
~~~

- Đủ hàng: HTTP 201.
- Thiếu hàng: HTTP 409.



## Hiện thực gRPC

- Viết file proto cho Inventory, sinh code, hiện thực Inventory server và gRPC client trong Order API. Order API gọi Inventory bằng gRPC thay cho REST. URL, status và body của API ngoài giữ nguyên. 
- Proto v1 là contract cũ, 
- Proto v2 thêm remaining_stock .
- Client cũ phải gọi được server mới.
- Client mới phải đọc được remaining_stock.

