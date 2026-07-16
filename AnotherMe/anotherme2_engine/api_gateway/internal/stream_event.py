"""
Gateway-side StreamEvent
========================

Lightweight, gateway-owned mirror of the runtime stream event.  Routes
(``ai_chat.py``, ``live_book.py``) translate these into the flat dicts that
``engine_bridge._event_to_dict`` already emits to SSE clients.

The full ``tutor_engine.core.stream.StreamEvent`` still wins for advanced
fields (``turn_id`` / ``seq`` / ``session_id``), but the gateway only relies
on the subset below.  When P1.5 lands, the legacy import in
``engine_bridge.py`` will be dropped in favour of this class.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import time
from typing import Any

from .enums import StreamEventType


@dataclass
class StreamEvent:
    """A single streaming event emitted during a chat turn / book build."""

    type: StreamEventType
    source: str = ""
    stage: str = ""
    content: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    session_id: str = ""
    turn_id: str = ""
    seq: int = 0
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type.value,
            "source": self.source,
            "stage": self.stage,
            "content": self.content,
            "metadata": self.metadata,
            "session_id": self.session_id,
            "turn_id": self.turn_id,
            "seq": self.seq,
            "timestamp": self.timestamp,
        }
