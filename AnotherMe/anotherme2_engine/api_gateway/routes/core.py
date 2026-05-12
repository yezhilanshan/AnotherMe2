from __future__ import annotations

from fastapi import APIRouter

from ..config import Settings


def create_core_router(settings: Settings, queue_client) -> APIRouter:
    router = APIRouter()

    @router.get("/")
    def root() -> dict:
        """Avoid 404 noise when browsers or probes hit the gateway base URL."""
        return {
            "service": settings.app_name,
            "ok": True,
            "health": "/healthz",
            "api": "/v1/jobs",
        }

    @router.get("/healthz")
    def healthz() -> dict:
        redis_ok = False
        try:
            redis_ok = bool(queue_client.ping())
        except Exception:
            redis_ok = False
        return {
            "ok": True,
            "redis": redis_ok,
            "queue_backend": getattr(queue_client, "backend", "redis" if redis_ok else "polling"),
            "env": settings.app_env,
        }

    return router
