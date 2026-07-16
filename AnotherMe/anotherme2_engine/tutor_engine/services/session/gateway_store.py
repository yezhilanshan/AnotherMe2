"""Unified SQLAlchemy-backed chat session store.

Tutor Engine used to keep an independent SQLite chat-history schema.  This
adapter preserves the async store API consumed by Tutor Engine runtime code,
but persists everything through API Gateway's SQLAlchemy models so standalone
and gateway paths share one data model.
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from api_gateway.db import init_db, nested_session_scope, reconfigure_db, session_scope
from api_gateway.models import (
    AIChatMessage,
    AIChatNotebookCategory,
    AIChatNotebookEntry,
    AIChatNotebookEntryCategory,
    AIChatSession,
    AIChatTurn,
    AIChatTurnEvent,
    AppUser,
)


DEFAULT_USER_ID = "local-tutor-engine"


def _ts(value: datetime | float | int | None) -> float:
    if value is None:
        return 0.0
    if isinstance(value, datetime):
        return value.timestamp()
    return float(value)


def _utcnow() -> datetime:
    return datetime.utcnow()


def _title_from_content(content: str) -> str:
    trimmed = (content or "").strip()
    if not trimmed:
        return "New conversation"
    return trimmed[:50] + ("..." if len(trimmed) > 50 else "")


class UnifiedSQLAlchemySessionStore:
    """Persist Tutor Engine sessions in API Gateway's unified database."""

    def __init__(
        self,
        db_path: Path | str | None = None,
        *,
        database_url: str | None = None,
        user_id: str | None = None,
    ) -> None:
        self.user_id = user_id or os.getenv("TUTOR_ENGINE_USER_ID", DEFAULT_USER_ID)
        if database_url:
            reconfigure_db(database_url)
        elif db_path is not None:
            resolved = Path(db_path).expanduser().resolve()
            resolved.parent.mkdir(parents=True, exist_ok=True)
            reconfigure_db(f"sqlite:///{resolved.as_posix()}")
        self._lock = asyncio.Lock()
        init_db()

    async def _run(self, fn, *args):
        async with self._lock:
            return await asyncio.to_thread(fn, *args)

    @staticmethod
    def _ensure_user(session, user_id: str) -> None:
        if session.get(AppUser, user_id) is not None:
            return
        user = AppUser(id=user_id, name="Tutor Engine")
        try:
            with nested_session_scope(session):
                session.add(user)
                session.flush([user])
        except IntegrityError:
            if session.get(AppUser, user_id) is None:
                raise

    @staticmethod
    def _serialize_session(
        item: AIChatSession,
        *,
        message_count: int | None = None,
        status: str = "idle",
        active_turn_id: str = "",
        capability: str = "",
        last_message: str = "",
    ) -> dict[str, Any]:
        payload = {
            "id": item.id,
            "session_id": item.id,
            "title": item.title,
            "created_at": _ts(item.created_at),
            "updated_at": _ts(item.updated_at),
            "compressed_summary": item.compressed_summary or "",
            "summary_up_to_msg_id": int(item.summary_up_to_msg_id or 0),
            "preferences": item.preferences_json or {},
            "status": status,
            "active_turn_id": active_turn_id,
            "capability": capability,
        }
        if message_count is not None:
            payload["message_count"] = int(message_count)
            payload["last_message"] = last_message
        return payload

    @staticmethod
    def _serialize_turn(item: AIChatTurn, last_seq: int = 0) -> dict[str, Any]:
        return {
            "id": item.id,
            "turn_id": item.id,
            "session_id": item.session_id,
            "capability": item.capability or "",
            "status": item.status or "running",
            "error": item.error or "",
            "created_at": _ts(item.created_at),
            "updated_at": _ts(item.updated_at),
            "finished_at": _ts(item.finished_at) if item.finished_at else None,
            "last_seq": int(last_seq or 0),
        }

    @staticmethod
    def _serialize_message(item: AIChatMessage) -> dict[str, Any]:
        return {
            "id": int(item.runtime_seq or 0),
            "message_id": item.id,
            "session_id": item.session_id,
            "role": item.role,
            "content": item.content or "",
            "capability": item.capability or "",
            "events": item.events_json or [],
            "attachments": item.attachments_json or [],
            "created_at": _ts(item.created_at),
        }

    def _create_session_sync(
        self, title: str | None = None, session_id: str | None = None
    ) -> dict[str, Any]:
        now = _utcnow()
        resolved_id = session_id or f"unified_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
        resolved_title = (title or "New conversation").strip() or "New conversation"
        with session_scope() as session:
            self._ensure_user(session, self.user_id)
            item = AIChatSession(
                id=resolved_id,
                user_id=self.user_id,
                title=resolved_title[:100],
                source="Tutor Engine",
                compressed_summary="",
                summary_up_to_msg_id=0,
                preferences_json={},
                created_at=now,
                updated_at=now,
            )
            session.add(item)
            session.flush([item])
            return self._serialize_session(item)

    async def create_session(
        self, title: str | None = None, session_id: str | None = None
    ) -> dict[str, Any]:
        return await self._run(self._create_session_sync, title, session_id)

    def _get_session_sync(self, session_id: str) -> dict[str, Any] | None:
        with session_scope() as session:
            item = session.get(AIChatSession, session_id)
            if item is None:
                return None
            latest_turn = (
                session.query(AIChatTurn)
                .filter(AIChatTurn.session_id == session_id)
                .order_by(AIChatTurn.updated_at.desc())
                .first()
            )
            active_turn = (
                session.query(AIChatTurn)
                .filter(AIChatTurn.session_id == session_id, AIChatTurn.status == "running")
                .order_by(AIChatTurn.updated_at.desc())
                .first()
            )
            return self._serialize_session(
                item,
                status=latest_turn.status if latest_turn else "idle",
                active_turn_id=active_turn.id if active_turn else "",
                capability=latest_turn.capability if latest_turn else "",
            )

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        return await self._run(self._get_session_sync, session_id)

    async def ensure_session(self, session_id: str | None = None) -> dict[str, Any]:
        if session_id:
            session = await self.get_session(session_id)
            if session is not None:
                return session
        return await self.create_session(session_id=session_id)

    def _create_turn_sync(self, session_id: str, capability: str = "") -> dict[str, Any]:
        now = _utcnow()
        turn_id = f"turn_{int(time.time() * 1000)}_{uuid.uuid4().hex[:10]}"
        with session_scope() as session:
            if session.get(AIChatSession, session_id) is None:
                raise ValueError(f"Session not found: {session_id}")
            active = (
                session.query(AIChatTurn)
                .filter(AIChatTurn.session_id == session_id, AIChatTurn.status == "running")
                .order_by(AIChatTurn.updated_at.desc())
                .first()
            )
            if active is not None:
                raise RuntimeError(f"Session already has an active turn: {active.id}")
            item = AIChatTurn(
                id=turn_id,
                session_id=session_id,
                capability=capability or "",
                status="running",
                error="",
                created_at=now,
                updated_at=now,
            )
            session.add(item)
            session.flush([item])
            return self._serialize_turn(item)

    async def create_turn(self, session_id: str, capability: str = "") -> dict[str, Any]:
        return await self._run(self._create_turn_sync, session_id, capability)

    def _turn_last_seq(self, session, turn_id: str) -> int:
        return int(
            session.query(func.coalesce(func.max(AIChatTurnEvent.seq), 0))
            .filter(AIChatTurnEvent.turn_id == turn_id)
            .scalar()
            or 0
        )

    def _get_turn_sync(self, turn_id: str) -> dict[str, Any] | None:
        with session_scope() as session:
            item = session.get(AIChatTurn, turn_id)
            if item is None:
                return None
            return self._serialize_turn(item, self._turn_last_seq(session, turn_id))

    async def get_turn(self, turn_id: str) -> dict[str, Any] | None:
        return await self._run(self._get_turn_sync, turn_id)

    def _get_active_turn_sync(self, session_id: str) -> dict[str, Any] | None:
        with session_scope() as session:
            item = (
                session.query(AIChatTurn)
                .filter(AIChatTurn.session_id == session_id, AIChatTurn.status == "running")
                .order_by(AIChatTurn.updated_at.desc())
                .first()
            )
            if item is None:
                return None
            return self._serialize_turn(item, self._turn_last_seq(session, item.id))

    async def get_active_turn(self, session_id: str) -> dict[str, Any] | None:
        return await self._run(self._get_active_turn_sync, session_id)

    def _list_active_turns_sync(self, session_id: str) -> list[dict[str, Any]]:
        with session_scope() as session:
            rows = (
                session.query(AIChatTurn)
                .filter(AIChatTurn.session_id == session_id, AIChatTurn.status == "running")
                .order_by(AIChatTurn.updated_at.desc())
                .all()
            )
            return [self._serialize_turn(item, self._turn_last_seq(session, item.id)) for item in rows]

    async def list_active_turns(self, session_id: str) -> list[dict[str, Any]]:
        return await self._run(self._list_active_turns_sync, session_id)

    def _update_turn_status_sync(self, turn_id: str, status: str, error: str = "") -> bool:
        with session_scope() as session:
            item = session.get(AIChatTurn, turn_id)
            if item is None:
                return False
            item.status = status
            item.error = error or ""
            item.updated_at = _utcnow()
            item.finished_at = item.updated_at if status in {"completed", "failed", "cancelled"} else None
            return True

    async def update_turn_status(self, turn_id: str, status: str, error: str = "") -> bool:
        return await self._run(self._update_turn_status_sync, turn_id, status, error)

    def _append_turn_event_sync(self, turn_id: str, event: dict[str, Any]) -> dict[str, Any]:
        now = _utcnow()
        with session_scope() as session:
            turn = session.get(AIChatTurn, turn_id)
            if turn is None:
                raise ValueError(f"Turn not found: {turn_id}")
            provided_seq = int(event.get("seq") or 0)
            seq = provided_seq if provided_seq > 0 else self._turn_last_seq(session, turn_id) + 1
            payload = dict(event)
            payload["seq"] = seq
            payload["turn_id"] = payload.get("turn_id") or turn_id
            payload["session_id"] = payload.get("session_id") or turn.session_id
            existing = (
                session.query(AIChatTurnEvent)
                .filter(AIChatTurnEvent.turn_id == turn_id, AIChatTurnEvent.seq == seq)
                .first()
            )
            if existing is None:
                existing = AIChatTurnEvent(turn_id=turn_id, session_id=turn.session_id, seq=seq)
                session.add(existing)
            existing.type = payload.get("type", "")
            existing.source = payload.get("source", "") or ""
            existing.stage = payload.get("stage", "") or ""
            existing.content = payload.get("content", "") or ""
            existing.event_metadata = payload.get("metadata", {}) or {}
            existing.timestamp = float(payload.get("timestamp") or time.time())
            existing.created_at = now
            turn.updated_at = now
            return payload

    async def append_turn_event(self, turn_id: str, event: dict[str, Any]) -> dict[str, Any]:
        return await self._run(self._append_turn_event_sync, turn_id, event)

    def _get_turn_events_sync(self, turn_id: str, after_seq: int = 0) -> list[dict[str, Any]]:
        with session_scope() as session:
            rows = (
                session.query(AIChatTurnEvent)
                .filter(AIChatTurnEvent.turn_id == turn_id, AIChatTurnEvent.seq > max(0, int(after_seq)))
                .order_by(AIChatTurnEvent.seq.asc())
                .all()
            )
            return [
                {
                    "type": item.type,
                    "source": item.source or "",
                    "stage": item.stage or "",
                    "content": item.content or "",
                    "metadata": item.event_metadata or {},
                    "session_id": item.session_id,
                    "turn_id": item.turn_id,
                    "seq": item.seq,
                    "timestamp": item.timestamp,
                }
                for item in rows
            ]

    async def get_turn_events(self, turn_id: str, after_seq: int = 0) -> list[dict[str, Any]]:
        return await self._run(self._get_turn_events_sync, turn_id, after_seq)

    def _update_session_title_sync(self, session_id: str, title: str) -> bool:
        with session_scope() as session:
            item = session.get(AIChatSession, session_id)
            if item is None:
                return False
            item.title = ((title or "").strip() or "New conversation")[:100]
            item.updated_at = _utcnow()
            return True

    async def update_session_title(self, session_id: str, title: str) -> bool:
        return await self._run(self._update_session_title_sync, session_id, title)

    def _delete_session_sync(self, session_id: str) -> bool:
        with session_scope() as session:
            item = session.get(AIChatSession, session_id)
            if item is None:
                return False
            entry_ids = [
                row[0]
                for row in session.query(AIChatNotebookEntry.id)
                .filter(AIChatNotebookEntry.session_id == session_id)
                .all()
            ]
            if entry_ids:
                session.query(AIChatNotebookEntryCategory).filter(
                    AIChatNotebookEntryCategory.entry_id.in_(entry_ids)
                ).delete(synchronize_session=False)
            for model in (
                AIChatNotebookEntry,
                AIChatTurnEvent,
                AIChatTurn,
                AIChatMessage,
            ):
                column = getattr(model, "session_id", None)
                if column is not None:
                    session.query(model).filter(column == session_id).delete(synchronize_session=False)
            session.delete(item)
            return True

    async def delete_session(self, session_id: str) -> bool:
        deleted = await self._run(self._delete_session_sync, session_id)
        if deleted:
            try:
                from tutor_engine.services.storage import get_attachment_store

                await get_attachment_store().delete_session(session_id)
            except Exception:
                pass
        return deleted

    def _next_message_seq(self, session, session_id: str) -> int:
        return int(
            session.query(func.coalesce(func.max(AIChatMessage.runtime_seq), 0))
            .filter(AIChatMessage.session_id == session_id)
            .scalar()
            or 0
        ) + 1

    def _add_message_sync(
        self,
        session_id: str,
        role: str,
        content: str,
        capability: str = "",
        events: list[dict[str, Any]] | None = None,
        attachments: list[dict[str, Any]] | None = None,
    ) -> int:
        now = _utcnow()
        with session_scope() as session:
            chat_session = session.get(AIChatSession, session_id)
            if chat_session is None:
                raise ValueError(f"Session not found: {session_id}")
            seq = self._next_message_seq(session, session_id)
            item = AIChatMessage(
                session_id=session_id,
                runtime_seq=seq,
                role=role,
                content=content or "",
                capability=capability or "",
                events_json=events or [],
                attachments_json=attachments or [],
                created_at=now,
            )
            session.add(item)
            if chat_session.title == "New conversation" and role == "user" and (content or "").strip():
                chat_session.title = _title_from_content(content)
            chat_session.updated_at = now
            session.flush([item])
            return seq

    async def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        capability: str = "",
        events: list[dict[str, Any]] | None = None,
        attachments: list[dict[str, Any]] | None = None,
    ) -> int:
        return await self._run(self._add_message_sync, session_id, role, content, capability, events, attachments)

    def _delete_message_sync(self, message_id: int | str) -> bool:
        with session_scope() as session:
            query = session.query(AIChatMessage)
            if str(message_id).isdigit():
                item = query.filter(AIChatMessage.runtime_seq == int(message_id)).first()
            else:
                item = session.get(AIChatMessage, str(message_id))
            if item is None:
                return False
            session.delete(item)
            return True

    async def delete_message(self, message_id: int | str) -> bool:
        return await self._run(self._delete_message_sync, message_id)

    def _get_last_message_sync(self, session_id: str, role: str | None = None) -> dict[str, Any] | None:
        with session_scope() as session:
            query = session.query(AIChatMessage).filter(AIChatMessage.session_id == session_id)
            if role is not None:
                query = query.filter(AIChatMessage.role == role)
            item = query.order_by(AIChatMessage.runtime_seq.desc(), AIChatMessage.created_at.desc()).first()
            return self._serialize_message(item) if item else None

    async def get_last_message(self, session_id: str, role: str | None = None) -> dict[str, Any] | None:
        return await self._run(self._get_last_message_sync, session_id, role)

    def _get_messages_sync(self, session_id: str) -> list[dict[str, Any]]:
        with session_scope() as session:
            rows = (
                session.query(AIChatMessage)
                .filter(AIChatMessage.session_id == session_id)
                .order_by(AIChatMessage.runtime_seq.asc(), AIChatMessage.created_at.asc())
                .all()
            )
            return [self._serialize_message(item) for item in rows]

    async def get_messages(self, session_id: str) -> list[dict[str, Any]]:
        return await self._run(self._get_messages_sync, session_id)

    def _get_messages_for_context_sync(self, session_id: str) -> list[dict[str, Any]]:
        return [
            {"id": item["id"], "role": item["role"], "content": item["content"]}
            for item in self._get_messages_sync(session_id)
            if item["role"] in {"user", "assistant", "system"}
        ]

    async def get_messages_for_context(self, session_id: str) -> list[dict[str, Any]]:
        return await self._run(self._get_messages_for_context_sync, session_id)

    def _list_sessions_sync(self, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        with session_scope() as session:
            rows = (
                session.query(AIChatSession)
                .filter(AIChatSession.user_id == self.user_id)
                .order_by(AIChatSession.updated_at.desc())
                .limit(max(1, int(limit)))
                .offset(max(0, int(offset)))
                .all()
            )
            result: list[dict[str, Any]] = []
            for item in rows:
                message_count = (
                    session.query(func.count(AIChatMessage.id))
                    .filter(AIChatMessage.session_id == item.id)
                    .scalar()
                    or 0
                )
                latest_turn = (
                    session.query(AIChatTurn)
                    .filter(AIChatTurn.session_id == item.id)
                    .order_by(AIChatTurn.updated_at.desc())
                    .first()
                )
                active_turn = (
                    session.query(AIChatTurn)
                    .filter(AIChatTurn.session_id == item.id, AIChatTurn.status == "running")
                    .order_by(AIChatTurn.updated_at.desc())
                    .first()
                )
                last_message = (
                    session.query(AIChatMessage.content)
                    .filter(AIChatMessage.session_id == item.id, AIChatMessage.content != "")
                    .order_by(AIChatMessage.runtime_seq.desc(), AIChatMessage.created_at.desc())
                    .limit(1)
                    .scalar()
                    or ""
                )
                result.append(
                    self._serialize_session(
                        item,
                        message_count=int(message_count),
                        status=latest_turn.status if latest_turn else "idle",
                        active_turn_id=active_turn.id if active_turn else "",
                        capability=latest_turn.capability if latest_turn else "",
                        last_message=last_message,
                    )
                )
            return result

    async def list_sessions(self, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        return await self._run(self._list_sessions_sync, limit, offset)

    def list_session_ids_sync(self, limit: int = 10000) -> set[str]:
        with session_scope() as session:
            rows = (
                session.query(AIChatSession.id)
                .filter(AIChatSession.user_id == self.user_id)
                .order_by(AIChatSession.updated_at.desc())
                .limit(max(1, int(limit)))
                .all()
            )
            return {row[0] for row in rows}

    def _update_summary_sync(self, session_id: str, summary: str, up_to_msg_id: int) -> bool:
        with session_scope() as session:
            item = session.get(AIChatSession, session_id)
            if item is None:
                return False
            item.compressed_summary = summary or ""
            item.summary_up_to_msg_id = max(0, int(up_to_msg_id))
            return True

    async def update_summary(self, session_id: str, summary: str, up_to_msg_id: int) -> bool:
        return await self._run(self._update_summary_sync, session_id, summary, up_to_msg_id)

    def _update_session_preferences_sync(self, session_id: str, preferences: dict[str, Any]) -> bool:
        with session_scope() as session:
            item = session.get(AIChatSession, session_id)
            if item is None:
                return False
            item.preferences_json = {**(item.preferences_json or {}), **(preferences or {})}
            item.updated_at = _utcnow()
            return True

    async def update_session_preferences(self, session_id: str, preferences: dict[str, Any]) -> bool:
        return await self._run(self._update_session_preferences_sync, session_id, preferences)

    async def get_session_with_messages(self, session_id: str) -> dict[str, Any] | None:
        session = await self.get_session(session_id)
        if session is None:
            return None
        session["messages"] = await self.get_messages(session_id)
        session["active_turns"] = await self.list_active_turns(session_id)
        return session

    @staticmethod
    def _serialize_notebook_entry(item: AIChatNotebookEntry, session_title: str = "") -> dict[str, Any]:
        return {
            "id": int(item.id),
            "session_id": item.session_id,
            "session_title": session_title,
            "question_id": item.question_id or "",
            "question": item.question,
            "question_type": item.question_type or "",
            "options": item.options_json or {},
            "correct_answer": item.correct_answer or "",
            "explanation": item.explanation or "",
            "difficulty": item.difficulty or "",
            "user_answer": item.user_answer or "",
            "is_correct": bool(item.is_correct),
            "bookmarked": bool(item.bookmarked),
            "followup_session_id": item.followup_session_id or "",
            "created_at": _ts(item.created_at),
            "updated_at": _ts(item.updated_at),
        }

    def _upsert_notebook_entries_sync(self, session_id: str, items: list[dict[str, Any]]) -> int:
        if not items:
            return 0
        with session_scope() as session:
            if session.get(AIChatSession, session_id) is None:
                raise ValueError(f"Session not found: {session_id}")
            upserted = 0
            for item in items:
                question = (item.get("question") or "").strip()
                question_id = (item.get("question_id") or "").strip()
                if not question or not question_id:
                    continue
                existing = (
                    session.query(AIChatNotebookEntry)
                    .filter(AIChatNotebookEntry.session_id == session_id, AIChatNotebookEntry.question_id == question_id)
                    .first()
                )
                if existing is None:
                    existing = AIChatNotebookEntry(session_id=session_id, question_id=question_id, question=question)
                    session.add(existing)
                existing.question = question
                existing.question_type = item.get("question_type") or ""
                existing.options_json = item.get("options") or {}
                existing.correct_answer = item.get("correct_answer") or ""
                existing.explanation = item.get("explanation") or ""
                existing.difficulty = item.get("difficulty") or ""
                existing.user_answer = item.get("user_answer") or ""
                existing.is_correct = bool(item.get("is_correct"))
                existing.updated_at = _utcnow()
                upserted += 1
            return upserted

    async def upsert_notebook_entries(self, session_id: str, items: list[dict[str, Any]]) -> int:
        return await self._run(self._upsert_notebook_entries_sync, session_id, items)

    def _list_notebook_entries_sync(
        self,
        category_id: int | None,
        bookmarked: bool | None,
        is_correct: bool | None,
        limit: int,
        offset: int,
    ) -> dict[str, Any]:
        with session_scope() as session:
            query = session.query(AIChatNotebookEntry, AIChatSession.title).outerjoin(
                AIChatSession, AIChatSession.id == AIChatNotebookEntry.session_id
            )
            count_query = session.query(AIChatNotebookEntry)
            if category_id is not None:
                query = query.join(AIChatNotebookEntryCategory, AIChatNotebookEntryCategory.entry_id == AIChatNotebookEntry.id)
                count_query = count_query.join(AIChatNotebookEntryCategory, AIChatNotebookEntryCategory.entry_id == AIChatNotebookEntry.id)
                query = query.filter(AIChatNotebookEntryCategory.category_id == int(category_id))
                count_query = count_query.filter(AIChatNotebookEntryCategory.category_id == int(category_id))
            if bookmarked is not None:
                query = query.filter(AIChatNotebookEntry.bookmarked == bool(bookmarked))
                count_query = count_query.filter(AIChatNotebookEntry.bookmarked == bool(bookmarked))
            if is_correct is not None:
                query = query.filter(AIChatNotebookEntry.is_correct == bool(is_correct))
                count_query = count_query.filter(AIChatNotebookEntry.is_correct == bool(is_correct))
            total = int(count_query.count())
            rows = (
                query.order_by(AIChatNotebookEntry.created_at.desc())
                .limit(max(1, int(limit)))
                .offset(max(0, int(offset)))
                .all()
            )
            return {
                "items": [self._serialize_notebook_entry(item, title or "") for item, title in rows],
                "total": total,
            }

    async def list_notebook_entries(
        self,
        category_id: int | None = None,
        bookmarked: bool | None = None,
        is_correct: bool | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        return await self._run(self._list_notebook_entries_sync, category_id, bookmarked, is_correct, limit, offset)

    def _get_notebook_entry_sync(self, entry_id: int) -> dict[str, Any] | None:
        with session_scope() as session:
            row = (
                session.query(AIChatNotebookEntry, AIChatSession.title)
                .outerjoin(AIChatSession, AIChatSession.id == AIChatNotebookEntry.session_id)
                .filter(AIChatNotebookEntry.id == int(entry_id))
                .first()
            )
            if row is None:
                return None
            item, title = row
            payload = self._serialize_notebook_entry(item, title or "")
            cats = (
                session.query(AIChatNotebookCategory)
                .join(AIChatNotebookEntryCategory, AIChatNotebookEntryCategory.category_id == AIChatNotebookCategory.id)
                .filter(AIChatNotebookEntryCategory.entry_id == int(entry_id))
                .order_by(AIChatNotebookCategory.name.asc())
                .all()
            )
            payload["categories"] = [{"id": cat.id, "name": cat.name} for cat in cats]
            return payload

    async def get_notebook_entry(self, entry_id: int) -> dict[str, Any] | None:
        return await self._run(self._get_notebook_entry_sync, entry_id)

    def _find_notebook_entry_sync(self, session_id: str, question_id: str) -> dict[str, Any] | None:
        with session_scope() as session:
            row = (
                session.query(AIChatNotebookEntry, AIChatSession.title)
                .outerjoin(AIChatSession, AIChatSession.id == AIChatNotebookEntry.session_id)
                .filter(AIChatNotebookEntry.session_id == session_id, AIChatNotebookEntry.question_id == question_id)
                .first()
            )
            if row is None:
                return None
            item, title = row
            return self._serialize_notebook_entry(item, title or "")

    async def find_notebook_entry(self, session_id: str, question_id: str) -> dict[str, Any] | None:
        return await self._run(self._find_notebook_entry_sync, session_id, question_id)

    def _update_notebook_entry_sync(self, entry_id: int, updates: dict[str, Any]) -> bool:
        allowed = {"bookmarked", "followup_session_id", "user_answer", "is_correct"}
        with session_scope() as session:
            item = session.get(AIChatNotebookEntry, int(entry_id))
            if item is None:
                return False
            changed = False
            for key, value in (updates or {}).items():
                if key not in allowed:
                    continue
                setattr(item, key, bool(value) if key in {"bookmarked", "is_correct"} else str(value or ""))
                changed = True
            if changed:
                item.updated_at = _utcnow()
            return changed

    async def update_notebook_entry(self, entry_id: int, updates: dict[str, Any]) -> bool:
        return await self._run(self._update_notebook_entry_sync, entry_id, updates)

    def _delete_notebook_entry_sync(self, entry_id: int) -> bool:
        with session_scope() as session:
            item = session.get(AIChatNotebookEntry, int(entry_id))
            if item is None:
                return False
            session.query(AIChatNotebookEntryCategory).filter(AIChatNotebookEntryCategory.entry_id == int(entry_id)).delete(synchronize_session=False)
            session.delete(item)
            return True

    async def delete_notebook_entry(self, entry_id: int) -> bool:
        return await self._run(self._delete_notebook_entry_sync, entry_id)

    def _create_category_sync(self, name: str) -> dict[str, Any]:
        resolved = (name or "").strip()
        with session_scope() as session:
            item = AIChatNotebookCategory(name=resolved)
            session.add(item)
            session.flush([item])
            return {"id": int(item.id), "name": item.name, "created_at": _ts(item.created_at)}

    async def create_category(self, name: str) -> dict[str, Any]:
        return await self._run(self._create_category_sync, name)

    def _list_categories_sync(self) -> list[dict[str, Any]]:
        with session_scope() as session:
            rows = (
                session.query(AIChatNotebookCategory)
                .order_by(AIChatNotebookCategory.name.asc())
                .all()
            )
            result = []
            for item in rows:
                count = (
                    session.query(func.count(AIChatNotebookEntryCategory.entry_id))
                    .filter(AIChatNotebookEntryCategory.category_id == item.id)
                    .scalar()
                    or 0
                )
                result.append({"id": item.id, "name": item.name, "created_at": _ts(item.created_at), "entry_count": int(count)})
            return result

    async def list_categories(self) -> list[dict[str, Any]]:
        return await self._run(self._list_categories_sync)

    def _rename_category_sync(self, category_id: int, name: str) -> bool:
        with session_scope() as session:
            item = session.get(AIChatNotebookCategory, int(category_id))
            if item is None:
                return False
            item.name = (name or "").strip()
            return True

    async def rename_category(self, category_id: int, name: str) -> bool:
        return await self._run(self._rename_category_sync, category_id, name)

    def _delete_category_sync(self, category_id: int) -> bool:
        with session_scope() as session:
            item = session.get(AIChatNotebookCategory, int(category_id))
            if item is None:
                return False
            session.query(AIChatNotebookEntryCategory).filter(AIChatNotebookEntryCategory.category_id == int(category_id)).delete(synchronize_session=False)
            session.delete(item)
            return True

    async def delete_category(self, category_id: int) -> bool:
        return await self._run(self._delete_category_sync, category_id)

    def _add_entry_to_category_sync(self, entry_id: int, category_id: int) -> bool:
        with session_scope() as session:
            if session.get(AIChatNotebookEntry, int(entry_id)) is None:
                return False
            if session.get(AIChatNotebookCategory, int(category_id)) is None:
                return False
            existing = (
                session.query(AIChatNotebookEntryCategory)
                .filter(AIChatNotebookEntryCategory.entry_id == int(entry_id), AIChatNotebookEntryCategory.category_id == int(category_id))
                .first()
            )
            if existing is not None:
                return True
            try:
                with nested_session_scope(session):
                    session.add(AIChatNotebookEntryCategory(entry_id=int(entry_id), category_id=int(category_id)))
                    session.flush()
                return True
            except IntegrityError:
                return False

    async def add_entry_to_category(self, entry_id: int, category_id: int) -> bool:
        return await self._run(self._add_entry_to_category_sync, entry_id, category_id)

    def _remove_entry_from_category_sync(self, entry_id: int, category_id: int) -> bool:
        with session_scope() as session:
            deleted = (
                session.query(AIChatNotebookEntryCategory)
                .filter(AIChatNotebookEntryCategory.entry_id == int(entry_id), AIChatNotebookEntryCategory.category_id == int(category_id))
                .delete(synchronize_session=False)
            )
            return deleted > 0

    async def remove_entry_from_category(self, entry_id: int, category_id: int) -> bool:
        return await self._run(self._remove_entry_from_category_sync, entry_id, category_id)

    def _get_entry_categories_sync(self, entry_id: int) -> list[dict[str, Any]]:
        with session_scope() as session:
            rows = (
                session.query(AIChatNotebookCategory)
                .join(AIChatNotebookEntryCategory, AIChatNotebookEntryCategory.category_id == AIChatNotebookCategory.id)
                .filter(AIChatNotebookEntryCategory.entry_id == int(entry_id))
                .order_by(AIChatNotebookCategory.name.asc())
                .all()
            )
            return [{"id": item.id, "name": item.name} for item in rows]

    async def get_entry_categories(self, entry_id: int) -> list[dict[str, Any]]:
        return await self._run(self._get_entry_categories_sync, entry_id)


_instance: UnifiedSQLAlchemySessionStore | None = None


def get_unified_session_store() -> UnifiedSQLAlchemySessionStore:
    global _instance
    if _instance is None:
        _instance = UnifiedSQLAlchemySessionStore()
    return _instance


__all__ = ["UnifiedSQLAlchemySessionStore", "get_unified_session_store"]
