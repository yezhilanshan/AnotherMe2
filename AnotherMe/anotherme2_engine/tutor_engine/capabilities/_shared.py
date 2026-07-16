"""Shared plumbing for capability ``run()`` endpoints.

Capabilities all converge on the same final emission:

    await stream.result({"response": ..., ...}, source="<cap>")

This module centralizes the merge + emit so every capability
emits the same envelope shape.
"""

from __future__ import annotations

from typing import Any

from tutor_engine.core.agentic.usage import UsageTracker
from tutor_engine.core.stream_bus import StreamBus


async def emit_capability_result(
    stream: StreamBus,
    payload: dict[str, Any],
    *,
    source: str,
    usage: UsageTracker | None = None,
) -> None:
    """Emit the final capability result, attaching cost_summary if available."""
    if usage is not None:
        cs = usage.summary()
        if cs:
            meta = payload.get("metadata")
            if not isinstance(meta, dict):
                meta = {}
                payload["metadata"] = meta
            meta["cost_summary"] = cs
    await stream.result(payload, source=source)


__all__ = ["emit_capability_result"]
