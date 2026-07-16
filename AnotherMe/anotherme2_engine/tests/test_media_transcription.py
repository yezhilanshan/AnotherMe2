from __future__ import annotations

import asyncio
from typing import Any

from api_gateway.routes import media


def test_detect_audio_mime_type_from_file_headers() -> None:
    assert media._detect_audio_mime_type(b"RIFF\x00\x00\x00\x00WAVE") == "audio/wav"
    assert media._detect_audio_mime_type(b"\x1a\x45\xdf\xa3") == "audio/webm"
    assert media._detect_audio_mime_type(b"\xff\xf1\x50\x80") == "audio/aac"
    assert media._detect_audio_mime_type(b"unknown", "audio/ogg; codecs=opus") == "audio/ogg"


def test_qwen_asr_uses_data_url_and_normalized_endpoint(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {
                "output": {
                    "choices": [
                        {"message": {"content": [{"text": "测试成功"}]}},
                    ],
                },
            }

    class FakeClient:
        def __init__(self, timeout: int) -> None:
            captured["timeout"] = timeout

        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def post(self, url: str, **kwargs: Any) -> FakeResponse:
            captured["url"] = url
            captured.update(kwargs)
            return FakeResponse()

    monkeypatch.setattr(media.httpx, "AsyncClient", FakeClient)

    result = asyncio.run(
        media._transcribe_qwen_audio(
            api_key="test-key",
            base_url="https://dashscope.example/api/v1",
            audio_content=b"RIFF\x00\x00\x00\x00WAVE",
            content_type="application/octet-stream",
            language="zh",
        ),
    )

    assert result == "测试成功"
    assert captured["url"] == (
        "https://dashscope.example/api/v1/services/aigc/"
        "multimodal-generation/generation"
    )
    assert captured["json"]["input"]["messages"][0]["content"][0]["audio"].startswith(
        "data:audio/wav;base64,",
    )
    assert captured["json"]["parameters"]["asr_options"]["language"] == "zh"
