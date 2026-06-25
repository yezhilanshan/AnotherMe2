"""Stable layout-scene contract for downstream animation/rendering."""

from __future__ import annotations

import copy
from typing import Any, Dict, List, Optional

from .layout_ir import build_layout_ir

def build_layout_contract(metadata: Dict[str, Any]) -> Dict[str, Any]:
    layout_ir = (
        metadata.get("layout_ir")
        if isinstance(metadata.get("layout_ir"), dict)
        and str(metadata.get("layout_ir", {}).get("version", "")).strip()
        == "layout_ir.v1"
        else build_layout_ir(metadata)
    )
    metadata["layout_ir"] = copy.deepcopy(layout_ir)
    candidates: List[Dict[str, Any]] = []
    for item in layout_ir.get("candidates") or []:
        if not isinstance(item, dict):
            continue
        scene_key = str(item.get("scene_key", "")).strip()
        if not scene_key:
            continue
        candidates.append(
            {
                "key": scene_key,
                "kind": str(item.get("scene_kind", "")).strip() or scene_key,
                "layout_mode": str(item.get("layout_mode", "")).strip() or scene_key,
                "is_present": True,
                "is_verified": bool(item.get("is_verified")),
                "source": str(item.get("source", "")).strip() or "unknown",
                "selection_tags": list(item.get("selection_tags") or []),
                "render_mode_hint": str(item.get("render_mode_hint", "")).strip()
                or "image_overlay_candidate",
            }
        )

    default_scene_key = ""
    default_selection_reason = "missing_scene"
    candidate_map = {
        str(item.get("key", "")).strip(): item
        for item in candidates
        if isinstance(item, dict) and str(item.get("key", "")).strip()
    }
    drawable_candidate = candidate_map.get("drawable_scene")
    coordinate_candidate = candidate_map.get("coordinate_scene")
    if _candidate_has_tag(drawable_candidate, "soft_sketch"):
        default_scene_key = "drawable_scene"
        default_selection_reason = "soft_sketch_priority"
    elif bool((coordinate_candidate or {}).get("is_verified")):
        default_scene_key = "coordinate_scene"
        default_selection_reason = "verified_coordinate_scene"
    elif isinstance(drawable_candidate, dict):
        default_scene_key = "drawable_scene"
        default_selection_reason = "drawable_scene_fallback"
    elif isinstance(coordinate_candidate, dict):
        default_scene_key = "coordinate_scene"
        default_selection_reason = "coordinate_scene_fallback"

    return {
        "version": "layout_contract.v1",
        "layout_ir_version": str(layout_ir.get("version", "")).strip(),
        "candidates": candidates,
        "default_scene_key": default_scene_key,
        "default_selection_reason": default_selection_reason,
        "coordinate_scene_verified": bool(layout_ir.get("coordinate_scene_verified")),
    }


def resolve_animation_layout(
    metadata: Dict[str, Any],
    *,
    has_problem_image: bool,
) -> Dict[str, Any]:
    scene_selection = resolve_layout_scene(metadata)
    metadata["layout_contract"] = scene_selection["layout_contract"]

    force_vector_reconstruction = bool(
        metadata.get("render_review_force_vector_reconstruction")
    )
    selected_scene = scene_selection["selected_scene"]
    selected_scene_source = scene_selection["selected_scene_source"]
    geometry_render_mode = (
        "vector_reconstruction"
        if (
            force_vector_reconstruction
            or selected_scene_source in {
                "coordinate_scene_forced_by_render_review",
                "coordinate_scene_verified",
                "drawable_scene_soft_sketch",
            }
        )
        else ("image_overlay" if has_problem_image else "vector_reconstruction")
    )

    return {
        "layout_contract": scene_selection["layout_contract"],
        "selected_scene_key": scene_selection["selected_scene_key"],
        "selected_scene_source": selected_scene_source,
        "selected_scene": selected_scene,
        "candidate_scenes": scene_selection.get("candidate_scenes", {}),
        "geometry_render_mode": geometry_render_mode,
    }


def resolve_layout_scene(
    metadata: Dict[str, Any],
    *,
    allow_semantic_fallback: bool = False,
) -> Dict[str, Any]:
    contract = build_layout_contract(metadata)
    contract = copy.deepcopy(contract)
    metadata["layout_contract"] = contract

    layout_ir = (
        metadata.get("layout_ir")
        if isinstance(metadata.get("layout_ir"), dict)
        and str(metadata.get("layout_ir", {}).get("version", "")).strip()
        == "layout_ir.v1"
        else build_layout_ir(metadata)
    )
    metadata["layout_ir"] = copy.deepcopy(layout_ir)
    candidate_map = {
        str(item.get("key", "")).strip(): item
        for item in (contract.get("candidates") or [])
        if isinstance(item, dict) and str(item.get("key", "")).strip()
    }
    scenes = {
        str(item.get("scene_key", "")).strip(): copy.deepcopy(
            item.get("scene_payload") or {}
        )
        for item in (layout_ir.get("candidates") or [])
        if isinstance(item, dict) and str(item.get("scene_key", "")).strip()
    }

    existing_selection = (
        metadata.get("layout_selection")
        if isinstance(metadata.get("layout_selection"), dict)
        else {}
    )
    selected_key = str(existing_selection.get("selected_scene_key", "")).strip()
    selected_scene_source = str(
        existing_selection.get("selected_scene_source", "")
    ).strip()

    if not selected_key:
        selected_key = str(contract.get("default_scene_key", "")).strip()
        selected_scene_source = _scene_source_from_candidate(
            candidate_map.get(selected_key),
            fallback=selected_key or "missing_scene",
        )

    prefer_verified_coordinate_scene = bool(
        metadata.get("render_review_prefer_verified_coordinate_scene")
    )
    coordinate_candidate = candidate_map.get("coordinate_scene")
    drawable_candidate = candidate_map.get("drawable_scene")
    if prefer_verified_coordinate_scene and _candidate_verified(
        coordinate_candidate, scenes.get("coordinate_scene")
    ):
        selected_key = "coordinate_scene"
        selected_scene_source = "coordinate_scene_forced_by_render_review"
    elif _candidate_has_tag(drawable_candidate, "soft_sketch") and scenes.get(
        "drawable_scene"
    ):
        selected_key = "drawable_scene"
        selected_scene_source = "drawable_scene_soft_sketch"
    elif _candidate_verified(coordinate_candidate, scenes.get("coordinate_scene")):
        selected_key = "coordinate_scene"
        selected_scene_source = "coordinate_scene_verified"
    elif not scenes.get(selected_key):
        if scenes.get("drawable_scene"):
            selected_key = "drawable_scene"
        elif scenes.get("coordinate_scene"):
            selected_key = "coordinate_scene"
        else:
            selected_key = ""
        selected_scene_source = _scene_source_from_candidate(
            candidate_map.get(selected_key),
            fallback=selected_key or "missing_scene",
        )

    selected_scene = copy.deepcopy(scenes.get(selected_key) or {})
    if not selected_scene and allow_semantic_fallback:
        for fallback_key in ("semantic_graph", "scene_graph"):
            fallback_scene = metadata.get(fallback_key)
            if isinstance(fallback_scene, dict):
                selected_scene = copy.deepcopy(fallback_scene)
                selected_key = fallback_key
                selected_scene_source = f"{fallback_key}_fallback"
                break

    selection = {
        "selected_scene_key": selected_key,
        "selected_scene_source": selected_scene_source,
        "selected_scene": selected_scene,
        "candidate_scenes": {
            key: copy.deepcopy(value or {}) for key, value in scenes.items() if value
        },
        "layout_ir": layout_ir,
        "layout_contract": contract,
    }
    metadata["layout_selection"] = {
        "selected_scene_key": selected_key,
        "selected_scene_source": selected_scene_source,
        "layout_contract_version": str(contract.get("version", "")).strip(),
        "layout_ir_version": str(layout_ir.get("version", "")).strip(),
    }
    return selection


def _candidate_verified(candidate: Optional[Dict[str, Any]], scene: Optional[Dict[str, Any]]) -> bool:
    return bool(
        isinstance(candidate, dict)
        and candidate.get("is_verified")
        and isinstance(scene, dict)
    )


def _candidate_has_tag(candidate: Optional[Dict[str, Any]], tag: str) -> bool:
    return bool(
        isinstance(candidate, dict)
        and str(tag).strip()
        and str(tag).strip() in set(candidate.get("selection_tags") or [])
    )


def _scene_source_from_candidate(
    candidate: Optional[Dict[str, Any]],
    *,
    fallback: str,
) -> str:
    if not isinstance(candidate, dict):
        return fallback
    key = str(candidate.get("key", "")).strip()
    if key == "drawable_scene" and _candidate_has_tag(candidate, "soft_sketch"):
        return "drawable_scene_soft_sketch"
    if key == "coordinate_scene" and bool(candidate.get("is_verified")):
        return "coordinate_scene_verified"
    return key or fallback
