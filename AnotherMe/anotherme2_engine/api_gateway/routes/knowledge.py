from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from ..config import Settings
from ..db import get_db
from ..knowledge_tracing_service import (
    generate_diagnostic_probe,
    get_agent_kt_context,
    get_knowledge_state_for_point,
    get_question_knowledge_mappings,
    get_student_knowledge_states,
    get_teaching_decision_for_point,
    get_teaching_decisions,
    list_knowledge_points,
    process_quiz_answer,
    set_question_knowledge_mapping,
    upsert_knowledge_point,
)
from ..schemas import (
    DiagnosticProbeInput,
    DiagnosticProbeOutput,
    KnowledgePointInput,
    KnowledgePointOutput,
    KnowledgeTracingSummaryOutput,
    ProcessQuizAnswerInput,
    QuestionKnowledgeMapInput,
    QuestionKnowledgeMapOutput,
    QuizAnswerResultOutput,
    StudentKnowledgeContextOutput,
    StudentKnowledgeStateOutput,
    TeachingDecisionOutput,
)
from .auth import require_token


def create_knowledge_router(settings: Settings) -> APIRouter:
    router = APIRouter()

    # ------------------------------------------------------------------
    # Knowledge Tracing APIs
    # ------------------------------------------------------------------

    @router.get("/v1/knowledge-points", response_model=list[KnowledgePointOutput])
    def list_knowledge_points_api(
        subject: str | None = Query(default=None),
        parent_id: str | None = Query(default=None),
        limit: int = Query(500, ge=1, le=1000),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        rows = list_knowledge_points(session=db, subject=subject, parent_id=parent_id, limit=limit)
        return [KnowledgePointOutput(**r) for r in rows]

    @router.post("/v1/knowledge-points", response_model=KnowledgePointOutput)
    def upsert_knowledge_point_api(
        request: KnowledgePointInput,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        row = upsert_knowledge_point(
            session=db,
            kp_id=request.kp_id,
            name=request.name,
            subject=request.subject,
            description=request.description,
            parent_id=request.parent_id,
            prerequisites=request.prerequisites,
            difficulty=request.difficulty,
        )
        db.commit()
        db.refresh(row)
        return KnowledgePointOutput(
            id=row.id,
            subject=row.subject,
            name=row.name,
            description=row.description,
            parent_id=row.parent_id,
            prerequisites=row.prerequisites or [],
            difficulty=row.difficulty,
            created_at=row.created_at.isoformat() if row.created_at else None,
        )

    @router.post("/v1/question-knowledge-map", response_model=QuestionKnowledgeMapOutput)
    def set_question_knowledge_map_api(
        request: QuestionKnowledgeMapInput,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        row = set_question_knowledge_mapping(
            session=db,
            question_id=request.question_id,
            knowledge_point_id=request.knowledge_point_id,
            weight=request.weight,
            difficulty=request.difficulty,
        )
        db.commit()
        db.refresh(row)
        return QuestionKnowledgeMapOutput(
            question_id=row.question_id,
            knowledge_point_id=row.knowledge_point_id,
            weight=row.weight,
            difficulty=row.difficulty,
        )

    @router.get("/v1/questions/{question_id}/knowledge-points", response_model=list[QuestionKnowledgeMapOutput])
    def get_question_knowledge_map_api(
        question_id: str,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        rows = get_question_knowledge_mappings(session=db, question_id=question_id)
        return [QuestionKnowledgeMapOutput(**r) for r in rows]

    @router.post("/v1/users/{user_id}/quiz-answers", response_model=list[QuizAnswerResultOutput])
    def process_quiz_answer_api(
        user_id: str,
        request: ProcessQuizAnswerInput,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        results = process_quiz_answer(
            session=db,
            user_id=user_id,
            question_id=request.question_id,
            is_correct=request.is_correct,
            knowledge_point_ids=request.knowledge_point_ids,
            payload=request.payload,
        )
        db.commit()
        return [QuizAnswerResultOutput(**r) for r in results]

    @router.get("/v1/users/{user_id}/knowledge-states", response_model=list[StudentKnowledgeStateOutput])
    def get_user_knowledge_states_api(
        user_id: str,
        knowledge_point_ids: list[str] | None = Query(default=None),
        min_mastery: float | None = Query(default=None, ge=0.0, le=1.0),
        limit: int = Query(200, ge=1, le=500),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        rows = get_student_knowledge_states(
            session=db,
            user_id=user_id,
            knowledge_point_ids=knowledge_point_ids,
            min_mastery=min_mastery,
            limit=limit,
        )
        return [StudentKnowledgeStateOutput(**r) for r in rows]

    @router.get("/v1/users/{user_id}/knowledge-states/{knowledge_point_id}", response_model=StudentKnowledgeStateOutput)
    def get_user_knowledge_state_for_point_api(
        user_id: str,
        knowledge_point_id: str,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        row = get_knowledge_state_for_point(session=db, user_id=user_id, knowledge_point_id=knowledge_point_id)
        if not row:
            raise HTTPException(status_code=404, detail={"error_code": "NOT_FOUND", "message": "Knowledge state not found"})
        return StudentKnowledgeStateOutput(**row)

    @router.get("/v1/users/{user_id}/teaching-decisions", response_model=list[TeachingDecisionOutput])
    def get_user_teaching_decisions_api(
        user_id: str,
        knowledge_point_ids: list[str] | None = Query(default=None),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        rows = get_teaching_decisions(session=db, user_id=user_id, knowledge_point_ids=knowledge_point_ids)
        return [TeachingDecisionOutput(**r) for r in rows]

    @router.get("/v1/users/{user_id}/teaching-decisions/{knowledge_point_id}", response_model=TeachingDecisionOutput)
    def get_user_teaching_decision_for_point_api(
        user_id: str,
        knowledge_point_id: str,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        row = get_teaching_decision_for_point(session=db, user_id=user_id, knowledge_point_id=knowledge_point_id)
        if not row:
            raise HTTPException(status_code=404, detail={"error_code": "NOT_FOUND", "message": "Teaching decision not found"})
        return TeachingDecisionOutput(**row)

    @router.get("/v1/users/{user_id}/knowledge-context/{knowledge_point_id}", response_model=StudentKnowledgeContextOutput)
    def get_user_knowledge_context_api(
        user_id: str,
        knowledge_point_id: str,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        context_text = get_agent_kt_context(session=db, user_id=user_id, knowledge_point_id=knowledge_point_id)
        return StudentKnowledgeContextOutput(context_text=context_text)

    @router.get("/v1/users/{user_id}/knowledge-tracing", response_model=KnowledgeTracingSummaryOutput)
    def get_user_knowledge_tracing_api(
        user_id: str,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        """Unified knowledge tracing endpoint: states + decisions + summary."""
        require_token(settings, authorization)
        states = get_student_knowledge_states(session=db, user_id=user_id, limit=500)
        decisions = get_teaching_decisions(session=db, user_id=user_id)

        # Sort by mastery ascending to find the weakest point
        weakest = None
        if states:
            sorted_states = sorted(states, key=lambda s: s["p_mastery"])
            weakest = sorted_states[0]

        mastered_count = sum(1 for s in states if s["p_mastery"] >= 0.85)
        weak_count = sum(1 for s in states if s["p_mastery"] < 0.5)
        review_count = sum(1 for s in states if 0.5 <= s["p_mastery"] < 0.85)

        return KnowledgeTracingSummaryOutput(
            user_id=user_id,
            knowledge_states=[StudentKnowledgeStateOutput(**s) for s in states],
            teaching_decisions=[TeachingDecisionOutput(**d) for d in decisions],
            weakest_knowledge_point=StudentKnowledgeStateOutput(**weakest) if weakest else None,
            summary={
                "total_points": len(states),
                "mastered_count": mastered_count,
                "weak_count": weak_count,
                "review_count": review_count,
            },
        )

    @router.post("/v1/users/{user_id}/diagnostic-probes", response_model=DiagnosticProbeOutput)
    def generate_diagnostic_probe_api(
        user_id: str,
        request: DiagnosticProbeInput,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        result = generate_diagnostic_probe(
            session=db,
            user_id=user_id,
            knowledge_point_id=request.knowledge_point_id,
            difficulty=request.difficulty,
            probe_type=request.probe_type,
        )
        return DiagnosticProbeOutput(**result)


    return router