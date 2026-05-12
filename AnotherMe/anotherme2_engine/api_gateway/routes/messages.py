from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, Header, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from .. import db as db_module
from ..chat_service import (
    add_conversation_members,
    create_conversation,
    create_message,
    delete_conversation,
    is_conversation_member,
    list_conversation_members,
    list_conversations,
    list_messages,
    mark_conversation_read,
    remove_conversation_member,
    serialize_conversation,
    serialize_message,
)
from ..config import Settings
from ..db import get_db
from ..models import Conversation, LiveBookJob, LiveBookJobEvent
from ..schemas import (
    AddConversationMembersRequest,
    ConversationMemberSummary,
    ConversationReadResponse,
    ConversationSummary,
    CreateConversationRequest,
    CreateMessageRequest,
    MarkConversationReadRequest,
    MessageOutput,
    RemoveConversationMemberRequest,
    RemoveConversationMemberResponse,
)
from .auth import require_token


def create_messages_router(settings: Settings, event_bus, conversation_hub) -> APIRouter:
    router = APIRouter()

    @router.get("/v1/messages/conversations", response_model=list[ConversationSummary])
    def get_conversations(
        user_id: str = Query(..., min_length=1),
        limit: int = Query(50, ge=1, le=200),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        return [ConversationSummary(**row) for row in list_conversations(db, user_id=user_id, limit=limit)]

    @router.post("/v1/messages/conversations", response_model=ConversationSummary)
    def create_conversation_api(
        request: CreateConversationRequest,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        conversation = create_conversation(
            db,
            user_id=request.user_id,
            conversation_type=request.type,
            name=request.name,
            creator_id=request.creator_id,
            member_ids=request.member_ids,
        )
        db.commit()
        db.refresh(conversation)

        row = (
            db.query(Conversation)
            .filter(Conversation.id == conversation.id)
            .first()
        )
        return ConversationSummary(**serialize_conversation(row, unread_count=0))

    @router.delete("/v1/messages/conversations/{conversation_id}")
    def delete_conversation_api(
        conversation_id: str,
        request: RemoveConversationMemberRequest,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        result = delete_conversation(
            db,
            conversation_id=conversation_id,
            operator_user_id=request.operator_user_id,
        )
        db.commit()
        return result

    @router.get("/v1/messages/{conversation_id}/messages", response_model=list[MessageOutput])
    def get_messages(
        conversation_id: str,
        user_id: str = Query(..., min_length=1),
        limit: int = Query(100, ge=1, le=500),
        before_seq: int | None = Query(default=None),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        return [
            MessageOutput(**row)
            for row in list_messages(
                db,
                conversation_id,
                requester_user_id=user_id,
                limit=limit,
                before_seq=before_seq,
            )
        ]

    @router.post("/v1/messages/{conversation_id}/messages", response_model=MessageOutput)
    async def create_message_api(
        conversation_id: str,
        request: CreateMessageRequest,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        message, attachments = create_message(
            db,
            conversation_id=conversation_id,
            sender_id=request.sender_id,
            message_type=request.message_type,
            content=request.content,
            reply_to_message_id=request.reply_to_message_id,
            status=request.status,
            source_type=request.source_type,
            source_ref_id=request.source_ref_id,
            attachments=[
                item.model_dump() if hasattr(item, "model_dump") else item.dict()
                for item in request.attachments
            ],
        )
        db.commit()
        serialized = serialize_message(message, attachments)
        await event_bus.publish(
            conversation_id,
            {
                "type": "message_created",
                "conversation_id": conversation_id,
                "message": serialized,
            },
        )
        return MessageOutput(**serialized)

    @router.get("/v1/messages/{conversation_id}/members", response_model=list[ConversationMemberSummary])
    def get_conversation_members(
        conversation_id: str,
        user_id: str = Query(..., min_length=1),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        return [
            ConversationMemberSummary(**row)
            for row in list_conversation_members(db, conversation_id, requester_user_id=user_id)
        ]

    @router.post("/v1/messages/{conversation_id}/members", response_model=list[ConversationMemberSummary])
    async def add_conversation_members_api(
        conversation_id: str,
        request: AddConversationMembersRequest,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        rows = add_conversation_members(
            db,
            conversation_id=conversation_id,
            operator_user_id=request.operator_user_id,
            member_ids=request.member_ids,
        )
        db.commit()
        await event_bus.publish(
            conversation_id,
            {
                "type": "members_updated",
                "conversation_id": conversation_id,
                "members": rows,
            },
        )
        return [ConversationMemberSummary(**row) for row in rows]

    @router.delete("/v1/messages/{conversation_id}/members/{member_user_id}", response_model=RemoveConversationMemberResponse)
    async def remove_conversation_member_api(
        conversation_id: str,
        member_user_id: str,
        request: RemoveConversationMemberRequest,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        result = remove_conversation_member(
            db,
            conversation_id=conversation_id,
            operator_user_id=request.operator_user_id,
            member_user_id=member_user_id,
        )
        rows = list_conversation_members(db, conversation_id)
        db.commit()
        await event_bus.publish(
            conversation_id,
            {
                "type": "members_updated",
                "conversation_id": conversation_id,
                "members": rows,
            },
        )
        await event_bus.publish(
            conversation_id,
            {
                "type": "disconnect_user",
                "conversation_id": conversation_id,
                "user_id": member_user_id,
            },
        )
        return RemoveConversationMemberResponse(**result)

    @router.websocket("/ws/messages/{conversation_id}")
    async def conversation_ws(
        websocket: WebSocket,
        conversation_id: str,
        user_id: str = Query(..., min_length=1),
    ):
        session_factory = db_module.SessionLocal
        if session_factory is None:
            await websocket.close(code=1011)
            return

        check_session = session_factory()
        try:
            if not is_conversation_member(check_session, conversation_id, user_id):
                await websocket.close(code=4403)
                return
        finally:
            check_session.close()

        await conversation_hub.connect(conversation_id, user_id, websocket)
        try:
            await websocket.send_json(
                {
                    "type": "connected",
                    "conversation_id": conversation_id,
                    "user_id": user_id,
                }
            )
            while True:
                content = await websocket.receive_text()
                if content.strip().lower() == "ping":
                    await websocket.send_json({"type": "pong", "conversation_id": conversation_id})
        except WebSocketDisconnect:
            pass
        finally:
            await conversation_hub.disconnect(conversation_id, user_id, websocket)

    @router.websocket("/api/live-book/ws")
    async def live_book_ws(
        websocket: WebSocket,
        book_id: str = Query(..., min_length=1),
    ):
        """WebSocket stream for live-book job events.

        The Next.js app exposes SSE endpoints for serverless compatibility; the
        gateway exposes the strict WS contract for runtimes that support socket
        upgrades.
        """

        session_factory = db_module.SessionLocal
        if session_factory is None:
            await websocket.close(code=1011)
            return

        await websocket.accept()

        def serialize_event(event: LiveBookJobEvent) -> dict:
            return {
                "id": event.id,
                "type": event.type,
                "stage": event.stage,
                "message": event.message,
                "progress": event.progress,
                "timestamp": event.created_at.isoformat(),
                "metadata": event.event_metadata or {},
            }

        last_event_created_at = None
        try:
            await websocket.send_json({"type": "connected", "book_id": book_id})
            while True:
                db_session = session_factory()
                try:
                    job = (
                        db_session.query(LiveBookJob)
                        .filter(LiveBookJob.book_id == book_id)
                        .order_by(LiveBookJob.created_at.desc())
                        .first()
                    )
                    if job is not None:
                        query = (
                            db_session.query(LiveBookJobEvent)
                            .filter(LiveBookJobEvent.job_id == job.id)
                            .order_by(LiveBookJobEvent.created_at.asc())
                        )
                        if last_event_created_at is not None:
                            query = query.filter(LiveBookJobEvent.created_at > last_event_created_at)
                        events = query.all()
                        for event in events:
                            await websocket.send_json(serialize_event(event))
                            last_event_created_at = event.created_at
                finally:
                    db_session.close()

                try:
                    message = await asyncio.wait_for(websocket.receive_text(), timeout=1.0)
                    if message.strip().lower() == "ping":
                        await websocket.send_json({"type": "pong", "book_id": book_id})
                except asyncio.TimeoutError:
                    continue
        except WebSocketDisconnect:
            pass

    @router.post("/v1/messages/{conversation_id}/read", response_model=ConversationReadResponse)
    def mark_read_api(
        conversation_id: str,
        request: MarkConversationReadRequest,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        result = mark_conversation_read(
            db,
            conversation_id=conversation_id,
            user_id=request.user_id,
            last_read_seq=request.last_read_seq,
        )
        db.commit()
        return ConversationReadResponse(**result)


    return router