"""Problem context cache helpers for image-based tutoring."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import ProblemContext


def serialize_problem_context(row: ProblemContext) -> dict[str, Any]:
    return {
        "problem_context_id": row.id,
        "user_id": row.user_id,
        "session_id": row.session_id,
        "object_key": row.object_key,
        "sha256": row.sha256,
        "mime_type": row.mime_type,
        "ocr_text": row.ocr_text,
        "vision_summary": row.vision_summary,
        "geometry_context_json": row.geometry_context_json or {},
        "problem_type": row.problem_type,
        "model_name": row.model_name,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def get_problem_context_by_id(
    session: Session,
    context_id: str | None,
    *,
    user_id: str,
) -> ProblemContext | None:
    if not context_id:
        return None
    row = session.get(ProblemContext, context_id)
    if row is None or row.user_id != user_id:
        return None
    return row


def get_problem_context_by_sha(
    session: Session,
    sha256: str | None,
    *,
    user_id: str,
) -> ProblemContext | None:
    if not sha256:
        return None
    return (
        session.query(ProblemContext)
        .filter(
            ProblemContext.user_id == user_id,
            ProblemContext.sha256 == sha256,
        )
        .first()
    )


def upsert_problem_context(
    session: Session,
    *,
    user_id: str,
    session_id: str | None,
    object_key: str,
    sha256: str,
    mime_type: str | None,
    vision_summary: str,
    model_name: str | None,
    ocr_text: str = "",
    geometry_context_json: dict[str, Any] | None = None,
    problem_type: str | None = None,
) -> ProblemContext:
    row = get_problem_context_by_sha(session, sha256, user_id=user_id)
    now = datetime.utcnow()
    if row is not None:
        row.session_id = session_id or row.session_id
        row.object_key = object_key or row.object_key
        row.mime_type = mime_type or row.mime_type
        if vision_summary:
            row.vision_summary = vision_summary
        if ocr_text:
            row.ocr_text = ocr_text
        if geometry_context_json:
            row.geometry_context_json = geometry_context_json
        row.problem_type = problem_type or row.problem_type
        row.model_name = model_name or row.model_name
        row.updated_at = now
        session.flush()
        return row

    row = ProblemContext(
        user_id=user_id,
        session_id=session_id,
        object_key=object_key,
        sha256=sha256,
        mime_type=mime_type,
        ocr_text=ocr_text or "",
        vision_summary=vision_summary or "",
        geometry_context_json=geometry_context_json or {},
        problem_type=problem_type,
        model_name=model_name,
    )
    session.add(row)
    try:
        session.flush()
        return row
    except IntegrityError:
        session.rollback()
        existing = get_problem_context_by_sha(session, sha256, user_id=user_id)
        if existing is None:
            raise
        return existing


def format_problem_context_for_prompt(row: ProblemContext) -> str:
    payload = serialize_problem_context(row)
    geometry = payload.get("geometry_context_json") or {}
    geometry_text = json.dumps(geometry, ensure_ascii=False) if geometry else "{}"
    parts = [
        "## 已缓存的题目视觉上下文",
        f"- problem_context_id: {payload['problem_context_id']}",
        f"- object_key: {payload['object_key']}",
        f"- sha256: {payload['sha256']}",
    ]
    if payload.get("problem_type"):
        parts.append(f"- problem_type: {payload['problem_type']}")
    if payload.get("ocr_text"):
        parts.append("\n### OCR 文本\n" + str(payload["ocr_text"]).strip())
    if payload.get("vision_summary"):
        parts.append("\n### 视觉理解摘要\n" + str(payload["vision_summary"]).strip())
    parts.append("\n### 几何/版面上下文 JSON\n" + geometry_text)
    return "\n".join(parts)
