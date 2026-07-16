from __future__ import annotations

from types import SimpleNamespace

from tutor_engine.services.llm.multimodal import prepare_multimodal_messages


def test_openai_multimodal_prefers_base64_over_attachment_url() -> None:
    messages = [{"role": "user", "content": "Solve this image problem."}]
    attachment = SimpleNamespace(
        type="image",
        base64="ZmFrZXBuZw==",
        url="/v1/objects/uploads/problem.png",
        filename="problem.png",
        mime_type="image/png",
    )

    result = prepare_multimodal_messages(
        messages,
        [attachment],
        binding="openai",
        model="qwen-vl-plus",
    )

    content = result.messages[0]["content"]
    image_part = content[1]
    assert image_part["type"] == "image_url"
    assert image_part["image_url"]["url"] == "data:image/png;base64,ZmFrZXBuZw=="
