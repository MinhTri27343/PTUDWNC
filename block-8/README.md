# Video summary queue lab

Giai đoạn 0 cung cấp môi trường cục bộ cho PostgreSQL, RabbitMQ, API, mock LLM và hai worker. Các endpoint nghiệp vụ, publish message và xử lý queue sẽ được xây ở các giai đoạn tiếp theo. Bộ khởi động dùng các image đã có sẵn trên máy: `postgres:17-alpine`, `rabbitmq:3-management` và `python:3.13-slim`.

## Yêu cầu

- Docker Desktop đang chạy
- Docker Compose v2 trở lên

## Chạy dự án

1. Tạo tệp cấu hình cục bộ:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Khởi động toàn bộ service:

   ```powershell
   docker compose up --build -d
   ```

3. Kiểm tra trạng thái:

   ```powershell
   docker compose ps
   ```

Mọi service phải có trạng thái `healthy` hoặc `running` với hai worker. Các worker hiện chạy tiến trình chờ, nên Compose có thể hiển thị `running` trong khi health check hiển thị `healthy`.

## Kiểm tra nhanh

```powershell
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod http://localhost:3001/health
docker compose exec postgres psql -U app -d video_summary -c "SELECT id, has_audio FROM videos ORDER BY id;"
```

Kết quả health mong đợi:

```json
{"service":"api","status":"ok"}
{"service":"mock-llm","status":"ok"}
```

RabbitMQ Management: http://localhost:15672, đăng nhập bằng `RABBITMQ_USER` và `RABBITMQ_PASSWORD` trong `.env`.

## Mock LLM (giai đoạn 1)

Mock LLM chạy tại `http://127.0.0.1:3001`. Mỗi request `POST /summarize` cần JSON có `job_id`. Service đếm các lần gọi theo `job_id` trong bộ nhớ.

```powershell
# Đặt hành vi theo từng lần gọi của job J42: hai lần 429 rồi thành công.
Invoke-RestMethod http://127.0.0.1:3001/config/jobs/J42 -Method Post -ContentType application/json -Body '{"delay_ms":100,"outcomes":["429","429","success"]}'

# Gọi mock và xem bộ đếm/lịch sử.
Invoke-RestMethod http://127.0.0.1:3001/summarize -Method Post -ContentType application/json -Body '{"job_id":"J42"}'
Invoke-RestMethod http://127.0.0.1:3001/calls/J42
```

Các giá trị hợp lệ trong `outcomes` là `success`, `429`, `503`, `timeout`. Với `timeout`, mock chờ `timeout_ms` rồi trả `504`; điều này cho phép worker ở giai đoạn sau đặt HTTP timeout ngắn hơn để mô phỏng timeout thật.

`POST /config` nhận `default_delay_ms`, `default_timeout_ms` và `default_outcomes`. `POST /reset` xóa cấu hình và bộ đếm mock. Migration giữ V9 với `has_audio = false` và tham chiếu file `/app/videos/V9.mp4`.

## V0 — xử lý đồng bộ và B0

`POST /v0/summaries` nhận `{ "video_id": "V1", "options": {} }`, tạo job `QUEUED`, gọi Mock LLM trong chính HTTP request, rồi lưu summary và đổi job thành `DONE` trước khi trả `200 OK`. API chuyển `429`, `503` từ Mock LLM cho client; khi Mock LLM quá thời gian chờ hoặc không kết nối được, API trả `504`.

Chạy phép đo B0 gồm năm request tuần tự:

```powershell
.\tests\automated\B0\run.ps1
```

Kết quả được ghi vào `evidence/B0/response-times.csv`, `summary.md`, `mock-llm-calls.json` và `database-snapshot.csv`.

## V1 — queue cơ bản

`POST /summaries` tạo job `QUEUED`, publish message persistent `SummarizeVideo` vào queue durable `summaries`, chờ RabbitMQ publisher confirm rồi mới trả `202 Accepted`. `GET /summaries/:job_id` trả `QUEUED` hoặc `DONE` cùng summary. Hai worker cùng consume queue với `prefetch=1`, lưu summary và đổi job sang `DONE` trước khi gửi manual ack.

Chạy kiểm tra H0:

```powershell
.\tests\automated\H0\run.ps1
```

Kết quả gồm thời gian API trả `202`, trạng thái ban đầu/cuối, bộ đếm Mock LLM, snapshot DB và số message queue được lưu ở `evidence/H0/`.

## V1 — theo dõi attempt và chống trùng

Mỗi lần worker nhận message đều tạo một dòng `processing_attempts`. `GET /summaries/:job_id/attempts` trả message ID, lần xử lý, worker, cờ giao lại, thời điểm, kết quả và loại lỗi. Khi job đã `DONE`, worker ghi `DUPLICATE`, ack message và không gọi Mock LLM.

Chạy kiểm tra publish lại cùng message ID:

```powershell
.\tests\automated\D4\run.ps1
```

Kết quả nằm tại `evidence/D4/d4-result.json` và `queue-state.txt`.

## Hai worker và version hiện tại

Version được cấp tuần tự trong transaction theo từng `video_id` và được bảo vệ bởi `UNIQUE(video_id, version)`. `GET /videos/:video_id/summary` luôn lấy summary thuộc version lớn nhất đã `DONE`, không phụ thuộc thứ tự commit.

```powershell
.\tests\demo\H1\run.ps1       # 20 job chia cho worker-1 và worker-2
.\tests\automated\F7\run.ps1  # V7 version cũ hoàn thành sau version mới
```

Bằng chứng nằm trong `evidence/H1/` và `evidence/F7/`.

## Retry, DLQ và replay

Lỗi `429`, `503` và timeout được thử lại qua `summaries.retry` sau 1, 3 và 9 giây; attempt thứ tư thất bại được chuyển sang `summaries.dlq`. Lỗi vĩnh viễn như V9 không có audio vào DLQ ngay. Payload DLQ được lưu trong bảng `dead_letters`; `POST /messages/:message_id/replay` giữ nguyên message ID và đưa job về queue chính.

```powershell
.\tests\automated\F2\run.ps1
.\tests\automated\F3\run.ps1
.\tests\automated\F4\run.ps1
```

Bằng chứng nằm trong `evidence/F2/`, `evidence/F3/` và `evidence/F4/`.

## Crash marker và broker restart

`options.crash_marker` chấp nhận `before_llm_call`, `after_llm_before_commit` hoặc `after_commit_before_ack`. Worker ghi crash plan vào PostgreSQL rồi kết thúc tức thì process với mã 137 (không cleanup, không ack); Docker tự khởi động lại worker. Đây là crash process thật, không phải retry trong RAM. Các ca F1, F5, F8 dùng cơ chế này.

```powershell
.\tests\demo\F1\run.ps1
.\tests\demo\F5\run.ps1
.\tests\demo\F8\run.ps1
.\tests\demo\F6\run.ps1
```

Kết quả mỗi ca được lưu dưới `evidence/F1`, `evidence/F5`, `evidence/F8` và `evidence/F6`. F6 dùng Mock LLM delay 4 giây, restart broker sau 0.5 giây và kiểm tra job hoàn tất sau khi broker phục hồi.

## Giai đoạn 8 — chạy lại toàn bộ bài nộp

Sau khi toàn bộ container healthy, chạy một lệnh sau để kiểm tra toàn bộ luồng nghiệp vụ và tạo evidence mới:

    .\scripts\run-tests.ps1

Suite chạy theo thứ tự B0, H0, D4, H1, F7, F2, F3, F4, F1, F5, F8 và F6. Mỗi script tự kiểm tra tiêu chí của case đó; nếu có lỗi, suite dừng với exit code khác 0 và lưu trạng thái container. Khi thành công, xem evidence/TEST-SUITE/summary.md, evidence/TEST-SUITE/results.json và evidence/TEST-SUITE/containers.txt.

### Kịch bản demo/chấm lại

1. Chạy docker compose up --build -d, chờ docker compose ps báo API, Mock LLM, PostgreSQL, RabbitMQ và hai worker healthy.
2. Chạy .\scripts\run-tests.ps1.
3. Mở evidence/TEST-SUITE/summary.md, sau đó mở evidence của case cần đối chiếu.
4. Với RabbitMQ, xem các queue summaries, summaries.retry, summaries.dlq tại Management UI; với DB, các snapshot CSV trong evidence cho thấy job, summary và attempts.

### Checklist nộp bài

- Mã nguồn, docker-compose.yml, .env.example, migration/seed, V9.mp4, README, scripts và evidence/ được kèm theo.
- Không đưa tệp .env vào Git; dùng .env.example để tạo cấu hình cục bộ.
- Không cần cài PostgreSQL hoặc RabbitMQ trực tiếp trên máy; toàn bộ service chạy bằng Docker Compose và các cổng host chỉ bind 127.0.0.1.

## Cấu trúc nộp bài

- src/: API, worker, Mock LLM, mã dùng chung và mô tả RabbitMQ.
- db/migrations/ và db/seed/: schema/migration và dữ liệu V1, V7, V9.
- tests/automated/: B0, H0, D4, F2, F3, F4, F7.
- tests/demo/: H1, F1, F5, F6, F8.
- scripts/run-tests.ps1: chạy toàn bộ suite; scripts/run-demo.ps1: chạy các ca demo; scripts/collect-evidence.ps1: chụp trạng thái container và queue.
- docs/: architecture, API contract và RabbitMQ mapping.

## Cổng mạng

Tất cả cổng host được bind vào `127.0.0.1`, không truy cập được từ mạng bên ngoài:

| Service | Địa chỉ mặc định |
| --- | --- |
| API | `http://127.0.0.1:3000` |
| Mock LLM | `http://127.0.0.1:3001` |
| PostgreSQL | `127.0.0.1:5433` |
| RabbitMQ AMQP | `127.0.0.1:5672` |
| RabbitMQ Management | `http://127.0.0.1:15672` |

## Dừng môi trường

```powershell
docker compose down
```

Dữ liệu PostgreSQL nằm trong Docker volume `video-summary-lab_postgres_data`. Chỉ dùng lệnh sau khi muốn xóa toàn bộ dữ liệu cục bộ:

```powershell
docker compose down -v
```
