# Diff proto và output codegen

- before/inventory.proto: contract trước khi thêm field.
- after/inventory.proto: contract sau khi thêm remaining_stock = 4.
- proto-diff.txt: khác biệt giữa hai contract.
- codegen-output.txt: output của lệnh kiểm tra/sinh code.

Lệnh chạy:

~~~cmd
npm run proto:generate --workspace apps/inventory-service
~~~

Trên Windows runtime hiện tại, grpc-tools/protoc không chạy được native nên
project dùng @grpc/proto-loader để load proto khi chạy. Output này được ghi rõ
trong codegen-output.txt.
