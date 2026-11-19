FROM python:3.13-slim

WORKDIR /app
ENV PYTHONPATH=/app
COPY src/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
COPY src ./src

USER nobody
