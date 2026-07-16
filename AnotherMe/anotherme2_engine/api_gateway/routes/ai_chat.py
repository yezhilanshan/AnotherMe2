"""
AI Chat SSE Router - Proxies all chat requests to the tutor engine.

All capabilities (chat, deep_solve, research, question, math_animator, visualize)
are routed through the engine's unified capability orchestration layer.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import json
import logging
import os
import re
import tempfile
import time
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..chat_service import (
    create_ai_message,
    create_ai_session,
    sanitize_attachment_refs,
)
from ..chunk_retriever import format_retrieved_chunks, retrieve_relevant_chunks
from ..config import Settings
from ..db import session_scope
from ..document_store import DocumentAccessError, get_document_store
from ..engine_bridge import stream_capability_via_orchestrator
from ..file_extraction import extract_file_content, format_attachments_for_context
from ..memory_service import MEMORY_TYPE_NOTE, create_memory
from ..model_catalog import get_model_definition, resolve_request_model
from ..models import AIChatSession, LearningEvent
from ..problem_context_service import (
    format_problem_context_for_prompt,
    get_problem_context_by_id,
    get_problem_context_by_sha,
    serialize_problem_context,
    upsert_problem_context,
)
from ..storage import ObjectStorage, guess_content_type
from .auth import require_token

logger = logging.getLogger(__name__)
_ATTACHMENT_REF_CACHE: dict[str, dict[str, Any]] = {}
_ATTACHMENT_REF_CACHE_MAX = 32  # 2GB 内存：从 64 减半
_ATTACHMENT_REF_CACHE_MAX_SINGLE_SIZE = 3 * 1024 * 1024  # 3 MB — 超过不缓存
VISUAL_SOLVE_FAST_CAPABILITY = "visual_solve_fast"

# ── 附件限制（适配 2GB 内存服务器） ──
MAX_IMAGE_ATTACHMENTS = 5
MAX_FILE_ATTACHMENTS = 3
MAX_TOTAL_ATTACHMENTS = 5
MAX_SINGLE_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_SINGLE_FILE_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024  # 20 MB — 所有附件 base64 解码后合计
MAX_STREAM_OUTPUT_CHARS = int(os.getenv("AI_CHAT_STREAM_OUTPUT_CHARS", "0"))
MAX_STREAM_DURATION_SECONDS = float(
    os.getenv("AI_CHAT_MAX_STREAM_DURATION_SECONDS", "150")
)
MAX_STREAM_NO_CONTENT_SECONDS = float(
    os.getenv("AI_CHAT_MAX_STREAM_NO_CONTENT_SECONDS", "60")
)
MAX_AUTO_CONTINUATIONS = max(
    0,
    min(int(os.getenv("AI_CHAT_MAX_AUTO_CONTINUATIONS", "2")), 3),
)
CAPABILITY_STREAM_OUTPUT_CHARS = {
    "chat": int(os.getenv("AI_CHAT_CHAT_STREAM_OUTPUT_CHARS", "0")),
    "auto": int(os.getenv("AI_CHAT_AUTO_STREAM_OUTPUT_CHARS", "0")),
    "visual_solve_fast": int(os.getenv("AI_CHAT_VISUAL_STREAM_OUTPUT_CHARS", "0")),
    "deep_solve": int(os.getenv("AI_CHAT_DEEP_SOLVE_STREAM_OUTPUT_CHARS", "12000")),
    "deep_question": int(
        os.getenv("AI_CHAT_DEEP_QUESTION_STREAM_OUTPUT_CHARS", "12000")
    ),
    "deep_research": int(
        os.getenv("AI_CHAT_DEEP_RESEARCH_STREAM_OUTPUT_CHARS", "12000")
    ),
    "math_animator": int(
        os.getenv("AI_CHAT_MATH_ANIMATOR_STREAM_OUTPUT_CHARS", "32000")
    ),
    "visualize": int(os.getenv("AI_CHAT_VISUALIZE_STREAM_OUTPUT_CHARS", "32000")),
}
MAX_ANSWER_BLOCKS = 80
MAX_ANSWER_COMPONENTS = 80

# 按 capability 的超时配置。视觉模型首次推理可能超过普通文本对话，
# 视觉类保留更长的首包等待和总时长窗口。
CAPABILITY_STREAM_NO_CONTENT_SECONDS = {
    "visual_solve_fast": float(os.getenv("AI_CHAT_VISUAL_NO_CONTENT_SECONDS", "300")),
    "deep_solve": float(os.getenv("AI_CHAT_DEEP_SOLVE_NO_CONTENT_SECONDS", "240")),
    "deep_question": float(
        os.getenv("AI_CHAT_DEEP_QUESTION_NO_CONTENT_SECONDS", "180")
    ),
    "deep_research": float(
        os.getenv("AI_CHAT_DEEP_RESEARCH_NO_CONTENT_SECONDS", "240")
    ),
    "math_animator": float(
        os.getenv("AI_CHAT_MATH_ANIMATOR_NO_CONTENT_SECONDS", "300")
    ),
    "visualize": float(os.getenv("AI_CHAT_VISUALIZE_NO_CONTENT_SECONDS", "180")),
}
CAPABILITY_STREAM_DURATION_SECONDS = {
    "visual_solve_fast": float(os.getenv("AI_CHAT_VISUAL_DURATION_SECONDS", "420")),
    "deep_solve": float(os.getenv("AI_CHAT_DEEP_SOLVE_DURATION_SECONDS", "420")),
    "deep_question": float(
        os.getenv("AI_CHAT_DEEP_QUESTION_DURATION_SECONDS", "300")
    ),
    "deep_research": float(
        os.getenv("AI_CHAT_DEEP_RESEARCH_DURATION_SECONDS", "420")
    ),
    "math_animator": float(
        os.getenv("AI_CHAT_MATH_ANIMATOR_DURATION_SECONDS", "660")
    ),
    "visualize": float(os.getenv("AI_CHAT_VISUALIZE_DURATION_SECONDS", "360")),
}


def _stream_no_content_limit_for_capability(capability: str | None) -> float:
    """Return per-capability no-content timeout, falling back to global default."""
    if not capability:
        return MAX_STREAM_NO_CONTENT_SECONDS
    return CAPABILITY_STREAM_NO_CONTENT_SECONDS.get(
        capability, MAX_STREAM_NO_CONTENT_SECONDS
    )


def _stream_duration_limit_for_capability(capability: str | None) -> float:
    """Return per-capability total duration timeout, falling back to global default."""
    if not capability:
        return MAX_STREAM_DURATION_SECONDS
    return CAPABILITY_STREAM_DURATION_SECONDS.get(
        capability, MAX_STREAM_DURATION_SECONDS
    )


def _stream_output_limit_for_capability(capability: str | None) -> int:
    if not capability:
        return MAX_STREAM_OUTPUT_CHARS
    return CAPABILITY_STREAM_OUTPUT_CHARS.get(capability, MAX_STREAM_OUTPUT_CHARS)


def _auto_continuation_limit_for_capability(capability: str | None) -> int:
    if capability in {"deep_question", "deep_research"}:
        return MAX_AUTO_CONTINUATIONS
    return 0


def _should_emit_long_problem_prelude(
    capability: str | None, user_message: str
) -> bool:
    if os.getenv("AI_CHAT_LONG_PROBLEM_PRELUDE", "0") not in {"1", "true", "True"}:
        return False
    if capability not in {"chat", "auto", VISUAL_SOLVE_FAST_CAPABILITY}:
        return False
    text = user_message.lower()
    math_markers = (
        "geometry",
        "triangle",
        "circle",
        "prove",
        "solve",
        "公式",
        "几何",
        "三角形",
        "圆",
        "证明",
        "推导",
        "解答",
    )
    return len(user_message) >= 180 and any(marker in text for marker in math_markers)


def _runtime_config_overrides(
    mode: str, max_tokens: int | None, model: str | None = None
) -> dict[str, Any] | None:
    overrides: dict[str, Any] = {}
    if model:
        overrides["model"] = model
    if mode != "auto":
        overrides["mode"] = mode
    if max_tokens:
        overrides["max_tokens"] = max(1, min(int(max_tokens), 32768))
    return overrides or None


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
    # 附件（新版：直接传 attachment 对象列表，替代消息文本中的 base64 标记）
    attachments: list[dict] = []
    # 已缓存文档引用（后续追问时无需重复传 base64）
    document_refs: list[str] = []
    # 已缓存题目视觉上下文（同图追问时无需重复调用视觉模型）
    problem_context_id: Optional[str] = None


def _dedup_attachments(attachments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Remove duplicate attachments with the same object_key."""
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for att in attachments:
        key = str(att.get("object_key") or att.get("objectKey") or "").strip()
        if key:
            if key in seen:
                logger.debug("[ai_chat] dedup attachment object_key=%s", key)
                continue
            seen.add(key)
        deduped.append(att)
    return deduped


def _validate_attachments(attachments: list[dict[str, Any]]) -> None:
    """Validate attachment count and size limits. Raises HTTPException on violation."""
    if not attachments:
        return

    img_count = 0
    file_count = 0
    total_bytes = 0

    for att in attachments:
        att_type = att.get("type", "")
        if att_type not in ("image", "file"):
            raise HTTPException(
                status_code=400,
                detail={
                    "error_code": "INVALID_ATTACHMENT_TYPE",
                    "message": f"附件类型无效: '{att_type}'，必须为 'image' 或 'file'",
                },
            )
        # 从 base64 估算解码后的字节数
        b64 = att.get("base64", "")
        raw_bytes = int(len(b64) * 3 / 4) if b64 else 0
        # 也考虑 object_key-only 附件（尚未水合，无法检查大小）
        total_bytes += raw_bytes

        if att_type == "image":
            img_count += 1
            if raw_bytes > MAX_SINGLE_IMAGE_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error_code": "IMAGE_TOO_LARGE",
                        "message": f"图片 '{att.get('filename', '?')}' 大小 {raw_bytes // (1024 * 1024)}MB，超过 {MAX_SINGLE_IMAGE_BYTES // (1024 * 1024)}MB 限制",
                    },
                )
        else:
            file_count += 1
            if raw_bytes > MAX_SINGLE_FILE_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error_code": "FILE_TOO_LARGE",
                        "message": f"文件 '{att.get('filename', '?')}' 大小 {raw_bytes // (1024 * 1024)}MB，超过 {MAX_SINGLE_FILE_BYTES // (1024 * 1024)}MB 限制",
                    },
                )

    if img_count > MAX_IMAGE_ATTACHMENTS:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "TOO_MANY_IMAGES",
                "message": f"最多上传 {MAX_IMAGE_ATTACHMENTS} 张图片，当前 {img_count} 张",
            },
        )

    if file_count > MAX_FILE_ATTACHMENTS:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "TOO_MANY_FILES",
                "message": f"最多上传 {MAX_FILE_ATTACHMENTS} 个文件，当前 {file_count} 个",
            },
        )

    if img_count + file_count > MAX_TOTAL_ATTACHMENTS:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "TOO_MANY_ATTACHMENTS",
                "message": f"附件总数最多 {MAX_TOTAL_ATTACHMENTS} 个，当前 {img_count + file_count} 个",
            },
        )

    if total_bytes > MAX_TOTAL_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "TOTAL_ATTACHMENTS_TOO_LARGE",
                "message": f"附件总大小 {total_bytes // (1024 * 1024)}MB，超过 {MAX_TOTAL_ATTACHMENT_BYTES // (1024 * 1024)}MB 限制",
            },
        )


def _extract_file_attachments(text: str) -> tuple[str, list[dict[str, Any]]]:
    """
    从消息文本中提取文件附件标记，返回 (清理后的文本, 附件列表)。
    标记格式：[文件: filename | data:mimeType;base64,base64data]
    """
    pattern = re.compile(r"\[文件:\s*([^|]+)\s*\|\s*data:([^;]+);base64,([^\]]+)\]")
    attachments: list[dict[str, Any]] = []
    cleaned = text
    for match in pattern.finditer(text):
        filename = match.group(1).strip()
        mime_type = match.group(2).strip()
        base64_data = match.group(3).strip()
        attachments.append(
            {
                "type": "file",
                "base64": base64_data,
                "mime_type": mime_type,
                "filename": filename,
            }
        )
        cleaned = cleaned.replace(match.group(0), "")
    return cleaned.strip(), attachments


def _process_file_attachments(
    attachments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    对文件类型附件执行文本提取，将 extracted_text 注入 attachment dict。
    图片类型跳过（留给视觉模型）。
    """
    processed: list[dict[str, Any]] = []
    for att in attachments:
        if att.get("type") == "image":
            # 图片不提取文字
            processed.append(att)
            continue

        base64_data = att.get("base64", "")
        if not base64_data:
            processed.append(att)
            continue

        mime_type = att.get("mime_type", "")
        filename = att.get("filename", "")

        try:
            result = extract_file_content(base64_data, mime_type, filename)
        except Exception:
            processed.append(att)
            continue

        if result.success and result.chunks:
            # 合并所有块为单个文本
            extracted = "".join(c.text for c in result.chunks)
            att_copy = dict(att)
            att_copy["extracted_text"] = extracted
            att_copy["extraction_info"] = {
                "total_chars": result.total_chars,
                "chunks": len(result.chunks),
                "truncated": result.truncated,
                "metadata": result.metadata,
            }
            processed.append(att_copy)
        else:
            att_copy = dict(att)
            att_copy["extraction_error"] = result.error
            processed.append(att_copy)

    return processed


def _hydration_error_filenames(attachments: list[dict[str, Any]]) -> list[str]:
    """Return filenames of attachments that failed hydration."""
    return [
        str(att.get("filename") or att.get("object_key") or "unknown")
        for att in attachments
        if att.get("_hydration_error")
    ]


def _sanitize_attachments_for_persistence(
    attachments: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    return sanitize_attachment_refs(attachments)


def _cache_attachment_ref(object_key: str, payload: dict[str, Any]) -> None:
    if not object_key:
        return
    # 超过单条大小上限不缓存，避免内存膨胀
    b64 = payload.get("base64", "")
    if b64 and len(b64) > _ATTACHMENT_REF_CACHE_MAX_SINGLE_SIZE:
        logger.debug(
            "[ai_chat] skip caching large attachment %s (%d bytes)",
            object_key,
            len(b64),
        )
        return
    if len(_ATTACHMENT_REF_CACHE) >= _ATTACHMENT_REF_CACHE_MAX:
        oldest_key = next(iter(_ATTACHMENT_REF_CACHE))
        _ATTACHMENT_REF_CACHE.pop(oldest_key, None)
    _ATTACHMENT_REF_CACHE[object_key] = payload


def _attachment_sha256_from_base64(base64_data: str) -> str | None:
    if not base64_data:
        return None
    try:
        return hashlib.sha256(base64.b64decode(base64_data)).hexdigest()
    except Exception:
        return None


def _hydrate_attachment_refs(
    attachments: list[dict[str, Any]],
    storage: ObjectStorage | None,
) -> list[dict[str, Any]]:
    """Resolve object_key-only attachments into in-memory base64 payloads."""
    hydrated: list[dict[str, Any]] = []
    for item in attachments:
        att = dict(item)
        object_key = str(att.get("object_key") or att.get("objectKey") or "").strip()
        if att.get("base64") or not object_key:
            if att.get("base64") and not att.get("sha256"):
                sha256 = _attachment_sha256_from_base64(str(att.get("base64") or ""))
                if sha256:
                    att["sha256"] = sha256
            hydrated.append(att)
            continue

        cached = _ATTACHMENT_REF_CACHE.get(object_key)
        if cached:
            hydrated.append({**att, **cached})
            continue

        if storage is None:
            logger.warning(
                "[ai_chat] attachment ref ignored without storage: %s", object_key
            )
            att["_hydration_error"] = "storage unavailable"
            hydrated.append(att)
            continue

        suffix = ""
        filename = str(
            att.get("filename") or object_key.rsplit("/", 1)[-1] or "attachment"
        )
        if "." in filename:
            suffix = "." + filename.rsplit(".", 1)[-1]
        started = time.time()
        tmp_path = ""
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp_path = tmp.name
            storage.download_file(object_key, tmp_path)
            payload_bytes = Path(tmp_path).read_bytes()
        except Exception as exc:
            logger.warning(
                "[ai_chat] failed to hydrate attachment %s: %s", object_key, exc
            )
            att["_hydration_error"] = str(exc)
            hydrated.append(att)
            continue
        finally:
            if tmp_path:
                try:
                    Path(tmp_path).unlink(missing_ok=True)
                except Exception:
                    pass

        mime_type = str(
            att.get("mime_type") or att.get("mimeType") or ""
        ).strip() or guess_content_type(filename)
        payload = {
            "base64": base64.b64encode(payload_bytes).decode("utf-8"),
            "mime_type": mime_type,
            "filename": filename,
            "object_key": object_key,
            "size": len(payload_bytes),
            "sha256": hashlib.sha256(payload_bytes).hexdigest(),
        }
        _cache_attachment_ref(object_key, payload)
        logger.info(
            "[ai_chat] hydrated attachment ref object_key=%s bytes=%d ms=%d",
            object_key,
            len(payload_bytes),
            int((time.time() - started) * 1000),
        )
        hydrated.append({**att, **payload})
    return hydrated


def _resolve_persistence_session_id(body: ChatRequest) -> str | None:
    if body.persistence_session_id:
        return body.persistence_session_id
    context = body.learning_context if isinstance(body.learning_context, dict) else {}
    raw = context.get("aiSessionId") or context.get("ai_session_id")
    return str(raw).strip() if raw else None


def _ensure_persistence_session(
    body: ChatRequest, session_id: str | None, user_message: str
) -> str:
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
    attachments: list[dict[str, Any]] | None = None,
) -> None:
    persisted_attachments = _sanitize_attachments_for_persistence(attachments)
    if not content.strip() and not persisted_attachments:
        return
    with session_scope() as db:
        create_ai_message(
            db,
            session_id=session_id,
            role=role,
            content=content.strip() or "[附件]",
            user_id=body.user_id or "anonymous",
            content_type="text",
            capability=capability,
            model_name=body.model,
            request_id=f"{request_id}:{role}",
            attachments=persisted_attachments,
        )


def _sse_event(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _sse_comment(text: str) -> str:
    return f": {text}\n\n"


def _heartbeat_event(request_id: str) -> dict[str, Any]:
    return {
        "type": "heartbeat",
        "data": {
            "request_id": request_id,
            "ts": int(time.time() * 1000),
        },
    }


async def _stream_engine_events_with_heartbeat(
    engine_stream: AsyncGenerator[dict[str, Any], None],
    *,
    heartbeat_interval: float,
) -> AsyncGenerator[dict[str, Any] | None, None]:
    pending_next: asyncio.Task[dict[str, Any]] | None = None
    try:
        while True:
            if pending_next is None:
                pending_next = asyncio.create_task(anext(engine_stream))
            try:
                done, _pending = await asyncio.wait(
                    {pending_next},
                    timeout=heartbeat_interval,
                    return_when=asyncio.FIRST_COMPLETED,
                )
            except Exception:
                if pending_next is not None:
                    pending_next.cancel()
                raise

            if not done:
                yield None
                continue

            try:
                event = pending_next.result()
            except StopAsyncIteration:
                return
            finally:
                pending_next = None

            yield event
    finally:
        if pending_next is not None and not pending_next.done():
            if pending_next is not None:
                pending_next.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await pending_next
        with contextlib.suppress(Exception):
            await engine_stream.aclose()


def _already_streamed_result(assistant_text: str, result_content: str) -> bool:
    streamed = assistant_text.strip()
    result = result_content.strip()
    return bool(streamed and result and streamed.endswith(result))


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
        "auto": "智能路由",
        "visual_solve_fast": "拍题快答",
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
        "visual_fast": VISUAL_SOLVE_FAST_CAPABILITY,
        "visual_solve": VISUAL_SOLVE_FAST_CAPABILITY,
        "question": "deep_solve",
        "solve": "deep_solve",
        "research": "deep_research",
        "animator": "math_animator",
        "math": "math_animator",
    }
    return aliases.get(raw, raw)


def _effective_chat_route(
    requested_mode: str,
    capability: str,
    attachments: list[dict[str, Any]],
    *,
    has_problem_context: bool = False,
    user_message: str = "",
) -> tuple[str, str]:
    has_image = any(item.get("type") == "image" for item in attachments)
    if (has_image or has_problem_context) and capability in {
        "chat",
        "auto",
        VISUAL_SOLVE_FAST_CAPABILITY,
    }:
        return VISUAL_SOLVE_FAST_CAPABILITY, "fast"
    if capability == VISUAL_SOLVE_FAST_CAPABILITY:
        return VISUAL_SOLVE_FAST_CAPABILITY, "fast"
    if capability == "auto" and _should_emit_long_problem_prelude("auto", user_message):
        return "chat", "fast"
    if capability == "chat" and requested_mode in {"", "auto"}:
        return capability, "fast"
    return capability, requested_mode or "auto"


def _image_problem_attachments(
    attachments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    return [
        item
        for item in attachments
        if item.get("type") == "image"
        and (item.get("sha256") or item.get("object_key") or item.get("objectKey"))
    ]


def _format_context_event(row, *, cache_hit: bool) -> dict[str, Any]:
    data = serialize_problem_context(row)
    return {
        "type": "problem_context",
        "data": {
            "problem_context_id": data["problem_context_id"],
            "sha256": data["sha256"],
            "object_key": data["object_key"],
            "cache_hit": cache_hit,
        },
    }


def _normalize_html_line_breaks(text: str) -> str:
    """Convert HTML line break tags to newlines before Markdown parsing.

    Some LLM outputs use ``<br>`` / ``<br/>`` / ``<br />`` instead of actual
    newlines. Without normalization the backend block extractors treat the
    entire content as a single line, producing one huge markdown block that
    duplicates or misaligns the rendered answer.
    """
    return (
        text.replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("<p>", "\n")
        .replace("</p>", "\n")
    )


def _extract_math_blocks(
    markdown: str, *, request_id: str, limit: int = 12
) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    normalized = _normalize_html_line_breaks(markdown)
    patterns = [
        re.compile(r"\$\$(.*?)\$\$", re.DOTALL),
        re.compile(r"\\\[(.*?)\\\]", re.DOTALL),
    ]
    for pattern in patterns:
        for match in pattern.finditer(normalized):
            content = match.group(1).strip()
            if not content:
                continue
            blocks.append(
                {
                    "type": "math_block",
                    "data": {
                        "id": f"{request_id}-math-{len(blocks)}",
                        "index": len(blocks),
                        "content": content,
                        "messageId": request_id,
                    },
                }
            )
            if len(blocks) >= limit:
                return blocks
    return blocks


def _answer_block_event(
    *,
    request_id: str,
    index: int,
    block_type: str,
    content: str,
    display: bool | None = None,
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": f"{request_id}-block-{index}",
        "index": index,
        "type": block_type,
        "content": content.strip(),
        "messageId": request_id,
    }
    if display is not None:
        data["display"] = display
    return {"type": "answer_block", "data": data}


def _answer_component_event(
    *,
    request_id: str,
    index: int,
    kind: str,
    content: str | None = None,
    title: str | None = None,
    block: dict[str, Any] | None = None,
    render_type: str | None = None,
    output_mode: str | None = None,
    artifacts: list[dict[str, Any]] | None = None,
    code: dict[str, Any] | None = None,
    status: str = "done",
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": f"{request_id}-component-{index}",
        "index": index,
        "kind": kind,
        "messageId": request_id,
        "status": status,
    }
    if title:
        data["title"] = title
    if content is not None:
        data["content"] = content.strip()
    if block is not None:
        data["block"] = block
    if render_type:
        data["renderType"] = render_type
    if output_mode:
        data["outputMode"] = output_mode
    if artifacts:
        data["artifacts"] = artifacts
    if code:
        data["code"] = code
    return {"type": "answer_component", "data": data}


def _markdown_title(markdown: str) -> str | None:
    for line in markdown.splitlines():
        stripped = line.strip()
        heading = re.match(r"^#{1,6}\s+(.+)$", stripped)
        if heading:
            return heading.group(1).strip("* ").strip()[:80]
        bold = re.match(r"^\*\*(.+?)\*\*", stripped)
        if bold:
            return bold.group(1).strip()[:80]
    return None


def _callout_variant(markdown: str) -> tuple[str, str] | None:
    preview = markdown.strip()[:120]
    if not preview:
        return None
    if re.search(r"(易错|误区|注意|陷阱|不要)", preview):
        return ("common_pitfall", "易错提醒")
    if re.search(r"(关键|核心|要点|结论|因此|所以)", preview):
        return ("key_idea", "关键结论")
    if re.search(r"(总结|回顾|归纳)", preview):
        return ("summary", "总结")
    if re.search(r"(提示|技巧|建议)", preview):
        return ("tip", "提示")
    return None


def _component_block_from_markdown(
    *,
    request_id: str,
    index: int,
    markdown: str,
) -> dict[str, Any]:
    callout = _callout_variant(markdown)
    if callout and len(markdown) <= 900:
        variant, label = callout
        return {
            "id": f"{request_id}-component-block-{index}",
            "type": "callout",
            "title": label,
            "status": "done",
            "content": markdown.strip(),
            "payload": {
                "variant": variant,
                "label": label,
                "body": markdown.strip(),
            },
        }
    return {
        "id": f"{request_id}-component-block-{index}",
        "type": "text",
        "title": _markdown_title(markdown),
        "status": "done",
        "content": markdown.strip(),
        "payload": {"body": markdown.strip()},
    }


def _answer_components_from_answer_blocks(
    block_events: list[dict[str, Any]],
    *,
    request_id: str,
    limit: int = MAX_ANSWER_COMPONENTS,
) -> list[dict[str, Any]]:
    components: list[dict[str, Any]] = []
    for event in block_events:
        if len(components) >= limit:
            break
        data = event.get("data") or {}
        block_type = data.get("type")
        content = str(data.get("content") or "").strip()
        if not content:
            continue
        index = int(data.get("index") or len(components))
        if block_type == "math":
            components.append(
                _answer_component_event(
                    request_id=request_id,
                    index=index,
                    kind="math",
                    content=content,
                )
            )
            continue
        callout = _callout_variant(content)
        if callout:
            components.append(
                _answer_component_event(
                    request_id=request_id,
                    index=index,
                    kind="live_block",
                    title=_markdown_title(content),
                    content=content,
                    block=_component_block_from_markdown(
                        request_id=request_id,
                        index=index,
                        markdown=content,
                    ),
                )
            )
        else:
            components.append(
                _answer_component_event(
                    request_id=request_id,
                    index=index,
                    kind="markdown",
                    title=_markdown_title(content),
                    content=content,
                )
            )
    return components


def _answer_component_from_capability_result(
    event: dict[str, Any],
    *,
    request_id: str,
) -> dict[str, Any] | None:
    if event.get("type") != "capability_result":
        return None
    data = event.get("data") or {}
    code = data.get("code") if isinstance(data.get("code"), dict) else None
    artifacts = data.get("artifacts") if isinstance(data.get("artifacts"), list) else []
    if artifacts:
        return _answer_component_event(
            request_id=request_id,
            index=9000,
            kind="animation",
            title="动态演示",
            content=str(data.get("content") or ""),
            output_mode=str(data.get("output_mode") or ""),
            artifacts=artifacts,
            code=code,
        )
    render_type = str(data.get("render_type") or "").strip()
    if render_type and code:
        return _answer_component_event(
            request_id=request_id,
            index=9000,
            kind="visualization",
            title="可视化",
            content=str(data.get("content") or ""),
            render_type=render_type,
            code=code,
        )
    return None


def _extract_answer_blocks(
    markdown: str,
    *,
    request_id: str,
    limit: int = MAX_ANSWER_BLOCKS,
) -> list[dict[str, Any]]:
    """Split final markdown into renderable blocks without changing content."""
    blocks: list[dict[str, Any]] = []
    text_lines: list[str] = []
    lines = _normalize_html_line_breaks(markdown).splitlines()
    i = 0

    def flush_text() -> None:
        nonlocal text_lines
        content = "\n".join(text_lines).strip()
        text_lines = []
        if not content or len(blocks) >= limit:
            return
        blocks.append(
            _answer_block_event(
                request_id=request_id,
                index=len(blocks),
                block_type="markdown",
                content=content,
            )
        )

    while i < len(lines) and len(blocks) < limit:
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("```") or stripped.startswith("~~~"):
            fence = stripped[:3]
            text_lines.append(line)
            i += 1
            while i < len(lines):
                text_lines.append(lines[i])
                if lines[i].strip().startswith(fence):
                    i += 1
                    break
                i += 1
            continue

        if stripped.startswith("$$"):
            flush_text()
            formula_lines: list[str] = []
            first = stripped[2:]
            if first.endswith("$$") and len(first) > 2:
                formula = first[:-2].strip()
                if formula:
                    blocks.append(
                        _answer_block_event(
                            request_id=request_id,
                            index=len(blocks),
                            block_type="math",
                            content=formula,
                            display=True,
                        )
                    )
                i += 1
                continue
            if first:
                formula_lines.append(first)
            i += 1
            while i < len(lines):
                current = lines[i].strip()
                if current.endswith("$$"):
                    tail = current[:-2].strip()
                    if tail:
                        formula_lines.append(tail)
                    i += 1
                    break
                formula_lines.append(lines[i])
                i += 1
            formula = "\n".join(formula_lines).strip()
            if formula and len(blocks) < limit:
                blocks.append(
                    _answer_block_event(
                        request_id=request_id,
                        index=len(blocks),
                        block_type="math",
                        content=formula,
                        display=True,
                    )
                )
            continue

        if stripped.startswith("\\["):
            flush_text()
            formula_lines = [stripped[2:]]
            if stripped.endswith("\\]") and len(stripped) > 2:
                formula_lines = [stripped[2:-2]]
                i += 1
            else:
                i += 1
                while i < len(lines):
                    current = lines[i].strip()
                    if current.endswith("\\]"):
                        formula_lines.append(current[:-2])
                        i += 1
                        break
                    formula_lines.append(lines[i])
                    i += 1
            formula = "\n".join(formula_lines).strip()
            if formula and len(blocks) < limit:
                blocks.append(
                    _answer_block_event(
                        request_id=request_id,
                        index=len(blocks),
                        block_type="math",
                        content=formula,
                        display=True,
                    )
                )
            continue

        if stripped == "":
            # Blank lines separate blocks so that HTML ``<br><br>`` (which is
            # normalized to ``\n\n``) does not collapse into one giant block.
            if text_lines:
                flush_text()
            i += 1
            continue

        # New headings or numbered bold step titles start a fresh markdown block.
        if text_lines and (
            re.match(r"^#{1,6}\s+", stripped)
            or re.match(r"^\*\*\s*(?:\d+[.、]|步骤|Step\b)", stripped, re.I)
        ):
            flush_text()
        text_lines.append(line)
        i += 1

    flush_text()
    return blocks


class _StepStreamProjector:
    """Emit coarse step events alongside legacy text deltas."""

    def __init__(self, *, request_id: str, capability: str) -> None:
        self.request_id = request_id
        self.capability = capability
        self.current_index = -1
        self.current_id = ""
        self.started = False

    @staticmethod
    def _title_from_chunk(chunk: str, fallback_index: int) -> str:
        stripped = chunk.strip()
        for line in stripped.splitlines():
            line = line.strip()
            if not line:
                continue
            heading = re.match(r"^#{1,6}\s+(.+)$", line)
            if heading:
                return heading.group(1).strip()[:80]
            bold_step = re.match(
                r"^\*\*\s*((?:\d+[.、]\s*)?(?:步骤|Step|解题|推导|证明)[^*：:]{0,50})[:：]?\s*\*\*",
                line,
                re.I,
            )
            if bold_step:
                return bold_step.group(1).strip()[:80]
            numbered = re.match(r"^(\d+[.、]\s+.{1,70})$", line)
            if numbered:
                return numbered.group(1).strip()[:80]
            break
        return f"解题步骤 {fallback_index + 1}"

    @staticmethod
    def _looks_like_new_step(chunk: str) -> bool:
        stripped = chunk.lstrip()
        if not stripped:
            return False
        return bool(
            re.match(r"^#{1,6}\s+", stripped)
            or re.match(
                r"^\*\*\s*(?:\d+[.、]\s*)?(?:步骤|Step|解题|推导|证明)", stripped, re.I
            )
            or re.match(r"^\d+[.、]\s+", stripped)
        )

    def push(self, chunk: str) -> list[dict[str, Any]]:
        if not chunk:
            return []
        events: list[dict[str, Any]] = []
        if not self.started or self._looks_like_new_step(chunk):
            if self.started:
                events.append(
                    {
                        "type": "step_done",
                        "data": {
                            "id": self.current_id,
                            "index": self.current_index,
                            "messageId": self.request_id,
                            "capability": self.capability,
                        },
                    }
                )
            self.started = True
            self.current_index += 1
            self.current_id = f"{self.request_id}-step-{self.current_index}"
            events.append(
                {
                    "type": "step_start",
                    "data": {
                        "id": self.current_id,
                        "index": self.current_index,
                        "title": self._title_from_chunk(chunk, self.current_index),
                        "messageId": self.request_id,
                        "capability": self.capability,
                    },
                }
            )
        events.append(
            {
                "type": "step_delta",
                "data": {
                    "id": self.current_id,
                    "index": self.current_index,
                    "content": chunk,
                    "messageId": self.request_id,
                    "capability": self.capability,
                },
            }
        )
        return events

    def finish(self) -> list[dict[str, Any]]:
        if not self.started:
            return []
        return [
            {
                "type": "step_done",
                "data": {
                    "id": self.current_id,
                    "index": self.current_index,
                    "messageId": self.request_id,
                    "capability": self.capability,
                },
            }
        ]


def _native_step_events_from_engine_event(
    engine_event: dict[str, Any],
    *,
    request_id: str,
    capability: str,
) -> list[dict[str, Any]]:
    metadata = engine_event.get("metadata")
    if not isinstance(metadata, dict):
        return []
    step_event = str(metadata.get("step_event") or "")
    step_id = str(metadata.get("step_id") or "")
    if not step_event or not step_id:
        return []
    try:
        index = int(metadata.get("step_index", 0))
    except (TypeError, ValueError):
        index = 0
    content = str(engine_event.get("content") or "")
    title = str(metadata.get("step_title") or f"解题步骤 {index + 1}")
    events: list[dict[str, Any]] = []
    if step_event in {"start", "start_delta"}:
        events.append(
            {
                "type": "step_start",
                "data": {
                    "id": f"{request_id}-{step_id}",
                    "index": index,
                    "title": title,
                    "messageId": request_id,
                    "native": True,
                    "capability": capability,
                },
            }
        )
    if step_event in {"delta", "start_delta"} and content:
        events.append(
            {
                "type": "step_delta",
                "data": {
                    "id": f"{request_id}-{step_id}",
                    "index": index,
                    "content": content,
                    "messageId": request_id,
                    "native": True,
                    "capability": capability,
                },
            }
        )
    if step_event == "done":
        events.append(
            {
                "type": "step_done",
                "data": {
                    "id": f"{request_id}-{step_id}",
                    "index": index,
                    "messageId": request_id,
                    "native": True,
                    "capability": capability,
                },
            }
        )
    return events


def _problem_type_from_message(user_message: str) -> str | None:
    text = user_message.lower()
    if any(token in text for token in ["几何", "geometry", "图形", "证明"]):
        return "geometry"
    if any(token in text for token in ["函数", "方程", "代数"]):
        return "math"
    return None


def _trace_log(request_id: str, phase: str, **fields: Any) -> None:
    details = " ".join(
        f"{key}={value}"
        for key, value in fields.items()
        if value is not None and value != ""
    )
    if details:
        logger.info("[trace] request_id=%s phase=%s %s", request_id, phase, details)
    else:
        logger.info("[trace] request_id=%s phase=%s", request_id, phase)


def _resolve_chat_model(
    requested_model: str | None,
    capability: str,
    attachments_for_engine: list[dict[str, Any]],
) -> str:
    selected_model = resolve_request_model(requested_model, capability)
    model_def = get_model_definition(selected_model)
    if model_def is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "INVALID_MODEL",
                "message": f"Unsupported model: {selected_model}",
                "model": selected_model,
                "capability": capability,
            },
        )

    requires_vision = any(
        item.get("type") == "image" for item in attachments_for_engine
    )
    if requires_vision and not model_def.supports_vision:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "MODEL_CAPABILITY_MISMATCH",
                "message": f"Model '{selected_model}' does not support vision inputs",
                "model": selected_model,
                "capability": capability,
                "requires_vision": True,
            },
        )

    return selected_model


def _record_document_learning(
    user_id, session_id, user_message, document_ids, referenced_chunks
):
    """在 chat 完成后记录文档使用和困难信号到记忆系统。"""
    if not session_id:
        return
    confusion_signals = [
        "不懂",
        "不理解",
        "还是不会",
        "没懂",
        "不会做",
        "不知道怎么",
        "再讲一遍",
    ]
    has_confusion = any(p in user_message for p in confusion_signals)
    try:
        with session_scope() as db:
            event = LearningEvent(
                user_id=user_id,
                event_type="document_qa" if document_ids else "chat",
                session_id=session_id,
                payload={
                    "document_ids": document_ids or [],
                    "referenced_chunks": referenced_chunks or [],
                    "user_message": user_message[:300],
                    "has_confusion": has_confusion,
                },
                weight=1.5 if has_confusion else 1.0,
            )
            db.add(event)
            if has_confusion and document_ids:
                create_memory(
                    db,
                    user_id=user_id,
                    memory_type=MEMORY_TYPE_NOTE,
                    content=f"文档问答中遇到困难: {user_message[:150]}",
                    source_session_id=session_id,
                    importance=3,
                )
            db.flush()
    except Exception:
        pass


def create_ai_chat_router(
    settings: Settings,
    storage: ObjectStorage | None = None,
) -> APIRouter:
    router = APIRouter(tags=["ai-chat"])

    @router.post("/v1/ai/chat")
    async def ai_chat(
        request: Request,
        body: ChatRequest,
        authorization: str | None = Header(default=None),
    ) -> StreamingResponse:
        require_token(settings, authorization)

        request_id = (
            body.request_id
            or getattr(request.state, "request_id", None)
            or f"chat-{body.user_id}-{int(time.time() * 1000)}"
        )
        request.state.request_id = request_id
        capability = _normalize_capability(body.capability)

        # Build messages from request, extracting attachments from multimodal content
        messages = []
        # 合并两种来源的附件：新版 body.attachments + 旧版消息文本正则提取
        attachments: list[dict[str, Any]] = list(body.attachments or [])
        for msg in body.messages:
            content = msg.content
            if isinstance(content, list):
                text_parts: list[str] = []
                for part in content:
                    if part.get("type") == "text":
                        text_parts.append(part.get("text", ""))
                    elif part.get("type") == "image_url":
                        url = part.get("image_url", {}).get("url", "")
                        if url:
                            # Extract base64 data from data URL
                            base64_data = ""
                            mime_type = "image/jpeg"
                            if url.startswith("data:"):
                                # Format: data:image/jpeg;base64,xxxx
                                header, _, encoded = url.partition(",")
                                if ";base64" in header:
                                    base64_data = encoded
                                    mime_part = header[len("data:") :].split(";")[0]
                                    if mime_part:
                                        mime_type = mime_part
                            attachments.append(
                                {
                                    "type": "image",
                                    "base64": base64_data,
                                    "mime_type": mime_type,
                                    "filename": f"image_{len(attachments)}.{mime_type.split('/')[-1]}",
                                }
                            )
                content = "".join(text_parts)
            # 提取文件附件标记
            content, file_attachments = _extract_file_attachments(content)
            attachments.extend(file_attachments)
            messages.append({"role": msg.role, "content": content})

        user_message = messages[-1]["content"] if messages else ""
        conversation_history = messages[:-1] if len(messages) > 1 else []

        # 去重 + 校验附件数量和大小
        attachments = _dedup_attachments(attachments)
        _validate_attachments(attachments)

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
                    attachments=attachments,
                )

        async def event_generator() -> AsyncGenerator[str, None]:
            stream_started_at = time.time()
            stage_started_at = stream_started_at
            heartbeat_interval = 10.0
            last_heartbeat = time.time()
            heartbeat_count = 0
            session_started = False
            assistant_text = ""
            truncated_reason: str | None = None
            hydrate_ms: int | None = None
            problem_context_lookup_ms: int | None = None
            vision_cache_write_ms: int | None = None
            image_count = sum(1 for item in attachments if item.get("type") == "image")
            file_count = sum(1 for item in attachments if item.get("type") == "file")
            initial_capability, _initial_mode = _effective_chat_route(
                body.mode,
                capability,
                attachments,
                user_message=user_message,
            )

            def _stage_elapsed() -> float:
                nonlocal stage_started_at
                now = time.time()
                elapsed = now - stage_started_at
                stage_started_at = now
                return elapsed

            logger.info(
                "[STAGE-0-recv] 收到请求 request_id=%s capability=%s routed_capability=%s images=%d files=%d msg_len=%d elapsed=%.0fms",
                request_id,
                capability,
                initial_capability,
                image_count,
                file_count,
                len(user_message),
                (time.time() - stream_started_at) * 1000,
            )
            _stage_elapsed()
            _trace_log(
                request_id,
                "stream_start",
                capability=capability,
                routed_capability=initial_capability,
                image_count=image_count,
                file_count=file_count,
            )
            if image_count or file_count:
                yield _sse_event(
                    {
                        "type": "upload_status",
                        "data": {
                            "status": "ready",
                            "attachment_count": image_count + file_count,
                            "image_count": image_count,
                            "file_count": file_count,
                        },
                    }
                )
                yield _sse_event(
                    {
                        "type": "agent_start",
                        "data": {
                            "messageId": request_id,
                            "agentId": initial_capability,
                            "agentName": "AI导师",
                        },
                    }
                )
                session_started = True
                yield _sse_event(
                    {
                        "type": "thinking",
                        "data": {
                            "stage": "attachment",
                            "agentId": initial_capability,
                            "reasoning": "正在读取图片和问题...\n"
                            if image_count
                            else "正在读取附件和问题...\n",
                        },
                    }
                )

            hydrate_started_at = time.time()
            logger.info(
                "[STAGE-1-hydrate] 开始水合附件 request_id=%s count=%d",
                request_id,
                len(attachments),
            )
            hydrated_attachments = _hydrate_attachment_refs(attachments, storage)
            hydrate_ms = int((time.time() - hydrate_started_at) * 1000)
            if hydrated_attachments:
                logger.info(
                    "[STAGE-1-hydrate] 附件水合完成 request_id=%s count=%d ms=%d elapsed=%.0fms",
                    request_id,
                    len(hydrated_attachments),
                    hydrate_ms,
                    _stage_elapsed() * 1000,
                )
            else:
                _stage_elapsed()
            _trace_log(
                request_id,
                "hydrate",
                attachment_count=len(hydrated_attachments),
                ms=hydrate_ms,
            )

            # 提取文件附件的文本内容
            processed_attachments = _process_file_attachments(hydrated_attachments)

            # 检查水合失败的附件，向客户端发出警告
            _hydration_errors = _hydration_error_filenames(hydrated_attachments)
            if _hydration_errors:
                logger.warning(
                    "[ai_chat] %d attachment(s) failed to hydrate: %s",
                    len(_hydration_errors),
                    _hydration_errors,
                )
                yield _sse_event(
                    {
                        "type": "upload_status",
                        "data": {
                            "status": "hydration_failed",
                            "message": f"以下附件加载失败，AI 将无法看到它们: {', '.join(_hydration_errors)}",
                            "filenames": _hydration_errors,
                        },
                    }
                )

            # 水合后单附件 + 总量检查
            _total_b64_bytes = 0
            for _att in hydrated_attachments:
                _b64 = _att.get("base64", "")
                if not _b64:
                    continue
                _raw = len(_b64) * 3 // 4
                _total_b64_bytes += _raw
                _limit = (
                    MAX_SINGLE_IMAGE_BYTES
                    if _att.get("type") == "image"
                    else MAX_SINGLE_FILE_BYTES
                )
                if _raw > _limit:
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "error_code": "ATTACHMENT_TOO_LARGE",
                            "message": f"附件 '{_att.get('filename', '?')}' 水合后大小 {_raw // (1024 * 1024)}MB，超过 {_limit // (1024 * 1024)}MB 限制",
                        },
                    )
            if _total_b64_bytes > MAX_TOTAL_ATTACHMENT_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error_code": "TOTAL_ATTACHMENTS_TOO_LARGE",
                        "message": f"附件水合后总大小 {_total_b64_bytes // (1024 * 1024)}MB，超过 {MAX_TOTAL_ATTACHMENT_BYTES // (1024 * 1024)}MB 限制",
                    },
                )

            problem_context = None
            problem_context_cache_hit = False
            problem_context_prompt = ""
            cached_problem_sha: str | None = None
            image_problem_attachments = _image_problem_attachments(
                processed_attachments
            )
            if image_problem_attachments or body.problem_context_id:
                lookup_started_at = time.time()
                logger.info(
                    "[STAGE-2-context] 开始题目上下文查询 request_id=%s image_attachments=%d problem_context_id=%s",
                    request_id,
                    len(image_problem_attachments),
                    body.problem_context_id,
                )
                yield _sse_event(
                    {
                        "type": "vision_status",
                        "data": {
                            "status": "cache_lookup",
                            "cache_hit": False,
                            "message": "正在检查题目视觉缓存",
                        },
                    }
                )
                with session_scope() as db:
                    user_id = body.user_id or "anonymous"
                    if body.problem_context_id:
                        problem_context = get_problem_context_by_id(
                            db,
                            body.problem_context_id,
                            user_id=user_id,
                        )
                    if problem_context is None:
                        for image_att in image_problem_attachments:
                            problem_context = get_problem_context_by_sha(
                                db,
                                str(image_att.get("sha256") or ""),
                                user_id=user_id,
                            )
                            if problem_context is not None:
                                break
                    if problem_context is not None:
                        problem_context_cache_hit = True
                        cached_problem_sha = problem_context.sha256
                        problem_context_prompt = format_problem_context_for_prompt(
                            problem_context
                        )
                        yield _sse_event(
                            {
                                "type": "vision_status",
                                "data": {
                                    "status": "cache_hit",
                                    "cache_hit": True,
                                    "problem_context_id": problem_context.id,
                                    "message": "已复用题目视觉上下文",
                                },
                            }
                        )
                        yield _sse_event(
                            _format_context_event(problem_context, cache_hit=True)
                        )
                    elif image_problem_attachments:
                        yield _sse_event(
                            {
                                "type": "vision_status",
                                "data": {
                                    "status": "processing",
                                    "cache_hit": False,
                                    "message": "正在进行首次图片理解",
                                },
                            }
                        )
                problem_context_lookup_ms = int(
                    (time.time() - lookup_started_at) * 1000
                )
                logger.info(
                    "[STAGE-2-context] 题目上下文查询完成 request_id=%s cache_hit=%s image_count=%d ms=%d elapsed=%.0fms",
                    request_id,
                    problem_context_cache_hit,
                    len(image_problem_attachments),
                    problem_context_lookup_ms,
                    _stage_elapsed() * 1000,
                )
                _trace_log(
                    request_id,
                    "problem_context_lookup",
                    cache_hit=problem_context_cache_hit,
                    image_count=len(image_problem_attachments),
                    ms=problem_context_lookup_ms,
                )
            else:
                _stage_elapsed()

            # 构建文件上下文（安全格式）并记录日志
            file_context, extraction_logs = format_attachments_for_context(
                processed_attachments
            )
            for log_line in extraction_logs:
                logger.info(log_line)

            logger.info(
                "[STAGE-3-files] 文件附件处理完成 request_id=%s file_context_len=%d document_refs=%d elapsed=%.0fms",
                request_id,
                len(file_context),
                len(body.document_refs or []),
                _stage_elapsed() * 1000,
            )

            # ── Document Store：存储新附件，恢复已缓存的文档 ──
            doc_store = get_document_store()
            new_document_ids: list[str] = []
            extraction_results: list[dict[str, Any]] = []

            for att in processed_attachments:
                base64_data = att.get("base64", "")
                fname = att.get("filename", "")
                mime = att.get("mime_type", "")
                extracted = att.get("extracted_text", "")
                info = att.get("extraction_info", {})
                err = att.get("extraction_error", "")

                # 构建提取结果摘要
                if extracted:
                    extraction_results.append(
                        {
                            "filename": fname,
                            "status": "success",
                            "text_length": info.get("total_chars", 0),
                            "truncated": info.get("truncated", False),
                        }
                    )
                elif err and att.get("type") == "image":
                    extraction_results.append(
                        {
                            "filename": fname,
                            "status": "image",
                            "note": "图片将交由视觉模型处理",
                        }
                    )
                elif err:
                    extraction_results.append(
                        {
                            "filename": fname,
                            "status": "failed",
                            "error": err,
                        }
                    )

                # 存储文档（仅对有提取内容的文件类型）
                if base64_data and extracted:
                    chunks = (
                        [c.text for c in info.get("chunks", [])]
                        if "chunks" in info
                        else [extracted]
                    )
                    raw_meta = info.get("metadata", {})
                    chunk_meta = (
                        [
                            {
                                "page": c.get("page", 0)
                                or raw_meta.get("page_count", 0),
                                "source": c.get("source", ""),
                            }
                            for c in info.get("chunks", [])
                        ]
                        if "chunks" in info
                        else []
                    )
                    # 对 XLSX 额外注入 sheet 信息
                    if raw_meta.get("sheets"):
                        for cm in chunk_meta:
                            for sh in raw_meta["sheets"]:
                                if sh.get("name"):
                                    cm["sheet_name"] = sh["name"]
                                    cm["row_count"] = sh.get("rows_extracted", 0)
                                    break
                    doc_id = doc_store.store(
                        base64_data=base64_data,
                        filename=fname,
                        mime_type=mime,
                        extracted_text=extracted,
                        chunks=chunks,
                        chunk_metadata=chunk_meta,
                        total_chars=info.get("total_chars", 0),
                        truncated=info.get("truncated", False),
                        metadata=info.get("metadata", {}),
                        owner_id=body.user_id or "anonymous",
                        session_id=persistence_session_id or request_id,
                    )
                    new_document_ids.append(doc_id)
                    att["document_id"] = doc_id

            # 恢复 document_refs 中引用的已缓存文档
            restored_context = ""
            _all_scored_chunks = []
            for ref_id in body.document_refs or []:
                try:
                    doc = doc_store.get(
                        ref_id,
                        owner_id=body.user_id or "anonymous",
                        session_id=persistence_session_id or request_id,
                    )
                except DocumentAccessError:
                    logger.warning("[ai_chat] 文档 %s 访问被拒绝", ref_id)
                    extraction_results.append(
                        {
                            "filename": "未知",
                            "document_id": ref_id,
                            "status": "forbidden",
                            "error": "无权访问该文档",
                        }
                    )
                    continue

                if doc and doc.extracted_text and doc.chunks:
                    doc_store.touch(ref_id)
                    scored = retrieve_relevant_chunks(
                        user_message,
                        doc.chunks,
                        doc.chunk_metadata,
                        top_k=4,
                        filename=doc.filename,
                        document_id=ref_id,
                    )
                    if scored:
                        _all_scored_chunks.extend(scored)
                        retrieved = format_retrieved_chunks(scored)
                        restored_context += (
                            f"\n\n## 引用文档：{doc.filename}\n{retrieved}"
                        )
                    else:
                        restored_context += f"\n\n## 引用文档：{doc.filename}\n{doc.extracted_text[:5000]}"
                    extraction_results.append(
                        {
                            "filename": doc.filename,
                            "document_id": ref_id,
                            "status": "cached",
                            "note": "已从缓存恢复，通过检索定位相关片段",
                        }
                    )

            # 将恢复的文档上下文与文件上下文合并
            combined_context = (
                file_context + restored_context
                if file_context or restored_context
                else ""
            )
            if problem_context_prompt:
                combined_context = (
                    f"{problem_context_prompt}\n\n{combined_context}"
                    if combined_context
                    else problem_context_prompt
                )

            effective_capability, effective_mode = _effective_chat_route(
                body.mode,
                capability,
                processed_attachments,
                has_problem_context=problem_context is not None,
                user_message=user_message,
            )
            attachments_for_engine = processed_attachments
            if cached_problem_sha:
                attachments_for_engine = [
                    item
                    for item in processed_attachments
                    if not (
                        item.get("type") == "image"
                        and str(item.get("sha256") or "") == cached_problem_sha
                    )
                ]
            selected_model = _resolve_chat_model(
                body.model,
                effective_capability,
                attachments_for_engine,
            )
            body.model = selected_model
            stream_output_limit = _stream_output_limit_for_capability(
                effective_capability
            )
            logger.info(
                "[STAGE-4-route] 路由决策完成 request_id=%s capability=%s mode=%s model=%s max_tokens=%s stream_output_limit=%s problem_context_cache_hit=%s elapsed=%.0fms",
                request_id,
                effective_capability,
                effective_mode,
                selected_model,
                body.max_tokens,
                stream_output_limit,
                problem_context_cache_hit,
                _stage_elapsed() * 1000,
            )
            _trace_log(
                request_id,
                "route",
                capability=effective_capability,
                mode=effective_mode,
                model=selected_model,
                max_tokens=body.max_tokens,
                stream_output_limit=stream_output_limit,
                problem_context_cache_hit=problem_context_cache_hit,
            )
            first_engine_event = True
            first_engine_event_ms: int | None = None
            auto_continuations = 0
            auto_continuation_reasons: list[str] = []
            auto_continuation_limit = _auto_continuation_limit_for_capability(
                effective_capability
            )
            while True:
                pass_started_at = time.time()
                last_engine_activity_at = pass_started_at
                pass_start_chars = len(assistant_text)
                pass_reason: str | None = None

                def _take_remaining_stream_content(content: str) -> str:
                    nonlocal pass_reason
                    if not content:
                        return ""
                    if stream_output_limit <= 0:
                        return content
                    pass_chars = len(assistant_text) - pass_start_chars
                    remaining = max(stream_output_limit - pass_chars, 0)
                    if remaining <= 0:
                        pass_reason = "server_char_limit"
                        return ""
                    if len(content) > remaining:
                        pass_reason = "server_char_limit"
                        return content[:remaining]
                    return content

                if auto_continuations:
                    continuation_message = (
                        "请从上一段回答停止处继续，不要重复已经完成的内容。"
                        "保持同样的格式，直接接着写。"
                    )
                    continuation_history = [
                        *conversation_history,
                        {"role": "user", "content": user_message},
                        {"role": "assistant", "content": assistant_text[-2000:]},
                    ]
                    yield _sse_event(
                        {
                            "type": "thinking",
                            "data": {
                                "stage": "continuation",
                                "agentId": effective_capability,
                                "reasoning": f"回答较长，正在自动续写第 {auto_continuations} 次...\n",
                            },
                        }
                    )
                    _trace_log(
                        request_id,
                        "auto_continuation_start",
                        attempt=auto_continuations,
                        previous_reason=auto_continuation_reasons[-1],
                        current_chars=len(assistant_text),
                    )
                else:
                    continuation_message = user_message
                    continuation_history = conversation_history

                if (
                    auto_continuations == 0
                    and len(assistant_text) == 0
                    and _should_emit_long_problem_prelude(
                        effective_capability,
                        user_message,
                    )
                ):
                    prelude = "我先梳理题目条件并建立解题思路，再给出关键推导。\n\n"
                    assistant_text += prelude
                    yield _sse_event(
                        {
                            "type": "text_delta",
                            "data": {
                                "content": prelude,
                                "messageId": f"assistant-{request_id}",
                            },
                        }
                    )

                engine_stream = stream_capability_via_orchestrator(
                    capability=effective_capability,
                    user_message=continuation_message,
                    conversation_history=continuation_history,
                    session_id=request_id,
                    language="zh",
                    attachments=attachments_for_engine
                    if attachments_for_engine
                    else None,
                    file_context=combined_context if combined_context else None,
                    config_overrides=_runtime_config_overrides(
                        effective_mode,
                        body.max_tokens,
                        selected_model,
                    ),
                )
                logger.info(
                    "[ai_chat] STAGE-5-engine call start request_id=%s pass=%d continuation=%s attachments=%d",
                    request_id,
                    auto_continuations,
                    bool(auto_continuations),
                    len(attachments_for_engine) if attachments_for_engine else 0,
                )
                async for engine_event in _stream_engine_events_with_heartbeat(
                    engine_stream,
                    heartbeat_interval=heartbeat_interval,
                ):
                    if engine_event is None:
                        heartbeat_count += 1
                        yield _sse_event(_heartbeat_event(request_id))
                        last_heartbeat = time.time()
                        if (
                            last_heartbeat - last_engine_activity_at
                            >= _stream_no_content_limit_for_capability(
                                effective_capability
                            )
                        ):
                            pass_reason = "duration"
                            logger.warning(
                                "[ai_chat] STAGE-TIMEOUT-NO-CONTENT request_id=%s capability=%s no_content_secs=%.0fs limit=%.0fs",
                                request_id,
                                effective_capability,
                                last_heartbeat - pass_started_at,
                                _stream_no_content_limit_for_capability(
                                    effective_capability
                                ),
                            )
                            break
                        if (
                            last_heartbeat - pass_started_at
                            >= _stream_duration_limit_for_capability(
                                effective_capability
                            )
                        ):
                            pass_reason = "duration"
                            logger.warning(
                                "[ai_chat] STAGE-TIMEOUT-DURATION request_id=%s capability=%s duration_secs=%.0fs limit=%.0fs",
                                request_id,
                                effective_capability,
                                last_heartbeat - pass_started_at,
                                _stream_duration_limit_for_capability(
                                    effective_capability
                                ),
                            )
                            break
                        continue
                    last_engine_activity_at = time.time()
                    if first_engine_event:
                        first_engine_event = False
                        first_engine_event_ms = int(
                            (time.time() - stream_started_at) * 1000
                        )
                        logger.info(
                            "[ai_chat] STAGE-6-first-event request_id=%s capability=%s model=%s ms=%d elapsed_total=%.0fms",
                            request_id,
                            effective_capability,
                            selected_model,
                            first_engine_event_ms,
                            (time.time() - stream_started_at) * 1000,
                        )
                        _trace_log(
                            request_id,
                            "first_engine_event",
                            capability=effective_capability,
                            model=selected_model,
                            ms=first_engine_event_ms,
                        )
                    transformed = _transform_engine_event(
                        engine_event,
                        request_id,
                        effective_capability,
                        session_started,
                    )
                    if transformed:
                        if transformed.get("type") == "agent_start":
                            session_started = True
                        if transformed.get("type") == "text_delta":
                            content = transformed.get("data", {}).get("content", "")
                            if content:
                                content = _take_remaining_stream_content(content)
                                if not content:
                                    break
                                transformed = {
                                    **transformed,
                                    "data": {
                                        **transformed.get("data", {}),
                                        "content": content,
                                    },
                                }
                                assistant_text += content
                        if transformed.get("type") == "done":
                            metadata = engine_event.get("metadata") or {}
                            done_reason = str(
                                metadata.get("finish_reason")
                                or metadata.get("status")
                                or ""
                            ).lower()
                            if done_reason in {
                                "length",
                                "max_tokens",
                                "max_token",
                                "incomplete",
                            }:
                                pass_reason = "length"
                                break
                            continue
                        # capability_result：先发文本再发结构化数据
                        if transformed.get("type") == "capability_result":
                            result_data = transformed.get("data", {})
                            result_content = result_data.get("content", "")
                            if result_content and not _already_streamed_result(
                                assistant_text,
                                result_content,
                            ):
                                result_content = _take_remaining_stream_content(
                                    result_content
                                )
                                if not result_content:
                                    break
                                text_event = {
                                    "type": "text_delta",
                                    "data": {
                                        "content": result_content,
                                        "messageId": result_data.get("messageId", ""),
                                    },
                                }
                                assistant_text += result_content
                                yield _sse_event(text_event)
                        yield _sse_event(transformed)
                        if pass_reason:
                            break
                        elapsed_pass_s = time.time() - pass_started_at
                        pass_chars = len(assistant_text) - pass_start_chars
                        if stream_output_limit > 0 and pass_chars >= stream_output_limit:
                            pass_reason = "server_char_limit"
                            break
                        if (
                            time.time() - last_engine_activity_at
                            >= _stream_no_content_limit_for_capability(
                                effective_capability
                            )
                        ):
                            pass_reason = "duration"
                            break
                        if elapsed_pass_s >= _stream_duration_limit_for_capability(
                            effective_capability
                        ):
                            pass_reason = "duration"
                            break

                if (
                    pass_reason in {"length", "server_char_limit"}
                    and auto_continuations < auto_continuation_limit
                ):
                    auto_continuations += 1
                    auto_continuation_reasons.append(pass_reason)
                    continue
                truncated_reason = pass_reason
                if pass_reason:
                    auto_continuation_reasons.append(pass_reason)
                break

            if truncated_reason == "server_char_limit":
                assistant_text = (
                    assistant_text.rstrip()
                    + "\n\n[回答超过服务端单次输出保护限制，已暂停。]"
                )
            elif truncated_reason == "duration":
                assistant_text = (
                    assistant_text.rstrip()
                    if assistant_text.strip()
                    else "本次回答耗时过长，已自动停止。请缩小问题范围后重试。"
                )
                assistant_text += "\n\n[本次回答因耗时过长已停止。]"

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
                    capability=effective_capability,
                )

            if (
                problem_context is None
                and image_problem_attachments
                and assistant_text.strip()
            ):
                first_image = image_problem_attachments[0]
                sha256 = str(first_image.get("sha256") or "").strip()
                object_key = str(
                    first_image.get("object_key") or first_image.get("objectKey") or ""
                ).strip()
                if sha256 and object_key:
                    cache_write_started_at = time.time()
                    with session_scope() as db:
                        problem_context = upsert_problem_context(
                            db,
                            user_id=body.user_id or "anonymous",
                            session_id=persistence_session_id or request_id,
                            object_key=object_key,
                            sha256=sha256,
                            mime_type=str(first_image.get("mime_type") or ""),
                            vision_summary=assistant_text[:12000],
                            model_name=body.model,
                            geometry_context_json={
                                "attachment_metadata": first_image.get("metadata") or {}
                            },
                            problem_type=_problem_type_from_message(user_message),
                        )
                        vision_cache_write_ms = int(
                            (time.time() - cache_write_started_at) * 1000
                        )
                        _trace_log(
                            request_id,
                            "problem_context_write",
                            problem_context_id=problem_context.id,
                            sha256=sha256,
                            ms=vision_cache_write_ms,
                        )
                        yield _sse_event(
                            {
                                "type": "vision_status",
                                "data": {
                                    "status": "cached",
                                    "cache_hit": False,
                                    "problem_context_id": problem_context.id,
                                    "message": "已缓存题目视觉上下文",
                                },
                            }
                        )
                        yield _sse_event(
                            _format_context_event(problem_context, cache_hit=False)
                        )

            if assistant_text.strip():
                finish_reason = truncated_reason or "stop"
                partial = bool(truncated_reason)
                continuation_token = (
                    f"{request_id}:{finish_reason}" if partial else None
                )
                next_prompt_suggestion = (
                    "请从上次停止处继续，不要重复已经完成的步骤。" if partial else None
                )
                yield _sse_event(
                    {
                        "type": "final_markdown",
                        "data": {
                            "content": assistant_text,
                            "messageId": request_id,
                            "finish_reason": finish_reason,
                            "partial": partial,
                            "continuation_token": continuation_token,
                            "next_prompt_suggestion": next_prompt_suggestion,
                            "auto_continuations": auto_continuations,
                            "auto_continuation_reasons": auto_continuation_reasons,
                        },
                    }
                )
                yield _sse_event(
                    {
                        "type": "render_metrics",
                        "data": {
                            "request_id": request_id,
                            "model": selected_model,
                            "capability": effective_capability,
                            "attachment_count": len(processed_attachments),
                            "image_count": image_count,
                            "file_count": file_count,
                            "hydrate_ms": hydrate_ms,
                            "problem_context_lookup_ms": problem_context_lookup_ms,
                            "problem_context_cache_hit": problem_context_cache_hit,
                            "vision_cache_write_ms": vision_cache_write_ms,
                            "first_engine_event_ms": first_engine_event_ms,
                            "heartbeat_count": heartbeat_count,
                            "truncated": bool(truncated_reason),
                            "truncated_reason": truncated_reason,
                            "finish_reason": finish_reason,
                            "partial": partial,
                            "continuation_token": continuation_token,
                            "auto_continuations": auto_continuations,
                            "auto_continuation_reasons": auto_continuation_reasons,
                            "sse_total_ms": int(
                                (time.time() - stream_started_at) * 1000
                            ),
                            "final_markdown_chars": len(assistant_text),
                        },
                    }
                )

            # 发送检索结果（前端展示"已参考"来源）
            if _all_scored_chunks:
                yield _sse_event(
                    {
                        "type": "retrieval_results",
                        "data": {
                            "query": user_message,
                            "chunks": [
                                {
                                    "chunk_id": c.chunk_id,
                                    "filename": c.filename,
                                    "page": c.page,
                                    "sheet_name": c.sheet_name,
                                    "score": round(c.score, 4),
                                    "preview": c.text[:200],
                                }
                                for c in _all_scored_chunks
                            ],
                        },
                    }
                )

            # 发送提取结果摘要
            if extraction_results:
                yield _sse_event(
                    {
                        "type": "extraction_results",
                        "data": {
                            "results": extraction_results,
                            "document_ids": new_document_ids,
                        },
                    }
                )

            # 记录学习信号到记忆系统
            _record_document_learning(
                user_id=body.user_id or "anonymous",
                session_id=persistence_session_id or request_id,
                user_message=user_message,
                document_ids=list(set(new_document_ids + (body.document_refs or []))),
                referenced_chunks=[
                    {
                        "chunk_id": c.chunk_id,
                        "filename": c.filename,
                        "page": c.page,
                        "score": round(c.score, 4),
                    }
                    for c in _all_scored_chunks
                ],
            )
            logger.info(
                "[STAGE-9-done] stream done request_id=%s chars=%d total_ms=%d truncated=%s",
                request_id,
                len(assistant_text),
                int((time.time() - stream_started_at) * 1000),
                truncated_reason or "stop",
            )
            _trace_log(
                request_id,
                "stream_done",
                capability=effective_capability,
                model=body.model,
                chars=len(assistant_text),
                sse_total_ms=int((time.time() - stream_started_at) * 1000),
            )
            yield _sse_event(
                {
                    "type": "done",
                    "data": {
                        "totalActions": 0,
                        "totalAgents": 1,
                        "agentHadContent": bool(assistant_text),
                        "finish_reason": truncated_reason or "stop",
                        "partial": bool(truncated_reason),
                        "auto_continuations": auto_continuations,
                        "continuation_token": (
                            f"{request_id}:{truncated_reason}"
                            if truncated_reason
                            else None
                        ),
                    },
                }
            )
            yield _sse_comment("end")

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
                "X-Request-ID": request_id,
                **(
                    {"X-AI-Session-ID": persistence_session_id}
                    if persistence_session_id
                    else {}
                ),
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
        started_at = time.time()

        messages = []
        attachments_ns: list[dict[str, Any]] = list(body.attachments or [])
        for msg in body.messages:
            content = msg.content
            if isinstance(content, list):
                text_parts: list[str] = []
                for part in content:
                    if part.get("type") == "text":
                        text_parts.append(part.get("text", ""))
                    elif part.get("type") == "image_url":
                        url = part.get("image_url", {}).get("url", "")
                        if url and url.startswith("data:"):
                            header, _, encoded = url.partition(",")
                            if ";base64" in header:
                                mime_part = (
                                    header[len("data:") :].split(";")[0] or "image/jpeg"
                                )
                                attachments_ns.append(
                                    {
                                        "type": "image",
                                        "base64": encoded,
                                        "mime_type": mime_part,
                                        "filename": f"image_{len(attachments_ns)}.{mime_part.split('/')[-1]}",
                                    }
                                )
                content = "".join(text_parts)
            # 提取文件附件标记（非流式）
            content, file_attachments_ns = _extract_file_attachments(content)
            attachments_ns.extend(file_attachments_ns)
            messages.append({"role": msg.role, "content": content})

        user_message = messages[-1]["content"] if messages else ""
        conversation_history = messages[:-1] if len(messages) > 1 else []

        # 去重 + 校验附件数量和大小（非流式）
        attachments_ns = _dedup_attachments(attachments_ns)
        _validate_attachments(attachments_ns)

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
                    attachments=attachments_ns,
                )

        try:
            # 提取文件附件的文本内容（非流式）
            hydrate_started_at_ns = time.time()
            hydrated_attachments_ns = _hydrate_attachment_refs(attachments_ns, storage)
            hydrate_ms_ns = int((time.time() - hydrate_started_at_ns) * 1000)
            processed_attachments_ns = _process_file_attachments(
                hydrated_attachments_ns
            )

            # 检查水合失败的附件，记录警告
            _hydration_errors_ns = _hydration_error_filenames(hydrated_attachments_ns)
            if _hydration_errors_ns:
                logger.warning(
                    "[ai_chat] non-stream: %d attachment(s) failed to hydrate: %s",
                    len(_hydration_errors_ns),
                    _hydration_errors_ns,
                )

            # 水合后单附件 + 总量检查
            _total_b64_bytes_ns = 0
            for _att_ns in hydrated_attachments_ns:
                _b64_ns = _att_ns.get("base64", "")
                if not _b64_ns:
                    continue
                _raw_ns = len(_b64_ns) * 3 // 4
                _total_b64_bytes_ns += _raw_ns
                _limit_ns = (
                    MAX_SINGLE_IMAGE_BYTES
                    if _att_ns.get("type") == "image"
                    else MAX_SINGLE_FILE_BYTES
                )
                if _raw_ns > _limit_ns:
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "error_code": "ATTACHMENT_TOO_LARGE",
                            "message": f"附件 '{_att_ns.get('filename', '?')}' 水合后大小 {_raw_ns // (1024 * 1024)}MB，超过 {_limit_ns // (1024 * 1024)}MB 限制",
                        },
                    )
            if _total_b64_bytes_ns > MAX_TOTAL_ATTACHMENT_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error_code": "TOTAL_ATTACHMENTS_TOO_LARGE",
                        "message": f"附件水合后总大小 {_total_b64_bytes_ns // (1024 * 1024)}MB，超过 {MAX_TOTAL_ATTACHMENT_BYTES // (1024 * 1024)}MB 限制",
                    },
                )

            problem_context_ns = None
            problem_context_cache_hit_ns = False
            problem_context_prompt_ns = ""
            cached_problem_sha_ns: str | None = None
            image_problem_attachments_ns = _image_problem_attachments(
                processed_attachments_ns
            )
            problem_context_lookup_ms_ns: int | None = None
            if image_problem_attachments_ns or body.problem_context_id:
                lookup_started_at_ns = time.time()
                with session_scope() as db:
                    user_id = body.user_id or "anonymous"
                    if body.problem_context_id:
                        problem_context_ns = get_problem_context_by_id(
                            db,
                            body.problem_context_id,
                            user_id=user_id,
                        )
                    if problem_context_ns is None:
                        for image_att in image_problem_attachments_ns:
                            problem_context_ns = get_problem_context_by_sha(
                                db,
                                str(image_att.get("sha256") or ""),
                                user_id=user_id,
                            )
                            if problem_context_ns is not None:
                                break
                    if problem_context_ns is not None:
                        problem_context_cache_hit_ns = True
                        cached_problem_sha_ns = problem_context_ns.sha256
                        problem_context_prompt_ns = format_problem_context_for_prompt(
                            problem_context_ns
                        )
                problem_context_lookup_ms_ns = int(
                    (time.time() - lookup_started_at_ns) * 1000
                )

            # 构建文件上下文（安全格式）—— 与流式路径保持一致
            file_context_ns, _extraction_logs_ns = format_attachments_for_context(
                processed_attachments_ns
            )
            combined_context_ns = file_context_ns if file_context_ns else ""
            if problem_context_prompt_ns:
                combined_context_ns = (
                    f"{problem_context_prompt_ns}\n\n{combined_context_ns}"
                    if combined_context_ns
                    else problem_context_prompt_ns
                )

            effective_capability_ns, effective_mode_ns = _effective_chat_route(
                body.mode,
                capability,
                processed_attachments_ns,
                has_problem_context=problem_context_ns is not None,
                user_message=user_message,
            )
            attachments_for_engine_ns = processed_attachments_ns
            if cached_problem_sha_ns:
                attachments_for_engine_ns = [
                    item
                    for item in processed_attachments_ns
                    if not (
                        item.get("type") == "image"
                        and str(item.get("sha256") or "") == cached_problem_sha_ns
                    )
                ]
            selected_model_ns = _resolve_chat_model(
                body.model,
                effective_capability_ns,
                attachments_for_engine_ns,
            )
            body.model = selected_model_ns
            _trace_log(
                request_id,
                "non_stream_route",
                capability=effective_capability_ns,
                mode=effective_mode_ns,
                model=selected_model_ns,
                max_tokens=body.max_tokens,
                hydrate_ms=hydrate_ms_ns,
                problem_context_lookup_ms=problem_context_lookup_ms_ns,
                problem_context_cache_hit=problem_context_cache_hit_ns,
            )

            async for engine_event in stream_capability_via_orchestrator(
                capability=effective_capability_ns,
                user_message=user_message,
                conversation_history=conversation_history,
                session_id=request_id,
                language="zh",
                attachments=attachments_for_engine_ns
                if attachments_for_engine_ns
                else None,
                file_context=combined_context_ns if combined_context_ns else None,
                config_overrides=_runtime_config_overrides(
                    effective_mode_ns,
                    body.max_tokens,
                    selected_model_ns,
                ),
            ):
                if engine_event.get("type") == "stream":
                    assistant_text += engine_event.get("content", "")
                elif engine_event.get("type") == "result":
                    result_content = engine_event.get("content", "")
                    if result_content:
                        assistant_text = result_content
        except HTTPException:
            raise
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
                capability=effective_capability_ns,
            )

        if (
            problem_context_ns is None
            and image_problem_attachments_ns
            and assistant_text.strip()
        ):
            first_image_ns = image_problem_attachments_ns[0]
            sha256_ns = str(first_image_ns.get("sha256") or "").strip()
            object_key_ns = str(
                first_image_ns.get("object_key")
                or first_image_ns.get("objectKey")
                or ""
            ).strip()
            if sha256_ns and object_key_ns:
                with session_scope() as db:
                    problem_context_ns = upsert_problem_context(
                        db,
                        user_id=body.user_id or "anonymous",
                        session_id=persistence_session_id or request_id,
                        object_key=object_key_ns,
                        sha256=sha256_ns,
                        mime_type=str(first_image_ns.get("mime_type") or ""),
                        vision_summary=assistant_text[:12000],
                        model_name=body.model,
                        geometry_context_json={
                            "attachment_metadata": first_image_ns.get("metadata") or {}
                        },
                        problem_type=_problem_type_from_message(user_message),
                    )

        _trace_log(
            request_id,
            "non_stream_done",
            capability=effective_capability_ns,
            model=body.model,
            chars=len(assistant_text),
            total_ms=int((time.time() - started_at) * 1000),
        )
        result: dict[str, Any] = {
            "success": True,
            "assistant_text": assistant_text,
            "request_id": request_id,
            "session_id": persistence_session_id,
            "problem_context": (
                serialize_problem_context(problem_context_ns)
                if problem_context_ns is not None
                else None
            ),
            "problem_context_cache_hit": problem_context_cache_hit_ns,
        }
        if _hydration_errors_ns:
            result["hydration_errors"] = _hydration_errors_ns
        return result

    return router
