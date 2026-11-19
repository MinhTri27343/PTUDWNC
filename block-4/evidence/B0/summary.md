# B0 — xử lý đồng bộ

- Mock LLM delay cấu hình: 250 ms.
- Số request tuần tự: 5.
- Thời gian phản hồi trung bình: 289.01 ms.
- Thời gian phản hồi nhỏ nhất: 280.70 ms.
- Thời gian phản hồi lớn nhất: 297.01 ms.
- Tổng thời gian chạy tuần tự: 1445.06 ms.

Mỗi request chỉ nhận `200 OK` sau khi API chờ Mock LLM trả về và lưu `job` cùng `summary` vào PostgreSQL. Chi tiết từng request nằm trong `response-times.csv`; bộ đếm Mock LLM nằm trong `mock-llm-calls.json`.
