"""Student Memory service layer.

Provides CRUD operations and context extraction for the student_memory table.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import desc
from sqlalchemy.orm import Session

from .models import StudentMemory

# Memory type constants
MEMORY_TYPE_WEAKNESS = "weakness"
MEMORY_TYPE_PREFERENCE = "preference"
MEMORY_TYPE_MISTAKE = "common_mistake"
MEMORY_TYPE_FOCUS = "recent_focus"
MEMORY_TYPE_NOTE = "note"

# Patterns for extracting memories from conversation turns
_CONFUSION_PATTERNS = re.compile(
    r"不懂|不理解|听不懂|还是不会|没明白|太难了|看不懂|不明白|搞不清|晕了|不会做|不知道怎么"
)
_MISTAKE_KEYWORDS = re.compile(
    r"错了|错误|漏了|忘记|忽略|粗心|计算错|符号错|审题|抄错"
)


def _utcnow() -> datetime:
    return datetime.utcnow()


def create_memory(
    session: Session,
    *,
    user_id: str,
    memory_type: str,
    content: str,
    source_session_id: str | None = None,
    importance: int = 0,
) -> dict[str, Any]:
    """Create a new memory entry with dedup.

    If a memory of the same type with similar content (first 50 chars match)
    already exists, boost its importance instead of creating a duplicate.
    """
    # Dedup check: look for similar existing memory
    prefix = content[:50].strip()
    if len(prefix) >= 10:
        existing = (
            session.query(StudentMemory)
            .filter(
                StudentMemory.user_id == user_id,
                StudentMemory.memory_type == memory_type,
                StudentMemory.content.like(f"{prefix}%"),
            )
            .order_by(desc(StudentMemory.importance))
            .first()
        )
        if existing:
            # Boost importance of existing memory instead of creating duplicate
            existing.importance = max(existing.importance, importance) + 1
            session.flush()
            return _serialize(existing)

    memory = StudentMemory(
        id=str(uuid4()),
        user_id=user_id,
        memory_type=memory_type,
        content=content,
        source_session_id=source_session_id,
        importance=importance,
    )
    session.add(memory)
    session.flush()
    return _serialize(memory)


def list_memories(
    session: Session,
    *,
    user_id: str,
    memory_type: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """List memories for a user, optionally filtered by type."""
    query = session.query(StudentMemory).filter(StudentMemory.user_id == user_id)
    if memory_type:
        query = query.filter(StudentMemory.memory_type == memory_type)
    query = query.order_by(desc(StudentMemory.importance), desc(StudentMemory.created_at))
    rows = query.offset(offset).limit(limit).all()
    return [_serialize(r) for r in rows]


def get_memory(
    session: Session,
    *,
    user_id: str,
    memory_id: str,
) -> dict[str, Any] | None:
    """Get a single memory by ID."""
    row = (
        session.query(StudentMemory)
        .filter(StudentMemory.id == memory_id, StudentMemory.user_id == user_id)
        .first()
    )
    return _serialize(row) if row else None


def update_memory(
    session: Session,
    *,
    user_id: str,
    memory_id: str,
    content: str | None = None,
    importance: int | None = None,
) -> dict[str, Any] | None:
    """Update a memory's content or importance."""
    row = (
        session.query(StudentMemory)
        .filter(StudentMemory.id == memory_id, StudentMemory.user_id == user_id)
        .first()
    )
    if not row:
        return None
    if content is not None:
        row.content = content
    if importance is not None:
        row.importance = importance
    session.flush()
    return _serialize(row)


def delete_memory(
    session: Session,
    *,
    user_id: str,
    memory_id: str,
) -> bool:
    """Delete a memory. Returns True if deleted."""
    row = (
        session.query(StudentMemory)
        .filter(StudentMemory.id == memory_id, StudentMemory.user_id == user_id)
        .first()
    )
    if not row:
        return False
    session.delete(row)
    session.flush()
    return True


def get_memory_context(
    session: Session,
    *,
    user_id: str,
    max_chars: int = 6000,
) -> str | None:
    """Assemble memory context for LLM system prompt injection.

    Returns memories sorted by importance (desc) then recency (desc),
    truncated to max_chars.
    """
    rows = (
        session.query(StudentMemory)
        .filter(StudentMemory.user_id == user_id)
        .order_by(desc(StudentMemory.importance), desc(StudentMemory.created_at))
        .limit(100)
        .all()
    )
    if not rows:
        return None

    type_labels = {
        MEMORY_TYPE_WEAKNESS: "薄弱点",
        MEMORY_TYPE_PREFERENCE: "学习偏好",
        MEMORY_TYPE_MISTAKE: "常见错误",
        MEMORY_TYPE_FOCUS: "近期关注",
        MEMORY_TYPE_NOTE: "学习笔记",
    }

    sections: list[str] = []
    total = 0
    for row in rows:
        label = type_labels.get(row.memory_type, row.memory_type)
        entry = f"[{label}] {row.content}"
        if total + len(entry) + 1 > max_chars:
            break
        sections.append(entry)
        total += len(entry) + 1

    if not sections:
        return None

    return "学生记忆：\n" + "\n".join(f"- {s}" for s in sections)


def merge_duplicate_memories(
    session: Session,
    *,
    user_id: str,
) -> int:
    """Scan for duplicate memories and merge them.

    Memories of the same type with matching first 50 characters are merged:
    the one with highest importance is kept, its importance is boosted,
    and redundant entries are deleted.

    Returns the number of duplicates removed.
    """
    all_memories = (
        session.query(StudentMemory)
        .filter(StudentMemory.user_id == user_id)
        .order_by(StudentMemory.memory_type, desc(StudentMemory.importance), desc(StudentMemory.created_at))
        .all()
    )

    # Group by (type, prefix)
    groups: dict[tuple[str, str], list[StudentMemory]] = {}
    for mem in all_memories:
        prefix = mem.content[:50].strip()
        key = (mem.memory_type, prefix)
        groups.setdefault(key, []).append(mem)

    removed = 0
    for _key, group in groups.items():
        if len(group) <= 1:
            continue
        # Keep the first (highest importance), merge rest
        keeper = group[0]
        for dup in group[1:]:
            keeper.importance = max(keeper.importance, dup.importance + 1)
            session.delete(dup)
            removed += 1

    if removed > 0:
        session.flush()
    return removed


def extract_memories_from_turn(
    session: Session,
    *,
    user_id: str,
    user_message: str,
    assistant_message: str,
    source_session_id: str | None = None,
) -> list[dict[str, Any]]:
    """Extract and persist memories from a conversation turn using simple rules.

    Extracts:
    - Confusion signals → weakness memory
    - Mistake keywords → common_mistake memory
    - Question topics → recent_focus memory
    """
    extracted: list[dict[str, Any]] = []

    # Detect confusion → weakness
    if _CONFUSION_PATTERNS.search(user_message):
        topic = user_message[:200].strip()
        # Deduplicate: skip if similar weakness already exists
        existing = (
            session.query(StudentMemory)
            .filter(
                StudentMemory.user_id == user_id,
                StudentMemory.memory_type == MEMORY_TYPE_WEAKNESS,
                StudentMemory.content.like(f"%{topic[:50]}%"),
            )
            .first()
        )
        if not existing:
            mem = create_memory(
                session,
                user_id=user_id,
                memory_type=MEMORY_TYPE_WEAKNESS,
                content=f"学生表示困惑：{topic}",
                source_session_id=source_session_id,
                importance=2,
            )
            extracted.append(mem)

    # Detect mistake patterns → common_mistake
    if _MISTAKE_KEYWORDS.search(user_message):
        topic = user_message[:200].strip()
        existing = (
            session.query(StudentMemory)
            .filter(
                StudentMemory.user_id == user_id,
                StudentMemory.memory_type == MEMORY_TYPE_MISTAKE,
                StudentMemory.content.like(f"%{topic[:50]}%"),
            )
            .first()
        )
        if not existing:
            mem = create_memory(
                session,
                user_id=user_id,
                memory_type=MEMORY_TYPE_MISTAKE,
                content=f"学生提到错误：{topic}",
                source_session_id=source_session_id,
                importance=1,
            )
            extracted.append(mem)

    # Extract topic focus from question (first 100 chars as topic)
    if len(user_message) > 10:
        topic = user_message[:100].strip()
        mem = create_memory(
            session,
            user_id=user_id,
            memory_type=MEMORY_TYPE_FOCUS,
            content=f"学习话题：{topic}",
            source_session_id=source_session_id,
            importance=0,
        )
        extracted.append(mem)

    return extracted


def _serialize(row: StudentMemory) -> dict[str, Any]:
    """Serialize a StudentMemory ORM instance to a dict."""
    return {
        "id": row.id,
        "user_id": row.user_id,
        "memory_type": row.memory_type,
        "content": row.content,
        "source_session_id": row.source_session_id,
        "importance": row.importance,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
