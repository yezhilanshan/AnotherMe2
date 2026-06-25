"""Lightweight raster-to-SVG helpers for cropped geometry figures."""

from __future__ import annotations

import html
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


def vectorize_geometry_image(
    image_path: str,
    *,
    output_svg_path: Optional[str] = None,
    output_json_path: Optional[str] = None,
    max_side: int = 900,
    max_pixels_for_hough: int = 7000,
) -> Dict[str, Any]:
    """Convert a cropped geometry PNG into a compact SVG plus line hints.

    This intentionally avoids optional system tools such as potrace. The SVG is
    not meant to be a perfect art trace; it preserves the crop coordinate system
    and exposes reliable straight-line candidates that downstream calibration
    and debug tools can consume.
    """

    result: Dict[str, Any] = {
        "version": "v1",
        "status": "not_started",
        "image_path": image_path,
        "svg_path": "",
        "geometry_primitives_path": "",
        "coordinate_space": "crop",
        "image_size": None,
        "lines": [],
        "circles": [],
        "intersections": [],
        "markers": [],
        "confidence": 0.0,
        "geometry_primitives": {
            "version": "v1",
            "coordinate_space": "crop",
            "image_size": None,
            "line_segments": [],
            "circles": [],
            "intersections": [],
            "markers": [],
            "confidence": 0.0,
        },
    }
    source_path = Path(image_path)
    if not source_path.exists():
        result["status"] = "source_missing"
        return result

    try:
        from PIL import Image
    except Exception as exc:  # pragma: no cover - pillow is declared in requirements.
        result["status"] = f"pillow_unavailable: {exc}"
        return result

    try:
        image = Image.open(source_path).convert("L")
        width, height = image.size
        result["image_size"] = [width, height]
        result["geometry_primitives"]["image_size"] = [width, height]
        if width <= 4 or height <= 4:
            result["status"] = "source_too_small"
            return _write_output_result(result, output_svg_path, output_json_path, width, height)

        scale = min(1.0, float(max_side) / float(max(width, height)))
        if scale < 1.0:
            work_size = (max(1, int(width * scale)), max(1, int(height * scale)))
            work_image = image.resize(work_size)
        else:
            work_image = image
        work_width, work_height = work_image.size
        pixels = list(work_image.tobytes())
        threshold = _estimate_dark_threshold(pixels, work_width, work_height)
        active = [
            (idx % work_width, idx // work_width)
            for idx, value in enumerate(pixels)
            if value < threshold
        ]
        if len(active) < 12:
            result["status"] = "no_dark_pixels"
            return _write_output_result(result, output_svg_path, output_json_path, width, height)

        sampled = _subsample_points(active, max_pixels_for_hough)
        lines = _detect_line_segments(
            sampled,
            active,
            work_width=work_width,
            work_height=work_height,
            scale_to_source=1.0 / max(scale, 1e-9),
        )
        circles = _detect_circle_candidates(
            active,
            work_width=work_width,
            work_height=work_height,
            scale_to_source=1.0 / max(scale, 1e-9),
        )
        intersections = _derive_intersections(
            lines,
            circles,
            width=width,
            height=height,
        )
        markers = _detect_marker_bboxes(
            active,
            work_width=work_width,
            work_height=work_height,
            scale_to_source=1.0 / max(scale, 1e-9),
        )
        confidence = _primitive_confidence(lines, circles, intersections, markers)
        result["lines"] = lines
        result["circles"] = circles
        result["intersections"] = intersections
        result["markers"] = markers
        result["confidence"] = confidence
        result["geometry_primitives"] = {
            "version": "v1",
            "coordinate_space": "crop",
            "image_size": [width, height],
            "line_segments": lines,
            "circles": circles,
            "intersections": intersections,
            "markers": markers,
            "confidence": confidence,
            "evidence_counts": {
                "line_segments": len(lines),
                "circles": len(circles),
                "intersections": len(intersections),
                "markers": len(markers),
            },
        }
        result["status"] = "ok" if lines or circles else "no_geometry_candidates"
        return _write_output_result(result, output_svg_path, output_json_path, width, height)
    except Exception as exc:
        result["status"] = f"vectorization_failed: {exc}"
        return result


def _estimate_dark_threshold(pixels: List[int], width: int, height: int) -> int:
    band_h = max(1, height // 20)
    band_w = max(1, width // 20)
    samples = (
        pixels[: width * band_h]
        + pixels[-width * band_h :]
        + [pixels[y * width + x] for y in range(height) for x in range(min(band_w, width))]
        + [
            pixels[y * width + x]
            for y in range(height)
            for x in range(max(0, width - band_w), width)
        ]
    )
    background = sorted(samples)[len(samples) // 2] if samples else 245
    return max(110, min(225, int(background) - 35))


def _subsample_points(
    points: List[Tuple[int, int]], max_count: int
) -> List[Tuple[int, int]]:
    if len(points) <= max_count:
        return points
    step = max(1, int(math.ceil(len(points) / float(max_count))))
    return points[::step]


def _detect_line_segments(
    sampled_points: List[Tuple[int, int]],
    all_points: List[Tuple[int, int]],
    *,
    work_width: int,
    work_height: int,
    scale_to_source: float,
) -> List[Dict[str, Any]]:
    angle_step = 3
    rho_bin = max(3.0, min(work_width, work_height) * 0.006)
    min_votes = max(10, int(len(sampled_points) * 0.006))
    accumulator: Dict[Tuple[int, int], int] = defaultdict(int)
    trig: List[Tuple[int, float, float]] = []
    for theta_deg in range(0, 180, angle_step):
        theta = math.radians(theta_deg)
        trig.append((theta_deg, math.cos(theta), math.sin(theta)))

    for x, y in sampled_points:
        for theta_idx, cos_t, sin_t in trig:
            rho = x * cos_t + y * sin_t
            accumulator[(theta_idx, int(round(rho / rho_bin)))] += 1

    peaks = sorted(
        (
            (votes, theta_deg, rho_idx * rho_bin)
            for (theta_deg, rho_idx), votes in accumulator.items()
            if votes >= min_votes
        ),
        reverse=True,
    )[:80]

    candidates: List[Dict[str, Any]] = []
    distance_tolerance = max(2.2, min(work_width, work_height) * 0.0045)
    min_length = max(24.0, min(work_width, work_height) * 0.14)
    max_points_for_refine = _subsample_points(all_points, 24000)

    for votes, theta_deg, rho in peaks:
        theta = math.radians(theta_deg)
        cos_t = math.cos(theta)
        sin_t = math.sin(theta)
        dir_x = -sin_t
        dir_y = cos_t
        inliers: List[Tuple[float, float, float]] = []
        sq_distance = 0.0
        for x, y in max_points_for_refine:
            distance = x * cos_t + y * sin_t - rho
            if abs(distance) > distance_tolerance:
                continue
            projection = x * dir_x + y * dir_y
            inliers.append((projection, x, y))
            sq_distance += distance * distance
        if len(inliers) < max(12, min_votes):
            continue
        inliers.sort(key=lambda item: item[0])
        start_proj = _percentile_projection(inliers, 0.03)
        end_proj = _percentile_projection(inliers, 0.97)
        length = end_proj - start_proj
        if length < min_length:
            continue
        rms_width = math.sqrt(sq_distance / max(len(inliers), 1))
        if rms_width > max(5.0, distance_tolerance * 1.8):
            continue
        x1 = (cos_t * rho + dir_x * start_proj) * scale_to_source
        y1 = (sin_t * rho + dir_y * start_proj) * scale_to_source
        x2 = (cos_t * rho + dir_x * end_proj) * scale_to_source
        y2 = (sin_t * rho + dir_y * end_proj) * scale_to_source
        candidates.append(
            {
                "id": f"line_{len(candidates) + 1}",
                "type": "line_segment",
                "x1": _round_coord(x1),
                "y1": _round_coord(y1),
                "x2": _round_coord(x2),
                "y2": _round_coord(y2),
                "theta_deg": _round_coord(theta_deg),
                "rho": _round_coord(rho * scale_to_source),
                "length_px": _round_coord(length * scale_to_source),
                "support_px": int(len(inliers)),
                "votes": int(votes),
                "rms_width_px": _round_coord(rms_width * scale_to_source),
                "confidence": _round_coord(
                    _line_confidence(
                        length=length,
                        support=len(inliers),
                        rms_width=rms_width,
                        work_width=work_width,
                        work_height=work_height,
                    )
                ),
                "source": "hough",
            }
        )

    candidates.sort(
        key=lambda item: (
            float(item.get("length_px", 0.0)) * max(int(item.get("support_px", 0)), 1)
        ),
        reverse=True,
    )
    merged: List[Dict[str, Any]] = []
    for candidate in candidates:
        if any(_is_duplicate_line(candidate, existing) for existing in merged):
            continue
        candidate["id"] = f"line_{len(merged) + 1}"
        merged.append(candidate)
        if len(merged) >= 24:
            break
    return merged


def _detect_circle_candidates(
    all_points: List[Tuple[int, int]],
    *,
    work_width: int,
    work_height: int,
    scale_to_source: float,
) -> List[Dict[str, Any]]:
    active = set(all_points)
    visited: set[Tuple[int, int]] = set()
    components: List[List[Tuple[int, int]]] = []

    for start in all_points:
        if start in visited:
            continue
        stack = [start]
        visited.add(start)
        component: List[Tuple[int, int]] = []
        while stack:
            x, y = stack.pop()
            component.append((x, y))
            for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbor in visited or neighbor not in active:
                    continue
                visited.add(neighbor)
                stack.append(neighbor)
        if len(component) >= 24:
            components.append(component)

    min_radius = max(10.0, min(work_width, work_height) * 0.045)
    candidates: List[Dict[str, Any]] = []
    for component in components:
        xs = [point[0] for point in component]
        ys = [point[1] for point in component]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        bw = max_x - min_x + 1
        bh = max_y - min_y + 1
        if bw < min_radius * 1.5 or bh < min_radius * 1.5:
            continue
        aspect = bw / max(float(bh), 1.0)
        if aspect < 0.68 or aspect > 1.47:
            continue

        area = max(float(bw * bh), 1.0)
        density = len(component) / area
        if density < 0.015 or density > 0.42:
            continue

        cx = (min_x + max_x) / 2.0
        cy = (min_y + max_y) / 2.0
        distances = [math.hypot(x - cx, y - cy) for x, y in component]
        radius = _median(distances)
        if radius < min_radius:
            continue
        residuals = [distance - radius for distance in distances]
        rms = math.sqrt(sum(value * value for value in residuals) / len(residuals))
        if rms > max(4.5, radius * 0.16):
            continue

        coverage = _angular_coverage(component, cx, cy)
        if coverage < 0.36:
            continue
        support_ratio = len(component) / max(2.0 * math.pi * radius, 1.0)
        if support_ratio < 0.18:
            continue

        candidates.append(
            {
                "id": f"circle_{len(candidates) + 1}",
                "type": "circle",
                "cx": _round_coord(cx * scale_to_source),
                "cy": _round_coord(cy * scale_to_source),
                "r": _round_coord(radius * scale_to_source),
                "bbox": [
                    _round_coord(min_x * scale_to_source),
                    _round_coord(min_y * scale_to_source),
                    _round_coord((max_x + 1) * scale_to_source),
                    _round_coord((max_y + 1) * scale_to_source),
                ],
                "support_px": int(len(component)),
                "coverage_ratio": _round_coord(coverage),
                "support_ratio": _round_coord(support_ratio),
                "rms_radius_error_px": _round_coord(rms * scale_to_source),
                "confidence": _round_coord(
                    _circle_confidence(
                        coverage=coverage,
                        support_ratio=support_ratio,
                        rms_error=rms,
                        radius=radius,
                    )
                ),
                "source": "component_circle_fit",
            }
        )

    candidates.sort(
        key=lambda item: (
            float(item.get("coverage_ratio", 0.0)),
            float(item.get("support_px", 0.0)),
        ),
        reverse=True,
    )
    merged: List[Dict[str, Any]] = []
    for candidate in candidates:
        if any(_is_duplicate_circle(candidate, existing) for existing in merged):
            continue
        candidate["id"] = f"circle_{len(merged) + 1}"
        merged.append(candidate)
        if len(merged) >= 12:
            break
    return merged


def _detect_marker_bboxes(
    all_points: List[Tuple[int, int]],
    *,
    work_width: int,
    work_height: int,
    scale_to_source: float,
) -> List[Dict[str, Any]]:
    components = _connected_components(all_points, min_size=5)
    markers: List[Dict[str, Any]] = []
    for component in components:
        xs = [point[0] for point in component]
        ys = [point[1] for point in component]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        bw = max_x - min_x + 1
        bh = max_y - min_y + 1
        area = max(float(bw * bh), 1.0)
        density = len(component) / area
        if bw > work_width * 0.18 or bh > work_height * 0.18:
            continue
        if bw < 3 or bh < 3:
            continue
        if density < 0.08:
            continue
        aspect = bw / max(float(bh), 1.0)
        if aspect > 6.0 or aspect < 1.0 / 6.0:
            continue
        marker_type = "compact_marker"
        if 0.65 <= aspect <= 1.55 and density > 0.18:
            marker_type = "square_or_dot_marker"
        markers.append(
            {
                "id": f"marker_{len(markers) + 1}",
                "type": marker_type,
                "bbox": [
                    _round_coord(min_x * scale_to_source),
                    _round_coord(min_y * scale_to_source),
                    _round_coord((max_x + 1) * scale_to_source),
                    _round_coord((max_y + 1) * scale_to_source),
                ],
                "support_px": int(len(component)),
                "density": _round_coord(density),
                "confidence": _round_coord(min(0.9, max(0.25, density))),
                "source": "connected_component",
            }
        )
        if len(markers) >= 24:
            break
    return markers


def _connected_components(
    points: List[Tuple[int, int]], *, min_size: int
) -> List[List[Tuple[int, int]]]:
    active = set(points)
    visited: set[Tuple[int, int]] = set()
    components: List[List[Tuple[int, int]]] = []
    for start in points:
        if start in visited:
            continue
        stack = [start]
        visited.add(start)
        component: List[Tuple[int, int]] = []
        while stack:
            x, y = stack.pop()
            component.append((x, y))
            for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbor in visited or neighbor not in active:
                    continue
                visited.add(neighbor)
                stack.append(neighbor)
        if len(component) >= min_size:
            components.append(component)
    return components


def _derive_intersections(
    lines: List[Dict[str, Any]],
    circles: List[Dict[str, Any]],
    *,
    width: int,
    height: int,
) -> List[Dict[str, Any]]:
    intersections: List[Dict[str, Any]] = []

    for i, first in enumerate(lines[:32]):
        for second in lines[i + 1 : 32]:
            point = _line_line_intersection(first, second, width=width, height=height)
            if point is None:
                continue
            intersections.append(
                _intersection_payload(
                    intersections,
                    kind="line_line",
                    point=point,
                    source_ids=[str(first.get("id")), str(second.get("id"))],
                    confidence=min(
                        _safe_confidence(first),
                        _safe_confidence(second),
                    ),
                )
            )

    for line in lines[:32]:
        for circle in circles[:16]:
            for point in _line_circle_intersections(
                line, circle, width=width, height=height
            ):
                intersections.append(
                    _intersection_payload(
                        intersections,
                        kind="line_circle",
                        point=point,
                        source_ids=[str(line.get("id")), str(circle.get("id"))],
                        confidence=min(_safe_confidence(line), _safe_confidence(circle)),
                    )
                )

    for i, first in enumerate(circles[:16]):
        for second in circles[i + 1 : 16]:
            for point in _circle_circle_intersections(
                first, second, width=width, height=height
            ):
                intersections.append(
                    _intersection_payload(
                        intersections,
                        kind="circle_circle",
                        point=point,
                        source_ids=[str(first.get("id")), str(second.get("id"))],
                        confidence=min(
                            _safe_confidence(first),
                            _safe_confidence(second),
                        ),
                    )
                )

    return _dedupe_intersection_payloads(intersections)


def _intersection_payload(
    existing: List[Dict[str, Any]],
    *,
    kind: str,
    point: Tuple[float, float],
    source_ids: List[str],
    confidence: float,
) -> Dict[str, Any]:
    return {
        "id": f"intersection_{len(existing) + 1}",
        "type": kind,
        "x": _round_coord(point[0]),
        "y": _round_coord(point[1]),
        "source_ids": source_ids,
        "confidence": _round_coord(max(0.0, min(1.0, confidence))),
        "source": "derived_from_primitives",
    }


def _line_line_intersection(
    first: Dict[str, Any],
    second: Dict[str, Any],
    *,
    width: int,
    height: int,
) -> Optional[Tuple[float, float]]:
    try:
        x1, y1 = float(first["x1"]), float(first["y1"])
        x2, y2 = float(first["x2"]), float(first["y2"])
        x3, y3 = float(second["x1"]), float(second["y1"])
        x4, y4 = float(second["x2"]), float(second["y2"])
    except (KeyError, TypeError, ValueError):
        return None
    denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(denom) <= 1e-7:
        return None
    px = (
        (x1 * y2 - y1 * x2) * (x3 - x4)
        - (x1 - x2) * (x3 * y4 - y3 * x4)
    ) / denom
    py = (
        (x1 * y2 - y1 * x2) * (y3 - y4)
        - (y1 - y2) * (x3 * y4 - y3 * x4)
    ) / denom
    if px < -8.0 or py < -8.0 or px > width + 8.0 or py > height + 8.0:
        return None
    if not _point_near_line_segment(px, py, first, tolerance=10.0):
        return None
    if not _point_near_line_segment(px, py, second, tolerance=10.0):
        return None
    return px, py


def _line_circle_intersections(
    line: Dict[str, Any],
    circle: Dict[str, Any],
    *,
    width: int,
    height: int,
) -> List[Tuple[float, float]]:
    try:
        x1, y1 = float(line["x1"]), float(line["y1"])
        x2, y2 = float(line["x2"]), float(line["y2"])
        cx, cy = float(circle["cx"]), float(circle["cy"])
        radius = float(circle["r"])
    except (KeyError, TypeError, ValueError):
        return []
    dx = x2 - x1
    dy = y2 - y1
    a = dx * dx + dy * dy
    if a <= 1e-9:
        return []
    fx = x1 - cx
    fy = y1 - cy
    b = 2.0 * (fx * dx + fy * dy)
    c = fx * fx + fy * fy - radius * radius
    discriminant = b * b - 4.0 * a * c
    if discriminant < -1e-6:
        return []
    roots = [-b / (2.0 * a)] if abs(discriminant) <= 1e-6 else [
        (-b - math.sqrt(discriminant)) / (2.0 * a),
        (-b + math.sqrt(discriminant)) / (2.0 * a),
    ]
    points: List[Tuple[float, float]] = []
    for t in roots:
        if t < -0.04 or t > 1.04:
            continue
        px = x1 + t * dx
        py = y1 + t * dy
        if px < -8.0 or py < -8.0 or px > width + 8.0 or py > height + 8.0:
            continue
        points.append((px, py))
    return _dedupe_points(points)


def _circle_circle_intersections(
    first: Dict[str, Any],
    second: Dict[str, Any],
    *,
    width: int,
    height: int,
) -> List[Tuple[float, float]]:
    try:
        x0, y0, r0 = float(first["cx"]), float(first["cy"]), float(first["r"])
        x1, y1, r1 = float(second["cx"]), float(second["cy"]), float(second["r"])
    except (KeyError, TypeError, ValueError):
        return []
    dx = x1 - x0
    dy = y1 - y0
    distance = math.hypot(dx, dy)
    if distance <= 1e-9:
        return []
    if distance > r0 + r1 + 1e-6:
        return []
    if distance < abs(r0 - r1) - 1e-6:
        return []
    a = (r0 * r0 - r1 * r1 + distance * distance) / (2.0 * distance)
    h_sq = r0 * r0 - a * a
    if h_sq < -1e-6:
        return []
    h = math.sqrt(max(0.0, h_sq))
    xm = x0 + a * dx / distance
    ym = y0 + a * dy / distance
    rx = -dy * h / distance
    ry = dx * h / distance
    points = [(xm + rx, ym + ry)]
    if h > 1e-6:
        points.append((xm - rx, ym - ry))
    return [
        point
        for point in _dedupe_points(points)
        if -8.0 <= point[0] <= width + 8.0 and -8.0 <= point[1] <= height + 8.0
    ]


def _dedupe_points(points: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    deduped: List[Tuple[float, float]] = []
    for point in points:
        if any(math.hypot(point[0] - other[0], point[1] - other[1]) <= 2.0 for other in deduped):
            continue
        deduped.append(point)
    return deduped


def _dedupe_intersection_payloads(
    intersections: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    deduped: List[Dict[str, Any]] = []
    for item in intersections:
        duplicate = None
        for existing in deduped:
            if math.hypot(
                float(item.get("x", 0.0)) - float(existing.get("x", 0.0)),
                float(item.get("y", 0.0)) - float(existing.get("y", 0.0)),
            ) <= 3.0:
                duplicate = existing
                break
        if duplicate is not None:
            if _safe_confidence(item) > _safe_confidence(duplicate):
                duplicate.update(item)
            continue
        item["id"] = f"intersection_{len(deduped) + 1}"
        deduped.append(item)
    return deduped[:64]


def _point_near_line_segment(
    x: float, y: float, line: Dict[str, Any], *, tolerance: float
) -> bool:
    try:
        x1, y1 = float(line["x1"]), float(line["y1"])
        x2, y2 = float(line["x2"]), float(line["y2"])
    except (KeyError, TypeError, ValueError):
        return False
    return (
        min(x1, x2) - tolerance <= x <= max(x1, x2) + tolerance
        and min(y1, y2) - tolerance <= y <= max(y1, y2) + tolerance
    )


def _line_confidence(
    *,
    length: float,
    support: int,
    rms_width: float,
    work_width: int,
    work_height: int,
) -> float:
    length_score = min(1.0, length / max(min(work_width, work_height) * 0.45, 1.0))
    support_score = min(1.0, support / 160.0)
    width_penalty = min(0.45, rms_width / 18.0)
    return max(0.05, min(0.98, 0.25 + 0.4 * length_score + 0.3 * support_score - width_penalty))


def _circle_confidence(
    *, coverage: float, support_ratio: float, rms_error: float, radius: float
) -> float:
    residual_penalty = min(0.45, rms_error / max(radius, 1.0))
    return max(
        0.05,
        min(0.98, 0.2 + 0.45 * coverage + 0.25 * min(1.0, support_ratio) - residual_penalty),
    )


def _primitive_confidence(
    lines: List[Dict[str, Any]],
    circles: List[Dict[str, Any]],
    intersections: List[Dict[str, Any]],
    markers: List[Dict[str, Any]],
) -> float:
    values = [
        _safe_confidence(item)
        for item in [*lines[:8], *circles[:4], *intersections[:8], *markers[:4]]
    ]
    if not values:
        return 0.0
    count_bonus = min(0.12, 0.015 * (len(lines) + len(circles) + len(intersections)))
    return _round_coord(min(0.99, sum(values) / len(values) + count_bonus))


def _safe_confidence(item: Dict[str, Any]) -> float:
    try:
        return max(0.0, min(1.0, float(item.get("confidence", 0.5))))
    except (TypeError, ValueError):
        return 0.5


def _median(values: List[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return float(ordered[mid])
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def _angular_coverage(
    points: List[Tuple[int, int]], cx: float, cy: float, bins: int = 48
) -> float:
    seen = set()
    for x, y in points:
        angle = math.atan2(y - cy, x - cx)
        if angle < 0:
            angle += math.tau
        seen.add(int(angle / math.tau * bins) % bins)
    return len(seen) / float(bins)


def _is_duplicate_circle(candidate: Dict[str, Any], existing: Dict[str, Any]) -> bool:
    cx_delta = float(candidate.get("cx", 0.0)) - float(existing.get("cx", 0.0))
    cy_delta = float(candidate.get("cy", 0.0)) - float(existing.get("cy", 0.0))
    r_delta = abs(float(candidate.get("r", 0.0)) - float(existing.get("r", 0.0)))
    radius = max(float(candidate.get("r", 0.0)), float(existing.get("r", 0.0)), 1.0)
    return math.hypot(cx_delta, cy_delta) <= max(8.0, radius * 0.12) and r_delta <= max(
        8.0, radius * 0.12
    )


def _percentile_projection(
    inliers: List[Tuple[float, float, float]], fraction: float
) -> float:
    if not inliers:
        return 0.0
    index = max(0, min(len(inliers) - 1, int(round((len(inliers) - 1) * fraction))))
    return float(inliers[index][0])


def _is_duplicate_line(candidate: Dict[str, Any], existing: Dict[str, Any]) -> bool:
    angle_a = float(candidate.get("theta_deg", 0.0))
    angle_b = float(existing.get("theta_deg", 0.0))
    angle_delta = abs(angle_a - angle_b) % 180.0
    angle_delta = min(angle_delta, 180.0 - angle_delta)
    if angle_delta > 5.0:
        return False
    rho_delta = abs(float(candidate.get("rho", 0.0)) - float(existing.get("rho", 0.0)))
    if rho_delta > 12.0:
        return False
    mid_a = _line_midpoint(candidate)
    mid_b = _line_midpoint(existing)
    return math.hypot(mid_a[0] - mid_b[0], mid_a[1] - mid_b[1]) < 28.0


def _line_midpoint(line: Dict[str, Any]) -> Tuple[float, float]:
    return (
        (float(line.get("x1", 0.0)) + float(line.get("x2", 0.0))) / 2.0,
        (float(line.get("y1", 0.0)) + float(line.get("y2", 0.0))) / 2.0,
    )


def _write_output_result(
    result: Dict[str, Any],
    output_svg_path: Optional[str],
    output_json_path: Optional[str],
    width: int,
    height: int,
) -> Dict[str, Any]:
    _write_svg_result(result, output_svg_path, width, height)
    _write_geometry_primitives_json(result, output_json_path)
    return result


def _write_svg_result(
    result: Dict[str, Any],
    output_svg_path: Optional[str],
    width: int,
    height: int,
) -> None:
    svg = _build_svg(width, height, result.get("lines") or [], result.get("circles") or [])
    if output_svg_path:
        path = Path(output_svg_path)
    else:
        path = Path(str(result.get("image_path") or "")).with_suffix(".svg")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(svg, encoding="utf-8")
        result["svg_path"] = str(path).replace("\\", "/")
    except Exception as exc:
        result["svg_path"] = ""
        result["status"] = f"{result.get('status')}; svg_write_failed: {exc}"


def _write_geometry_primitives_json(
    result: Dict[str, Any],
    output_json_path: Optional[str],
) -> None:
    if output_json_path:
        path = Path(output_json_path)
    else:
        path = Path(str(result.get("image_path") or "")).with_suffix(".geometry_primitives.json")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": "v1",
            "status": result.get("status"),
            "image_path": result.get("image_path"),
            "svg_path": result.get("svg_path"),
            "coordinate_space": result.get("coordinate_space"),
            "image_size": result.get("image_size"),
            "geometry_primitives": result.get("geometry_primitives") or {},
        }
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        result["geometry_primitives_path"] = str(path).replace("\\", "/")
    except Exception as exc:
        result["geometry_primitives_path"] = ""
        result["status"] = f"{result.get('status')}; primitives_json_write_failed: {exc}"


def _build_svg(
    width: int,
    height: int,
    lines: Iterable[Dict[str, Any]],
    circles: Iterable[Dict[str, Any]],
) -> str:
    body = []
    for circle in circles:
        body.append(
            "  <circle "
            f'id="{html.escape(str(circle.get("id", "")))}" '
            f'cx="{_svg_num(circle.get("cx"))}" cy="{_svg_num(circle.get("cy"))}" '
            f'r="{_svg_num(circle.get("r"))}" '
            'fill="none" stroke="#111111" stroke-width="2" />'
        )
    for line in lines:
        body.append(
            "  <line "
            f'id="{html.escape(str(line.get("id", "")))}" '
            f'x1="{_svg_num(line.get("x1"))}" y1="{_svg_num(line.get("y1"))}" '
            f'x2="{_svg_num(line.get("x2"))}" y2="{_svg_num(line.get("y2"))}" '
            'stroke="#111111" stroke-width="2" stroke-linecap="round" />'
        )
    body_text = "\n".join(body)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">\n'
        '  <rect width="100%" height="100%" fill="white" />\n'
        f"{body_text}\n"
        "</svg>\n"
    )


def _svg_num(value: Any) -> str:
    return f"{float(value):.3f}".rstrip("0").rstrip(".")


def _round_coord(value: Any) -> float:
    return round(float(value), 4)
