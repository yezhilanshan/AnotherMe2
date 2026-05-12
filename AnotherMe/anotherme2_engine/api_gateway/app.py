"""FastAPI app exposing unified backend job APIs."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from . import db as db_module
from .config import Settings, get_settings
from .db import get_db, init_db, reconfigure_db
from .job_service import purge_prestart_nonterminal_jobs
from agents.foundation.capability_registry import CapabilityRegistry, create_default_registry
from .models import Job
from .queueing import build_queue_client
from .routes.auth import require_token
from .routes.ai_learning import create_ai_learning_router
from .routes.core import create_core_router
from .routes.jobs import create_jobs_router
from .routes.knowledge import create_knowledge_router
from .routes.messages import create_messages_router
from .routes.uploads import create_uploads_router
from .storage import ObjectStorage, build_storage


class QueueClientProtocol:
    def enqueue(self, queue_name, message):
        raise NotImplementedError

    def ping(self):
        raise NotImplementedError


class ConversationSocketHub:
    def __init__(self):
        self._connections: dict[str, dict[str, set[WebSocket]]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, conversation_id: str, user_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            by_user = self._connections.setdefault(conversation_id, {})
            by_user.setdefault(user_id, set()).add(websocket)

    async def disconnect(self, conversation_id: str, user_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            by_user = self._connections.get(conversation_id)
            if not by_user:
                return

            targets = by_user.get(user_id)
            if not targets:
                return

            targets.discard(websocket)
            if not targets:
                by_user.pop(user_id, None)

            if not by_user:
                self._connections.pop(conversation_id, None)

    async def broadcast(self, conversation_id: str, payload: dict) -> None:
        async with self._lock:
            by_user = self._connections.get(conversation_id, {})
            sockets: list[tuple[str, WebSocket]] = []
            for user_id, targets in by_user.items():
                for socket in targets:
                    sockets.append((user_id, socket))
        if not sockets:
            return

        text = json.dumps(payload, ensure_ascii=False)
        dead: list[tuple[str, WebSocket]] = []
        for user_id, socket in sockets:
            try:
                await socket.send_text(text)
            except Exception:
                dead.append((user_id, socket))

        if dead:
            async with self._lock:
                by_user = self._connections.get(conversation_id)
                if not by_user:
                    return

                for user_id, socket in dead:
                    targets = by_user.get(user_id)
                    if not targets:
                        continue
                    targets.discard(socket)
                    if not targets:
                        by_user.pop(user_id, None)

                if not by_user:
                    self._connections.pop(conversation_id, None)

    async def disconnect_user(self, conversation_id: str, user_id: str, code: int = 4403) -> None:
        sockets: list[WebSocket] = []
        async with self._lock:
            by_user = self._connections.get(conversation_id)
            if not by_user:
                return

            sockets = list(by_user.pop(user_id, set()))
            if not by_user:
                self._connections.pop(conversation_id, None)

        for socket in sockets:
            try:
                await socket.close(code=code)
            except Exception:
                pass


class ConversationEventBus:
    _CHANNEL = "gateway:conversation_events"

    def __init__(self, redis_url: str, hub: ConversationSocketHub):
        self._redis_url = redis_url
        self._hub = hub
        self._instance_id = uuid4().hex
        self._enabled = False
        self._pub_client = None
        self._sub_client = None
        self._pubsub = None
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if not self._redis_url or "unused" in self._redis_url:
            return
        try:
            import redis.asyncio as redis_async
        except Exception:
            return

        try:
            self._pub_client = redis_async.Redis.from_url(
                self._redis_url,
                decode_responses=True,
                socket_connect_timeout=1,
                socket_timeout=1,
            )
            await self._pub_client.ping()
            self._sub_client = redis_async.Redis.from_url(
                self._redis_url,
                decode_responses=True,
                socket_connect_timeout=1,
                socket_timeout=1,
            )
            self._pubsub = self._sub_client.pubsub()
            await self._pubsub.subscribe(self._CHANNEL)
            self._task = asyncio.create_task(self._listen(), name="conversation-event-bus")
            self._enabled = True
        except Exception:
            await self.stop()

    async def stop(self) -> None:
        task = self._task
        self._task = None
        if task:
            task.cancel()
            try:
                await task
            except Exception:
                pass

        if self._pubsub is not None:
            try:
                await self._pubsub.close()
            except Exception:
                pass
            self._pubsub = None

        if self._sub_client is not None:
            try:
                await self._sub_client.aclose()
            except Exception:
                pass
            self._sub_client = None

        if self._pub_client is not None:
            try:
                await self._pub_client.aclose()
            except Exception:
                pass
            self._pub_client = None

        self._enabled = False

    async def publish(self, conversation_id: str, payload: dict) -> None:
        await self._apply_event(conversation_id, payload)
        if not self._enabled or self._pub_client is None:
            return
        envelope = {
            "instance_id": self._instance_id,
            "conversation_id": conversation_id,
            "payload": payload,
        }
        try:
            await self._pub_client.publish(self._CHANNEL, json.dumps(envelope, ensure_ascii=False))
        except Exception:
            pass

    async def _listen(self) -> None:
        if self._pubsub is None:
            return
        while True:
            try:
                message = await self._pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            except asyncio.CancelledError:
                raise
            except Exception:
                await asyncio.sleep(0.2)
                continue

            if not message:
                await asyncio.sleep(0.05)
                continue

            raw = message.get("data")
            if not isinstance(raw, str):
                continue
            try:
                envelope = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if envelope.get("instance_id") == self._instance_id:
                continue

            conversation_id = str(envelope.get("conversation_id") or "")
            payload = envelope.get("payload")
            if not conversation_id or not isinstance(payload, dict):
                continue
            await self._apply_event(conversation_id, payload)

    async def _apply_event(self, conversation_id: str, payload: dict) -> None:
        if payload.get("type") == "disconnect_user":
            user_id = str(payload.get("user_id") or "")
            if user_id:
                await self._hub.disconnect_user(conversation_id, user_id)
            return
        await self._hub.broadcast(conversation_id, payload)


def _require_token(settings: Settings, auth_header: str | None) -> None:
    require_token(settings, auth_header)


def create_app(
    settings_override: Settings | None = None,
    queue_client_override: QueueClientProtocol | None = None,
    storage_override: ObjectStorage | None = None,
) -> FastAPI:
    settings = settings_override or get_settings()
    app = FastAPI(title=settings.app_name)

    queue_client = queue_client_override or build_queue_client(settings)
    storage = storage_override or build_storage(settings)
    conversation_hub = ConversationSocketHub()
    capability_registry = create_default_registry()

    def _check_capability(capability_id: str) -> None:
        """Check if a capability is available; raise HTTPException if not."""
        if not capability_registry.is_capability_available(capability_id):
            capability = capability_registry.get_capability(capability_id)
            missing_tools = [
                tool_id
                for tool_id in (capability.required_tools if capability else [])
                if not capability_registry.get_tool(tool_id) or not capability_registry.get_tool(tool_id).available
            ]
            raise HTTPException(
                status_code=503,
                detail={
                    "error_code": "CAPABILITY_UNAVAILABLE",
                    "message": f"Capability '{capability_id}' is not available",
                    "capability_id": capability_id,
                    "missing_tools": missing_tools,
                    "degraded": capability.enabled if capability else False,
                },
            )

    event_bus = ConversationEventBus(settings.redis_url, conversation_hub)

    @app.on_event("startup")
    async def startup_event() -> None:
        Path(settings.worker_temp_root).mkdir(parents=True, exist_ok=True)
        reconfigure_db(settings.database_url)
        init_db()

        if settings.startup_purge_enabled:
            startup_db = db_module.SessionLocal()
            try:
                purged = purge_prestart_nonterminal_jobs(
                    startup_db,
                    max_purge=max(0, settings.purge_prestart_jobs_batch),
                )
                startup_db.commit()
                if purged:
                    print(f"[gateway-app] purged {purged} pre-restart queued/running job(s) on startup")
            except Exception:
                startup_db.rollback()
                raise
            finally:
                startup_db.close()

            if settings.purge_prestart_queue_messages_on_startup:
                purge_method = getattr(queue_client, "purge_queues", None)
                if callable(purge_method):
                    queue_targets = [
                        settings.queue_course,
                        settings.queue_problem_video,
                        settings.queue_package,
                        settings.queue_learning_record,
                    ]
                    purged_messages = int(purge_method(queue_targets) or 0)
                    if purged_messages:
                        print(f"[gateway-app] purged {purged_messages} queued message(s) on startup")
        elif settings.purge_prestart_jobs_on_startup and not settings.startup_purge_armed:
            print(
                "[gateway-app] startup purge is requested but skipped because "
                "GATEWAY_STARTUP_PURGE_ARMED is not enabled"
            )
        await event_bus.start()

    @app.on_event("shutdown")
    async def shutdown_event() -> None:
        await event_bus.stop()

    app.include_router(create_core_router(settings, queue_client))
    app.include_router(create_uploads_router(settings, storage))
    app.include_router(create_jobs_router(settings, queue_client, _check_capability))

    app.include_router(create_messages_router(settings, event_bus, conversation_hub))

    app.include_router(create_ai_learning_router(settings))
    app.include_router(create_knowledge_router(settings))

    @app.get("/v1/capabilities")
    def get_capabilities(
        authorization: str | None = Header(default=None),
    ):
        _require_token(settings, authorization)
        status = capability_registry.get_capability_status()
        effective = capability_registry.get_effective_capabilities()
        return {
            "capabilities": status,
            "effective": [cap.to_dict() for cap in effective],
            "tools": {
                tool_id: tool.to_dict()
                for tool_id, tool in capability_registry.tools.items()
            },
        }

    @app.get("/v1/capabilities/{capability_id}")
    def get_capability(
        capability_id: str,
        authorization: str | None = Header(default=None),
    ):
        _require_token(settings, authorization)
        capability = capability_registry.get_capability(capability_id)
        if not capability:
            raise HTTPException(status_code=404, detail={"error_code": "CAPABILITY_NOT_FOUND", "message": f"Capability '{capability_id}' not found"})
        available = capability_registry.is_capability_available(capability_id)
        return {
            **capability.to_dict(),
            "available": available,
        }

    @app.post("/v1/tools/{tool_id}/health")
    def update_tool_health(
        tool_id: str,
        request: dict,
        authorization: str | None = Header(default=None),
    ):
        _require_token(settings, authorization)
        available = request.get("available", True)
        error_message = request.get("error_message")
        capability_registry.update_tool_availability(tool_id, available, error_message)

        affected = capability_registry.get_capabilities_using_tool(tool_id)
        return {
            "tool_id": tool_id,
            "available": available,
            "affected_capabilities": [cap.id for cap in affected],
        }

    @app.post("/v1/jobs/{job_id}/capability-guard")
    def check_job_capability_guard(
        job_id: str,
        db: Session = Depends(get_db),
        authorization: str | None = Header(default=None),
    ):
        _require_token(settings, authorization)
        job = db.get(Job, job_id)
        if not job:
            raise HTTPException(status_code=404, detail={"error_code": "JOB_NOT_FOUND", "message": "Job not found"})

        capability_map = {
            "course_generate": "course_generate",
            "problem_video_generate": "problem_video_generate",
            "study_package_generate": "course_generate",
            "learning_record_extract": "ai_tutor_chat",
        }
        capability_id = capability_map.get(job.job_type)
        if not capability_id:
            return {"job_id": job_id, "job_type": job.job_type, "guard_result": "unknown_job_type"}

        available = capability_registry.is_capability_available(capability_id)
        capability = capability_registry.get_capability(capability_id)
        missing_tools = [
            tool_id
            for tool_id in (capability.required_tools if capability else [])
            if not capability_registry.get_tool(tool_id) or not capability_registry.get_tool(tool_id).available
        ]

        if not available:
            return {
                "job_id": job_id,
                "job_type": job.job_type,
                "guard_result": "blocked",
                "capability_id": capability_id,
                "missing_tools": missing_tools,
                "degraded": capability.enabled if capability else False,
            }

        return {
            "job_id": job_id,
            "job_type": job.job_type,
            "guard_result": "passed",
            "capability_id": capability_id,
        }

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_request, exc: HTTPException):
        if isinstance(exc.detail, dict):
            return JSONResponse(status_code=exc.status_code, content=exc.detail)
        return JSONResponse(status_code=exc.status_code, content={"error_code": "HTTP_ERROR", "message": str(exc.detail)})

    @app.exception_handler(ValueError)
    async def value_error_handler(_request, exc: ValueError):
        return JSONResponse(status_code=400, content={"error_code": "INVALID_REQUEST", "message": str(exc)})

    return app


app = create_app()
