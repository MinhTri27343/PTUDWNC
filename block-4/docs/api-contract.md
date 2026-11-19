# API contract

All endpoints use JSON. The API is available at http://127.0.0.1:3000.

| Method | Path | Purpose | Successful response |
| --- | --- | --- | --- |
| GET | /health | Health check | 200 |
| POST | /v0/summaries | Synchronous baseline | 200, job and summary |
| POST | /summaries | Queue a summary job | 202, job_id/message_id/status_url |
| GET | /summaries/:job_id | Read job and summary | 200 |
| GET | /summaries/:job_id/attempts | Read processing attempts | 200 |
| GET | /videos/:video_id/summary | Read highest completed video version | 200 |
| POST | /messages/:message_id/replay | Replay a dead-lettered message | 202 |
| POST | /test/crash-plans | Configure a crash marker for a message | 201 |

POST /summaries accepts:

~~~json
{ "video_id": "V1", "options": { "mock_delay_ms": 100 } }
~~~

The asynchronous response contains:

~~~json
{ "job_id": "J-...", "message_id": "M-...", "status": "QUEUED", "status_url": "/summaries/J-..." }
~~~

V0 forwards Mock LLM 429 and 503 responses and uses 504 for timeout. The asynchronous endpoint returns 503 when RabbitMQ publisher confirm is unavailable.
