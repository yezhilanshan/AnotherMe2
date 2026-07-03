"""
Engine Bridge
=============

Bridges tutor_engine's ChatOrchestrator to the API gateway's SSE format.
Translates StreamEvent objects into flat dicts that ``ai_chat.py`` can forward.

P1 阶段：本文件已迁移到 gateway-owned 的类型。
  - StreamEvent / StreamEventType  →  ``api_gateway.internal.contracts``
  - 运行时 orchestrator 仍来自 tutor_engine（ChatOrchestrator + UnifiedContext），
    这部分在 P1.5 完成迁出。
"""

from __future__ import annotations

import logging
from typing import Any, AsyncGenerator

from tutor_engine.core.context import Attachment

from .internal.contracts import StreamEvent, StreamEventType

# 运行时仍在 tutor_engine
try:
    from tutor_engine.core.context import UnifiedContext
    from tutor_engine.runtime.orchestrator import ChatOrchestrator

    _ORCHESTRATOR_AVAILABLE = True
except Exception as exc:  # pragma: no cover
    _ORCHESTRATOR_AVAILABLE = False
    logger = logging.getLogger(__name__)
    logger.warning(
        "ChatOrchestrator unavailable, engine_bridge will not stream: %s", exc
    )
    UnifiedContext = None  # type: ignore
    ChatOrchestrator = None  # type: ignore

logger = logging.getLogger(__name__)

# Map StreamEventType -> the flat event type string that ``_transform_engine_event`` expects.
_TYPE_MAP: dict[StreamEventType, str] = {
    StreamEventType.SESSION: "session",
    StreamEventType.CONTENT: "stream",
    StreamEventType.THINKING: "status",
    StreamEventType.OBSERVATION: "status",
    StreamEventType.STAGE_START: "status",
    StreamEventType.STAGE_END: "status",
    StreamEventType.TOOL_CALL: "status",
    StreamEventType.TOOL_RESULT: "status",
    StreamEventType.PROGRESS: "status",
    StreamEventType.SOURCES: "sources",
    StreamEventType.RESULT: "result",
    StreamEventType.ERROR: "error",
    StreamEventType.DONE: "done",
}


def _event_to_dict(event: StreamEvent) -> dict[str, Any]:
    """Convert a StreamEvent into the flat dict format expected by ai_chat.py."""
    flat_type = _TYPE_MAP.get(event.type, "status")

    base: dict[str, Any] = {"type": flat_type}

    if flat_type == "session":
        base["session_id"] = event.session_id
        base["metadata"] = event.metadata

    elif flat_type == "stream":
        base["content"] = event.content
        base["source"] = event.source
        base["stage"] = event.stage
        base["metadata"] = event.metadata

    elif flat_type == "status":
        message = event.content
        if not message:
            label = event.metadata.get("label", "")
            call_state = event.metadata.get("call_state", "")
            if label and call_state:
                message = f"{label}: {call_state}"
            elif label:
                message = label
            elif event.stage:
                message = event.stage.replace("_", " ").title()
        base["message"] = message
        base["source"] = event.source
        base["stage"] = event.stage
        base["metadata"] = event.metadata

    elif flat_type == "sources":
        base["sources"] = event.metadata.get("sources", [])
        base["source"] = event.source

    elif flat_type == "result":
        base["content"] = event.content
        base["metadata"] = event.metadata
        base["source"] = event.source

    elif flat_type == "error":
        base["message"] = event.content or "Unknown error"
        base["source"] = event.source

    elif flat_type == "done":
        base["metadata"] = event.metadata

    return base


async def stream_capability_via_orchestrator(
    *,
    capability: str = "chat",
    user_message: str,
    conversation_history: list[dict[str, Any]] | None = None,
    session_id: str = "",
    language: str = "zh",
    knowledge_bases: list[str] | None = None,
    enabled_tools: list[str] | None = None,
    config_overrides: dict[str, Any] | None = None,
    attachments: list[dict[str, Any]] | None = None,
    file_context: str | None = None,
) -> AsyncGenerator[dict[str, Any], None]:
    """Stream capability events as flat dicts for the SSE gateway."""
    # 转换附件 dicts 为 Attachment 对象
    attachment_objects: list[Any] = []

    if attachments:
        for att_dict in attachments:
            att_type = att_dict.get("type", "")
            extracted = att_dict.get("extracted_text", "")

            attachment_objects.append(
                Attachment(
                    type=att_type,
                    url=att_dict.get("url", ""),
                    base64=att_dict.get("base64", ""),
                    filename=att_dict.get("filename", ""),
                    mime_type=att_dict.get("mime_type", ""),
                    extracted_text=extracted,
                    _hydration_error=att_dict.get("_hydration_error", ""),
                    sha256=att_dict.get("sha256", ""),
                    object_key=att_dict.get("object_key", ""),
                    size=int(att_dict.get("size", 0) or 0),
                    metadata=att_dict.get("metadata", {}),
                )
            )

    # 增强 user_message：注入已格式化的文件上下文（由 ai_chat.py 统一构建）
    enhanced_message = user_message
    if file_context:
        enhanced_message = f"{file_context}\n\n---\n\n[用户问题]\n{user_message}"

    context = UnifiedContext(
        session_id=session_id,
        user_message=enhanced_message,
        conversation_history=conversation_history or [],
        active_capability=capability,
        language=language,
        knowledge_bases=knowledge_bases or [],
        enabled_tools=enabled_tools,
        config_overrides=config_overrides or {},
        attachments=attachment_objects,
    )

    orchestrator = ChatOrchestrator()

    try:
        async for event in orchestrator.handle(context):
            yield _event_to_dict(event)
    except Exception as exc:
        logger.error("Orchestrator stream failed: %s", exc, exc_info=True)
        yield {"type": "error", "message": str(exc)}
        yield {"type": "done"}
