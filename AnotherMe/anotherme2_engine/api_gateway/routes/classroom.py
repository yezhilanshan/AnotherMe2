"""Classroom CRUD endpoints for mobile client.

Stores classroom data as JSON in the jobs table's result_payload,
or as standalone JSON records in a simple key-value approach.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from ..config import Settings
from .auth import require_token


# ── Data Storage (file-based, same pattern as Next.js classroom-storage) ─────

def _data_dir() -> Path:
    d = Path(os.getenv("CLASSROOM_DATA_DIR", "./gateway_data/classrooms"))
    d.mkdir(parents=True, exist_ok=True)
    return d


def _save_classroom(classroom_id: str, data: dict) -> None:
    path = _data_dir() / f"{classroom_id}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_classroom(classroom_id: str) -> Optional[dict]:
    path = _data_dir() / f"{classroom_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _delete_classroom(classroom_id: str) -> bool:
    path = _data_dir() / f"{classroom_id}.json"
    if path.exists():
        path.unlink()
        return True
    return False


def _list_classrooms(limit: int = 50) -> list[dict]:
    data_dir = _data_dir()
    classrooms = []
    for f in sorted(data_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        if len(classrooms) >= limit:
            break
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            classrooms.append({
                "id": data.get("id", f.stem),
                "title": data.get("stage", {}).get("title", "Untitled"),
                "created_at": data.get("created_at", ""),
                "scenes_count": len(data.get("scenes", [])),
            })
        except (json.JSONDecodeError, OSError):
            continue
    return classrooms


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
        classrooms = _list_classrooms(limit)
        return {"success": True, "classrooms": classrooms}

    @router.get("/v1/classrooms/{classroom_id}")
    def get_classroom(
        classroom_id: str,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_token(settings, authorization)
        data = _load_classroom(classroom_id)
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
        data = {
            "id": classroom_id,
            "stage": {**body.stage, "id": classroom_id},
            "scenes": body.scenes,
            "created_at": datetime.utcnow().isoformat(),
        }
        _save_classroom(classroom_id, data)
        return {"success": True, "id": classroom_id}

    @router.delete("/v1/classrooms/{classroom_id}")
    def delete_classroom(
        classroom_id: str,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_token(settings, authorization)
        deleted = _delete_classroom(classroom_id)
        if not deleted:
            raise HTTPException(404, detail={"error_code": "NOT_FOUND", "message": "Classroom not found"})
        return {"success": True, "deleted": True}

    return router
