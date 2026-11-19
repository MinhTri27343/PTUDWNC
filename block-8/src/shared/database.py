import os

import psycopg


CONNECTION_STRING = " ".join(
    f"{key}={value}"
    for key, value in {
        "host": os.environ.get("POSTGRES_HOST", "postgres"),
        "port": os.environ.get("POSTGRES_PORT", "5432"),
        "dbname": os.environ.get("POSTGRES_DB", "video_summary"),
        "user": os.environ.get("POSTGRES_USER", "app"),
        "password": os.environ.get("POSTGRES_PASSWORD", "app_password"),
    }.items()
)


def connect():
    return psycopg.connect(CONNECTION_STRING)
