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
        mode = (context.config_overrides or {}).get("mode", "auto")

        if mode == "fast":
            await self._run_fast(context, stream)
        else:
            pipeline = AgenticChatPipeline(language=context.language)
            await pipeline.run(context, stream)

    async def _run_fast(self, context: UnifiedContext, stream: StreamBus) -> None:
        """Direct LLM call — skip thinking/acting/observing, go straight to responding."""
        agent = ChatAgent(language=context.language)

        history = context.conversation_history or []
        truncated = agent.truncate_history(history)
        messages = agent.build_messages(
            message=context.user_message,
            history=truncated,
        )

        logger.info("Fast mode: direct LLM call, %d messages", len(messages))

        async for chunk in agent.generate_stream(
            messages,
            attachments=context.attachments,
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
        await self._run_fast(context, stream)
