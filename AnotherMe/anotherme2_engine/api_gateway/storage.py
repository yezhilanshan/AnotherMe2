"""Object storage abstraction (S3/MinIO or explicit local storage)."""

from __future__ import annotations

import mimetypes
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Protocol

from .config import Settings, get_settings


class ObjectStorage(Protocol):
    def upload_file(self, local_path: str, object_key: str, content_type: str | None = None) -> str:
        ...

    def upload_bytes(self, payload: bytes, object_key: str, content_type: str = "application/octet-stream") -> str:
        ...

    def upload_stream(self, stream: BinaryIO, object_key: str, content_type: str = "application/octet-stream") -> str:
        ...

    def download_file(self, object_key: str, local_path: str) -> None:
        ...

    def exists(self, object_key: str) -> bool:
        ...


@dataclass
class LocalObjectStorage:
    root: Path
    public_base_url: str = ""

    def __post_init__(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, object_key: str) -> Path:
        key = object_key.lstrip("/")
        path = (self.root / key).resolve()
        root = self.root.resolve()
        if root not in path.parents and path != root:
            raise ValueError(f"invalid object key: {object_key}")
        return path

    def _url(self, object_key: str) -> str:
        if self.public_base_url:
            return f"{self.public_base_url.rstrip('/')}/{object_key.lstrip('/')}"
        return str(self._path(object_key))

    def upload_file(self, local_path: str, object_key: str, content_type: str | None = None) -> str:
        target = self._path(object_key)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(local_path, target)
        return self._url(object_key)

    def upload_bytes(self, payload: bytes, object_key: str, content_type: str = "application/octet-stream") -> str:
        target = self._path(object_key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
        return self._url(object_key)

    def upload_stream(self, stream: BinaryIO, object_key: str, content_type: str = "application/octet-stream") -> str:
        target = self._path(object_key)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("wb") as f:
            shutil.copyfileobj(stream, f)
        return self._url(object_key)

    def download_file(self, object_key: str, local_path: str) -> None:
        source = self._path(object_key)
        if not source.exists():
            raise FileNotFoundError(f"object not found: {object_key}")
        target = Path(local_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)

    def exists(self, object_key: str) -> bool:
        return self._path(object_key).exists()


@dataclass
class S3ObjectStorage:
    settings: Settings

    def __post_init__(self) -> None:
        import boto3
        from botocore.client import Config

        self.client = boto3.client(
            "s3",
            endpoint_url=self.settings.object_storage_endpoint or None,
            aws_access_key_id=self.settings.object_storage_access_key,
            aws_secret_access_key=self.settings.object_storage_secret_key,
            region_name=self.settings.object_storage_region,
            config=Config(signature_version="s3v4"),
        )
        self.bucket = self.settings.object_storage_bucket
        self._ensure_bucket()

    def _ensure_bucket(self) -> None:
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except Exception:
            params = {"Bucket": self.bucket}
            if self.settings.object_storage_region and self.settings.object_storage_region != "us-east-1":
                params["CreateBucketConfiguration"] = {
                    "LocationConstraint": self.settings.object_storage_region
                }
            self.client.create_bucket(**params)

    def _url(self, object_key: str) -> str:
        if self.settings.object_storage_public_base_url:
            return f"{self.settings.object_storage_public_base_url.rstrip('/')}/{object_key.lstrip('/')}"
        endpoint = self.settings.object_storage_endpoint.rstrip("/")
        return f"{endpoint}/{self.bucket}/{object_key.lstrip('/')}"

    def upload_file(self, local_path: str, object_key: str, content_type: str | None = None) -> str:
        extra = {"ContentType": content_type} if content_type else {}
        self.client.upload_file(local_path, self.bucket, object_key, ExtraArgs=extra or None)
        return self._url(object_key)

    def upload_bytes(self, payload: bytes, object_key: str, content_type: str = "application/octet-stream") -> str:
        self.client.put_object(Bucket=self.bucket, Key=object_key, Body=payload, ContentType=content_type)
        return self._url(object_key)

    def upload_stream(self, stream: BinaryIO, object_key: str, content_type: str = "application/octet-stream") -> str:
        self.client.upload_fileobj(stream, self.bucket, object_key, ExtraArgs={"ContentType": content_type})
        return self._url(object_key)

    def download_file(self, object_key: str, local_path: str) -> None:
        target = Path(local_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        self.client.download_file(self.bucket, object_key, str(target))

    def exists(self, object_key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=object_key)
            return True
        except Exception as exc:
            response = getattr(exc, "response", None) or {}
            error = response.get("Error", {}) if isinstance(response, dict) else {}
            code = str(error.get("Code") or "").strip().lower()
            status_code = None
            if isinstance(response, dict):
                status_code = response.get("ResponseMetadata", {}).get("HTTPStatusCode")

            if code in {"404", "nosuchkey", "notfound", "no such key"} or status_code == 404:
                return False
            raise


def guess_content_type(filename: str) -> str:
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or "application/octet-stream"


def build_storage(settings: Settings | None = None) -> ObjectStorage:
    cfg = settings or get_settings()

    def _local_storage() -> LocalObjectStorage:
        public_base_url = cfg.object_storage_public_base_url.strip()
        return LocalObjectStorage(Path(cfg.local_storage_root), public_base_url)

    driver = cfg.object_storage_driver.strip().lower()
    if driver in {"s3", "minio"}:
        return S3ObjectStorage(cfg)
    if driver == "local":
        return _local_storage()
    raise ValueError(
        f"unsupported OBJECT_STORAGE_DRIVER={cfg.object_storage_driver!r}; "
        "expected 'local', 's3', or 'minio'"
    )
