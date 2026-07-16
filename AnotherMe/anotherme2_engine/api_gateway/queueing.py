"""Redis queue helper with dead-letter support."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Iterable, Optional, Tuple

import redis

from .config import Settings


@dataclass
class QueueMessage:
    job_id: str
    job_type: str
    queue_name: str

    def to_json(self) -> str:
        return json.dumps(
            {"job_id": self.job_id, "job_type": self.job_type, "queue_name": self.queue_name},
            ensure_ascii=False,
        )

    @staticmethod
    def from_json(raw: str) -> "QueueMessage":
        data = json.loads(raw)
        return QueueMessage(job_id=data["job_id"], job_type=data["job_type"], queue_name=data["queue_name"])


class RedisQueueClient:
    def __init__(self, redis_url: str):
        self.client = redis.Redis.from_url(redis_url, decode_responses=True)

    def enqueue(self, queue_name: str, message: QueueMessage) -> None:
        self.client.lpush(queue_name, message.to_json())

    def dequeue(self, queue_names: Iterable[str], timeout: int = 5) -> tuple[str, QueueMessage] | None:
        result = self.client.brpop(list(queue_names), timeout=timeout)
        if not result:
            return None
        queue_name, raw = result
        return queue_name, QueueMessage.from_json(raw)

    def push_dead_letter(self, dlq_name: str, message: QueueMessage) -> None:
        self.client.lpush(dlq_name, message.to_json())

    def dlq_length(self, dlq_name: str) -> int:
        """Return the number of messages in a DLQ."""
        return int(self.client.llen(dlq_name) or 0)

    def peek_dead_letters(self, dlq_name: str, offset: int = 0, limit: int = 50) -> list[QueueMessage]:
        """Read DLQ messages without removing them (non-destructive)."""
        raw_list = self.client.lrange(dlq_name, offset, offset + limit - 1)
        messages = []
        for raw in raw_list:
            try:
                messages.append(QueueMessage.from_json(raw))
            except Exception:
                continue
        return messages

    def requeue_dead_letter(self, dlq_name: str, target_queue: str, count: int = 1) -> int:
        """Move messages from DLQ back to the target queue. Returns number moved."""
        moved = 0
        for _ in range(count):
            raw = self.client.rpoplpush(dlq_name, target_queue)
            if raw is None:
                break
            moved += 1
        return moved

    def ping(self) -> bool:
        return bool(self.client.ping())

    def purge_queues(self, queue_names: Iterable[str]) -> int:
        keys = [str(name).strip() for name in queue_names if str(name).strip()]
        if not keys:
            return 0
        return int(self.client.delete(*keys) or 0)


class PollingQueueClient:
    """DB-polling fallback queue for local development without Redis."""

    backend = "polling"

    def enqueue(self, queue_name: str, message: QueueMessage) -> None:
        return None

    def dequeue(self, queue_names: Iterable[str], timeout: int = 5) -> Optional[Tuple[str, QueueMessage]]:
        return None

    def push_dead_letter(self, dlq_name: str, message: QueueMessage) -> None:
        return None

    def dlq_length(self, dlq_name: str) -> int:
        return 0

    def peek_dead_letters(self, dlq_name: str, offset: int = 0, limit: int = 50) -> list[QueueMessage]:
        return []

    def requeue_dead_letter(self, dlq_name: str, target_queue: str, count: int = 1) -> int:
        return 0

    def ping(self) -> bool:
        return False

    def purge_queues(self, queue_names: Iterable[str]) -> int:
        return 0


def build_queue_client(settings: Settings):
    backend = getattr(settings, "queue_backend", "auto")
    if backend == "polling":
        return PollingQueueClient()

    redis_client = RedisQueueClient(settings.redis_url)
    if backend == "redis":
        redis_client.ping()
        return redis_client

    try:
        if redis_client.ping():
            return redis_client
    except Exception as exc:
        raise RuntimeError(
            "Redis queue is unavailable. Start Redis or set "
            "GATEWAY_QUEUE_BACKEND=polling explicitly for a local-only development mode."
        ) from exc
    raise RuntimeError("Redis queue ping failed without an exception")
