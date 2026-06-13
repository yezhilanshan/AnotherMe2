"""
Unified error envelope
======================

Single shape for all errors returned by the gateway, so clients
(Web / Mobile) only need one error parser.

  {
    "error_code": "STRING_CODE",        // machine-readable
    "message": "Human readable text",   // English
    "request_id": "uuid",               // correlates logs
    "details": {...}                    // optional, structured
  }
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("api_gateway.errors")


class APIError(Exception):
    """Application-level error that the client should surface to the user.

    Routes raise this when a domain validation fails (e.g. wrong file type,
    missing field, or the orchestrator returned a recoverable error).
    Unhandled exceptions go through the catch-all handler below.
    """

    def __init__(
        self,
        message: str,
        *,
        error_code: str = "INTERNAL_ERROR",
        status_code: int = 500,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.error_code = error_code
        self.status_code = status_code
        self.details = details or {}

    def to_response(self, request_id: str) -> JSONResponse:
        body: dict[str, Any] = {
            "error_code": self.error_code,
            "message": self.message,
            "request_id": request_id,
        }
        if self.details:
            body["details"] = self.details
        return JSONResponse(status_code=self.status_code, content=body)


def _request_id(request: Request) -> str:
    """Pull `X-Request-Id` from headers or mint a new one."""
    return request.headers.get("x-request-id") or uuid.uuid4().hex


async def _api_error_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, APIError)
    rid = _request_id(request)
    logger.warning(
        "API error %s: %s (request_id=%s, details=%s)",
        exc.error_code,
        exc.message,
        rid,
        exc.details,
    )
    return exc.to_response(rid)


async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    rid = _request_id(request)
    logger.exception("Unhandled exception (request_id=%s)", rid)
    body = {
        "error_code": "INTERNAL_ERROR",
        "message": "Internal server error",
        "request_id": rid,
    }
    return JSONResponse(status_code=500, content=body)


def register_error_handlers(app: FastAPI) -> None:
    """Wire :class:`APIError` and unhandled exceptions into FastAPI."""
    app.add_exception_handler(APIError, _api_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, _unhandled_exception_handler)
