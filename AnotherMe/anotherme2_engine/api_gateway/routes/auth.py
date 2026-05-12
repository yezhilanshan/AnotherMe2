from __future__ import annotations

from fastapi import HTTPException

from ..config import Settings


def require_token(settings: Settings, auth_header: str | None) -> None:
    if not settings.api_token:
        return
    expected = f"Bearer {settings.api_token}"
    if auth_header != expected:
        raise HTTPException(status_code=401, detail={"error_code": "UNAUTHORIZED", "message": "Invalid token"})
