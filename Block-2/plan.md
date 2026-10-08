# Plan — Block 02: API composition

Ngày chốt: 2026-10-08. Trạng thái: đã chốt thiết kế, chưa triển khai hoặc đo.

Ghi nhận sau khi chốt: triển khai bắt đầu cùng ngày. Giữ nguyên thiết kế gốc bên dưới; trạng thái kiểm chứng và số liệu thực tế được lưu ở README.md và evidence/full/.

Đề bài: https://pub.nndkhoa9.win/webadv/w2/block-02-assignment.html

## 1. Phạm vi và công nghệ

Thực hiện Baseline REST, GraphQL có N+1 và GraphQL đã sửa N+1. BFF nằm ngoài phạm vi theo quyết định của nhóm.

- Node.js, Express cho ba REST service.
- GraphQL server và DataLoader để batching/dedup trong một request.
- Mỗi service sở hữu một file SQLite riêng; không truy cập trực tiếp database của service khác.
- Một ứng dụng web có hai chế độ hiển thị: dashboard web và danh sách mobile. Không cần xây app native.
- Tên trường trong database, REST JSON và GraphQL đều dùng snake_case.

## 2. Schema và ý nghĩa dữ liệu

### User Service — users.sqlite

| Trường | Kiểu | Ràng buộc |
|---|---|---|
| id | INTEGER | Primary key |
| name | TEXT | NOT NULL |

### Order Service — orders.sqlite

| Trường | Kiểu | Ràng buộc |
|---|---|---|
| id | INTEGER | Primary key |
| user_id | INTEGER | NOT NULL, tham chiếu logic đến User Service |
| product_id | INTEGER | NOT NULL, tham chiếu logic đến Product Service |
| status | TEXT | pending, paid, shipped hoặc cancelled |
| quantity | INTEGER | > 0 |
| total_cents | INTEGER | >= 0, tổng tiền của đơn tại thời điểm tạo |
| created_at | TEXT | ISO 8601 UTC |

Mỗi đơn chỉ có một loại product để giữ bài tập gọn. Không tạo foreign key xuyên database/service. Tạo index cho orders.user_id.

### Product Service — products.sqlite

| Trường | Kiểu | Ràng buộc |
|---|---|---|
| id | INTEGER | Primary key |
| name | TEXT | NOT NULL |
| price_cents | INTEGER | >= 0, giá hiện tại |
| thumbnail_url | TEXT | NOT NULL |

Tiền dùng số nguyên theo cent, thống nhất USD cho dữ liệu giả. Khi seed, total_cents = quantity × price_cents. total_cents là giá trị lưu trên order, không tính lại từ giá product khi đọc dashboard: giá product có thể thay đổi sau lúc đặt hàng. Nhờ vậy vẫn hiển thị được tổng tiền khi Product Service lỗi.

## 3. Dữ liệu mẫu

| Dataset | User mục tiêu | Orders | Product khác nhau |
|---|---|---:|---:|
| small | id = 1 | 5 | 3 |
| large | id = 1 | 100 | 10 |

Seed xác định, tái lập được; mỗi dataset có product lặp giữa các đơn. Giữ nguyên dữ liệu giữa các biến thể. Có thêm user không có đơn để test danh sách rỗng. Sắp xếp orders theo id tăng dần. Thumbnail là ảnh local để tải ảnh ngoài không làm nhiễu phép đo.

## 4. REST contract

| Service | Endpoint | Response thành công |
|---|---|---|
| User | GET /users/:id | { id, name } |
| Order | GET /orders?user_id=:id | Mảng order đủ các trường trong schema |
| Product | GET /products/:id | Một product đủ các trường |
| Product | GET /products?ids=1,2,3 | Mảng product có id thuộc danh sách yêu cầu |

API chi tiết trả 404 khi resource không tồn tại. API danh sách trả [] khi không có kết quả. ID không hợp lệ trả 400. Batch loại ID trùng, thực hiện một SELECT với WHERE id IN (...); không bảo đảm thứ tự response. GraphQL phải map lại theo id. Không có phân trang trong bài tập này; giới hạn batch đủ chứa toàn bộ dataset đã chốt.

### Baseline

Browser gọi tuần tự User → danh sách Order → Product cho từng order, sau đó tự ghép và render. Không cache/dedup product trong baseline; cùng product_id vẫn gọi lại. Dùng API chi tiết product, không dùng endpoint batch.

Nếu có N đơn: client tạo 2 + N request dữ liệu. Product Service thực hiện N query chi tiết trong tình huống bình thường. Đây là quyết định baseline để thể hiện chi phí gọi lặp; cần ghi trong báo cáo, không diễn giải rằng REST bắt buộc phải gọi như vậy.

Baseline cũng có chế độ mobile với cùng cách gọi, nhưng chỉ render các trường mobile. REST vẫn trả response đầy đủ; ghi nhận phần dữ liệu dư khi so sánh payload.

## 5. GraphQL contract và sửa N+1

Một endpoint /graphql cho cả web và mobile. Dùng query root user(id), kiểu User có orders, kiểu Order có product.

Query dashboard web:

```graphql
query WebDashboard($user_id: ID!) {
  user(id: $user_id) {
    id
    name
    orders {
      id
      user_id
      product_id
      status
      quantity
      total_cents
      created_at
      product {
        id
        name
        price_cents
        thumbnail_url
      }
    }
  }
}
```

Query danh sách mobile:

```graphql
query MobileOrders($user_id: ID!) {
  user(id: $user_id) {
    orders {
      id
      status
      product {
        name
        thumbnail_url
      }
    }
  }
}
```

Hai query cùng dữ liệu nguồn; mobile không yêu cầu name của user, total_cents, quantity, price_cents hoặc các trường khác ngoài danh sách mobile. Cấu trúc bao user/orders là wrapper của response.

### Bản naive

Order.product resolver gọi GET /products/:id cho từng order, kể cả ID trùng. Không DataLoader, không cache. Resolver có thể chạy đồng thời; N+1 thể hiện ở số call/query, không nhất thiết ở waterfall tuần tự.

### Bản batched

Tạo DataLoader mới trong context của mỗi request GraphQL. Các resolver gọi load(product_id); DataLoader dedup và gom ID trong cùng batch. Batch gọi GET /products?ids=... một lần. Map response theo id rồi trả kết quả đúng thứ tự keys; ID thiếu tạo lỗi riêng cho product tương ứng.

Không dùng loader/cache toàn cục. Với hai dataset của bài, một request web/mobile thành công có một call tới Product Service và một DB query product. Request GraphQL tiếp theo vẫn thực hiện batch mới. Giữ bản naive và batched có thể chọn qua biến môi trường để chạy lại phép so sánh.

## 6. Policy lỗi và mô phỏng

Chọn partial data khi Product Service lỗi hoặc timeout. Áp dụng cùng ý nghĩa trên baseline và GraphQL.

- Order.product nullable. Giữ user, orders và total_cents; product thất bại trở thành null.
- GraphQL trả errors có path tới trường product, code PRODUCT_UNAVAILABLE hoặc PRODUCT_NOT_FOUND. Baseline lưu lỗi trên từng order trong trạng thái UI.
- UI hiển thị “Không tải được thông tin sản phẩm”; không dựng tên/giá giả.
- User/Order lỗi khiến màn hình không có dữ liệu cốt lõi: hiển thị lỗi tải dashboard.
- Timeout upstream/client: 1000 ms; không retry để số request có thể giải thích được.
- Product Service nhận cấu hình môi trường PRODUCT_DELAY_MS và PRODUCT_FAIL. Chế độ lỗi trả HTTP 503 trước truy vấn DB; delay diễn ra trước truy vấn.
- Các kịch bản: bình thường; delay 300 ms; delay 1500 ms gây timeout; lỗi 503.
- Request đã timeout ở phía gọi có thể vẫn được Product Service xử lý. Chờ request nền kết thúc trước lượt tiếp theo và ghi rõ trong trace; không reset counter giữa lúc request còn chạy.

## 7. Đếm metric và xác định hoàn tất

Mỗi lượt có run_id riêng, truyền trong header X-Run-Id từ browser đến GraphQL/REST và tiếp tục qua các call nội bộ.

| Metric | Cách đếm |
|---|---|
| Client requests | Request dữ liệu do browser tạo; tách riêng OPTIONS/preflight, ảnh và asset |
| Service calls | Mỗi lần gọi HTTP sang service; log bên gửi và request nhận từng service với run_id |
| DB queries | Instrument tại wrapper thực thi SQL; đếm SELECT phục vụ request, không tính seed/schema/health check |
| Screen complete | performance.now() trước call đầu đến sau khi UI commit đầy đủ dữ liệu hoặc trạng thái lỗi; đánh dấu sau paint bằng requestAnimationFrame |
| Payload bytes | Tổng byte UTF-8 response body dữ liệu browser nhận, gồm cả errors; tắt compression và ghi đây không phải tổng byte trên dây |

Không gộp DB query với service call: chúng là hai metric riêng. Lưu trace có thời điểm bắt đầu/kết thúc, endpoint, status và run_id. Waterfall phải có mốc screen_complete. Không tính tải ảnh vào mốc hoàn tất; dùng cùng quy tắc cho mọi biến thể.

## 8. Ma trận đo và evidence

Đo 3 biến thể × 2 client × 2 dataset × 2 chế độ cold/warm, ít nhất 5 lượt cho mỗi tổ hợp bình thường.

- Cold: mỗi lượt là lần request đầu sau khi restart ba REST service và GraphQL server; giữ nguyên seed/database, chờ health check sẵn sàng. Không tuyên bố đã xóa cache hệ điều hành.
- Warm: warm-up một lượt không đưa vào bảng, sau đó đo ít nhất 5 lượt khi các process tiếp tục chạy. Cache dữ liệu ứng dụng vẫn tắt; DataLoader chỉ tồn tại trong một request.
- Chạy từng lượt riêng, không tải đồng thời. Giữ cùng browser, cấu hình máy, chế độ chạy và response fields.
- Chạy các kịch bản chậm/lỗi trên small cho cả ba biến thể và hai client; ít nhất 5 lượt mỗi trường hợp, ghi chế độ warm.
- Báo median và min–max; giữ toàn bộ số liệu thô, kể cả kết quả chưa đạt.

Cột bảng thô: run_id, variant, client, dataset, mode, scenario, client_requests, user_calls, order_calls, product_calls, user_db_queries, order_db_queries, product_db_queries, screen_complete_ms, payload_bytes, result, notes.

Evidence gồm waterfall Baseline/GraphQL, trace N+1 trước/sau, raw CSV/JSON, đối chiếu response sau chuẩn hóa và kết quả chậm/lỗi. Số liệu chỉ được điền sau chạy thật; plan và lời giải thích của agent không phải evidence.

## 9. Thứ tự triển khai và điều kiện hoàn thành

1. Dựng workspace, script chạy/seed và ba service với database riêng.
2. Hoàn thiện REST contract, logging run_id, counter SQL và fault injection.
3. Làm baseline cho web/mobile; kiểm tra số request 2 + N.
4. Làm GraphQL naive; lưu trace cho thấy N call product.
5. Thêm DataLoader per-request; đối chiếu dữ liệu và trace batch.
6. Hoàn thiện UI lỗi, timeout và mốc screen_complete.
7. Chạy test chức năng, ma trận đo và lưu evidence.
8. Viết README chạy lại, báo cáo trade-off và chuẩn bị demo small.

Các kiểm tra bắt buộc:

- Baseline và hai bản GraphQL có dữ liệu hiển thị web giống nhau trên cả hai dataset.
- Mobile GraphQL chỉ trả các trường đã chọn; đối chiếu với projection mobile từ dữ liệu baseline.
- total_cents được đọc từ Order Service; thay price_cents không làm thay tổng tiền order đã lưu.
- Naive có N product call; batched có một product call và một query trong tình huống thành công trên cả small/large.
- Hai request GraphQL liên tiếp không chia sẻ cache DataLoader.
- Batch map đúng khi response đảo thứ tự, product lặp hoặc ID thiếu.
- User không có đơn trả danh sách rỗng; input sai và resource thiếu có lỗi rõ ràng.
- Product delay/lỗi vẫn render partial data và không tạo giá/tên giả.

## 10. Sản phẩm nộp và giới hạn

- README: setup, seed small/large, chạy baseline/naive/batched, test và tái lập phép đo.
- plan.md: tài liệu này, được tạo trước hiện thực GraphQL.
- evidence/: raw measurements, traces, waterfall và kết quả đối chiếu/lỗi.
- Báo cáo: kết quả thật, median/min–max, cách đếm và giới hạn.
- Demo theo Problem → Solution → Demo → Evidence → Trade-off.

Giới hạn cần giải thích: baseline cố ý không dedup; GraphQL naive có thể gọi product đồng thời; database local và cold process không đại diện cold OS cache; không có pagination/auth/retry; mobile được mô phỏng trên web. GraphQL giảm request client và cho phép chọn trường, nhưng cần batching và xử lý lỗi resolver. Endpoint batch REST cũng có thể cải thiện baseline nếu thiết kế khác; không suy ra GraphQL luôn nhanh hơn REST.
