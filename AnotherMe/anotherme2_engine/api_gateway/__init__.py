"""API gateway package for AnotherMe2 + AnotherMe integration.

`create_app` is imported lazily to avoid a hard `fastapi` import at
package import time (which would break lightweight tooling such as the
P1 unit-test runner).
"""

from __future__ import annotations

from typing import Any

__all__ = ["create_app"]


def __getattr__(name: str) -> Any:  # PEP 562 — module-level __getattr__
    if name == "create_app":
        from .app import create_app

        return create_app
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
