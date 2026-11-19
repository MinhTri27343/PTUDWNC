"""F2: Mock LLM returns 429 twice, then succeeds after 1s and 3s retries."""

import json
import os
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen


API = os.environ.get("API_URL", "http://127.0.0.1:3000")
MOCK = os.environ.get("MOCK_LLM_URL", "http://127.0.0.1:3001")
OUTPUT = Path("evidence/F2")


def request_json(url, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = Request(url, data=data, method=method, headers={"Content-Type": "application/json"} if data else {})
    with urlopen(request, timeout=30) as response:
        return response.status, json.loads(response.read())


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    batch_id = f"F2-{uuid.uuid4().hex[:8]}"
    request_json(f"{MOCK}/reset", "POST", {})
    request_json(f"{MOCK}/config", "POST", {"default_outcomes": ["429", "429", "success"]})
    _, queued = request_json(f"{API}/summaries", "POST", {"video_id": "V1", "options": {"scenario": "F2", "batch_id": batch_id}})

    deadline = time.monotonic() + 20
    job = None
    while time.monotonic() < deadline:
        _, job = request_json(f"{API}{queued['status_url']}")
        if job["status"] == "DONE":
            break
        time.sleep(0.1)
    if not job or job["status"] != "DONE":
        raise RuntimeError("F2 job did not reach DONE")

    _, history = request_json(f"{API}/summaries/{queued['job_id']}/attempts")
    results = [attempt["result"] for attempt in history["attempts"]]
    errors = [attempt["error_type"] for attempt in history["attempts"]]
    if results != ["TRANSIENT_ERROR", "TRANSIENT_ERROR", "SUCCEEDED"] or errors[:2] != ["HTTP_429", "HTTP_429"]:
        raise RuntimeError(f"Unexpected F2 attempts: {history}")
    starts = [datetime.fromisoformat(attempt["started_at"]) for attempt in history["attempts"]]
    gaps = [(starts[index] - starts[index - 1]).total_seconds() for index in (1, 2)]
    if gaps[0] < 0.8 or gaps[1] < 2.8:
        raise RuntimeError(f"Retry delays are too short: {gaps}")
    _, calls = request_json(f"{MOCK}/calls/{queued['job_id']}")
    if calls["count"] != 3:
        raise RuntimeError("Mock LLM call count is not 3")

    result = {"batch_id": batch_id, "job": job, "attempts": history, "retry_start_gaps_seconds": gaps, "mock_llm_calls": calls}
    (OUTPUT / "f2-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
