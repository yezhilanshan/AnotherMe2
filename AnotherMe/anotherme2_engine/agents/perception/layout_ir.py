"""Stable layout artifact derived from solver/layout scene payloads."""

from __future__ import annotations

import copy
from typing import Any, Dict, List, Optional

from .pixel_anchor import point_has_pixel_anchor


def build_layout_ir(metadata: Dict[str, Any]) -> Dict[str, Any]:
    return build_layout_ir_from_scenes(
        drawable_scene=(
            metadata.get("drawable_scene")
            if isinstance(metadata.get("drawable_scene"), dict)
            else None
        ),
        coordinate_scene=(
            metadata.get("coordinate_scene")
            if isinstance(metadata.get("coordinate_scene"), dict)
            else None
        ),
        drawable_scene_source=str(metadata.get("drawable_scene_source", "")).strip(),
        coordinate_scene_verified=bool(
            (
                metadata.get("coordinate_scene_validation")
                if isinstance(metadata.get("coordinate_scene_validation"), dict)
                else {}
            ).get("is_valid")
        ),
    )


def build_layout_ir_from_scenes(
    *,
    drawable_scene: Optional[Dict[str, Any]],
    coordinate_scene: Optional[Dict[str, Any]],
    drawable_scene_source: str = "",
    coordinate_scene_verified: bool = False,
) -> Dict[str, Any]:
    coordinate_scene_validation = (
        {"is_valid": coordinate_scene_verified}
    )
    coordinate_verified = bool(coordinate_scene_validation.get("is_valid"))
    drawable_scene_source = str(drawable_scene_source or "").strip()

    candidates: List[Dict[str, Any]] = []
    if isinstance(drawable_scene, dict):
        drawable_layout_mode = str(drawable_scene.get("layout_mode", "")).strip()
        drawable_is_soft_sketch = drawable_layout_mode == "soft_sketch_reconstruction"
        drawable_from_verified_coordinate = (
            drawable_scene_source == "derived_from_coordinate_scene" and coordinate_verified
        )
        candidates.append(
            {
                "scene_key": "drawable_scene",
                "scene_kind": "drawable_scene",
                "layout_mode": drawable_layout_mode or "drawable_scene",
                "source": drawable_scene_source or "unknown",
                "is_verified": drawable_from_verified_coordinate,
                "selection_tags": _ordered_tags(
                    [
                        "soft_sketch" if drawable_is_soft_sketch else "",
                        "verified_drawable" if drawable_from_verified_coordinate else "",
                    ]
                ),
                "render_mode_hint": (
                    "vector_reconstruction"
                    if drawable_is_soft_sketch or drawable_from_verified_coordinate
                    else "image_overlay_candidate"
                ),
                "scene_payload": _normalize_layout_scene(drawable_scene),
            }
        )

    if isinstance(coordinate_scene, dict):
        candidates.append(
            {
                "scene_key": "coordinate_scene",
                "scene_kind": "coordinate_scene",
                "layout_mode": str(
                    coordinate_scene.get("layout_mode", "solved_coordinate_scene")
                ).strip()
                or "solved_coordinate_scene",
                "source": "solver_coordinate_scene",
                "is_verified": coordinate_verified,
                "selection_tags": _ordered_tags(
                    ["verified_coordinate" if coordinate_verified else ""]
                ),
                "render_mode_hint": (
                    "vector_reconstruction"
                    if coordinate_verified
                    else "image_overlay_candidate"
                ),
                "scene_payload": _normalize_layout_scene(coordinate_scene),
            }
        )

    return {
        "version": "layout_ir.v1",
        "coordinate_scene_verified": coordinate_verified,
        "candidates": candidates,
    }


def _normalize_layout_scene(scene: Dict[str, Any]) -> Dict[str, Any]:
    normalized = copy.deepcopy(scene)
    points = _normalize_points(scene.get("points"))
    primitives = copy.deepcopy(scene.get("primitives") or [])
    display = (
        copy.deepcopy(scene.get("display"))
        if isinstance(scene.get("display"), dict)
        else {}
    )
    pixel_anchor_coverage = scene.get("pixel_anchor_coverage")
    if not isinstance(pixel_anchor_coverage, dict):
        pixel_anchor_coverage = _compute_pixel_anchor_coverage(points)
    normalized["mode"] = str(scene.get("mode", "")).strip() or "2d"
    normalized["layout_mode"] = (
        str(scene.get("layout_mode", "")).strip() or "derived_layout"
    )
    normalized["points"] = points
    normalized["primitives"] = primitives
    normalized["display"] = display
    normalized["pixel_anchor_coverage"] = pixel_anchor_coverage
    return normalized


def scene_payload_from_layout_ir(
    layout_ir: Dict[str, Any],
    scene_key: str,
) -> Optional[Dict[str, Any]]:
    for candidate in layout_ir.get("candidates") or []:
        if not isinstance(candidate, dict):
            continue
        if str(candidate.get("scene_key", "")).strip() != str(scene_key).strip():
            continue
        scene_payload = candidate.get("scene_payload")
        if isinstance(scene_payload, dict):
            return copy.deepcopy(scene_payload)
    return None


def _normalize_points(raw_points: Any) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    if isinstance(raw_points, dict):
        iterator = raw_points.items()
    elif isinstance(raw_points, list):
        iterator = (
            (item.get("id") if isinstance(item, dict) else None, item)
            for item in raw_points
        )
    else:
        iterator = []

    for key, value in iterator:
        if not isinstance(value, dict):
            continue
        point_id = str(value.get("id") or key or "").strip()
        if not point_id:
            continue
        payload = copy.deepcopy(value)
        payload["id"] = point_id
        normalized.append(payload)
    return normalized


def _compute_pixel_anchor_coverage(points: List[Dict[str, Any]]) -> Dict[str, Any]:
    point_ids = [
        str(item.get("id", "")).strip()
        for item in points
        if isinstance(item, dict) and str(item.get("id", "")).strip()
    ]
    anchored = [
        point_id
        for point_id in point_ids
        if point_has_pixel_anchor(
            next(
                item
                for item in points
                if isinstance(item, dict) and str(item.get("id", "")).strip() == point_id
            )
        )
    ]
    anchored_set = set(anchored)
    missing = [point_id for point_id in point_ids if point_id not in anchored_set]
    total = len(point_ids)
    return {
        "total_points": total,
        "anchored_points": anchored,
        "missing_points": missing,
        "coverage": round(len(anchored) / total, 6) if total else 1.0,
    }


def _ordered_tags(values: List[str]) -> List[str]:
    ordered: List[str] = []
    seen = set()
    for item in values:
        text = str(item).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        ordered.append(text)
    return ordered
