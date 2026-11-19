import os

import pika


QUEUE_NAME = "summaries"
RETRY_QUEUE_NAME = "summaries.retry"
DLQ_NAME = "summaries.dlq"


def connect():
    credentials = pika.PlainCredentials(
        os.environ.get("RABBITMQ_USER", "app"),
        os.environ.get("RABBITMQ_PASSWORD", "app_password"),
    )
    parameters = pika.ConnectionParameters(
        host=os.environ.get("RABBITMQ_HOST", "rabbitmq"),
        port=int(os.environ.get("RABBITMQ_PORT", "5672")),
        credentials=credentials,
        heartbeat=30,
        blocked_connection_timeout=5,
    )
    return pika.BlockingConnection(parameters)


def declare_summary_queue(channel):
    channel.queue_declare(queue=QUEUE_NAME, durable=True)


def declare_topology(channel):
    declare_summary_queue(channel)
    channel.queue_declare(
        queue=RETRY_QUEUE_NAME,
        durable=True,
        arguments={
            "x-dead-letter-exchange": "",
            "x-dead-letter-routing-key": QUEUE_NAME,
        },
    )
    channel.queue_declare(queue=DLQ_NAME, durable=True)
