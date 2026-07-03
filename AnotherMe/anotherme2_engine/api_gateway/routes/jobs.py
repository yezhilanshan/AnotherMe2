from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import Settings
from ..db import get_db
from ..job_service import (
    cancel_job,
    create_or_get_job,
    get_problem_job_result_payload,
    mark_job_enqueue_failed,
    reconcile_single_running_problem_video_job_with_artifacts,
    serialize_job,
)
from ..models import Job, JobEvent
from ..queueing import QueueMessage
from ..schemas import CreateJobRequest, JobResultResponse, JobStatus, JobSummary
from .auth import require_token


def _resolve_vision_api_key(payload: dict) -> str:
    """Resolve a Vision LLM API key from payload llm_config or environment."""
    import os

    raw = payload.get("llm_config")
    llm_cfg: dict = raw if isinstance(raw, dict) else {}
    return str(
        llm_cfg.get("api_key")
        or llm_cfg.get("apiKey")
        or os.getenv("DASHSCOPE_API_KEY", "")
        or os.getenv("BAILIAN_API_KEY", "")
        or os.getenv("QWEN_API_KEY", "")
        or os.getenv("ARK_API_KEY", "")
    ).strip()


def _check_photo_manim_direct_prerequisites(request: CreateJobRequest) -> None:
    """Validate that photo_manim_direct jobs have the required Vision LLM config."""
    if request.job_type.value != "photo_manim_direct":
        return
    api_key = _resolve_vision_api_key(request.payload)
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "VISION_API_KEY_MISSING",
                "message": (
                    "AI 直出模式需要 Vision LLM API Key。"
                    "请在服务端设置 DASHSCOPE_API_KEY / BAILIAN_API_KEY / QWEN_API_KEY 环境变量，"
                    "或切换到完整讲解模式（无需额外的 Vision API）。"
                ),
            },
        )


def create_jobs_router(
    settings: Settings, queue_client, check_capability: Callable[[str], None]
) -> APIRouter:
    router = APIRouter(tags=["jobs"])

    @router.post("/v1/jobs", response_model=JobSummary)
    def create_job(
        request: CreateJobRequest,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        capability_map = {
            "course_generate": "course_generate",
            "problem_video_generate": "problem_video_generate",
            "photo_manim_direct": "problem_video_generate",
            "study_package_generate": "course_generate",
            "learning_record_extract": "ai_tutor_chat",
        }
        capability_id = capability_map.get(request.job_type)
        if capability_id:
            check_capability(capability_id)
        _check_photo_manim_direct_prerequisites(request)
        try:
            job, created = create_or_get_job(db, request, settings)
            db.commit()
            db.refresh(job)
            if created:
                try:
                    queue_client.enqueue(
                        job.queue_name,
                        QueueMessage(
                            job_id=job.id,
                            job_type=job.job_type,
                            queue_name=job.queue_name,
                        ),
                    )
                except Exception as enqueue_exc:
                    message = f"Failed to enqueue job {job.id} on queue {job.queue_name}: {enqueue_exc}"
                    print(f"[gateway-app] {message}", flush=True)
                    mark_job_enqueue_failed(db, job, message)
                    db.commit()
                    raise HTTPException(
                        status_code=503,
                        detail={"error_code": "JOB_ENQUEUE_FAILED", "message": message},
                    )
            return JobSummary(**serialize_job(job))
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail={
                    "error_code": "JOB_CONFLICT",
                    "message": "Concurrent duplicate job submission detected",
                },
            )
        except HTTPException:
            raise
        except Exception as exc:
            db.rollback()
            raise HTTPException(
                status_code=400,
                detail={"error_code": "INVALID_JOB_PAYLOAD", "message": str(exc)},
            )

    @router.get("/v1/jobs/{job_id}", response_model=JobSummary)
    def get_job(
        job_id: str,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        job = db.get(Job, job_id)
        if not job:
            raise HTTPException(
                status_code=404,
                detail={"error_code": "JOB_NOT_FOUND", "message": "Job not found"},
            )
        if reconcile_single_running_problem_video_job_with_artifacts(db, job):
            db.commit()
            db.refresh(job)
        return JobSummary(**serialize_job(job))

    @router.get("/v1/jobs/{job_id}/result", response_model=JobResultResponse)
    def get_job_result(
        job_id: str,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        job = db.get(Job, job_id)
        if not job:
            raise HTTPException(
                status_code=404,
                detail={"error_code": "JOB_NOT_FOUND", "message": "Job not found"},
            )

        if (
            job.status == JobStatus.RUNNING.value
            and reconcile_single_running_problem_video_job_with_artifacts(db, job)
        ):
            db.commit()
            db.refresh(job)

        if job.status != JobStatus.SUCCEEDED.value:
            raise HTTPException(
                status_code=409,
                detail={
                    "error_code": "JOB_NOT_READY",
                    "message": f"Job status={job.status}",
                },
            )

        result = (
            get_problem_job_result_payload(job)
            if job.job_type in ("problem_video_generate", "photo_manim_direct")
            else (job.result_payload or {})
        )
        return JobResultResponse(
            job_id=job.id, status=JobStatus(job.status), result=result
        )

    @router.get("/v1/jobs/{job_id}/trace-events")
    def get_job_trace_events(
        job_id: str,
        event_type: str | None = Query(default=None),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        job = db.get(Job, job_id)
        if not job:
            raise HTTPException(
                status_code=404,
                detail={"error_code": "JOB_NOT_FOUND", "message": "Job not found"},
            )

        query = db.query(JobEvent).filter(JobEvent.job_id == job_id)
        if event_type:
            query = query.filter(JobEvent.trace_event_type == event_type)
        else:
            query = query.filter(JobEvent.trace_event_type.isnot(None))

        events = query.order_by(JobEvent.created_at.asc()).all()
        return [
            {
                "id": e.trace_event_id,
                "type": e.trace_event_type,
                "event_type": e.event_type,
                "message": e.message,
                "payload": e.payload,
                "created_at": e.created_at.isoformat(),
            }
            for e in events
            if e.trace_event_type is not None
        ]

    @router.delete("/v1/jobs/{job_id}", response_model=JobSummary)
    def cancel_job_endpoint(
        job_id: str,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        """Cancel a non-terminal job by marking it as failed."""
        require_token(settings, authorization)
        job = db.get(Job, job_id)
        if not job:
            raise HTTPException(
                status_code=404,
                detail={"error_code": "JOB_NOT_FOUND", "message": "Job not found"},
            )
        cancel_job(db, job)
        db.commit()
        db.refresh(job)
        return JobSummary(**serialize_job(job))

    return router
