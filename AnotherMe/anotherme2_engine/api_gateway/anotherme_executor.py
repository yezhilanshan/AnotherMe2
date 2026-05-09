"""AnotherMe2 execution adapter for problem-video jobs."""

from __future__ import annotations

import multiprocessing as mp
import os
import shutil
import subprocess
import tempfile
import base64
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict

from .storage import ObjectStorage
try:
    from output_paths import GATEWAY_OUTPUTS_ROOT
except ModuleNotFoundError:
    from anotherme2_engine.output_paths import GATEWAY_OUTPUTS_ROOT


@dataclass
class ProblemVideoExecutionResult:
    video_path: str
    duration_sec: float
    script_steps_count: int
    debug_bundle_path: str | None
    requirement_hint: str | None


class MissingInputObjectError(FileNotFoundError):
    """Raised when a required object key does not exist in object storage."""


_VIDEO_FILE_SUFFIXES = {".mp4", ".webm", ".mov", ".mkv", ".m4v", ".avi"}


def _strip_provider_prefix(model: str | None) -> str | None:
    value = str(model or "").strip()
    if not value:
        return None
    if ":" in value:
        provider, model_name = value.split(":", 1)
        if provider and model_name:
            return model_name.strip() or None
    return value


def _clean_llm_config(raw: Dict[str, Any] | None) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    api_key = str(raw.get("api_key") or raw.get("apiKey") or "").strip()
    base_url = str(raw.get("base_url") or raw.get("baseUrl") or "").strip()
    vision_api_key = str(raw.get("vision_api_key") or raw.get("visionApiKey") or "").strip()
    vision_base_url = str(raw.get("vision_base_url") or raw.get("visionBaseUrl") or "").strip()
    ocr_api_key = str(raw.get("ocr_api_key") or raw.get("ocrApiKey") or "").strip()
    ocr_base_url = str(raw.get("ocr_base_url") or raw.get("ocrBaseUrl") or "").strip()
    ocr_engine = str(raw.get("ocr_engine") or raw.get("ocrEngine") or "").strip().lower()
    model = _strip_provider_prefix(str(raw.get("model") or raw.get("model_name") or raw.get("modelName") or ""))
    vision_model = _strip_provider_prefix(str(raw.get("vision_model") or raw.get("visionModel") or ""))
    ocr_model = _strip_provider_prefix(str(raw.get("ocr_model") or raw.get("ocrModel") or ""))
    result: Dict[str, Any] = {}
    if api_key:
        result["api_key"] = api_key
    if base_url:
        result["base_url"] = base_url
    if vision_api_key:
        result["vision_api_key"] = vision_api_key
    if vision_base_url:
        result["vision_base_url"] = vision_base_url
    if ocr_api_key:
        result["ocr_api_key"] = ocr_api_key
    if ocr_base_url:
        result["ocr_base_url"] = ocr_base_url
    if ocr_engine:
        result["ocr_engine"] = ocr_engine
    if model:
        result["model"] = model
    if vision_model:
        result["vision_model"] = vision_model
    if ocr_model:
        result["ocr_model"] = ocr_model
    return result


# Supported provider base URL patterns for auto-detection
_PROVIDER_PATTERNS = {
    "openai": ["api.openai.com"],
    "anthropic": ["api.anthropic.com"],
    "gemini": ["generativelanguage.googleapis.com", "googleapis.com"],
    "deepseek": ["api.deepseek.com"],
    "qwen": ["dashscope.aliyuncs.com"],
    "kimi": ["api.moonshot.cn"],
    "minimax": ["api.minimaxi.com"],
    "glm": ["open.bigmodel.cn"],
    "siliconflow": ["api.siliconflow.cn"],
    "doubao": ["ark.cn-beijing.volces.com", "volces.com"],
    "grok": ["api.x.ai", "x.ai"],
}


def _detect_provider_from_url(base_url: str) -> str | None:
    """Detect provider from base URL."""
    base_url_lower = base_url.lower()
    for provider, patterns in _PROVIDER_PATTERNS.items():
        for pattern in patterns:
            if pattern in base_url_lower:
                return provider
    return None


def _is_vision_capable_model(model: str) -> bool:
    """Check if a model supports vision capabilities."""
    model_lower = model.lower()
    vision_keywords = [
        "vision", "vl", "gpt-4o", "claude-3", "gemini", "qwen-vl", "qwen2-vl",
        "kimi-k2", "doubao-vision", "glm-4v"
    ]
    return any(kw in model_lower for kw in vision_keywords)


def _is_ocr_capable_model(model: str) -> bool:
    """Check if a model supports OCR capabilities."""
    model_lower = model.lower()
    ocr_keywords = ["ocr", "qwen-vl-ocr"]
    return any(kw in model_lower for kw in ocr_keywords)


def _get_default_vision_model(provider: str, current_model: str) -> str:
    """Get default vision model for a provider."""
    defaults = {
        "openai": "gpt-4o",
        "anthropic": "claude-3-5-sonnet-20241022",
        "gemini": "gemini-2.0-flash",
        "deepseek": "deepseek-chat",
        "qwen": "qwen3-vl-plus",
        "kimi": "kimi-k2-5",
        "minimax": "MiniMax-Text-01",
        "glm": "glm-4v-plus",
        "siliconflow": "Qwen/Qwen2-VL-72B-Instruct",
        "doubao": "doubao-1.5-vision-pro-250328",
        "grok": "grok-3",
    }
    return defaults.get(provider, current_model)


def _get_default_ocr_model(provider: str, current_model: str) -> str:
    """Get default OCR model for a provider."""
    defaults = {
        "openai": "gpt-4o",
        "anthropic": "claude-3-5-sonnet-20241022",
        "gemini": "gemini-2.0-flash",
        "deepseek": "deepseek-chat",
        "qwen": "qwen-vl-ocr-latest",
        "kimi": "kimi-k2-5",
        "minimax": "MiniMax-Text-01",
        "glm": "glm-4v-plus",
        "siliconflow": "Qwen/Qwen2-VL-72B-Instruct",
        "doubao": "doubao-1.5-vision-pro-250328",
        "grok": "grok-3",
    }
    return defaults.get(provider, current_model)


def _merge_runtime_configs(
    *,
    base_llm_config: Dict[str, Any],
    base_vision_config: Dict[str, Any],
    base_ocr_config: Dict[str, Any],
    override: Dict[str, Any],
) -> tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
    llm_config = dict(base_llm_config)
    vision_config = dict(base_vision_config)
    ocr_config = dict(base_ocr_config)

    api_key = str(override.get("api_key") or "").strip()
    base_url = str(override.get("base_url") or "").strip()
    vision_api_key = str(override.get("vision_api_key") or "").strip()
    vision_base_url = str(override.get("vision_base_url") or "").strip()
    ocr_api_key = str(override.get("ocr_api_key") or "").strip()
    ocr_base_url = str(override.get("ocr_base_url") or "").strip()
    ocr_engine = str(override.get("ocr_engine") or "").strip().lower()
    model = _strip_provider_prefix(str(override.get("model") or ""))
    vision_model = _strip_provider_prefix(str(override.get("vision_model") or ""))
    ocr_model = _strip_provider_prefix(str(override.get("ocr_model") or ""))

    # Detect provider from base URL
    provider = _detect_provider_from_url(base_url) if base_url else None
    vision_provider = _detect_provider_from_url(vision_base_url) if vision_base_url else provider
    ocr_provider = _detect_provider_from_url(ocr_base_url) if ocr_base_url else provider

    if api_key:
        llm_config["api_key"] = api_key
        vision_config["api_key"] = api_key
        ocr_config["api_key"] = api_key
    if base_url:
        llm_config["base_url"] = base_url
        vision_config["base_url"] = base_url
        ocr_config["base_url"] = base_url
    if model:
        llm_config["model"] = model
        # Auto-detect vision capability
        if _is_vision_capable_model(model):
            vision_config["model"] = model
            if _is_ocr_capable_model(model):
                ocr_config["model"] = model
    if vision_api_key:
        vision_config["api_key"] = vision_api_key
    if vision_base_url:
        vision_config["base_url"] = vision_base_url
    if ocr_api_key:
        ocr_config["api_key"] = ocr_api_key
    if ocr_base_url:
        ocr_config["base_url"] = ocr_base_url
    if ocr_engine:
        ocr_config["ocr_engine"] = ocr_engine
    if vision_model:
        vision_config["model"] = vision_model
    if ocr_model:
        ocr_config["model"] = ocr_model

    # Validate and fix vision/ocr models based on provider
    vision_model_current = str(vision_config.get("model") or "").lower()
    vision_base_url_current = str(vision_config.get("base_url") or "").lower()
    detected_vision_provider = vision_provider or _detect_provider_from_url(vision_base_url_current)

    if detected_vision_provider:
        # Check if current vision model is appropriate for the provider
        is_appropriate = False
        if detected_vision_provider == "qwen":
            is_appropriate = vision_model_current.startswith("qwen") and ("vl" in vision_model_current or "vision" in vision_model_current)
        elif detected_vision_provider == "doubao":
            is_appropriate = "vision" in vision_model_current or "vl" in vision_model_current
        elif detected_vision_provider in ["openai", "anthropic", "gemini"]:
            is_appropriate = _is_vision_capable_model(vision_model_current)

        if not is_appropriate:
            vision_config["model"] = _get_default_vision_model(detected_vision_provider, vision_model_current)

    # Validate and fix OCR model
    ocr_model_current = str(ocr_config.get("model") or "").lower()
    ocr_base_url_current = str(ocr_config.get("base_url") or "").lower()
    detected_ocr_provider = ocr_provider or _detect_provider_from_url(ocr_base_url_current) or detected_vision_provider

    if detected_ocr_provider and ocr_engine != "paddleocr":
        is_ocr_appropriate = False
        if detected_ocr_provider == "qwen":
            is_ocr_appropriate = "qwen" in ocr_model_current and ("vl" in ocr_model_current or "ocr" in ocr_model_current)
        elif detected_ocr_provider == "doubao":
            is_ocr_appropriate = "vision" in ocr_model_current
        else:
            is_ocr_appropriate = _is_vision_capable_model(ocr_model_current)

        if not is_ocr_appropriate:
            ocr_config["model"] = _get_default_ocr_model(detected_ocr_provider, ocr_model_current)

    return llm_config, vision_config, ocr_config


def _is_video_artifact(path: str) -> bool:
    target = Path(path)
    return target.suffix.lower() in _VIDEO_FILE_SUFFIXES and target.exists() and target.stat().st_size > 0


def _generation_subprocess_entry(
    image_path: str,
    problem_text: str | None,
    output_dir: str,
    geometry_file: str | None,
    learner_memory: Dict[str, Any] | None,
    llm_config_override: Dict[str, Any] | None,
    export_ggb: bool,
    result_queue: "mp.queues.Queue",
) -> None:
    try:
        from agents.foundation.config import (
            build_default_llm_config,
            build_ocr_model_config,
            build_vision_model_config,
            build_llm_config_from_env,
            build_vision_config_from_env,
            build_ocr_config_from_env,
        )
        from main import MathVideoGenerator

        cleaned_config = _clean_llm_config(llm_config_override)

        # If override has api_key and base_url, use them; otherwise auto-detect from env
        if cleaned_config.get("api_key") and cleaned_config.get("base_url"):
            llm_config, vision_config, ocr_config = _merge_runtime_configs(
                base_llm_config=build_default_llm_config(),
                base_vision_config=build_vision_model_config(),
                base_ocr_config=build_ocr_model_config(),
                override=cleaned_config,
            )
        else:
            # Auto-detect provider from environment variables
            llm_config = build_llm_config_from_env()
            vision_config = build_vision_config_from_env()
            ocr_config = build_ocr_config_from_env()
            # Apply partial overrides: api_key, base_url, and model names.
            # Always apply api_key/base_url from frontend when present,
            # even if base_url is missing (the env detection provides the base_url).
            for cfg in (llm_config, vision_config, ocr_config):
                if cleaned_config.get("api_key"):
                    cfg["api_key"] = cleaned_config["api_key"]
                if cleaned_config.get("base_url"):
                    cfg["base_url"] = cleaned_config["base_url"]
            if cleaned_config.get("model"):
                llm_config["model"] = cleaned_config["model"]
            if cleaned_config.get("vision_model"):
                vision_config["model"] = cleaned_config["vision_model"]
            if cleaned_config.get("ocr_model"):
                ocr_config["model"] = cleaned_config["ocr_model"]

        # Validate that we have API keys before attempting generation
        for role, cfg in [
            ("文本模型", llm_config),
            ("视觉模型", vision_config),
            ("OCR模型", ocr_config),
        ]:
            api_key = cfg.get("api_key", "") if isinstance(cfg, dict) else ""
            if not api_key:
                model = cfg.get("model", "") if isinstance(cfg, dict) else ""
                raise RuntimeError(
                    f"{role}的 API Key 为空（model={model}）。"
                    f"请在前端设置页面配置对应模型的 API Key，"
                    f"或在 .env.local 中设置 DASHSCOPE_API_KEY 环境变量。"
                )

        generator = MathVideoGenerator(
            llm_config=llm_config,
            vision_config=vision_config,
            ocr_vision_config=ocr_config,
        )
        final_video_path = generator.generate(
            image_path=image_path,
            problem_text=problem_text,
            output_dir=output_dir,
            geometry_file=geometry_file,
            export_ggb=export_ggb,
            learner_memory=learner_memory if isinstance(learner_memory, dict) else None,
        )
        if not str(final_video_path or "").strip():
            raise RuntimeError("AnotherMe2 generator returned empty output path")
        result_queue.put(
            {
                "ok": True,
                "final_video_path": final_video_path,
            }
        )
    except Exception as exc:
        result_queue.put(
            {
                "ok": False,
                "error": str(exc),
            }
        )


def _run_generation_with_timeout(
    *,
    image_path: str,
    problem_text: str | None,
    output_dir: str,
    geometry_file: str | None,
    learner_memory: Dict[str, Any] | None,
    llm_config_override: Dict[str, Any] | None,
    export_ggb: bool,
    timeout_seconds: int,
) -> str:
    timeout_seconds = max(60, int(timeout_seconds))
    ctx = mp.get_context("spawn")
    result_queue = ctx.Queue(maxsize=1)
    process = ctx.Process(
        target=_generation_subprocess_entry,
        args=(
            image_path,
            problem_text,
            output_dir,
            geometry_file,
            learner_memory,
            llm_config_override,
            export_ggb,
            result_queue,
        ),
    )
    process.start()
    process.join(timeout=timeout_seconds)

    if process.is_alive():
        process.terminate()
        process.join(timeout=10)
        if process.is_alive():
            process.kill()
            process.join(timeout=5)
        raise TimeoutError(f"AnotherMe2 generation timeout after {timeout_seconds}s")

    payload: dict[str, Any] | None = None
    try:
        payload = result_queue.get(timeout=2)
    except Exception:
        payload = None
    finally:
        try:
            result_queue.close()
            result_queue.join_thread()
        except Exception:
            pass

    if not payload:
        if process.exitcode == 0:
            raise RuntimeError("AnotherMe2 generation subprocess exited without result payload")
        raise RuntimeError(f"AnotherMe2 generation subprocess exited with code {process.exitcode}")

    if not payload.get("ok"):
        raise RuntimeError(str(payload.get("error") or "AnotherMe2 generation failed"))

    return str(payload.get("final_video_path") or "")


def _probe_duration(path: str) -> float:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        if result.returncode == 0:
            return float(result.stdout.strip() or 0.0)
    except Exception:
        return 0.0
    return 0.0


def _zip_debug_bundle(run_output_dir: Path) -> str | None:
    debug_dir = run_output_dir / "debug"
    if not debug_dir.exists():
        return None
    archive = run_output_dir / "debug_bundle"
    shutil.make_archive(str(archive), "zip", root_dir=debug_dir)
    zipped = archive.with_suffix(".zip")
    return str(zipped) if zipped.exists() else None


def _render_text_image(text: str, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        from PIL import Image, ImageDraw, ImageFont

        image = Image.new("RGB", (1280, 720), "white")
        draw = ImageDraw.Draw(image)
        font = ImageFont.load_default()
        normalized = (text or "").strip() or "No extracted problem text."
        lines = []
        current = ""
        for token in normalized.split():
            test = f"{current} {token}".strip()
            if len(test) > 38:
                lines.append(current)
                current = token
            else:
                current = test
        if current:
            lines.append(current)
        if not lines:
            lines = [normalized]

        y = 40
        for line in lines[:22]:
            draw.text((40, y), line, fill="black", font=font)
            y += 28

        image.save(path, format="PNG")
    except Exception:
        # Fallback to a valid 1x1 PNG to keep downstream vision flow operational.
        png_1x1 = (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8N7x8AAAAASUVORK5CYII="
        )
        path.write_bytes(base64.b64decode(png_1x1))


def build_requirement_from_photo(image_path: str) -> str:
    from agents.foundation.config import build_ocr_model_config, build_vision_model_config
    from agents.perception.vision_tool import VisionTool

    vision = VisionTool(
        build_vision_model_config(),
        ocr_llm_config=build_ocr_model_config(),
    )
    ocr_text = (vision.extract_problem_text(image_path) or "").strip()
    geometry_hint = (vision.describe_geometry(image_path) or "").strip()
    snippet = geometry_hint[:600]
    return (
        "请基于以下学生拍题内容生成一节题目讲解课程，直接进入题意分析与分步求解，讲解要细致并覆盖易错点。\n"
        f"题目OCR：{ocr_text}\n"
        f"图形摘要：{snippet}"
    )


def run_problem_video_job(
    payload: Dict[str, Any],
    storage: ObjectStorage,
    temp_root: str,
    output_root: str | None = None,
    keep_run_output: bool = False,
) -> ProblemVideoExecutionResult:
    workdir = Path(tempfile.mkdtemp(prefix="problem-video-", dir=temp_root))
    input_image_path = workdir / "problem_input.png"

    image_object_key = str(payload["image_object_key"])
    if not storage.exists(image_object_key):
        raise MissingInputObjectError(f"required input object missing: {image_object_key}")
    try:
        storage.download_file(image_object_key, str(input_image_path))
    except FileNotFoundError as exc:
        raise MissingInputObjectError(f"required input object missing: {image_object_key}") from exc

    geometry_file = payload.get("geometry_file")
    geometry_local = None
    if geometry_file:
        geometry_object_key = str(geometry_file)
        if not storage.exists(geometry_object_key):
            raise MissingInputObjectError(f"required geometry object missing: {geometry_object_key}")
        geometry_local = workdir / "geometry_input.json"
        try:
            storage.download_file(geometry_object_key, str(geometry_local))
        except FileNotFoundError as exc:
            raise MissingInputObjectError(f"required geometry object missing: {geometry_object_key}") from exc

    run_outputs_root = Path(output_root).expanduser().resolve() if output_root else GATEWAY_OUTPUTS_ROOT
    output_dir = run_outputs_root / workdir.name / "run_output"
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        timeout_seconds = int(os.getenv("ANOTHERME2_GENERATION_TIMEOUT_SEC", "1800"))
        final_video_path = _run_generation_with_timeout(
            image_path=str(input_image_path),
            problem_text=payload.get("problem_text"),
            output_dir=str(output_dir),
            geometry_file=str(geometry_local) if geometry_local else None,
            learner_memory=payload.get("learner_memory") if isinstance(payload.get("learner_memory"), dict) else None,
            llm_config_override=payload.get("llm_config") if isinstance(payload.get("llm_config"), dict) else None,
            export_ggb=True,
            timeout_seconds=timeout_seconds,
        )

        if not final_video_path or not Path(final_video_path).exists():
            raise RuntimeError("AnotherMe2 did not produce a final video/audio artifact")
        if not _is_video_artifact(final_video_path):
            raise RuntimeError(
                "AnotherMe2 did not produce a valid final video artifact; "
                f"got '{final_video_path}'."
            )

        script_steps_count = len(list((output_dir / "audio").glob("narration_*.mp3")))
        duration = _probe_duration(final_video_path)
        debug_bundle = _zip_debug_bundle(output_dir)

        requirement_hint = None
        try:
            requirement_hint = build_requirement_from_photo(str(input_image_path))
        except Exception:
            requirement_hint = None

        return ProblemVideoExecutionResult(
            video_path=final_video_path,
            duration_sec=duration,
            script_steps_count=script_steps_count,
            debug_bundle_path=debug_bundle,
            requirement_hint=requirement_hint,
        )
    except Exception:
        # Keep failed run outputs when debugging is enabled.
        if not keep_run_output:
            run_root = output_dir.parent
            shutil.rmtree(output_dir, ignore_errors=True)
            try:
                if run_root.exists() and not any(run_root.iterdir()):
                    run_root.rmdir()
            except OSError:
                pass
        raise
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def synthesize_problem_image_from_text(
    text: str,
    storage: ObjectStorage,
    object_key: str,
    temp_root: str,
) -> str:
    workdir = Path(tempfile.mkdtemp(prefix="synthetic-problem-", dir=temp_root))
    image_path = workdir / "synthetic_problem.png"
    _render_text_image(text, image_path)
    storage.upload_file(str(image_path), object_key, content_type="image/png")
    return object_key


def extract_core_example_text(classroom_payload: Dict[str, Any]) -> str:
    classroom = classroom_payload.get("classroom") or classroom_payload
    scenes = classroom.get("scenes") if isinstance(classroom, dict) else None
    if not isinstance(scenes, list) or not scenes:
        return "请围绕该主题提供一个典型例题并给出分步讲解。"

    # Priority: quiz question -> first speech action -> scene title
    for scene in scenes:
        content = scene.get("content") if isinstance(scene, dict) else {}
        if isinstance(content, dict) and content.get("type") == "quiz":
            questions = content.get("questions") or []
            if questions and isinstance(questions[0], dict):
                stem = questions[0].get("stem") or questions[0].get("question")
                if stem:
                    return str(stem)

    for scene in scenes:
        actions = scene.get("actions") if isinstance(scene, dict) else []
        for action in actions or []:
            if isinstance(action, dict) and action.get("type") == "speech" and action.get("text"):
                return str(action["text"])

    first = scenes[0]
    if isinstance(first, dict) and first.get("title"):
        return str(first["title"])

    return "请围绕该主题提供一个典型例题并给出分步讲解。"
