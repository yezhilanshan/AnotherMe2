"""
Provider Capabilities
=====================

Centralized provider capability fallbacks for LLM calls.
Model-specific runtime choices belong in ``model_catalog.json``; helpers below
consult that catalog before using these provider defaults.

Usage:
    from tutor_engine.services.llm.capabilities import get_capability, supports_response_format

    # Check if a provider supports response_format
    if supports_response_format(binding, model):
        kwargs["response_format"] = {"type": "json_object"}

    # Generic capability check
    if get_capability(binding, "streaming", default=True):
        # use streaming
"""

# Provider capabilities configuration
# Keys are binding names (lowercase), values are capability dictionaries
PROVIDER_CAPABILITIES: dict[str, dict[str, object]] = {
    # OpenAI and OpenAI-compatible providers
    "openai": {
        "supports_response_format": True,
        "supports_streaming": True,
        "supports_tools": True,
        "supports_vision": True,
        "system_in_messages": True,  # System prompt goes in messages array
        "newer_models_use_max_completion_tokens": True,
    },
    "azure_openai": {
        "supports_response_format": True,
        "supports_streaming": True,
        "supports_tools": True,
        "supports_vision": True,
        "system_in_messages": True,
        "newer_models_use_max_completion_tokens": True,
        "requires_api_version": True,
    },
    # Anthropic
    "anthropic": {
        "supports_response_format": False,  # Anthropic uses different format
        "supports_streaming": True,
        "supports_tools": True,
        "supports_vision": True,
        "system_in_messages": False,  # System is a separate parameter
        "has_thinking_tags": False,
    },
    "claude": {  # Alias for anthropic
        "supports_response_format": False,
        "supports_streaming": True,
        "supports_tools": True,
        "supports_vision": True,
        "system_in_messages": False,
        "has_thinking_tags": False,
    },
    # DeepSeek
    "deepseek": {
        "supports_response_format": False,  # DeepSeek doesn't support strict JSON schema yet
        "supports_streaming": True,
        "supports_tools": True,
        "supports_vision": False,
        "system_in_messages": True,
        "has_thinking_tags": True,  # DeepSeek reasoner has thinking tags
    },
    # OpenRouter (aggregator, generally OpenAI-compatible)
    "openrouter": {
        "supports_response_format": True,  # Depends on underlying model
        "supports_streaming": True,
        "supports_tools": True,
        "supports_vision": True,  # Depends on underlying model
        "system_in_messages": True,
    },
    # Groq (fast inference)
    "groq": {
        "supports_response_format": True,
        "supports_streaming": True,
        "supports_tools": True,
        "supports_vision": True,
        "system_in_messages": True,
    },
    # Together AI
    "together": {
        "supports_response_format": True,
        "supports_streaming": True,
        "supports_tools": True,
        "supports_vision": True,
        "system_in_messages": True,
    },
    "together_ai": {  # Alias
        "supports_response_format": True,
        "supports_streaming": True,
        "supports_tools": True,
        "supports_vision": True,
        "system_in_messages": True,
    },
    # Mistral
    "mistral": {
        "supports_response_format": True,
        "supports_streaming": True,
        "supports_tools": True,
        "supports_vision": True,
        "system_in_messages": True,
    },
    # Local providers (generally OpenAI-compatible)
    "ollama": {
        "supports_response_format": True,  # Ollama supports JSON mode
        "supports_streaming": True,
        "supports_tools": False,  # Limited tool support
        "supports_vision": False,  # Depends on model; set True via model overrides
        "system_in_messages": True,
    },
    "lm_studio": {
        "supports_response_format": True,
        "supports_streaming": True,
        "supports_tools": False,
        "supports_vision": False,
        "system_in_messages": True,
    },
    "vllm": {
        "supports_response_format": True,
        "supports_streaming": True,
        "supports_tools": False,
        "supports_vision": False,
        "system_in_messages": True,
    },
    "llama_cpp": {
        "supports_response_format": True,  # llama.cpp server supports JSON grammar
        "supports_streaming": True,
        "supports_tools": False,
        "supports_vision": False,
        "system_in_messages": True,
    },
}

# Default capabilities for unknown providers (assume OpenAI-compatible)
DEFAULT_CAPABILITIES: dict[str, object] = {
    "supports_response_format": True,
    "supports_streaming": True,
    "supports_tools": False,
    "supports_vision": False,
    "system_in_messages": True,
    "has_thinking_tags": False,
    "forced_temperature": None,  # None means no forced value, use requested temperature
}

# Model-family behavior that is intrinsic to API handling rather than a
# selectable model option. Runtime model choices and vision support should be
# configured in model_catalog.json.
MODEL_OVERRIDES: dict[str, dict[str, object]] = {
    "deepseek": {
        "supports_response_format": False,
        "has_thinking_tags": True,
    },
    "deepseek-reasoner": {
        "supports_response_format": False,
        "has_thinking_tags": True,
    },
    "qwen": {
        "has_thinking_tags": True,
    },
    "qwq": {
        "has_thinking_tags": True,
    },
    "minimax": {
        "supports_response_format": False,
    },
    # NOTE: supports_response_format and system_in_messages are binding-level
    # capabilities, NOT model-level. When using OpenRouter or other OpenAI-compatible
    # proxies (binding="openai"), they handle response_format translation and expect
    # system prompts in messages. The native Anthropic limitations are already
    # handled by PROVIDER_CAPABILITIES["anthropic"] / ["claude"] above.
    # Only model-intrinsic capabilities (like has_thinking_tags) belong here.
    # Reasoning models - only support temperature=1.0
    # See: https://github.com/HKUDS/Tutor Engine/issues/141
    "gpt-5": {
        "forced_temperature": 1.0,
    },
    "o1": {
        "forced_temperature": 1.0,
    },
    "o3": {
        "forced_temperature": 1.0,
    },
    "gemma": {"supports_response_format": False},
}


def _as_bool(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    return None


def _model_catalog_capability(model: str | None, capability: str) -> bool | None:
    if not model:
        return None
    model_key = model.strip().lower()

    try:
        from tutor_engine.services.config.model_catalog import get_model_catalog_service

        service = get_model_catalog_service()
        catalog = service.load()

        models: list[dict] = []
        active = service.get_active_model(catalog, "llm")
        if isinstance(active, dict):
            models.append(active)
        for profile in catalog.get("services", {}).get("llm", {}).get("profiles", []):
            for item in profile.get("models", []):
                if isinstance(item, dict):
                    models.append(item)
        for item in models:
            configured = str(item.get("model") or item.get("id") or "").strip().lower()
            if configured != model_key:
                continue
            direct_value = _as_bool(item.get(capability))
            if direct_value is not None:
                return direct_value
            capabilities = item.get("capabilities")
            if isinstance(capabilities, dict):
                nested_value = _as_bool(capabilities.get(capability))
                if nested_value is not None:
                    return nested_value
                if capability == "supports_vision":
                    vision_value = _as_bool(capabilities.get("vision"))
                    if vision_value is not None:
                        return vision_value
    except Exception:
        pass

    # 第二优先级（fallback）：网关的 mobile/config/models.json
    # 确保 LLM 层与网关使用同一份权威模型能力目录。
    try:
        import json
        from pathlib import Path

        current = Path(__file__).resolve()
        for parent in current.parents:
            candidate = parent / "mobile" / "config" / "models.json"
            if candidate.exists():
                mobile_config = json.loads(candidate.read_text(encoding="utf-8"))
                mobile_models = mobile_config.get("models", [])
                for item in mobile_models:
                    item_id = str(item.get("id", "")).strip().lower()
                    if item_id != model_key:
                        continue
                    if capability == "supports_vision":
                        return bool(item.get("supportsVision"))
                    if capability == "supports_tools":
                        return bool(item.get("supportsTools"))
                break
    except Exception:
        pass

    return None


def get_capability(
    binding: str,
    capability: str,
    model: str | None = None,
    default: object = None,
) -> object:
    """
    Get a capability value for a provider/model combination.

    Checks in order:
    1. Model-specific overrides (matched by prefix)
    2. Provider/binding capabilities
    3. Default capabilities for unknown providers
    4. Explicit default value

    Args:
        binding: Provider binding name (e.g., "openai", "anthropic", "deepseek")
        capability: Capability name (e.g., "supports_response_format")
        model: Optional model name for model-specific overrides
        default: Default value if capability is not defined

    Returns:
        Capability value or default
    """
    binding_lower = (binding or "openai").lower()

    catalog_value = _model_catalog_capability(model, capability)
    if catalog_value is not None:
        return catalog_value

    # 1. Check model-family overrides first
    if model:
        model_lower = model.lower()
        # Sort by pattern length descending to match most specific first
        for pattern, overrides in sorted(
            MODEL_OVERRIDES.items(), key=lambda x: -len(x[0])
        ):
            if model_lower.startswith(pattern):
                if capability in overrides:
                    return overrides[capability]

    # 2. Check provider capabilities
    provider_caps = PROVIDER_CAPABILITIES.get(binding_lower, {})
    if capability in provider_caps:
        return provider_caps[capability]

    # 3. Check default capabilities for unknown providers
    if capability in DEFAULT_CAPABILITIES:
        return DEFAULT_CAPABILITIES[capability]

    # 4. Return explicit default
    return default


# Runtime cache for response_format incompatibilities discovered at request time.
# Keyed by (binding_lower, model_lower). Populated when a provider rejects a
# request with response_format={"type": "json_object"} (commonly LM Studio /
# Ollama serving Gemma/Qwen-style models that only accept "json_schema" or "text").
# Once a pair is recorded here, subsequent calls skip response_format entirely
# instead of paying the cost of a failed request + retry.
_RUNTIME_DISABLED_RESPONSE_FORMAT: set[tuple[str, str]] = set()


def disable_response_format_at_runtime(binding: str | None, model: str | None) -> None:
    """Mark a (binding, model) pair as not supporting ``response_format``.

    Subsequent calls to :func:`supports_response_format` for the same pair
    will return ``False`` without re-checking the static configuration. This
    is useful when a provider unexpectedly rejects ``response_format`` at
    runtime (e.g. LM Studio + ``gemma-4-e2b`` returning
    ``"'response_format.type' must be 'json_schema' or 'text'"``).
    """
    if not binding or not model:
        return
    _RUNTIME_DISABLED_RESPONSE_FORMAT.add((binding.lower(), model.lower()))


def is_response_format_disabled_at_runtime(
    binding: str | None, model: str | None
) -> bool:
    """Return True if (binding, model) was disabled via :func:`disable_response_format_at_runtime`."""
    if not binding or not model:
        return False
    return (binding.lower(), model.lower()) in _RUNTIME_DISABLED_RESPONSE_FORMAT


def supports_response_format(binding: str, model: str | None = None) -> bool:
    """
    Check if the provider/model supports response_format parameter.

    This is a convenience function for the most common capability check.
    A runtime override (set via :func:`disable_response_format_at_runtime`)
    always wins over static capability configuration.

    Args:
        binding: Provider binding name
        model: Optional model name for model-specific overrides

    Returns:
        True if response_format is supported
    """
    if is_response_format_disabled_at_runtime(binding, model):
        return False
    value = get_capability(binding, "supports_response_format", model, default=True)
    return bool(value)


def supports_streaming(binding: str, model: str | None = None) -> bool:
    """
    Check if the provider/model supports streaming responses.

    Args:
        binding: Provider binding name
        model: Optional model name

    Returns:
        True if streaming is supported
    """
    value = get_capability(binding, "supports_streaming", model, default=True)
    return bool(value)


def system_in_messages(binding: str, model: str | None = None) -> bool:
    """
    Check if system prompt should be in messages array (OpenAI style)
    or as a separate parameter (Anthropic style).

    Args:
        binding: Provider binding name
        model: Optional model name

    Returns:
        True if system prompt goes in messages array
    """
    value = get_capability(binding, "system_in_messages", model, default=True)
    return bool(value)


def has_thinking_tags(binding: str, model: str | None = None) -> bool:
    """
    Check if the model output may contain thinking tags (<think>...</think>).

    Args:
        binding: Provider binding name
        model: Optional model name

    Returns:
        True if thinking tags should be filtered
    """
    value = get_capability(binding, "has_thinking_tags", model, default=False)
    return bool(value)


def supports_tools(binding: str, model: str | None = None) -> bool:
    """
    Check if the provider/model supports function calling / tools.

    Args:
        binding: Provider binding name
        model: Optional model name

    Returns:
        True if tools/function calling is supported
    """
    value = get_capability(binding, "supports_tools", model, default=False)
    return bool(value)


def supports_vision(binding: str, model: str | None = None) -> bool:
    """
    Check if the provider/model supports multimodal (image) input.

    Args:
        binding: Provider binding name
        model: Optional model name for model-specific overrides

    Returns:
        True if the model can accept image content in messages
    """
    value = get_capability(binding, "supports_vision", model, default=False)
    return bool(value)


def requires_api_version(binding: str, model: str | None = None) -> bool:
    """
    Check if the provider requires an API version parameter (e.g., Azure OpenAI).

    Args:
        binding: Provider binding name
        model: Optional model name

    Returns:
        True if api_version is required
    """
    value = get_capability(binding, "requires_api_version", model, default=False)
    return bool(value)


def get_effective_temperature(
    binding: str,
    model: str | None = None,
    requested_temp: float = 0.7,
) -> float:
    """
    Get the effective temperature value for a model.

    Some models (e.g., o1, o3, gpt-5) only support a fixed temperature value (1.0).
    This function returns the forced temperature if defined, otherwise the requested value.

    Args:
        binding: Provider binding name
        model: Optional model name for model-specific overrides
        requested_temp: The temperature value requested by the caller (default: 0.7)

    Returns:
        The effective temperature to use for the API call
    """
    forced_temp = get_capability(binding, "forced_temperature", model)
    if isinstance(forced_temp, (int, float)):
        return float(forced_temp)
    return requested_temp


__all__ = [
    "PROVIDER_CAPABILITIES",
    "MODEL_OVERRIDES",
    "DEFAULT_CAPABILITIES",
    "get_capability",
    "supports_response_format",
    "supports_streaming",
    "system_in_messages",
    "has_thinking_tags",
    "supports_tools",
    "supports_vision",
    "requires_api_version",
    "get_effective_temperature",
    "disable_response_format_at_runtime",
    "is_response_format_disabled_at_runtime",
]
