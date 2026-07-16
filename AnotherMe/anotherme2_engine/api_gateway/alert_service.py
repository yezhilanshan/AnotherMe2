"""Alert service for job failures and DLQ depth monitoring.

Sends webhook notifications when jobs permanently fail or DLQ depth
exceeds a configurable threshold. Supports generic webhook URLs
(compatible with DingTalk, Slack, Feishu incoming webhooks).
"""

from __future__ import annotations

import json
import logging
import threading
from typing import Any

import requests

from .config import Settings

logger = logging.getLogger("api_gateway.alert")


class AlertService:
    def __init__(self, settings: Settings) -> None:
        self._webhook_url = settings.alert_webhook_url
        self._dlq_threshold = settings.dlq_alert_threshold
        self._enabled = bool(self._webhook_url)
        self._alerted_dlqs: set[str] = set()  # Avoid spamming for same DLQ

    @property
    def enabled(self) -> bool:
        return self._enabled

    def notify_job_failed(self, job_id: str, job_type: str, error_code: str, error_message: str) -> None:
        """Send alert when a job permanently fails (exhausted retries)."""
        if not self._enabled:
            return

        payload = {
            "msg_type": "text",
            "content": {
                "text": (
                    f"🔴 Job Failed Permanently\n"
                    f"Job ID: {job_id}\n"
                    f"Type: {job_type}\n"
                    f"Error: {error_code}\n"
                    f"Message: {error_message[:200]}"
                ),
            },
        }
        self._send_async(payload)

    def notify_dlq_depth(self, queue_name: str, depth: int) -> None:
        """Send alert when DLQ depth exceeds threshold."""
        if not self._enabled:
            return
        if depth < self._dlq_threshold:
            return
        if queue_name in self._alerted_dlqs:
            return  # Already alerted for this DLQ in this session

        self._alerted_dlqs.add(queue_name)
        payload = {
            "msg_type": "text",
            "content": {
                "text": (
                    f"⚠️ DLQ Depth Alert\n"
                    f"Queue: {queue_name}\n"
                    f"Depth: {depth} (threshold: {self._dlq_threshold})\n"
                    f"Use POST /v1/admin/dlq/{{queue}}/retry to reprocess."
                ),
            },
        }
        self._send_async(payload)

    def reset_dlq_alert(self, queue_name: str) -> None:
        """Reset alert state for a DLQ (e.g., after retry)."""
        self._alerted_dlqs.discard(queue_name)

    def _send_async(self, payload: dict[str, Any]) -> None:
        """Send webhook in a background thread to avoid blocking."""
        thread = threading.Thread(target=self._send, args=(payload,), daemon=True)
        thread.start()

    def _send(self, payload: dict[str, Any]) -> None:
        try:
            resp = requests.post(
                self._webhook_url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=10,
            )
            if resp.status_code >= 400:
                logger.warning("Alert webhook returned %d: %s", resp.status_code, resp.text[:200])
        except Exception as exc:
            logger.warning("Failed to send alert webhook: %s", exc)


_ALERT_SERVICE: AlertService | None = None


def get_alert_service(settings: Settings | None = None) -> AlertService:
    global _ALERT_SERVICE
    if _ALERT_SERVICE is None:
        if settings is None:
            from .config import get_settings
            settings = get_settings()
        _ALERT_SERVICE = AlertService(settings)
    return _ALERT_SERVICE
