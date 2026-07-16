import asyncio

from tutor_engine.capabilities.chat import VisualSolveFastCapability
from tutor_engine.core.context import Attachment, UnifiedContext
from tutor_engine.core.stream_bus import StreamBus


def test_visual_solve_fast_passes_model_override_to_chat_agent(monkeypatch):
    captured = {}

    async def fake_generate_stream(self, messages, **kwargs):
        captured["model"] = self.model
        captured["attachments"] = kwargs.get("attachments")
        assert "model" not in kwargs
        yield "ok"

    monkeypatch.setattr(
        "tutor_engine.capabilities.chat.ChatAgent.generate_stream",
        fake_generate_stream,
    )

    async def run_capability():
        capability = VisualSolveFastCapability()
        bus = StreamBus()
        context = UnifiedContext(
            user_message="请分析这张图片",
            language="zh",
            attachments=[
                Attachment(
                    type="image",
                    base64="abc",
                    filename="problem.png",
                    mime_type="image/png",
                )
            ],
            config_overrides={"model": "qwen3.7-plus", "max_tokens": 4096},
        )
        await capability.run(context, bus)
        return bus._history

    events = asyncio.run(run_capability())

    assert captured["model"] == "qwen3.7-plus"
    assert captured["attachments"][0].type == "image"
    assert [event.content for event in events] == ["ok"]
