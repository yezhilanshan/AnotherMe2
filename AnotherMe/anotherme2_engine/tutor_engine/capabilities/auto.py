"""Auto capability: agentic router that analyzes intent, autonomously delegates
to the best matching capability, and synthesizes the final response."""

from __future__ import annotations

from tutor_engine.agents.auto.auto_pipeline import AutoPipeline
from tutor_engine.core.capability_protocol import BaseCapability, CapabilityManifest


class AutoCapability(BaseCapability):
    """Agentic router: three-stage pipeline (analyzing → delegating → synthesizing)."""

    @property
    def manifest(self) -> CapabilityManifest:
        return CapabilityManifest(
            name="auto",
            description="智能路由：自动分析用户意图，委派给最合适的能力处理（苏格拉底式启发教学）",
            stages=["analyzing", "delegating", "synthesizing"],
            tools_used=[],
            cli_aliases=["auto"],
            request_schema={},
            config_defaults={},
        )

    async def run(self, context, stream) -> None:
        # Lazy import to keep capability registration cheap.
        pipeline = AutoPipeline(language=context.language)
        await pipeline.run(context, stream)
