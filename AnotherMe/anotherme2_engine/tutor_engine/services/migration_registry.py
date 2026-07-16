"""
Backend Migration Registry
==========================

Centralized registry for all backend data migrations. Each migration is
registered with an id, version, description, and a callable that performs
the migration. Migrations run once and their completion is tracked in a
JSON state file.

Usage::

    from tutor_engine.services.migration_registry import (
        register_migration, run_all_migrations, get_migration_status,
    )

    register_migration({
        "id": "legacy-memory",
        "version": "1.0.0",
        "description": "Migrate memory.md to profile.md + summary.md",
        "run": my_migration_func,
    })

    # On startup:
    run_all_migrations()
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger("migration_registry")


@dataclass
class Migration:
    id: str
    version: str
    description: str
    run: Callable[[], None]
    once: bool = True


@dataclass
class MigrationState:
    completed: dict[str, str] = field(default_factory=dict)  # migration_id -> version


_STATE_FILE_NAME = "migration_state.json"

# Module-level state
_migrations: list[Migration] = []
_state: MigrationState | None = None
_state_dir: Path | None = None


def _get_state_file() -> Path:
    global _state_dir
    if _state_dir is None:
        # Default: store state next to the data directory
        from tutor_engine.services.path_service import get_path_service
        _state_dir = get_path_service().user_data_dir / "migrations"
    _state_dir.mkdir(parents=True, exist_ok=True)
    return _state_dir / _STATE_FILE_NAME


def _load_state() -> MigrationState:
    global _state
    if _state is not None:
        return _state

    state_file = _get_state_file()
    if state_file.exists():
        try:
            data = json.loads(state_file.read_text(encoding="utf-8"))
            _state = MigrationState(completed=data.get("completed", {}))
        except Exception:
            _state = MigrationState()
    else:
        _state = MigrationState()
    return _state


def _save_state() -> None:
    if _state is None:
        return
    state_file = _get_state_file()
    try:
        state_file.write_text(
            json.dumps({"completed": _state.completed}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as exc:
        logger.warning("Failed to save migration state: %s", exc)


def register_migration(migration: dict[str, Any]) -> None:
    """Register a migration. Accepts a dict with keys: id, version, description, run, once."""
    _migrations.append(
        Migration(
            id=migration["id"],
            version=migration["version"],
            description=migration.get("description", ""),
            run=migration["run"],
            once=migration.get("once", True),
        )
    )


def run_all_migrations() -> dict[str, Any]:
    """Run all pending migrations in registration order.

    Returns a summary dict with keys: ran, skipped, errors.
    """
    state = _load_state()
    ran = 0
    skipped = 0
    errors: list[dict[str, str]] = []

    for migration in sorted(_migrations, key=lambda m: m.version):
        if migration.once and state.completed.get(migration.id) == migration.version:
            skipped += 1
            continue

        try:
            logger.info(
                "Running migration: %s v%s — %s",
                migration.id, migration.version, migration.description,
            )
            migration.run()
            state.completed[migration.id] = migration.version
            _save_state()
            ran += 1
            logger.info("Migration completed: %s v%s", migration.id, migration.version)
        except Exception as exc:
            error_msg = str(exc)
            logger.error(
                "Migration failed: %s v%s: %s",
                migration.id, migration.version, error_msg,
            )
            errors.append({"id": migration.id, "error": error_msg})
            # Continue with other migrations even if one fails

    if ran > 0 or errors:
        logger.info(
            "Migrations complete: %d ran, %d skipped, %d errors",
            ran, skipped, len(errors),
        )

    return {"ran": ran, "skipped": skipped, "errors": errors}


def get_migration_status() -> list[dict[str, Any]]:
    """Return the status of all registered migrations."""
    state = _load_state()
    return [
        {
            "id": m.id,
            "version": m.version,
            "description": m.description,
            "completed": state.completed.get(m.id) == m.version,
        }
        for m in sorted(_migrations, key=lambda m: m.version)
    ]


def reset_migration_state() -> None:
    """Reset migration state (for debugging/testing)."""
    global _state
    state_file = _get_state_file()
    if state_file.exists():
        state_file.unlink()
    _state = None


# ── Built-in Migrations ────────────────────────────────────────────


def _register_builtin_migrations() -> None:
    """Register all built-in backend migrations."""

    # 1. Legacy memory file migration (memory.md -> profile.md + summary.md)
    register_migration({
        "id": "legacy-memory",
        "version": "1.0.0",
        "description": "Migrate memory.md to profile.md + summary.md",
        "run": _run_memory_migration,
    })

    # 2. Legacy tutorbot directory migration
    register_migration({
        "id": "legacy-tutorbot-dirs",
        "version": "1.0.0",
        "description": "Migrate tutorbot directory layout from bots/{id}/ to {id}/",
        "run": _run_tutorbot_migration,
    })

    # 3. Legacy chat_history.db location migration
    register_migration({
        "id": "legacy-chat-history-db",
        "version": "1.0.0",
        "description": "Import legacy chat_history.db into unified ai_chat tables",
        "run": _run_chat_history_migration,
    })

    # 4. Gateway schema column migrations
    register_migration({
        "id": "gateway-schema-columns",
        "version": "1.0.0",
        "description": "Ensure all required columns exist in gateway tables",
        "run": _run_gateway_schema_migration,
    })


def _run_memory_migration() -> None:
    try:
        from tutor_engine.services.memory.service import MemoryService
        from tutor_engine.services.path_service import get_path_service
        svc = MemoryService(get_path_service())
        # _migrate_legacy is called in __init__, so just constructing it triggers migration
    except Exception as exc:
        logger.warning("Memory migration skipped: %s", exc)


def _run_tutorbot_migration() -> None:
    try:
        from tutor_engine.services.tutorbot.manager import _maybe_migrate_legacy
        from tutor_engine.services.path_service import get_path_service
        path_service = get_path_service()
        bots_dir = path_service.user_data_dir / "tutorbot"
        if bots_dir.exists():
            for entry in bots_dir.iterdir():
                if entry.is_dir() and entry.name != "bots":
                    _maybe_migrate_legacy(entry.name)
    except Exception as exc:
        logger.warning("Tutorbot migration skipped: %s", exc)


def _run_chat_history_migration() -> None:
    try:
        import json
        import sqlite3

        from api_gateway.db import init_db, nested_session_scope, session_scope
        from api_gateway.models import AIChatMessage, AIChatSession, AppUser
        from tutor_engine.services.path_service import get_path_service
        from tutor_engine.services.session.gateway_store import DEFAULT_USER_ID

        def _json_loads(value, default):
            if not value:
                return default
            try:
                return json.loads(value)
            except Exception:
                return default

        init_db()
        ps = get_path_service()
        legacy_paths = [
            ps.project_root / "data" / "chat_history.db",
            ps.get_chat_history_db(),
        ]
        for db_path in dict.fromkeys(legacy_paths):
            if not db_path.exists():
                continue
            conn = sqlite3.connect(str(db_path))
            conn.row_factory = sqlite3.Row
            try:
                tables = {
                    row["name"]
                    for row in conn.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    ).fetchall()
                }
                if "sessions" not in tables:
                    continue
                session_columns = {
                    row["name"] for row in conn.execute("PRAGMA table_info(sessions)").fetchall()
                }
                message_columns = (
                    {row["name"] for row in conn.execute("PRAGMA table_info(messages)").fetchall()}
                    if "messages" in tables
                    else set()
                )
                legacy_sessions = conn.execute("SELECT * FROM sessions").fetchall()
                legacy_messages = (
                    conn.execute("SELECT * FROM messages ORDER BY session_id, id").fetchall()
                    if "messages" in tables
                    else []
                )
            finally:
                conn.close()

            with session_scope() as session:
                if session.get(AppUser, DEFAULT_USER_ID) is None:
                    try:
                        with nested_session_scope(session):
                            session.add(AppUser(id=DEFAULT_USER_ID, name="Tutor Engine"))
                            session.flush()
                    except Exception:
                        pass

                for row in legacy_sessions:
                    sid = row["id"] if "id" in session_columns else row["session_id"]
                    if not sid or session.get(AIChatSession, sid) is not None:
                        continue
                    session.add(
                        AIChatSession(
                            id=sid,
                            user_id=DEFAULT_USER_ID,
                            title=(row["title"] if "title" in session_columns else None)
                            or "New conversation",
                            source="Tutor Engine Legacy",
                            compressed_summary=(
                                row["compressed_summary"]
                                if "compressed_summary" in session_columns
                                else ""
                            )
                            or "",
                            summary_up_to_msg_id=int(
                                row["summary_up_to_msg_id"]
                                if "summary_up_to_msg_id" in session_columns
                                else 0
                            ),
                            preferences_json=_json_loads(
                                row["preferences_json"]
                                if "preferences_json" in session_columns
                                else None,
                                {},
                            ),
                        )
                    )

                per_session_seq: dict[str, int] = {}
                for row in legacy_messages:
                    sid = row["session_id"] if "session_id" in message_columns else ""
                    if not sid or session.get(AIChatSession, sid) is None:
                        continue
                    per_session_seq[sid] = per_session_seq.get(sid, 0) + 1
                    exists = (
                        session.query(AIChatMessage)
                        .filter(
                            AIChatMessage.session_id == sid,
                            AIChatMessage.runtime_seq == per_session_seq[sid],
                        )
                        .first()
                    )
                    if exists is not None:
                        continue
                    session.add(
                        AIChatMessage(
                            session_id=sid,
                            runtime_seq=per_session_seq[sid],
                            role=(row["role"] if "role" in message_columns else "user")
                            or "user",
                            content=(row["content"] if "content" in message_columns else "")
                            or "",
                            capability=(
                                row["capability"]
                                if "capability" in message_columns
                                else ""
                            )
                            or "",
                            events_json=_json_loads(
                                row["events_json"] if "events_json" in message_columns else None,
                                [],
                            ),
                            attachments_json=_json_loads(
                                row["attachments_json"]
                                if "attachments_json" in message_columns
                                else None,
                                [],
                            ),
                        )
                    )

            imported_path = db_path.with_name(f"{db_path.name}.imported")
            try:
                db_path.replace(imported_path)
                logger.info("Imported legacy chat history %s into unified DB", db_path)
            except OSError:
                logger.warning("Imported legacy chat history but failed to archive %s", db_path)
    except Exception as exc:
        logger.warning("Chat history migration skipped: %s", exc)


def _run_gateway_schema_migration() -> None:
    """Gateway schema migrations are handled by db.init_db() at startup.
    This migration is registered for tracking purposes only."""
    logger.info("Gateway schema migration is handled by db.init_db() at startup")


# Auto-register built-in migrations on module load
_register_builtin_migrations()
