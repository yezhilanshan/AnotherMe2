"""
Live Book Engine Gateway Router
===============================

Exposes Tutor Engine's BookEngine to the frontend.  Every endpoint matches
the frontend API contract in ``lib/live-book/api.ts``.

Field names are snake_case (aligned with ``lib/live-book/types.ts``) via the
DTO layer in ``live_book_dto.py``.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from pydantic import BaseModel, Field

from api_gateway.config import Settings
from api_gateway.routes.auth import require_token
from api_gateway.routes.live_book_dto import (
    block_to_dto,
    book_summary_to_dto,
    book_to_dto,
    page_to_dto,
    progress_to_dto,
    proposal_to_dto,
    spine_to_dto,
)

# ── Engine imports ────────────────────────────────────────────────────────
#
# P1 阶段：路由所需的 enum 来自 gateway-owned 的 internal 包；
# 运行时引擎 (get_book_engine / StreamBus) 仍来自 tutor_engine，
# 它们会在 P1.5 完成迁出（见 api_gateway/internal/__init__.py 的迁移计划）。

try:
    from api_gateway.internal.contracts import (
        BlockType,
        ContentType,
        PageStatus,
    )

    _ENUMS_FROM_INTERNAL = True
except Exception:  # pragma: no cover - 防御性回落
    BlockType = ContentType = PageStatus = None  # type: ignore
    _ENUMS_FROM_INTERNAL = False

try:
    from tutor_engine.book import BookProposal, Spine, get_book_engine
    from tutor_engine.book.streaming import SOURCE as BOOK_SOURCE
    from tutor_engine.core.stream_bus import StreamBus

    ENGINE_AVAILABLE = True
    logger = logging.getLogger("live_book.gateway")
except Exception as exc:  # pragma: no cover - 防御性回落
    ENGINE_AVAILABLE = False
    logger = logging.getLogger("live_book.gateway")
    logger.warning("tutor_engine runtime unavailable: %s", exc)
    BOOK_SOURCE = None  # type: ignore
    BookProposal = Spine = None  # type: ignore
    get_book_engine = StreamBus = None  # type: ignore


# ═══════════════════════════════════════════════════════════════════════════
# Request models (aligned with frontend API payloads)
# ═══════════════════════════════════════════════════════════════════════════


class CreateLiveBookRequest(BaseModel):
    topic: str = ""
    language: str = "zh"
    chat_session_id: str = ""
    chat_selections: list[dict[str, Any]] = Field(default_factory=list)
    notebook_refs: list[dict[str, Any]] = Field(default_factory=list)
    knowledge_bases: list[str] = Field(default_factory=list)
    question_categories: list[int] = Field(default_factory=list)
    question_entries: list[int] = Field(default_factory=list)
    sources: list[dict[str, Any]] = Field(default_factory=list)


class ConfirmProposalRequest(BaseModel):
    book_id: str = ""
    proposal: dict[str, Any] | None = None


class ConfirmSpineRequest(BaseModel):
    book_id: str = ""
    spine: dict[str, Any] | None = None
    auto_compile: bool = True


class CompilePageRequest(BaseModel):
    book_id: str = ""
    page_id: str = ""
    force: bool = False


class BlockRequest(BaseModel):
    book_id: str = ""
    page_id: str = ""
    block_id: str = ""
    block_type: str = ""
    params: dict[str, Any] | None = None
    params_override: dict[str, Any] | None = None
    position: int | None = None
    compile_now: bool = False
    new_position: int = -1
    new_type: str = ""


class QuizAttemptRequest(BaseModel):
    book_id: str = ""
    page_id: str = ""
    block_id: str = ""
    question_id: str = ""
    user_answer: str = ""
    is_correct: bool = False
    request_remediation: bool = False


class DeepDiveRequest(BaseModel):
    book_id: str = ""
    parent_page_id: str = ""
    topic: str = ""
    block_id: str = ""
    content_type: str = "concept"


class SupplementRequest(BaseModel):
    book_id: str = ""
    page_id: str = ""
    topic: str = ""


# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════


def _coerce_block_type(name: str) -> BlockType:
    try:
        return BlockType(name)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail={"error_code": "INVALID_BLOCK_TYPE", "message": f"Unknown block type: {name}"}
        ) from exc


def _block_refresh(book_id: str) -> dict[str, Any]:
    """After a block mutation, reload the book + spine + pages and return DTO."""
    engine = get_book_engine()
    book = engine.load_book(book_id)
    spine = engine.load_spine(book_id)
    pages = engine.list_pages(book_id)
    progress = engine.load_progress(book_id)
    return {
        "book": book_to_dto(book) if book else {},
        "spine": spine_to_dto(spine),
        "pages": [page_to_dto(p) for p in pages],
        "progress": progress_to_dto(progress),
    }


# ═══════════════════════════════════════════════════════════════════════════
# Router factory
# ═══════════════════════════════════════════════════════════════════════════


def create_live_book_router(settings: Settings) -> APIRouter:
    router = APIRouter(tags=["live-book"])

    if not ENGINE_AVAILABLE:

        @router.get("/live-book/health")
        async def _health_na():
            return {
                "ok": False,
                "service": "live_book",
                "reason": "engine_not_available",
            }

        return router

    # ── Auth & LLM helpers ───────────────────────────────────────────────

    def _require_auth(request: Request) -> None:
        require_token(settings, request.headers.get("authorization"))

    def _apply_llm_overrides(request: Request) -> None:
        api_key = request.headers.get("x-llm-api-key", "").strip()
        model = request.headers.get("x-llm-model", "").strip()
        base_url = request.headers.get("x-llm-base-url", "").strip()
        changed = False

        if api_key and os.environ.get("LLM_API_KEY") != api_key:
            os.environ["LLM_API_KEY"] = api_key
            changed = True
        if model and os.environ.get("LLM_MODEL") != model:
            os.environ["LLM_MODEL"] = model
            binding = model.split(":")[0] if ":" in model else ""
            if binding and os.environ.get("LLM_BINDING") != binding:
                os.environ["LLM_BINDING"] = binding
            changed = True
        if base_url and os.environ.get("LLM_HOST") != base_url:
            os.environ["LLM_HOST"] = base_url
            changed = True

        if changed:
            from tutor_engine.services.llm.config import clear_llm_config_cache

            clear_llm_config_cache()

    # ── Health ───────────────────────────────────────────────────────────

    @router.get("/live-book/health")
    async def health():
        return {"ok": True, "service": "live_book"}

    # ── Books: list / create ─────────────────────────────────────────────

    @router.get("/live-book/books")
    async def list_books(request: Request) -> dict[str, Any]:
        _require_auth(request)
        engine = get_book_engine()
        return {"books": [book_summary_to_dto(b) for b in engine.list_books()]}

    @router.post("/live-book/books")
    async def create_book(
        request: Request, req: CreateLiveBookRequest
    ) -> dict[str, Any]:
        _require_auth(request)
        _apply_llm_overrides(request)
        if not req.topic.strip():
            raise HTTPException(status_code=400, detail={"error_code": "INVALID_REQUEST", "message": "topic is required"})

        engine = get_book_engine()
        chat_selections: list[dict[str, Any]] = req.chat_selections or []
        notebook_refs: list[dict[str, Any]] = req.notebook_refs or []
        knowledge_bases: list[str] = req.knowledge_bases or []
        question_categories: list[int] = req.question_categories or []
        question_entries: list[int] = req.question_entries or []

        # Support legacy sources field
        if req.sources and not chat_selections and not knowledge_bases:
            for src in req.sources or []:
                kind = src.get("kind")
                if kind == "chat":
                    for sel in src.get("chatSelections") or []:
                        chat_selections.append(
                            {
                                "session_id": sel.get("chatId", ""),
                                "message_ids": [
                                    int(m)
                                    for m in (sel.get("messageIds") or [])
                                    if str(m).isdigit()
                                ],
                            }
                        )
                elif kind == "notes":
                    for ref in src.get("notebookRefs") or []:
                        notebook_refs.append(
                            {"notebook_id": str(ref), "record_ids": []}
                        )
                elif kind == "kb":
                    for kb_id in src.get("kbIds") or []:
                        knowledge_bases.append(str(kb_id))
                elif kind == "question":
                    for qref in src.get("questionRefs") or []:
                        if str(qref).isdigit():
                            question_entries.append(int(qref))

        lang = (
            req.language
            if req.language in ("zh", "en")
            else ("zh" if req.language.startswith("zh") else "en")
        )
        try:
            book, proposal = await engine.create_book(
                user_intent=req.topic,
                chat_session_id=req.chat_session_id or "",
                chat_selections=chat_selections,
                notebook_refs=notebook_refs,
                knowledge_bases=knowledge_bases,
                question_categories=question_categories,
                question_entries=question_entries,
                language=lang,
            )
        except Exception as exc:
            if logger:
                logger.error(f"create_book failed: {exc}", exc_info=True)
            raise HTTPException(status_code=500, detail={"error_code": "BOOK_CREATE_FAILED", "message": str(exc)})

        return {
            "book": book_to_dto(book),
            "proposal": proposal_to_dto(proposal),
        }

    # ── Single book ──────────────────────────────────────────────────────

    @router.get("/live-book/books/{book_id}")
    async def get_book(request: Request, book_id: str) -> dict[str, Any]:
        _require_auth(request)
        engine = get_book_engine()
        book = engine.load_book(book_id)
        if book is None:
            raise HTTPException(status_code=404, detail={"error_code": "BOOK_NOT_FOUND", "message": "Book not found"})
        spine = engine.load_spine(book_id)
        pages = engine.list_pages(book_id)
        progress = engine.load_progress(book_id)
        return {
            "book": book_to_dto(book),
            "spine": spine_to_dto(spine),
            "pages": [page_to_dto(p) for p in pages],
            "progress": progress_to_dto(progress),
        }

    @router.delete("/live-book/books/{book_id}")
    async def delete_book(request: Request, book_id: str) -> dict[str, Any]:
        _require_auth(request)
        engine = get_book_engine()
        ok = engine.delete_book(book_id)
        if not ok:
            raise HTTPException(status_code=404, detail={"error_code": "BOOK_NOT_FOUND", "message": "Book not found"})
        return {"deleted": True, "book_id": book_id}

    @router.get("/live-book/books/{book_id}/spine")
    async def get_spine(request: Request, book_id: str) -> dict[str, Any]:
        _require_auth(request)
        engine = get_book_engine()
        spine = engine.load_spine(book_id)
        if spine is None:
            raise HTTPException(status_code=404, detail={"error_code": "SPINE_NOT_FOUND", "message": "Spine not found"})
        return {"spine": spine_to_dto(spine)}

    @router.get("/live-book/books/{book_id}/pages/{page_id}")
    async def get_page(request: Request, book_id: str, page_id: str) -> dict[str, Any]:
        _require_auth(request)
        engine = get_book_engine()
        page = engine.load_page(book_id, page_id)
        if page is None:
            raise HTTPException(status_code=404, detail={"error_code": "PAGE_NOT_FOUND", "message": "Page not found"})
        return {"page": page_to_dto(page)}

    # ── Proposal / Spine ─────────────────────────────────────────────────

    @router.post("/live-book/books/confirm-proposal")
    async def confirm_proposal(
        request: Request, req: ConfirmProposalRequest
    ) -> dict[str, Any]:
        _require_auth(request)
        _apply_llm_overrides(request)
        engine = get_book_engine()
        edited: BookProposal | None = None
        if req.proposal:
            try:
                edited = BookProposal.model_validate(req.proposal)
            except Exception as exc:
                raise HTTPException(status_code=400, detail={"error_code": "INVALID_PROPOSAL", "message": f"Invalid proposal: {exc}"})
        try:
            book, spine = await engine.confirm_proposal(
                book_id=req.book_id, edited_proposal=edited
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail={"error_code": "NOT_FOUND", "message": str(exc)})
        except Exception as exc:
            if logger:
                logger.error(f"confirm_proposal failed: {exc}", exc_info=True)
            raise HTTPException(status_code=500, detail={"error_code": "CONFIRM_PROPOSAL_FAILED", "message": str(exc)})
        return {
            "book": book_to_dto(book),
            "spine": spine_to_dto(spine),
        }

    @router.post("/live-book/books/confirm-spine")
    async def confirm_spine(
        request: Request, req: ConfirmSpineRequest
    ) -> dict[str, Any]:
        _require_auth(request)
        _apply_llm_overrides(request)
        engine = get_book_engine()
        edited: Spine | None = None
        if req.spine:
            try:
                edited = Spine.model_validate(req.spine)
            except Exception as exc:
                raise HTTPException(status_code=400, detail={"error_code": "INVALID_SPINE", "message": f"Invalid spine: {exc}"})
        try:
            pages = await engine.confirm_spine(
                book_id=req.book_id,
                edited_spine=edited,
                auto_compile=req.auto_compile,
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail={"error_code": "NOT_FOUND", "message": str(exc)})
        except Exception as exc:
            if logger:
                logger.error(f"confirm_spine failed: {exc}", exc_info=True)
            raise HTTPException(status_code=500, detail={"error_code": "CONFIRM_SPINE_FAILED", "message": str(exc)})
        return {"pages": [page_to_dto(p) for p in pages]}

    # ── Compile ──────────────────────────────────────────────────────────

    @router.post("/live-book/books/compile-page")
    async def compile_page(request: Request, req: CompilePageRequest) -> dict[str, Any]:
        _require_auth(request)
        _apply_llm_overrides(request)
        engine = get_book_engine()
        try:
            page = await engine.compile_page(
                book_id=req.book_id, page_id=req.page_id, force=req.force
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail={"error_code": "NOT_FOUND", "message": str(exc)})
        except Exception as exc:
            if logger:
                logger.error(f"compile_page failed: {exc}", exc_info=True)
            raise HTTPException(status_code=500, detail={"error_code": "COMPILE_PAGE_FAILED", "message": str(exc)})
        return {"page": page_to_dto(page)}

    # ── Block operations ─────────────────────────────────────────────────

    @router.post("/live-book/books/regenerate-block")
    async def regenerate_block(request: Request, req: BlockRequest) -> dict[str, Any]:
        _require_auth(request)
        _apply_llm_overrides(request)
        engine = get_book_engine()
        try:
            await engine.regenerate_block(
                book_id=req.book_id, page_id=req.page_id, block_id=req.block_id
            )
        except Exception as exc:
            if logger:
                logger.error(f"regenerate_block failed: {exc}", exc_info=True)
            raise HTTPException(status_code=500, detail={"error_code": "REGENERATE_BLOCK_FAILED", "message": str(exc)})
        return _block_refresh(req.book_id)

    @router.post("/live-book/books/insert-block")
    async def insert_block(request: Request, req: BlockRequest) -> dict[str, Any]:
        _require_auth(request)
        _apply_llm_overrides(request)
        engine = get_book_engine()
        block_type = _coerce_block_type(req.block_type or "text")
        try:
            await engine.insert_block(
                book_id=req.book_id,
                page_id=req.page_id,
                block_type=block_type,
                params=req.params or {},
                compile_now=req.compile_now,
            )
        except Exception as exc:
            if logger:
                logger.error(f"insert_block failed: {exc}", exc_info=True)
            raise HTTPException(status_code=500, detail={"error_code": "INSERT_BLOCK_FAILED", "message": str(exc)})
        return _block_refresh(req.book_id)

    @router.post("/live-book/books/delete-block")
    async def delete_block(request: Request, req: BlockRequest) -> dict[str, Any]:
        _require_auth(request)
        engine = get_book_engine()
        ok = await engine.delete_block(
            book_id=req.book_id, page_id=req.page_id, block_id=req.block_id
        )
        if not ok:
            raise HTTPException(status_code=404, detail={"error_code": "BLOCK_NOT_FOUND", "message": "Block not found"})
        return {"ok": True}

    @router.post("/live-book/books/move-block")
    async def move_block(request: Request, req: BlockRequest) -> dict[str, Any]:
        _require_auth(request)
        engine = get_book_engine()
        ok = await engine.move_block(
            book_id=req.book_id,
            page_id=req.page_id,
            block_id=req.block_id,
            new_position=req.new_position,
        )
        if not ok:
            raise HTTPException(status_code=404, detail={"error_code": "BLOCK_NOT_FOUND", "message": "Block not found"})
        return {"ok": True}

    @router.post("/live-book/books/change-block-type")
    async def change_block_type(request: Request, req: BlockRequest) -> dict[str, Any]:
        _require_auth(request)
        _apply_llm_overrides(request)
        engine = get_book_engine()
        new_type = _coerce_block_type(req.new_type or req.block_type)
        try:
            await engine.change_block_type(
                book_id=req.book_id,
                page_id=req.page_id,
                block_id=req.block_id,
                new_type=new_type,
            )
        except Exception as exc:
            if logger:
                logger.error(f"change_block_type failed: {exc}", exc_info=True)
            raise HTTPException(status_code=500, detail={"error_code": "CHANGE_BLOCK_TYPE_FAILED", "message": str(exc)})
        return _block_refresh(req.book_id)

    # ── Quiz ─────────────────────────────────────────────────────────────

    @router.post("/live-book/books/quiz-attempt")
    async def quiz_attempt(request: Request, req: QuizAttemptRequest) -> dict[str, Any]:
        _require_auth(request)
        engine = get_book_engine()
        try:
            progress = await engine.record_quiz_attempt(
                book_id=req.book_id,
                page_id=req.page_id,
                block_id=req.block_id,
                question_id=req.question_id,
                user_answer=req.user_answer,
                is_correct=req.is_correct,
            )
        except Exception as exc:
            if logger:
                logger.error(f"record_quiz_attempt failed: {exc}", exc_info=True)
            raise HTTPException(status_code=500, detail={"error_code": "QUIZ_ATTEMPT_FAILED", "message": str(exc)})
        return {"progress": progress_to_dto(progress)}

    # ── Deep-dive / Supplement ───────────────────────────────────────────

    @router.post("/live-book/books/deep-dive")
    async def deep_dive(request: Request, req: DeepDiveRequest) -> dict[str, Any]:
        _require_auth(request)
        _apply_llm_overrides(request)
        engine = get_book_engine()
        try:
            ct = ContentType(req.content_type or "concept")
            sub = await engine.create_deep_dive_subpage(
                book_id=req.book_id,
                parent_page_id=req.parent_page_id,
                topic=req.topic,
                block_id=req.block_id or None,
                content_type=ct,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error_code": "INVALID_REQUEST", "message": str(exc)})
        except Exception as exc:
            if logger:
                logger.error(f"deep_dive failed: {exc}", exc_info=True)
            raise HTTPException(status_code=500, detail={"error_code": "DEEP_DIVE_FAILED", "message": str(exc)})
        return {"page": page_to_dto(sub)}

    @router.post("/live-book/books/supplement")
    async def supplement(request: Request, req: SupplementRequest) -> dict[str, Any]:
        _require_auth(request)
        _apply_llm_overrides(request)
        engine = get_book_engine()
        try:
            block = await engine.supplement_for_weakness(
                book_id=req.book_id,
                page_id=req.page_id,
                topic=req.topic,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error_code": "INVALID_REQUEST", "message": str(exc)})
        except Exception as exc:
            if logger:
                logger.error(f"supplement failed: {exc}", exc_info=True)
            raise HTTPException(status_code=500, detail={"error_code": "SUPPLEMENT_FAILED", "message": str(exc)})
        return {"block": block_to_dto(block)}

    # ── Health / Fingerprints ────────────────────────────────────────────

    @router.get("/live-book/books/{book_id}/health")
    async def book_health(request: Request, book_id: str) -> dict[str, Any]:
        _require_auth(request)
        engine = get_book_engine()
        book = engine.load_book(book_id)
        if book is None:
            raise HTTPException(status_code=404, detail={"error_code": "BOOK_NOT_FOUND", "message": "Book not found"})
        pages = engine.list_pages(book_id)
        pending = [p.id for p in pages if p.status == PageStatus.PENDING]
        partial = [p.id for p in pages if p.status == PageStatus.PARTIAL]
        error = [p.id for p in pages if p.status == PageStatus.ERROR]
        block_errors = sum(
            1 for p in pages for b in (p.blocks or []) if b.status.value == "error"
        )
        return {
            "health": {
                "stalePageIds": pending + partial + error,
                "driftPageIds": [],
                "driftReasonByPageId": {},
                "errorPageIds": error,
                "partialPageIds": partial,
                "pendingPageIds": pending,
                "blockErrorCount": block_errors,
                "staleCount": len(pending) + len(partial) + len(error),
                "driftCount": 0,
                "ok": len(error) == 0 and block_errors == 0,
            }
        }

    @router.post("/live-book/books/{book_id}/refresh-fingerprints")
    async def refresh_fingerprints(request: Request, book_id: str) -> dict[str, Any]:
        _require_auth(request)
        engine = get_book_engine()
        book = engine.load_book(book_id)
        return {
            "book_id": book_id,
            "kb_fingerprints": book.kb_fingerprints if book else {},
            "stale_page_ids": book.stale_page_ids if book else [],
        }

    # ── Jobs (legacy poll) ───────────────────────────────────────────────

    @router.get("/live-book/jobs/{job_id}")
    async def get_job(request: Request, job_id: str) -> dict[str, Any]:
        _require_auth(request)
        return {
            "job": {
                "id": job_id,
                "bookId": "",
                "status": "completed",
                "stage": "completed",
                "progress": 100,
                "events": [],
                "createdAt": 0,
                "updatedAt": 0,
            }
        }

    # ── WebSocket ────────────────────────────────────────────────────────

    def _serialize_event(event) -> dict[str, Any]:
        return {
            "type": event.type.value
            if hasattr(event.type, "value")
            else str(event.type),
            "source": event.source,
            "stage": event.stage,
            "content": event.content,
            "metadata": event.metadata or {},
        }

    @router.websocket("/live-book/ws")
    async def live_book_websocket(
        ws: WebSocket, token: str = Query(default="")
    ) -> None:
        if settings.api_token and token != settings.api_token:
            await ws.close(code=4001)
            return
        await ws.accept()
        closed = False

        async def send(data: dict[str, Any]) -> None:
            nonlocal closed
            if closed:
                return
            try:
                await ws.send_json(data)
            except Exception:
                closed = True

        async def stream_into_socket(bus: StreamBus) -> None:
            try:
                async for event in bus.subscribe():
                    if closed:
                        break
                    if event.source != BOOK_SOURCE:
                        continue
                    await send(_serialize_event(event))
            except asyncio.CancelledError:
                pass

        engine = get_book_engine()

        try:
            while True:
                raw = await ws.receive_json()
                msg_type = str(raw.get("type", ""))
                data: dict[str, Any] = raw.get("data") or raw

                try:
                    if msg_type == "create":
                        lang = str(data.get("language") or "en")
                        book, proposal = await engine.create_book(
                            user_intent=str(data.get("user_intent") or ""),
                            chat_session_id=str(data.get("chat_session_id") or ""),
                            chat_selections=data.get("chat_selections") or [],
                            notebook_refs=data.get("notebook_refs") or [],
                            knowledge_bases=data.get("knowledge_bases") or [],
                            question_categories=[
                                int(c) for c in (data.get("question_categories") or [])
                            ],
                            question_entries=[
                                int(e) for e in (data.get("question_entries") or [])
                            ],
                            language=lang,
                        )
                        await send(
                            {
                                "type": "create_result",
                                "book": book_to_dto(book),
                                "proposal": proposal_to_dto(proposal),
                            }
                        )

                    elif msg_type == "confirm_proposal":
                        edited: BookProposal | None = None
                        if data.get("proposal"):
                            edited = BookProposal.model_validate(data["proposal"])
                        book, spine = await engine.confirm_proposal(
                            book_id=str(data.get("book_id") or ""),
                            edited_proposal=edited,
                        )
                        await send(
                            {
                                "type": "confirm_proposal_result",
                                "book": book_to_dto(book),
                                "spine": spine_to_dto(spine),
                            }
                        )

                    elif msg_type == "confirm_spine":
                        edited_spine: Spine | None = None
                        if data.get("spine"):
                            edited_spine = Spine.model_validate(data["spine"])
                        pages = await engine.confirm_spine(
                            book_id=str(data.get("book_id") or ""),
                            edited_spine=edited_spine,
                            auto_compile=bool(data.get("auto_compile", True)),
                        )
                        await send(
                            {
                                "type": "confirm_spine_result",
                                "pages": [page_to_dto(p) for p in pages],
                            }
                        )

                    elif msg_type == "compile_page":
                        bus = StreamBus()
                        page = await engine.compile_page(
                            book_id=str(data.get("book_id") or ""),
                            page_id=str(data.get("page_id") or ""),
                            force=bool(data.get("force", False)),
                            stream=bus,
                        )
                        await stream_into_socket(bus)
                        await send(
                            {
                                "type": "compile_page_result",
                                "page": page_to_dto(page),
                            }
                        )

                    elif msg_type == "compile_all":
                        book_id = str(data.get("book_id") or "")
                        bus = StreamBus()
                        pages = engine.list_pages(book_id)
                        for p in pages:
                            if p.status in (PageStatus.PENDING, PageStatus.PARTIAL):
                                await engine.compile_page(
                                    book_id=book_id, page_id=p.id, stream=bus
                                )
                        await stream_into_socket(bus)
                        await send(
                            {
                                "type": "compile_all_result",
                                "book_id": book_id,
                            }
                        )

                    else:
                        await send(
                            {
                                "type": "error",
                                "content": f"Unknown message type: {msg_type}",
                            }
                        )

                except Exception as exc:
                    if logger:
                        logger.error(
                            f"live_book ws action {msg_type} failed: {exc}",
                            exc_info=True,
                        )
                    await send({"type": "error", "content": str(exc)})

        except WebSocketDisconnect:
            pass
        except Exception:
            if logger:
                logger.exception("live_book ws unexpected error")

    return router
