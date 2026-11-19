"""Verify V1: API returns 202 before a delayed Mock LLM completes."""

import json
import os
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen


API_URL = os.environ.get("API_URL", "http://127.0.0.1:3000")
MOCK_URL = os.environ.get("MOCK_LLM_URL", "http://127.0.0.1:3001")
DELAY_MS = int(os.environ.get("H0_DELAY_MS", "1000"))
EVIDENCE_DIRECTORY = Path("evidence/H0")


def request_json(url, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = Request(url, data=data, method=method, headers={"Content-Type": "application/json"} if data else {})
    with urlopen(request, timeout=30) as response:
        return response.status, json.loads(response.read())


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    EVIDENCE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    request_json(f"{MOCK_URL}/reset", method="POST", body={})
    request_json(f"{MOCK_URL}/config", method="POST", body={"default_delay_ms": DELAY_MS})

    started_at = time.perf_counter()
    status, queued = request_json(f"{API_URL}/summaries", method="POST", body={"video_id": "V1", "options": {"scenario": "H0"}})
    accepted_ms = round((time.perf_counter() - started_at) * 1_000, 2)
    if status != 202:
        raise RuntimeError(f"Expected 202, received {status}")
    if accepted_ms >= DELAY_MS:
        raise RuntimeError(f"API waited {accepted_ms} ms for a {DELAY_MS} ms Mock LLM delay")

    _, initial = request_json(f"{API_URL}{queued['status_url']}")
    deadline = time.monotonic() + 15
    final = initial
    while final["status"] != "DONE" and time.monotonic() < deadline:
        time.sleep(0.1)
        _, final = request_json(f"{API_URL}{queued['status_url']}")
    if final["status"] != "DONE":
        raise RuntimeError("Job did not reach DONE within 15 seconds")

    _, mock_calls = request_json(f"{MOCK_URL}/calls/{queued['job_id']}")
    evidence = {
        "mock_delay_ms": DELAY_MS,
        "accepted_response_time_ms": accepted_ms,
        "queued_response": queued,
        "initial_status": initial,
        "final_status": final,
        "mock_llm_calls": mock_calls,
    }
    (EVIDENCE_DIRECTORY / "h0-result.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
