"""Scanner-style preprocessing for photographed math problems."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Tuple


def preprocess_problem_image(
    image_path: str,
    *,
    output_dir: str,
    enabled: bool = True,
    target_min_side: int = 1400,
    max_output_side: int = 2200,
    remove_colored_ink: bool = True,
) -> Dict[str, Any]:
    """Create a cleaner, higher-resolution scan image for OCR and geometry parsing.

    The handwriting removal step is intentionally conservative: it suppresses
    colored ink and light background artifacts, but preserves dark printed
    strokes because black handwriting and black geometry lines are ambiguous.
    """

    result: Dict[str, Any] = {
        "version": "v1",
        "status": "disabled" if not enabled else "not_started",
        "source_path": image_path,
        "processed_path": image_path,
        "used_processed_image": False,
        "operations": [],
    }
    if not enabled:
        return result

    source_path = Path(image_path)
    if not source_path.exists():
        result["status"] = "source_missing"
        return result

    try:
        from PIL import (
            Image,
            ImageEnhance,
            ImageFilter,
            ImageOps,
            UnidentifiedImageError,
        )
    except Exception as exc:  # pragma: no cover - pillow is declared in requirements.
        result["status"] = f"pillow_unavailable: {exc}"
        return result

    try:
        try:
            image = ImageOps.exif_transpose(Image.open(source_path)).convert("RGB")
        except UnidentifiedImageError:
            result["status"] = "unidentified_image"
            return result

        original_size = image.size
        result["original_size"] = list(original_size)
        crop_bbox, crop_status = _detect_document_content_bbox(image)
        result["document_crop_bbox"] = list(crop_bbox)
        result["document_crop_status"] = crop_status
        if crop_status == "cropped":
            image = image.crop(crop_bbox)
            result["operations"].append("document_content_crop")

        scale = _enhancement_scale(
            image.size,
            target_min_side=max(1, int(target_min_side)),
            max_output_side=max(1, int(max_output_side)),
        )
        if abs(scale - 1.0) > 1e-6:
            new_size = (
                max(1, int(round(image.width * scale))),
                max(1, int(round(image.height * scale))),
            )
            image = image.resize(new_size, Image.Resampling.LANCZOS)
            result["operations"].append("high_resolution_resample")
            result["scale"] = round(scale, 6)
        else:
            result["scale"] = 1.0

        colored_removed = 0
        if remove_colored_ink:
            image, colored_removed = _suppress_colored_ink(image)
            if colored_removed:
                result["operations"].append("colored_handwriting_suppression")
        result["colored_ink_pixels_suppressed"] = int(colored_removed)

        gray = image.convert("L")
        gray = _normalize_shadow(gray)
        gray = ImageOps.autocontrast(gray, cutoff=1)
        gray = ImageEnhance.Contrast(gray).enhance(1.65)
        gray = gray.filter(ImageFilter.UnsharpMask(radius=1.1, percent=135, threshold=3))
        gray = gray.point(_clean_scan_tone)
        result["operations"].extend(
            ["shadow_normalization", "contrast_enhancement", "scan_tone_cleanup"]
        )

        processed = Image.merge("RGB", (gray, gray, gray))
        scan_dir = Path(output_dir) / "debug" / "scan_preprocess"
        scan_dir.mkdir(parents=True, exist_ok=True)
        processed_path = scan_dir / f"{source_path.stem}_scan.png"
        processed.save(processed_path, format="PNG", optimize=True)

        result.update(
            {
                "status": "ok",
                "processed_path": str(processed_path).replace("\\", "/"),
                "used_processed_image": True,
                "processed_size": [processed.width, processed.height],
                "handwriting_policy": "conservative_colored_ink_and_light_noise_only",
            }
        )
        report_path = processed_path.with_suffix(".json")
        report_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        result["report_path"] = str(report_path).replace("\\", "/")
        return result
    except Exception as exc:
        result["status"] = f"preprocess_failed: {exc}"
        return result


def _detect_document_content_bbox(image: Any) -> Tuple[Tuple[int, int, int, int], str]:
    width, height = image.size
    if width <= 8 or height <= 8:
        return (0, 0, width, height), "source_too_small"

    max_side = 900
    scale = min(1.0, max_side / float(max(width, height)))
    small_size = (max(1, int(width * scale)), max(1, int(height * scale)))
    gray = image.convert("L").resize(small_size)
    sw, sh = gray.size
    pixels = list(gray.tobytes())
    if not pixels:
        return (0, 0, width, height), "empty_image"

    bg = _median(_border_samples(pixels, sw, sh)) or 245
    threshold = max(125, min(232, int(bg) - 28))
    dark_points = [
        (idx % sw, idx // sw)
        for idx, value in enumerate(pixels)
        if value < threshold
    ]
    if len(dark_points) < max(20, int(sw * sh * 0.0004)):
        return (0, 0, width, height), "no_content_crop"

    xs = [point[0] for point in dark_points]
    ys = [point[1] for point in dark_points]
    x1, x2 = min(xs), max(xs) + 1
    y1, y2 = min(ys), max(ys) + 1
    pad_x = max(8, int((x2 - x1) * 0.045))
    pad_y = max(8, int((y2 - y1) * 0.045))
    x1 = max(0, x1 - pad_x)
    y1 = max(0, y1 - pad_y)
    x2 = min(sw, x2 + pad_x)
    y2 = min(sh, y2 + pad_y)

    crop_w = x2 - x1
    crop_h = y2 - y1
    if crop_w < sw * 0.18 or crop_h < sh * 0.12:
        return (0, 0, width, height), "content_bbox_too_small"
    if crop_w > sw * 0.965 and crop_h > sh * 0.965:
        return (0, 0, width, height), "already_tight"

    inv_scale = 1.0 / max(scale, 1e-9)
    return (
        max(0, int(x1 * inv_scale)),
        max(0, int(y1 * inv_scale)),
        min(width, int(x2 * inv_scale)),
        min(height, int(y2 * inv_scale)),
    ), "cropped"


def _enhancement_scale(
    size: Tuple[int, int],
    *,
    target_min_side: int,
    max_output_side: int,
) -> float:
    width, height = size
    min_side = max(1, min(width, height))
    max_side = max(1, max(width, height))
    upscale = max(1.0, float(target_min_side) / float(min_side))
    cap = float(max_output_side) / float(max_side)
    return max(0.1, min(upscale, cap))


def _suppress_colored_ink(image: Any) -> Tuple[Any, int]:
    pixels = _image_pixels(image)
    out = []
    removed = 0
    for red, green, blue in pixels:
        lightness = 0.299 * red + 0.587 * green + 0.114 * blue
        spread = max(red, green, blue) - min(red, green, blue)
        dark_neutral = red < 105 and green < 105 and blue < 105 and spread < 38
        colored_ink = spread >= 34 and lightness < 245 and not dark_neutral
        if colored_ink:
            out.append((255, 255, 255))
            removed += 1
        else:
            out.append((red, green, blue))
    cleaned = image.copy()
    cleaned.putdata(out)
    return cleaned, removed


def _normalize_shadow(gray: Any) -> Any:
    from PIL import ImageFilter

    width, height = gray.size
    radius = max(9, min(45, int(min(width, height) / 28)))
    background = gray.filter(ImageFilter.GaussianBlur(radius=radius))
    corrected = []
    for value, bg in zip(gray.tobytes(), background.tobytes()):
        corrected.append(max(0, min(255, int((float(value) * 255.0) / max(float(bg), 1.0)))))
    normalized = gray.copy()
    normalized.putdata(corrected)
    return normalized


def _clean_scan_tone(value: int) -> int:
    if value >= 224:
        return 255
    if value <= 150:
        return max(0, int(value * 0.72))
    return int(150 + (value - 150) * 0.72)


def _border_samples(pixels: List[int], width: int, height: int) -> List[int]:
    band_h = max(1, height // 24)
    band_w = max(1, width // 24)
    samples = (
        pixels[: width * band_h]
        + pixels[-width * band_h :]
        + [pixels[y * width + x] for y in range(height) for x in range(band_w)]
        + [
            pixels[y * width + x]
            for y in range(height)
            for x in range(max(0, width - band_w), width)
        ]
    )
    return samples


def _median(values: List[int]) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    return int(ordered[len(ordered) // 2])


def _image_pixels(image: Any) -> List[Tuple[int, int, int]]:
    getter = getattr(image, "get_flattened_data", None)
    if callable(getter):
        return list(getter())
    return list(image.getdata())
