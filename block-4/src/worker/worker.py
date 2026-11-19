import json
import os
import signal
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import pika
import psycopg

from src.shared.database import connect as connect_database
from src.shared.rabbitmq import (
    DLQ_NAME,
    QUEUE_NAME,
    RETRY_QUEUE_NAME,
    connect as connect_rabbitmq,
    declare_topology,
)


RETRY_DELAYS_MS = (1_000, 3_000, 9_000)
MAX_ATTEMPTS = 4
worker_name = os.environ.get("WORKER_NAME", "worker")
ready_file = Path("/tmp/worker-ready")


def stop(*_):
    ready_file.unlink(missing_ok=True)
    raise SystemExit(0)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)


def call_mock_llm(job_id, options):
    request = Request(
        f"{os.environ.get('MOCK_LLM_URL', 'http://mock-llm:3001')}/summarize",
        data=json.dumps({"job_id": job_id, "options": options}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=float(os.environ.get("MOCK_LLM_TIMEOUT_SECONDS", "10"))) as response:
        return json.loads(response.read())["summary"]


def start_attempt(message_id, job_id, replay_number, redelivered):
    with connect_database() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT COALESCE(MAX(attempt_number), 0) + 1 FROM processing_attempts WHERE message_id = %s", (message_id,))
            attempt_number = cursor.fetchone()[0]
            cursor.execute(
                "SELECT COUNT(*) + 1 FROM processing_attempts WHERE message_id = %s AND replay_number = %s",
                (message_id, replay_number),
            )
            cycle_attempt = cursor.fetchone()[0]
            cursor.execute(
                """
                INSERT INTO processing_attempts
                  (message_id, job_id, attempt_number, replay_number, worker_name, redelivered)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (message_id, job_id, attempt_number, replay_number, worker_name, redelivered),
            )
            attempt_id = cursor.fetchone()[0]
        connection.commit()
    return attempt_id, attempt_number, cycle_attempt


def finish_attempt(attempt_id, result, error_type=None):
    with connect_database() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE processing_attempts SET result = %s, error_type = %s, finished_at = NOW() WHERE id = %s",
                (result, error_type, attempt_id),
            )
        connection.commit()


def trigger_crash_if_planned(message_id, marker, attempt_id=None):
    """Persist the marker, then kill the worker process without cleanup."""
    with connect_database() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE crash_plans
                SET triggered_at = NOW(), worker_name = %s
                WHERE message_id = %s AND marker = %s AND triggered_at IS NULL
                RETURNING marker
                """,
                (worker_name, message_id, marker),
            )
            planned = cursor.fetchone() is not None
        connection.commit()
    if not planned:
        return
    if attempt_id is not None and marker != "after_commit_before_ack":
        finish_attempt(attempt_id, "CRASHED", marker)
    pid = os.getpid()
    print(f"{worker_name} SIGKILL pid={pid} at {marker} for {message_id}", flush=True)
    # Exit the current interpreter immediately, with the conventional SIGKILL
    # exit code. os._exit skips Python cleanup and leaves the AMQP delivery
    # unacknowledged. Docker restarts the container through its restart policy
    # and RabbitMQ redelivers that message.
    #
    # On Docker Desktop/Windows, signalling PID 1 from inside its namespace
    # may be virtualized; direct process exit is deterministic while still a
    # real worker-process crash, not an in-memory retry.
    os._exit(137)


def load_job(job_id):
    with connect_database() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT j.status, v.has_audio FROM jobs j JOIN videos v ON v.id = j.video_id WHERE j.id = %s",
                (job_id,),
            )
            return cursor.fetchone()


def persist_success(attempt_id, message, summary):
    with connect_database() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO summaries (job_id, content, version) VALUES (%s, %s, %s)",
                (message["job_id"], summary, message["version"]),
            )
            cursor.execute("UPDATE jobs SET status = 'DONE' WHERE id = %s", (message["job_id"],))
            cursor.execute("UPDATE processing_attempts SET result = 'SUCCEEDED', finished_at = NOW() WHERE id = %s", (attempt_id,))
        connection.commit()


def publish_persistent(channel, queue_name, message, expiration=None):
    properties = pika.BasicProperties(
        content_type="application/json",
        delivery_mode=pika.DeliveryMode.Persistent,
        message_id=message.get("message_id"),
        correlation_id=message.get("correlation_id"),
        expiration=str(expiration) if expiration is not None else None,
    )
    channel.basic_publish(
        exchange="",
        routing_key=queue_name,
        body=json.dumps(message),
        properties=properties,
        mandatory=True,
    )


def record_dead_letter(message, error_type, attempt_count):
    job_id = message.get("job_id")
    if not job_id:
        return
    with connect_database() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO dead_letters
                  (message_id, job_id, payload, error_type, attempt_count, dead_lettered_at, replay_count, active)
                VALUES (%s, %s, %s::jsonb, %s, %s, NOW(), %s, TRUE)
                ON CONFLICT (message_id) DO UPDATE SET
                  payload = EXCLUDED.payload,
                  error_type = EXCLUDED.error_type,
                  attempt_count = EXCLUDED.attempt_count,
                  dead_lettered_at = NOW(),
                  active = TRUE
                """,
                (
                    message["message_id"],
                    job_id,
                    json.dumps(message),
                    error_type,
                    attempt_count,
                    int(message.get("replay_count", 0)),
                ),
            )
            cursor.execute("UPDATE jobs SET status = 'DEAD_LETTERED' WHERE id = %s", (job_id,))
        connection.commit()


def send_to_retry(channel, method, message, attempt_id, cycle_attempt, error_type):
    finish_attempt(attempt_id, "TRANSIENT_ERROR", error_type)
    delay_ms = RETRY_DELAYS_MS[cycle_attempt - 1]
    message["last_error_type"] = error_type
    message["last_retry_delay_ms"] = delay_ms
    publish_persistent(channel, RETRY_QUEUE_NAME, message, expiration=delay_ms)
    channel.basic_ack(delivery_tag=method.delivery_tag)
    print(f"{worker_name} scheduled {message['job_id']} retry in {delay_ms} ms", flush=True)


def send_to_dlq(channel, method, message, attempt_id, cycle_attempt, result, error_type):
    finish_attempt(attempt_id, result, error_type)
    message["last_error_type"] = error_type
    message["attempt_count"] = cycle_attempt
    message["dead_lettered_at"] = datetime.now(timezone.utc).isoformat()
    publish_persistent(channel, DLQ_NAME, message)
    record_dead_letter(message, error_type, cycle_attempt)
    channel.basic_ack(delivery_tag=method.delivery_tag)
    print(f"{worker_name} moved {message.get('job_id')} to DLQ: {error_type}", flush=True)


def consume():
    connection = connect_rabbitmq()
    channel = connection.channel()
    declare_topology(channel)
    channel.confirm_delivery()
    channel.basic_qos(prefetch_count=1)

    def on_message(current_channel, method, properties, body):
        message_id = properties.message_id or f"invalid-{method.delivery_tag}"
        attempt_id = None
        try:
            message = json.loads(body)
            job_id = message["job_id"]
            message_id = message.get("message_id", message_id)
            replay_number = int(message.get("replay_count", 0))
            if not isinstance(job_id, str) or not job_id:
                raise ValueError("job_id is invalid")
            attempt_id, _attempt_number, cycle_attempt = start_attempt(message_id, job_id, replay_number, method.redelivered)
            job = load_job(job_id)
            if job is None:
                send_to_dlq(current_channel, method, message, attempt_id, cycle_attempt, "PERMANENT_ERROR", "UNKNOWN_JOB")
                return
            status, has_audio = job
            if status == "DONE":
                finish_attempt(attempt_id, "DUPLICATE")
                current_channel.basic_ack(delivery_tag=method.delivery_tag)
                return
            if not has_audio:
                send_to_dlq(current_channel, method, message, attempt_id, cycle_attempt, "PERMANENT_ERROR", "NO_AUDIO")
                return

            trigger_crash_if_planned(message_id, "before_llm_call", attempt_id)
            try:
                summary = call_mock_llm(job_id, message.get("options", {}))
            except HTTPError as error:
                error_type = f"HTTP_{error.code}"
                if error.code in (429, 503) and cycle_attempt < MAX_ATTEMPTS:
                    send_to_retry(current_channel, method, message, attempt_id, cycle_attempt, error_type)
                else:
                    result = "TRANSIENT_ERROR" if error.code in (429, 503) else "PERMANENT_ERROR"
                    send_to_dlq(current_channel, method, message, attempt_id, cycle_attempt, result, error_type)
                return
            except (URLError, TimeoutError, OSError):
                if cycle_attempt < MAX_ATTEMPTS:
                    send_to_retry(current_channel, method, message, attempt_id, cycle_attempt, "TIMEOUT")
                else:
                    send_to_dlq(current_channel, method, message, attempt_id, cycle_attempt, "TRANSIENT_ERROR", "TIMEOUT")
                return

            trigger_crash_if_planned(message_id, "after_llm_before_commit", attempt_id)
            persist_success(attempt_id, message, summary)
            trigger_crash_if_planned(message_id, "after_commit_before_ack")
            current_channel.basic_ack(delivery_tag=method.delivery_tag)
        except (json.JSONDecodeError, KeyError, ValueError) as error:
            message = message if isinstance(locals().get("message"), dict) else {"message_id": message_id, "raw_body": body.decode(errors="replace")}
            if attempt_id is None:
                attempt_id, _attempt_number, cycle_attempt = start_attempt(message_id, message.get("job_id"), int(message.get("replay_count", 0)), method.redelivered)
            send_to_dlq(current_channel, method, message, attempt_id, cycle_attempt, "PERMANENT_ERROR", "INVALID_MESSAGE")
        except (psycopg.Error, pika.exceptions.AMQPError):
            # Closing the channel leaves the current delivery unacked so RabbitMQ redelivers it.
            raise

    channel.basic_consume(queue=QUEUE_NAME, on_message_callback=on_message, auto_ack=False)
    ready_file.write_text(f"{worker_name} consuming {QUEUE_NAME}\n")
    channel.start_consuming()


while True:
    try:
        consume()
    except (pika.exceptions.AMQPError, psycopg.Error, OSError) as error:
        print(f"{worker_name} reconnecting after infrastructure error: {error}", flush=True)
        time.sleep(2)
