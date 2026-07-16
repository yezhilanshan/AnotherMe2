"""Shared chat model catalog loaded from the mobile config JSON."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any


def _catalog_path() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        candidate = parent / "mobile" / "config" / "models.json"
        if candidate.exists():
            return candidate
    raise FileNotFoundError("mobile/config/models.json not found")


@dataclass(frozen=True)
class ModelDefinition:
    id: str
    label: str
    provider: str
    description: str
    supports_vision: bool
    supports_tools: bool
    max_input_tokens: int
    default_for: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "provider": self.provider,
            "description": self.description,
            "supportsVision": self.supports_vision,
            "supportsTools": self.supports_tools,
            "maxInputTokens": self.max_input_tokens,
            "defaultFor": list(self.default_for),
        }


@dataclass(frozen=True)
class ModelCatalog:
    default_model: str
    capability_defaults: dict[str, str]
    models: tuple[ModelDefinition, ...]

    def get(self, model_id: str | None) -> ModelDefinition | None:
        if not model_id:
            return None
        for item in self.models:
            if item.id == model_id:
                return item
        return None

    def resolve_for_capability(self, requested_model: str | None, capability: str) -> str:
        if requested_model and requested_model.strip():
            return requested_model.strip()
        return self.capability_defaults.get(capability, self.default_model)

    def to_dict(self) -> dict[str, Any]:
        return {
            "defaultModel": self.default_model,
            "capabilityDefaults": dict(self.capability_defaults),
            "models": [item.to_dict() for item in self.models],
        }


@lru_cache(maxsize=1)
def load_model_catalog() -> ModelCatalog:
    raw = json.loads(_catalog_path().read_text(encoding="utf-8"))
    models = tuple(
        ModelDefinition(
            id=str(item["id"]),
            label=str(item.get("label") or item["id"]),
            provider=str(item.get("provider") or ""),
            description=str(item.get("description") or ""),
            supports_vision=bool(item.get("supportsVision")),
            supports_tools=bool(item.get("supportsTools")),
            max_input_tokens=int(item.get("maxInputTokens") or 0),
            default_for=tuple(str(entry) for entry in (item.get("defaultFor") or [])),
        )
        for item in raw.get("models", [])
    )
    return ModelCatalog(
        default_model=str(raw.get("defaultModel") or ""),
        capability_defaults={
            str(key): str(value)
            for key, value in (raw.get("capabilityDefaults") or {}).items()
        },
        models=models,
    )


def resolve_request_model(requested_model: str | None, capability: str) -> str:
    return load_model_catalog().resolve_for_capability(requested_model, capability)


def get_model_definition(model_id: str | None) -> ModelDefinition | None:
    return load_model_catalog().get(model_id)
