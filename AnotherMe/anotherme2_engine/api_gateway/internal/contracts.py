"""
Type-import shim
================

Single place where every gateway route imports the data-contract enums
and the StreamEvent type.  Strategy:

  1. Prefer the **gateway-owned** mirror under ``api_gateway.internal.*``.
  2. Fall back to the legacy ``tutor_engine.*`` packages when needed
     (e.g. legacy callers that need additional fields we haven't mirrored
     yet).

This keeps the public schema owned by the gateway, while we incrementally
pull runtime services (``get_book_engine`` / ``ChatOrchestrator`` / …) into
``anotherme2_engine`` proper (P1.3 - P1.5 in
``api_gateway/internal/__init__.py``).
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("api_gateway.internal.contracts")

# ── Local mirrors (always present) ─────────────────────────────────────
from .enums import (  # noqa: E402
    BlockStatus,
    BlockType,
    BookStatus,
    ContentType,
    PageStatus,
    StreamEventType,
)
from .stream_event import StreamEvent  # noqa: E402

# ── Optional legacy bindings (runtime services) ────────────────────────
_LEGACY = {}

try:
    # P1.1 - already mirrored, kept here so DTOs that still construct
    # tutor_engine dataclasses don't break.
    from tutor_engine.book.models import (  # type: ignore
        BlockStatus as _LegacyBlockStatus,
        BlockType as _LegacyBlockType,
        BookStatus as _LegacyBookStatus,
        ContentType as _LegacyContentType,
        PageStatus as _LegacyPageStatus,
    )

    _LEGACY["book_models"] = {
        "BlockStatus": _LegacyBlockStatus,
        "BlockType": _LegacyBlockType,
        "BookStatus": _LegacyBookStatus,
        "ContentType": _LegacyContentType,
        "PageStatus": _LegacyPageStatus,
    }
except Exception as exc:  # pragma: no cover - non-fatal
    logger.debug("tutor_engine.book.models not available: %s", exc)

try:
    from tutor_engine.core.stream import StreamEvent as _LegacyStreamEvent  # type: ignore
    from tutor_engine.core.stream import StreamEventType as _LegacyStreamEventType  # type: ignore

    _LEGACY["stream"] = {
        "StreamEvent": _LegacyStreamEvent,
        "StreamEventType": _LegacyStreamEventType,
    }
except Exception as exc:  # pragma: no cover
    logger.debug("tutor_engine.core.stream not available: %s", exc)


def get_legacy(name: str) -> Any | None:
    """Return a legacy symbol by dotted path (e.g. ``stream.StreamEvent``).

    Routes still in the middle of migration use this to access the
    tutor_engine runtime while the gateway mirror matures.
    """
    return _LEGACY.get(name)


__all__ = [
    "BlockStatus",
    "BlockType",
    "BookStatus",
    "ContentType",
    "PageStatus",
    "StreamEvent",
    "StreamEventType",
    "get_legacy",
]
