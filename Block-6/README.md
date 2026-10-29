# Block-6 — Task Management API

Bài lab authorization theo [slide 21–26](https://pub.nndkhoa9.win/webadv/w4/block-06-authorization-interactive.html#21): IDOR/BOLA, RBAC theo project, ReBAC/ABAC và tenant boundary. API thực sự đọc/ghi SQLite; giao diện gọi HTTP đến server, không mô phỏng kết quả bằng JavaScript phía client.

## Chạy ứng dụng

Yêu cầu **Node.js >= 22.12**, npm; SQLite nhúng, không cần Docker hay Block-5.

```bash
cd Block-6
npm install
npm start
```

Mở **http://localhost:4006**. Lần chạy đầu tự tạo và seed 5 database trong `data/`, cùng khóa ký token ngẫu nhiên (git-ignored). Server chỉ lắng nghe `127.0.0.1`. Đổi cổng bằng `PORT=4016 npm start`.

| Tài khoản | Mật khẩu | Tenant | Vai trò ban đầu |
|---|---|---|---|
| alice | alice-pass | alpha | Owner project Alpha |
| bob | bob-pass | alpha | Member project Alpha |
| eve | eve-pass | alpha | Viewer project Alpha |
| charlie | charlie-pass | beta | Owner project Beta |
| dana | dana-pass | alpha | Tenant Admin, không cần membership |

Chọn nút đăng nhập nhanh hoặc nhập username/password. Token hết hạn sau 1 giờ, chỉ giữ trong bộ nhớ trang; tải lại trang thì đăng nhập lại. Không có đăng ký, refresh token hoặc OAuth2 trong bài này.

## Các phiên bản

| Phiên bản | Điều kiện thực thi tại server | Giới hạn cố ý |
|---|---|---|
| Starter | Token hợp lệ | Chưa kiểm quyền tài nguyên; có IDOR |
| V1 | Đọc task/list cần membership project | Ghi/xóa/quản lý thành viên chưa được bảo vệ; Dana chưa có quyền Admin |
| V2 | Ma trận Viewer/Member/Owner theo project | Member chưa bị giới hạn assignee/status; Admin còn toàn cục |
| V3 | V2 + Member phải là assignee và task Open | Admin còn toàn cục |
| V4 | V3 + tenant của user phải khớp project | Bản hoàn chỉnh cho bài lab |

Starter và V1 là các bản chưa an toàn được giữ lại để minh họa. Không dùng làm ứng dụng thật. Mỗi phiên bản có database riêng: sửa/xóa ở V4 không làm thay đổi V3. Chuyển phiên bản không tự reset dữ liệu.

## Kịch bản demo khoảng 8–10 phút

Các tình huống trong ô “Tình huống muốn thử” tự đăng nhập tài khoản phù hợp và điền request, **chưa gửi request**. Bấm **Gửi request** để thực hiện. Bảng kết quả cho thấy HTTP status, JSON và cURL đã che token. Sử dụng dữ liệu mới reset cho demo.

Vùng thao tác gồm **Chuẩn bị → Xem dữ liệu → Thử request**. Kết quả HTTP luôn nằm ở khung cố định bên phải trên desktop; mobile có thanh kết quả cố định dưới màn hình, tự mở sau thao tác và có nút thu gọn. Chỉ có một ô chọn phiên bản ở bước chuẩn bị. Bước thử request chọn tình huống theo thao tác đọc/sửa/giả mạo, không chọn lại phiên bản. Đăng nhập thủ công, body/headers và bảng quyền nằm trong phần thu gọn; body/headers tự mở khi tình huống cần dùng. Gửi request, đọc/sửa task hoặc quản lý thành viên đều cập nhật khung kết quả ngay tại chỗ, không cuộn trang xuống cuối.

1. **V1 — sửa IDOR:** chọn Starter → tình huống “Alice đọc B1 · IDOR” → Gửi request: `200`, lộ ngân sách Beta. Chuyển V1, gửi lại: `403`. Tình huống “Alice đọc A1 · hợp lệ” vẫn `200`. Đăng nhập Charlie, đọc B1: `200`. So sánh danh sách task của Starter và V1.
2. **V2 — RBAC:** chọn V2. Eve sửa A1: `403`; Bob sửa A1: `200`; Bob xóa project: `403`; gửi cùng request kèm `{"role":"Admin"}` vẫn `403`. Alice bấm Thành viên của Alpha: `200`; Bob bấm cùng nút: `403`. Đối chiếu bảng quyền cuối trang.
3. **V3 — assignee/status:** ở V2, Bob sửa A2 chưa được giao và A3 Closed vẫn `200`. Chuyển V3: Bob sửa A1 Open được giao: `200`, A2 chưa giao: `403`, A3 Closed: `403`. Đăng nhập Alice, bấm Sửa A3, đổi mô tả: `200` dù Closed. Bob đổi assignee/status bằng request trực tiếp bị `403`.
4. **V4 — tenant:** ở V3, Dana đọc B1: `200` do Admin còn toàn cục. Chuyển V4: Dana đọc A1 `200`, B1 `403`; thêm `X-Tenant-Id: beta` vẫn `403`. Alice giả user Charlie để sửa B1 cũng `403`.
5. **Thu hồi quyền:** Alice → Thành viên Alpha → gỡ Bob. Đăng nhập Bob → danh sách rỗng, đọc A1 `403`. Automated test còn chứng minh **token cũ** của Bob cũng bị chặn ngay. Không có cache membership.
6. **Trạng thái HTTP:** bỏ chọn Gửi token → `401`; Alice đọc `/tasks/Z9` → `404`; gỡ Alice là Owner cuối cùng → `409`.
7. **Xóa thật:** Alice xóa Alpha → task và membership Alpha bị xóa cascade. Chuyển phiên bản khác vẫn còn Alpha. Reset trước khi demo lại.

## Reset dữ liệu

**Dừng server bằng Ctrl+C trước**, rồi chạy:

```bash
npm run db:reset
npm start
```

Lệnh reset chỉ thay 5 database lab trong `data/`, giữ khóa ký; không có endpoint reset công khai. Đăng nhập lại sau reset để có phiên demo rõ ràng.

## Kiểm thử và tạo evidence

```bash
npm run typecheck
npm test
npm run test:e2e
npm run evidence
```

Test dùng SQLite in-memory riêng cho từng test; evidence dùng dữ liệu tạm, **không yêu cầu server đang chạy** và không thay đổi `data/`.

**Playwright chạy headless**, dùng profile riêng, không mở hay điều khiển trình duyệt đang dùng. Mỗi test giao diện có server cổng tạm và 5 database in-memory riêng. Trên macOS, cấu hình tận dụng Chrome đã cài; máy khác chạy `npx playwright install chromium` trước lần đầu. Có thể chỉ định executable bằng `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome npm run test:e2e`.

Đã kiểm chứng: **198 test API/business + 13 test Playwright**. Playwright kiểm đăng nhập/đăng xuất, token trong bộ nhớ, chuyển phiên bản, RBAC/ABAC/tenant, dialog sửa, quản lý thành viên, thu hồi token cũ, xóa project, lỗi HTTP/JSON và bố cục desktop/mobile không tràn ngang và kết quả luôn trong màn hình mà không tự cuộn sau khi gửi. Chạy lại E2E sẽ cập nhật JSON kết quả và ảnh demo trong `evidence/`; trace lỗi nằm ở `test-results/` (git-ignored).

```bash
npm run test:idor:before
```

Lệnh trên **cố ý thoát với mã 1**: cùng regression test kỳ vọng chặn Alice đọc B1 thất bại trên Starter. Hai test cho phép vẫn qua.

```bash
npm run test:idor:after
```

Cùng test trên V4 phải xanh. `npm test` mặc định kiểm bản hoàn chỉnh và xác nhận đúng hành vi từng giai đoạn, bao gồm các lỗi cố ý của Starter/V1.

| Evidence | Nội dung |
|---|---|
| `evidence/idor-http.txt` | Request/response Alice đọc B1 ở Starter, V1, V4 |
| `evidence/idor-before.txt` | Test IDOR đỏ trên Starter, exit 1 |
| `evidence/idor-after.txt` | Cùng test xanh trên V4, exit 0 |
| `evidence/test-results.txt` | Toàn bộ automated tests |
| `evidence/oracle.md` | 17 tình huống × 5 phiên bản bằng HTTP request thật |
| `evidence/authorization.diff` | Diff nguồn policy Starter đang dùng và policy hoàn chỉnh |
| `evidence/playwright-results.json` | Kết quả 13 test giao diện headless |
| `evidence/ui-desktop.png`, `evidence/ui-mobile.png` | Ảnh giao diện được Playwright chụp tự động |

Diff này là so sánh hai module thực tế được chạy trong lab, không phải lịch sử commit giả lập. Điểm thực thi `enforce` trong service được giải thích ở REPORT.md.

## API

`POST /auth/login` nhận `{"username":"alice","password":"alice-pass"}`, trả `{token, tokenType, expiresIn}`. `GET /auth/me` cần Bearer token và trả user không có password hash. Dùng `requests.http` với VS Code REST Client hoặc cURL bên dưới.

```bash
curl -s http://localhost:4006/auth/login \
  -H 'Content-Type: application/json' \
  --data '{"username":"alice","password":"alice-pass"}'
```

Dán token trả về vào `<TOKEN>`:

```bash
curl -i http://localhost:4006/api/v4/tasks/B1 \
  -H 'Authorization: Bearer <TOKEN>'
```

API nghiệp vụ có prefix `/api/{starter|v1|v2|v3|v4}`:

| Method / path | Quyền hoặc dữ liệu |
|---|---|
| `GET /projects`, `GET /tasks` | Danh sách lọc theo quyền đọc; project có `role` hiện hành |
| `GET /tasks/:id` | `read` trên project chứa task |
| `PATCH /tasks/:id` | `edit`; JSON `title`, `description`, `assigneeId`, `status` |
| `DELETE /projects/:id` | `delete`; xóa cascade task/membership; trả `{ok:true}` |
| `GET /projects/:id/members` | `members`; trả userId/name/role |
| `POST /projects/:id/members` | `members`; JSON `{userId,role}`, thành công `201` |
| `PATCH /projects/:id/members/:userId` | `members`; JSON `{role}` |
| `DELETE /projects/:id/members/:userId` | `members`; gỡ membership và bỏ giao task của user đó |

Thành công còn lại trả `200`. Lỗi JSON `{error,message}`; `400` dữ liệu không hợp lệ, `401` xác thực, `403` thiếu quyền, `404` không tồn tại, `409` trùng thành viên/Owner cuối cùng. Chính sách bài chọn `403` cho ngoài phạm vi để dễ demo. Không trả chi tiết resource trong lỗi từ chối.

Member chỉ sửa `title/description`; Owner/Admin hợp lệ có thể đổi `assigneeId/status`. Assignee phải là thành viên project; `null` nghĩa là chưa giao. Không hỗ trợ chuyển project hoặc đổi ID task. Body `userId/role/tenantId` và header tự khai không ảnh hưởng principal hay quyền. Với quản lý thành viên, `userId/role` là **đối tượng thay đổi**, được kiểm tra sau quyền của người gọi.

## Cấu trúc

```text
src/          app, auth, database, policy và business service
public/       giao diện HTML/CSS/JS không cần build
migrations/   schema SQLite
tests/        oracle, regression IDOR, matrix, trust boundary, business layer
e2e/          Playwright kiểm luồng giao diện với server/database tạm
scripts/      reset và tạo evidence
evidence/     bằng chứng tái tạo được
```

Xem [REPORT.md](REPORT.md) hoặc mở [REPORT.html](REPORT.html) bằng trình duyệt để đọc luồng xử lý, truy vấn SQL và code kiểm quyền của Starter–V4, cùng kịch bản demo và đối chiếu yêu cầu bài nộp. Bản HTML đọc được offline; tạo lại từ Markdown bằng `python3 scripts/render-report.py`.
