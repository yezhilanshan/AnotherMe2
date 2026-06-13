from typing import Any, Dict

from pydantic import BaseModel, field_validator


class LLMConfig(BaseModel):
    model: str
    provider: str = "openai"


class PathsConfig(BaseModel):
    user_data_dir: str
    knowledge_bases_dir: str
    user_log_dir: str


class AppConfig(BaseModel):
    llm: LLMConfig
    paths: PathsConfig

    @field_validator("llm", mode="before")
    @classmethod
    def ensure_llm(cls, v: Any) -> Dict[str, Any]:
        if not isinstance(v, dict):
            raise ValueError("llm section must be a mapping")
        if "model" not in v:
            raise ValueError("llm.model is required")
        return v


CURRENT_SCHEMA_VERSION = 3  # Synced with migration_registry.py


def migrate_config(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """
    Migrate config dict to current schema version.
    Delegates data migrations to the unified MigrationRegistry.
    """
    try:
        from tutor_engine.config.migration_registry import get_migration_registry

        reg = get_migration_registry()
        reg.run_migrations(target_version=CURRENT_SCHEMA_VERSION)
    except Exception:
        pass
    return cfg
