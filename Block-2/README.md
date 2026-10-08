# Block 02 — API composition

Baseline REST và GraphQL trước/sau sửa N+1. BFF nằm ngoài phạm vi nhóm đã chốt. Thiết kế ban đầu ở [plan.md](plan.md).

Đã kiểm chứng: 13/13 test pass, 210 lượt đo browser (5 lượt/tổ hợp), 120 đối chiếu dữ liệu bình thường thành công. Xem [báo cáo](report.md) và [bảng tổng hợp thực tế](evidence/full/summary.md).

## Chạy demo

Yêu cầu Node.js >= 22.16 (dùng `node:sqlite`, có thể hiện cảnh báo experimental) và npm.

```powershell
npm install
npm run seed -- small
npm start
```

Mở http://127.0.0.1:4100, chọn Baseline/GraphQL và Web/Mobile rồi bấm tải. `npm start` tự đọc `.env` nếu file tồn tại; nếu không có cấu hình thì GraphQL mặc định batched. Tham khảo [.env.example](.env.example). Dừng bằng Ctrl+C trước khi đổi dataset/mode.

Ví dụ cấu hình `.env` để tái hiện N+1:

```dotenv
GRAPHQL_MODE=naive
PRODUCT_DELAY_MS=0
PRODUCT_FAIL=0
```

Sửa `.env` rồi khởi động lại bằng `npm start`. Log `graphql naive ready 4104` xác nhận naive; đổi thành `GRAPHQL_MODE=batched` để bật batching/dedup. Biến đã đặt trong terminal có ưu tiên cao hơn `.env`; dùng `Remove-Item Env:GRAPHQL_MODE -ErrorAction SilentlyContinue` nếu muốn bỏ override từ terminal. `.env` chỉ được nạp cho demo (`npm start`); test/đo vẫn chủ động chọn cấu hình cho từng trường hợp.

```powershell
npm run seed -- large
$env:GRAPHQL_MODE = 'naive'
npm start
```

Đặt `GRAPHQL_MODE=batched` để bật DataLoader. Dataset lưu trong `data/`; không seed khi service đang chạy. Seed thay dữ liệu giả trong ba database của lab. Service chỉ bind loopback.

| Process | Port | API |
|---|---:|---|
| UI | 4100 | `/` |
| User | 4101 | `/users/:id` |
| Order | 4102 | `/orders?user_id=1` |
| Product | 4103 | `/products/:id`, `/products?ids=1,2,3` |
| GraphQL | 4104 | POST `/graphql` |

GraphQL query mẫu nằm ở [public/queries.js](public/queries.js). Tất cả dữ liệu dùng snake_case. `total_cents` là tổng tiền order tại lúc tạo; `price_cents` là giá product hiện tại. Mỗi service mở SQLite riêng, GraphQL chỉ gọi HTTP.

## Mô phỏng lỗi

```powershell
$env:PRODUCT_DELAY_MS = '300' # chậm nhưng chưa timeout
$env:PRODUCT_FAIL = '0'
npm start
```

Dùng delay `1500` để timeout; hoặc `PRODUCT_DELAY_MS=0`, `PRODUCT_FAIL=1` để HTTP 503. Mỗi call REST/upstream timeout 1000 ms, không retry. Product lỗi trả partial data với `product: null`; GraphQL có `errors.path` và code. User/Order lỗi hiển thị lỗi dashboard.

Đặt `PRODUCT_DELAY_MS=0`, `PRODUCT_FAIL=0` để trở về bình thường. Browser chờ tối đa 10 giây cho toàn bộ GraphQL operation để upstream 1000 ms có thể trả partial errors; đây là ngân sách operation, không phải timeout của từng product call.

## Kiểm thử và đo

```powershell
npm test
npm run measure:quick
npm run measure
```

Đo cần Chrome đã cài; hoặc đặt `BROWSER_CHANNEL=msedge` để dùng Edge. Playwright chạy browser headless. Tắt demo trước khi test/đo để giải phóng các port 4100–4104. Test/đo dùng database tạm riêng, không thay dataset demo.

Bản full có 120 lượt bình thường (3 variants × 2 clients × 2 datasets × cold/warm × 5) và 90 lượt lỗi/chậm (3 scenarios × 3 variants × 2 clients × 5). Quick chỉ một lượt mỗi tổ hợp để kiểm tra harness, không dùng thay evidence full. Mỗi cell warm có một lượt warm-up không ghi vào bảng; mỗi lượt cold restart tất cả process.

Output ở `evidence/full/` hoặc `evidence/quick/`:

- `measurements.csv/json`: từng lượt chạy, counts, thời gian, payload, result.
- `summary.md`: median và min–max theo tổ hợp.
- `traces.json`: waterfall client và request/call/SQL theo run_id, gồm errors.
- `comparisons.json`: đối chiếu baseline với GraphQL cho web/mobile.
- `waterfall-*.svg`: waterfall baseline, naive và batched, có mốc hoàn tất.
- `dashboard.png`, `mobile.png`, `dashboard-error.png`: ảnh UI bình thường và lỗi.

Mỗi service có `/health` và `/metrics?run_id=...`. Header `X-Run-Id` nối browser → GraphQL → REST → SQL. Service-call counts là số HTTP request dữ liệu từng REST service nhận; GraphQL cũng lưu outgoing call spans. Counter không tính OPTIONS, health, metrics, seed. HTTP preflight do browser phát sinh vẫn thấy trong DevTools, không gộp vào client data requests.

`screen_complete_ms` lấy từ browser lúc bắt đầu đến DOM dữ liệu/lỗi đã render và hai animation frames; không chờ thumbnail. Payload là tổng byte UTF-8 response body đã nhận, kể cả errors, không gồm headers/preflight/assets và không phải byte trên dây. Cold chỉ là cold process; cache OS/browser không bị xóa. Với timeout, harness chờ thêm 650 ms trước đọc metrics vì SQL upstream có thể hoàn tất sau khi client ngừng đợi.

## Đọc kết quả và demo

Baseline small phải có 7 client requests / 5 product queries; large có 102 / 100. GraphQL naive có 1 client request nhưng vẫn 5 hoặc 100 product calls/queries. Batched có 1 client request và 1 product call/query. Mobile GraphQL chỉ trả id, status, product name/thumbnail; baseline REST trả dư trường.

Demo small theo Problem → Solution → Demo → Evidence → Trade-off: tải baseline, chạy naive rồi batched, đối chiếu trace, chuyển mobile, làm Product lỗi và chỉ ra order total vẫn còn.

Baseline cố ý tuần tự và không dedup; REST cũng có thể dùng batch. GraphQL naive gọi product song song, nên call count lớn không đồng nghĩa thời gian luôn tăng tuyến tính. CSDL local, dữ liệu giả nhỏ, headless browser và không auth/pagination là giới hạn; xem số liệu thật trước kết luận hiệu năng. DataLoader tạo theo request để tránh cache tồn tại xuyên request, theo [tài liệu DataLoader](https://github.com/graphql/dataloader). Schema/resolvers dùng [GraphQL.js](https://www.graphql-js.org/docs/running-an-express-graphql-server/).
