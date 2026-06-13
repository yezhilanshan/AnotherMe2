"""Server configuration endpoint — exposes which providers have API keys configured."""

from __future__ import annotations

import os

from fastapi import APIRouter, Header
from pydantic import BaseModel

from ..config import Settings
from .auth import require_token


class ProviderStatus(BaseModel):
    id: str
    configured: bool
    has_api_key: bool
    base_url: str = ""


def _has_env(prefix: str) -> bool:
    """Check if any env var starting with prefix has a non-empty value."""
    for key, val in os.environ.items():
        if key.startswith(prefix) and val.strip():
            return True
    return False


def _env(prefix: str) -> str:
    """Get the first non-empty env var starting with prefix."""
    for key, val in os.environ.items():
        if key.startswith(prefix) and val.strip():
            return val
    return ""


def create_server_config_router(settings: Settings) -> APIRouter:
    router = APIRouter(tags=["server-config"])

    LLM_PROVIDERS = {
        "openai": "OPENAI_API_KEY",
        "anthropic": "ANTHROPIC_API_KEY",
        "google": "GOOGLE_API_KEY",
        "deepseek": "DEEPSEEK_API_KEY",
        "qwen": "QWEN_API_KEY",
        "kimi": "KIMI_API_KEY",
        "glm": "GLM_API_KEY",
        "minimax": "MINIMAX_API_KEY",
        "siliconflow": "SILICONFLOW_API_KEY",
        "doubao": "DOUBAO_API_KEY",
        "grok": "GROK_API_KEY",
    }

    TTS_PROVIDERS = {
        "openai-tts": "TTS_OPENAI_API_KEY",
        "azure-tts": "TTS_AZURE_API_KEY",
        "glm-tts": "TTS_GLM_API_KEY",
        "qwen-tts": "TTS_QWEN_API_KEY",
        "doubao-tts": "TTS_DOUBAO_API_KEY",
        "elevenlabs-tts": "TTS_ELEVENLABS_API_KEY",
        "minimax-tts": "TTS_MINIMAX_API_KEY",
    }

    ASR_PROVIDERS = {
        "openai-whisper": "ASR_OPENAI_API_KEY",
        "qwen-asr": "ASR_QWEN_API_KEY",
    }

    IMAGE_PROVIDERS = {
        "seedream": "IMAGE_SEEDREAM_API_KEY",
        "qwen-image": "IMAGE_QWEN_IMAGE_API_KEY",
        "nano-banana": "IMAGE_NANO_BANANA_API_KEY",
        "minimax-image": "IMAGE_MINIMAX_API_KEY",
        "grok-image": "IMAGE_GROK_API_KEY",
        "liblib-image": "IMAGE_LIBLIB_API_KEY",
    }

    VIDEO_PROVIDERS = {
        "seedance": "VIDEO_SEEDANCE_API_KEY",
        "minimax-video": "VIDEO_MINIMAX_API_KEY",
    }

    WEB_SEARCH_PROVIDERS = {
        "tavily": "TAVILY_API_KEY",
    }

    @router.get("/v1/server/providers")
    def list_providers(
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_token(settings, authorization)

        def build_providers(mapping: dict[str, str]) -> list[dict]:
            result = []
            for provider_id, env_key in mapping.items():
                has_key = bool(os.getenv(env_key, "").strip())
                base_url = os.getenv(f"{env_key.replace('_API_KEY', '_BASE_URL')}", "")
                result.append({
                    "id": provider_id,
                    "configured": has_key,
                    "has_api_key": has_key,
                    "base_url": base_url,
                })
            return result

        return {
            "llm": build_providers(LLM_PROVIDERS),
            "tts": build_providers(TTS_PROVIDERS),
            "asr": build_providers(ASR_PROVIDERS),
            "image": build_providers(IMAGE_PROVIDERS),
            "video": build_providers(VIDEO_PROVIDERS),
            "webSearch": build_providers(WEB_SEARCH_PROVIDERS),
        }

    return router
