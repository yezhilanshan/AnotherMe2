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

from .internal.contracts import StreamEvent, StreamEventType

# 运行时仍在 tutor_engine
try:
    from tutor_engine.core.context import UnifiedContext
    from tutor_engine.runtime.orchestrator import ChatOrchestrator

    _ORCHESTRATOR_AVAILABLE = True
except Exception as exc:  # pragma: no cover
    _ORCHESTRATOR_AVAILABLE = False
    logger = logging.getLogger(__name__)
    logger.warning("ChatOrchestrator unavailable, engine_bridge will not stream: %s", exc)
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
        pass  # No extra fields needed

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
) -> AsyncGenerator[dict[str, Any], None]:
    """Stream capability events as flat dicts for the SSE gateway."""
    context = UnifiedContext(
        session_id=session_id,
        user_message=user_message,
        conversation_history=conversation_history or [],
        active_capability=capability,
        language=language,
        knowledge_bases=knowledge_bases or [],
        enabled_tools=enabled_tools,
        config_overrides=config_overrides or {},
        attachments=attachments or [],
    )

    orchestrator = ChatOrchestrator()

    try:
        async for event in orchestrator.handle(context):
            yield _event_to_dict(event)
    except Exception as exc:
        logger.error("Orchestrator stream failed: %s", exc, exc_info=True)
        yield {"type": "error", "message": str(exc)}
        yield {"type": "done"}
