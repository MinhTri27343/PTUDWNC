# Cách tạo hai thế hệ client

## Client cũ v1

Client v1 dùng contract cũ:

~~~text
apps/inventory-service/proto/v1/inventory.proto
~~~

Source client:

~~~text
apps/order-api/src/grpc-client-v1.js
~~~

Client v1 không khai báo và không đọc field remaining_stock.

## Client mới v2

Client v2 dùng contract mới:

~~~text
apps/inventory-service/proto/v2/inventory.proto
~~~

Source client:

~~~text
apps/order-api/src/grpc-client-v2.js
~~~

Client v2 biết field remaining_stock = 4 và đọc được giá trị này từ server.

## Cách load proto trong môi trường hiện tại

Project dùng @grpc/proto-loader để load proto khi chạy:

~~~text
const packageDefinition = protoLoader.loadSync(protoPath, options);
const inventory = grpc.loadPackageDefinition(packageDefinition).inventory;
~~~

Do grpc-tools/protoc bundled không chạy được trên Windows runtime hiện tại,
hai client được kiểm chứng bằng hai file proto độc lập thay vì dùng cùng một
contract runtime.

## Lệnh chạy kiểm chứng

~~~cmd
npm run verify:compatibility
~~~

Lệnh này chạy:

~~~text
Client v1 -> Server v2
Client v2 -> Server v2
~~~

Kết quả được lưu trong:

- old-client-with-new-server.json
- new-client-with-new-server.json
- missing-field-observation.json
- inventory-compatibility-server.log
- compatibility-output.txt
