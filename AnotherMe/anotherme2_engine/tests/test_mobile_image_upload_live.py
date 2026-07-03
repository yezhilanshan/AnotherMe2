from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api_gateway.app import create_app
from api_gateway.config import Settings
from api_gateway.db import init_db, reconfigure_db
from api_gateway.storage import LocalObjectStorage


class FakeQueueClient:
    def __init__(self):
        self.items = []

    def enqueue(self, queue_name, message):
        self.items.append((queue_name, message))

    def ping(self):
        return True


def _collect_sse_events(response_text: str) -> list[dict]:
    events: list[dict] = []
    for line in response_text.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: ") :]))
    return events


@pytest.mark.skipif(
    os.getenv("RUN_LIVE_MOBILE_IMAGE_UPLOAD") != "1",
    reason="live vision test; set RUN_LIVE_MOBILE_IMAGE_UPLOAD=1 to run",
)
def test_mobile_image_upload_to_visual_answer_live(tmp_path: Path):
    image_path = Path(__file__).resolve().parents[1] / "problem5.jpg"
    assert image_path.exists(), f"missing fixture image: {image_path}"
    image_bytes = image_path.read_bytes()
    image_sha = hashlib.sha256(image_bytes).hexdigest()

    db_path = tmp_path / "mobile-image-upload-live.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    upload = client.post(
        "/v1/uploads",
        files={"file": ("problem5.jpg", image_bytes, "image/jpeg")},
    )
    assert upload.status_code == 200, upload.text
    upload_payload = upload.json()
    assert upload_payload["object_key"]
    assert upload_payload["sha256"] == image_sha

    chat = client.post(
        "/v1/ai/chat",
        json={
            "messages": [
                {
                    "role": "user",
                    "content": (
                        "请分析这张数学选择题图片，并给出最终答案。"
                        "要求只用简短中文说明关键条件和最终选项。"
                    ),
                }
            ],
            "model": "qwen3.7-plus",
            "api_key": "",
            "capability": "chat",
            "mode": "auto",
            "user_id": "mobile-live-image-test",
            "request_id": "mobile-live-problem5",
            "streaming": True,
            "max_tokens": 1024,
            "attachments": [
                {
                    "type": "image",
                    "object_key": upload_payload["object_key"],
                    "base64": base64.b64encode(image_bytes).decode("ascii"),
                    "filename": "problem5.jpg",
                    "mime_type": "image/jpeg",
                    "size": len(image_bytes),
                    "sha256": image_sha,
                }
            ],
        },
    )
    assert chat.status_code == 200, chat.text

    events = _collect_sse_events(chat.text)
    event_types = [event["type"] for event in events]
    assert "error" not in event_types, events
    assert "final_markdown" in event_types, event_types
    assert "render_metrics" in event_types, event_types

    final_text = next(
        event["data"]["content"]
        for event in events
        if event["type"] == "final_markdown"
    )
    render_metrics = next(
        event["data"]
        for event in events
        if event["type"] == "render_metrics"
    )

    assert render_metrics["capability"] == "visual_solve_fast"
    assert render_metrics["model"] == "qwen3.7-plus"
    assert render_metrics["image_count"] == 1
    assert render_metrics["truncated"] is False

    normalized = final_text.replace(" ", "").replace("\\", "")
    assert "无法" not in final_text
    assert "看不到" not in final_text
    assert "超时" not in final_text
    assert (
        "3√5" in normalized
        or "3sqrt{5}" in normalized
        or "3sqrt5" in normalized
        or "选D" in normalized
        or "D." in final_text
        or "D、" in final_text
    ), final_text
