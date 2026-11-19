"""F3: V9 has no audio and must go directly to the DLQ."""

import json
import os
import sys
import time
import uuid
from pathlib import Path
from urllib.request import Request, urlopen


API = os.environ.get("API_URL", "http://127.0.0.1:3000")
MOCK = os.environ.get("MOCK_LLM_URL", "http://127.0.0.1:3001")
OUTPUT = Path("evidence/F3")


def request_json(url, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = Request(url, data=data, method=method, headers={"Content-Type": "application/json"} if data else {})
    with urlopen(request, timeout=30) as response:
        return response.status, json.loads(response.read())


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    batch_id = f"F3-{uuid.uuid4().hex[:8]}"
    request_json(f"{MOCK}/reset", "POST", {})
    _, queued = request_json(f"{API}/summaries", "POST", {"video_id": "V9", "options": {"scenario": "F3", "batch_id": batch_id}})
    deadline = time.monotonic() + 10
    job = None
    while time.monotonic() < deadline:
        _, job = request_json(f"{API}{queued['status_url']}")
        if job["status"] == "DEAD_LETTERED":
            break
        time.sleep(0.1)
    if not job or job["status"] != "DEAD_LETTERED":
        raise RuntimeError("F3 job did not reach DEAD_LETTERED")
    _, history = request_json(f"{API}/summaries/{queued['job_id']}/attempts")
    if len(history["attempts"]) != 1 or history["attempts"][0]["result"] != "PERMANENT_ERROR" or history["attempts"][0]["error_type"] != "NO_AUDIO":
        raise RuntimeError(f"Unexpected F3 attempts: {history}")
    _, calls = request_json(f"{MOCK}/calls/{queued['job_id']}")
    if calls["count"] != 0:
        raise RuntimeError("Mock LLM must not be called for V9")
    result = {"batch_id": batch_id, "job": job, "attempts": history, "mock_llm_calls": calls}
    (OUTPUT / "f3-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
