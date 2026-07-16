"""Co-Writer API Router — document CRUD + AI edit features."""

from __future__ import annotations

import json
import traceback
import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(tags=["co-writer"])


# ── Lazy storage ──────────────────────────────────────────────────────

_storage = None


def _get_storage():
    global _storage
    if _storage is None:
        from tutor_engine.co_writer.storage import get_co_writer_storage
        _storage = get_co_writer_storage()
    return _storage


# ── Request / Response models ─────────────────────────────────────────

class CreateDocumentRequest(BaseModel):
    title: str | None = None
    content: str = ""


class UpdateDocumentRequest(BaseModel):
    title: str | None = None
    content: str | None = None


class DocumentResponse(BaseModel):
    id: str
    title: str
    content: str
    created_at: float
    updated_at: float

    @classmethod
    def from_model(cls, doc) -> "DocumentResponse":
        return cls(
            id=doc.id,
            title=doc.title,
            content=doc.content,
            created_at=doc.created_at,
            updated_at=doc.updated_at,
        )


class DocumentSummaryResponse(BaseModel):
    id: str
    title: str
    created_at: float
    updated_at: float
    preview: str = ""

    @classmethod
    def from_summary(cls, summary) -> "DocumentSummaryResponse":
        return cls(
            id=summary.id,
            title=summary.title,
            created_at=summary.created_at,
            updated_at=summary.updated_at,
            preview=summary.preview,
        )


# ── Edit request models ───────────────────────────────────────────────

class EditRequest(BaseModel):
    text: str = ""
    instruction: str = ""
    action: str = "rewrite"
    source: str | None = None
    kb_name: str | None = None


class EditReactRequest(BaseModel):
    selected_text: str = ""
    instruction: str = ""
    mode: str = "rewrite"
    tools: list[str] = []
    kb_name: str | None = None


class AutoMarkRequest(BaseModel):
    text: str = ""


# ── Document CRUD ─────────────────────────────────────────────────────

@router.get("/documents")
async def list_documents() -> dict[str, list[DocumentSummaryResponse]]:
    storage = _get_storage()
    summaries = storage.list_documents()
    return {"documents": [DocumentSummaryResponse.from_summary(s) for s in summaries]}


@router.post("/documents", response_model=DocumentResponse)
async def create_document(request: CreateDocumentRequest) -> DocumentResponse:
    storage = _get_storage()
    doc = storage.create_document(title=request.title, content=request.content)
    return DocumentResponse.from_model(doc)


@router.get("/documents/{doc_id}", response_model=DocumentResponse)
async def get_document(doc_id: str) -> DocumentResponse:
    storage = _get_storage()
    doc = storage.load_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail={"error_code": "DOCUMENT_NOT_FOUND", "message": "Document not found"})
    return DocumentResponse.from_model(doc)


@router.put("/documents/{doc_id}", response_model=DocumentResponse)
async def update_document(doc_id: str, request: UpdateDocumentRequest) -> DocumentResponse:
    storage = _get_storage()
    doc = storage.update_document(doc_id, title=request.title, content=request.content)
    if doc is None:
        raise HTTPException(status_code=404, detail={"error_code": "DOCUMENT_NOT_FOUND", "message": "Document not found"})
    return DocumentResponse.from_model(doc)


@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str) -> dict[str, bool]:
    storage = _get_storage()
    ok = storage.delete_document(doc_id)
    if not ok:
        raise HTTPException(status_code=404, detail={"error_code": "DOCUMENT_NOT_FOUND", "message": "Document not found"})
    return {"deleted": True}


# ── Edit endpoints (lazy-loaded) ──────────────────────────────────────

_EDIT_MODULES_LOADED = False
_EDIT_LOAD_ERROR: str | None = None


def _ensure_edit_modules():
    """Lazy-load the heavy AI edit modules on first request."""
    global _EDIT_MODULES_LOADED, _EDIT_LOAD_ERROR
    if _EDIT_MODULES_LOADED:
        return _EDIT_LOAD_ERROR is None
    try:
        import asyncio  # noqa: F401
        from tutor_engine.co_writer.edit_agent import EditAgent  # noqa: F401
        from tutor_engine.agents.chat.agentic_pipeline import AgenticChatPipeline  # noqa: F401
        from tutor_engine.core.stream_bus import StreamBus  # noqa: F401
        _EDIT_MODULES_LOADED = True
        return True
    except Exception as exc:
        _EDIT_LOAD_ERROR = str(exc)
        _EDIT_MODULES_LOADED = True
        return False


@router.post("/edit")
async def edit_text(request: EditRequest):
    if not _ensure_edit_modules():
        raise HTTPException(status_code=503, detail={"error_code": "SERVICE_UNAVAILABLE", "message": f"AI edit not available: {_EDIT_LOAD_ERROR}"})
    from tutor_engine.co_writer.edit_agent import EditAgent
    agent = EditAgent()
    result = await agent.process(
        text=request.text,
        instruction=request.instruction,
        action=request.action,
        source=request.source,
        kb_name=request.kb_name,
    )
    return result


@router.post("/edit_react/stream")
async def edit_text_react_stream(request: EditReactRequest):
    if not _ensure_edit_modules():
        raise HTTPException(status_code=503, detail={"error_code": "SERVICE_UNAVAILABLE", "message": f"AI edit not available: {_EDIT_LOAD_ERROR}"})
    from tutor_engine.co_writer.edit_agent import EditAgent

    async def event_generator():
        agent = EditAgent(enabled_tools=request.tools or ["rag", "web_search"])
        async for chunk in agent.stream_llm(
            user_prompt=f"Instruction: {request.instruction}\n\nText:\n{request.selected_text}",
            system_prompt="You are an expert editor. Output only the edited text.",
            stage=f"edit_{request.mode}",
        ):
            yield f"data: {json.dumps({'type': 'text_delta', 'data': {'content': chunk}})}\n\n"
        yield "data: {\"type\": \"done\"}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.post("/automark")
async def auto_mark_text(request: AutoMarkRequest):
    if not _ensure_edit_modules():
        raise HTTPException(status_code=503, detail={"error_code": "SERVICE_UNAVAILABLE", "message": f"Auto-mark not available: {_EDIT_LOAD_ERROR}"})
    from tutor_engine.co_writer.edit_agent import EditAgent
    agent = EditAgent()
    result = await agent.auto_mark(text=request.text)
    return result


@router.post("/edit_react")
async def edit_text_react(request: EditReactRequest):
    if not _ensure_edit_modules():
        raise HTTPException(status_code=503, detail={"error_code": "SERVICE_UNAVAILABLE", "message": f"AI edit not available: {_EDIT_LOAD_ERROR}"})
    from tutor_engine.co_writer.edit_agent import EditAgent
    agent = EditAgent(enabled_tools=request.tools or ["rag", "web_search"])
    result = await agent.process(
        text=request.selected_text,
        instruction=request.instruction,
        action=request.mode if request.mode in ("rewrite", "shorten", "expand") else "rewrite",
        kb_name=request.kb_name,
    )
    return result


# ── History & tool calls ───────────────────────────────────────────────

@router.get("/history")
async def get_history():
    if not _ensure_edit_modules():
        raise HTTPException(status_code=503, detail={"error_code": "SERVICE_UNAVAILABLE", "message": f"AI edit not available: {_EDIT_LOAD_ERROR}"})
    from tutor_engine.co_writer.edit_agent import load_history
    history = load_history()
    return {"history": history, "total": len(history)}


@router.get("/history/{operation_id}")
async def get_history_item(operation_id: str):
    if not _ensure_edit_modules():
        raise HTTPException(status_code=503, detail={"error_code": "SERVICE_UNAVAILABLE", "message": f"AI edit not available: {_EDIT_LOAD_ERROR}"})
    from tutor_engine.co_writer.edit_agent import load_history
    history = load_history()
    for item in history:
        if item.get("id") == operation_id:
            return item
    raise HTTPException(status_code=404, detail={"error_code": "OPERATION_NOT_FOUND", "message": "Operation not found"})


@router.get("/tool_calls/{operation_id}")
async def get_tool_calls(operation_id: str):
    if not _ensure_edit_modules():
        raise HTTPException(status_code=503, detail={"error_code": "SERVICE_UNAVAILABLE", "message": f"AI edit not available: {_EDIT_LOAD_ERROR}"})
    from tutor_engine.co_writer.edit_agent import TOOL_CALLS_DIR
    if not TOOL_CALLS_DIR.exists():
        raise HTTPException(status_code=404, detail={"error_code": "NO_TOOL_CALLS", "message": "No tool calls found"})
    matches = []
    for f in TOOL_CALLS_DIR.iterdir():
        if f.name.startswith(operation_id) and f.suffix == ".json":
            try:
                with open(f, encoding="utf-8") as fh:
                    matches.append(json.load(fh))
            except Exception:
                continue
    if not matches:
        raise HTTPException(status_code=404, detail={"error_code": "TOOL_CALLS_NOT_FOUND", "message": "Tool calls not found for this operation"})
    return {"tool_calls": matches}
