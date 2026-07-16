"""
P1 验收 — `api_gateway.internal` 单元测试
==========================================

保证 gateway-owned 的 enums 与 StreamEvent 与 `tutor_engine` 的对应定义
保持一致（值级别）。运行方式：

    cd anotherme2_engine
    PYTHONPATH=. python api_gateway/internal/tests.py
"""

from __future__ import annotations

import os
import sys
import unittest

# Make `api_gateway` importable as a normal package without triggering
# the eager import of `app.py` (which needs `fastapi`).
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))             # .../api_gateway/internal
_API_GW = os.path.dirname(_THIS_DIR)                                # .../api_gateway
_REPO = os.path.dirname(_API_GW)                                    # .../anotherme2_engine
for p in (_REPO, _API_GW):
    if p not in sys.path:
        sys.path.insert(0, p)

# Disable fastapi/pydantic-free import of api_gateway: the package
# `__init__.py` is now lazy, so this import is cheap.
from api_gateway.internal.enums import (  # noqa: E402
    BlockStatus,
    BlockType,
    BookStatus,
    ContentType,
    PageStatus,
    StreamEventType,
)
from api_gateway.internal.stream_event import StreamEvent  # noqa: E402


class TestInternalEnums(unittest.TestCase):
    def test_block_type_values(self) -> None:
        expected = {
            "text", "callout", "quiz", "user_note",
            "figure", "interactive", "animation", "code", "timeline", "flash_cards",
            "deep_dive", "section", "concept_graph",
        }
        actual = {bt.value for bt in BlockType}
        self.assertTrue(expected.issubset(actual), f"missing: {expected - actual}")

    def test_content_type_values(self) -> None:
        expected = {"theory", "derivation", "history", "practice", "concept", "overview"}
        actual = {ct.value for ct in ContentType}
        self.assertTrue(expected.issubset(actual), f"missing: {expected - actual}")

    def test_page_status_values(self) -> None:
        expected = {"pending", "planning", "generating", "ready", "partial", "error"}
        actual = {ps.value for ps in PageStatus}
        self.assertTrue(expected.issubset(actual), f"missing: {expected - actual}")

    def test_block_status_values(self) -> None:
        expected = {"pending", "generating", "ready", "error", "hidden"}
        actual = {bs.value for bs in BlockStatus}
        self.assertTrue(expected.issubset(actual), f"missing: {expected - actual}")

    def test_book_status_values(self) -> None:
        expected = {"draft", "spine_ready", "compiling", "ready", "error", "archived"}
        actual = {bs.value for bs in BookStatus}
        self.assertTrue(expected.issubset(actual), f"missing: {expected - actual}")

    def test_stream_event_type_values(self) -> None:
        expected = {
            "stage_start", "stage_end", "thinking", "observation", "content",
            "tool_call", "tool_result", "progress", "sources", "result",
            "error", "session", "done",
        }
        actual = {et.value for et in StreamEventType}
        self.assertTrue(expected.issubset(actual), f"missing: {expected - actual}")

    def test_stream_event_to_dict(self) -> None:
        ev = StreamEvent(
            type=StreamEventType.CONTENT,
            content="hello world",
            source="ai_tutor_chat",
            stage="answering",
        )
        d = ev.to_dict()
        self.assertEqual(d["type"], "content")
        self.assertEqual(d["content"], "hello world")
        self.assertEqual(d["source"], "ai_tutor_chat")
        self.assertEqual(d["stage"], "answering")
        self.assertIsInstance(d["metadata"], dict)
        self.assertIsInstance(d["timestamp"], float)

    def test_block_type_string_values(self) -> None:
        for bt in BlockType:
            self.assertIsInstance(bt.value, str)
            self.assertGreater(len(bt.value), 0)

    def test_stream_event_default_metadata(self) -> None:
        ev = StreamEvent(type=StreamEventType.DONE)
        self.assertEqual(ev.metadata, {})
        self.assertEqual(ev.content, "")
        self.assertEqual(ev.source, "")
        self.assertGreater(ev.timestamp, 0)


def run() -> int:
    """Console entry-point.  Returns 0 on success, 1 on failure."""
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromModule(sys.modules[__name__])
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(run())
