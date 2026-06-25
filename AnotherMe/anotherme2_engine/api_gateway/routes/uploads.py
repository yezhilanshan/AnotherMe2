from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..config import Settings
from ..schemas import UploadResponse
from ..storage import ObjectStorage, guess_content_type
from .auth import require_token


def create_uploads_router(settings: Settings, storage: ObjectStorage) -> APIRouter:
    router = APIRouter(tags=["uploads"])

    @router.post("/v1/uploads", response_model=UploadResponse)
    async def upload_problem_image(
        file: UploadFile = File(...),
        authorization: str | None = Header(default=None),
    ):
        require_token(settings, authorization)

        if not file.filename:
            raise HTTPException(status_code=400, detail={"error_code": "INVALID_FILE", "message": "Missing filename"})

        object_key = f"uploads/{uuid4().hex}_{file.filename}"
        content_type = file.content_type or guess_content_type(file.filename)
        url = storage.upload_stream(file.file, object_key, content_type=content_type)

        # Try to infer size by reading uploaded stream length from file descriptor.
        size = 0
        try:
            current = file.file.tell()
            file.file.seek(0, 2)
            size = file.file.tell()
            file.file.seek(current)
        except Exception:
            size = 0

        return UploadResponse(object_key=object_key, url=url, size=size, content_type=content_type)

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
