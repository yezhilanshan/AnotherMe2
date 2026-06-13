"""
Unified migration registry for tutor_engine.

Registers and runs schema/data migrations in version order.
Replaces scattered `_migrate_legacy()` calls in individual services.

Usage:
    from tutor_engine.config.migration_registry import get_migration_registry
    reg = get_migration_registry()
    reg.run_migrations()
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

logger = logging.getLogger(__name__)

MigrationFn = Callable[[Path], None]


class MigrationRegistry:
    """Central registry for all data/schema migrations."""

    def __init__(self, data_dir: Path, version_file: str = ".schema_version") -> None:
        self.data_dir = Path(data_dir)
        self.version_file = self.data_dir / version_file
        self._migrations: dict[int, tuple[str, MigrationFn]] = {}

    def register(self, version: int, name: str, fn: MigrationFn) -> None:
        """Register a migration to run when upgrading to `version`."""
        if version in self._migrations:
            raise ValueError(f"Migration version {version} already registered")
        self._migrations[version] = (name, fn)

    def current_version(self) -> int:
        """Read the current schema version from disk."""
        try:
            return int(self.version_file.read_text().strip())
        except (FileNotFoundError, ValueError):
            return 0

    def _write_version(self, version: int) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.version_file.write_text(str(version))

    def run_migrations(self, target_version: int | None = None) -> list[str]:
        """Run all pending migrations up to target_version.

        Returns list of migration names that were executed.
        """
        current = self.current_version()
        target = target_version or max(self._migrations.keys(), default=current)
        executed: list[str] = []

        for version in sorted(self._migrations.keys()):
            if version <= current:
                continue
            if version > target:
                break

            name, fn = self._migrations[version]
            logger.info("Running migration %d: %s", version, name)
            try:
                fn(self.data_dir)
                self._write_version(version)
                executed.append(name)
                logger.info("Migration %d (%s) completed", version, name)
            except Exception:
                logger.exception("Migration %d (%s) FAILED", version, name)
                raise

        return executed


# ── Global singleton ──
_registry: MigrationRegistry | None = None


def get_migration_registry() -> MigrationRegistry:
    global _registry
    if _registry is None:
        from tutor_engine.services.path_service import get_path_service

        ps = get_path_service()
        data_dir = ps.user_data_dir
        _registry = MigrationRegistry(data_dir)
        _register_builtin_migrations(_registry)
    return _registry


def _register_builtin_migrations(reg: MigrationRegistry) -> None:
    """Register all known migrations from across services."""

    # ── Migration 1: Move legacy chat_history.db into data/user/ ──
    def _migrate_chat_db(data_dir: Path) -> None:
        from tutor_engine.services.path_service import get_path_service

        ps = get_path_service()
        legacy = ps.project_root / "data" / "chat_history.db"
        target = ps.get_chat_history_db()
        if target.exists() or not legacy.exists():
            return
        import os

        try:
            os.replace(str(legacy), str(target))
            logger.info("Moved legacy chat_history.db to %s", target)
        except OSError:
            pass

    reg.register(1, "migrate_chat_history_db", _migrate_chat_db)

    # ── Migration 2: Migrate memory.md → two-file system ──
    def _migrate_memory_files(data_dir: Path) -> None:
        memory_dir = data_dir / "memory"
        legacy = memory_dir / "memory.md"
        if not legacy.exists():
            return
        profile_file = memory_dir / "profile.md"
        summary_file = memory_dir / "summary.md"
        if profile_file.exists() or summary_file.exists():
            return
        content = legacy.read_text(encoding="utf-8").strip()
        if not content:
            legacy.rename(legacy.with_suffix(".md.bak"))
            return

        parts = content.split("## Learning Journey", 1)
        if len(parts) == 2:
            prefs, ctx = parts
        else:
            prefs, ctx = content, ""

        if prefs.strip():
            profile_file.write_text(
                f"## Preferences\n{prefs.strip()}", encoding="utf-8"
            )
        if ctx.strip():
            summary_file.write_text(
                f"## Learning Journey\n{ctx.strip()}", encoding="utf-8"
            )
        legacy.rename(legacy.with_suffix(".md.bak"))
        logger.info("Migrated memory.md to profile.md + summary.md")

    reg.register(2, "migrate_memory_files", _migrate_memory_files)

    # ── Migration 3: Normalize knowledge base provider configs ──
    def _migrate_kb_providers(data_dir: Path) -> None:
        kb_dir = data_dir.parent / "knowledge_bases"
        if not kb_dir.exists():
            return
        import json

        for kb_config_path in kb_dir.rglob("config.json"):
            try:
                cfg = json.loads(kb_config_path.read_text(encoding="utf-8"))
                changed = False
                if "default" in cfg:
                    del cfg["default"]
                    changed = True
                for entry in cfg.get("providers", []):
                    if isinstance(entry, dict) and entry.get("provider") == "legacy":
                        entry["provider"] = "llamaindex"
                        changed = True
                if changed:
                    kb_config_path.write_text(
                        json.dumps(cfg, indent=2, ensure_ascii=False),
                        encoding="utf-8",
                    )
                    logger.info("Migrated knowledge base config: %s", kb_config_path)
            except Exception:
                continue

    reg.register(3, "normalize_kb_providers", _migrate_kb_providers)
