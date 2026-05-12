from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import Settings
from ..db import get_db
from ..job_service import (
    create_or_get_job,
    mark_job_enqueue_failed,
    reconcile_single_running_problem_video_job_with_artifacts,
    serialize_job,
)
from ..models import Job, JobEvent
from ..queueing import QueueMessage
from ..schemas import CreateJobRequest, JobResultResponse, JobStatus, JobSummary
from .auth import require_token


def create_jobs_router(settings: Settings, queue_client, check_capability: Callable[[str], None]) -> APIRouter:
    router = APIRouter()

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
            "study_package_generate": "course_generate",
            "learning_record_extract": "ai_tutor_chat",
        }
        capability_id = capability_map.get(request.job_type)
        if capability_id:
            check_capability(capability_id)
        try:
            job, created = create_or_get_job(db, request, settings)
            db.commit()
            db.refresh(job)
            if created:
                try:
                    queue_client.enqueue(
                        job.queue_name,
                        QueueMessage(job_id=job.id, job_type=job.job_type, queue_name=job.queue_name),
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
                detail={"error_code": "JOB_CONFLICT", "message": "Concurrent duplicate job submission detected"},
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
    def get_job(job_id: str, db: Session = Depends(get_db), authorization: str | None = Header(default=None)):
        require_token(settings, authorization)
        job = db.get(Job, job_id)
        if not job:
            raise HTTPException(status_code=404, detail={"error_code": "JOB_NOT_FOUND", "message": "Job not found"})
        if reconcile_single_running_problem_video_job_with_artifacts(db, job):
            db.commit()
            db.refresh(job)
        return JobSummary(**serialize_job(job))

    @router.get("/v1/jobs/{job_id}/result", response_model=JobResultResponse)
    def get_job_result(job_id: str, db: Session = Depends(get_db), authorization: str | None = Header(default=None)):
        require_token(settings, authorization)
        job = db.get(Job, job_id)
        if not job:
            raise HTTPException(status_code=404, detail={"error_code": "JOB_NOT_FOUND", "message": "Job not found"})

        if job.status == JobStatus.RUNNING.value and reconcile_single_running_problem_video_job_with_artifacts(db, job):
            db.commit()
            db.refresh(job)

        if job.status != JobStatus.SUCCEEDED.value:
            raise HTTPException(
                status_code=409,
                detail={"error_code": "JOB_NOT_READY", "message": f"Job status={job.status}"},
            )

        return JobResultResponse(job_id=job.id, status=JobStatus(job.status), result=job.result_payload or {})

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
            raise HTTPException(status_code=404, detail={"error_code": "JOB_NOT_FOUND", "message": "Job not found"})

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

    return router
