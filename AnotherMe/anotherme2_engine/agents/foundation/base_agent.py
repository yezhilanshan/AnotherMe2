"""
Base agent utilities shared across the workflow.
"""

import time
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

from langchain_core.messages import HumanMessage, SystemMessage


class BaseAgent(ABC):
    """Base class for all agents."""

    def __init__(self, config: Dict[str, Any], llm: Optional[Any] = None):
        self.config = config
        self.llm = llm
        self.max_retries = int(config.get("max_retries", 3))
        self.retry_backoff_seconds = float(config.get("retry_backoff_seconds", 2.0))

    @abstractmethod
    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Process and return updated state."""

    def _format_messages(
        self,
        system_prompt: str,
        user_prompt: str,
        image_path: Optional[str] = None,
    ) -> list:
        messages = [SystemMessage(content=system_prompt)]
        if image_path:
            content = [
                {"type": "text", "text": user_prompt},
                {"type": "image_url", "image_url": {"url": f"file://{image_path}"}},
            ]
            messages.append(HumanMessage(content=content))
        else:
            messages.append(HumanMessage(content=user_prompt))
        return messages

    def _invoke_llm(self, messages: list) -> str:
        if self.llm is None:
            raise RuntimeError("LLM is not configured.")

        last_error: Optional[Exception] = None
        attempts = max(self.max_retries, 1)
        for attempt in range(attempts):
            try:
                response = self.llm.invoke(messages)
                content = response.content
                if not content:
                    # Some models (e.g. qwen3.5-plus thinking models) put the
                    # actual response in additional_kwargs instead of content.
                    content = self._extract_content_from_response(response)
                    # If model refused, do NOT retry — refusal is not transient.
                    if not content and self._is_response_refusal(response):
                        return ""
                return content
            except Exception as exc:
                last_error = exc
                if not self._is_retryable_llm_error(exc) or attempt >= attempts - 1:
                    raise
                sleep_seconds = self.retry_backoff_seconds * (2**attempt)
                print(
                    f"[{self.__class__.__name__}] LLM request hit a temporary limit; "
                    f"retrying in {sleep_seconds:.1f}s ({attempt + 1}/{attempts})"
                )
                time.sleep(sleep_seconds)

        if last_error is not None:
            raise last_error
        raise RuntimeError("LLM invocation failed without an exception.")

    def _is_response_refusal(self, response: Any) -> bool:
        """Check whether an LLM response is a refusal (model declined to answer)."""
        additional = getattr(response, "additional_kwargs", None) or {}
        if isinstance(additional, dict):
            refusal = additional.get("refusal")
            if refusal and isinstance(refusal, str) and refusal.strip():
                return True
        # Also check finish_reason for content_filter
        finish_reason = ""
        metadata = getattr(response, "response_metadata", None) or {}
        if isinstance(metadata, dict):
            finish_reason = str(metadata.get("finish_reason", "")).lower()
            if finish_reason in ("content_filter",):
                return True
            choices = metadata.get("choices") or metadata.get("output", {}).get(
                "choices", []
            )
            if isinstance(choices, list) and choices:
                msg = choices[0].get("message", {})
                if msg.get("refusal"):
                    return True
        return False

    def _extract_content_from_response(self, response: Any) -> str:
        """Extract content from LLM response, handling models that put
        output in non-standard locations (e.g. thinking models).

        Also detects refusal responses (model declined to answer due to
        content policy, unsupported modality, or missing model access).
        """
        # Prefer final answer channels. Reasoning/thinking fields are internal
        # traces and must not be treated as user-facing content by default.
        additional = getattr(response, "additional_kwargs", None) or {}
        metadata = getattr(response, "response_metadata", None) or {}

        if isinstance(additional, dict):
            # Check for refusal first — model actively declined to generate.
            # Common causes: unsupported modality (sending image to text-only
            # model), content safety filter, or no access to the requested model.
            refusal = additional.get("refusal")
            if refusal and isinstance(refusal, str) and refusal.strip():
                model_name = ""
                if isinstance(metadata, dict):
                    model_name = metadata.get("model_name", "")
                print(
                    f"[{self.__class__.__name__}] Model refused to answer"
                    + (f" (model={model_name})" if model_name else "")
                    + f": {refusal}"
                )
                # Return empty string — caller should handle gracefully.
                # Do NOT retry: refusal is not a transient error.
                return ""

            for key in ("content", "final", "answer", "output_text"):
                val = additional.get(key)
                if val and isinstance(val, str) and val.strip():
                    return val

        # Try response_metadata for full response data
        if isinstance(metadata, dict):
            choices = metadata.get("choices") or metadata.get("output", {}).get(
                "choices", []
            )
            if isinstance(choices, list) and choices:
                msg = choices[0].get("message", {})
                for key in ("content",):
                    val = msg.get(key)
                    if val and isinstance(val, str) and val.strip():
                        return val

                # Also check for refusal in metadata-level message
                refusal = msg.get("refusal")
                if refusal and isinstance(refusal, str) and refusal.strip():
                    model_name = metadata.get("model_name", "")
                    print(
                        f"[{self.__class__.__name__}] Model refused to answer"
                        + (f" (model={model_name})" if model_name else "")
                        + f": {refusal}"
                    )
                    return ""

        # Try the 'text' attribute (some LangChain variants use this)
        text_attr = getattr(response, "text", None)
        if text_attr and isinstance(text_attr, str) and text_attr.strip():
            return text_attr

        if bool(self.config.get("allow_reasoning_content_fallback", False)):
            for source in (additional,):
                if not isinstance(source, dict):
                    continue
                for key in ("reasoning_content", "thinking", "thought"):
                    val = source.get(key)
                    if val and isinstance(val, str) and val.strip():
                        print(
                            f"[{self.__class__.__name__}] WARNING: using internal "
                            f"{key} as content because allow_reasoning_content_fallback=True"
                        )
                        return val
            if isinstance(metadata, dict):
                choices = metadata.get("choices") or metadata.get("output", {}).get(
                    "choices", []
                )
                if isinstance(choices, list) and choices:
                    msg = choices[0].get("message", {})
                    for key in ("reasoning_content", "thinking"):
                        val = msg.get(key)
                        if val and isinstance(val, str) and val.strip():
                            print(
                                f"[{self.__class__.__name__}] WARNING: using internal "
                                f"{key} as content because allow_reasoning_content_fallback=True"
                            )
                            return val

        # Collect diagnostic info for the warning
        finish_reason = ""
        if isinstance(metadata, dict):
            finish_reason = str(metadata.get("finish_reason", ""))
        print(
            f"[{self.__class__.__name__}] WARNING: LLM returned empty content."
            + (f" finish_reason={finish_reason}" if finish_reason else "")
            + f" additional_kwargs keys={list(additional.keys()) if additional else 'N/A'}"
            + f" response_metadata keys={list(metadata.keys()) if metadata else 'N/A'}"
        )
        return ""

    def _is_retryable_llm_error(self, exc: Exception) -> bool:
        status_code = getattr(exc, "status_code", None)
        if status_code in {408, 409, 429, 500, 502, 503, 504}:
            return True

        error_text = f"{exc.__class__.__name__}: {exc}".lower()
        retry_markers = [
            "ratelimit",
            "rate limit",
            "toomanyrequests",
            "too many requests",
            "429",
            "temporarily unavailable",
            "timeout",
            "timed out",
            "connection reset",
            "server error",
            "service unavailable",
        ]
        return any(marker in error_text for marker in retry_markers)
