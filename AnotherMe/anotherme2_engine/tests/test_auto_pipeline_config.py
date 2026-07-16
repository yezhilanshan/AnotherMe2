from __future__ import annotations

from tutor_engine.agents.auto.auto_pipeline import _strip_runtime_keys
from tutor_engine.capabilities.request_contracts import validate_auto_request_config


def test_auto_pipeline_strips_gateway_runtime_overrides() -> None:
    cleaned = _strip_runtime_keys(
        {
            "mode": "fast",
            "max_tokens": 4096,
            "answer_now_context": {"partial": True},
            "max_iterations": 1,
        }
    )

    assert cleaned == {"max_iterations": 1}
    assert validate_auto_request_config(cleaned).max_iterations == 1
