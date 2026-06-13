"""
AI Chat SSE Router - Proxies all chat requests to the tutor engine.

All capabilities (chat, deep_solve, research, question, math_animator, visualize)
are routed through the engine's unified capability orchestration layer.
"""

from __future__ import annotations

import json
import time
from typing import Any, AsyncGenerator, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..chat_service import create_ai_message, create_ai_session
from ..config import Settings
from ..db import session_scope
from ..models import AIChatSession
from .auth import require_token

from ..engine_bridge import stream_capability_via_orchestrator


class ChatMessage(BaseModel):
    role: str
    content: str | list[dict]


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    model: str
    api_key: str
    base_url: Optional[str] = None
    temperature: float = 0.1
    max_tokens: int = 4096
    system_prompt: Optional[str] = None
    # Default to the capability actually registered in
    # `agents/foundation/capability_registry.py`. Aliases like `chat` /
    # `question` are normalized below in `create_ai_chat_router`.
    capability: str = "chat"
    streaming: bool = True
    user_id: str = "anonymous"
    request_id: Optional[str] = None
    learning_context: Optional[dict] = None
    mode: str = "auto"  # "auto" = agentic pipeline, "fast" = direct LLM (skip thinking/acting/observing)
    persistence_session_id: Optional[str] = None
    persist_messages: bool = False
    persist_user_message: bool = True
    persist_assistant_message: bool = True


def _resolve_persistence_session_id(body: ChatRequest) -> str | None:
    if body.persistence_session_id:
        return body.persistence_session_id
    context = body.learning_context if isinstance(body.learning_context, dict) else {}
    raw = context.get("aiSessionId") or context.get("ai_session_id")
    return str(raw).strip() if raw else None


def _ensure_persistence_session(body: ChatRequest, session_id: str | None, user_message: str) -> str:
    with session_scope() as db:
        if session_id:
            existing = db.get(AIChatSession, session_id)
            if existing is not None:
                return existing.id

        created = create_ai_session(
            db,
            user_id=body.user_id or "anonymous",
            title=user_message.strip()[:50] or "AI Chat",
            source="课后答疑",
            session_id=session_id,
        )
        return created.id


def _persist_chat_message(
    body: ChatRequest,
    *,
    session_id: str,
    role: str,
    content: str,
    request_id: str,
    capability: str,
) -> None:
    if not content.strip():
        return
    with session_scope() as db:
        create_ai_message(
            db,
            session_id=session_id,
            role=role,
            content=content.strip(),
            user_id=body.user_id or "anonymous",
            content_type="text",
            capability=capability,
            model_name=body.model,
            request_id=f"{request_id}:{role}",
        )


def _sse_event(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _sse_comment(text: str) -> str:
    return f": {text}\n\n"


def _transform_engine_event(
    event: dict[str, Any],
    request_id: str,
    capability: str,
    session_started: bool,
) -> dict[str, Any] | None:
    """Transform engine capability events to frontend expected format."""
    event_type = event.get("type", "")
    message_id = f"assistant-{request_id}"
    agent_name_map = {
        "deep_solve": "深度解题",
        "deep_research": "深度研究",
        "research": "深度研究",
        "chat": "AI导师",
        "question": "智能出题",
        "math_animator": "数学动画",
        "visualize": "可视化",
    }
    agent_name = agent_name_map.get(capability, "AI导师")

    if event_type == "session":
        if not session_started:
            return {
                "type": "agent_start",
                "data": {
                    "messageId": message_id,
                    "agentId": capability,
                    "agentName": agent_name,
                },
            }
        return None

    if event_type == "status":
        return {
            "type": "thinking",
            "data": {
                "stage": "agent_loading",
                "agentId": capability,
                "reasoning": event.get("message", ""),
            },
        }

    if event_type == "stream":
        content = event.get("content", "")
        if not content:
            return None
        return {
            "type": "text_delta",
            "data": {
                "content": content,
                "messageId": message_id,
            },
        }

    if event_type == "result":
        # 返回结构化结果，文本由 event_generator 处理
        metadata = event.get("metadata", {})
        return {
            "type": "capability_result",
            "data": {
                "messageId": message_id,
                "content": event.get("content") or metadata.get("response", ""),
                "output_mode": metadata.get("output_mode", ""),
                "render_type": metadata.get("render_type", ""),
                "artifacts": metadata.get("artifacts", []),
                "code": metadata.get("code", {}),
                "analysis": metadata.get("analysis", {}),
                "review": metadata.get("review", {}),
            },
        }

    if event_type == "done":
        return {
            "type": "done",
            "data": {
                "totalActions": 0,
                "totalAgents": 1,
                "agentHadContent": True,
            },
        }

    if event_type == "sources":
        return {
            "type": "thinking",
            "data": {
                "stage": "agent_loading",
                "agentId": capability,
                "reasoning": "已检索到相关参考资料",
            },
        }

    if event_type == "error":
        return {
            "type": "error",
            "data": {
                "message": event.get("message", "请求处理失败"),
            },
        }

    return None


def _normalize_capability(raw: str | None) -> str:
    """Normalize a chat capability string to a tutor_engine registered id.

    The orchestrator (tutor_engine) registers capabilities as:
      chat, deep_solve, deep_question, deep_research, math_animator, visualize

    Aliases from older clients (agents/foundation names, mobile app, etc.) are
    mapped to the tutor_engine equivalents.
    """
    if not raw:
        return "chat"
    aliases = {
        "ai_tutor_chat": "chat",
        "tutor": "chat",
        "ai_tutor": "chat",
        "question": "deep_solve",
        "solve": "deep_solve",
        "research": "deep_research",
        "animator": "math_animator",
        "math": "math_animator",
    }
    return aliases.get(raw, raw)


def create_ai_chat_router(settings: Settings) -> APIRouter:
    router = APIRouter(tags=["ai-chat"])

    @router.post("/v1/ai/chat")
    async def ai_chat(
        request: Request,
        body: ChatRequest,
        authorization: str | None = Header(default=None),
    ) -> StreamingResponse:
        require_token(settings, authorization)

        request_id = body.request_id or f"chat-{body.user_id}-{int(time.time() * 1000)}"
        capability = _normalize_capability(body.capability)

        # Build messages from request
        messages = []
        for msg in body.messages:
            content = msg.content
            if isinstance(content, list):
                text_parts = [p.get("text", "") for p in content if p.get("type") == "text"]
                content = "".join(text_parts)
            messages.append({"role": msg.role, "content": content})

        user_message = messages[-1]["content"] if messages else ""
        conversation_history = messages[:-1] if len(messages) > 1 else []
        persistence_session_id = None
        if body.persist_messages:
            persistence_session_id = _ensure_persistence_session(
                body,
                _resolve_persistence_session_id(body),
                user_message,
            )
            if body.persist_user_message:
                _persist_chat_message(
                    body,
                    session_id=persistence_session_id,
                    role="user",
                    content=user_message,
                    request_id=request_id,
                    capability=capability,
                )

        async def event_generator() -> AsyncGenerator[str, None]:
            heartbeat_interval = 15.0
            last_heartbeat = time.time()
            session_started = False
            assistant_text = ""

            async for engine_event in stream_capability_via_orchestrator(
                capability=capability,
                user_message=user_message,
                conversation_history=conversation_history,
                session_id=request_id,
                language="zh",
                config_overrides={"mode": body.mode} if body.mode != "auto" else None,
            ):
                transformed = _transform_engine_event(
                    engine_event,
                    request_id,
                    capability,
                    session_started,
                )
                if transformed:
                    if transformed.get("type") == "agent_start":
                        session_started = True
                    if transformed.get("type") == "text_delta":
                        content = transformed.get("data", {}).get("content", "")
                        if content:
                            assistant_text += content
                    # capability_result：先发文本再发结构化数据
                    if transformed.get("type") == "capability_result":
                        result_data = transformed.get("data", {})
                        result_content = result_data.get("content", "")
                        if result_content:
                            text_event = {
                                "type": "text_delta",
                                "data": {"content": result_content, "messageId": result_data.get("messageId", "")},
                            }
                            assistant_text += result_content
                            yield _sse_event(text_event)
                    yield _sse_event(transformed)

                # Heartbeat
                now = time.time()
                if now - last_heartbeat >= heartbeat_interval:
                    yield _sse_comment("heartbeat")
                    last_heartbeat = now

            if (
                body.persist_messages
                and body.persist_assistant_message
                and persistence_session_id
                and assistant_text.strip()
            ):
                _persist_chat_message(
                    body,
                    session_id=persistence_session_id,
                    role="assistant",
                    content=assistant_text,
                    request_id=request_id,
                    capability=capability,
                )

            yield _sse_comment("end")

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Request-ID": request_id,
                **({"X-AI-Session-ID": persistence_session_id} if persistence_session_id else {}),
            },
        )

    @router.post("/v1/ai/chat/non-streaming")
    async def ai_chat_non_streaming(
        body: ChatRequest,
        authorization: str | None = Header(default=None),
    ) -> dict:
        """Non-streaming chat: collect all events and return final text."""
        require_token(settings, authorization)

        request_id = body.request_id or f"chat-{body.user_id}-{int(time.time() * 1000)}"
        capability = _normalize_capability(body.capability)

        messages = []
        for msg in body.messages:
            content = msg.content
            if isinstance(content, list):
                text_parts = [p.get("text", "") for p in content if p.get("type") == "text"]
                content = "".join(text_parts)
            messages.append({"role": msg.role, "content": content})

        user_message = messages[-1]["content"] if messages else ""
        conversation_history = messages[:-1] if len(messages) > 1 else []
        assistant_text = ""
        persistence_session_id = None
        if body.persist_messages:
            persistence_session_id = _ensure_persistence_session(
                body,
                _resolve_persistence_session_id(body),
                user_message,
            )
            if body.persist_user_message:
                _persist_chat_message(
                    body,
                    session_id=persistence_session_id,
                    role="user",
                    content=user_message,
                    request_id=request_id,
                    capability=capability,
                )

        try:
            async for engine_event in stream_capability_via_orchestrator(
                capability=capability,
                user_message=user_message,
                conversation_history=conversation_history,
                session_id=request_id,
                language="zh",
                config_overrides={"mode": body.mode} if body.mode != "auto" else None,
            ):
                if engine_event.get("type") == "stream":
                    assistant_text += engine_event.get("content", "")
                elif engine_event.get("type") == "result":
                    result_content = engine_event.get("content", "")
                    if result_content:
                        assistant_text = result_content
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail={"error_code": "CHAT_FAILED", "message": str(exc)},
            )

        if (
            body.persist_messages
            and body.persist_assistant_message
            and persistence_session_id
            and assistant_text.strip()
        ):
            _persist_chat_message(
                body,
                session_id=persistence_session_id,
                role="assistant",
                content=assistant_text,
                request_id=request_id,
                capability=capability,
            )

        return {
            "success": True,
            "assistant_text": assistant_text,
            "request_id": request_id,
            "session_id": persistence_session_id,
        }

    return router
