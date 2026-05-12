from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.orm import Session

from ..chat_service import (
    create_ai_message,
    create_ai_session,
    create_learning_event,
    get_learning_event_stats,
    get_student_profile_snapshot,
    list_ai_messages,
    list_ai_sessions,
    list_learning_events,
    list_learning_records,
    serialize_ai_feedback,
    serialize_ai_message,
    serialize_ai_session,
    serialize_learning_event,
    upsert_ai_feedback,
)
from ..config import Settings
from ..db import get_db
from ..schemas import (
    AIChatMessageOutput,
    AIChatSessionSummary,
    AIMessageFeedbackOutput,
    AIMessageFeedbackRequest,
    CreateAIChatMessageRequest,
    CreateAIChatSessionRequest,
    CreateLearningEventRequest,
    LearningEventOutput,
    LearningEventStatsOutput,
    LearningRecordOutput,
    StudentProfileOutput,
)
from .auth import require_token


def create_ai_learning_router(settings: Settings) -> APIRouter:
    router = APIRouter()

    @router.get("/v1/ai/sessions", response_model=list[AIChatSessionSummary])
    def get_ai_sessions(
        user_id: str = Query(..., min_length=1),
        limit: int = Query(50, ge=1, le=200),
        linked_conversation_id: str | None = Query(default=None),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        rows = list_ai_sessions(
            db,
            user_id=user_id,
            limit=limit,
            linked_conversation_id=linked_conversation_id,
        )
        return [AIChatSessionSummary(**row) for row in rows]

    @router.post("/v1/ai/sessions", response_model=AIChatSessionSummary)
    def create_ai_session_api(
        request: CreateAIChatSessionRequest,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        row = create_ai_session(
            db,
            user_id=request.user_id,
            title=request.title,
            source=request.source,
            subject=request.subject,
            linked_classroom_id=request.linked_classroom_id,
            linked_conversation_id=request.linked_conversation_id,
        )
        db.commit()
        db.refresh(row)
        return AIChatSessionSummary(**serialize_ai_session(row))

    @router.get("/v1/ai/sessions/{session_id}/messages", response_model=list[AIChatMessageOutput])
    def get_ai_messages(
        session_id: str,
        limit: int = Query(200, ge=1, le=500),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        rows = list_ai_messages(db, session_id=session_id, limit=limit)
        return [AIChatMessageOutput(**row) for row in rows]

    @router.get("/v1/ai/sessions/{session_id}/learning-records", response_model=list[LearningRecordOutput])
    def get_ai_learning_records(
        session_id: str,
        user_id: str | None = Query(default=None, min_length=1),
        limit: int = Query(200, ge=1, le=500),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        rows = list_learning_records(
            db,
            session_id=session_id,
            user_id=user_id,
            limit=limit,
        )
        return [LearningRecordOutput(**row) for row in rows]

    @router.post("/v1/ai/sessions/{session_id}/messages", response_model=AIChatMessageOutput)
    def create_ai_message_api(
        session_id: str,
        request: CreateAIChatMessageRequest,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        row = create_ai_message(
            db,
            session_id=session_id,
            role=request.role,
            content=request.content,
            user_id=request.user_id,
            content_type=request.content_type,
            model_name=request.model_name,
            prompt_tokens=request.prompt_tokens,
            completion_tokens=request.completion_tokens,
            total_tokens=request.total_tokens,
            latency_ms=request.latency_ms,
            request_id=request.request_id,
            parent_message_id=request.parent_message_id,
        )
        db.commit()
        return AIChatMessageOutput(**serialize_ai_message(row))

    @router.get("/v1/students/{user_id}/profile", response_model=StudentProfileOutput)
    def get_student_profile_api(
        user_id: str,
        lookback_days: int = Query(120, ge=14, le=365),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        row = get_student_profile_snapshot(
            db,
            user_id=user_id,
            lookback_days=lookback_days,
        )
        return StudentProfileOutput(**row)

    @router.post("/v1/ai/messages/{message_id}/feedback", response_model=AIMessageFeedbackOutput)
    def upsert_ai_feedback_api(
        message_id: str,
        request: AIMessageFeedbackRequest,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        row = upsert_ai_feedback(
            db,
            message_id=message_id,
            user_id=request.user_id,
            rating=request.rating,
            feedback_text=request.feedback_text,
        )
        db.commit()
        return AIMessageFeedbackOutput(**serialize_ai_feedback(row))

    @router.post("/v1/learning-events", response_model=LearningEventOutput)
    def create_learning_event_api(
        request: CreateLearningEventRequest,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        if not request.user_id:
            raise HTTPException(
                status_code=400,
                detail={
                    "error_code": "INVALID_REQUEST",
                    "message": "user_id is required. Prefer POST /v1/users/{user_id}/learning-events.",
                },
            )
        row = create_learning_event(
            db,
            user_id=request.user_id,
            event_type=request.event_type,
            session_id=request.session_id,
            classroom_id=request.classroom_id,
            scene_id=request.scene_id,
            block_id=request.block_id,
            knowledge_points=request.knowledge_points,
            payload=request.payload,
            weight=request.weight or 1.0,
        )
        db.commit()
        db.refresh(row)
        return LearningEventOutput(**serialize_learning_event(row))

    @router.post("/v1/users/{user_id}/learning-events", response_model=LearningEventOutput)
    def create_learning_event_for_user_api(
        user_id: str,
        request: CreateLearningEventRequest,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        row = create_learning_event(
            db,
            user_id=user_id,
            event_type=request.event_type,
            session_id=request.session_id,
            classroom_id=request.classroom_id,
            scene_id=request.scene_id,
            block_id=request.block_id,
            knowledge_points=request.knowledge_points,
            payload=request.payload,
            weight=request.weight or 1.0,
        )
        db.commit()
        db.refresh(row)
        return LearningEventOutput(**serialize_learning_event(row))

    @router.get("/v1/users/{user_id}/learning-events", response_model=list[LearningEventOutput])
    def get_user_learning_events_api(
        user_id: str,
        event_type: str | None = Query(default=None),
        classroom_id: str | None = Query(default=None),
        scene_id: str | None = Query(default=None),
        limit: int = Query(200, ge=1, le=500),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        rows = list_learning_events(
            db,
            user_id=user_id,
            event_type=event_type,
            classroom_id=classroom_id,
            scene_id=scene_id,
            limit=limit,
        )
        return [LearningEventOutput(**row) for row in rows]

    @router.get("/v1/users/{user_id}/learning-events/stats", response_model=LearningEventStatsOutput)
    def get_user_learning_event_stats_api(
        user_id: str,
        classroom_id: str | None = Query(default=None),
        lookback_days: int = Query(30, ge=1, le=365),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        stats = get_learning_event_stats(
            db,
            user_id=user_id,
            classroom_id=classroom_id,
            lookback_days=lookback_days,
        )
        return LearningEventStatsOutput(**stats)


    return router