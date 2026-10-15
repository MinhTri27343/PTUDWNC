# Kết quả xử lý lỗi

- insufficient-stock.json: thiếu hàng, HTTP 409.
- inventory-slow.json: Inventory chậm, HTTP 504.
- inventory-stopped.json: Inventory tắt, HTTP 502.
- enough-stock-regression.json: kiểm tra lại case thành công, HTTP 201.
- order-api-failure-modes.log và inventory-failure-modes.log: log nội bộ.
- failure-results.md: bảng timestamp, status và response ngoài.

Lệnh chạy:

~~~cmd
npm run verify:failure-modes
~~~
