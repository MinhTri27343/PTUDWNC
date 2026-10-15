# Bằng chứng tương thích client

- old-client-with-new-server.json: client v1 gọi server v2 thành công.
- new-client-with-new-server.json: client v2 đọc remaining_stock = 8.
- client-build-info.md: proto nguồn và cách load từng client.
- compatibility-output.txt: output chạy kiểm chứng.
- inventory-compatibility-server.log: log version/proto của server.
- proto-v1 và proto-v2: contract dùng để tạo hai client.

Lệnh chạy:

~~~cmd
npm run verify:compatibility
~~~
