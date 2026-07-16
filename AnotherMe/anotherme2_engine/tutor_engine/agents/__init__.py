"""
Agents Module - Unified agent system for OpenTutor.

This module provides a unified BaseAgent class and module-specific agents:
- solve: Question solving agents (MainSolver, SolveAgent, etc.)
- research: Deep research agents (DecomposeAgent, ResearchAgent, etc.)
- question: Question generation agents (ReAct architecture, separate base)
- chat: Lightweight conversational agent with session management

Note: ``co_writer`` and ``book`` are independent top-level modules under
``tutor_engine/`` (e.g. ``tutor_engine.co_writer``, ``tutor_engine.book``). They
still inherit from :class:`BaseAgent` defined here but are not part of
the ``tutor_engine.agents`` package.

Usage:
    from tutor_engine.agents.base_agent import BaseAgent

    class MyAgent(BaseAgent):
        async def process(self, *args, **kwargs):
            ...
"""

from .base_agent import BaseAgent
from .chat import ChatAgent, SessionManager

__all__ = ["BaseAgent", "ChatAgent", "SessionManager"]
