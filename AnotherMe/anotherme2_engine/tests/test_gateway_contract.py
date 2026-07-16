from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from sqlalchemy.engine import Connection
from unittest.mock import patch

import api_gateway.db as db_module
from api_gateway.app import create_app
from api_gateway.config import Settings
from api_gateway.db import init_db, nested_session_scope, reconfigure_db, session_scope
from api_gateway.job_service import (
    _mark_failed,
    _run_course_generate,
    _run_problem_video_generate,
    create_or_get_job,
    fail_jobs_with_missing_input_objects,
    handle_worker_message,
    purge_prestart_nonterminal_jobs,
    reconcile_single_running_problem_video_job_with_artifacts,
    serialize_job,
)
from api_gateway.course_generation_provider import (
    LegacyCourseGenerationProvider,
    MiddleSchoolMathCourseGenerationProvider,
    create_course_generation_provider,
)
from api_gateway.classroom_store import list_classrooms, load_classroom, save_classroom_payload
from api_gateway.routes.ai_chat import (
    _extract_answer_blocks,
    _extract_math_blocks,
    _normalize_html_line_breaks,
    _stream_engine_events_with_heartbeat,
)
from api_gateway.models import (
    AIChatMessage,
    AIChatSession,
    AILearningRecord,
    AppUser,
    Job,
    JobArtifact,
    LearningEvent,
    ProblemContext,
    StudentProfile,
)
from api_gateway.queueing import QueueMessage
from api_gateway.schemas import CreateJobRequest, JobStatus, JobType, validate_job_payload
from api_gateway.storage import LocalObjectStorage, build_storage
from api_gateway.anotherme_client import AnotherMeClient
from api_gateway.anotherme_executor import MissingInputObjectError, ProblemVideoExecutionResult, _merge_runtime_configs
from agents.foundation.config import (
    build_default_llm_config,
    build_ocr_model_config,
    build_vision_model_config,
)


class FakeQueueClient:
    def __init__(self):
        self.items = []
        self.dead_letters = []

    def enqueue(self, queue_name, message):
        self.items.append((queue_name, message))

    def push_dead_letter(self, dlq_name, message):
        self.dead_letters.append((dlq_name, message))

    def ping(self):
        return True


class FailingQueueClient(FakeQueueClient):
    def enqueue(self, queue_name, message):
        raise RuntimeError("queue unavailable")


class StubCourseClient:
    def __init__(self):
        self.last_payload = None

    def submit_course_job(self, payload):
        self.last_payload = payload
        return {"jobId": "job-1"}

    def poll_course_job(self, job_id):
        return {"jobId": job_id, "status": "running"}


def test_gateway_classroom_store_accepts_web_classroom_shape(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("CLASSROOM_DATA_DIR", str(tmp_path / "classrooms"))

    save_classroom_payload(
        "class-mobile-1",
        {
            "id": "class-mobile-1",
            "stage": {"id": "class-mobile-1", "name": "移动端函数课堂"},
            "scenes": [{"id": "scene-1"}, {"id": "scene-2"}],
            "createdAt": "2026-06-23T10:00:00.000Z",
        },
    )

    summaries = list_classrooms()

    assert summaries == [
        {
            "id": "class-mobile-1",
            "title": "移动端函数课堂",
            "created_at": "2026-06-23T10:00:00.000Z",
            "scenes_count": 2,
        }
    ]
    assert load_classroom("class-mobile-1")["stage"]["name"] == "移动端函数课堂"


def test_settings_startup_purge_requires_safety_latch():
    settings_unarmed = Settings(
        purge_prestart_jobs_on_startup=True,
        startup_purge_armed=False,
    )
    assert settings_unarmed.startup_purge_enabled is False

    settings_armed = Settings(
        purge_prestart_jobs_on_startup=True,
        startup_purge_armed=True,
    )
    assert settings_armed.startup_purge_enabled is True


def test_course_generation_provider_switch_and_payload_injection():
    stub = StubCourseClient()

    legacy_settings = Settings(course_generation_provider="legacy")
    legacy_provider = create_course_generation_provider(legacy_settings, stub)  # type: ignore[arg-type]
    assert isinstance(legacy_provider, LegacyCourseGenerationProvider)
    legacy_provider.submit({"requirement": "讲解勾股定理"})
    assert "pedagogy_profile" not in (stub.last_payload or {})

    msm_settings = Settings(course_generation_provider="msm_v1")
    msm_provider = create_course_generation_provider(msm_settings, stub)  # type: ignore[arg-type]
    assert isinstance(msm_provider, MiddleSchoolMathCourseGenerationProvider)
    msm_provider.submit({"requirement": "讲解勾股定理"})
    assert stub.last_payload is not None
    assert stub.last_payload["pedagogy_profile"]["domain"] == "middle-school-math"


def test_course_generate_syncs_upstream_classroom_to_gateway_store(
    tmp_path: Path,
    monkeypatch,
):
    monkeypatch.setenv("CLASSROOM_DATA_DIR", str(tmp_path / "classrooms"))
    db_path = tmp_path / "course-sync.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    class FakeCourseProvider:
        def submit(self, payload):
            return {"jobId": "upstream-course-job"}

        def poll(self, job_id):
            return {
                "jobId": job_id,
                "status": "succeeded",
                "done": True,
                "progress": 100,
                "step": "completed",
                "result": {
                    "classroomId": "class-mobile-sync",
                    "url": "http://localhost:3000/classroom/class-mobile-sync",
                    "scenesCount": 1,
                },
            }

    class FakeAnotherMeClient:
        def __init__(self, base_url):
            self.base_url = base_url

        def get_classroom(self, classroom_id):
            return {
                "classroom": {
                    "id": classroom_id,
                    "stage": {"id": classroom_id, "name": "同步后的课堂"},
                    "scenes": [{"id": "scene-1", "type": "lecture", "order": 1}],
                    "createdAt": "2026-06-23T11:00:00.000Z",
                }
            }

        def close(self):
            pass

    monkeypatch.setattr(
        "api_gateway.job_service.create_course_generation_provider",
        lambda settings, client: FakeCourseProvider(),
    )
    monkeypatch.setattr(
        "api_gateway.job_service.AnotherMeClient",
        FakeAnotherMeClient,
    )

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
        worker_temp_root=str(tmp_path / "tmp"),
        anotherme_base_url="http://localhost:3000",
    )

    with session_scope() as session:
        request = CreateJobRequest(
            job_type=JobType.COURSE_GENERATE,
            user_id="mobile-user",
            payload={"requirement": "讲解一次函数"},
        )
        job, _ = create_or_get_job(session, request, settings)
        session.commit()
        session.refresh(job)

        result = _run_course_generate(
            session,
            job,
            job.normalized_payload,
            settings,
            LocalObjectStorage(storage_root),
        )

    assert result["classroom_id"] == "class-mobile-sync"
    assert list_classrooms()[0]["title"] == "同步后的课堂"
    assert load_classroom("class-mobile-sync")["scenes"][0]["id"] == "scene-1"


def test_course_job_serialization_exposes_partial_classroom_result(
    tmp_path: Path,
):
    db_path = tmp_path / "course-partial.db"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    with session_scope() as session:
        job = Job(
            job_type=JobType.COURSE_GENERATE.value,
            queue_name="q.course",
            user_id="mobile-user",
            idempotency_key="course-partial",
            status=JobStatus.RUNNING.value,
            progress=70,
            step="persisting",
            input_payload={"requirement": "讲解一次函数"},
            normalized_payload={"requirement": "讲解一次函数"},
            engine_state={
                "partial_result": {
                    "classroom_id": "class-partial-1",
                    "classroom_url": "http://localhost:3000/classroom/class-partial-1",
                    "scenes_count": 1,
                }
            },
        )
        session.add(job)
        session.commit()
        session.refresh(job)

        payload = serialize_job(job)

    assert payload["status"] == "running"
    assert payload["result"] == {
        "classroom_id": "class-partial-1",
        "classroom_url": "http://localhost:3000/classroom/class-partial-1",
        "scenes_count": 1,
    }


def test_mobile_course_generate_full_gateway_flow(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("CLASSROOM_DATA_DIR", str(tmp_path / "classrooms"))
    db_path = tmp_path / "mobile-course-flow.db"
    storage_root = tmp_path / "objects"

    class FakeCourseProvider:
        def submit(self, payload):
            return {"jobId": "upstream-mobile-flow"}

        def poll(self, job_id):
            return {
                "jobId": job_id,
                "status": "succeeded",
                "done": True,
                "progress": 100,
                "step": "completed",
                "result": {
                    "classroomId": "class-mobile-flow",
                    "url": "http://localhost:3000/classroom/class-mobile-flow",
                    "scenesCount": 1,
                },
            }

    class FakeAnotherMeClient:
        def __init__(self, base_url):
            self.base_url = base_url

        def get_classroom(self, classroom_id):
            return {
                "classroom": {
                    "id": classroom_id,
                    "stage": {"id": classroom_id, "name": "移动端全流程课堂"},
                    "scenes": [{"id": "scene-flow", "type": "lecture", "order": 1}],
                    "createdAt": "2026-06-23T12:00:00.000Z",
                }
            }

        def close(self):
            pass

    monkeypatch.setattr(
        "api_gateway.job_service.create_course_generation_provider",
        lambda settings, client: FakeCourseProvider(),
    )
    monkeypatch.setattr(
        "api_gateway.job_service.AnotherMeClient",
        FakeAnotherMeClient,
    )

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
        worker_temp_root=str(tmp_path / "tmp"),
        anotherme_base_url="http://localhost:3000",
    )
    queue = FakeQueueClient()
    storage = LocalObjectStorage(storage_root)
    app = create_app(
        settings_override=settings,
        queue_client_override=queue,
        storage_override=storage,
    )
    client = TestClient(app)

    create_resp = client.post(
        "/v1/jobs",
        json={
            "job_type": "course_generate",
            "user_id": "mobile-user",
            "payload": {"requirement": "讲解移动端课堂创建"},
        },
    )

    assert create_resp.status_code == 200
    job_id = create_resp.json()["job_id"]
    assert queue.items

    with session_scope() as session:
        handle_worker_message(session, queue, queue.items[0][1], settings, storage)
        session.commit()

    job_resp = client.get(f"/v1/jobs/{job_id}")
    assert job_resp.status_code == 200
    job_payload = job_resp.json()
    assert job_payload["status"] == "succeeded"
    assert job_payload["result"]["classroom_id"] == "class-mobile-flow"

    list_resp = client.get("/v1/classrooms?limit=10")
    assert list_resp.status_code == 200
    assert list_resp.json()["classrooms"][0] == {
        "id": "class-mobile-flow",
        "title": "移动端全流程课堂",
        "created_at": "2026-06-23T12:00:00.000Z",
        "scenes_count": 1,
    }

    detail_resp = client.get("/v1/classrooms/class-mobile-flow")
    assert detail_resp.status_code == 200
    assert detail_resp.json()["classroom"]["scenes"][0]["id"] == "scene-flow"


def test_anotherme_client_disables_system_proxy_env(monkeypatch):
    captured: dict[str, Any] = {}

    class FakeHttpxClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr("api_gateway.anotherme_client.httpx.Client", FakeHttpxClient)

    client = AnotherMeClient("http://localhost:3000")
    client._get_client()

    assert captured["trust_env"] is False


def test_validate_payload_defaults():
    payload = validate_job_payload(
        JobType.COURSE_GENERATE,
        {
            "requirement": "讲解二次函数",
        },
    )
    assert payload["language"] == "zh-CN"
    assert payload["options"]["enable_web_search"] is False

    payload2 = validate_job_payload(
        JobType.PROBLEM_VIDEO_GENERATE,
        {
            "image_object_key": "uploads/a.png",
        },
    )
    assert payload2["output_profile"] == "1080p"


def test_validate_problem_video_payload_accepts_learner_context():
    payload = validate_job_payload(
        JobType.PROBLEM_VIDEO_GENERATE,
        {
            "image_object_key": "uploads/a.png",
            "learner_user_id": "stu-01",
            "learner_session_id": "sess-01",
            "learner_lookback_days": 45,
        },
    )
    assert payload["learner_user_id"] == "stu-01"
    assert payload["learner_session_id"] == "sess-01"
    assert payload["learner_lookback_days"] == 45


def test_validate_course_payload_accepts_optional_pedagogy_profile():
    payload = validate_job_payload(
        JobType.COURSE_GENERATE,
        {
            "requirement": "讲解一次函数",
            "pedagogy_profile": {
                "domain": "middle-school-math",
                "exam_orientation": "zhongkao",
                "grade_band": "grade8",
                "strictness": "high",
            },
        },
    )
    assert payload["pedagogy_profile"]["domain"] == "middle-school-math"
    assert payload["pedagogy_profile"]["strictness"] == "high"


def test_validate_learning_extract_payload_accepts_snapshot_fields():
    payload = validate_job_payload(
        JobType.LEARNING_RECORD_EXTRACT,
        {
            "session_id": "sess-1",
            "extract_version": "v2",
            "latest_user_message_id": "msg-9",
            "message_count": 12,
        },
    )
    assert payload["session_id"] == "sess-1"
    assert payload["extract_version"] == "v2"
    assert payload["latest_user_message_id"] == "msg-9"
    assert payload["message_count"] == 12


def test_idempotent_job_creation(tmp_path: Path):
    db_path = tmp_path / "jobs.db"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(tmp_path / "obj"),
    )

    req = CreateJobRequest(
        job_type=JobType.COURSE_GENERATE,
        payload={"requirement": "牛顿定律课程"},
        user_id="u1",
    )

    with session_scope() as session:
        job1, created1 = create_or_get_job(session, req, settings)
        session.flush()
        job2, created2 = create_or_get_job(session, req, settings)
        session.flush()

        assert created1 is True
        assert created2 is False
        assert job1.id == job2.id


def test_course_generate_request_id_creates_distinct_jobs(tmp_path: Path):
    db_path = tmp_path / "jobs-request-id.db"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(tmp_path / "obj"),
    )

    with session_scope() as session:
        first_job, first_created = create_or_get_job(
            session,
            CreateJobRequest(
                job_type=JobType.COURSE_GENERATE,
                payload={"requirement": "勾股定理", "request_id": "mobile-course-1"},
                user_id="mobile-user",
            ),
            settings,
        )
        session.flush()

        second_job, second_created = create_or_get_job(
            session,
            CreateJobRequest(
                job_type=JobType.COURSE_GENERATE,
                payload={"requirement": "勾股定理", "request_id": "mobile-course-2"},
                user_id="mobile-user",
            ),
            settings,
        )
        session.flush()

        assert first_created is True
        assert second_created is True
        assert first_job.id != second_job.id


def test_failed_idempotent_job_can_be_recreated(tmp_path: Path):
    db_path = tmp_path / "jobs-retry.db"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(tmp_path / "obj"),
    )
    req = CreateJobRequest(
        job_type=JobType.COURSE_GENERATE,
        payload={"requirement": "勾股定理"},
        user_id="mobile-user",
    )

    with session_scope() as session:
        failed_job, created1 = create_or_get_job(session, req, settings)
        _mark_failed(session, failed_job, "JOB_EXECUTION_FAILED", "upstream 502")
        session.flush()

        retry_job, created2 = create_or_get_job(session, req, settings)
        session.flush()

        assert created1 is True
        assert created2 is True
        assert retry_job.id != failed_job.id
        assert retry_job.status == JobStatus.QUEUED.value
        assert retry_job.idempotency_key.startswith(failed_job.idempotency_key + ":retry:")


def test_init_db_auto_falls_back_to_sqlite_when_postgres_unreachable(tmp_path: Path, monkeypatch):
    fallback_db = tmp_path / "gateway-fallback.db"

    monkeypatch.setenv("GATEWAY_ENV", "dev")
    monkeypatch.setenv("GATEWAY_DB_AUTO_FALLBACK", "1")
    monkeypatch.setenv("GATEWAY_SQLITE_FALLBACK_PATH", str(fallback_db))
    monkeypatch.setenv("GATEWAY_DB_CONNECT_TIMEOUT_SEC", "1")

    reconfigure_db("postgresql+psycopg://postgres:postgres@127.0.0.1:5432/anotherme2")
    original_create_all = db_module.Base.metadata.create_all

    def _fake_create_all(*args, **kwargs):
        bind = kwargs.get("bind")
        engine_url = ""
        if isinstance(bind, Connection):
            engine_url = str(bind.engine.url)
        elif bind is not None and hasattr(bind, "url"):
            engine_url = str(bind.url)

        if engine_url.startswith("postgresql"):
            raise OperationalError(
                "create_all",
                {},
                Exception("could not connect to server: Connection refused"),
            )
        return original_create_all(*args, **kwargs)

    with patch.object(db_module, "_postgres_tcp_reachable", return_value=True), patch.object(
        db_module.Base.metadata,
        "create_all",
        side_effect=_fake_create_all,
    ):
        init_db()

    engine_url = str(db_module.engine.url)
    assert engine_url.startswith("sqlite:///")
    assert fallback_db.as_posix() in engine_url


def test_init_db_precheck_fallback_initializes_sqlite_without_postgres_lock(tmp_path: Path, monkeypatch):
    fallback_db = tmp_path / "gateway-precheck-fallback.db"

    monkeypatch.setenv("GATEWAY_ENV", "dev")
    monkeypatch.setenv("GATEWAY_DB_AUTO_FALLBACK", "1")
    monkeypatch.setenv("GATEWAY_SQLITE_FALLBACK_PATH", str(fallback_db))

    reconfigure_db("postgresql+psycopg://postgres:postgres@127.0.0.1:5432/anotherme2")

    with patch.object(db_module, "_postgres_tcp_reachable", return_value=False):
        init_db()

    assert str(db_module.engine.url).startswith("sqlite:///")
    assert fallback_db.exists()


def test_nested_session_scope_rolls_back_savepoint_only(tmp_path: Path):
    db_path = tmp_path / "nested-savepoint.db"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    with session_scope() as session:
        session.add(AppUser(id="outer-user", name="Outer"))
        try:
            with nested_session_scope(session):
                session.add(AppUser(id="inner-user", name="Inner"))
                session.flush()
                raise RuntimeError("rollback inner")
        except RuntimeError:
            pass
        session.add(AppUser(id="after-inner-user", name="After"))

    with session_scope() as session:
        assert session.get(AppUser, "outer-user") is not None
        assert session.get(AppUser, "after-inner-user") is not None
        assert session.get(AppUser, "inner-user") is None


def test_ai_chat_non_streaming_persists_to_unified_database(tmp_path: Path):
    db_path = tmp_path / "ai-chat-unified.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    async def _fake_stream(**_kwargs):
        yield {"type": "stream", "content": "统一数据库回复"}
        yield {"type": "done"}

    with patch("api_gateway.routes.ai_chat.stream_capability_via_orchestrator", _fake_stream):
        upload = client.post(
            "/v1/uploads",
            files={"file": ("problem.png", b"fakepng", "image/png")},
        )
        assert upload.status_code == 200
        object_key = upload.json()["object_key"]

        response = client.post(
            "/v1/ai/chat/non-streaming",
            json={
                "messages": [{"role": "user", "content": "解释二次函数"}],
                "model": "qwen3.7-plus",
                "api_key": "test-key",
                "capability": "chat",
                "user_id": "stu-unified",
                "request_id": "req-unified-chat",
                "persistence_session_id": "sess-unified-chat",
                "persist_messages": True,
                "persist_user_message": True,
                "persist_assistant_message": True,
                "attachments": [
                    {
                        "type": "image",
                        "object_key": object_key,
                        "filename": "problem.png",
                        "mime_type": "image/png",
                        "size": 7,
                    }
                ],
            },
        )

    assert response.status_code == 200
    assert response.json()["session_id"] == "sess-unified-chat"

    with session_scope() as session:
        ai_session = session.get(AIChatSession, "sess-unified-chat")
        assert ai_session is not None
        rows = (
            session.query(AIChatMessage)
            .filter(AIChatMessage.session_id == "sess-unified-chat")
            .order_by(AIChatMessage.runtime_seq.asc())
            .all()
        )
        assert [(row.runtime_seq, row.role, row.content) for row in rows] == [
            (1, "user", "解释二次函数"),
            (2, "assistant", "统一数据库回复"),
        ]
        assert rows[0].capability == "chat"
        assert rows[0].attachments_json == [
            {
                "type": "image",
                "object_key": object_key,
                "file_name": "problem.png",
                "mime_type": "image/png",
                "file_size": 7,
            }
        ]
        assert "base64" not in rows[0].attachments_json[0]


def test_ai_chat_image_auto_routes_to_visual_solve_fast(tmp_path: Path):
    db_path = tmp_path / "ai-chat-visual-fast.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)
    captured: dict[str, Any] = {}

    async def _fake_stream(**kwargs):
        captured.update(kwargs)
        yield {"type": "stream", "content": "图片快答回复"}
        yield {"type": "done"}

    upload = client.post(
        "/v1/uploads",
        files={"file": ("problem.png", b"fakepng", "image/png")},
    )
    assert upload.status_code == 200

    with patch("api_gateway.routes.ai_chat.stream_capability_via_orchestrator", _fake_stream):
        response = client.post(
            "/v1/ai/chat/non-streaming",
            json={
                "messages": [{"role": "user", "content": "这道题怎么做？"}],
                "model": "qwen3.7-plus",
                "api_key": "test-key",
                "capability": "auto",
                "mode": "auto",
                "user_id": "stu-visual-fast",
                "request_id": "req-visual-fast",
                "attachments": [
                    {
                        "type": "image",
                        "object_key": upload.json()["object_key"],
                        "filename": "problem.png",
                        "mime_type": "image/png",
                    }
                ],
            },
        )

    assert response.status_code == 200
    assert response.json()["assistant_text"] == "图片快答回复"
    assert captured["capability"] == "visual_solve_fast"
    assert captured["config_overrides"] == {
        "model": "qwen3.7-plus",
        "mode": "fast",
        "max_tokens": 4096,
    }
    assert captured["attachments"][0]["type"] == "image"
    assert captured["attachments"][0]["base64"]


def test_ai_chat_image_chat_routes_to_visual_solve_fast(tmp_path: Path):
    db_path = tmp_path / "ai-chat-visual-chat.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)
    captured: dict[str, Any] = {}

    async def _fake_stream(**kwargs):
        captured.update(kwargs)
        yield {"type": "stream", "content": "图片聊天快答"}
        yield {"type": "done"}

    upload = client.post(
        "/v1/uploads",
        files={"file": ("problem.png", b"fakepng", "image/png")},
    )
    assert upload.status_code == 200

    with patch("api_gateway.routes.ai_chat.stream_capability_via_orchestrator", _fake_stream):
        response = client.post(
            "/v1/ai/chat/non-streaming",
            json={
                "messages": [{"role": "user", "content": "看图讲一下"}],
                "model": "qwen3.7-plus",
                "api_key": "test-key",
                "capability": "chat",
                "mode": "auto",
                "user_id": "stu-visual-chat",
                "request_id": "req-visual-chat",
                "attachments": [
                    {
                        "type": "image",
                        "object_key": upload.json()["object_key"],
                        "filename": "problem.png",
                        "mime_type": "image/png",
                    }
                ],
            },
        )

    assert response.status_code == 200
    assert captured["capability"] == "visual_solve_fast"
    assert captured["config_overrides"] == {
        "model": "qwen3.7-plus",
        "mode": "fast",
        "max_tokens": 4096,
    }


def test_ai_chat_visual_timeout_defaults_allow_slow_first_token():
    from api_gateway.routes import ai_chat

    assert (
        ai_chat._stream_no_content_limit_for_capability("visual_solve_fast") >= 300
    )
    assert (
        ai_chat._stream_duration_limit_for_capability("visual_solve_fast") >= 420
    )
    assert ai_chat._stream_no_content_limit_for_capability("deep_solve") >= 240
    assert ai_chat._stream_duration_limit_for_capability("deep_solve") >= 420
    assert ai_chat._stream_no_content_limit_for_capability("chat") == 60


def test_upload_returns_sha256(tmp_path: Path):
    db_path = tmp_path / "upload-sha.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    payload = b"fakepng"
    upload = client.post(
        "/v1/uploads",
        files={"file": ("problem.png", payload, "image/png")},
    )

    assert upload.status_code == 200
    assert upload.json()["sha256"] == hashlib.sha256(payload).hexdigest()


def test_server_model_catalog_exposes_shared_defaults(tmp_path: Path):
    db_path = tmp_path / "server-models.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    response = client.get("/v1/server/models")

    assert response.status_code == 200
    payload = response.json()
    assert payload["defaultModel"] == "qwen3.7-plus"
    assert payload["capabilityDefaults"]["visual_solve_fast"] == "qwen3.7-plus"
    assert any(model["id"] == "qwen3.7-plus" and model["supportsVision"] for model in payload["models"])


def test_ai_chat_rejects_unknown_model(tmp_path: Path):
    db_path = tmp_path / "invalid-model.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    response = client.post(
        "/v1/ai/chat/non-streaming",
        json={
            "messages": [{"role": "user", "content": "解释一下二次函数"}],
            "model": "missing-model",
            "api_key": "test-key",
            "capability": "chat",
            "user_id": "stu-invalid-model",
            "request_id": "req-invalid-model",
        },
    )

    assert response.status_code == 400
    assert response.json()["error_code"] == "INVALID_MODEL"


def test_ai_chat_rejects_non_vision_model_for_image_input(tmp_path: Path):
    db_path = tmp_path / "vision-mismatch.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    upload = client.post(
        "/v1/uploads",
        files={"file": ("problem.png", b"fakepng", "image/png")},
    )
    assert upload.status_code == 200

    response = client.post(
        "/v1/ai/chat/non-streaming",
        json={
            "messages": [{"role": "user", "content": "看图讲一下"}],
            "model": "qwen3.6-max-preview",
            "api_key": "test-key",
            "capability": "chat",
            "mode": "auto",
            "user_id": "stu-vision-mismatch",
            "request_id": "req-vision-mismatch",
            "attachments": [
                {
                    "type": "image",
                    "object_key": upload.json()["object_key"],
                    "filename": "problem.png",
                    "mime_type": "image/png",
                }
            ],
        },
    )

    assert response.status_code == 400
    assert response.json()["error_code"] == "MODEL_CAPABILITY_MISMATCH"


def test_ai_chat_reuses_problem_context_for_same_image(tmp_path: Path):
    db_path = tmp_path / "problem-context-cache.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)
    calls: list[dict[str, Any]] = []

    async def _fake_stream(**kwargs):
        calls.append(kwargs)
        yield {"type": "stream", "content": f"回复{len(calls)}"}
        yield {"type": "done"}

    upload = client.post(
        "/v1/uploads",
        files={"file": ("problem.png", b"fakepng", "image/png")},
    )
    assert upload.status_code == 200
    object_key = upload.json()["object_key"]

    with patch("api_gateway.routes.ai_chat.stream_capability_via_orchestrator", _fake_stream):
        first = client.post(
            "/v1/ai/chat/non-streaming",
            json={
                "messages": [{"role": "user", "content": "这道题怎么做？"}],
                "model": "qwen3.7-plus",
                "api_key": "test-key",
                "capability": "chat",
                "mode": "auto",
                "user_id": "stu-problem-context",
                "request_id": "req-problem-context-1",
                "attachments": [
                    {
                        "type": "image",
                        "object_key": object_key,
                        "filename": "problem.png",
                        "mime_type": "image/png",
                    }
                ],
            },
        )
        second = client.post(
            "/v1/ai/chat/non-streaming",
            json={
                "messages": [{"role": "user", "content": "再换一种方法讲"}],
                "model": "qwen3.7-plus",
                "api_key": "test-key",
                "capability": "chat",
                "mode": "auto",
                "user_id": "stu-problem-context",
                "request_id": "req-problem-context-2",
                "attachments": [
                    {
                        "type": "image",
                        "object_key": object_key,
                        "filename": "problem.png",
                        "mime_type": "image/png",
                    }
                ],
            },
        )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["problem_context_cache_hit"] is False
    assert second.json()["problem_context_cache_hit"] is True
    assert first.json()["problem_context"]["problem_context_id"]
    assert second.json()["problem_context"]["problem_context_id"] == first.json()["problem_context"]["problem_context_id"]
    assert calls[0]["attachments"][0]["base64"]
    assert calls[1].get("attachments") is None
    assert "已缓存的题目视觉上下文" in calls[1]["file_context"]

    with session_scope() as session:
        rows = session.query(ProblemContext).all()
        assert len(rows) == 1
        assert rows[0].sha256 == upload.json()["sha256"]


def test_ai_chat_stream_emits_structured_sse_before_done(tmp_path: Path):
    db_path = tmp_path / "structured-sse.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    async def _fake_stream(**kwargs):
        yield {"type": "stream", "content": "公式如下：$$a^2+b^2=c^2$$"}
        yield {"type": "done"}

    with patch("api_gateway.routes.ai_chat.stream_capability_via_orchestrator", _fake_stream):
        response = client.post(
            "/v1/ai/chat",
            json={
                "messages": [{"role": "user", "content": "解释勾股定理"}],
                "model": "qwen3.7-plus",
                "api_key": "test-key",
                "capability": "chat",
                "mode": "fast",
                "user_id": "stu-sse",
                "request_id": "req-sse-structured",
            },
        )

    assert response.status_code == 200
    events = []
    for line in response.text.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: ") :]))
    event_types = [event["type"] for event in events]
    assert "text_delta" in event_types
    assert "final_markdown" in event_types
    assert "render_metrics" in event_types
    assert "math_block" not in event_types
    assert "answer_block" not in event_types
    assert "answer_component" not in event_types
    assert event_types.index("final_markdown") < event_types.index("done")
    assert event_types.index("render_metrics") < event_types.index("done")
    render_metrics = next(event["data"] for event in events if event["type"] == "render_metrics")
    assert render_metrics["model"] == "qwen3.7-plus"
    assert render_metrics["capability"] == "chat"
    assert "answer_block_count" not in render_metrics
    assert "answer_component_count" not in render_metrics


def test_stream_engine_events_with_heartbeat_emits_keepalive_during_stall():
    async def _slow_stream():
        yield {"type": "stream", "content": "first"}
        await asyncio.sleep(0.03)
        yield {"type": "done"}

    async def _collect():
        events = []
        async for event in _stream_engine_events_with_heartbeat(
            _slow_stream(),
            heartbeat_interval=0.01,
        ):
            events.append(event)
        return events

    events = asyncio.run(_collect())

    assert events[0] == {"type": "stream", "content": "first"}
    assert None in events[1:-1]
    assert events[-1] == {"type": "done"}


def test_stream_engine_events_with_heartbeat_closes_underlying_stream_on_break():
    closed = False

    async def _slow_stream():
        nonlocal closed
        try:
            yield {"type": "stream", "content": "first"}
            await asyncio.sleep(60)
            yield {"type": "stream", "content": "late"}
        finally:
            closed = True

    async def _collect_one():
        wrapper = _stream_engine_events_with_heartbeat(
            _slow_stream(),
            heartbeat_interval=0.01,
        )
        first = await anext(wrapper)
        await wrapper.aclose()
        await asyncio.sleep(0)
        return first

    first = asyncio.run(_collect_one())

    assert first == {"type": "stream", "content": "first"}
    assert closed is True


def test_ai_chat_deep_solve_emits_step_events_alongside_text_delta(tmp_path: Path):
    db_path = tmp_path / "ai-chat-step-events.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    async def _fake_stream(**kwargs):
        yield {"type": "stream", "content": "## 步骤一\n先建立方程。"}
        yield {"type": "stream", "content": "\n\n## 步骤二\n再代入求解。"}
        yield {"type": "done"}

    with patch("api_gateway.routes.ai_chat.stream_capability_via_orchestrator", _fake_stream):
        response = client.post(
            "/v1/ai/chat",
            json={
                "messages": [{"role": "user", "content": "解一道数学题"}],
                "model": "qwen3.7-plus",
                "api_key": "test-key",
                "capability": "deep_solve",
                "mode": "auto",
                "user_id": "stu-steps",
                "request_id": "req-steps",
            },
        )

    assert response.status_code == 200
    events = []
    for line in response.text.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: ") :]))
    event_types = [event["type"] for event in events]
    assert "text_delta" in event_types
    assert "final_markdown" in event_types
    assert "step_start" not in event_types
    assert "step_delta" not in event_types
    assert "step_done" not in event_types


def test_ai_chat_prefers_native_step_metadata_over_text_projection(tmp_path: Path):
    db_path = tmp_path / "ai-chat-native-step-events.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    async def _fake_stream(**kwargs):
        yield {
            "type": "stream",
            "content": "先建立方程。",
            "metadata": {
                "step_event": "start_delta",
                "step_id": "writer-step-0",
                "step_index": 0,
                "step_title": "建立方程",
            },
        }
        yield {
            "type": "stream",
            "content": "再求出未知量。",
            "metadata": {
                "step_event": "start_delta",
                "step_id": "writer-step-1",
                "step_index": 1,
                "step_title": "求解未知量",
            },
        }
        yield {"type": "done"}

    with patch("api_gateway.routes.ai_chat.stream_capability_via_orchestrator", _fake_stream):
        response = client.post(
            "/v1/ai/chat",
            json={
                "messages": [{"role": "user", "content": "解一道数学题"}],
                "model": "qwen3.7-plus",
                "api_key": "test-key",
                "capability": "deep_solve",
                "mode": "auto",
                "user_id": "stu-native-steps",
                "request_id": "req-native-steps",
            },
        )

    assert response.status_code == 200
    events = []
    for line in response.text.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: ") :]))
    event_types = [event["type"] for event in events]
    assert "text_delta" in event_types
    assert "final_markdown" in event_types
    assert "step_start" not in event_types
    assert "step_delta" not in event_types


def test_ai_chat_stream_emits_heartbeat_event_before_first_engine_chunk(tmp_path: Path):
    db_path = tmp_path / "ai-chat-heartbeat.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    async def _fake_stream(**kwargs):
        yield {"type": "stream", "content": "late-answer"}
        yield {"type": "done"}

    async def _fake_heartbeat_wrapper(engine_stream, *, heartbeat_interval):
        yield None
        async for event in engine_stream:
            yield event

    with (
        patch("api_gateway.routes.ai_chat.stream_capability_via_orchestrator", _fake_stream),
        patch(
            "api_gateway.routes.ai_chat._stream_engine_events_with_heartbeat",
            _fake_heartbeat_wrapper,
        ),
    ):
        response = client.post(
            "/v1/ai/chat",
            json={
                "messages": [{"role": "user", "content": "请解答这道题"}],
                "model": "qwen3.7-plus",
                "api_key": "test-key",
                "capability": "chat",
                "mode": "fast",
                "user_id": "stu-heartbeat",
                "request_id": "req-heartbeat",
            },
        )

    assert response.status_code == 200
    assert response.headers["x-accel-buffering"] == "no"
    assert response.headers["cache-control"] == "no-cache, no-transform"

    events = []
    for line in response.text.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: ") :]))

    event_types = [event["type"] for event in events]
    assert "heartbeat" in event_types
    assert "text_delta" in event_types
    assert event_types.index("heartbeat") < event_types.index("text_delta")
    heartbeat = next(event["data"] for event in events if event["type"] == "heartbeat")
    assert heartbeat["request_id"] == "req-heartbeat"


def test_ai_chat_stream_heartbeat_only_stops_on_duration(tmp_path: Path):
    db_path = tmp_path / "ai-chat-heartbeat-duration.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    async def _fake_stream(**kwargs):
        if False:
            yield {"type": "stream", "content": "unreachable"}

    async def _fake_heartbeat_wrapper(engine_stream, *, heartbeat_interval):
        yield None

    with (
        patch("api_gateway.routes.ai_chat.stream_capability_via_orchestrator", _fake_stream),
        patch(
            "api_gateway.routes.ai_chat._stream_engine_events_with_heartbeat",
            _fake_heartbeat_wrapper,
        ),
        patch("api_gateway.routes.ai_chat.MAX_STREAM_DURATION_SECONDS", 0.0),
        patch("api_gateway.routes.ai_chat.MAX_AUTO_CONTINUATIONS", 0),
    ):
        response = client.post(
            "/v1/ai/chat",
            json={
                "messages": [{"role": "user", "content": "请解答这道题"}],
                "model": "qwen3.7-plus",
                "api_key": "test-key",
                "capability": "chat",
                "mode": "fast",
                "user_id": "stu-heartbeat-duration",
                "request_id": "req-heartbeat-duration",
            },
        )

    assert response.status_code == 200
    events = []
    for line in response.text.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: ") :]))

    event_types = [event["type"] for event in events]
    assert "heartbeat" in event_types
    assert "final_markdown" in event_types
    assert "done" in event_types
    final_markdown = next(event["data"] for event in events if event["type"] == "final_markdown")
    assert final_markdown["finish_reason"] == "duration"
    assert final_markdown["partial"] is True
    done = next(event["data"] for event in events if event["type"] == "done")
    assert done["finish_reason"] == "duration"
    assert done["partial"] is True


def test_ai_chat_stream_thinking_only_stops_without_auto_continue(tmp_path: Path):
    db_path = tmp_path / "ai-chat-thinking-duration.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)
    calls = 0

    async def _fake_stream(**kwargs):
        nonlocal calls
        calls += 1
        yield {"type": "status", "message": "仍在分析题目"}

    with (
        patch("api_gateway.routes.ai_chat.stream_capability_via_orchestrator", _fake_stream),
        patch("api_gateway.routes.ai_chat.MAX_STREAM_NO_CONTENT_SECONDS", 0.0),
        patch.dict(
            "api_gateway.routes.ai_chat.CAPABILITY_STREAM_NO_CONTENT_SECONDS",
            {"deep_solve": 0.0},
        ),
        patch("api_gateway.routes.ai_chat.MAX_AUTO_CONTINUATIONS", 2),
    ):
        response = client.post(
            "/v1/ai/chat",
            json={
                "messages": [{"role": "user", "content": "请解答这道题"}],
                "model": "qwen3.7-plus",
                "api_key": "test-key",
                "capability": "deep_solve",
                "mode": "auto",
                "user_id": "stu-thinking-duration",
                "request_id": "req-thinking-duration",
            },
        )

    assert response.status_code == 200
    events = []
    for line in response.text.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: ") :]))

    event_types = [event["type"] for event in events]
    assert calls == 1
    assert "thinking" in event_types
    assert "text_delta" not in event_types
    assert "final_markdown" in event_types
    assert "done" in event_types
    final_markdown = next(event["data"] for event in events if event["type"] == "final_markdown")
    assert final_markdown["finish_reason"] == "duration"
    assert final_markdown["partial"] is True
    assert final_markdown["auto_continuations"] == 0
    assert "耗时过长" in final_markdown["content"]
    done = next(event["data"] for event in events if event["type"] == "done")
    assert done["finish_reason"] == "duration"
    assert done["partial"] is True


def test_ai_chat_stream_long_math_chat_does_not_inject_visible_prelude_by_default(tmp_path: Path):
    db_path = tmp_path / "ai-chat-long-math-prelude.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    async def _fake_stream(**kwargs):
        yield {"type": "status", "message": "模型正在推理"}
        yield {"type": "stream", "content": "正式解答"}
        yield {"type": "done"}

    long_prompt = (
        "Please solve this difficult geometry problem with detailed steps. "
        "In triangle ABC, AB=13, AC=14, BC=15. Point D lies on BC. "
        "Circle omega passes through A and D and is tangent to AB at A. "
        "Another circle gamma passes through A and D and is tangent to AC at A. "
        "The two circles meet again at E. Find the maximum possible area."
    )

    with patch("api_gateway.routes.ai_chat.stream_capability_via_orchestrator", _fake_stream):
        response = client.post(
            "/v1/ai/chat",
            json={
                "messages": [{"role": "user", "content": long_prompt}],
                "model": "qwen3.7-plus",
                "api_key": "test-key",
                "capability": "chat",
                "mode": "fast",
                "user_id": "stu-long-math-prelude",
                "request_id": "req-long-math-prelude",
            },
        )

    assert response.status_code == 200
    events = []
    for line in response.text.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: ") :]))

    text_events = [event["data"]["content"] for event in events if event["type"] == "text_delta"]
    assert text_events == ["正式解答"]
    final_markdown = next(event["data"] for event in events if event["type"] == "final_markdown")
    assert final_markdown["content"] == "正式解答"
    assert final_markdown["finish_reason"] == "stop"


def test_ai_chat_stream_long_math_auto_stays_auto_by_default(tmp_path: Path):
    db_path = tmp_path / "ai-chat-long-math-auto-route.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)
    calls: list[dict[str, Any]] = []

    async def _fake_stream(**kwargs):
        calls.append(kwargs)
        yield {"type": "stream", "content": "可见解题框架"}
        yield {"type": "done"}

    long_prompt = (
        "Please solve this difficult geometry problem with detailed steps. "
        "In triangle ABC, AB=13, AC=14, BC=15. Point D lies on BC. "
        "Circle omega passes through A and D and is tangent to AB at A. "
        "Another circle gamma passes through A and D and is tangent to AC at A. "
        "The two circles meet again at E. Find the maximum possible area."
    )

    with patch("api_gateway.routes.ai_chat.stream_capability_via_orchestrator", _fake_stream):
        response = client.post(
            "/v1/ai/chat",
            json={
                "messages": [{"role": "user", "content": long_prompt}],
                "model": "qwen3.7-plus",
                "api_key": "test-key",
                "capability": "auto",
                "mode": "fast",
                "user_id": "stu-long-math-auto-route",
                "request_id": "req-long-math-auto-route",
            },
        )

    assert response.status_code == 200
    assert calls[0]["capability"] == "auto"
    assert calls[0]["config_overrides"]["mode"] == "fast"
    assert calls[0]["config_overrides"]["model"] == "qwen3.7-plus"


def test_ai_chat_stream_chat_does_not_auto_continue_runaway_output(tmp_path: Path):
    db_path = tmp_path / "ai-chat-truncate.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    calls: list[dict[str, Any]] = []

    async def _fake_stream(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            yield {"type": "stream", "content": "A" * 24}
            yield {"type": "stream", "content": "B" * 24}
            yield {"type": "stream", "content": "unconsumed"}
        else:
            yield {"type": "stream", "content": "C" * 12}
            yield {"type": "done"}

    with (
        patch("api_gateway.routes.ai_chat.stream_capability_via_orchestrator", _fake_stream),
        patch("api_gateway.routes.ai_chat.CAPABILITY_STREAM_OUTPUT_CHARS", {"chat": 40}),
        patch("api_gateway.routes.ai_chat.MAX_AUTO_CONTINUATIONS", 2),
    ):
        response = client.post(
            "/v1/ai/chat",
            json={
                "messages": [{"role": "user", "content": "请持续输出"}],
                "model": "qwen3.7-plus",
                "api_key": "test-key",
                "capability": "chat",
                "mode": "fast",
                "user_id": "stu-truncate",
                "request_id": "req-truncate",
            },
        )

    assert response.status_code == 200
    events = []
    for line in response.text.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: ") :]))

    final_markdown = next(
        event["data"] for event in events if event["type"] == "final_markdown"
    )
    assert final_markdown["content"] == (
        ("A" * 24) + ("B" * 16) + "\n\n[回答超过服务端单次输出保护限制，已暂停。]"
    )
    assert final_markdown["finish_reason"] == "server_char_limit"
    assert final_markdown["partial"] is True
    assert final_markdown["continuation_token"] == "req-truncate:server_char_limit"
    assert final_markdown["auto_continuations"] == 0
    assert final_markdown["auto_continuation_reasons"] == ["server_char_limit"]
    render_metrics = next(
        event["data"] for event in events if event["type"] == "render_metrics"
    )
    assert render_metrics["truncated"] is True
    assert render_metrics["truncated_reason"] == "server_char_limit"
    assert render_metrics["finish_reason"] == "server_char_limit"
    assert render_metrics["auto_continuations"] == 0
    done = next(event["data"] for event in events if event["type"] == "done")
    assert done["partial"] is True
    assert done["continuation_token"] == "req-truncate:server_char_limit"
    assert done["auto_continuations"] == 0
    assert len(calls) == 1


def test_ai_chat_stream_chat_does_not_auto_continue_model_length_finish(tmp_path: Path):
    db_path = tmp_path / "ai-chat-model-length.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)
    calls: list[dict[str, Any]] = []

    async def _fake_stream(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            yield {"type": "stream", "content": "第一段"}
            yield {"type": "done", "metadata": {"finish_reason": "length"}}
        else:
            yield {"type": "stream", "content": "第二段"}
            yield {"type": "done", "metadata": {"finish_reason": "stop"}}

    with (
        patch("api_gateway.routes.ai_chat.stream_capability_via_orchestrator", _fake_stream),
        patch("api_gateway.routes.ai_chat.MAX_AUTO_CONTINUATIONS", 2),
    ):
        response = client.post(
            "/v1/ai/chat",
            json={
                "messages": [{"role": "user", "content": "请详细回答"}],
                "model": "qwen3.7-plus",
                "api_key": "test-key",
                "capability": "chat",
                "mode": "fast",
                "user_id": "stu-model-length",
                "request_id": "req-model-length",
            },
        )

    assert response.status_code == 200
    events = []
    for line in response.text.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: ") :]))

    final_markdown = next(
        event["data"] for event in events if event["type"] == "final_markdown"
    )
    assert final_markdown["content"] == "第一段"
    assert final_markdown["finish_reason"] == "length"
    assert final_markdown["partial"] is True
    assert final_markdown["auto_continuations"] == 0
    assert final_markdown["auto_continuation_reasons"] == ["length"]
    assert len(calls) == 1


def test_ai_chat_stream_deep_solve_does_not_auto_continue_after_limit(tmp_path: Path):
    db_path = tmp_path / "ai-chat-deep-solve-no-auto-continue.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)
    calls: list[dict[str, Any]] = []

    async def _fake_stream(**kwargs):
        calls.append(kwargs)
        yield {"type": "stream", "content": "A" * 48}
        yield {"type": "stream", "content": "unconsumed"}

    with (
        patch("api_gateway.routes.ai_chat.stream_capability_via_orchestrator", _fake_stream),
        patch("api_gateway.routes.ai_chat.CAPABILITY_STREAM_OUTPUT_CHARS", {"deep_solve": 40}),
        patch("api_gateway.routes.ai_chat.MAX_AUTO_CONTINUATIONS", 2),
    ):
        response = client.post(
            "/v1/ai/chat",
            json={
                "messages": [{"role": "user", "content": "请详细解题"}],
                "model": "qwen3.7-plus",
                "api_key": "test-key",
                "capability": "deep_solve",
                "mode": "auto",
                "user_id": "stu-deep-no-continue",
                "request_id": "req-deep-no-continue",
            },
        )

    assert response.status_code == 200
    events = []
    for line in response.text.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: ") :]))

    final_markdown = next(event["data"] for event in events if event["type"] == "final_markdown")
    assert final_markdown["finish_reason"] == "server_char_limit"
    assert final_markdown["partial"] is True
    assert final_markdown["auto_continuations"] == 0
    assert final_markdown["continuation_token"] == "req-deep-no-continue:server_char_limit"
    done = next(event["data"] for event in events if event["type"] == "done")
    assert done["finish_reason"] == "server_char_limit"
    assert len(calls) == 1


def test_ai_chat_image_deep_solve_stays_deep_solve(tmp_path: Path):
    db_path = tmp_path / "ai-chat-deep-image.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)
    captured: dict[str, Any] = {}

    async def _fake_stream(**kwargs):
        captured.update(kwargs)
        yield {"type": "stream", "content": "深度解题回复"}
        yield {"type": "done"}

    upload = client.post(
        "/v1/uploads",
        files={"file": ("problem.png", b"fakepng", "image/png")},
    )
    assert upload.status_code == 200

    with patch("api_gateway.routes.ai_chat.stream_capability_via_orchestrator", _fake_stream):
        response = client.post(
            "/v1/ai/chat/non-streaming",
            json={
                "messages": [{"role": "user", "content": "请严格推导"}],
                "model": "qwen3.7-plus",
                "api_key": "test-key",
                "capability": "deep_solve",
                "mode": "auto",
                "user_id": "stu-deep-image",
                "request_id": "req-deep-image",
                "attachments": [
                    {
                        "type": "image",
                        "object_key": upload.json()["object_key"],
                        "filename": "problem.png",
                        "mime_type": "image/png",
                    }
                ],
            },
        )

    assert response.status_code == 200
    assert captured["capability"] == "deep_solve"
    assert captured.get("config_overrides") == {
        "model": "qwen3.7-plus",
        "max_tokens": 4096,
    }


def test_ai_learning_message_sanitizes_attachment_refs(tmp_path: Path):
    db_path = tmp_path / "ai-learning-attachments.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    session_response = client.post(
        "/v1/ai/sessions",
        json={"user_id": "stu-attach", "title": "附件测试"},
    )
    assert session_response.status_code == 200
    session_id = session_response.json()["session_id"]

    message_response = client.post(
        f"/v1/ai/sessions/{session_id}/messages",
        json={
            "role": "user",
            "content": "请分析这张图片",
            "user_id": "stu-attach",
            "attachments": [
                {
                    "type": "image",
                    "objectKey": "uploads/problem.png",
                    "name": "problem.png",
                    "mimeType": "image/png",
                    "size": 7,
                    "uri": "file:///local/problem.png",
                    "base64": "ZmFrZXBuZw==",
                }
            ],
        },
    )

    assert message_response.status_code == 200
    attachment = message_response.json()["attachments"][0]
    assert attachment == {
        "type": "image",
        "object_key": "uploads/problem.png",
        "file_name": "problem.png",
        "mime_type": "image/png",
        "file_size": 7,
    }
    assert "base64" not in attachment
    assert "uri" not in attachment


def test_ai_learning_create_message_retries_sqlite_lock(tmp_path: Path):
    db_path = tmp_path / "ai-learning-message-lock-retry.db"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
    )
    app = create_app(settings_override=settings, queue_client_override=FakeQueueClient())
    client = TestClient(app)

    session_response = client.post(
        "/v1/ai/sessions",
        json={"user_id": "stu-lock-retry", "title": "锁重试"},
    )
    assert session_response.status_code == 200
    session_id = session_response.json()["session_id"]

    from api_gateway.chat_service import create_ai_message as real_create_ai_message

    calls = 0

    def _flaky_create_ai_message(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise OperationalError(
                "INSERT INTO ai_chat_messages",
                {},
                Exception("database is locked"),
            )
        return real_create_ai_message(*args, **kwargs)

    with patch(
        "api_gateway.routes.ai_learning.create_ai_message",
        _flaky_create_ai_message,
    ):
        response = client.post(
            f"/v1/ai/sessions/{session_id}/messages",
            json={
                "role": "assistant",
                "content": "lock retry ok",
                "user_id": "stu-lock-retry",
            },
        )

    assert response.status_code == 200
    assert calls == 2
    assert response.json()["content"] == "lock retry ok"


def test_ai_learning_messages_page_latest_and_before_seq(tmp_path: Path):
    db_path = tmp_path / "ai-learning-pagination.db"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
    )
    app = create_app(settings_override=settings, queue_client_override=FakeQueueClient())
    client = TestClient(app)

    session_response = client.post(
        "/v1/ai/sessions",
        json={"user_id": "stu-page", "title": "分页测试"},
    )
    assert session_response.status_code == 200
    session_id = session_response.json()["session_id"]

    for idx in range(5):
        message_response = client.post(
            f"/v1/ai/sessions/{session_id}/messages",
            json={
                "role": "user" if idx % 2 == 0 else "assistant",
                "content": f"message-{idx + 1}",
                "user_id": "stu-page",
            },
        )
        assert message_response.status_code == 200

    latest_response = client.get(
        f"/v1/ai/sessions/{session_id}/messages?limit=2",
    )
    assert latest_response.status_code == 200
    latest_messages = latest_response.json()
    assert [message["content"] for message in latest_messages] == [
        "message-4",
        "message-5",
    ]

    before_seq = latest_messages[0]["runtime_seq"]
    older_response = client.get(
        f"/v1/ai/sessions/{session_id}/messages?limit=2&before_seq={before_seq}",
    )
    assert older_response.status_code == 200
    older_messages = older_response.json()
    assert [message["content"] for message in older_messages] == [
        "message-2",
        "message-3",
    ]
    assert older_messages[0]["content_truncated"] is False

    long_message_response = client.post(
        f"/v1/ai/sessions/{session_id}/messages",
        json={
            "role": "assistant",
            "content": "x" * 1200,
            "user_id": "stu-page",
        },
    )
    assert long_message_response.status_code == 200

    truncated_response = client.get(
        f"/v1/ai/sessions/{session_id}/messages?limit=1&max_content_chars=500",
    )
    assert truncated_response.status_code == 200
    truncated_message = truncated_response.json()[0]
    assert truncated_message["content_length"] == 1200
    assert truncated_message["content_truncated"] is True
    assert truncated_message["history_preview_only"] is True
    assert truncated_message["full_content_ref"] == long_message_response.json()["message_id"]
    assert len(truncated_message["content"]) < 700

    full_response = client.get(
        f"/v1/ai/messages/{truncated_message['message_id']}",
    )
    assert full_response.status_code == 200
    full_message = full_response.json()
    assert full_message["content"] == "x" * 1200
    assert full_message["content_truncated"] is False
    assert full_message["history_preview_only"] is False

    stored_long_response = client.post(
        f"/v1/ai/sessions/{session_id}/messages",
        json={
            "role": "assistant",
            "content": "y" * 7000,
            "user_id": "stu-page",
        },
    )
    assert stored_long_response.status_code == 200
    stored_long_message = stored_long_response.json()
    assert stored_long_message["content"] == "y" * 7000
    assert stored_long_message["storage_preview_only"] is False


def test_api_contract_uploads_and_jobs(tmp_path: Path):
    db_path = tmp_path / "gateway.db"
    storage_root = tmp_path / "objects"

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
        worker_temp_root=str(tmp_path / "tmp"),
    )

    queue = FakeQueueClient()
    storage = LocalObjectStorage(storage_root)

    app = create_app(settings_override=settings, queue_client_override=queue, storage_override=storage)
    client = TestClient(app)

    up = client.post(
        "/v1/uploads",
        files={"file": ("problem.png", b"fakepng", "image/png")},
    )
    assert up.status_code == 200
    up_json = up.json()
    assert up_json["object_key"].startswith("uploads/")

    create = client.post(
        "/v1/jobs",
        json={
            "job_type": "problem_video_generate",
            "user_id": "u2",
            "payload": {"image_object_key": up_json["object_key"]},
        },
    )
    assert create.status_code == 200
    create_json = create.json()
    assert create_json["status"] == "queued"
    job_id = create_json["job_id"]

    query = client.get(f"/v1/jobs/{job_id}")
    assert query.status_code == 200
    assert query.json()["job_type"] == "problem_video_generate"

    result = client.get(f"/v1/jobs/{job_id}/result")
    assert result.status_code == 409


def test_create_job_marks_failed_when_enqueue_fails(tmp_path: Path):
    db_path = tmp_path / "gateway-enqueue-fails.db"
    storage_root = tmp_path / "objects"
    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
        worker_temp_root=str(tmp_path / "tmp"),
    )

    app = create_app(
        settings_override=settings,
        queue_client_override=FailingQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    response = client.post(
        "/v1/jobs",
        json={
            "job_type": "problem_video_generate",
            "user_id": "u2",
            "payload": {"image_object_key": "uploads/problem.png"},
        },
    )

    assert response.status_code == 503
    assert response.json()["error_code"] == "JOB_ENQUEUE_FAILED"

    with session_scope() as session:
        job = session.query(Job).filter(Job.error_code == "JOB_ENQUEUE_FAILED").one()
        assert job.status == "failed"
        assert job.error_code == "JOB_ENQUEUE_FAILED"


def test_gateway_health_endpoints_remain_available(tmp_path: Path):
    db_path = tmp_path / "gateway-health.db"
    storage_root = tmp_path / "objects"
    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
        worker_temp_root=str(tmp_path / "tmp"),
    )

    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    root = client.get("/")
    assert root.status_code == 200
    assert root.json()["health"] == "/healthz"

    health = client.get("/healthz")
    assert health.status_code == 200
    assert health.json()["ok"] is True
    assert "queue_backend" in health.json()


def test_local_storage_root_is_independent_from_process_cwd(tmp_path: Path, monkeypatch):
    settings = Settings(local_storage_root="./gateway_data/test-objects")
    monkeypatch.chdir(tmp_path)

    storage = build_storage(settings)

    assert isinstance(storage, LocalObjectStorage)
    assert storage.root.is_absolute()
    assert storage.root == Path(__file__).resolve().parents[1] / "gateway_data" / "test-objects"


def test_local_storage_returns_gateway_object_url(tmp_path: Path):
    source = tmp_path / "final.mp4"
    source.write_bytes(b"video")
    storage = LocalObjectStorage(tmp_path / "objects")

    url = storage.upload_file(str(source), "jobs/job-1/problem_video/final.mp4")

    assert url == "/v1/objects/jobs/job-1/problem_video/final.mp4"


def test_study_package_requires_output():
    try:
        validate_job_payload(
            JobType.STUDY_PACKAGE_GENERATE,
            {"source": {"type": "topic", "topic": "相似三角形"}, "outputs": {"course": False, "problem_video": False}},
        )
    except Exception as exc:
        assert "cannot both be false" in str(exc)
    else:
        raise AssertionError("Expected validation failure")


def test_problem_video_payload_preserves_llm_config():
    normalized = validate_job_payload(
        JobType.PROBLEM_VIDEO_GENERATE,
        {
            "image_object_key": "uploads/problem.png",
            "model_name": "qwen:qwen3.5-flash",
            "llm_config": {
                "model": "qwen:qwen3.5-flash",
                "vision_model": "qwen:qwen3-vl-plus",
                "ocr_model": "qwen:qwen-vl-ocr-latest",
                "api_key": "openai-key",
                "base_url": "https://api.openai.com/v1",
                "vision_api_key": "dashscope-vision-key",
                "vision_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                "ocr_api_key": "dashscope-ocr-key",
                "ocr_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            },
        },
    )

    assert normalized["model_name"] == "qwen:qwen3.5-flash"
    assert normalized["llm_config"]["api_key"] == "openai-key"
    assert normalized["llm_config"]["base_url"] == "https://api.openai.com/v1"
    assert normalized["llm_config"]["vision_api_key"] == "dashscope-vision-key"
    assert normalized["llm_config"]["vision_base_url"] == "https://dashscope.aliyuncs.com/compatible-mode/v1"
    assert normalized["llm_config"]["ocr_api_key"] == "dashscope-ocr-key"
    assert normalized["llm_config"]["ocr_base_url"] == "https://dashscope.aliyuncs.com/compatible-mode/v1"
    assert normalized["llm_config"]["vision_model"] == "qwen:qwen3-vl-plus"
    assert normalized["llm_config"]["ocr_model"] == "qwen:qwen-vl-ocr-latest"


def test_problem_video_runtime_config_applies_role_specific_provider_config():
    llm_config, vision_config, ocr_config = _merge_runtime_configs(
        base_llm_config={
            "api_key": "",
            "base_url": "https://ark.cn-beijing.volces.com/api/v3",
            "model": "doubao-seed-2-0-pro-260215",
        },
        base_vision_config={
            "api_key": "",
            "base_url": "https://ark.cn-beijing.volces.com/api/v3",
            "model": "doubao-1.5-vision-pro-250328",
        },
        base_ocr_config={
            "api_key": "",
            "base_url": "https://ark.cn-beijing.volces.com/api/v3",
            "model": "doubao-1.5-vision-pro-250328",
        },
        override={
            "api_key": "openai-key",
            "base_url": "https://api.openai.com/v1",
            "model": "gpt-4o-mini",
            "vision_api_key": "dashscope-vision-key",
            "vision_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "vision_model": "qwen:qwen-vl-max",
            "ocr_api_key": "dashscope-ocr-key",
            "ocr_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "ocr_model": "qwen:qwen-vl-ocr-latest",
        },
    )

    assert llm_config["api_key"] == "openai-key"
    assert llm_config["base_url"] == "https://api.openai.com/v1"
    assert llm_config["model"] == "gpt-4o-mini"
    assert vision_config["api_key"] == "dashscope-vision-key"
    assert vision_config["base_url"] == "https://dashscope.aliyuncs.com/compatible-mode/v1"
    assert vision_config["model"] == "qwen-vl-max"
    assert ocr_config["api_key"] == "dashscope-ocr-key"
    assert ocr_config["base_url"] == "https://dashscope.aliyuncs.com/compatible-mode/v1"
    assert ocr_config["model"] == "qwen-vl-ocr-latest"


def test_problem_video_runtime_config_does_not_inherit_text_credentials_for_explicit_role():
    _llm_config, vision_config, ocr_config = _merge_runtime_configs(
        base_llm_config={
            "api_key": "",
            "base_url": "https://ark.cn-beijing.volces.com/api/v3",
            "model": "doubao-seed-2-0-pro-260215",
        },
        base_vision_config={
            "api_key": "base-vision-key",
            "base_url": "https://ark.cn-beijing.volces.com/api/v3",
            "model": "doubao-1.5-vision-pro-250328",
        },
        base_ocr_config={
            "api_key": "base-ocr-key",
            "base_url": "https://ark.cn-beijing.volces.com/api/v3",
            "model": "doubao-1.5-vision-pro-250328",
        },
        override={
            "api_key": "text-key",
            "base_url": "https://api.openai.com/v1",
            "model": "gpt-4o-mini",
            "__vision_explicit": True,
            "vision_model": "qwen:qwen-vl-max",
            "__ocr_explicit": True,
            "ocr_model": "qwen:qwen-vl-ocr-latest",
        },
    )

    assert "api_key" not in vision_config
    assert "base_url" not in vision_config
    assert vision_config["model"] == "qwen-vl-max"
    assert "api_key" not in ocr_config
    assert "base_url" not in ocr_config
    assert ocr_config["model"] == "qwen-vl-ocr-latest"


def test_problem_video_server_defaults_use_env_when_mobile_omits_llm_config(monkeypatch):
    monkeypatch.setenv("DEFAULT_MODEL", "qwen:qwen3.6-max-preview")
    monkeypatch.setenv("QWEN_API_KEY", "server-qwen-key")
    monkeypatch.setenv("QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    monkeypatch.delenv("PROBLEM_VIDEO_TEXT_MODEL", raising=False)
    monkeypatch.delenv("PROBLEM_VIDEO_VISION_MODEL", raising=False)
    monkeypatch.delenv("PROBLEM_VIDEO_OCR_MODEL", raising=False)

    llm_config, vision_config, ocr_config = _merge_runtime_configs(
        base_llm_config=build_default_llm_config(),
        base_vision_config=build_vision_model_config(),
        base_ocr_config=build_ocr_model_config(),
        override={},
    )

    assert llm_config["api_key"] == "server-qwen-key"
    assert llm_config["base_url"] == "https://dashscope.aliyuncs.com/compatible-mode/v1"
    assert llm_config["model"] == "qwen3.6-max-preview"
    assert vision_config["api_key"] == "server-qwen-key"
    assert vision_config["base_url"] == "https://dashscope.aliyuncs.com/compatible-mode/v1"
    assert vision_config["model"] == "qwen3.6-plus-2026-04-02"
    assert ocr_config["api_key"] == "server-qwen-key"
    assert ocr_config["base_url"] == "https://dashscope.aliyuncs.com/compatible-mode/v1"
    assert ocr_config["model"] == "qwen3.5-ocr"


def test_problem_video_role_model_env_overrides_are_server_side(monkeypatch):
    monkeypatch.setenv("DEFAULT_MODEL", "qwen:qwen-text-env")
    monkeypatch.setenv("PROBLEM_VIDEO_VISION_MODEL", "qwen:qwen-vision-env")
    monkeypatch.setenv("PROBLEM_VIDEO_OCR_MODEL", "qwen:qwen-ocr-env")
    monkeypatch.setenv("QWEN_API_KEY", "server-qwen-key")
    monkeypatch.setenv("QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")

    assert build_default_llm_config()["model"] == "qwen-text-env"
    assert build_vision_model_config()["model"] == "qwen-vision-env"
    assert build_ocr_model_config()["model"] == "qwen-ocr-env"


def test_problem_video_result_contract(tmp_path: Path):
    db_path = tmp_path / "pv.db"
    obj_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()
    storage = LocalObjectStorage(obj_root)

    fake_video = tmp_path / "fake.mp4"
    fake_video.write_bytes(b"video")

    with session_scope() as session:
        job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u1",
            idempotency_key="idem-problem-video-contract",
            status="running",
            progress=0,
            step="running",
            max_retries=0,
            input_payload={"image_object_key": "uploads/a.png"},
            normalized_payload={"image_object_key": "uploads/a.png", "output_profile": "1080p"},
            engine_state={},
        )
        session.add(job)
        session.flush()

        with patch(
            "api_gateway.job_service.run_problem_video_job",
            return_value=ProblemVideoExecutionResult(
                video_path=str(fake_video),
                duration_sec=12.5,
                script_steps_count=4,
                debug_bundle_path=None,
                requirement_hint="hint",
            ),
        ):
            result = _run_problem_video_generate(
                session=session,
                job=job,
                payload={"image_object_key": "uploads/a.png", "output_profile": "1080p"},
                settings=Settings(local_storage_root=str(obj_root)),
                storage=storage,
            )

        assert set(result.keys()) >= {
            "video_url",
            "duration_sec",
            "script_steps_count",
            "debug_bundle_url",
            "learner_memory_records",
            "learner_memory_events",
        }


def test_problem_video_pipeline_attaches_learner_memory_bundle(tmp_path: Path):
    db_path = tmp_path / "pv-memory.db"
    obj_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()
    storage = LocalObjectStorage(obj_root)

    fake_video = tmp_path / "memory_fake.mp4"
    fake_video.write_bytes(b"video")
    now = datetime.utcnow()

    with session_scope() as session:
        ai_session = AIChatSession(
            id="sess-memory-1",
            user_id="stu-memory-1",
            title="memory",
            source="课后答疑",
            subject="数学",
            archived_flag=False,
            created_at=now - timedelta(days=2),
            updated_at=now - timedelta(days=1),
        )
        record = AILearningRecord(
            id=str(uuid4()),
            user_id="stu-memory-1",
            session_id="sess-memory-1",
            message_id=None,
            subject="数学",
            knowledge_point="勾股定理",
            question_type="qa",
            difficulty="hard",
            solved_flag=False,
            confusion_flag=True,
            extract_version="v1",
            created_at=now - timedelta(hours=8),
        )
        job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="stu-memory-1",
            idempotency_key="idem-problem-video-memory-contract",
            status="running",
            progress=0,
            step="running",
            max_retries=0,
            input_payload={"image_object_key": "uploads/a.png"},
            normalized_payload={
                "image_object_key": "uploads/a.png",
                "output_profile": "1080p",
                "learner_user_id": "stu-memory-1",
                "learner_session_id": "sess-memory-1",
                "learner_lookback_days": 30,
                "learning_context": {
                    "userId": "stu-memory-1",
                    "stepPersonalization": {
                        "overallMode": "remedial",
                        "standardSteps": [
                            {
                                "id": "step-1",
                                "title": "建立勾股关系",
                                "knowledgePointIds": ["勾股定理"],
                                "abilityTags": ["建模"],
                            }
                        ],
                        "stepDecisions": [
                            {
                                "stepId": "step-1",
                                "mastery": 0.32,
                                "riskLevel": "high",
                                "expansionStrategy": "full_scaffold",
                                "needsExpansion": True,
                                "likelyStuck": True,
                            }
                        ],
                    },
                },
            },
            engine_state={},
        )
        session.add_all([ai_session, record, job])
        session.flush()

        captured_payload: dict[str, Any] = {}

        def _fake_run_problem_video_job(payload, **kwargs):
            captured_payload.update(payload)
            return ProblemVideoExecutionResult(
                video_path=str(fake_video),
                duration_sec=9.8,
                script_steps_count=2,
                debug_bundle_path=None,
                requirement_hint="hint",
            )

        with patch(
            "api_gateway.job_service.get_student_profile_snapshot",
            return_value={
                "user_id": "stu-memory-1",
                "weak_subjects": ["数学"],
                "weak_knowledge_points": ["勾股定理"],
                "recent_focus": "数学",
                "ability_scores": [],
                "learning_stats": {
                    "records_total": 1,
                    "records_14d": 1,
                    "active_days_14": 1,
                    "confusion_records": 1,
                    "solved_records": 0,
                    "top_subjects": ["数学"],
                    "top_knowledge_points": ["勾股定理"],
                    "total_weight": 1.0,
                },
                "updated_at": now.isoformat(),
                "computed_at": now.isoformat(),
                "profile_source": "computed_with_decay",
            },
        ), patch("api_gateway.job_service.run_problem_video_job", side_effect=_fake_run_problem_video_job):
            result = _run_problem_video_generate(
                session=session,
                job=job,
                payload=job.normalized_payload,
                settings=Settings(local_storage_root=str(obj_root)),
                storage=storage,
            )

        assert "learner_memory" in captured_payload
        learner_memory = captured_payload["learner_memory"]
        assert learner_memory["user_id"] == "stu-memory-1"
        assert learner_memory["session_id"] == "sess-memory-1"
        assert len(learner_memory["recent_learning_records"]) == 1
        assert len(learner_memory["derived_learning_events"]) == 1
        assert learner_memory["learning_context"]["userId"] == "stu-memory-1"
        assert learner_memory["step_personalization"]["overallMode"] == "remedial"
        assert learner_memory["step_personalization"]["standardSteps"][0]["id"] == "step-1"
        assert result["learner_memory_records"] == 1
        assert result["learner_memory_events"] == 1


def test_problem_video_missing_input_is_failed_without_retry(tmp_path: Path):
    db_path = tmp_path / "missing-input.db"
    obj_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    queue = FakeQueueClient()
    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(obj_root),
        max_retries=2,
    )
    storage = LocalObjectStorage(obj_root)

    with session_scope() as session:
        job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u1",
            idempotency_key="idem-problem-video-missing-input",
            status="queued",
            progress=0,
            step="queued",
            max_retries=2,
            input_payload={"image_object_key": "uploads/missing.png"},
            normalized_payload={"image_object_key": "uploads/missing.png", "output_profile": "1080p"},
            engine_state={},
        )
        session.add(job)
        session.flush()
        message = QueueMessage(job_id=job.id, job_type=job.job_type, queue_name=job.queue_name)

        with patch("api_gateway.job_service.execute_job", side_effect=MissingInputObjectError("object not found")):
            handle_worker_message(
                session=session,
                queue_client=queue,
                message=message,
                settings=settings,
                storage=storage,
            )

        refreshed = session.get(Job, job.id)
        assert refreshed is not None
        assert refreshed.status == "failed"
        assert refreshed.error_code == "JOB_INPUT_MISSING"
        assert refreshed.attempt_count == 0
        assert queue.items == []
        assert queue.dead_letters == []


def test_fail_jobs_with_missing_input_objects_marks_queued_only(tmp_path: Path):
    db_path = tmp_path / "missing-input-cleanup.db"
    obj_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    storage = LocalObjectStorage(obj_root)

    with session_scope() as session:
        queued_job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u1",
            idempotency_key="idem-missing-input-queued",
            status="queued",
            progress=0,
            step="queued",
            max_retries=2,
            input_payload={"image_object_key": "uploads/missing-queued.png"},
            normalized_payload={"image_object_key": "uploads/missing-queued.png", "output_profile": "1080p"},
            engine_state={},
        )
        running_job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u2",
            idempotency_key="idem-missing-input-running",
            status="running",
            progress=35,
            step="running_anotherme2",
            max_retries=2,
            input_payload={"image_object_key": "uploads/missing-running.png"},
            normalized_payload={"image_object_key": "uploads/missing-running.png", "output_profile": "1080p"},
            engine_state={},
        )
        healthy_job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u3",
            idempotency_key="idem-present-input",
            status="queued",
            progress=0,
            step="queued",
            max_retries=2,
            input_payload={"image_object_key": "uploads/present.png"},
            normalized_payload={"image_object_key": "uploads/present.png", "output_profile": "1080p"},
            engine_state={},
        )
        geometry_missing_job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u4",
            idempotency_key="idem-missing-geometry",
            status="queued",
            progress=0,
            step="queued",
            max_retries=2,
            input_payload={"image_object_key": "uploads/present-geometry.png", "geometry_file": "uploads/missing-geo.json"},
            normalized_payload={
                "image_object_key": "uploads/present-geometry.png",
                "geometry_file": "uploads/missing-geo.json",
                "output_profile": "1080p",
            },
            engine_state={},
        )
        session.add_all([queued_job, running_job, healthy_job, geometry_missing_job])
        session.flush()

        (obj_root / "uploads").mkdir(parents=True, exist_ok=True)
        (obj_root / "uploads" / "present.png").write_bytes(b"ok")
        (obj_root / "uploads" / "present-geometry.png").write_bytes(b"ok")

        cleaned = fail_jobs_with_missing_input_objects(
            session,
            storage,
            ["q.problem_video"],
            max_failures=5,
        )

        assert cleaned == 2
        assert queued_job.status == "failed"
        assert geometry_missing_job.status == "failed"
        assert running_job.status == "running"
        assert queued_job.error_code == "JOB_INPUT_MISSING"
        assert geometry_missing_job.error_code == "JOB_INPUT_MISSING"
        assert running_job.error_code is None
        assert healthy_job.status == "queued"


def test_reconcile_running_job_with_uploaded_artifact_marks_succeeded(tmp_path: Path):
    db_path = tmp_path / "reconcile-running.db"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    with session_scope() as session:
        job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u1",
            idempotency_key="idem-reconcile-running",
            status="running",
            progress=80,
            step="uploading_artifacts",
            max_retries=2,
            input_payload={"image_object_key": "uploads/present.png"},
            normalized_payload={"image_object_key": "uploads/present.png", "output_profile": "1080p"},
            engine_state={"duration_sec": 21.5, "script_steps_count": 5},
        )
        session.add(job)
        session.flush()

        session.add(
            JobArtifact(
                job_id=job.id,
                artifact_type="problem_video",
                object_key=f"jobs/{job.id}/problem_video/final.mp4",
                url=f"http://127.0.0.1:9000/jobs/{job.id}/problem_video/final.mp4",
                artifact_metadata=None,
            )
        )
        session.flush()

        changed = reconcile_single_running_problem_video_job_with_artifacts(session, job)
        assert changed is True
        assert job.status == "succeeded"
        assert job.step == "completed"
        assert job.result_payload is not None
        assert job.result_payload.get("video_url", "").endswith("/final.mp4")
        assert job.result_payload.get("duration_sec") == 21.5
        assert job.result_payload.get("script_steps_count") == 5


def test_purge_prestart_nonterminal_jobs_marks_queued_and_running_failed(tmp_path: Path):
    db_path = tmp_path / "purge-prestart.db"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    with session_scope() as session:
        queued_job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u1",
            idempotency_key="idem-prestart-queued",
            status="queued",
            progress=0,
            step="queued",
            max_retries=2,
            input_payload={"image_object_key": "uploads/a.png"},
            normalized_payload={"image_object_key": "uploads/a.png", "output_profile": "1080p"},
            engine_state={},
        )
        running_job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u2",
            idempotency_key="idem-prestart-running",
            status="running",
            progress=65,
            step="uploading_artifacts",
            max_retries=2,
            input_payload={"image_object_key": "uploads/b.png"},
            normalized_payload={"image_object_key": "uploads/b.png", "output_profile": "1080p"},
            engine_state={},
        )
        succeeded_job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u3",
            idempotency_key="idem-prestart-succeeded",
            status="succeeded",
            progress=100,
            step="completed",
            max_retries=2,
            input_payload={"image_object_key": "uploads/c.png"},
            normalized_payload={"image_object_key": "uploads/c.png", "output_profile": "1080p"},
            engine_state={},
        )
        session.add_all([queued_job, running_job, succeeded_job])
        session.flush()

        purged = purge_prestart_nonterminal_jobs(session, max_purge=10)
        assert purged == 2
        assert queued_job.status == "failed"
        assert running_job.status == "failed"
        assert queued_job.error_code == "JOB_PURGED_ON_RESTART"
        assert running_job.error_code == "JOB_PURGED_ON_RESTART"
        assert succeeded_job.status == "succeeded"


def test_api_learning_records_and_student_profile_contract(tmp_path: Path):
    db_path = tmp_path / "learning-profile.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    user_id = "stu-1"
    session_id = str(uuid4())
    user_msg_id = str(uuid4())
    now = datetime.utcnow()

    with session_scope() as session:
        ai_session = AIChatSession(
            id=session_id,
            user_id=user_id,
            title="测试会话",
            source="课后答疑",
            subject="数学",
            archived_flag=False,
            created_at=now - timedelta(hours=4),
            updated_at=now - timedelta(hours=1),
        )
        ai_message = AIChatMessage(
            id=user_msg_id,
            session_id=session_id,
            role="user",
            content="我不懂二次函数图像",
            content_type="text",
            created_at=now - timedelta(hours=3),
        )
        learning_record = AILearningRecord(
            id=str(uuid4()),
            user_id=user_id,
            session_id=session_id,
            message_id=user_msg_id,
            subject="数学",
            knowledge_point="二次函数",
            question_type="qa",
            difficulty="medium",
            solved_flag=False,
            confusion_flag=True,
            extract_version="v1",
            created_at=now - timedelta(hours=2),
        )
        profile = StudentProfile(
            user_id=user_id,
            weak_subjects=["数学"],
            weak_knowledge_points=["二次函数"],
            recent_focus="数学",
            updated_at=now - timedelta(hours=1),
        )
        session.add_all([ai_session, ai_message, learning_record, profile])
        session.flush()

    learning_resp = client.get(
        f"/v1/ai/sessions/{session_id}/learning-records",
        params={"user_id": user_id, "limit": 20},
    )
    assert learning_resp.status_code == 200
    learning_payload = learning_resp.json()
    assert isinstance(learning_payload, list)
    assert len(learning_payload) == 1
    assert learning_payload[0]["knowledge_point"] == "二次函数"
    assert learning_payload[0]["confusion_flag"] is True

    profile_resp = client.get(f"/v1/students/{user_id}/profile")
    assert profile_resp.status_code == 200
    profile_payload = profile_resp.json()
    assert profile_payload["user_id"] == user_id
    assert profile_payload["profile_source"] in {"computed_with_decay", "profile_only"}
    assert isinstance(profile_payload["ability_scores"], list)
    assert len(profile_payload["ability_scores"]) == 5
    assert "数学" in profile_payload["weak_subjects"]
    assert profile_payload["learning_stats"]["records_total"] >= 1


def test_learning_events_api_and_profile_signal(tmp_path: Path):
    db_path = tmp_path / "learning-events.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    missing_user_resp = client.post(
        "/v1/learning-events",
        json={
            "event_type": "quiz_answered",
            "knowledge_points": ["二次函数"],
            "payload": {"is_correct": False, "subject": "数学"},
        },
    )
    assert missing_user_resp.status_code == 400

    event_resp = client.post(
        "/v1/users/stu-events-1/learning-events",
        json={
            "event_type": "quiz_answered",
            "classroom_id": "class-1",
            "scene_id": "scene-1",
            "block_id": "block-scene-1",
            "knowledge_points": ["二次函数"],
            "payload": {"is_correct": False, "subject": "数学"},
            "weight": 1.2,
        },
    )
    assert event_resp.status_code == 200
    event_payload = event_resp.json()
    assert event_payload["user_id"] == "stu-events-1"
    assert event_payload["event_type"] == "quiz_answered"

    with session_scope() as session:
        assert session.query(LearningEvent).filter(LearningEvent.user_id == "stu-events-1").count() == 1

    events_resp = client.get("/v1/users/stu-events-1/learning-events")
    assert events_resp.status_code == 200
    assert len(events_resp.json()) == 1

    profile_resp = client.get("/v1/students/stu-events-1/profile")
    assert profile_resp.status_code == 200
    profile_payload = profile_resp.json()
    assert "二次函数" in profile_payload["weak_knowledge_points"]
    assert profile_payload["learning_stats"]["records_total"] == 1


def test_api_learning_records_rejects_unowned_session_access(tmp_path: Path):
    db_path = tmp_path / "learning-profile-unauth.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    with session_scope() as session:
        session.add(
            AIChatSession(
                id=str(uuid4()),
                user_id="owner-1",
                title="only owner",
                source="课后答疑",
                subject="数学",
                archived_flag=False,
            )
        )
        session.flush()
        target_session_id = session.query(AIChatSession.id).first()[0]

    denied_resp = client.get(
        f"/v1/ai/sessions/{target_session_id}/learning-records",
        params={"user_id": "attacker"},
    )
    assert denied_resp.status_code == 400
    denied_payload = denied_resp.json()
    assert denied_payload["error_code"] == "INVALID_REQUEST"


def test_normalize_html_line_breaks_converts_br_and_p_tags():
    assert _normalize_html_line_breaks("a<br>b") == "a\nb"
    assert _normalize_html_line_breaks("a<br/>b") == "a\nb"
    assert _normalize_html_line_breaks("a<br />b") == "a\nb"
    assert _normalize_html_line_breaks("<p>a</p>b") == "\na\nb"
    assert _normalize_html_line_breaks("no tags") == "no tags"


def test_extract_answer_blocks_splits_html_br_content_same_as_markdown():
    markdown = (
        "### 1. 核心定义\n"
        "**勾股定理**描述的是直角三角形。\n\n"
        "* **文字表述**：两条直角边平方和等于斜边平方。\n"
        "* **数学公式**：$$a^2 + b^2 = c^2$$\n\n"
        "### 2. 例子\n"
        "假设直角边为 3 和 4。\n"
    )
    html_version = (
        markdown.replace("\n\n", "<br><br>")
        .replace("\n", "<br>")
        .replace("<br><br>", "<br><br>")
    )

    md_blocks = _extract_answer_blocks(markdown, request_id="req-md")
    html_blocks = _extract_answer_blocks(html_version, request_id="req-html")

    assert len(md_blocks) > 1
    assert len(html_blocks) == len(md_blocks)
    for md_block, html_block in zip(md_blocks, html_blocks):
        assert md_block["data"]["type"] == html_block["data"]["type"]
        assert md_block["data"]["content"] == html_block["data"]["content"]


def test_extract_answer_blocks_html_br_produces_multiple_blocks():
    html = "Line one<br><br>Line two<br>Line three"
    blocks = _extract_answer_blocks(html, request_id="req-br")
    assert len(blocks) >= 2
    contents = [b["data"]["content"] for b in blocks]
    assert "Line one" in contents
    assert "Line two" in contents or "Line two\nLine three" in contents


def test_extract_math_blocks_extracts_formula_surrounded_by_html_br():
    html = "前置说明<br>$$a^2 + b^2 = c^2$$<br>后续内容"
    blocks = _extract_math_blocks(html, request_id="req-math-br")
    assert len(blocks) == 1
    assert blocks[0]["data"]["content"] == "a^2 + b^2 = c^2"
