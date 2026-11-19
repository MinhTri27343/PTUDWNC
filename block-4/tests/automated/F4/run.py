"""F4: four 503 attempts go to DLQ, then replay succeeds with the same message ID."""

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
OUTPUT = Path("evidence/F4")


def request_json(url, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = Request(url, data=data, method=method, headers={"Content-Type": "application/json"} if data else {})
    with urlopen(request, timeout=30) as response:
        return response.status, json.loads(response.read())


def wait_status(status_url, expected, timeout):
    deadline = time.monotonic() + timeout
    job = None
    while time.monotonic() < deadline:
        _, job = request_json(f"{API}{status_url}")
        if job["status"] == expected:
            return job
        time.sleep(0.1)
    raise RuntimeError(f"Job did not reach {expected}: {job}")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    batch_id = f"F4-{uuid.uuid4().hex[:8]}"
    request_json(f"{MOCK}/reset", "POST", {})
    request_json(f"{MOCK}/config", "POST", {"default_outcomes": ["503"]})
    _, queued = request_json(f"{API}/summaries", "POST", {"video_id": "V1", "options": {"scenario": "F4", "batch_id": batch_id}})
    dead_job = wait_status(queued["status_url"], "DEAD_LETTERED", 25)
    _, before = request_json(f"{API}/summaries/{queued['job_id']}/attempts")
    if len(before["attempts"]) != 4 or any(item["result"] != "TRANSIENT_ERROR" or item["error_type"] != "HTTP_503" for item in before["attempts"]):
        raise RuntimeError(f"Unexpected attempts before replay: {before}")
    starts = [datetime.fromisoformat(item["started_at"]) for item in before["attempts"]]
    gaps = [(starts[index] - starts[index - 1]).total_seconds() for index in (1, 2, 3)]
    if gaps[0] < 0.8 or gaps[1] < 2.8 or gaps[2] < 8.8:
        raise RuntimeError(f"Retry delays are too short: {gaps}")
    _, calls_before = request_json(f"{MOCK}/calls/{queued['job_id']}")
    if calls_before["count"] != 4:
        raise RuntimeError("Mock LLM call count before replay is not 4")

    request_json(f"{MOCK}/reset", "POST", {})
    _, replay = request_json(f"{API}/messages/{queued['message_id']}/replay", "POST", {})
    done_job = wait_status(replay["status_url"], "DONE", 10)
    _, after = request_json(f"{API}/summaries/{queued['job_id']}/attempts")
    if len(after["attempts"]) != 5 or after["attempts"][-1]["result"] != "SUCCEEDED" or after["attempts"][-1]["replay_number"] != 1:
        raise RuntimeError(f"Replay did not add a successful attempt: {after}")
    _, calls_after = request_json(f"{MOCK}/calls/{queued['job_id']}")
    if calls_after["count"] != 1:
        raise RuntimeError("Mock LLM call count after replay is not 1")
    if done_job["message_id"] != queued["message_id"]:
        raise RuntimeError("Replay changed message_id")

    result = {
        "batch_id": batch_id,
        "dead_lettered_job": dead_job,
        "attempts_before_replay": before,
        "retry_start_gaps_seconds": gaps,
        "mock_calls_before_replay": calls_before,
        "replay_response": replay,
        "done_job": done_job,
        "attempts_after_replay": after,
        "mock_calls_after_replay": calls_after,
    }
    (OUTPUT / "f4-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
