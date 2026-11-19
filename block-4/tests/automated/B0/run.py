"""Run the V0 baseline: five sequential synchronous summary requests."""

import csv
import json
import os
import statistics
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen


API_URL = os.environ.get("API_URL", "http://127.0.0.1:3000")
MOCK_URL = os.environ.get("MOCK_LLM_URL", "http://127.0.0.1:3001")
DELAY_MS = int(os.environ.get("B0_DELAY_MS", "250"))
REQUEST_COUNT = 5
EVIDENCE_DIRECTORY = Path("evidence/B0")


def request_json(url, method="GET", body=None):
    payload = json.dumps(body).encode() if body is not None else None
    request = Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"} if payload else {},
        method=method,
    )
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    EVIDENCE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    request_json(f"{MOCK_URL}/reset", method="POST", body={})
    request_json(
        f"{MOCK_URL}/config",
        method="POST",
        body={"default_delay_ms": DELAY_MS},
    )

    rows = []
    mock_calls = []
    for number in range(1, REQUEST_COUNT + 1):
        started_at = time.perf_counter()
        response = request_json(
            f"{API_URL}/v0/summaries",
            method="POST",
            body={"video_id": "V1", "options": {"baseline": "B0"}},
        )
        elapsed_ms = round((time.perf_counter() - started_at) * 1_000, 2)
        call_data = request_json(f"{MOCK_URL}/calls/{response['job_id']}")
        mock_calls.append(call_data)
        rows.append({
            "request_number": number,
            "job_id": response["job_id"],
            "video_id": "V1",
            "http_status": 200,
            "response_time_ms": elapsed_ms,
            "mock_llm_calls": call_data["count"],
        })

    with (EVIDENCE_DIRECTORY / "response-times.csv").open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)

    (EVIDENCE_DIRECTORY / "mock-llm-calls.json").write_text(
        json.dumps(mock_calls, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    timings = [row["response_time_ms"] for row in rows]
    summary = f"""# B0 — xử lý đồng bộ

- Mock LLM delay cấu hình: {DELAY_MS} ms.
- Số request tuần tự: {REQUEST_COUNT}.
- Thời gian phản hồi trung bình: {statistics.mean(timings):.2f} ms.
- Thời gian phản hồi nhỏ nhất: {min(timings):.2f} ms.
- Thời gian phản hồi lớn nhất: {max(timings):.2f} ms.
- Tổng thời gian chạy tuần tự: {sum(timings):.2f} ms.

Mỗi request chỉ nhận `200 OK` sau khi API chờ Mock LLM trả về và lưu `job` cùng `summary` vào PostgreSQL. Chi tiết từng request nằm trong `response-times.csv`; bộ đếm Mock LLM nằm trong `mock-llm-calls.json`.
"""
    (EVIDENCE_DIRECTORY / "summary.md").write_text(summary, encoding="utf-8")
    print(summary)


if __name__ == "__main__":
    main()
