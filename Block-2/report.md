# Báo cáo Block 02 — API composition

## Problem và solution

Dashboard cần user, danh sách order và product từ ba service có SQLite riêng. Baseline ghép dữ liệu trên browser bằng chuỗi REST request tuần tự. GraphQL chuyển việc ghép sang resolver; bản naive gọi Product Service từng đơn, bản batched dùng DataLoader theo request để gom và loại product_id trùng. BFF ngoài phạm vi nhóm đã chốt.

Schema dùng snake_case; orders lưu total_cents lúc tạo đơn, products lưu price_cents hiện tại. Mobile chọn đúng id, status, product.name và product.thumbnail_url. Product lỗi trở thành null với lỗi rõ ràng; dữ liệu user/order và tổng tiền vẫn giữ được.

## Evidence bình thường

120 lượt chạy bình thường trên Chrome headless/Windows, Node 22.16.0: 3 biến thể × 2 client × 2 dataset × 2 chế độ × 5 lượt. Có thêm warm-up ngoài bảng. Raw data và mọi tổ hợp ở [summary](evidence/full/summary.md), [CSV](evidence/full/measurements.csv), [trace](evidence/full/traces.json) và [đối chiếu](evidence/full/comparisons.json).

Ví dụ dashboard web, warm, median và khoảng min–max:

| Dataset | Biến thể | Client requests | Product calls / SQL queries | Median ms | Min–max ms | Payload bytes |
|---|---|---:|---:|---:|---:|---:|
| small: 5 đơn / 3 product | Baseline | 7 | 5 / 5 | 27.60 | 17.50–28.10 | 1058 |
| small | GraphQL naive | 1 | 5 / 5 | 13.40 | 13.10–29.30 | 1183 |
| small | GraphQL batched | 1 | 1 / 1 | 15.10 | 13.30–23.30 | 1183 |
| large: 100 đơn / 10 product | Baseline | 102 | 100 / 100 | 195.50 | 195.10–233.20 | 20815 |
| large | GraphQL naive | 1 | 100 / 100 | 58.60 | 53.20–63.10 | 22745 |
| large | GraphQL batched | 1 | 1 / 1 | 28.20 | 25.10–29.90 | 22745 |

User và Order mỗi service có một request và một SQL query trên từng lượt bình thường. Product call/query ở batched giữ nguyên khi tăng từ 5 lên 100 đơn. Có 120 đối chiếu dữ liệu thành công: GraphQL ID là chuỗi, REST ID là số, nên chuẩn hóa ID trước so sánh; mobile baseline được project về đúng các trường mobile.

Mobile GraphQL có payload 499 bytes (small) và 9507 bytes (large); baseline REST vẫn nhận 1058 và 20815 bytes dù UI mobile chỉ hiển thị ít trường. Payload dashboard web GraphQL lớn hơn REST do cấu trúc JSON và ID chuỗi; giảm request không đồng nghĩa giảm mọi payload.

Cold small cho dashboard web: baseline median 33.10 ms, naive 70.80 ms, batched 62.80 ms. Cold large: lần lượt 213.10, 148.40, 79.40 ms. Các kết quả này cho thấy overhead và khởi tạo process ảnh hưởng đến thời gian; không thể kết luận GraphQL luôn nhanh hơn chỉ từ call count.

Waterfall có mốc screen_complete: [baseline](evidence/full/waterfall-baseline.svg), [naive](evidence/full/waterfall-naive.svg), [batched](evidence/full/waterfall-batched.svg). Trace naive thể hiện product call song song; baseline gọi tuần tự.

## Kiểm chứng chức năng và lỗi

`npm test` pass 13/13 kiểm thử, gồm dữ liệu small/large, projection mobile, batch đảo thứ tự/dedup, cache không xuyên request, product thiếu, user thiếu, ID sai, user không có đơn, total_cents không đổi khi price_cents thay đổi, delay 300 ms, timeout 1500 ms và HTTP 503 cho hai chế độ GraphQL.

Bộ đo browser chạy thêm fault scenarios trên small/warm, kiểm tra số card đã render, product null khi timeout/503, order total còn nguyên và số network requests thực tế khớp instrumentation. Bảng thô có scenario/result để lọc các lượt này. Khi timeout, SQL Product Service có thể chạy sau mốc screen_complete; harness đợi thêm 650 ms trước đọc metrics. HTTP 503 diễn ra trước query nên product SQL count bằng 0.

Đã hoàn thành 90 lượt fault scenarios, tổng cộng 210 lượt đo, 42 tổ hợp, mỗi tổ hợp 5 lần. Ví dụ web/small/warm:

| Kịch bản | Baseline median ms | Naive median ms | Batched median ms | Kết quả |
|---|---:|---:|---:|---|
| Delay 300 ms | 1578.20 | 320.20 | 325.90 | Đủ dữ liệu |
| Delay 1500 ms, timeout 1000 ms | 5053.80 | 1028.20 | 1030.70 | Partial data, product null |
| HTTP 503 | 50.40 | 31.50 | 29.00 | Partial data, product null; 0 product SQL queries |

Baseline timeout khoảng 5 giây vì chờ từng product call tuần tự; naive gọi đồng thời, batched gọi một lần nên hoàn tất khoảng 1 giây. Call counts và SQL sau timeout vẫn khác nhau dù thời gian naive/batched gần nhau. Ảnh kết quả: [web](evidence/full/dashboard.png), [mobile](evidence/full/mobile.png), [lỗi sản phẩm](evidence/full/dashboard-error.png).

## Cách đo và giới hạn

- Client request count chỉ tính request dữ liệu; loại health, metrics, OPTIONS và assets. Có đối chiếu với network events của browser.
- Call count đếm HTTP request dữ liệu service nhận, không gộp với SQL. Trace GraphQL có outgoing HTTP spans.
- DB query count đo tại SQL wrapper, không gồm seed/schema.
- screen_complete tính đến DOM dữ liệu/lỗi được render và hai animation frames; không đợi ảnh.
- Payload là response body UTF-8 không nén, gồm errors nếu có; không phải tổng byte trên dây.
- Cold restart các process nhưng không xóa OS/browser cache. Warm giữ process nhưng không có cache dữ liệu toàn cục.
- Dataset local nhỏ, một máy, thứ tự đo cố định, chỉ 5 lượt/cell và không có tải đồng thời. Không diễn giải số liệu thành benchmark production.

Baseline cố ý không dedup và gọi tuần tự. REST có thể tối ưu bằng batch; naive GraphQL gọi song song nên latency thấp hơn baseline dù số product calls như nhau. Batching giúp giảm tải nội bộ; GraphQL vẫn cần resolver, mapping đúng thứ tự và policy nullable/error. Cache DataLoader theo request tránh dùng dữ liệu cũ ở các request sau.

## Demo

1. Seed small, chạy baseline web và chỉ ra 7 request, 5 product calls.
2. Restart với GRAPHQL_MODE=naive, tải GraphQL web: một client request, vẫn 5 product calls.
3. Restart với GRAPHQL_MODE=batched: một product batch/query; mở trace trước/sau.
4. Chọn mobile và kiểm tra response không chứa quantity, total_cents, price_cents.
5. Restart Product với lỗi 503 hoặc delay 1500; dashboard còn order totals và hiển thị lỗi product.
6. Mở bảng đo large để giải thích 100 calls thành một call, rồi trình bày các giới hạn phép đo.

Lệnh chạy và biến môi trường ở [README](README.md).
