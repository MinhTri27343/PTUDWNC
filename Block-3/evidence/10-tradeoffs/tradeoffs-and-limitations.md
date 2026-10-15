# Trade-off và giới hạn phép đo

## Trade-off

- gRPC giảm kích thước payload trong phép đo này nhưng tăng độ phức tạp build,
  proto và debug.
- REST dễ quan sát hơn nhưng JSON có thêm tên field và ký tự định dạng.
- Giữ REST baseline giúp so sánh, nhưng làm project có thêm hai transport cần bảo trì.
- Deadline giúp request kết thúc hữu hạn, nhưng request có thể thất bại dù Inventory
  hoàn thành ngay sau thời điểm deadline.
- Không retry trong bài này để tránh làm sai kết quả timeout và tránh reserve trùng.

## Giới hạn phép đo

- Payload chỉ được đo ở application level, chưa tính HTTP/2 headers, HTTP headers,
  TCP, TLS, compression hoặc framing.
- Kích thước phụ thuộc vào nội dung field; request lớn hơn hoặc message nhiều field
  có thể cho kết quả khác.
- Đây là phép đo local trên một máy, không đại diện cho mạng thật hoặc tải đồng thời.
- Kết quả thời gian của failure modes chỉ là một lần chạy kiểm chứng; không dùng nó
  để kết luận gRPC luôn nhanh hơn REST.
- Nếu cần so sánh thời gian nghiêm túc, chạy mỗi transport ít nhất 5 lần và báo cáo
  median, minimum và maximum.
- grpc-tools/protoc không chạy được trên Windows runtime hiện tại, nên project dùng
  @grpc/proto-loader để load proto khi chạy. Đây là giới hạn môi trường build, không
  phải khác biệt của giao thức gRPC.
