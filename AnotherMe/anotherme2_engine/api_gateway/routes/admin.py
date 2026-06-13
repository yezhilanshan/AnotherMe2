"""Admin API routes for DLQ inspection, retry, and failed job management."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from ..config import Settings
from ..db import get_db, nested_session_scope
from ..job_service import add_event, _utcnow
from ..models import Job, JobEvent
from ..queueing import QueueMessage
from ..schemas import JobStatus
from .auth import require_token


def create_admin_router(settings: Settings, queue_client) -> APIRouter:
    router = APIRouter(tags=["admin"], prefix="/v1/admin")

    # ── DLQ Inspection ──────────────────────────────────────────────

    @router.get("/dlq")
    def list_dlqs(authorization: str | None = Header(default=None)):
        """List all DLQ queues with their message counts."""
        require_token(settings, authorization)
        dlq_mapping = settings.dlq_mapping
        result = []
        for source_queue, dlq_name in dlq_mapping.items():
            length = queue_client.dlq_length(dlq_name)
            result.append({
                "dlq_name": dlq_name,
                "source_queue": source_queue,
                "depth": length,
            })
        return {"dlqs": result}

    @router.get("/dlq/{queue_name:path}")
    def peek_dlq(
        queue_name: str,
        offset: int = Query(default=0, ge=0),
        limit: int = Query(default=50, ge=1, le=200),
        authorization: str | None = Header(default=None),
    ):
        """Peek at messages in a specific DLQ without removing them."""
        require_token(settings, authorization)
        depth = queue_client.dlq_length(queue_name)
        if depth == 0:
            return {"dlq_name": queue_name, "depth": 0, "messages": []}
        messages = queue_client.peek_dead_letters(queue_name, offset=offset, limit=limit)
        return {
            "dlq_name": queue_name,
            "depth": depth,
            "messages": [
                {"job_id": m.job_id, "job_type": m.job_type, "queue_name": m.queue_name}
                for m in messages
            ],
        }

    @router.post("/dlq/{queue_name:path}/retry")
    def retry_dlq(
        queue_name: str,
        count: int = Query(default=1, ge=1, le=100),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        """Move messages from a DLQ back to its source queue for retry."""
        require_token(settings, authorization)

        source_queue = _resolve_source_queue(settings, queue_name)

        # Use savepoint: if DLQ requeue fails, roll back job status changes
        with nested_session_scope(db):
            messages = queue_client.peek_dead_letters(queue_name, offset=0, limit=count)
            for msg in messages:
                job = db.get(Job, msg.job_id)
                if job and job.status == JobStatus.FAILED.value:
                    job.status = JobStatus.QUEUED.value
                    job.step = "retry_from_dlq"
                    job.error_code = "RETRY_FROM_DLQ"
                    job.error_message = None
                    job.attempt_count = 0
                    job.updated_at = _utcnow()
                    add_event(
                        db, job.id, "retry",
                        "Job re-queued from DLQ by admin",
                        {"source_dlq": queue_name},
                    )

            moved = queue_client.requeue_dead_letter(queue_name, source_queue, count=count)

        db.commit()

        from ..alert_service import get_alert_service
        get_alert_service().reset_dlq_alert(queue_name)

        return {
            "dlq_name": queue_name,
            "source_queue": source_queue,
            "moved": moved,
        }

    @router.post("/dlq/{queue_name:path}/retry-all")
    def retry_all_dlq(
        queue_name: str,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        """Move ALL messages from a DLQ back to its source queue."""
        require_token(settings, authorization)
        depth = queue_client.dlq_length(queue_name)
        if depth == 0:
            return {"dlq_name": queue_name, "moved": 0}

        source_queue = _resolve_source_queue(settings, queue_name)

        # Use savepoint: if DLQ requeue fails, roll back job status changes
        with nested_session_scope(db):
            messages = queue_client.peek_dead_letters(queue_name, offset=0, limit=depth)
            for msg in messages:
                job = db.get(Job, msg.job_id)
                if job and job.status == JobStatus.FAILED.value:
                    job.status = JobStatus.QUEUED.value
                    job.step = "retry_from_dlq"
                    job.error_code = "RETRY_FROM_DLQ"
                    job.error_message = None
                    job.attempt_count = 0
                    job.updated_at = _utcnow()
                    add_event(
                        db, job.id, "retry",
                        "Job re-queued from DLQ by admin (bulk retry)",
                        {"source_dlq": queue_name},
                    )

            moved = queue_client.requeue_dead_letter(queue_name, source_queue, count=depth)

        db.commit()

        from ..alert_service import get_alert_service
        get_alert_service().reset_dlq_alert(queue_name)

        return {
            "dlq_name": queue_name,
            "source_queue": source_queue,
            "moved": moved,
        }

    # ── Failed Jobs ─────────────────────────────────────────────────

    @router.get("/jobs/failed")
    def list_failed_jobs(
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
        job_type: str | None = Query(default=None),
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        """List permanently failed jobs."""
        require_token(settings, authorization)
        query = db.query(Job).filter(Job.status == JobStatus.FAILED.value)
        if job_type:
            query = query.filter(Job.job_type == job_type)
        total = query.count()
        jobs = query.order_by(Job.updated_at.desc()).offset(offset).limit(limit).all()
        return {
            "total": total,
            "jobs": [
                {
                    "id": j.id,
                    "job_type": j.job_type,
                    "status": j.status,
                    "error_code": j.error_code,
                    "error_message": j.error_message,
                    "attempt_count": j.attempt_count,
                    "max_retries": j.max_retries,
                    "created_at": j.created_at.isoformat(),
                    "updated_at": j.updated_at.isoformat(),
                }
                for j in jobs
            ],
        }

    @router.post("/jobs/{job_id}/retry")
    def retry_failed_job(
        job_id: str,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        """Retry a single failed job by resetting its status and re-enqueueing."""
        require_token(settings, authorization)
        job = db.get(Job, job_id)
        if not job:
            raise HTTPException(status_code=404, detail={"error_code": "JOB_NOT_FOUND", "message": "Job not found"})
        if job.status != JobStatus.FAILED.value:
            raise HTTPException(
                status_code=409,
                detail={"error_code": "JOB_NOT_FAILED", "message": f"Job status is {job.status}, can only retry failed jobs"},
            )

        # Use savepoint: if enqueue fails, roll back status change only
        with nested_session_scope(db):
            job.status = JobStatus.QUEUED.value
            job.step = "retry_from_admin"
            job.error_code = "RETRY_FROM_ADMIN"
            job.error_message = None
            job.attempt_count = 0
            job.engine_state = {}
            job.updated_at = _utcnow()
            add_event(
                db, job.id, "retry",
                "Job re-queued by admin",
                {"source": "admin_api"},
            )

            # Enqueue the job inside the savepoint
            message = QueueMessage(job_id=job.id, job_type=job.job_type, queue_name=job.queue_name)
            try:
                queue_client.enqueue(job.queue_name, message)
            except Exception as exc:
                raise HTTPException(
                    status_code=503,
                    detail={"error_code": "ENQUEUE_FAILED", "message": f"Failed to enqueue: {exc}"},
                )

        db.commit()
        db.refresh(job)

        return {
            "job_id": job.id,
            "status": "queued",
            "queue_name": job.queue_name,
        }

    # ── Migration Status ─────────────────────────────────────────────

    @router.get("/migrations")
    def get_migration_status(authorization: str | None = Header(default=None)):
        """List all backend migrations and their completion status."""
        require_token(settings, authorization)
        try:
            from tutor_engine.services.migration_registry import get_migration_status
            return {"migrations": get_migration_status()}
        except Exception as exc:
            return {"migrations": [], "error": str(exc)}

    return router


def _resolve_source_queue(settings: Settings, queue_name: str) -> str:
    """Resolve a DLQ name to its source queue name."""
    dlq_mapping = settings.dlq_mapping
    for src, dlq in dlq_mapping.items():
        if dlq == queue_name:
            return src
    # Try to infer: dlq_name format is "q.dlq.q.xxx" -> source is "q.xxx"
    prefix = f"{settings.queue_dead_letter_prefix}."
    if queue_name.startswith(prefix):
        return queue_name[len(prefix):]
    raise HTTPException(
        status_code=400,
        detail={"error_code": "UNKNOWN_DLQ", "message": f"Cannot determine source queue for DLQ: {queue_name}"},
    )
