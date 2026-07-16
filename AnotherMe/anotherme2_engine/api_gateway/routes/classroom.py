"""Classroom CRUD endpoints for mobile client.

Stores classroom data as JSON in the jobs table's result_payload,
or as standalone JSON records in a simple key-value approach.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from ..config import Settings
from ..classroom_store import create_classroom as store_classroom
from ..classroom_store import delete_classroom as store_delete_classroom
from ..classroom_store import list_classrooms as store_list_classrooms
from ..classroom_store import load_classroom as store_load_classroom
from .auth import require_token


# ── Request/Response Models ──────────────────────────────────────────────────


class CreateClassroomRequest(BaseModel):
    stage: dict[str, Any]
    scenes: list[dict[str, Any]] = Field(default_factory=list)


class ClassroomSummary(BaseModel):
    id: str
    title: str
    created_at: str
    scenes_count: int


# ── Router Factory ───────────────────────────────────────────────────────────


def create_classroom_router(settings: Settings) -> APIRouter:
    router = APIRouter(tags=["classroom"])

    @router.get("/v1/classrooms")
    def list_classrooms(
        limit: int = 50,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_token(settings, authorization)
        classrooms = store_list_classrooms(limit)
        return {"success": True, "classrooms": classrooms}

    @router.get("/v1/classrooms/{classroom_id}")
    def get_classroom(
        classroom_id: str,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_token(settings, authorization)
        data = store_load_classroom(classroom_id)
        if not data:
            raise HTTPException(404, detail={"error_code": "NOT_FOUND", "message": "Classroom not found"})
        return {"success": True, "classroom": data}

    @router.post("/v1/classrooms")
    def create_classroom(
        body: CreateClassroomRequest,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_token(settings, authorization)
        classroom_id = body.stage.get("id") or str(uuid4())
        store_classroom(body.stage, body.scenes, classroom_id)
        return {"success": True, "id": classroom_id}

    @router.delete("/v1/classrooms/{classroom_id}")
    def delete_classroom(
        classroom_id: str,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_token(settings, authorization)
        deleted = store_delete_classroom(classroom_id)
        if not deleted:
            raise HTTPException(404, detail={"error_code": "NOT_FOUND", "message": "Classroom not found"})
        return {"success": True, "deleted": True}

    return router
