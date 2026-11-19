import json
import os
import socket
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import pika
import psycopg

from src.shared.database import connect as connect_database
from src.shared.rabbitmq import DLQ_NAME, QUEUE_NAME, connect as connect_rabbitmq, declare_topology


MOCK_LLM_URL = os.environ.get("MOCK_LLM_URL", "http://mock-llm:3001")
MOCK_LLM_TIMEOUT_SECONDS = float(os.environ.get("MOCK_LLM_TIMEOUT_SECONDS", "10"))
CRASH_MARKERS = {"before_llm_call", "after_llm_before_commit", "after_commit_before_ack"}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self._respond(200, {"service": "api", "status": "ok"})
            return
        if self.path.startswith("/summaries/") and self.path.endswith("/attempts"):
            job_id = self.path.removeprefix("/summaries/").removesuffix("/attempts").rstrip("/")
            self._get_attempts(job_id)
            return
        if self.path.startswith("/summaries/"):
            self._get_summary(self.path.removeprefix("/summaries/"))
            return
        if self.path.startswith("/videos/") and self.path.endswith("/summary"):
            video_id = self.path.removeprefix("/videos/").removesuffix("/summary").rstrip("/")
            self._get_video_summary(video_id)
            return
        self._respond(404, {"error": "Not found"})

    def do_POST(self):
        if self.path == "/test/crash-plans":
            self._create_crash_plan()
            return
        if self.path.startswith("/messages/") and self.path.endswith("/replay"):
            message_id = self.path.removeprefix("/messages/").removesuffix("/replay").rstrip("/")
            self._replay_message(message_id)
            return
        if self.path == "/summaries":
            self._queue_summary()
            return
        if self.path == "/v0/summaries":
            self._create_summary_synchronously()
            return
        self._respond(404, {"error": "Not found"})

    def _queue_summary(self):
        try:
            video_id, options = self._request_values()
        except ValueError as error:
            self._respond(400, {"error": str(error)})
            return

        job_id = f"J-{uuid.uuid4().hex[:12]}"
        message_id = f"M-{uuid.uuid4().hex}"
        correlation_id = f"C-{uuid.uuid4().hex}"
        try:
            version = self._create_job(job_id, video_id, options, message_id, correlation_id, options.get("crash_marker"))
        except ValueError as error:
            self._respond(404, {"error": str(error)})
            return
        except psycopg.Error:
            self._respond(503, {"error": "Database unavailable"})
            return

        message = {
            "message_id": message_id,
            "correlation_id": correlation_id,
            "job_id": job_id,
            "video_id": video_id,
            "version": version,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "options": options,
        }
        try:
            self._publish_with_confirm(message)
        except (pika.exceptions.AMQPError, OSError, TimeoutError):
            self._respond(503, {
                "job_id": job_id,
                "message_id": message_id,
                "error": "Broker did not confirm the message",
            })
            return

        self._respond(202, {
            "job_id": job_id,
            "message_id": message_id,
            "status": "QUEUED",
            "status_url": f"/summaries/{job_id}",
        })

    def _get_summary(self, job_id):
        if not job_id or "/" in job_id:
            self._respond(404, {"error": "Not found"})
            return
        try:
            with connect_database() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT j.id, j.video_id, j.version, j.status, j.message_id, j.correlation_id, s.content
                        FROM jobs j
                        LEFT JOIN summaries s ON s.job_id = j.id
                        WHERE j.id = %s
                        """,
                        (job_id,),
                    )
                    row = cursor.fetchone()
        except psycopg.Error:
            self._respond(503, {"error": "Database unavailable"})
            return
        if row is None:
            self._respond(404, {"error": "Job not found"})
            return
        response = {
            "job_id": row[0],
            "video_id": row[1],
            "version": row[2],
            "status": row[3],
            "message_id": row[4],
            "correlation_id": row[5],
        }
        if row[6] is not None:
            response["summary"] = row[6]
        self._respond(200, response)

    def _create_crash_plan(self):
        try:
            body = self._body()
            message_id = body.get("message_id")
            marker = body.get("marker")
            if not isinstance(message_id, str) or not message_id:
                raise ValueError("message_id must be a non-empty string")
            if marker not in CRASH_MARKERS:
                raise ValueError("marker is invalid")
            with connect_database() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT 1 FROM jobs WHERE message_id = %s", (message_id,))
                    if cursor.fetchone() is None:
                        raise ValueError("message_id does not exist")
                    cursor.execute(
                        """
                        INSERT INTO crash_plans (message_id, marker)
                        VALUES (%s, %s)
                        ON CONFLICT (message_id) DO UPDATE SET marker = EXCLUDED.marker, triggered_at = NULL, worker_name = NULL
                        """,
                        (message_id, marker),
                    )
                connection.commit()
        except ValueError as error:
            self._respond(400, {"error": str(error)})
            return
        except psycopg.Error:
            self._respond(503, {"error": "Database unavailable"})
            return
        self._respond(201, {"message_id": message_id, "marker": marker, "status": "planned"})

    def _get_attempts(self, job_id):
        if not job_id or "/" in job_id:
            self._respond(404, {"error": "Not found"})
            return
        try:
            with connect_database() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT 1 FROM jobs WHERE id = %s", (job_id,))
                    if cursor.fetchone() is None:
                        self._respond(404, {"error": "Job not found"})
                        return
                    cursor.execute(
                        """
                        SELECT message_id, attempt_number, replay_number, worker_name, redelivered,
                               started_at, finished_at, result, error_type
                        FROM processing_attempts
                        WHERE job_id = %s
                        ORDER BY started_at, id
                        """,
                        (job_id,),
                    )
                    rows = cursor.fetchall()
        except psycopg.Error:
            self._respond(503, {"error": "Database unavailable"})
            return

        attempts = [
            {
                "message_id": row[0],
                "attempt_number": row[1],
                "replay_number": row[2],
                "worker_name": row[3],
                "redelivered": row[4],
                "started_at": row[5].isoformat(),
                "finished_at": row[6].isoformat() if row[6] else None,
                "result": row[7],
                "error_type": row[8],
            }
            for row in rows
        ]
        self._respond(200, {"job_id": job_id, "attempts": attempts})

    def _get_video_summary(self, video_id):
        if not video_id or "/" in video_id:
            self._respond(404, {"error": "Not found"})
            return
        try:
            with connect_database() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT 1 FROM videos WHERE id = %s", (video_id,))
                    if cursor.fetchone() is None:
                        self._respond(404, {"error": "Video not found"})
                        return
                    cursor.execute(
                        """
                        SELECT j.id, j.version, s.content
                        FROM jobs j
                        JOIN summaries s ON s.job_id = j.id
                        WHERE j.video_id = %s AND j.status = 'DONE'
                        ORDER BY j.version DESC
                        LIMIT 1
                        """,
                        (video_id,),
                    )
                    row = cursor.fetchone()
        except psycopg.Error:
            self._respond(503, {"error": "Database unavailable"})
            return
        if row is None:
            self._respond(404, {"error": "No completed summary for this video"})
            return
        self._respond(200, {"video_id": video_id, "job_id": row[0], "version": row[1], "summary": row[2]})

    def _replay_message(self, message_id):
        if not message_id or "/" in message_id:
            self._respond(404, {"error": "Not found"})
            return
        try:
            with connect_database() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT job_id, payload, replay_count FROM dead_letters WHERE message_id = %s AND active = TRUE",
                        (message_id,),
                    )
                    row = cursor.fetchone()
                    if row is None:
                        self._respond(404, {"error": "Active dead letter not found"})
                        return
                    job_id, payload, replay_count = row
                    payload["replay_count"] = replay_count + 1
                    payload.pop("last_error_type", None)
                    payload.pop("attempt_count", None)
                    payload.pop("dead_lettered_at", None)
                    cursor.execute("UPDATE jobs SET status = 'QUEUED' WHERE id = %s", (job_id,))
                    cursor.execute(
                        "UPDATE dead_letters SET payload = %s::jsonb, replay_count = %s, replayed_at = NOW() WHERE message_id = %s",
                        (json.dumps(payload), replay_count + 1, message_id),
                    )
                connection.commit()
        except psycopg.Error:
            self._respond(503, {"error": "Database unavailable"})
            return

        try:
            self._publish_replay_and_remove_dlq(message_id, payload)
        except (pika.exceptions.AMQPError, OSError, RuntimeError):
            with connect_database() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("UPDATE jobs SET status = 'DEAD_LETTERED' WHERE id = %s", (job_id,))
                connection.commit()
            self._respond(503, {"error": "Could not move the message from DLQ to the main queue"})
            return

        with connect_database() as connection:
            with connection.cursor() as cursor:
                cursor.execute("UPDATE dead_letters SET active = FALSE WHERE message_id = %s", (message_id,))
            connection.commit()
        self._respond(202, {
            "job_id": job_id,
            "message_id": message_id,
            "status": "QUEUED",
            "status_url": f"/summaries/{job_id}",
            "replay_count": replay_count + 1,
        })

    @staticmethod
    def _publish_replay_and_remove_dlq(message_id, payload):
        connection = connect_rabbitmq()
        try:
            channel = connection.channel()
            declare_topology(channel)
            queue_state = channel.queue_declare(queue=DLQ_NAME, passive=True)
            deliveries = []
            target = None
            for _ in range(queue_state.method.message_count):
                method, properties, body = channel.basic_get(queue=DLQ_NAME, auto_ack=False)
                if method is None:
                    break
                deliveries.append(method.delivery_tag)
                try:
                    stored_message_id = json.loads(body).get("message_id")
                except (json.JSONDecodeError, AttributeError):
                    stored_message_id = None
                if stored_message_id == message_id and target is None:
                    target = method.delivery_tag
            if target is None:
                for delivery_tag in deliveries:
                    channel.basic_nack(delivery_tag=delivery_tag, requeue=True)
                raise RuntimeError("Message is not present in summaries.dlq")

            channel.confirm_delivery()
            channel.basic_publish(
                exchange="",
                routing_key=QUEUE_NAME,
                body=json.dumps(payload),
                properties=pika.BasicProperties(
                    content_type="application/json",
                    delivery_mode=pika.DeliveryMode.Persistent,
                    message_id=message_id,
                    correlation_id=payload.get("correlation_id"),
                ),
                mandatory=True,
            )
            for delivery_tag in deliveries:
                if delivery_tag == target:
                    channel.basic_ack(delivery_tag=delivery_tag)
                else:
                    channel.basic_nack(delivery_tag=delivery_tag, requeue=True)
        finally:
            if connection.is_open:
                connection.close()

    def _create_summary_synchronously(self):
        try:
            video_id, options = self._request_values()
        except ValueError as error:
            self._respond(400, {"error": str(error)})
            return
        job_id = f"J-{uuid.uuid4().hex[:12]}"
        try:
            version = self._create_job(job_id, video_id, options)
        except ValueError as error:
            self._respond(404, {"error": str(error)})
            return
        except psycopg.Error:
            self._respond(503, {"error": "Database unavailable"})
            return

        started_at = time.perf_counter()
        try:
            llm_response = self._call_mock_llm(job_id, options)
        except HTTPError as error:
            self._respond(error.code, {"job_id": job_id, "status": "QUEUED", "error": f"Mock LLM returned {error.code}"})
            return
        except (TimeoutError, socket.timeout, URLError):
            self._respond(504, {"job_id": job_id, "status": "QUEUED", "error": "Mock LLM timed out or is unavailable"})
            return
        try:
            self._complete_job(job_id, version, llm_response["summary"])
        except (KeyError, psycopg.Error):
            self._respond(503, {"job_id": job_id, "status": "QUEUED", "error": "Could not persist the summary"})
            return
        self._respond(200, {
            "job_id": job_id,
            "video_id": video_id,
            "version": version,
            "status": "DONE",
            "summary": llm_response["summary"],
            "processing_time_ms": round((time.perf_counter() - started_at) * 1_000, 2),
        })

    @staticmethod
    def _create_job(job_id, video_id, options, message_id=None, correlation_id=None, crash_marker=None):
        with connect_database() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1 FROM videos WHERE id = %s", (video_id,))
                if cursor.fetchone() is None:
                    raise ValueError(f"Video {video_id} does not exist")
                cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (video_id,))
                cursor.execute("SELECT COALESCE(MAX(version), 0) + 1 FROM jobs WHERE video_id = %s", (video_id,))
                version = cursor.fetchone()[0]
                cursor.execute(
                    """
                    INSERT INTO jobs (id, video_id, version, message_id, correlation_id, options, status)
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb, 'QUEUED')
                    """,
                    (job_id, video_id, version, message_id, correlation_id, json.dumps(options)),
                )
                if crash_marker:
                    cursor.execute(
                        "INSERT INTO crash_plans (message_id, marker) VALUES (%s, %s)",
                        (message_id, crash_marker),
                    )
            connection.commit()
        return version

    @staticmethod
    def _publish_with_confirm(message):
        connection = None
        try:
            connection = connect_rabbitmq()
            channel = connection.channel()
            declare_topology(channel)
            channel.confirm_delivery()
            confirmed = channel.basic_publish(
                exchange="",
                routing_key=QUEUE_NAME,
                body=json.dumps(message),
                properties=pika.BasicProperties(
                    content_type="application/json",
                    delivery_mode=pika.DeliveryMode.Persistent,
                    message_id=message["message_id"],
                    correlation_id=message["correlation_id"],
                ),
                mandatory=True,
            )
            if confirmed is False:
                raise pika.exceptions.NackError()
        finally:
            if connection and connection.is_open:
                connection.close()

    @staticmethod
    def _call_mock_llm(job_id, options):
        request = Request(
            f"{MOCK_LLM_URL}/summarize",
            data=json.dumps({"job_id": job_id, "options": options}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(request, timeout=MOCK_LLM_TIMEOUT_SECONDS) as response:
            return json.loads(response.read())

    @staticmethod
    def _complete_job(job_id, version, summary):
        with connect_database() as connection:
            with connection.cursor() as cursor:
                cursor.execute("INSERT INTO summaries (job_id, content, version) VALUES (%s, %s, %s)", (job_id, summary, version))
                cursor.execute("UPDATE jobs SET status = 'DONE' WHERE id = %s", (job_id,))
            connection.commit()

    def _request_values(self):
        body = self._body()
        video_id = body.get("video_id")
        if not isinstance(video_id, str) or not video_id.strip():
            raise ValueError("video_id must be a non-empty string")
        options = body.get("options", {})
        if not isinstance(options, dict):
            raise ValueError("options must be an object")
        if "crash_marker" in options and options["crash_marker"] not in CRASH_MARKERS:
            raise ValueError("options.crash_marker is invalid")
        return video_id, options

    def _body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, ValueError) as error:
            raise ValueError("Body must be valid JSON") from error
        if not isinstance(body, dict):
            raise ValueError("JSON body must be an object")
        return body

    def _respond(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_):
        pass


port = int(os.environ.get("PORT", "3000"))
print(f"API ready on port {port}", flush=True)
ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
