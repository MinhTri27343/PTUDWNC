"""H1: submit 20 jobs and verify that both workers share the load."""

import json
import os
import sys
import time
import uuid
from collections import Counter
from pathlib import Path
from urllib.request import Request, urlopen


API_URL = os.environ.get("API_URL", "http://127.0.0.1:3000")
MOCK_URL = os.environ.get("MOCK_LLM_URL", "http://127.0.0.1:3001")
JOB_COUNT = 20
DELAY_MS = 200
OUTPUT = Path("evidence/H1")


def request_json(url, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = Request(url, data=data, method=method, headers={"Content-Type": "application/json"} if data else {})
    with urlopen(request, timeout=30) as response:
        return response.status, json.loads(response.read())


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    batch_id = f"H1-{uuid.uuid4().hex[:8]}"
    request_json(f"{MOCK_URL}/reset", "POST", {})
    request_json(f"{MOCK_URL}/config", "POST", {"default_delay_ms": DELAY_MS})

    started_at = time.perf_counter()
    jobs = []
    for _ in range(JOB_COUNT):
        status, response = request_json(
            f"{API_URL}/summaries",
            "POST",
            {"video_id": "V1", "options": {"scenario": "H1", "batch_id": batch_id}},
        )
        if status != 202:
            raise RuntimeError(f"Expected 202, received {status}")
        jobs.append(response)

    deadline = time.monotonic() + 30
    final_jobs = {}
    while time.monotonic() < deadline:
        for job in jobs:
            if job["job_id"] not in final_jobs:
                _, current = request_json(f"{API_URL}{job['status_url']}")
                if current["status"] == "DONE":
                    final_jobs[job["job_id"]] = current
        if len(final_jobs) == JOB_COUNT:
            break
        time.sleep(0.1)
    if len(final_jobs) != JOB_COUNT:
        raise RuntimeError(f"Only {len(final_jobs)}/{JOB_COUNT} jobs reached DONE")

    attempts = []
    for job in jobs:
        _, history = request_json(f"{API_URL}/summaries/{job['job_id']}/attempts")
        if len(history["attempts"]) != 1 or history["attempts"][0]["result"] != "SUCCEEDED":
            raise RuntimeError(f"Unexpected attempts for {job['job_id']}")
        attempts.append(history["attempts"][0])

    distribution = Counter(attempt["worker_name"] for attempt in attempts)
    if distribution.get("worker-1", 0) == 0 or distribution.get("worker-2", 0) == 0:
        raise RuntimeError(f"Both workers did not receive work: {dict(distribution)}")

    result = {
        "batch_id": batch_id,
        "job_count": JOB_COUNT,
        "mock_delay_ms": DELAY_MS,
        "elapsed_ms": round((time.perf_counter() - started_at) * 1_000, 2),
        "worker_distribution": dict(distribution),
        "jobs": list(final_jobs.values()),
        "attempts": attempts,
    }
    (OUTPUT / "h1-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: result[key] for key in ("batch_id", "job_count", "elapsed_ms", "worker_distribution")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
