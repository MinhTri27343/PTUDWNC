# Đo payload REST và gRPC

## Kết quả đo

Đo cùng một request A001 quantity 2 và cùng một response reserve thành công.

| Đại lượng | REST/JSON | gRPC/Protobuf |
|---|---:|---:|
| Request payload | 27 bytes | 8 bytes |
| Response payload | 98 bytes | 28 bytes |
| Đơn vị | UTF-8 bytes | protobuf wire bytes |

Payload REST request:

~~~json
{"sku":"A001","quantity":2}
~~~

Payload REST response:

~~~json
{"success":true,"sku":"A001","reserved_quantity":2,"remaining_stock":8,"message":"Stock reserved"}
~~~

## Cách đo

- REST: dùng JSON.stringify rồi dùng Buffer.byteLength(...), không tính HTTP headers.
- gRPC: dùng serializer được tạo từ service definition của proto v2 rồi lấy Buffer.length, không tính HTTP/2 headers, TLS và frame transport.
- Đo ở cùng một máy, cùng một request, cùng một bộ field.
- Kết quả này là kích thước payload application-level, không phải tổng số byte trên mạng.

Lệnh kiểm thử chức năng đã chạy:

~~~cmd
npm run verify:failure-modes
~~~

Kết quả kích thước payload được ghi lại từ proto v2 với request và response thành công.
