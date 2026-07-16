"""File-backed classroom store shared by Gateway routes and course jobs."""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Optional


def _data_dir() -> Path:
    data_dir = Path(os.getenv("CLASSROOM_DATA_DIR", "./gateway_data/classrooms"))
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def _classroom_path(classroom_id: str) -> Path:
    return _data_dir() / f"{classroom_id}.json"


def _stage_title(data: dict[str, Any], classroom_id: str) -> str:
    stage = data.get("stage") if isinstance(data.get("stage"), dict) else {}
    title = stage.get("title") or stage.get("name") or data.get("title")
    return str(title or classroom_id)


def _created_at(data: dict[str, Any]) -> str:
    created = data.get("created_at") or data.get("createdAt")
    return str(created or "")


def save_classroom_payload(classroom_id: str, data: dict[str, Any]) -> None:
    payload = dict(data)
    payload["id"] = payload.get("id") or classroom_id

    stage = payload.get("stage")
    if isinstance(stage, dict):
        payload["stage"] = {**stage, "id": stage.get("id") or classroom_id}

    if not payload.get("created_at") and not payload.get("createdAt"):
        payload["created_at"] = datetime.utcnow().isoformat()

    _classroom_path(classroom_id).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def create_classroom(stage: dict[str, Any], scenes: list[dict[str, Any]], classroom_id: str) -> None:
    save_classroom_payload(
        classroom_id,
        {
            "id": classroom_id,
            "stage": {**stage, "id": classroom_id},
            "scenes": scenes,
            "created_at": datetime.utcnow().isoformat(),
        },
    )


def load_classroom(classroom_id: str) -> Optional[dict[str, Any]]:
    path = _classroom_path(classroom_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def delete_classroom(classroom_id: str) -> bool:
    path = _classroom_path(classroom_id)
    if path.exists():
        path.unlink()
        return True
    return False


def list_classrooms(limit: int = 50) -> list[dict[str, Any]]:
    classrooms: list[dict[str, Any]] = []
    safe_limit = max(1, min(int(limit or 50), 100))

    for file_path in sorted(_data_dir().glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        if len(classrooms) >= safe_limit:
            break
        try:
            data = json.loads(file_path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                continue
            scenes = data.get("scenes") if isinstance(data.get("scenes"), list) else []
            classroom_id = str(data.get("id") or file_path.stem)
            classrooms.append(
                {
                    "id": classroom_id,
                    "title": _stage_title(data, classroom_id),
                    "created_at": _created_at(data),
                    "scenes_count": len(scenes),
                }
            )
        except (json.JSONDecodeError, OSError):
            continue

    return classrooms
