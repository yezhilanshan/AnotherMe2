"""
Storage cleanup service with retention policies and disk monitoring.

Provides:
- Orphan workspace cleanup (session workspace dirs with no active session)
- Age-based file retention (delete files older than N days)
- Disk usage monitoring with alert thresholds
- Scheduled cleanup via background task

Usage:
    from tutor_engine.services.storage.cleanup import StorageCleanupService, CleanupConfig
    svc = StorageCleanupService(data_dir, CleanupConfig(max_age_days=90))
    await svc.start()  # begins periodic cleanup
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

logger = logging.getLogger(__name__)


@dataclass
class CleanupConfig:
    """Configuration for storage cleanup policies."""

    max_age_days: int = 90  # Delete files/dirs older than this (0 = disabled)
    max_session_workspaces: int = 100  # Keep at most N session workspaces
    disk_warning_threshold_bytes: int = 5 * 1024 * 1024 * 1024  # 5 GB free
    disk_critical_threshold_bytes: int = 1 * 1024 * 1024 * 1024  # 1 GB free
    cleanup_interval_seconds: int = 3600  # 1 hour (0 = manual only)
    clean_directories: list[str] = field(
        default_factory=lambda: [
            "user/workspace",
            "user/logs",
            "user/chat/attachments",
        ]
    )
    on_alert: Callable[[str, str], None] | None = None  # (level, msg) -> None


@dataclass
class DiskUsage:
    """Disk usage snapshot."""

    total_bytes: int
    used_bytes: int
    free_bytes: int
    percent_used: float
    path: str


class StorageCleanupService:
    """Manages periodic storage cleanup and disk monitoring."""

    def __init__(self, data_dir: Path, config: CleanupConfig | None = None) -> None:
        self.data_dir = Path(data_dir)
        self.config = config or CleanupConfig()
        self._task: asyncio.Task | None = None
        self._running = False
        self._last_cleanup: float = 0
        self._total_cleaned_bytes: int = 0
        self._total_cleaned_files: int = 0

    @property
    def stats(self) -> dict:
        return {
            "last_cleanup": self._last_cleanup,
            "total_cleaned_bytes": self._total_cleaned_bytes,
            "total_cleaned_files": self._total_cleaned_files,
        }

    # ── Disk Monitoring ──────────────────────────────────────────

    def get_disk_usage(self) -> DiskUsage:
        """Get disk usage for the data directory's filesystem."""
        stat = os.statvfs(self.data_dir)
        total = stat.f_frsize * stat.f_blocks
        free = stat.f_frsize * stat.f_bavail
        used = total - free
        percent = (used / total * 100) if total > 0 else 0
        return DiskUsage(
            total_bytes=total,
            used_bytes=used,
            free_bytes=free,
            percent_used=percent,
            path=str(self.data_dir),
        )

    def check_disk_thresholds(self, usage: DiskUsage | None = None) -> list[str]:
        """Check disk usage against configured thresholds. Returns alert levels."""
        if usage is None:
            usage = self.get_disk_usage()
        alerts: list[str] = []

        if (
            self.config.disk_critical_threshold_bytes > 0
            and usage.free_bytes < self.config.disk_critical_threshold_bytes
        ):
            alerts.append("critical")
        elif (
            self.config.disk_warning_threshold_bytes > 0
            and usage.free_bytes < self.config.disk_warning_threshold_bytes
        ):
            alerts.append("warning")

        for level in alerts:
            msg = (
                f"Disk {level}: {usage.free_bytes / (1024**3):.1f} GB free "
                f"({usage.percent_used:.0f}% used) on {usage.path}"
            )
            logger.warning(msg)
            if self.config.on_alert:
                try:
                    self.config.on_alert(level, msg)
                except Exception:
                    pass

        return alerts

    # ── Cleanup Operations ───────────────────────────────────────

    def _is_expired(self, path: Path, max_age_days: int) -> bool:
        """Check if a file/directory is older than max_age_days."""
        if max_age_days <= 0:
            return False
        try:
            mtime = path.stat().st_mtime
            cutoff = time.time() - (max_age_days * 86400)
            return mtime < cutoff
        except OSError:
            return False

    def _get_dir_size(self, path: Path) -> int:
        """Get total size of a directory in bytes."""
        total = 0
        try:
            for entry in path.rglob("*"):
                if entry.is_file():
                    total += entry.stat().st_size
        except OSError:
            pass
        return total

    def _clean_directory(self, dir_path: Path, max_age_days: int) -> tuple[int, int]:
        """Clean expired files from a directory.

        Returns (bytes_cleaned, files_cleaned).
        """
        if not dir_path.exists() or not dir_path.is_dir():
            return 0, 0

        bytes_cleaned = 0
        files_cleaned = 0

        # Collect expired entries
        to_remove: list[Path] = []
        for entry in dir_path.iterdir():
            if self._is_expired(entry, max_age_days):
                to_remove.append(entry)

        # Remove expired entries
        for entry in to_remove:
            try:
                size = (
                    self._get_dir_size(entry)
                    if entry.is_dir()
                    else entry.stat().st_size
                )
                if entry.is_dir():
                    shutil.rmtree(entry, ignore_errors=True)
                else:
                    entry.unlink(missing_ok=True)
                bytes_cleaned += size
                files_cleaned += 1
                logger.debug("Cleaned expired: %s (%d bytes)", entry, size)
            except Exception:
                logger.debug("Failed to clean %s", entry, exc_info=True)

        return bytes_cleaned, files_cleaned

    def _clean_orphan_workspaces(self) -> tuple[int, int]:
        """Remove workspace directories for sessions that no longer exist."""
        workspace_dir = self.data_dir / "user" / "workspace"
        if not workspace_dir.exists():
            return 0, 0

        # Get known active session IDs from the sessions file or DB
        active_sessions: set[str] = set()
        sessions_file = self.data_dir / "sessions.json"
        if sessions_file.exists():
            try:
                import json

                sessions = json.loads(sessions_file.read_text(encoding="utf-8"))
                if isinstance(sessions, list):
                    active_sessions = {
                        s.get("id", "") for s in sessions if isinstance(s, dict)
                    }
            except Exception:
                pass

        # Also check the unified Gateway-backed chat session store.
        try:
            from tutor_engine.services.session import get_sqlite_session_store

            store = get_sqlite_session_store()
            active_sessions.update(store.list_session_ids_sync())
        except Exception:
            logger.debug("Failed to load active sessions from unified store", exc_info=True)

        bytes_cleaned = 0
        files_cleaned = 0

        for entry in workspace_dir.iterdir():
            if not entry.is_dir():
                continue
            # Workspace dirs are named by session/feature/task_id pattern
            # Check if any segment matches an active session
            parts = entry.parts
            is_orphan = True
            for part in parts:
                if part in active_sessions:
                    is_orphan = False
                    break

            if is_orphan:
                try:
                    size = self._get_dir_size(entry)
                    shutil.rmtree(entry, ignore_errors=True)
                    bytes_cleaned += size
                    files_cleaned += 1
                    logger.info("Cleaned orphan workspace: %s (%d bytes)", entry, size)
                except Exception:
                    logger.debug("Failed to clean orphan %s", entry, exc_info=True)

        return bytes_cleaned, files_cleaned

    def _enforce_session_limit(self, max_workspaces: int) -> tuple[int, int]:
        """Remove oldest workspace dirs exceeding the session limit."""
        if max_workspaces <= 0:
            return 0, 0

        workspace_dir = self.data_dir / "user" / "workspace"
        if not workspace_dir.exists():
            return 0, 0

        # Collect workspace dirs with their mtimes
        entries: list[tuple[float, Path]] = []
        for entry in workspace_dir.iterdir():
            if entry.is_dir():
                try:
                    entries.append((entry.stat().st_mtime, entry))
                except OSError:
                    pass

        if len(entries) <= max_workspaces:
            return 0, 0

        # Sort by mtime ascending (oldest first)
        entries.sort(key=lambda x: x[0])
        to_remove = entries[: len(entries) - max_workspaces]

        bytes_cleaned = 0
        files_cleaned = 0
        for _, entry in to_remove:
            try:
                size = self._get_dir_size(entry)
                shutil.rmtree(entry, ignore_errors=True)
                bytes_cleaned += size
                files_cleaned += 1
                logger.info("Pruned workspace (limit): %s (%d bytes)", entry, size)
            except Exception:
                logger.debug("Failed to prune %s", entry, exc_info=True)

        return bytes_cleaned, files_cleaned

    def _clean_logs(self) -> tuple[int, int]:
        """Rotate old log files."""
        log_dir = self.data_dir / "user" / "logs"
        return self._clean_directory(log_dir, self.config.max_age_days)

    def run_cleanup(self) -> dict:
        """Execute a full cleanup cycle. Returns cleanup stats."""
        now = time.time()
        total_bytes = 0
        total_files = 0
        details: dict[str, dict] = {}

        # 1. Age-based cleanup for each configured directory
        for dir_name in self.config.clean_directories:
            dir_path = self.data_dir / dir_name
            b, f = self._clean_directory(dir_path, self.config.max_age_days)
            total_bytes += b
            total_files += f
            if b > 0 or f > 0:
                details[f"age_{dir_name}"] = {"bytes": b, "files": f}

        # 2. Orphan workspace cleanup
        b, f = self._clean_orphan_workspaces()
        total_bytes += b
        total_files += f
        if b > 0 or f > 0:
            details["orphan_workspaces"] = {"bytes": b, "files": f}

        # 3. Session workspace limit enforcement
        b, f = self._enforce_session_limit(self.config.max_session_workspaces)
        total_bytes += b
        total_files += f
        if b > 0 or f > 0:
            details["session_limit"] = {"bytes": b, "files": f}

        # 4. Log rotation
        b, f = self._clean_logs()
        total_bytes += b
        total_files += f
        if b > 0 or f > 0:
            details["logs"] = {"bytes": b, "files": f}

        # 5. Check disk thresholds
        alerts = self.check_disk_thresholds()

        self._last_cleanup = now
        self._total_cleaned_bytes += total_bytes
        self._total_cleaned_files += total_files

        result = {
            "timestamp": now,
            "bytes_cleaned": total_bytes,
            "files_cleaned": total_files,
            "details": details,
            "disk_alerts": alerts,
        }

        if total_bytes > 0 or total_files > 0:
            logger.info(
                "Cleanup: %d files, %.2f MB freed",
                total_files,
                total_bytes / (1024 * 1024),
            )

        return result

    # ── Lifecycle ────────────────────────────────────────────────

    async def _cleanup_loop(self) -> None:
        """Background loop that runs cleanup periodically."""
        while self._running:
            await asyncio.sleep(self.config.cleanup_interval_seconds)
            if not self._running:
                break
            try:
                self.run_cleanup()
            except Exception:
                logger.exception("Cleanup cycle failed")

    async def start(self) -> None:
        """Start periodic background cleanup."""
        if self.config.cleanup_interval_seconds <= 0:
            logger.info("Cleanup interval is 0; running only manual cleanup")
            return
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._cleanup_loop())
        logger.info(
            "Storage cleanup started (interval: %ds, max_age: %dd)",
            self.config.cleanup_interval_seconds,
            self.config.max_age_days,
        )
        # Run an initial cleanup immediately
        try:
            self.run_cleanup()
        except Exception:
            logger.exception("Initial cleanup failed")

    async def stop(self) -> None:
        """Stop background cleanup."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("Storage cleanup stopped")
