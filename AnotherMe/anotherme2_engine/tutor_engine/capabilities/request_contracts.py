"""Public request contracts and config validators for built-in capabilities."""

from __future__ import annotations

from typing import Any, Callable, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from tutor_engine.agents.math_animator.request_config import (
    MathAnimatorRequestConfig,
    validate_math_animator_request_config,
)
from tutor_engine.agents.research.request_config import (
    DeepResearchRequestConfig,
    validate_research_request_config,
)

_RUNTIME_ONLY_KEYS = {
    "_persist_user_message",
    "followup_question_context",
    # "answer_now" is a universal escape hatch: the orchestrator re-routes
    # any capability to chat when this is present. It is never declared on
    # any per-capability ``RequestConfig`` schema, so we strip it before
    # pydantic validation and re-attach it on the runtime-only side.
    "answer_now_context",
    "model",
}


class ChatRequestConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VisualSolveFastRequestConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DeepSolveRequestConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detailed_answer: bool = True


class DeepQuestionRequestConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["custom", "mimic"] = "custom"
    topic: str = ""
    num_questions: int = Field(default=1, ge=1, le=50)
    difficulty: str = ""
    question_type: str = ""
    preference: str = ""
    paper_path: str = ""
    max_questions: int = Field(default=10, ge=1, le=100)


class VisualizeRequestConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    render_mode: Literal["auto", "svg", "chartjs", "mermaid", "html"] = "auto"


class AutoRequestConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled_capabilities: list[str] = Field(default_factory=list)
    max_iterations: int = Field(default=2, ge=1, le=10)  # 优化: 从4降到2
    max_retries_per_step: int = Field(default=3, ge=1, le=10)
    max_same_capability_calls: int = Field(default=2, ge=1, le=5)
    skip_analyzing: bool = Field(default=True, description="跳过 ANALYZING 阶段提速")
    skip_synthesizing: bool = Field(default=True, description="有结果时跳过 SYNTHESIZING 阶段")
    parallel_tool_calls: bool = Field(default=True, description="并行执行多个工具调用")
    router_model: str = Field(default="", description="路由器使用更快的模型，留空用主模型")


def _clean_public_config(raw_config: dict[str, Any] | None) -> dict[str, Any]:
    if raw_config is None:
        return {}
    if not isinstance(raw_config, dict):
        raise ValueError("Capability config must be an object.")
    cleaned = dict(raw_config)
    for key in _RUNTIME_ONLY_KEYS:
        cleaned.pop(key, None)
    return cleaned


def _validate_model(
    model_type: type[BaseModel],
    raw_config: dict[str, Any] | None,
    *,
    label: str,
) -> BaseModel:
    cleaned = _clean_public_config(raw_config)
    try:
        return model_type.model_validate(cleaned)
    except ValidationError as exc:
        details = "; ".join(
            f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
            for error in exc.errors()
        )
        raise ValueError(f"Invalid {label} config: {details}") from exc


def validate_chat_request_config(raw_config: dict[str, Any] | None) -> ChatRequestConfig:
    return _validate_model(ChatRequestConfig, raw_config, label="chat")


def validate_visual_solve_fast_request_config(
    raw_config: dict[str, Any] | None,
) -> VisualSolveFastRequestConfig:
    return _validate_model(
        VisualSolveFastRequestConfig,
        raw_config,
        label="visual solve fast",
    )


def validate_deep_solve_request_config(
    raw_config: dict[str, Any] | None,
) -> DeepSolveRequestConfig:
    return _validate_model(DeepSolveRequestConfig, raw_config, label="deep solve")


def validate_deep_question_request_config(
    raw_config: dict[str, Any] | None,
) -> DeepQuestionRequestConfig:
    return _validate_model(DeepQuestionRequestConfig, raw_config, label="deep question")


def validate_visualize_request_config(
    raw_config: dict[str, Any] | None,
) -> VisualizeRequestConfig:
    return _validate_model(VisualizeRequestConfig, raw_config, label="visualize")


def validate_auto_request_config(
    raw_config: dict[str, Any] | None,
) -> AutoRequestConfig:
    return _validate_model(AutoRequestConfig, raw_config, label="auto")


def build_request_schema(model_type: type[BaseModel]) -> dict[str, Any]:
    return model_type.model_json_schema(mode="validation")


CAPABILITY_CONFIG_VALIDATORS: dict[str, Callable[[dict[str, Any] | None], Any]] = {
    "chat": validate_chat_request_config,
    "visual_solve_fast": validate_visual_solve_fast_request_config,
    "deep_solve": validate_deep_solve_request_config,
    "deep_question": validate_deep_question_request_config,
    "deep_research": validate_research_request_config,
    "math_animator": validate_math_animator_request_config,
    "visualize": validate_visualize_request_config,
    "auto": validate_auto_request_config,
}

CAPABILITY_REQUEST_SCHEMAS: dict[str, dict[str, Any]] = {
    "chat": build_request_schema(ChatRequestConfig),
    "visual_solve_fast": build_request_schema(VisualSolveFastRequestConfig),
    "deep_solve": build_request_schema(DeepSolveRequestConfig),
    "deep_question": build_request_schema(DeepQuestionRequestConfig),
    "deep_research": build_request_schema(DeepResearchRequestConfig),
    "math_animator": build_request_schema(MathAnimatorRequestConfig),
    "visualize": build_request_schema(VisualizeRequestConfig),
    "auto": build_request_schema(AutoRequestConfig),
}


def validate_capability_config(
    capability: str, raw_config: dict[str, Any] | None
) -> dict[str, Any]:
    validator = CAPABILITY_CONFIG_VALIDATORS.get(capability)
    if validator is None:
        return _clean_public_config(raw_config)
    model = validator(raw_config)
    if isinstance(model, BaseModel):
        return model.model_dump(exclude_none=True)
    return _clean_public_config(raw_config)


def get_capability_request_schema(capability: str) -> dict[str, Any]:
    return dict(CAPABILITY_REQUEST_SCHEMAS.get(capability, {}))


__all__ = [
    "AutoRequestConfig",
    "CAPABILITY_CONFIG_VALIDATORS",
    "CAPABILITY_REQUEST_SCHEMAS",
    "ChatRequestConfig",
    "DeepQuestionRequestConfig",
    "DeepSolveRequestConfig",
    "VisualSolveFastRequestConfig",
    "VisualizeRequestConfig",
    "build_request_schema",
    "get_capability_request_schema",
    "validate_auto_request_config",
    "validate_capability_config",
    "validate_chat_request_config",
    "validate_deep_question_request_config",
    "validate_deep_solve_request_config",
    "validate_visual_solve_fast_request_config",
    "validate_visualize_request_config",
]
