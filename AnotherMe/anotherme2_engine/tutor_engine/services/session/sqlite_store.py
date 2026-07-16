"""Compatibility exports for the unified session store.

The old implementation kept Tutor Engine chat state in an independent SQLite
schema.  P2-5 moves this path onto API Gateway's SQLAlchemy `ai_chat_*` tables.
The public names stay available so existing Tutor Engine imports do not need a
cross-cutting rename in the same change.
"""

from __future__ import annotations

from .gateway_store import UnifiedSQLAlchemySessionStore, get_unified_session_store


SQLiteSessionStore = UnifiedSQLAlchemySessionStore
get_sqlite_session_store = get_unified_session_store


__all__ = ["SQLiteSessionStore", "get_sqlite_session_store"]
