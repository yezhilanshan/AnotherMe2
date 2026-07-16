from __future__ import annotations

import hashlib
import logging
import time
from uuid import uuid4

from fastapi import APIRouter, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from ..config import Settings
from ..schemas import UploadResponse
from ..storage import ObjectStorage, guess_content_type
from .auth import require_token

logger = logging.getLogger(__name__)


def create_uploads_router(settings: Settings, storage: ObjectStorage) -> APIRouter:
    router = APIRouter(tags=["uploads"])

    @router.post("/v1/uploads", response_model=UploadResponse)
    async def upload_problem_image(
        request: Request,
        file: UploadFile = File(...),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)
        started_at = time.time()
        request_id = getattr(request.state, "request_id", None) or uuid4().hex
        request.state.request_id = request_id

        if not file.filename:
            raise HTTPException(status_code=400, detail={"error_code": "INVALID_FILE", "message": "Missing filename"})

        object_key = f"uploads/{uuid4().hex}_{file.filename}"
        content_type = file.content_type or guess_content_type(file.filename)
        hasher = hashlib.sha256()
        size = 0
        try:
            file.file.seek(0)
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                hasher.update(chunk)
            file.file.seek(0)
        except Exception:
            size = 0
            hasher = hashlib.sha256()

        url = storage.upload_stream(file.file, object_key, content_type=content_type)
        elapsed_ms = int((time.time() - started_at) * 1000)
        logger.info(
            "[trace] request_id=%s phase=upload object_key=%s bytes=%d content_type=%s ms=%d",
            request_id,
            object_key,
            size,
            content_type,
            elapsed_ms,
        )

        return UploadResponse(
            object_key=object_key,
            url=url,
            size=size,
            content_type=content_type,
            sha256=hasher.hexdigest() if size else None,
        )

    @router.get("/v1/objects/{object_key:path}")
    async def get_local_object(
        object_key: str,
    ):
        resolve_path = getattr(storage, "_path", None)
        if not callable(resolve_path):
            raise HTTPException(status_code=404, detail={"error_code": "OBJECT_NOT_LOCAL", "message": "Object is not served locally"})

        try:
            path = resolve_path(object_key)
        except Exception:
            raise HTTPException(status_code=400, detail={"error_code": "INVALID_OBJECT_KEY", "message": "Invalid object key"})

        if not path.exists() or not path.is_file():
            raise HTTPException(status_code=404, detail={"error_code": "OBJECT_NOT_FOUND", "message": "Object not found"})

        return FileResponse(
            str(path),
            media_type=guess_content_type(path.name),
        )

    return router
