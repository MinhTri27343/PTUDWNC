import json
import os
import threading
import time
from collections import defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


VALID_OUTCOMES = {"success", "429", "503", "timeout"}
state_lock = threading.Lock()
state = {
    "default_delay_ms": 0,
    "default_timeout_ms": 5_000,
    "default_outcomes": ["success"],
    "jobs": {},
    "calls": defaultdict(list),
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self._respond(200, {"service": "mock-llm", "status": "ok"})
            return

        path = urlparse(self.path).path
        if path == "/config":
            with state_lock:
                self._respond(200, self._configuration())
            return

        if path.startswith("/calls/"):
            job_id = path.removeprefix("/calls/")
            with state_lock:
                calls = list(state["calls"].get(job_id, []))
            self._respond(200, {"job_id": job_id, "count": len(calls), "calls": calls})
            return

        self._respond(404, {"error": "Not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/config":
            self._update_defaults()
            return
        if path.startswith("/config/jobs/"):
            self._configure_job(path.removeprefix("/config/jobs/"))
            return
        if path == "/reset":
            with state_lock:
                state["jobs"].clear()
                state["calls"].clear()
                state["default_delay_ms"] = 0
                state["default_timeout_ms"] = 5_000
                state["default_outcomes"] = ["success"]
            self._respond(200, {"status": "reset"})
            return
        if path == "/summarize":
            self._summarize()
            return
        self._respond(404, {"error": "Not found"})

    def _update_defaults(self):
        try:
            body = self._body()
            defaults = self._validated_settings(body, allow_outcomes=False)
        except ValueError as error:
            self._respond(400, {"error": str(error)})
            return

        with state_lock:
            if "delay_ms" in defaults:
                state["default_delay_ms"] = defaults["delay_ms"]
            if "timeout_ms" in defaults:
                state["default_timeout_ms"] = defaults["timeout_ms"]
            if "outcomes" in defaults:
                state["default_outcomes"] = defaults["outcomes"]
            response = self._configuration()
        self._respond(200, response)

    def _configure_job(self, job_id):
        if not job_id:
            self._respond(400, {"error": "job_id is required"})
            return
        try:
            settings = self._validated_settings(self._body(), allow_outcomes=True)
        except ValueError as error:
            self._respond(400, {"error": str(error)})
            return

        with state_lock:
            current = state["jobs"].get(job_id, {})
            state["jobs"][job_id] = current | settings
            response = {"job_id": job_id} | state["jobs"][job_id]
        self._respond(200, response)

    def _summarize(self):
        try:
            body = self._body()
            job_id = body["job_id"]
            if not isinstance(job_id, str) or not job_id:
                raise ValueError("job_id must be a non-empty string")
            options = body.get("options", {})
            if not isinstance(options, dict):
                raise ValueError("options must be an object")
        except (KeyError, ValueError) as error:
            self._respond(400, {"error": str(error)})
            return

        with state_lock:
            settings = {
                "delay_ms": state["default_delay_ms"],
                "timeout_ms": state["default_timeout_ms"],
                "outcomes": state["default_outcomes"],
            } | state["jobs"].get(job_id, {})
            if "mock_delay_ms" in options:
                delay = options["mock_delay_ms"]
                if not isinstance(delay, int) or delay < 0 or delay > 600_000:
                    self._respond(400, {"error": "mock_delay_ms must be an integer from 0 to 600000"})
                    return
                settings["delay_ms"] = delay
            call_number = len(state["calls"][job_id]) + 1
            outcome = settings["outcomes"][min(call_number - 1, len(settings["outcomes"]) - 1)]
            state["calls"][job_id].append({
                "call_number": call_number,
                "outcome": outcome,
                "delay_ms": settings["delay_ms"],
                "at": time.time(),
            })

        time.sleep(settings["delay_ms"] / 1_000)
        if outcome == "timeout":
            time.sleep(settings["timeout_ms"] / 1_000)
            self._respond(504, {"job_id": job_id, "error": "mock timeout"})
            return
        if outcome in {"429", "503"}:
            self._respond(int(outcome), {"job_id": job_id, "error": f"mock {outcome}"})
            return
        self._respond(200, {"job_id": job_id, "summary": f"Mock summary for {job_id}"})

    @staticmethod
    def _configuration():
        return {
            "default_delay_ms": state["default_delay_ms"],
            "default_timeout_ms": state["default_timeout_ms"],
            "default_outcomes": state["default_outcomes"],
            "jobs": state["jobs"],
        }

    @staticmethod
    def _validated_settings(body, allow_outcomes):
        if not isinstance(body, dict):
            raise ValueError("JSON body must be an object")
        result = {}
        for field in ("delay_ms", "timeout_ms"):
            default_field = f"default_{field}"
            key = default_field if default_field in body else field
            if key in body:
                value = body[key]
                if not isinstance(value, int) or value < 0 or value > 600_000:
                    raise ValueError(f"{key} must be an integer from 0 to 600000")
                result[field if key == default_field else key] = value
        outcome_field = "outcomes" if allow_outcomes else "default_outcomes"
        if outcome_field in body:
            outcomes = body[outcome_field]
            if not isinstance(outcomes, list) or not outcomes or any(item not in VALID_OUTCOMES for item in outcomes):
                raise ValueError(f"{outcome_field} must be a non-empty list of success, 429, 503, or timeout")
            result["outcomes"] = outcomes
        return result

    def _body(self):
        length = int(self.headers.get("Content-Length", "0"))
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError as error:
            raise ValueError("Body must be valid JSON") from error

    def _respond(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_):
        pass


port = int(os.environ.get("PORT", "3001"))
print(f"Mock LLM ready on port {port}", flush=True)
ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
