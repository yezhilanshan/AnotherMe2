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

    roles = raw.get("roles") if isinstance(raw.get("roles"), dict) else {}
    text_role = roles.get("text") if isinstance(roles.get("text"), dict) else {}
    vision_role = roles.get("vision") if isinstance(roles.get("vision"), dict) else {}
    ocr_role = roles.get("ocr") if isinstance(roles.get("ocr"), dict) else {}

    api_key = str(text_role.get("api_key") or text_role.get("apiKey") or raw.get("api_key") or raw.get("apiKey") or "").strip()
    base_url = str(text_role.get("base_url") or text_role.get("baseUrl") or raw.get("base_url") or raw.get("baseUrl") or "").strip()
    vision_api_key = str(vision_role.get("api_key") or vision_role.get("apiKey") or raw.get("vision_api_key") or raw.get("visionApiKey") or "").strip()
    vision_base_url = str(vision_role.get("base_url") or vision_role.get("baseUrl") or raw.get("vision_base_url") or raw.get("visionBaseUrl") or "").strip()
    ocr_api_key = str(ocr_role.get("api_key") or ocr_role.get("apiKey") or raw.get("ocr_api_key") or raw.get("ocrApiKey") or "").strip()
    ocr_base_url = str(ocr_role.get("base_url") or ocr_role.get("baseUrl") or raw.get("ocr_base_url") or raw.get("ocrBaseUrl") or "").strip()
    ocr_engine = str(raw.get("ocr_engine") or raw.get("ocrEngine") or "").strip().lower()
    model = _strip_provider_prefix(str(text_role.get("model") or raw.get("model") or raw.get("model_name") or raw.get("modelName") or ""))
    vision_model = _strip_provider_prefix(str(vision_role.get("model") or raw.get("vision_model") or raw.get("visionModel") or ""))
    ocr_model = _strip_provider_prefix(str(ocr_role.get("model") or raw.get("ocr_model") or raw.get("ocrModel") or ""))
    result: Dict[str, Any] = {}
    if text_role:
        result["__text_explicit"] = True
    if vision_role or any(raw.get(key) for key in ("vision_api_key", "visionApiKey", "vision_base_url", "visionBaseUrl", "vision_model", "visionModel")):
        result["__vision_explicit"] = True
    if ocr_role or any(raw.get(key) for key in ("ocr_api_key", "ocrApiKey", "ocr_base_url", "ocrBaseUrl", "ocr_model", "ocrModel")):
        result["__ocr_explicit"] = True
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
    vision_explicit = bool(override.get("__vision_explicit"))
    ocr_explicit = bool(override.get("__ocr_explicit"))

    if vision_explicit:
        for key in ("api_key", "base_url", "model"):
            vision_config.pop(key, None)
    if ocr_explicit:
        for key in ("api_key", "base_url", "model"):
            ocr_config.pop(key, None)

    # Apply text provider credentials to the text role. For legacy requests
    # without explicit role config, keep the previous same-provider fallback.
    if api_key:
        llm_config["api_key"] = api_key
        if not vision_explicit:
            vision_config["api_key"] = api_key
        if not ocr_explicit:
            ocr_config["api_key"] = api_key
    if base_url:
        llm_config["base_url"] = base_url
        if not vision_explicit:
            vision_config["base_url"] = base_url
        if not ocr_explicit:
            ocr_config["base_url"] = base_url
    if model:
        llm_config["model"] = model
        if not vision_explicit:
            vision_config["model"] = model
        if not ocr_explicit:
            ocr_config["model"] = model

    # Apply role-specific overrides (take precedence over text defaults)
    if vision_api_key:
        vision_config["api_key"] = vision_api_key
    if vision_base_url:
        vision_config["base_url"] = vision_base_url
    if vision_model:
        vision_config["model"] = vision_model
    if ocr_api_key:
        ocr_config["api_key"] = ocr_api_key
    if ocr_base_url:
        ocr_config["base_url"] = ocr_base_url
    if ocr_model:
        ocr_config["model"] = ocr_model
    if ocr_engine:
        ocr_config["ocr_engine"] = ocr_engine

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
        )
        from main import MathVideoGenerator

        cleaned_config = _clean_llm_config(llm_config_override)

        # Log incoming config for debugging (mask API keys)
        def _mask_key(key: str) -> str:
            if not key or len(key) < 8:
                return "***" if key else "(empty)"
            return key[:4] + "..." + key[-4:]

        print(f"[executor] cleaned_config keys: {list(cleaned_config.keys())}")
        print(f"[executor] api_key={_mask_key(cleaned_config.get('api_key', ''))}, "
              f"base_url={cleaned_config.get('base_url', '')}")
        print(f"[executor] vision_api_key={_mask_key(cleaned_config.get('vision_api_key', ''))}, "
              f"vision_base_url={cleaned_config.get('vision_base_url', '')}")
        print(f"[executor] ocr_api_key={_mask_key(cleaned_config.get('ocr_api_key', ''))}, "
              f"ocr_base_url={cleaned_config.get('ocr_base_url', '')}")
        print(f"[executor] model={cleaned_config.get('model', '')}, "
              f"vision_model={cleaned_config.get('vision_model', '')}, "
              f"ocr_model={cleaned_config.get('ocr_model', '')}")

        # Require both api_key and base_url from the frontend.
        # No env auto-detection — the frontend is the single source of truth.
        if not cleaned_config.get("api_key") or not cleaned_config.get("base_url"):
            missing = []
            if not cleaned_config.get("api_key"):
                missing.append("api_key")
            if not cleaned_config.get("base_url"):
                missing.append("base_url")
            raise RuntimeError(
                f"前端未提供完整的模型配置（缺少: {', '.join(missing)}）。"
                f"请在设置页面配置 API Key 和 Base URL。"
            )

        llm_config, vision_config, ocr_config = _merge_runtime_configs(
            base_llm_config=build_default_llm_config(),
            base_vision_config=build_vision_model_config(),
            base_ocr_config=build_ocr_model_config(),
            override=cleaned_config,
        )

        # Log final resolved configs for debugging
        for role, cfg in [("llm", llm_config), ("vision", vision_config), ("ocr", ocr_config)]:
            print(f"[executor] final {role}: model={cfg.get('model', '')}, "
                  f"api_key={_mask_key(cfg.get('api_key', ''))}, "
                  f"base_url={cfg.get('base_url', '')}")

        # Validate that we have both api_key and base_url before attempting generation
        for role, cfg in [
            ("文本模型", llm_config),
            ("视觉模型", vision_config),
            ("OCR模型", ocr_config),
        ]:
            api_key = cfg.get("api_key", "") if isinstance(cfg, dict) else ""
            base_url = cfg.get("base_url", "") if isinstance(cfg, dict) else ""
            model = cfg.get("model", "") if isinstance(cfg, dict) else ""
            if not api_key or not base_url:
                missing = []
                if not api_key:
                    missing.append("API Key")
                if not base_url:
                    missing.append("Base URL")
                raise RuntimeError(
                    f"{role}配置不完整（缺少: {', '.join(missing)}，model={model}）。"
                    f"请在设置页面同时配置 API Key 和 Base URL。"
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
