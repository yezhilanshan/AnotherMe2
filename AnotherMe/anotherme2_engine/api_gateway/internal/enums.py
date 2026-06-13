"""
Internal enums
==============

Mirror of the enum contracts the gateway exposes to clients.  Each enum is
the **source of truth** for the gateway; the legacy `tutor_engine` package
re-exports these for backwards compatibility (see migration comments in
``internal/__init__.py``).

Why `str, Enum`?
----------------
- `str` makes instances JSON-serializable as their `.value`.
- `Enum` gives runtime exhaustiveness checking and IDE autocomplete.
"""

from __future__ import annotations

from enum import Enum


class BookStatus(str, Enum):
    """Top-level book lifecycle status."""

    DRAFT = "draft"
    SPINE_READY = "spine_ready"
    COMPILING = "compiling"
    READY = "ready"
    ERROR = "error"
    ARCHIVED = "archived"


class PageStatus(str, Enum):
    PENDING = "pending"
    PLANNING = "planning"
    GENERATING = "generating"
    READY = "ready"
    PARTIAL = "partial"
    ERROR = "error"


class BlockStatus(str, Enum):
    PENDING = "pending"
    GENERATING = "generating"
    READY = "ready"
    ERROR = "error"
    HIDDEN = "hidden"


class BlockType(str, Enum):
    """Visual taxonomy of a block within a page."""

    # Phase 1
    TEXT = "text"
    CALLOUT = "callout"
    QUIZ = "quiz"
    USER_NOTE = "user_note"
    # Phase 2
    FIGURE = "figure"
    INTERACTIVE = "interactive"
    ANIMATION = "animation"
    CODE = "code"
    TIMELINE = "timeline"
    FLASH_CARDS = "flash_cards"
    # Phase 3
    DEEP_DIVE = "deep_dive"
    # Phase 4 (BookEngine v2)
    SECTION = "section"
    CONCEPT_GRAPH = "concept_graph"


class ContentType(str, Enum):
    """Drives page planner template selection."""

    THEORY = "theory"
    DERIVATION = "derivation"
    HISTORY = "history"
    PRACTICE = "practice"
    CONCEPT = "concept"
    OVERVIEW = "overview"


class StreamEventType(str, Enum):
    """Unified streaming event protocol."""

    STAGE_START = "stage_start"
    STAGE_END = "stage_end"
    THINKING = "thinking"
    OBSERVATION = "observation"
    CONTENT = "content"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    PROGRESS = "progress"
    SOURCES = "sources"
    RESULT = "result"
    ERROR = "error"
    SESSION = "session"
    DONE = "done"


# Backwards-compat aliases used in a couple of legacy DTOs.
# These should be removed once all callers import from this module.
PageStatus_legacy = PageStatus
BlockType_legacy = BlockType
ContentType_legacy = ContentType
