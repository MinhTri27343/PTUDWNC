"""Run F1, F5, or F8 using a persisted crash plan and abrupt process exit."""

import json
import os
import sys
import time
import uuid
from pathlib import Path
from urllib.request import Request, urlopen


API = os.environ.get("API_URL", "http://127.0.0.1:3000")
MOCK = os.environ.get("MOCK_LLM_URL", "http://127.0.0.1:3001")
CASE = os.environ.get("CRASH_CASE", "F1")
CASES = {
    "F1": {"marker": "before_llm_call", "results": ["CRASHED", "SUCCEEDED"], "calls": 1},
    "F5": {"marker": "after_commit_before_ack", "results": ["SUCCEEDED", "DUPLICATE"], "calls": 1},
    "F8": {"marker": "after_llm_before_commit", "results": ["CRASHED", "SUCCEEDED"], "calls": 2},
}


def request_json(url, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = Request(url, data=data, method=method, headers={"Content-Type": "application/json"} if data else {})
    with urlopen(request, timeout=30) as response:
        return response.status, json.loads(response.read())


def main():
    if CASE not in CASES:
        raise ValueError(f"Unknown crash case: {CASE}")
    sys.stdout.reconfigure(encoding="utf-8")
    config = CASES[CASE]
    output = Path(f"evidence/{CASE}")
    output.mkdir(parents=True, exist_ok=True)
    batch_id = f"{CASE}-{uuid.uuid4().hex[:8]}"
    request_json(f"{MOCK}/reset", "POST", {})
    _, queued = request_json(
        f"{API}/summaries",
        "POST",
        {"video_id": "V1", "options": {"scenario": CASE, "batch_id": batch_id, "crash_marker": config["marker"]}},
    )
    deadline = time.monotonic() + 40
    job = None
    while time.monotonic() < deadline:
        _, job = request_json(f"{API}{queued['status_url']}")
        if job["status"] == "DONE":
            break
        time.sleep(0.2)
    if not job or job["status"] != "DONE":
        raise RuntimeError(f"{CASE} job did not reach DONE")
    _, attempts = request_json(f"{API}/summaries/{queued['job_id']}/attempts")
    results = [attempt["result"] for attempt in attempts["attempts"]]
    if results != config["results"]:
        raise RuntimeError(f"Unexpected {CASE} attempts: {results}")
    _, calls = request_json(f"{MOCK}/calls/{queued['job_id']}")
    if calls["count"] != config["calls"]:
        raise RuntimeError(f"Unexpected {CASE} Mock LLM calls: {calls['count']}")
    result = {
        "case": CASE,
        "batch_id": batch_id,
        "marker": config["marker"],
        "job": job,
        "attempts": attempts,
        "mock_llm_calls": calls,
    }
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    timeline = "\n".join([
        f"# {CASE} timeline",
        "",
        f"- Marker: `{config['marker']}`",
        f"- Job: `{queued['job_id']}`",
        *[f"- Attempt {item['attempt_number']}: {item['result']} ({item['error_type'] or 'no error'})" for item in attempts["attempts"]],
        f"- Mock LLM calls: {calls['count']}",
    ]) + "\n"
    (output / "timeline.md").write_text(timeline, encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
