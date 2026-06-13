"""Media generation endpoints: image, video, TTS, transcription.

Delegates to external provider APIs. API keys are resolved from environment variables.
"""

from __future__ import annotations

import base64
import os
from typing import Optional

import httpx
from fastapi import APIRouter, Header, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from ..config import Settings
from .auth import require_token


# ── Request Models ───────────────────────────────────────────────────────────


class ImageGenerationRequest(BaseModel):
    prompt: str
    negative_prompt: Optional[str] = None
    width: int = 1024
    height: int = 1024
    aspect_ratio: Optional[str] = None
    style: Optional[str] = None


class VideoGenerationRequest(BaseModel):
    prompt: str
    duration: int = 5
    aspect_ratio: str = "16:9"
    resolution: str = "720p"


class TTSRequest(BaseModel):
    text: str
    audio_id: str
    tts_provider_id: str = "openai-tts"
    tts_voice: str = "alloy"
    tts_model_id: Optional[str] = None
    tts_speed: float = 1.0
    tts_api_key: Optional[str] = None
    tts_base_url: Optional[str] = None


# ── Aspect Ratio → Dimensions ────────────────────────────────────────────────

ASPECT_RATIO_MAP = {
    "16:9": (1344, 768),
    "9:16": (768, 1344),
    "4:3": (1152, 896),
    "3:4": (896, 1152),
    "1:1": (1024, 1024),
}


def _resolve_dimensions(width: int, height: int, aspect_ratio: Optional[str]) -> tuple[int, int]:
    if width and height:
        return width, height
    if aspect_ratio and aspect_ratio in ASPECT_RATIO_MAP:
        return ASPECT_RATIO_MAP[aspect_ratio]
    return 1024, 1024


# ── Provider: Seedream (火山引擎) ────────────────────────────────────────────


async def _generate_seedream(api_key: str, base_url: str, model: str, prompt: str,
                              width: int, height: int, negative_prompt: str = "") -> dict:
    """Generate image via Seedream (Volcengine Ark) API."""
    url = f"{base_url}/api/v3/images/generations"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": model,
        "prompt": prompt,
        "size": f"{width}x{height}",
        "response_format": "b64_json",
    }
    if negative_prompt:
        body["negative_prompt"] = negative_prompt

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(url, headers=headers, json=body)
        resp.raise_for_status()
        data = resp.json()

    b64 = data.get("data", [{}])[0].get("b64_json", "")
    return {
        "base64": b64,
        "format": "png",
        "width": width,
        "height": height,
    }


# ── Provider: Qwen Image (阿里通义) ─────────────────────────────────────────


async def _generate_qwen_image(api_key: str, base_url: str, model: str, prompt: str,
                                width: int, height: int) -> dict:
    """Generate image via Qwen Image (DashScope) API."""
    url = f"{base_url}/api/v1/services/aigc/text2image/image-synthesis"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
    }
    body = {
        "model": model,
        "input": {"prompt": prompt},
        "parameters": {"size": f"{width}*{height}", "n": 1},
    }

    async with httpx.AsyncClient(timeout=120) as client:
        # Submit task
        resp = await client.post(url, headers=headers, json=body)
        resp.raise_for_status()
        task_data = resp.json()
        task_id = task_data.get("output", {}).get("task_id", "")

        if not task_id:
            raise Exception(f"No task_id returned: {task_data}")

        # Poll for result
        poll_url = f"{base_url}/api/v1/tasks/{task_id}"
        for _ in range(60):
            import asyncio
            await asyncio.sleep(2)
            poll_resp = await client.get(poll_url, headers={"Authorization": f"Bearer {api_key}"})
            poll_data = poll_resp.json()
            status = poll_data.get("output", {}).get("task_status", "")
            if status == "SUCCEEDED":
                results = poll_data.get("output", {}).get("results", [])
                if results:
                    img_url = results[0].get("url", "")
                    # Download the image and convert to base64
                    img_resp = await client.get(img_url)
                    return {
                        "base64": base64.b64encode(img_resp.content).decode(),
                        "format": "png",
                        "width": width,
                        "height": height,
                    }
                break
            elif status == "FAILED":
                raise Exception(f"Task failed: {poll_data}")

    raise Exception("Image generation timed out")


# ── Provider: OpenAI TTS ────────────────────────────────────────────────────


async def _generate_openai_tts(api_key: str, base_url: str, model: str, voice: str,
                                text: str, speed: float) -> tuple[bytes, str]:
    """Generate TTS audio via OpenAI-compatible API."""
    url = f"{base_url}/v1/audio/speech"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": model or "tts-1",
        "input": text,
        "voice": voice,
        "speed": speed,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, headers=headers, json=body)
        resp.raise_for_status()
        return resp.content, "mp3"


# ── Provider: Azure TTS ─────────────────────────────────────────────────────


async def _generate_azure_tts(api_key: str, base_url: str, voice: str,
                               text: str, speed: float) -> tuple[bytes, str]:
    """Generate TTS audio via Azure Cognitive Services."""
    # Azure TTS uses SSML
    rate_pct = int((speed - 1.0) * 100)
    rate_str = f"{rate_pct:+d}%" if rate_pct != 0 else "+0%"

    ssml = f"""<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>
    <voice name='{voice}'>
        <prosody rate='{rate_str}'>{text}</prosody>
    </voice>
</speak>"""

    url = f"{base_url}/cognitiveservices/v1"
    headers = {
        "Ocp-Apim-Subscription-Key": api_key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, headers=headers, content=ssml.encode("utf-8"))
        resp.raise_for_status()
        return resp.content, "mp3"


# ── Provider: MiniMax TTS ───────────────────────────────────────────────────


async def _generate_minimax_tts(api_key: str, base_url: str, model: str, voice: str,
                                 text: str, speed: float) -> tuple[bytes, str]:
    """Generate TTS audio via MiniMax API."""
    url = f"{base_url}/v1/t2a_v2"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": model or "speech-01-turbo",
        "text": text,
        "voice_setting": {
            "voice_id": voice,
            "speed": speed,
        },
        "audio_setting": {
            "format": "mp3",
        },
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, headers=headers, json=body)
        resp.raise_for_status()
        data = resp.json()

    audio_hex = data.get("data", {}).get("audio", "")
    if audio_hex:
        return bytes.fromhex(audio_hex), "mp3"

    # Some MiniMax versions return base64
    audio_b64 = data.get("audio", "")
    if audio_b64:
        return base64.b64decode(audio_b64), "mp3"

    raise Exception(f"No audio data in MiniMax response: {list(data.keys())}")


# ── TTS Provider Router ─────────────────────────────────────────────────────

TTS_PROVIDER_MAP = {
    "openai-tts": ("TTS_OPENAI_API_KEY", "TTS_OPENAI_BASE_URL", _generate_openai_tts),
    "azure-tts": ("TTS_AZURE_API_KEY", "TTS_AZURE_BASE_URL", _generate_azure_tts),
    "glm-tts": ("TTS_GLM_API_KEY", "TTS_GLM_BASE_URL", _generate_openai_tts),
    "qwen-tts": ("TTS_QWEN_API_KEY", "TTS_QWEN_BASE_URL", _generate_openai_tts),
    "doubao-tts": ("TTS_DOUBAO_API_KEY", "TTS_DOUBAO_BASE_URL", _generate_openai_tts),
    "minimax-tts": ("TTS_MINIMAX_API_KEY", "TTS_MINIMAX_BASE_URL", _generate_minimax_tts),
    "elevenlabs-tts": ("TTS_ELEVENLABS_API_KEY", "TTS_ELEVENLABS_BASE_URL", None),
}


# ── Router Factory ───────────────────────────────────────────────────────────


def create_media_router(settings: Settings) -> APIRouter:
    router = APIRouter(tags=["media"])

    @router.post("/v1/generate/image")
    async def generate_image(
        body: ImageGenerationRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_token(settings, authorization)

        if not body.prompt:
            raise HTTPException(400, detail={"error_code": "MISSING_FIELD", "message": "prompt is required"})

        provider_id = request.headers.get("x-image-provider", "seedream")
        client_api_key = request.headers.get("x-api-key", "")
        client_base_url = request.headers.get("x-base-url", "")
        client_model = request.headers.get("x-image-model", "")

        width, height = _resolve_dimensions(body.width, body.height, body.aspect_ratio)

        # Resolve API key
        env_key_map = {
            "seedream": ("IMAGE_SEEDREAM_API_KEY", "IMAGE_SEEDREAM_BASE_URL", "https://ark.cn-beijing.volces.com"),
            "qwen-image": ("IMAGE_QWEN_IMAGE_API_KEY", "IMAGE_QWEN_IMAGE_BASE_URL", "https://dashscope.aliyuncs.com"),
            "nano-banana": ("IMAGE_NANO_BANANA_API_KEY", "IMAGE_NANO_BANANA_BASE_URL", "https://generativelanguage.googleapis.com"),
            "minimax-image": ("IMAGE_MINIMAX_API_KEY", "IMAGE_MINIMAX_BASE_URL", "https://api.minimaxi.com"),
            "grok-image": ("IMAGE_GROK_API_KEY", "IMAGE_GROK_BASE_URL", "https://api.x.ai/v1"),
            "liblib-image": ("IMAGE_LIBLIB_API_KEY", "IMAGE_LIBLIB_BASE_URL", ""),
        }

        if provider_id not in env_key_map:
            raise HTTPException(400, detail={"error_code": "UNSUPPORTED_PROVIDER", "message": f"Unknown image provider: {provider_id}"})

        env_key, env_base_key, default_base = env_key_map[provider_id]
        api_key = client_api_key or os.getenv(env_key, "")
        base_url = client_base_url or os.getenv(env_base_key, "") or default_base

        if not api_key:
            raise HTTPException(401, detail={"error_code": "MISSING_API_KEY", "message": f"No API key for {provider_id}"})

        model = client_model or ""

        try:
            if provider_id == "seedream":
                result = await _generate_seedream(api_key, base_url, model or "doubao-seedream-3-0-t2i-250415",
                                                   body.prompt, width, height, body.negative_prompt or "")
            elif provider_id == "qwen-image":
                result = await _generate_qwen_image(api_key, base_url, model or "qwen-image-max",
                                                     body.prompt, width, height)
            else:
                # Generic OpenAI-compatible image API
                result = await _generate_seedream(api_key, base_url, model or "default",
                                                   body.prompt, width, height, body.negative_prompt or "")

            return {"success": True, "result": result}
        except httpx.HTTPStatusError as e:
            msg = f"Provider API error ({e.response.status_code}): {e.response.text[:200]}"
            if "SensitiveContent" in str(e.response.text):
                raise HTTPException(400, detail={"error_code": "CONTENT_SENSITIVE", "message": msg})
            raise HTTPException(502, detail={"error_code": "PROVIDER_ERROR", "message": msg})
        except Exception as e:
            raise HTTPException(500, detail={"error_code": "GENERATION_FAILED", "message": str(e)})

    @router.post("/v1/generate/tts")
    async def generate_tts(
        body: TTSRequest,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_token(settings, authorization)

        if not body.text or not body.audio_id or not body.tts_voice:
            raise HTTPException(400, detail={
                "error_code": "MISSING_FIELD",
                "message": "text, audio_id, and tts_voice are required",
            })

        if body.tts_provider_id == "browser-native-tts":
            raise HTTPException(400, detail={
                "error_code": "INVALID_REQUEST",
                "message": "browser-native-tts must be handled client-side",
            })

        provider_config = TTS_PROVIDER_MAP.get(body.tts_provider_id)
        if not provider_config:
            raise HTTPException(400, detail={
                "error_code": "UNSUPPORTED_PROVIDER",
                "message": f"Unknown TTS provider: {body.tts_provider_id}",
            })

        env_key, env_base_key, generator = provider_config
        if not generator:
            raise HTTPException(400, detail={
                "error_code": "UNSUPPORTED_PROVIDER",
                "message": f"TTS provider {body.tts_provider_id} not supported on server",
            })

        api_key = body.tts_api_key or os.getenv(env_key, "")
        base_url = body.tts_base_url or os.getenv(env_base_key, "") or ""

        if not api_key:
            raise HTTPException(401, detail={
                "error_code": "MISSING_API_KEY",
                "message": f"No API key for {body.tts_provider_id}",
            })

        if not base_url:
            # Default base URLs
            defaults = {
                "openai-tts": "https://api.openai.com",
                "azure-tts": "",
                "glm-tts": "https://open.bigmodel.cn",
                "qwen-tts": "https://dashscope.aliyuncs.com",
                "doubao-tts": "https://openspeech.bytedance.com",
                "minimax-tts": "https://api.minimaxi.com",
            }
            base_url = defaults.get(body.tts_provider_id, "")

        try:
            audio_bytes, fmt = await generator(
                api_key, base_url, body.tts_model_id or "",
                body.tts_voice, body.text, body.tts_speed,
            )
            b64 = base64.b64encode(audio_bytes).decode("ascii")
            return {"audio_id": body.audio_id, "base64": b64, "format": fmt}
        except httpx.HTTPStatusError as e:
            raise HTTPException(502, detail={
                "error_code": "PROVIDER_ERROR",
                "message": f"TTS API error ({e.response.status_code}): {e.response.text[:200]}",
            })
        except Exception as e:
            raise HTTPException(500, detail={"error_code": "GENERATION_FAILED", "message": str(e)})

    @router.post("/v1/generate/video")
    async def generate_video(
        body: VideoGenerationRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_token(settings, authorization)

        if not body.prompt:
            raise HTTPException(400, detail={"error_code": "MISSING_FIELD", "message": "prompt is required"})

        provider_id = request.headers.get("x-video-provider", "seedance")
        client_api_key = request.headers.get("x-api-key", "")
        client_base_url = request.headers.get("x-base-url", "")

        env_key_map = {
            "seedance": ("VIDEO_SEEDANCE_API_KEY", "VIDEO_SEEDANCE_BASE_URL"),
            "minimax-video": ("VIDEO_MINIMAX_API_KEY", "VIDEO_MINIMAX_BASE_URL"),
        }

        if provider_id not in env_key_map:
            raise HTTPException(400, detail={"error_code": "UNSUPPORTED_PROVIDER", "message": f"Unknown video provider: {provider_id}"})

        env_key, env_base_key = env_key_map[provider_id]
        api_key = client_api_key or os.getenv(env_key, "")
        base_url = client_base_url or os.getenv(env_base_key, "")

        if not api_key:
            raise HTTPException(401, detail={"error_code": "MISSING_API_KEY", "message": f"No API key for {provider_id}"})

        # Video generation is async — return a job-like response
        # The actual provider integration would be similar to image but with async polling
        return {
            "success": True,
            "status": "submitted",
            "message": f"Video generation submitted to {provider_id}. Full provider integration pending.",
            "provider": provider_id,
        }

    @router.post("/v1/transcription")
    async def transcription(
        authorization: str | None = Header(default=None),
        file: UploadFile = File(...),
        provider_id: str = Form("openai-whisper"),
        language: str = Form("auto"),
    ) -> dict:
        """Transcribe audio using ASR provider."""
        require_token(settings, authorization)

        audio_content = await file.read()
        if len(audio_content) > 25 * 1024 * 1024:
            raise HTTPException(400, detail={"error_code": "FILE_TOO_LARGE", "message": "Audio file exceeds 25MB"})

        if provider_id == "openai-whisper":
            api_key = os.getenv("ASR_OPENAI_API_KEY", "")
            base_url = os.getenv("ASR_OPENAI_BASE_URL", "https://api.openai.com")

            if not api_key:
                raise HTTPException(401, detail={"error_code": "MISSING_API_KEY", "message": "OpenAI API key not configured"})

            url = f"{base_url}/v1/audio/transcriptions"
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    url,
                    headers={"Authorization": f"Bearer {api_key}"},
                    files={"file": (file.filename or "audio.mp3", audio_content, file.content_type or "audio/mpeg")},
                    data={"model": "whisper-1", "language": language if language != "auto" else ""},
                )
                resp.raise_for_status()
                data = resp.json()

            return {"text": data.get("text", ""), "language": data.get("language", language)}

        elif provider_id == "qwen-asr":
            api_key = os.getenv("ASR_QWEN_API_KEY", "")
            base_url = os.getenv("ASR_QWEN_BASE_URL", "https://dashscope.aliyuncs.com")

            if not api_key:
                raise HTTPException(401, detail={"error_code": "MISSING_API_KEY", "message": "Qwen API key not configured"})

            # Qwen ASR uses a different API format
            url = f"{base_url}/api/v1/services/audio/asr/transcription"
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "audio/mpeg",
                    },
                    content=audio_content,
                )
                resp.raise_for_status()
                data = resp.json()

            return {
                "text": data.get("output", {}).get("transcription", ""),
                "language": language,
            }

        raise HTTPException(400, detail={"error_code": "UNSUPPORTED_PROVIDER", "message": f"Unknown ASR provider: {provider_id}"})

    return router
