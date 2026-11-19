# Báo cáo kỹ thuật Block-6 — Cách hoạt động của Starter và V1–V4

Bài thực hành: **Task Management API — Authorization và access control**. Báo cáo giải thích đúng cách ứng dụng hiện tại xử lý request, đọc dữ liệu và kiểm quyền trong mã nguồn; đồng thời cung cấp kịch bản demo để đối chiếu từng phiên bản.

Nguồn yêu cầu: [Học liệu Block-6, phần thực hành](https://pub.nndkhoa9.win/webadv/w4/block-06-authorization-interactive.html#21).

## 1. Mỗi phiên bản đã bổ sung kỹ thuật gì?

**Cách đăng nhập và xác thực JWT không thay đổi giữa các phiên bản.** Phần được bổ sung là điều kiện kiểm quyền trong business layer. Ứng dụng dùng Express, TypeScript, SQLite, `jose` và các API mật mã có sẵn của Node.js; không cài thêm một authorization server hay policy engine riêng cho mỗi phiên bản.

| Phiên bản | Kỹ thuật kiểm quyền được áp dụng | Dữ liệu server kiểm tra | Giới hạn còn lại |
|---|---|---|---|
| Starter | Policy luôn trả `true` sau bước xác thực | JWT xác định người gọi; tài nguyên phải tồn tại | Chưa kiểm quyền tài nguyên; Alice có thể đọc B1 |
| V1 | Tra membership khi đọc task | Cặp `(projectId, userId)` trong `project_members` | Chưa bảo vệ sửa, xóa và quản lý thành viên bằng ma trận quyền |
| V2 | RBAC theo project bằng `MATRIX[role][action]` | Role của người gọi trong đúng project | Member còn sửa được task chưa giao hoặc Closed; Admin còn toàn cục |
| V3 | V2 + so sánh assignee và trạng thái task | `task.assigneeId`, `task.status`, ID người gọi | Admin chưa bị giới hạn tenant |
| V4 | V3 + kiểm tenant trước khi cấp quyền | `user.tenantId` và `project.tenantId` từ database | Bản đầy đủ cho phạm vi bài lab; vẫn có các giới hạn vận hành nêu ở cuối báo cáo |

Các phiên bản dùng **cùng cấu trúc bảng**, nhưng có database riêng: `starter.db`, `v1.db`, `v2.db`, `v3.db`, `v4.db`. Chọn V2 trên giao diện làm request đi tới `/api/v2/...`; server chọn database V2 và truyền `version: 'v2'` vào service. Chuyển phiên bản không tạo bảng mới, không tự reset dữ liệu và không sửa policy bằng body/header người gọi gửi lên.

## 2. Dữ liệu và thành phần tham gia kiểm quyền

### 2.1. Dữ liệu mẫu

| Người dùng | Tenant | Vai trò ban đầu |
|---|---|---|
| Alice | Alpha | Owner project Alpha |
| Bob | Alpha | Member project Alpha |
| Eve | Alpha | Viewer project Alpha |
| Charlie | Beta | Owner project Beta |
| Dana | Alpha | Admin của tenant Alpha; không có membership project ban đầu |

| Task | Project | Assignee | Status | Mục đích demo |
|---|---|---|---|---|
| A1 | Alpha | Bob | Open | Member sửa task đúng điều kiện |
| A2 | Alpha | Chưa giao | Open | Member sửa task chưa được giao |
| A3 | Alpha | Bob | Closed | Member sửa task đã đóng |
| B1 | Beta | Charlie | Open | Truy cập sai project hoặc sai tenant |
| B2 | Beta | Chưa giao | Open | Dữ liệu bổ sung của Beta |

Các bảng chính là `users`, `projects`, `project_members`, `tasks` và `tenants`. Bảng `project_members` có khóa chính ghép `(projectId, userId)`, nên cùng một user được xét role theo từng project. Task chứa `projectId`, `assigneeId` và `status`; các thuộc tính này được tải từ database trước khi xét quyền.

### 2.2. Mã nguồn cần theo dõi

| Thành phần | Vai trò trong luồng xử lý | Nguồn |
|---|---|---|
| `authenticate()` | Xác minh JWT, gán `res.locals.uid` | [src/auth.ts](src/auth.ts) |
| Route `/api/:version` | Chọn database và tạo `TaskService` | [src/app.ts](src/app.ts) |
| `roleFor()` và `authorize()` | Đọc role, quyết định allow/deny | [src/authorization.ts](src/authorization.ts) |
| `TaskService.enforce()` | Biến quyết định deny thành lỗi 403 | [src/service.ts](src/service.ts) |
| `readFilter()` | Tạo điều kiện SQL lọc danh sách theo quyền đọc | [src/authorization.ts](src/authorization.ts) |
| Policy Starter | Bản thiếu kiểm quyền dùng tái hiện IDOR | [src/starter-policy.ts](src/starter-policy.ts) |
| Schema và seed | Bảng, quan hệ, ràng buộc và dữ liệu mẫu | [migrations/001_init.sql](migrations/001_init.sql), [src/db.ts](src/db.ts) |

Hàm quyết định có giao diện:

```ts
authorize(subject, action, resource, context): boolean
```

- `subject`: bản ghi user lấy từ database theo ID đã xác thực.
- `action`: một trong `read`, `edit`, `delete`, `members`, do service chọn theo thao tác.
- `resource`: project và, nếu cần, task thực tế được tải từ database.
- `context`: database của phiên bản và tên phiên bản đang chạy.

Client không được tự chọn `action` để vượt quyền. Ví dụ route PATCH task luôn dẫn đến action `edit`; route xem danh sách thành viên dẫn đến action `members`.

## 3. Luồng chung: từ đăng nhập đến thực thi policy

### 3.1. Đăng nhập và cấp token

1. Client gửi `POST /auth/login` với username và password.
2. Server tra user và kiểm tra password bằng `scryptSync`, salt ngẫu nhiên và `timingSafeEqual` trong `src/password.ts`.
3. Nếu đúng, server dùng `jose.SignJWT` ký token HS256, đặt `sub` bằng user ID, issuer `block-6-lab`, audience `task-api`, thời hạn 1 giờ.
4. Giao diện giữ token trong bộ nhớ và gắn vào header `Authorization: Bearer <token>` khi gọi API.

Token được tạo bằng mã thực tế sau:

```ts
return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(id)
  .setIssuedAt().setIssuer(ISSUER).setAudience(AUDIENCE)
  .setExpirationTime(expiry).sign(secret);
```

Token chứa các claim định danh/thời gian, **không chứa role hoặc tenant để cấp quyền**. Khóa ký được sinh ngẫu nhiên, lưu trong `data/.jwt-secret` với mode 0600 và không đưa vào Git. Trong ứng dụng demo, endpoint đăng nhập dùng bảng user của database V4 làm nguồn tài khoản chung; business service vẫn tải user từ database của phiên bản đang xử lý request.

### 3.2. Xác thực request

`authenticate()` kiểm tra Bearer token bằng `jose.jwtVerify`:

```ts
const { payload } = await jwtVerify(match[1], secret, {
  algorithms: ['HS256'],
  issuer: ISSUER,
  audience: AUDIENCE,
  requiredClaims: ['sub', 'exp', 'iat']
});
res.locals.uid = payload.sub;
```

Middleware còn kiểm tra `sub` phải là chuỗi không rỗng. Thiếu token, token sai chữ ký, hết hạn, sai issuer/audience hoặc thiếu claim bắt buộc đều bị từ chối `401` trước bước phân quyền. Một token hợp lệ chỉ chứng minh người gọi là ai, không tự cho phép truy cập mọi tài nguyên.

### 3.3. Chọn phiên bản và gọi business layer

Route `/api/:version` chỉ chấp nhận `starter`, `v1`, `v2`, `v3`, `v4`, rồi khởi tạo:

```ts
res.locals.service = new TaskService({
  db: stores[version],
  version
});
```

Ví dụ `PATCH /api/v3/tasks/A1` có luồng:

```text
Bearer JWT
  → authenticate(): xác định uid = bob
  → chọn database v3 và policy v3
  → TaskService.editTask(bob, A1, body)
  → tải user Bob, task A1 và project Alpha
  → enforce(Bob, edit, {task: A1, project: Alpha})
  → authorize(...): true hoặc false
  → false: trả 403, không UPDATE
  → true: kiểm trường được sửa, validation, UPDATE và trả kết quả
```

`TaskService.enforce()` là điểm chặn thực tế:

```ts
if (!authorize(subject, action, resource, this.context))
  fail(403, 'forbidden', 'Bạn không có quyền thực hiện thao tác này.');
```

Đọc task chỉ trả nội dung sau khi qua `enforce()`. Tài nguyên không tồn tại trả `404`; response bị từ chối không chứa nội dung task. Gọi service trực tiếp cũng phải qua kiểm quyền, không phụ thuộc việc người gọi có bấm nút trên giao diện hay không.

## 4. Starter — bản có lỗi để làm đối chứng

### 4.1. Kỹ thuật hiện có và phần còn thiếu

Starter đã đi qua middleware xác thực, tải user và tài nguyên như các phiên bản khác. Tuy nhiên policy thực tế trong `src/starter-policy.ts` luôn cho phép:

```ts
export function authorize(_subject, _action, _resource, _context): boolean {
  return true;
}
```

Đoạn trích lược phần kiểu TypeScript để tập trung vào quyết định `return true`. Starter không phải toàn bộ API đều không validation: các ràng buộc dữ liệu chung vẫn tồn tại, nhưng không có kiểm quyền tài nguyên tại policy.

### 4.2. Ví dụ Alice đọc B1

```text
GET /api/starter/tasks/B1
Token hợp lệ → uid = alice
B1 tồn tại → project = beta
Policy trả true, không tra membership của Alice trong Beta
→ 200 và trả dữ liệu B1
```

Đây là IDOR/BOLA: đổi ID tài nguyên trong một request đã xác thực vẫn lấy được dữ liệu ngoài phạm vi của người gọi. Bằng chứng trước sửa nằm trong `evidence/idor-http.txt` và test đỏ `evidence/idor-before.txt`.

## 5. V1 — thêm kiểm tra membership khi đọc

### 5.1. Truy vấn được bổ sung

Server lấy project từ chính task trong database, không dùng `projectId` do request tự khai. Hàm `roleFor()` tra membership:

```sql
SELECT role
FROM project_members
WHERE projectId = ? AND userId = ?;
```

Ở V1, giá trị role chỉ được dùng để xác định có membership hay không. Nhánh policy thực tế là:

```ts
if (context.version === 'v1')
  return action !== 'read' || !!roleFor(subject, resource, context);
```

Với action `read`, không tìm được membership thì `roleFor()` trả `undefined`, chuyển thành `false` và `enforce()` trả `403`. Có membership thì được đọc, chưa phân biệt Viewer/Member/Owner cho thao tác này.

### 5.2. Truy vết cho phép và từ chối

| Request | Dữ liệu server tra | Quyết định |
|---|---|---|
| Alice đọc A1 | `(alpha, alice)` có role Owner | Cho phép, `200` |
| Alice đọc B1 | `(beta, alice)` không có membership | Từ chối, `403` |
| Charlie đọc B1 | `(beta, charlie)` có role Owner | Cho phép, `200` |

Điểm bổ sung so với Starter là lookup membership theo tài nguyên thực tế trước khi trả dữ liệu. Không được sửa bằng cách từ chối mọi request: Alice đọc A1 và Charlie đọc B1 vẫn phải thành công.

### 5.3. Giới hạn cố ý của V1

Biểu thức `action !== 'read'` cho phép các action ngoài đọc đi qua policy. Vì vậy V1 chưa bảo vệ sửa task, xóa project và quản lý thành viên bằng ma trận quyền; Bob bấm xem thành viên Alpha có thể nhận `200` ở V1. Đây là khác biệt có chủ đích để V2 sửa tiếp. Dana chưa được cấp đặc quyền Admin ở V1 và không có membership, nên đọc A1 cũng bị `403`.

## 6. V2 — thêm RBAC theo project và action

### 6.1. Ma trận quyền trong mã nguồn

V2 dùng role trả về từ membership để tra bảng ánh xạ sau:

```ts
export const MATRIX = {
  Viewer: { read: true, edit: false, delete: false, members: false },
  Member: { read: true, edit: true, delete: false, members: false },
  Owner:  { read: true, edit: true, delete: true, members: true }
};
```

| Role trong project | Task: read | Task: edit | Project: delete | Membership: members |
|---|---|---|---|---|
| Viewer | Có | Không | Không | Không |
| Member | Có | Có | Không | Không |
| Owner | Có | Có | Có | Có |

Đoạn quyết định thực tế sau nhánh V1:

```ts
const role = roleFor(subject, resource, context);
if (!role || !MATRIX[role]?.[action]) return false;
```

Không có role hoặc ô ma trận không cho phép thì từ chối. Quyền được kiểm theo project đang thao tác: là Owner của Alpha không có nghĩa là Owner của Beta.

### 6.2. Ví dụ Bob bấm Thành viên của Alpha

```text
GET /api/v2/projects/alpha/members
JWT xác định uid = bob
TaskService.listMembers() chọn action = members
Tải project Alpha và user Bob
roleFor() truy vấn membership (alpha, bob) → Member
MATRIX.Member.members = false
→ enforce() ném lỗi 403
→ không chạy truy vấn trả danh sách thành viên
```

Nếu thay người gọi bằng Alice, membership trả Owner; `MATRIX.Owner.members = true`, nên service mới SELECT danh sách và trả `200`. Cả GET danh sách lẫn POST/PATCH/DELETE membership đều kiểm cùng action `members` trước khi thao tác.

### 6.3. Trường được sửa và đặc quyền Admin

Từ V2, Member chỉ được PATCH `title` và `description`. Nếu gửi `assigneeId` hoặc `status`, service trả `403`. Quy tắc trường này đã có từ V2; phần bổ sung riêng ở V3 là kiểm assignee/status hiện hành của task.

V2 và V3 quy đổi user có `admin = 1` trong database thành role Owner cho việc xét policy, kể cả project khác tenant. Đây là quyền Admin toàn cục của các bản trung gian; V4 giới hạn lại. Một chuỗi `role: "Admin"` trong request không làm user trở thành Admin, vì `roleFor()` không đọc giá trị đó để xác định quyền người gọi.

### 6.4. Giới hạn còn lại

Bob có role Member tại Alpha nên ở V2 vẫn sửa nội dung A2 chưa được giao, hoặc A3 đã Closed. Server chưa có điều kiện đối chiếu từng task cho Member; chỉ biết role đó có quyền edit nói chung.

## 7. V3 — thêm quan hệ assignee và điều kiện Open

### 7.1. Điều kiện được thêm sau RBAC

V3 vẫn phải vượt qua bước tìm role và tra ma trận của V2. Riêng action `edit` của role Member, policy kiểm tra:

```ts
if ((context.version === 'v3' || context.version === 'v4')
    && action === 'edit' && role === 'Member')
  return resource.task?.assigneeId === subject.id
    && resource.task.status === 'Open';
```

`subject.id` đến từ user đã xác thực. `assigneeId` và `status` đến từ bản ghi task hiện hành trong database. Dấu `&&` nghĩa là cả hai điều kiện đều phải đúng. Viewer đã bị ma trận chặn trước khi đến đây; Owner không bị nhánh điều kiện dành riêng cho Member này giới hạn.

### 7.2. Truy vết Bob sửa ba task

| Task | Role trong Alpha | Đối chiếu assignee | Đối chiếu status | Kết quả V3 |
|---|---|---|---|---|
| A1 | Member có edit | `bob === bob`: đúng | Open: đúng | `200`, cập nhật nội dung |
| A2 | Member có edit | `null === bob`: sai | Open | `403`, không cập nhật |
| A3 | Member có edit | `bob === bob`: đúng | Closed: sai | `403`, không cập nhật |

So với V2, chính request Bob sửa A2/A3 đổi từ `200` sang `403`. Owner Alice vẫn sửa được A3 Closed theo chính sách đã chọn.

### 7.3. Chặn cách tự đổi dữ liệu để vượt điều kiện

Member không thể gửi một PATCH vừa tự giao A2 cho mình vừa sửa title. Service kiểm quyền trên **trạng thái cũ tải từ database**, trước mọi UPDATE; A2 chưa giao nên request bị từ chối. Với A1 được giao và Open, Member cũng không được đổi `assigneeId/status` vì giới hạn trường từ V2. Bob không thể mở lại A3 Closed rồi sửa trong cùng request.

Toàn bộ tải dữ liệu, kiểm quyền, validation và UPDATE của `editTask()` nằm trong transaction đồng bộ của `better-sqlite3`. Nếu bị từ chối hoặc validation lỗi, không ghi một phần dữ liệu. Điều này bảo đảm check và write của thao tác trong mô hình một process của lab được thực hiện trong cùng transaction; không thay thế cho kiểm thử đồng thời trên hệ thống phân tán.

## 8. V4 — thêm ranh giới tenant trước khi cấp quyền

### 8.1. Kiểm tenant từ database

V4 bổ sung điều kiện trước bước lấy role và tra ma trận:

```ts
if (context.version === 'v4'
    && subject.tenantId !== resource.project.tenantId)
  return false;
```

Một Admin chỉ được quy đổi thành Owner trong tenant của mình. Nhánh Admin thực tế trong `roleFor()`:

```ts
if (subject.admin && context.version !== 'v1'
    && (context.version !== 'v4'
        || subject.tenantId === resource.project.tenantId))
  return 'Owner';
```

Ở V4, ngay cả một membership có role cao cũng không vượt được ranh giới tenant, vì guard tenant chạy trước bước cấp quyền. Dana có thể quản trị project Alpha dù không có membership, nhưng không quản trị project Beta.

### 8.2. Ví dụ Dana truy cập hai tenant

| Request và người gọi | V3 | V4 | Giải thích |
|---|---|---|---|
| Dana đọc A1 của Alpha | `200` | `200` | Admin Alpha thao tác đúng phạm vi |
| Dana đọc B1 của Beta | `200` | `403` | V4 chặn tenant Alpha khác Beta |
| Dana đọc B1, thêm `X-Tenant-Id: beta` | `200` | `403` | Header không thay tenant của tài khoản |
| Alice sửa B1, gửi `userId: charlie` | `403` | `403` | Body không thay danh tính người gọi |

Server không dùng `X-Tenant-Id`, `body.tenantId`, `body.userId` hoặc `body.role` để cấp quyền cho người gọi. Các claim role/tenant thừa trong JWT cũng không được dùng để cấp quyền. Với quản lý thành viên, service còn kiểm tra user đích có cùng tenant với project; dữ liệu chéo tenant bị từ chối `400` sau khi kiểm quyền người gọi.

## 9. Lọc danh sách và thu hồi quyền

### 9.1. Danh sách không trả hết rồi kiểm quyền từng dòng

`GET /tasks` và `GET /projects` dùng `readFilter()`, biểu diễn chính sách đọc bằng điều kiện SQL. Ví dụ cho user thông thường từ V1:

```sql
SELECT t.*
FROM tasks t
JOIN projects p ON p.id = t.projectId
WHERE EXISTS (
  SELECT 1 FROM project_members m
  WHERE m.projectId = p.id AND m.userId = ?
)
ORDER BY t.id;
```

Ở V4, thêm điều kiện `p.tenantId = ?`. Admin V4 có thể đọc mọi task trong tenant của mình; Admin V2/V3 có thể đọc toàn bộ; Starter không lọc quyền; Admin V1 vẫn cần membership. Các danh sách không gọi `authorize()` riêng cho từng dòng, mà dùng bộ lọc tương đương chính sách đọc. Test so sánh danh sách và GET từng task cho 5 tài khoản × 5 phiên bản để tránh hai đường kiểm quyền khác nhau.

### 9.2. Quyền thay đổi có hiệu lực ngay

Role/membership được đọc lại mỗi request; không nhúng quyền vào token và không cache quyết định allow. Khi Owner gỡ Bob, database xóa membership và đặt assignee của task Bob trong project đó thành `NULL`. Token cũ vẫn có thể được xác thực là Bob, nhưng lookup membership mới không tìm thấy nên request bị `403`. Hạ role của Bob xuống Viewer cũng làm request sửa tiếp theo bị chặn, dù token chưa hết hạn.

Các thay đổi membership phải giữ ít nhất một Owner; gỡ hoặc hạ role Owner cuối cùng trả `409`. Xóa toàn bộ project vẫn được phép với Owner/Admin đúng phạm vi, và cascade xóa task/membership của project.

## 10. Điểm thực thi, dữ liệu tin cậy và mã HTTP

### 10.1. PEP, PDP và mô hình được sử dụng

- **PDP — điểm quyết định:** `authorize(subject, action, resource, context)` trả allow/deny, dùng role từ `roleFor()` và dữ liệu tài nguyên thật.
- **PEP — điểm thực thi:** `TaskService.enforce()` chặn request bằng lỗi 403 trước khi trả nội dung hoặc ghi dữ liệu. Route HTTP gọi service; gọi service trực tiếp vẫn được kiểm tra.
- **RBAC:** role trong từng project được đối chiếu action qua ma trận.
- **ReBAC:** quan hệ user → membership → project → task và quan hệ được giao task làm cơ sở cấp quyền.
- **ABAC:** trạng thái Open và tenant là điều kiện bổ sung. Không cần OpenFGA hay một policy engine bên ngoài cho quy mô lab này.

### 10.2. Validation và chống sửa ngoài ý muốn

Các câu SQL truyền tham số cho giá trị; danh sách cột UPDATE chỉ lấy từ whitelist `title`, `description`, `assigneeId`, `status`. Không đưa khóa tùy ý từ body vào SQL. Task ID/projectId bất biến; title phải không rỗng và tối đa 200 ký tự; description tối đa 5000; status chỉ Open/Closed; assignee phải có membership của project hoặc là `NULL`.

Cần phân biệt hai ý nghĩa của `userId/role`: trong body sửa task, chúng không thay danh tính/quyền người gọi; trong API quản lý thành viên, chúng là **user đích và role muốn gán**, chỉ được xét sau khi người gọi đã qua action `members`.

### 10.3. Đọc đúng kết quả HTTP khi demo

| HTTP | Ý nghĩa trong ứng dụng |
|---|---|
| `200` | Thao tác thành công, bao gồm đăng nhập, đọc, PATCH, DELETE |
| `201` | Thêm thành viên thành công |
| `400` | Dữ liệu không hợp lệ, assignee không thuộc project hoặc user đích sai tenant |
| `401` | Thiếu/sai/hết hạn token hoặc sai thông tin đăng nhập |
| `403` | Đã xác thực nhưng policy hoặc giới hạn trường không cho phép |
| `404` | Tài nguyên hoặc phiên bản không tồn tại |
| `409` | Thành viên đã tồn tại hoặc thay đổi làm mất Owner cuối cùng |

Khi thấy `200`, kiểm tra cả dòng method/path trong khung kết quả. `POST /auth/login → 200` chỉ là đăng nhập thành công. `GET /api/v1/projects/alpha/members → 200` là giới hạn cố ý của V1. Với Bob còn là Member, `GET /api/v2/projects/alpha/members` phải trả `403`.

Chính sách bài chọn 403 cho tài nguyên ngoài phạm vi để dễ quan sát. Không che sự tồn tại bằng 404; lỗi deny không trả nội dung task, nhưng sự khác nhau giữa 403 và 404 có thể cho biết tài nguyên tồn tại.

## 11. So sánh kết quả và cách demo từng phiên bản

### 11.1. Điều kiện chuẩn bị

Kết quả bên dưới giả định dữ liệu seed chưa bị thay đổi. Trong thư mục Block-6, dừng server bằng Ctrl+C trước khi reset:

```bash
npm run db:reset
npm start
```

Mở `http://localhost:4006`. Chỉ chọn phiên bản một lần ở đầu trang. Chọn tình huống sẽ tự đăng nhập và điền request, chưa thực hiện request nghiệp vụ; bấm **Gửi request** để nhận kết quả. Khung bên phải luôn hiển thị kết quả trên desktop; mobile có khung cố định dưới màn hình, tự mở và có thể thu gọn.

### 11.2. Trình tự thuyết trình

1. **Starter:** chọn Alice đọc B1 → 200, thấy dữ liệu Beta. Giải thích policy luôn allow sau xác thực.
2. **V1:** gửi cùng request → 403; Alice đọc A1 và Charlie đọc B1 vẫn 200. Giải thích lookup membership theo project chứa task.
3. **V2:** Eve sửa A1 → 403; Bob sửa A1 → 200; Bob xem thành viên/xóa project → 403. Alice xem thành viên → 200. Bob giả role Admin vẫn bị chặn. Giải thích bảng role/action và role từ database.
4. **V3:** Bob sửa A1 → 200, A2 chưa giao → 403, A3 Closed → 403. Đối chiếu A2/A3 ở V2 còn 200. Alice sửa A3 vẫn 200. Giải thích assignee/status kiểm trên dữ liệu trước cập nhật.
5. **V4:** Dana đọc A1 → 200, đọc B1 → 403; thêm X-Tenant-Id beta vẫn 403. Đối chiếu V3, Dana đọc B1 còn 200. Giải thích tenant guard trước cấp quyền Admin.
6. **Thu hồi quyền:** hai tab, Alice gỡ Bob ở một tab; tab Bob giữ nguyên token cũ, gửi GET A1 → 403. Thực hiện xóa project ở cuối demo nếu cần, rồi reset trước khi lặp lại.

Muốn demo Charlie đọc B1, đăng nhập nhanh Charlie rồi nhập thủ công `GET /tasks/B1`; không chọn tình huống Alice đọc B1 vì thao tác đó tự đăng nhập lại Alice. Tương tự, không đăng nhập lại Bob khi đang chứng minh token cũ mất quyền sau khi bị gỡ.

### 11.3. Oracle 17 tình huống

Bảng dưới được lấy từ evidence của các request thật. Trường hợp cho phép sai ở bản trung gian là giới hạn cố ý; cột Đích thể hiện yêu cầu hoàn chỉnh ở V4. Dòng Closed trong oracle đổi A1 thành Closed trong fixture; tình huống giao diện dùng A3 Closed được seed sẵn để chứng minh cùng điều kiện.

| Tình huống | Starter | V1 | V2 | V3 | V4 | Đích |
|---|---|---|---|---|---|---|
| 01 Anonymous đọc A1 | 401 | 401 | 401 | 401 | 401 | 401 |
| 02 Alice đọc A1 | 200 | 200 | 200 | 200 | 200 | 200 |
| 03 Alice đọc B1 (IDOR) | 200 | 403 | 403 | 403 | 403 | 403 |
| 04 Charlie đọc B1 | 200 | 200 | 200 | 200 | 200 | 200 |
| 05 Viewer sửa A1 | 200 | 200 | 403 | 403 | 403 | 403 |
| 06 Member xóa Alpha | 200 | 200 | 403 | 403 | 403 | 403 |
| 07 Member quản lý thành viên | 200 | 200 | 403 | 403 | 403 | 403 |
| 08 Owner xóa Alpha | 200 | 200 | 200 | 200 | 200 | 200 |
| 09 Owner quản lý thành viên | 200 | 200 | 200 | 200 | 200 | 200 |
| 10 Bob giả role Admin | 200 | 200 | 403 | 403 | 403 | 403 |
| 11 Member sửa task được giao Open | 200 | 200 | 200 | 200 | 200 | 200 |
| 12 Member sửa task chưa giao | 200 | 200 | 200 | 403 | 403 | 403 |
| 13 Member sửa task Closed | 200 | 200 | 200 | 403 | 403 | 403 |
| 14 Member sửa task project khác | 200 | 200 | 403 | 403 | 403 | 403 |
| 15 Admin Alpha đọc A1 | 200 | 403 | 200 | 200 | 200 | 200 |
| 16 Admin Alpha đọc B1 | 200 | 403 | 200 | 200 | 403 | 403 |
| 17 Admin giả X-Tenant-Id beta | 200 | 403 | 200 | 200 | 403 | 403 |

## 12. Kiểm thử, evidence và đối chiếu yêu cầu bài nộp

Kết quả evidence đã lưu: **198/198 test API/business và 13/13 test Playwright headless đạt**. Đây là kết quả các lần kiểm chứng trước khi viết báo cáo; thay đổi tài liệu không đồng nghĩa chạy lại toàn bộ ứng dụng. Test API dùng Supertest và SQLite in-memory; mỗi test giao diện có server cổng tạm, database riêng và browser profile headless riêng, không thao tác trình duyệt người dùng.

| Thành phần cần nộp | Nơi thực hiện | Bằng chứng/kiểm tra |
|---|---|---|
| Bảng role, resource, action và điều kiện | Ma trận ở mục 6; điều kiện Member ở mục 7; tenant ở mục 8 | 12 ô ma trận × V2/V3/V4, kỳ vọng độc lập mã policy |
| V1 sửa IDOR, có allow và deny | `authorize()` và `TaskService.getTask()` | `evidence/idor-http.txt`, test Alice A1/B1 và Charlie B1 |
| V2 RBAC theo project | Membership và `MATRIX[role][action]` | Oracle 05–10, test ma trận, test CRUD thành viên |
| V3 assignee/status và chống vượt điều kiện | Policy V3 và giới hạn trường trong service | Oracle 11–14; test task chưa giao, Closed, tự giao/mở lại |
| V4 tenant boundary và giả mạo | Tenant guard, Admin từ DB, kiểm user đích | Oracle 15–17; test giả user/role/tenant |
| Cùng test đỏ trước, xanh sau | `tests/idor.test.ts`, đổi `TEST_VERSION` | `evidence/idor-before.txt`, `evidence/idor-after.txt` |
| Code diff và điểm chặn phía server | Policy Starter so với policy đầy đủ; service enforce | `evidence/authorization.diff`, mục 3 và 10 của báo cáo |
| Các entry point dùng chung kiểm quyền | Service đọc/sửa/xóa/membership; SQL filter cho list | Test gọi service trực tiếp; test list khớp GET từng ID |
| Giao diện demo và kết quả tại chỗ | HTML/CSS/JS, khung kết quả cố định | `evidence/playwright-results.json`, `ui-desktop.png`, `ui-mobile.png` |
| Giải thích lựa chọn và giới hạn | Mục 10 và 13 | Báo cáo này |

Các lệnh có thể tái chạy:

```bash
npm run typecheck
npm test
npm run test:e2e
npm run evidence
```

Để chứng minh đúng một regression test:

```bash
npm run test:idor:before
npm run test:idor:after
```

Lệnh before cố ý thoát mã 1 vì Starter trả 200 khi test kỳ vọng chặn Alice đọc B1; hai test allow vẫn xanh. Lệnh after dùng cùng test trên V4 và thoát mã 0. Suite `npm test` kiểm hành vi mong đợi của từng giai đoạn và bản sửa, nên suite xanh không có nghĩa Starter an toàn.

`npm run evidence` tạo request/response trước–sau, log test, oracle 17 tình huống và diff nguồn policy thực tế; token được che. Diff so sánh hai module thực tế của lab, không phải lịch sử commit giả lập. Evidence chạy trên dữ liệu tạm, không thay đổi `data/` của demo. Chạy `npm run test:e2e` cập nhật JSON và ảnh giao diện; trace khi lỗi được lưu trong `test-results/` và không đưa vào Git.

## 13. Giới hạn và các trường hợp chưa kiểm tra

- Đây là lab localhost có chủ đích giữ Starter/V1 chưa an toàn. Việc cho client chọn phiên bản policy chỉ phục vụ so sánh, không dùng làm thiết kế cấp quyền cho dữ liệu production.
- Chưa có HTTPS, MFA, giới hạn tốc độ đăng nhập, refresh/revoke token, audit log lâu dài, quản lý nhiều khóa ký hoặc tích hợp OAuth2 bên ngoài. Token bị đánh cắp có thể dùng đến hết hạn, nhưng quyền tài nguyên vẫn được xét theo database hiện hành.
- Chưa kiểm tải lớn, stress đồng thời, nhiều process/máy chủ, thay tenant giữa request hoặc sự cố lưu trữ. Transaction của SQLite trong mô hình lab không chứng minh mọi trường hợp của hệ thống phân tán.
- Chưa có chia sẻ qua nhóm/thư mục nhiều cấp, nhiều tenant cho một user, phân trang, tìm kiếm, export, tạo project/task hoặc ACL riêng từng task. Khi thêm entry point phải bổ sung kiểm quyền và test tương ứng.
- Kiểm soát trường PATCH, Owner được sửa Closed, giữ Owner cuối cùng và gỡ assignee khi thu hồi membership là các lựa chọn cụ thể của bài này; không phải mặc định bắt buộc cho mọi hệ thống.
- Reset là công cụ offline: dừng server trước khi chạy. Chuyển phiên bản không tự reset dữ liệu. Nếu kết quả demo khác oracle, kiểm tra endpoint, user/role hiện hành và dữ liệu đã bị thay đổi trước đó.

## 14. Cách đọc và cập nhật báo cáo

`REPORT.md` là nguồn nội dung. `REPORT.html` được tạo từ Markdown bằng `scripts/render-report.py`, dùng CSS và sơ đồ HTML/CSS có sẵn trong file, đọc được offline và không tải thư viện/font từ mạng. Bản HTML có mục lục theo section, sơ đồ luồng chung và liên kết tới code/evidence tương đối với thư mục Block-6.

```bash
python3 scripts/render-report.py
```

Mở trực tiếp `REPORT.html` trong trình duyệt. Báo cáo không được đặt trong thư mục `public/`, nên không mặc định có URL `/REPORT.html` trên ứng dụng demo. Đối chiếu đoạn trích code với các file liên kết khi thay đổi implementation; các đoạn được rút gọn đã được ghi rõ trong nội dung.
