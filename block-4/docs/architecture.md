# Architecture

The system receives a video-summary request at the API, stores a job in PostgreSQL, then publishes a durable SummarizeVideo message to RabbitMQ. Two workers consume from the same summaries queue with prefetch 1. A worker calls Mock LLM, commits the summary and job status in PostgreSQL, then acknowledges the message.

~~~text
Client -> API -> PostgreSQL (jobs) -> RabbitMQ summaries -> Worker 1 or Worker 2
                                  ^                         |
                                  |                         v
                                  +--- summaries, attempts <- Mock LLM
~~~

RabbitMQ queues:

- summaries: main durable work queue.
- summaries.retry: delayed retry queue using TTL and dead-letter routing back to summaries.
- summaries.dlq: durable dead-letter queue for permanent errors or exhausted retries.

PostgreSQL is the source of truth for jobs, summaries, processing attempts, dead-letter metadata and crash plans. The API waits for publisher confirm before returning 202. Workers commit success before manual ack; duplicate redelivery is recorded without calling Mock LLM.
