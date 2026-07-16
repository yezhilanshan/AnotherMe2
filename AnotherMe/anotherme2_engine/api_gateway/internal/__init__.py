"""
AnotherMe Gateway — internal contracts
======================================

This package contains the *data contracts* (enums, dataclasses, DTOs) that
the gateway's HTTP surface depends on.  They are mirrored here so that the
gateway **owns** its public schema, and can be re-exported by the runtime
`book` / `co_writer` engines instead of the other way round.

Migration plan (P1 — "网关迁出"):

* P1.1 ✅ Mirror Enum contracts (BlockType / ContentType / PageStatus / …)
* P1.2 ✅ Mirror StreamEvent contract (gateway-side)
* P1.3 ⏳ Mirror BookEngine state models (Book, Page, Block, …)
* P1.4 ⏳ Mirror CoWriter state models
* P1.5 ⏳ Replace `tutor_engine` runtime calls with in-package engines

Until P1.3-1.5 are done, the gateway will still `import` runtime services
(`get_book_engine`, `ChatOrchestrator`, …) from `tutor_engine`.  That import
boundary is the *only* place left where the legacy package is referenced.
"""

from __future__ import annotations

from .enums import (
    BlockStatus,
    BlockType,
    BookStatus,
    ContentType,
    PageStatus,
    StreamEventType,
)
from .stream_event import StreamEvent

__all__ = [
    "BlockStatus",
    "BlockType",
    "BookStatus",
    "ContentType",
    "PageStatus",
    "StreamEvent",
    "StreamEventType",
]
