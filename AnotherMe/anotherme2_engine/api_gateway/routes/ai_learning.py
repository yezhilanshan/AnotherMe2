from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
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
from ..memory_service import (
    create_memory,
    delete_memory,
    extract_memories_from_turn,
    get_memory,
    get_memory_context,
    list_memories,
    merge_duplicate_memories,
    update_memory,
)
from ..metrics_service import (
    get_accuracy_trend,
    get_hint_usage_trend,
    get_learning_efficiency,
    get_mastery_progress,
    get_repeat_mistake_rate,
)
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


# ---- Memory request/response schemas ----

class CreateMemoryRequest(BaseModel):
    memory_type: str = Field(..., min_length=1, max_length=64)
    content: str = Field(..., min_length=1)
    source_session_id: str | None = None
    importance: int = Field(default=0, ge=-10, le=10)


class UpdateMemoryRequest(BaseModel):
    content: str | None = None
    importance: int | None = Field(default=None, ge=-10, le=10)


class MemoryOutput(BaseModel):
    id: str
    user_id: str
    memory_type: str
    content: str
    source_session_id: str | None
    importance: int
    created_at: str | None


class MemoryContextOutput(BaseModel):
    context: str | None


class ExtractMemoriesRequest(BaseModel):
    user_message: str
    assistant_message: str
    source_session_id: str | None = None


def create_ai_learning_router(settings: Settings) -> APIRouter:
    router = APIRouter(tags=["ai-learning"])

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
            capability=request.capability,
            events=request.events,
            attachments=request.attachments,
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

    # ======================== Student Memory endpoints ========================

    @router.post("/v1/users/{user_id}/memories", response_model=MemoryOutput)
    def create_user_memory(
        user_id: str,
        body: CreateMemoryRequest,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        mem = create_memory(
            db,
            user_id=user_id,
            memory_type=body.memory_type,
            content=body.content,
            source_session_id=body.source_session_id,
            importance=body.importance,
        )
        return MemoryOutput(**mem)

    @router.get("/v1/users/{user_id}/memories", response_model=list[MemoryOutput])
    def list_user_memories(
        user_id: str,
        memory_type: str | None = Query(default=None),
        limit: int = Query(50, ge=1, le=200),
        offset: int = Query(0, ge=0),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        rows = list_memories(
            db,
            user_id=user_id,
            memory_type=memory_type,
            limit=limit,
            offset=offset,
        )
        return [MemoryOutput(**r) for r in rows]

    @router.get("/v1/users/{user_id}/memories/{memory_id}", response_model=MemoryOutput)
    def get_user_memory(
        user_id: str,
        memory_id: str,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        mem = get_memory(db, user_id=user_id, memory_id=memory_id)
        if not mem:
            raise HTTPException(status_code=404, detail="Memory not found")
        return MemoryOutput(**mem)

    @router.put("/v1/users/{user_id}/memories/{memory_id}", response_model=MemoryOutput)
    def update_user_memory(
        user_id: str,
        memory_id: str,
        body: UpdateMemoryRequest,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        mem = update_memory(
            db,
            user_id=user_id,
            memory_id=memory_id,
            content=body.content,
            importance=body.importance,
        )
        if not mem:
            raise HTTPException(status_code=404, detail="Memory not found")
        return MemoryOutput(**mem)

    @router.delete("/v1/users/{user_id}/memories/{memory_id}")
    def delete_user_memory(
        user_id: str,
        memory_id: str,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        deleted = delete_memory(db, user_id=user_id, memory_id=memory_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Memory not found")
        return {"ok": True}

    @router.get("/v1/users/{user_id}/memory-context", response_model=MemoryContextOutput)
    def get_user_memory_context(
        user_id: str,
        max_chars: int = Query(6000, ge=500, le=20000),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        ctx = get_memory_context(db, user_id=user_id, max_chars=max_chars)
        return MemoryContextOutput(context=ctx)

    @router.post("/v1/users/{user_id}/memories/extract", response_model=list[MemoryOutput])
    def extract_user_memories(
        user_id: str,
        body: ExtractMemoriesRequest,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        extracted = extract_memories_from_turn(
            db,
            user_id=user_id,
            user_message=body.user_message,
            assistant_message=body.assistant_message,
            source_session_id=body.source_session_id,
        )
        return [MemoryOutput(**m) for m in extracted]

    @router.post("/v1/users/{user_id}/memories/merge")
    def merge_user_memories(
        user_id: str,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        removed = merge_duplicate_memories(db, user_id=user_id)
        return {"ok": True, "duplicates_removed": removed}

    # ======================== Metrics endpoints ========================

    @router.get("/v1/users/{user_id}/metrics/accuracy-trend")
    def get_user_accuracy_trend(
        user_id: str,
        knowledge_point_id: str | None = Query(default=None),
        days: int = Query(30, ge=1, le=365),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        return get_accuracy_trend(db, user_id=user_id, knowledge_point_id=knowledge_point_id, days=days)

    @router.get("/v1/users/{user_id}/metrics/mastery-progress")
    def get_user_mastery_progress(
        user_id: str,
        days: int = Query(30, ge=1, le=365),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        return get_mastery_progress(db, user_id=user_id, days=days)

    @router.get("/v1/users/{user_id}/metrics/repeat-mistakes")
    def get_user_repeat_mistakes(
        user_id: str,
        days: int = Query(30, ge=1, le=365),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        return get_repeat_mistake_rate(db, user_id=user_id, days=days)

    @router.get("/v1/users/{user_id}/metrics/hint-usage")
    def get_user_hint_usage(
        user_id: str,
        days: int = Query(30, ge=1, le=365),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        return get_hint_usage_trend(db, user_id=user_id, days=days)

    @router.get("/v1/users/{user_id}/metrics/learning-efficiency")
    def get_user_learning_efficiency(
        user_id: str,
        days: int = Query(30, ge=1, le=365),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        return get_learning_efficiency(db, user_id=user_id, days=days)

    return router
