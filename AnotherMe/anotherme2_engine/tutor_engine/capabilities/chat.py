"""Agentic chat capability with optional fast (direct LLM) mode."""

from __future__ import annotations

import logging

from tutor_engine.agents.chat.agentic_pipeline import CHAT_OPTIONAL_TOOLS, AgenticChatPipeline
from tutor_engine.agents.chat.chat_agent import ChatAgent
from tutor_engine.capabilities.request_contracts import get_capability_request_schema
from tutor_engine.core.capability_protocol import BaseCapability, CapabilityManifest
from tutor_engine.core.context import UnifiedContext
from tutor_engine.core.stream import StreamEvent, StreamEventType
from tutor_engine.core.stream_bus import StreamBus

logger = logging.getLogger(__name__)


class ChatCapability(BaseCapability):
    manifest = CapabilityManifest(
        name="chat",
        description="Agentic chat with autonomous tool selection across enabled tools.",
        stages=["thinking", "acting", "observing", "responding"],
        tools_used=CHAT_OPTIONAL_TOOLS,
        cli_aliases=["chat"],
        request_schema=get_capability_request_schema("chat"),
    )

    async def run(self, context: UnifiedContext, stream: StreamBus) -> None:
        overrides = context.config_overrides or {}
        mode = overrides.get("mode", "auto")
        max_tokens = _coerce_max_tokens(overrides.get("max_tokens"))
        model_override = _coerce_model(overrides.get("model"))

        if mode == "fast":
            await self._run_fast(
                context,
                stream,
                max_tokens=max_tokens,
                model_override=model_override,
            )
        else:
            pipeline = AgenticChatPipeline(
                language=context.language,
                max_tokens_override=max_tokens,
                model_override=model_override,
            )
            await pipeline.run(context, stream)

    async def _run_fast(
        self,
        context: UnifiedContext,
        stream: StreamBus,
        *,
        max_tokens: int | None = None,
        model_override: str | None = None,
    ) -> None:
        """Direct LLM call — skip thinking/acting/observing, go straight to responding."""
        agent = ChatAgent(language=context.language)
        if model_override:
            agent.model = model_override

        history = context.conversation_history or []
        truncated = agent.truncate_history(history)
        messages = agent.build_messages(
            message=context.user_message,
            history=truncated,
        )
        is_long_math_problem = _looks_like_long_math_problem(context.user_message)
        if is_long_math_problem:
            messages = _with_fast_math_system_guardrail(messages)

        logger.info("Fast mode: direct LLM call, %d messages", len(messages))

        async for chunk in agent.generate_stream(
            messages,
            attachments=context.attachments,
            max_tokens=max_tokens,
            reasoning_effort="minimal" if is_long_math_problem else None,
        ):
            await stream.emit(
                StreamEvent(
                    type=StreamEventType.CONTENT,
                    content=chunk,
                    source=self.name,
                    stage="responding",
                )
            )


class VisualSolveFastCapability(ChatCapability):
    manifest = CapabilityManifest(
        name="visual_solve_fast",
        description="Fast visual question answering path for image-based tutoring.",
        stages=["vision", "responding"],
        tools_used=[],
        cli_aliases=["visual_solve_fast"],
        request_schema=get_capability_request_schema("visual_solve_fast"),
    )

    async def run(self, context: UnifiedContext, stream: StreamBus) -> None:
        overrides = context.config_overrides or {}
        max_tokens = _coerce_max_tokens(overrides.get("max_tokens"))
        model_override = _coerce_model(overrides.get("model"))
        await self._run_fast(
            context,
            stream,
            max_tokens=max_tokens,
            model_override=model_override,
        )


def _coerce_max_tokens(value: object) -> int | None:
    try:
        tokens = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return max(1, min(tokens, 32768))


def _coerce_model(value: object) -> str | None:
    model = str(value or "").strip()
    return model or None


def _looks_like_long_math_problem(message: str) -> bool:
    text = message.lower()
    markers = (
        "geometry",
        "triangle",
        "circle",
        "prove",
        "solve",
        "公式",
        "几何",
        "三角形",
        "圆",
        "证明",
        "推导",
        "解答",
    )
    return len(message) >= 180 and any(marker in text for marker in markers)


def _with_fast_math_system_guardrail(
    messages: list[dict[str, str]],
) -> list[dict[str, str]]:
    if not messages or messages[0].get("role") != "system":
        return messages
    guardrail = (
        "\n\n长数学题响应要求：不要长时间隐藏思考。先直接输出一个可见的解题框架，"
        "再给关键公式和结论；单次回复控制在约 1200 字以内。若题目很难，"
        "先给可验证的部分推导和下一步，而不是等待完整证明后再输出。"
    )
    updated = [dict(item) for item in messages]
    updated[0]["content"] = f"{updated[0].get('content', '')}{guardrail}"
    return updated
