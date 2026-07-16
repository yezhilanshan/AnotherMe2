"""
Live-book DTO (Data Transfer Object) layer.

Every mapping function in this module corresponds to a TypeScript interface
in ``lib/live-book/types.ts``.  The contract is:

* All dict keys are **snake_case** — matching the frontend TypeScript types exactly.
* Every field that exists in the TS interface MUST be present in the returned dict.
* Extra fields (e.g. ``topic`` on Book, ``goal`` on Chapter) are harmless because
  TS just ignores them with ``as T`` casts.

Source-of-truth: :file:`../../lib/live-book/types.ts`
"""

from __future__ import annotations

import time
from typing import Any

# P1: 优先使用 gateway-owned 的 enum contracts
try:
    from api_gateway.internal.contracts import (
        BlockType as _BlockType,
        ContentType as _ContentType,
        PageStatus as _PageStatus,
    )

    _ENUMS_FROM_INTERNAL = True
except Exception:  # pragma: no cover - 防御性回落
    from tutor_engine.book.models import (  # type: ignore
        BlockType as _BlockType,
        ContentType as _ContentType,
        PageStatus as _PageStatus,
    )

    _ENUMS_FROM_INTERNAL = False

# Re-export under the same names callers expect
BlockType = _BlockType
ContentType = _ContentType
PageStatus = _PageStatus

# ─────────────────────────────────────────────────────────────────────────────
# Block  →  types.ts  interface Block
# ─────────────────────────────────────────────────────────────────────────────


def block_to_dto(dt_block) -> dict[str, Any]:
    return {
        "id": dt_block.id,
        "type": str(dt_block.type.value),
        "title": dt_block.title,
        "content": dt_block.payload.get("text", "") if dt_block.payload else "",
        "status": (
            "ready" if dt_block.status.value in ("ready", "generating") else "error"
        ),
        "params": dt_block.params or {},
        "payload": dt_block.payload or {},
        "metadata": dt_block.metadata or {},
        "error": dt_block.error or None,
        "created_at": (
            int(dt_block.created_at * 1000) if dt_block.created_at else None
        ),
        "updated_at": (
            int(dt_block.updated_at * 1000) if dt_block.updated_at else None
        ),
        "source_anchors": [
            {"kind": a.kind, "ref": a.ref, "snippet": a.snippet}
            for a in (dt_block.source_anchors or [])
        ],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Page   →  types.ts  interface Page
# ─────────────────────────────────────────────────────────────────────────────


def page_to_dto(dt_page) -> dict[str, Any]:
    return {
        "id": dt_page.id,
        "book_id": dt_page.book_id,
        "chapter_id": dt_page.chapter_id,
        "title": dt_page.title,
        "learning_objectives": dt_page.learning_objectives or [],
        "content_type": (
            str(dt_page.content_type.value) if dt_page.content_type else "theory"
        ),
        "status": str(dt_page.status.value),
        "order": dt_page.order,
        "blocks": [block_to_dto(b) for b in (dt_page.blocks or [])],
        "links": [
            {
                "target_page_id": l.target_page_id,
                "relation": l.relation,
                "label": l.label,
            }
            for l in (dt_page.links or [])
        ],
        "parent_page_id": dt_page.parent_page_id or "",
        "error": dt_page.error or "",
        "created_at": (int(dt_page.created_at * 1000) if dt_page.created_at else 0),
        "updated_at": (int(dt_page.updated_at * 1000) if dt_page.updated_at else 0),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Chapter  →  types.ts  interface Chapter
# ─────────────────────────────────────────────────────────────────────────────


def chapter_to_dto(dt_chapter) -> dict[str, Any]:
    return {
        "id": dt_chapter.id,
        "title": dt_chapter.title,
        "goal": "",
        "order": dt_chapter.order,
        "learning_objectives": dt_chapter.learning_objectives or [],
        "content_type": (
            str(dt_chapter.content_type.value) if dt_chapter.content_type else "mixed"
        ),
        "source_anchors": [
            {"kind": a.kind, "ref": a.ref, "snippet": a.snippet}
            for a in (dt_chapter.source_anchors or [])
        ],
        "prerequisites": dt_chapter.prerequisites or [],
        "page_ids": dt_chapter.page_ids or [],
        "summary": dt_chapter.summary or "",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Spine   →  types.ts  interface Spine
# ─────────────────────────────────────────────────────────────────────────────


def spine_to_dto(dt_spine) -> dict[str, Any] | None:
    if not dt_spine:
        return None
    return {
        "book_id": dt_spine.book_id,
        "chapters": [chapter_to_dto(c) for c in dt_spine.chapters],
        "version": dt_spine.version,
        "updated_at": (
            int(dt_spine.updated_at * 1000) if dt_spine.updated_at else None
        ),
        "concept_graph": (
            dt_spine.concept_graph.model_dump(mode="json")
            if dt_spine.concept_graph
            else None
        ),
        "exploration_summary": (getattr(dt_spine, "exploration_summary", None) or ""),
    }


# ─────────────────────────────────────────────────────────────────────────────
# BookProposal  →  types.ts  interface BookProposal
# ─────────────────────────────────────────────────────────────────────────────


def proposal_to_dto(dt_proposal) -> dict[str, Any] | None:
    if not dt_proposal:
        return None
    return {
        "title": dt_proposal.title,
        "description": dt_proposal.description,
        "scope": dt_proposal.scope,
        "target_level": dt_proposal.target_level,
        "estimated_chapters": dt_proposal.estimated_chapters,
        "rationale": dt_proposal.rationale,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Progress  →  types.ts  interface Progress
# ─────────────────────────────────────────────────────────────────────────────


def progress_to_dto(dt_progress) -> dict[str, Any]:
    if not dt_progress:
        return {
            "book_id": "",
            "current_page_id": None,
            "visited_page_ids": [],
            "bookmarked_page_ids": [],
            "quiz_attempts": [],
            "weak_chapters": [],
            "score": 0,
            "updated_at": 0,
        }
    return {
        "book_id": dt_progress.book_id or "",
        "current_page_id": dt_progress.current_page_id or None,
        "visited_page_ids": dt_progress.visited_page_ids or [],
        "bookmarked_page_ids": dt_progress.bookmarked_page_ids or [],
        "quiz_attempts": [
            {
                "block_id": a.block_id,
                "page_id": a.page_id,
                "question_id": a.question_id,
                "user_answer": a.user_answer,
                "is_correct": a.is_correct,
                "timestamp": (
                    int(a.timestamp * 1000) if a.timestamp else int(time.time() * 1000)
                ),
            }
            for a in (dt_progress.quiz_attempts or [])
        ],
        "weak_chapters": dt_progress.weak_chapters or [],
        "score": dt_progress.score,
        "updated_at": int(dt_progress.updated_at * 1000),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Book (metadata only)  →  types.ts  interface Book
# ─────────────────────────────────────────────────────────────────────────────
#
# This returns ONLY the book-metadata fields.  Pages, spine, and progress are
# returned separately by get_book() at the top level of the response.
# ─────────────────────────────────────────────────────────────────────────────


def book_to_dto(dt_book) -> dict[str, Any]:
    proposal = proposal_to_dto(dt_book.proposal)
    if proposal is None:
        proposal = {
            "title": dt_book.title,
            "description": "",
            "scope": "",
            "target_level": "",
            "estimated_chapters": dt_book.chapter_count,
            "rationale": "",
        }
    return {
        "id": dt_book.id,
        "title": dt_book.title,
        "description": dt_book.description or "",
        "topic": dt_book.title,  # alias used by frontend in some places
        "language": ("zh-CN" if dt_book.language.startswith("zh") else "en-US"),
        "status": str(dt_book.status.value),
        "proposal": proposal,
        "knowledge_bases": dt_book.knowledge_bases or [],
        "page_count": dt_book.page_count,
        "chapter_count": dt_book.chapter_count,
        "created_at": int(dt_book.created_at * 1000),
        "updated_at": int(dt_book.updated_at * 1000),
        "metadata": dt_book.metadata or {},
    }


# ─────────────────────────────────────────────────────────────────────────────
# Book summary  →  used by list endpoint (lightweight)
# ─────────────────────────────────────────────────────────────────────────────


def book_summary_to_dto(dt_book) -> dict[str, Any]:
    return {
        "id": dt_book.id,
        "title": dt_book.title,
        "topic": dt_book.title,
        "status": str(dt_book.status.value),
        "chapter_count": dt_book.chapter_count,
        "page_count": dt_book.page_count,
        "updated_at": int(dt_book.updated_at * 1000),
    }
