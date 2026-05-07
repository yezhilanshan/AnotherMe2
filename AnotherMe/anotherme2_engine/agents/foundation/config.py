"""
Model and runtime configuration.
"""

import os
from typing import Any, Dict, Iterable, Union, Optional

try:
    from env_loader import load_project_env
except ModuleNotFoundError:
    from anotherme2_engine.env_loader import load_project_env
try:
    from output_paths import DEFAULT_OUTPUT_DIR
except ModuleNotFoundError:
    from anotherme2_engine.output_paths import DEFAULT_OUTPUT_DIR


load_project_env()


def _read_api_key_from_env_name(env_name: Union[str, Iterable[str]]) -> str:
    if isinstance(env_name, str):
        env_names = [env_name]
    else:
        env_names = list(env_name or [])

    for name in env_names:
        name = str(name or "").strip()
        if not name:
            continue
        value = os.getenv(name, "")
        if value:
            return value
    return ""


# Provider environment variable names
# OpenAI
OPENAI_API_KEY_ENV_NAMES = ("OPENAI_API_KEY",)
OPENAI_BASE_URL_ENV_NAMES = ("OPENAI_BASE_URL",)

# Claude (Anthropic)
ANTHROPIC_API_KEY_ENV_NAMES = ("ANTHROPIC_API_KEY", "CLAUDE_API_KEY")
ANTHROPIC_BASE_URL_ENV_NAMES = ("ANTHROPIC_BASE_URL",)

# Gemini
GEMINI_API_KEY_ENV_NAMES = ("GEMINI_API_KEY", "GOOGLE_API_KEY")
GEMINI_BASE_URL_ENV_NAMES = ("GEMINI_BASE_URL",)

# DeepSeek
DEEPSEEK_API_KEY_ENV_NAMES = ("DEEPSEEK_API_KEY",)
DEEPSEEK_BASE_URL_ENV_NAMES = ("DEEPSEEK_BASE_URL",)

# Qwen / DashScope / Bailian
DASHSCOPE_API_KEY_ENV_NAMES = ("DASHSCOPE_API_KEY", "BAILIAN_API_KEY", "QWEN_API_KEY")
DASHSCOPE_BASE_URL_ENV_NAMES = ("DASHSCOPE_BASE_URL", "BAILIAN_BASE_URL", "QWEN_BASE_URL")
TEXT_API_KEY_ENV_NAME = DASHSCOPE_API_KEY_ENV_NAMES[0]
VISION_API_KEY_ENV_NAME = DASHSCOPE_API_KEY_ENV_NAMES[0]

# Kimi (Moonshot)
KIMI_API_KEY_ENV_NAMES = ("KIMI_API_KEY", "MOONSHOT_API_KEY")
KIMI_BASE_URL_ENV_NAMES = ("KIMI_BASE_URL", "MOONSHOT_BASE_URL")

# MiniMax
MINIMAX_API_KEY_ENV_NAMES = ("MINIMAX_API_KEY",)
MINIMAX_BASE_URL_ENV_NAMES = ("MINIMAX_BASE_URL",)

# GLM (Zhipu)
GLM_API_KEY_ENV_NAMES = ("GLM_API_KEY", "ZHIPU_API_KEY")
GLM_BASE_URL_ENV_NAMES = ("GLM_BASE_URL", "ZHIPU_BASE_URL")

# SiliconFlow
SILICONFLOW_API_KEY_ENV_NAMES = ("SILICONFLOW_API_KEY",)
SILICONFLOW_BASE_URL_ENV_NAMES = ("SILICONFLOW_BASE_URL",)

# Doubao / Volcengine Ark
ARK_API_KEY_ENV_NAMES = ("ARK_API_KEY", "DOUBAO_API_KEY")
ARK_BASE_URL_ENV_NAMES = ("ARK_BASE_URL", "DOUBAO_BASE_URL")

# Grok (xAI)
GROK_API_KEY_ENV_NAMES = ("GROK_API_KEY", "XAI_API_KEY")
GROK_BASE_URL_ENV_NAMES = ("GROK_BASE_URL", "XAI_BASE_URL")

# Default base URLs
OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1"
ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1"
GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com/v1"
DASHSCOPE_COMPAT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
KIMI_DEFAULT_BASE_URL = "https://api.moonshot.cn/v1"
MINIMAX_DEFAULT_BASE_URL = "https://api.minimaxi.com/v1"
GLM_DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4"
SILICONFLOW_DEFAULT_BASE_URL = "https://api.siliconflow.cn/v1"
ARK_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
GROK_DEFAULT_BASE_URL = "https://api.x.ai/v1"

# Default models for each provider
PROVIDER_MODELS = {
    "openai": {
        "text": "gpt-4o",
        "vision": "gpt-4o",
        "ocr": "gpt-4o",
    },
    "anthropic": {
        "text": "claude-3-5-sonnet-20241022",
        "vision": "claude-3-5-sonnet-20241022",
        "ocr": "claude-3-5-sonnet-20241022",
    },
    "gemini": {
        "text": "gemini-2.0-flash",
        "vision": "gemini-2.0-flash",
        "ocr": "gemini-2.0-flash",
    },
    "deepseek": {
        "text": "deepseek-chat",
        "vision": "deepseek-chat",
        "ocr": "deepseek-chat",
    },
    "qwen": {
        "text": "qwen3.5-plus",
        "vision": "qwen3-vl-plus",
        "ocr": "qwen-vl-ocr-latest",
    },
    "kimi": {
        "text": "kimi-k2-5",
        "vision": "kimi-k2-5",
        "ocr": "kimi-k2-5",
    },
    "minimax": {
        "text": "MiniMax-Text-01",
        "vision": "MiniMax-Text-01",
        "ocr": "MiniMax-Text-01",
    },
    "glm": {
        "text": "glm-4-plus",
        "vision": "glm-4v-plus",
        "ocr": "glm-4v-plus",
    },
    "siliconflow": {
        "text": "deepseek-ai/DeepSeek-V3",
        "vision": "Qwen/Qwen2-VL-72B-Instruct",
        "ocr": "Qwen/Qwen2-VL-72B-Instruct",
    },
    "doubao": {
        "text": "doubao-seed-2-0-pro-260215",
        "vision": "doubao-1.5-vision-pro-250328",
        "ocr": "doubao-1.5-vision-pro-250328",
    },
    "grok": {
        "text": "grok-3",
        "vision": "grok-3",
        "ocr": "grok-3",
    },
}

# Legacy fallback config
FALLBACK_ARK_API_KEY = os.getenv("ARK_API_KEY", "")
FALLBACK_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
FALLBACK_TEXT_MODEL = "doubao-seed-2-0-pro-260215"
FALLBACK_VISION_MODEL = "doubao-1.5-vision-pro-250328"
FALLBACK_OCR_MODEL = FALLBACK_VISION_MODEL


# Provider detection priority (first match wins)
PROVIDER_PRIORITY = [
    "openai",
    "anthropic",
    "gemini",
    "deepseek",
    "qwen",
    "kimi",
    "minimax",
    "glm",
    "siliconflow",
    "doubao",
    "grok",
]


def _detect_provider() -> Optional[str]:
    """Detect which provider to use based on environment variables."""
    provider_checks = {
        "openai": OPENAI_API_KEY_ENV_NAMES,
        "anthropic": ANTHROPIC_API_KEY_ENV_NAMES,
        "gemini": GEMINI_API_KEY_ENV_NAMES,
        "deepseek": DEEPSEEK_API_KEY_ENV_NAMES,
        "qwen": DASHSCOPE_API_KEY_ENV_NAMES,
        "kimi": KIMI_API_KEY_ENV_NAMES,
        "minimax": MINIMAX_API_KEY_ENV_NAMES,
        "glm": GLM_API_KEY_ENV_NAMES,
        "siliconflow": SILICONFLOW_API_KEY_ENV_NAMES,
        "doubao": ARK_API_KEY_ENV_NAMES,
        "grok": GROK_API_KEY_ENV_NAMES,
    }
    
    for provider in PROVIDER_PRIORITY:
        env_names = provider_checks.get(provider, ())
        if _read_api_key_from_env_name(env_names):
            return provider
    return None


def _get_provider_base_url(provider: str) -> str:
    """Get base URL for a provider."""
    url_getters = {
        "openai": lambda: _read_api_key_from_env_name(OPENAI_BASE_URL_ENV_NAMES) or OPENAI_DEFAULT_BASE_URL,
        "anthropic": lambda: _read_api_key_from_env_name(ANTHROPIC_BASE_URL_ENV_NAMES) or ANTHROPIC_DEFAULT_BASE_URL,
        "gemini": lambda: _read_api_key_from_env_name(GEMINI_BASE_URL_ENV_NAMES) or GEMINI_DEFAULT_BASE_URL,
        "deepseek": lambda: _read_api_key_from_env_name(DEEPSEEK_BASE_URL_ENV_NAMES) or DEEPSEEK_DEFAULT_BASE_URL,
        "qwen": lambda: _read_api_key_from_env_name(DASHSCOPE_BASE_URL_ENV_NAMES) or DASHSCOPE_COMPAT_BASE_URL,
        "kimi": lambda: _read_api_key_from_env_name(KIMI_BASE_URL_ENV_NAMES) or KIMI_DEFAULT_BASE_URL,
        "minimax": lambda: _read_api_key_from_env_name(MINIMAX_BASE_URL_ENV_NAMES) or MINIMAX_DEFAULT_BASE_URL,
        "glm": lambda: _read_api_key_from_env_name(GLM_BASE_URL_ENV_NAMES) or GLM_DEFAULT_BASE_URL,
        "siliconflow": lambda: _read_api_key_from_env_name(SILICONFLOW_BASE_URL_ENV_NAMES) or SILICONFLOW_DEFAULT_BASE_URL,
        "doubao": lambda: _read_api_key_from_env_name(ARK_BASE_URL_ENV_NAMES) or ARK_DEFAULT_BASE_URL,
        "grok": lambda: _read_api_key_from_env_name(GROK_BASE_URL_ENV_NAMES) or GROK_DEFAULT_BASE_URL,
    }
    return url_getters.get(provider, lambda: "")()


def _get_provider_api_key(provider: str) -> str:
    """Get API key for a provider."""
    key_getters = {
        "openai": lambda: _read_api_key_from_env_name(OPENAI_API_KEY_ENV_NAMES),
        "anthropic": lambda: _read_api_key_from_env_name(ANTHROPIC_API_KEY_ENV_NAMES),
        "gemini": lambda: _read_api_key_from_env_name(GEMINI_API_KEY_ENV_NAMES),
        "deepseek": lambda: _read_api_key_from_env_name(DEEPSEEK_API_KEY_ENV_NAMES),
        "qwen": lambda: _read_api_key_from_env_name(DASHSCOPE_API_KEY_ENV_NAMES),
        "kimi": lambda: _read_api_key_from_env_name(KIMI_API_KEY_ENV_NAMES),
        "minimax": lambda: _read_api_key_from_env_name(MINIMAX_API_KEY_ENV_NAMES),
        "glm": lambda: _read_api_key_from_env_name(GLM_API_KEY_ENV_NAMES),
        "siliconflow": lambda: _read_api_key_from_env_name(SILICONFLOW_API_KEY_ENV_NAMES),
        "doubao": lambda: _read_api_key_from_env_name(ARK_API_KEY_ENV_NAMES),
        "grok": lambda: _read_api_key_from_env_name(GROK_API_KEY_ENV_NAMES),
    }
    return key_getters.get(provider, lambda: "")()


def _get_model_for_provider(provider: str, model_type: str = "text") -> str:
    """Get default model for a provider and model type."""
    models = PROVIDER_MODELS.get(provider, {})
    return models.get(model_type, models.get("text", "gpt-4o"))


# Legacy functions (maintain backward compatibility)
def _text_api_key() -> str:
    provider = _detect_provider()
    if provider:
        return _get_provider_api_key(provider)
    return FALLBACK_ARK_API_KEY


def _vision_api_key() -> str:
    return _text_api_key()


def _text_base_url() -> str:
    provider = _detect_provider()
    if provider:
        return _get_provider_base_url(provider)
    return FALLBACK_ARK_BASE_URL


def _vision_base_url() -> str:
    return _text_base_url()


def _text_model() -> str:
    provider = _detect_provider()
    if provider:
        return _get_model_for_provider(provider, "text")
    return FALLBACK_TEXT_MODEL


def _vision_model() -> str:
    provider = _detect_provider()
    if provider:
        return _get_model_for_provider(provider, "vision")
    return FALLBACK_VISION_MODEL


def _ocr_model() -> str:
    provider = _detect_provider()
    if provider:
        return _get_model_for_provider(provider, "ocr")
    return FALLBACK_OCR_MODEL


# New flexible config builders
def build_llm_config_for_provider(
    provider: str,
    model_type: str = "text",
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> Dict[str, Any]:
    """Build LLM config for a specific provider."""
    api_key = _get_provider_api_key(provider)
    base_url = _get_provider_base_url(provider)
    model = _get_model_for_provider(provider, model_type)
    
    config: Dict[str, Any] = {
        "api_key": api_key,
        "base_url": base_url,
        "model": model,
    }
    
    if temperature is not None:
        config["temperature"] = temperature
    if max_tokens is not None:
        config["max_tokens"] = max_tokens
        
    return config


def build_llm_config_from_env(
    temperature: float = 0.1,
    max_tokens: int = 4096,
) -> Dict[str, Any]:
    """Build LLM config by auto-detecting provider from environment."""
    provider = _detect_provider()
    if not provider:
        # Fallback to legacy behavior
        return build_default_llm_config()
    
    return {
        "api_key": _get_provider_api_key(provider),
        "base_url": _get_provider_base_url(provider),
        "model": _get_model_for_provider(provider, "text"),
        "temperature": temperature,
        "max_tokens": max_tokens,
    }


def build_vision_config_from_env(
    temperature: float = 0.05,
    max_tokens: int = 4096,
) -> Dict[str, Any]:
    """Build vision model config by auto-detecting provider from environment."""
    provider = _detect_provider()
    if not provider:
        return build_vision_model_config()
    
    return {
        "api_key": _get_provider_api_key(provider),
        "base_url": _get_provider_base_url(provider),
        "model": _get_model_for_provider(provider, "vision"),
        "temperature": temperature,
        "max_tokens": max_tokens,
    }


def build_ocr_config_from_env(
    temperature: float = 0.0,
    max_tokens: int = 4096,
) -> Dict[str, Any]:
    """Build OCR model config by auto-detecting provider from environment."""
    provider = _detect_provider()
    if not provider:
        return build_ocr_model_config()
    
    return {
        "api_key": _get_provider_api_key(provider),
        "base_url": _get_provider_base_url(provider),
        "model": _get_model_for_provider(provider, "ocr"),
        "temperature": temperature,
        "max_tokens": max_tokens,
    }


def build_default_llm_config() -> Dict[str, Any]:
    return {
        "api_key": _text_api_key(),
        "base_url": _text_base_url(),
        "model": _text_model(),
        "temperature": 0.1,
        "max_tokens": 4096,
    }


def build_vision_model_config() -> Dict[str, Any]:
    return {
        "api_key": _vision_api_key(),
        "base_url": _vision_base_url(),
        "model": _vision_model(),
        "temperature": 0.05,
        "max_tokens": 4096,
    }


def build_ocr_model_config() -> Dict[str, Any]:
    return {
        "api_key": _vision_api_key(),
        "base_url": _vision_base_url(),
        "model": _ocr_model(),
        "temperature": 0.0,
        "max_tokens": 4096,
    }


def build_voice_model_config() -> Dict[str, Any]:
    return {
        "api_key": _text_api_key(),
        "base_url": _text_base_url(),
        "model": _text_model(),
        "temperature": 0.05,
    }


# TTS Provider configurations
TTS_PROVIDER_VOICES = {
    "edge": {
        "default": "zh-CN-XiaoxiaoNeural",
        "zh-CN-XiaoxiaoNeural": {"name": "晓晓", "language": "zh-CN", "gender": "female"},
        "zh-CN-YunxiNeural": {"name": "云希", "language": "zh-CN", "gender": "male"},
        "zh-CN-YunjianNeural": {"name": "云健", "language": "zh-CN", "gender": "male"},
        "zh-CN-XiaoyiNeural": {"name": "晓伊", "language": "zh-CN", "gender": "female"},
        "zh-CN-YunyangNeural": {"name": "云扬", "language": "zh-CN", "gender": "male"},
    },
    "openai": {
        "default": "alloy",
        "alloy": {"name": "Alloy", "language": "multilingual", "gender": "neutral"},
        "echo": {"name": "Echo", "language": "multilingual", "gender": "male"},
        "fable": {"name": "Fable", "language": "multilingual", "gender": "female"},
        "onyx": {"name": "Onyx", "language": "multilingual", "gender": "male"},
        "nova": {"name": "Nova", "language": "multilingual", "gender": "female"},
        "shimmer": {"name": "Shimmer", "language": "multilingual", "gender": "female"},
    },
    "azure": {
        "default": "zh-CN-XiaoxiaoNeural",
        "zh-CN-XiaoxiaoNeural": {"name": "晓晓", "language": "zh-CN", "gender": "female"},
        "zh-CN-YunxiNeural": {"name": "云希", "language": "zh-CN", "gender": "male"},
    },
    "doubao": {
        "default": "zh_female_wanwanxiao",
        "zh_female_wanwanxiao": {"name": "弯弯小夕", "language": "zh-CN", "gender": "female"},
        "zh_male_wanqudashu": {"name": "弯区大叔", "language": "zh-CN", "gender": "male"},
        "zh_female_qingxinnvsheng": {"name": "清新女声", "language": "zh-CN", "gender": "female"},
    },
    "minimax": {
        "default": "female-yujie",
        "female-yujie": {"name": "成熟女声", "language": "zh-CN", "gender": "female"},
        "male-qn-jingying": {"name": "精英青年", "language": "zh-CN", "gender": "male"},
        "female-shaonv": {"name": "少女音色", "language": "zh-CN", "gender": "female"},
    },
    "elevenlabs": {
        "default": "EXAVITQu4vr4xnSDxMaL",
        "EXAVITQu4vr4xnSDxMaL": {"name": "Sarah", "language": "en", "gender": "female"},
        "XB0fDUnXU5powFXDhCwa": {"name": "Grace", "language": "en", "gender": "female"},
    },
}

TTS_PROVIDER_ENDPOINTS = {
    "openai": "https://api.openai.com/v1/audio/speech",
    "azure": "https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
    "doubao": "https://openspeech.bytedance.com/api/v1/tts",
    "minimax": "https://api.minimaxi.com/v1/t2a_v2",
    "elevenlabs": "https://api.elevenlabs.io/v1/text-to-speech",
}


def _detect_tts_provider() -> str:
    """Detect TTS provider from environment variables."""
    # Check for explicit TTS provider setting
    tts_provider = os.getenv("TTS_PROVIDER", "").strip().lower()
    if tts_provider and tts_provider in TTS_PROVIDER_VOICES:
        return tts_provider
    
    # Auto-detect based on available API keys
    provider = _detect_provider()
    if provider == "openai" and _read_api_key_from_env_name(OPENAI_API_KEY_ENV_NAMES):
        return "openai"
    if provider == "doubao" and _read_api_key_from_env_name(ARK_API_KEY_ENV_NAMES):
        return "doubao"
    if provider == "minimax" and _read_api_key_from_env_name(MINIMAX_API_KEY_ENV_NAMES):
        return "minimax"
    
    # Default to edge (local)
    return "edge"


def build_tts_config() -> Dict[str, Any]:
    """Build TTS config with provider auto-detection."""
    provider = _detect_tts_provider()
    
    if provider == "edge":
        # Edge TTS (local, free)
        return {
            "provider": "edge",
            "api_key": "",
            "base_url": "",
            "voice": TTS_PROVIDER_VOICES["edge"]["default"],
            "speed": 1.0,
            "pitch": 0,
            "volume": 50,
        }
    
    # Cloud TTS providers
    api_key = ""
    base_url = ""
    
    if provider == "openai":
        api_key = _read_api_key_from_env_name(OPENAI_API_KEY_ENV_NAMES)
        base_url = _read_api_key_from_env_name(OPENAI_BASE_URL_ENV_NAMES) or OPENAI_DEFAULT_BASE_URL
    elif provider == "doubao":
        api_key = _read_api_key_from_env_name(ARK_API_KEY_ENV_NAMES)
        base_url = _read_api_key_from_env_name(ARK_BASE_URL_ENV_NAMES) or ARK_DEFAULT_BASE_URL
    elif provider == "minimax":
        api_key = _read_api_key_from_env_name(MINIMAX_API_KEY_ENV_NAMES)
        base_url = _read_api_key_from_env_name(MINIMAX_BASE_URL_ENV_NAMES) or MINIMAX_DEFAULT_BASE_URL
    elif provider == "elevenlabs":
        api_key = _read_api_key_from_env_name(("ELEVENLABS_API_KEY",))
        base_url = os.getenv("ELEVENLABS_BASE_URL", "https://api.elevenlabs.io/v1")
    elif provider == "azure":
        api_key = os.getenv("AZURE_TTS_API_KEY", "")
        region = os.getenv("AZURE_TTS_REGION", "eastasia")
        base_url = TTS_PROVIDER_ENDPOINTS["azure"].format(region=region)
    
    return {
        "provider": provider,
        "api_key": api_key,
        "base_url": base_url,
        "voice": TTS_PROVIDER_VOICES.get(provider, {}).get("default", "zh-CN-XiaoxiaoNeural"),
        "speed": 1.0,
        "pitch": 0,
        "volume": 50,
    }


def get_tts_provider_config(provider: str) -> Dict[str, Any]:
    """Get TTS configuration for a specific provider."""
    if provider == "edge":
        return build_tts_config()
    
    api_key = ""
    base_url = ""
    
    if provider == "openai":
        api_key = _read_api_key_from_env_name(OPENAI_API_KEY_ENV_NAMES)
        base_url = _read_api_key_from_env_name(OPENAI_BASE_URL_ENV_NAMES) or OPENAI_DEFAULT_BASE_URL
    elif provider == "doubao":
        api_key = _read_api_key_from_env_name(ARK_API_KEY_ENV_NAMES)
        base_url = _read_api_key_from_env_name(ARK_BASE_URL_ENV_NAMES) or ARK_DEFAULT_BASE_URL
    elif provider == "minimax":
        api_key = _read_api_key_from_env_name(MINIMAX_API_KEY_ENV_NAMES)
        base_url = _read_api_key_from_env_name(MINIMAX_BASE_URL_ENV_NAMES) or MINIMAX_DEFAULT_BASE_URL
    elif provider == "elevenlabs":
        api_key = _read_api_key_from_env_name(("ELEVENLABS_API_KEY",))
        base_url = os.getenv("ELEVENLABS_BASE_URL", "https://api.elevenlabs.io/v1")
    elif provider == "azure":
        api_key = os.getenv("AZURE_TTS_API_KEY", "")
        region = os.getenv("AZURE_TTS_REGION", "eastasia")
        base_url = TTS_PROVIDER_ENDPOINTS["azure"].format(region=region)
    
    return {
        "provider": provider,
        "api_key": api_key,
        "base_url": base_url,
        "voice": TTS_PROVIDER_VOICES.get(provider, {}).get("default", "zh-CN-XiaoxiaoNeural"),
        "speed": 1.0,
        "pitch": 0,
        "volume": 50,
    }


DEFAULT_LLM_CONFIG = build_default_llm_config()
VISION_MODEL_CONFIG = build_vision_model_config()
OCR_MODEL_CONFIG = build_ocr_model_config()
VOICE_MODEL_CONFIG = build_voice_model_config()
TTS_CONFIG = build_tts_config()

VIDEO_CONFIG = {
    "output_dir": str(DEFAULT_OUTPUT_DIR),
    "resolution": "1920x1080",
    "fps": 60,
    "format": "mp4",
}

MANIM_CANVAS_CONFIG = {
    "frame_height": 8.0,
    "frame_width": 14.222,
    "pixel_height": 1080,
    "pixel_width": 1920,
    "safe_margin": 0.4,
    "left_panel_x_max": 0.75,
    "right_panel_x_min": 1.8,
    "formula_max_visible_slots": 8,
    "formula_math_font_size": 24,
    "formula_text_font_size": 24,
}

AGENT_CONFIGS: Dict[str, Dict[str, Any]] = {
    "script": {
        "temperature": 0.1,
        "max_tokens": 4096,
        "system_prompt_file": "prompts/script_agent.txt",
    },
    "animation": {
        "temperature": 0.05,
        "max_tokens": 16384,
        "system_prompt_file": "prompts/animation_agent.txt",
        "canvas_config": MANIM_CANVAS_CONFIG,
        "layout": "left_graph_right_formula",
        "use_template_retrieval": True,
        "template_retrieval_top_k": 3,
        "template_retrieval_mode": "component",
        "template_retrieval_allow_full_scene_fallback": True,
        "export_incremental_codegen_debug": False,
    },
    "voice": {
        "temperature": 0.05,
        "max_tokens": 2048,
        "system_prompt_file": "prompts/voice_agent.txt",
        "tts_config": TTS_CONFIG,
        "tts_concurrency": 3,
        "narration_optimization_concurrency": 3,
    },
    "merge": {
        "temperature": 0.05,
        "max_tokens": 1024,
        "system_prompt_file": "prompts/merge_agent.txt",
    },
    "repair": {
        "temperature": 0.0,
        "max_tokens": 2048,
        "use_llm_repair": False,
    },
    "coordinator": {
        "temperature": 0.1,
        "max_tokens": 2048,
        "system_prompt_file": "prompts/coordinator.txt",
    },
}
