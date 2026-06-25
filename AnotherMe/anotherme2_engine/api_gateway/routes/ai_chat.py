"""
AI Chat SSE Router - Proxies all chat requests to the tutor engine.

All capabilities (chat, deep_solve, research, question, math_animator, visualize)
are routed through the engine's unified capability orchestration layer.
"""

from __future__ import annotations

import json
import logging
import re
import time
import base64
import tempfile
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..chat_service import create_ai_message, create_ai_session, sanitize_attachment_refs
from ..chunk_retriever import format_retrieved_chunks, retrieve_relevant_chunks
from ..config import Settings
from ..db import session_scope
from ..document_store import DocumentAccessError, get_document_store
from ..engine_bridge import stream_capability_via_orchestrator
from ..file_extraction import extract_file_content, format_attachments_for_context
from ..memory_service import MEMORY_TYPE_NOTE, create_memory
from ..models import AIChatSession, LearningEvent
from ..storage import ObjectStorage, guess_content_type
from .auth import require_token

logger = logging.getLogger(__name__)
_ATTACHMENT_REF_CACHE: dict[str, dict[str, Any]] = {}
_ATTACHMENT_REF_CACHE_MAX = 64
VISUAL_SOLVE_FAST_CAPABILITY = "visual_solve_fast"


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


def _sanitize_attachments_for_persistence(
    attachments: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    return sanitize_attachment_refs(attachments)


def _cache_attachment_ref(object_key: str, payload: dict[str, Any]) -> None:
    if not object_key:
        return
    if len(_ATTACHMENT_REF_CACHE) >= _ATTACHMENT_REF_CACHE_MAX:
        oldest_key = next(iter(_ATTACHMENT_REF_CACHE))
        _ATTACHMENT_REF_CACHE.pop(oldest_key, None)
    _ATTACHMENT_REF_CACHE[object_key] = payload


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
            hydrated.append(att)
            continue

        cached = _ATTACHMENT_REF_CACHE.get(object_key)
        if cached:
            hydrated.append({**att, **cached})
            continue

        if storage is None:
            logger.warning("[ai_chat] attachment ref ignored without storage: %s", object_key)
            hydrated.append(att)
            continue

        suffix = ""
        filename = str(att.get("filename") or object_key.rsplit("/", 1)[-1] or "attachment")
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
            logger.warning("[ai_chat] failed to hydrate attachment %s: %s", object_key, exc)
            hydrated.append(att)
            continue
        finally:
            if tmp_path:
                try:
                    Path(tmp_path).unlink(missing_ok=True)
                except Exception:
                    pass

        mime_type = (
            str(att.get("mime_type") or att.get("mimeType") or "").strip()
            or guess_content_type(filename)
        )
        payload = {
            "base64": base64.b64encode(payload_bytes).decode("utf-8"),
            "mime_type": mime_type,
            "filename": filename,
            "object_key": object_key,
            "size": len(payload_bytes),
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
) -> tuple[str, str]:
    has_image = any(item.get("type") == "image" for item in attachments)
    if has_image and capability in {"chat", "auto", VISUAL_SOLVE_FAST_CAPABILITY}:
        return VISUAL_SOLVE_FAST_CAPABILITY, "fast"
    if capability == VISUAL_SOLVE_FAST_CAPABILITY:
        return VISUAL_SOLVE_FAST_CAPABILITY, "fast"
    if capability == "chat" and requested_mode in {"", "auto"}:
        return capability, "fast"
    return capability, requested_mode or "auto"


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

        request_id = body.request_id or f"chat-{body.user_id}-{int(time.time() * 1000)}"
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
            heartbeat_interval = 15.0
            last_heartbeat = time.time()
            session_started = False
            assistant_text = ""
            image_count = sum(1 for item in attachments if item.get("type") == "image")
            file_count = sum(1 for item in attachments if item.get("type") == "file")
            initial_capability, _initial_mode = _effective_chat_route(
                body.mode,
                capability,
                attachments,
            )

            logger.info(
                "[ai_chat] stream start request_id=%s capability=%s routed_capability=%s images=%d files=%d",
                request_id,
                capability,
                initial_capability,
                image_count,
                file_count,
            )
            if image_count or file_count:
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
            hydrated_attachments = _hydrate_attachment_refs(attachments, storage)
            if hydrated_attachments:
                logger.info(
                    "[ai_chat] attachments ready request_id=%s count=%d ms=%d",
                    request_id,
                    len(hydrated_attachments),
                    int((time.time() - hydrate_started_at) * 1000),
                )

            # 提取文件附件的文本内容
            processed_attachments = _process_file_attachments(hydrated_attachments)

            # 构建文件上下文（安全格式）并记录日志
            file_context, extraction_logs = format_attachments_for_context(
                processed_attachments
            )
            for log_line in extraction_logs:
                logger.info(log_line)

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

            effective_capability, effective_mode = _effective_chat_route(
                body.mode,
                capability,
                processed_attachments,
            )
            logger.info(
                "[ai_chat] routing request_id=%s capability=%s mode=%s",
                request_id,
                effective_capability,
                effective_mode,
            )
            first_engine_event = True
            async for engine_event in stream_capability_via_orchestrator(
                capability=effective_capability,
                user_message=user_message,
                conversation_history=conversation_history,
                session_id=request_id,
                language="zh",
                attachments=processed_attachments if processed_attachments else None,
                file_context=combined_context if combined_context else None,
                config_overrides={"mode": effective_mode}
                if effective_mode != "auto"
                else None,
            ):
                if first_engine_event:
                    first_engine_event = False
                    logger.info(
                        "[ai_chat] first engine event request_id=%s ms=%d",
                        request_id,
                        int((time.time() - stream_started_at) * 1000),
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
                            assistant_text += content
                    if transformed.get("type") == "done":
                        continue
                    # capability_result：先发文本再发结构化数据
                    if transformed.get("type") == "capability_result":
                        result_data = transformed.get("data", {})
                        result_content = result_data.get("content", "")
                        if result_content and not _already_streamed_result(
                            assistant_text,
                            result_content,
                        ):
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
                    capability=effective_capability,
                )

            if assistant_text.strip():
                yield _sse_event(
                    {
                        "type": "final_markdown",
                        "data": {
                            "content": assistant_text,
                            "messageId": request_id,
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
                "[ai_chat] stream done request_id=%s chars=%d ms=%d",
                request_id,
                len(assistant_text),
                int((time.time() - stream_started_at) * 1000),
            )
            yield _sse_event(
                {
                    "type": "done",
                    "data": {
                        "totalActions": 0,
                        "totalAgents": 1,
                        "agentHadContent": bool(assistant_text),
                    },
                }
            )
            yield _sse_comment("end")

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
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
            processed_attachments_ns = _process_file_attachments(
                _hydrate_attachment_refs(attachments_ns, storage)
            )
            effective_capability_ns, effective_mode_ns = _effective_chat_route(
                body.mode,
                capability,
                processed_attachments_ns,
            )

            async for engine_event in stream_capability_via_orchestrator(
                capability=effective_capability_ns,
                user_message=user_message,
                conversation_history=conversation_history,
                session_id=request_id,
                language="zh",
                attachments=processed_attachments_ns
                if processed_attachments_ns
                else None,
                config_overrides={"mode": effective_mode_ns}
                if effective_mode_ns != "auto"
                else None,
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
                capability=effective_capability_ns,
            )

        return {
            "success": True,
            "assistant_text": assistant_text,
            "request_id": request_id,
            "session_id": persistence_session_id,
        }

    return router
