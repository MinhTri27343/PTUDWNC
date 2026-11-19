"""F7: an older V7 version finishes after a newer version."""

import json
import os
import sys
import time
import uuid
from pathlib import Path
from urllib.request import Request, urlopen


API_URL = os.environ.get("API_URL", "http://127.0.0.1:3000")
MOCK_URL = os.environ.get("MOCK_LLM_URL", "http://127.0.0.1:3001")
OUTPUT = Path("evidence/F7")


def request_json(url, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = Request(url, data=data, method=method, headers={"Content-Type": "application/json"} if data else {})
    with urlopen(request, timeout=30) as response:
        return response.status, json.loads(response.read())


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    batch_id = f"F7-{uuid.uuid4().hex[:8]}"
    request_json(f"{MOCK_URL}/reset", "POST", {})

    _, first = request_json(
        f"{API_URL}/summaries",
        "POST",
        {"video_id": "V7", "options": {"scenario": "F7", "batch_id": batch_id, "mock_delay_ms": 1500}},
    )
    _, second = request_json(
        f"{API_URL}/summaries",
        "POST",
        {"video_id": "V7", "options": {"scenario": "F7", "batch_id": batch_id, "mock_delay_ms": 150}},
    )

    deadline = time.monotonic() + 20
    statuses = {}
    while time.monotonic() < deadline:
        for queued in (first, second):
            _, current = request_json(f"{API_URL}{queued['status_url']}")
            statuses[queued["job_id"]] = current
        if all(status["status"] == "DONE" for status in statuses.values()):
            break
        time.sleep(0.1)
    if not all(status["status"] == "DONE" for status in statuses.values()):
        raise RuntimeError("Both F7 jobs did not reach DONE")

    _, first_attempts = request_json(f"{API_URL}/summaries/{first['job_id']}/attempts")
    _, second_attempts = request_json(f"{API_URL}/summaries/{second['job_id']}/attempts")
    first_job = statuses[first["job_id"]]
    second_job = statuses[second["job_id"]]
    first_finished = first_attempts["attempts"][0]["finished_at"]
    second_finished = second_attempts["attempts"][0]["finished_at"]
    if first_job["version"] >= second_job["version"]:
        raise RuntimeError("Video versions did not increase")
    if first_finished <= second_finished:
        raise RuntimeError("The older version did not finish after the newer version")

    _, current = request_json(f"{API_URL}/videos/V7/summary")
    if current["job_id"] != second_job["job_id"] or current["version"] != second_job["version"]:
        raise RuntimeError("Current V7 summary is not the highest completed version")

    result = {
        "batch_id": batch_id,
        "older_job": first_job,
        "newer_job": second_job,
        "older_attempts": first_attempts,
        "newer_attempts": second_attempts,
        "current_summary": current,
        "assertion": "older version finished later; current summary is the newer version",
    }
    (OUTPUT / "f7-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
