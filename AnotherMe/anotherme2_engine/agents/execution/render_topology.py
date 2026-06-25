"""Pre-render topology checks for geometry scenes."""

from __future__ import annotations

import copy
import re
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


def validate_and_filter_render_topology(
    scene: Optional[Dict[str, Any]],
    geometry_ir: Optional[Dict[str, Any]],
) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    """Remove render segments not declared by the stable GeometryIR.

    The renderer may receive a coordinate scene with solver-added or template-added
    topology. This gate keeps only segments that are declared by visual facts,
    scene-draft visible segments, visible polygons, or approved auxiliary
    display entries in GeometryIR. Text-explicit facts are semantic constraints,
    not drawable topology, unless a display entry explicitly approves them.
    """

    if not isinstance(scene, dict):
        return scene, _report(skipped=True, reason="missing_scene")
    if not _is_stable_geometry_ir(geometry_ir):
        return scene, _report(skipped=True, reason="missing_geometry_ir")

    point_aliases = _point_aliases(scene, geometry_ir or {})
    display_policy = _geometry_display_policy(geometry_ir or {}, point_aliases)
    allowed_pairs, allowed_sources = _allowed_segment_pairs(
        geometry_ir or {},
        point_aliases,
    )
    if not allowed_pairs:
        return scene, _report(skipped=True, reason="empty_allowed_topology")

    filtered = copy.deepcopy(scene)
    primitives = filtered.get("primitives")
    if not isinstance(primitives, list):
        return filtered, _report(
            skipped=False,
            allowed_pairs=allowed_pairs,
            allowed_sources=allowed_sources,
        )

    kept: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []
    suppressed: List[Dict[str, Any]] = []
    for primitive in primitives:
        if not isinstance(primitive, dict):
            kept.append(primitive)
            continue
        primitive_type = str(primitive.get("type", "")).strip().lower()
        if primitive_type == "segment":
            pair = _pair_from_points(primitive.get("points") or [], point_aliases)
            display_payload = _display_payload_for_primitive(
                primitive,
                pair,
                display_policy,
            )
            if _display_hidden(display_payload):
                suppressed.append(
                    _suppressed_payload(primitive, pair, "hidden_by_geometry_ir")
                )
                continue
            if pair and pair not in allowed_pairs:
                rejected.append(_rejected_payload(primitive, pair, "undeclared_segment"))
                continue
            _merge_primitive_display(filtered, primitive, pair, display_payload)
        elif primitive_type == "polygon":
            edges = _polygon_edges(primitive.get("points") or [], point_aliases)
            missing_edges = [edge for edge in edges if edge not in allowed_pairs]
            if missing_edges:
                rejected.append(
                    {
                        "id": str(primitive.get("id", "")).strip(),
                        "type": "polygon",
                        "reason": "polygon_has_undeclared_edges",
                        "missing_edges": [_pair_label(edge) for edge in missing_edges],
                    }
                )
                continue
            _merge_primitive_display(filtered, primitive, None, None)
        kept.append(primitive)

    filtered["primitives"] = kept
    report = _report(
        skipped=False,
        allowed_pairs=allowed_pairs,
        allowed_sources=allowed_sources,
        rejected=rejected,
        suppressed=suppressed,
    )
    filtered["render_topology_validation"] = report
    return filtered, report


def _is_stable_geometry_ir(geometry_ir: Optional[Dict[str, Any]]) -> bool:
    return (
        isinstance(geometry_ir, dict)
        and str(geometry_ir.get("version", "")).strip() == "geometry_ir.v1"
    )


def _allowed_segment_pairs(
    geometry_ir: Dict[str, Any],
    point_aliases: Optional[Dict[str, str]] = None,
) -> Tuple[set[frozenset[str]], Dict[str, List[str]]]:
    pairs: set[frozenset[str]] = set()
    sources: Dict[str, List[str]] = {}

    def add_pair(first: Any, second: Any, source: str) -> None:
        pair = _pair_from_points([first, second], point_aliases)
        if not pair:
            return
        pairs.add(pair)
        sources.setdefault(_pair_label(pair), [])
        if source not in sources[_pair_label(pair)]:
            sources[_pair_label(pair)].append(source)

    facts = geometry_ir.get("facts") if isinstance(geometry_ir.get("facts"), dict) else {}
    visual = (
        facts.get("visual_observed")
        if isinstance(facts.get("visual_observed"), dict)
        else {}
    )
    scene_draft = (
        geometry_ir.get("scene_draft")
        if isinstance(geometry_ir.get("scene_draft"), dict)
        else {}
    )

    for segment in _iter_segments(visual.get("segments"), point_aliases):
        add_pair(segment[0], segment[1], "visual_observed.segments")
    for segment in _iter_visible_scene_segments(
        scene_draft.get("visible_segments"),
        point_aliases,
    ):
        add_pair(segment[0], segment[1], "scene_draft.visible_segments")
    for polygon in visual.get("polygons") or []:
        for edge in _polygon_edges(_polygon_points(polygon, point_aliases), point_aliases):
            add_pair(*tuple(edge), "visual_observed.polygons")

    geometry_facts = (
        geometry_ir.get("geometry_facts")
        if isinstance(geometry_ir.get("geometry_facts"), dict)
        else {}
    )
    display = (
        geometry_facts.get("display")
        if isinstance(geometry_facts.get("display"), dict)
        else {}
    )
    primitive_display = (
        display.get("primitives") if isinstance(display.get("primitives"), dict) else {}
    )
    for primitive_id, payload in primitive_display.items():
        if not isinstance(payload, dict):
            continue
        source = str(payload.get("source", "")).strip().lower()
        role = str(payload.get("role", "")).strip().lower()
        style = str(payload.get("style", "")).strip().lower()
        if source not in {
            "approved_auxiliary",
            "fold_template",
            "fold_transform",
            "visual_observed",
        }:
            if not (role == "construction" and style == "dashed"):
                continue
        segment = _segment_from_id(primitive_id, point_aliases)
        if len(segment) == 2:
            add_pair(segment[0], segment[1], f"display.{source or role or style}")

    return pairs, sources


def _iter_segments(
    raw: Any,
    point_aliases: Optional[Dict[str, str]] = None,
) -> Iterable[Tuple[str, str]]:
    if isinstance(raw, dict):
        points = raw.get("points") or raw.get("endpoints")
        if isinstance(points, (list, tuple)) and len(points) == 2:
            first = _normalize_point(points[0], point_aliases)
            second = _normalize_point(points[1], point_aliases)
            if first and second and first != second:
                yield first, second
        token = raw.get("id") or raw.get("name") or raw.get("segment")
        if token:
            segment = _segment_from_id(token, point_aliases)
            if len(segment) == 2:
                yield segment[0], segment[1]
        return
    if isinstance(raw, str):
        segment = _segment_from_id(raw, point_aliases)
        if len(segment) == 2:
            yield segment[0], segment[1]
        return
    if isinstance(raw, (list, tuple)):
        for item in raw:
            yield from _iter_segments(item, point_aliases)


def _iter_visible_scene_segments(
    raw: Any,
    point_aliases: Optional[Dict[str, str]] = None,
) -> Iterable[Tuple[str, str]]:
    if isinstance(raw, dict):
        if raw.get("visible") is False or raw.get("show") is False:
            return
        yield from _iter_segments(raw, point_aliases)
        return
    if isinstance(raw, (list, tuple)):
        for item in raw:
            yield from _iter_visible_scene_segments(item, point_aliases)
        return
    yield from _iter_segments(raw, point_aliases)


def _polygon_points(
    raw: Any,
    point_aliases: Optional[Dict[str, str]] = None,
) -> List[str]:
    if isinstance(raw, dict):
        raw = raw.get("points") or raw.get("vertices") or raw.get("id") or raw.get("name")
    if isinstance(raw, str):
        return [
            _normalize_point(item, point_aliases)
            for item in re.findall(r"[A-Za-z]\d*'?", _normalize_token(raw))
        ]
    if isinstance(raw, (list, tuple)):
        return [_normalize_point(item, point_aliases) for item in raw]
    return []


def _polygon_edges(
    raw_points: Any,
    point_aliases: Optional[Dict[str, str]] = None,
) -> List[frozenset[str]]:
    points = [item for item in _polygon_points(raw_points, point_aliases) if item]
    if len(points) < 3:
        return []
    return [
        frozenset((points[index], points[(index + 1) % len(points)]))
        for index in range(len(points))
        if points[index] != points[(index + 1) % len(points)]
    ]


def _pair_from_points(
    raw_points: Sequence[Any],
    point_aliases: Optional[Dict[str, str]] = None,
) -> Optional[frozenset[str]]:
    points = [_normalize_point(item, point_aliases) for item in raw_points]
    points = [item for item in points if item]
    if len(points) != 2 or points[0] == points[1]:
        return None
    return frozenset((points[0], points[1]))


def _segment_from_id(
    raw: Any,
    point_aliases: Optional[Dict[str, str]] = None,
) -> List[str]:
    token = _normalize_token(raw)
    if token.startswith("seg_"):
        token = token[4:]
    return [
        _normalize_point(item, point_aliases)
        for item in re.findall(r"[A-Za-z]\d*'?", token)
    ][:2]


def _normalize_point(
    raw: Any,
    point_aliases: Optional[Dict[str, str]] = None,
) -> str:
    token = _normalize_token(raw)
    if point_aliases and token in point_aliases:
        token = point_aliases[token]
    if re.fullmatch(r"[A-Za-z]\d*'?", token):
        return token.upper()
    return ""


def _normalize_token(raw: Any) -> str:
    return re.sub(r"\s+", "", str(raw or "").strip().replace("′", "'").replace("`", "'"))


def _pair_label(pair: frozenset[str]) -> str:
    return "".join(sorted(pair))


def _point_aliases(scene: Dict[str, Any], geometry_ir: Dict[str, Any]) -> Dict[str, str]:
    canonical_ids = _geometry_point_ids(geometry_ir)
    aliases: Dict[str, str] = {}

    def add_alias(raw_id: Any, raw_label: Any = "") -> None:
        point_id = _normalize_token(raw_id)
        label = _normalize_token(raw_label)
        if label and _looks_like_point(label) and point_id and point_id != label:
            aliases[point_id] = label.upper()
            return
        match = re.fullmatch(r"([A-Za-z])1", point_id)
        if not match:
            return
        prime_id = f"{match.group(1).upper()}'"
        if prime_id in canonical_ids:
            aliases[point_id] = prime_id

    points = scene.get("points")
    if isinstance(points, dict):
        for point_id, payload in points.items():
            label = payload.get("label") if isinstance(payload, dict) else ""
            add_alias(point_id, label)
    elif isinstance(points, list):
        for item in points:
            if not isinstance(item, dict):
                continue
            add_alias(item.get("id"), item.get("label"))

    for point_id in canonical_ids:
        add_alias(point_id)
    return aliases


def _geometry_point_ids(geometry_ir: Dict[str, Any]) -> set[str]:
    point_ids: set[str] = set()
    scene_draft = (
        geometry_ir.get("scene_draft")
        if isinstance(geometry_ir.get("scene_draft"), dict)
        else {}
    )
    for item in scene_draft.get("points") or []:
        if not isinstance(item, dict):
            continue
        point_id = _normalize_point(item.get("id"))
        if point_id:
            point_ids.add(point_id)

    facts = geometry_ir.get("facts") if isinstance(geometry_ir.get("facts"), dict) else {}
    visual = (
        facts.get("visual_observed")
        if isinstance(facts.get("visual_observed"), dict)
        else {}
    )
    for item in visual.get("points") or []:
        if isinstance(item, dict):
            point_id = _normalize_point(item.get("id") or item.get("label"))
        else:
            point_id = _normalize_point(item)
        if point_id:
            point_ids.add(point_id)
    return point_ids


def _looks_like_point(raw: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z]\d*'?", str(raw or "")))


def _geometry_display_policy(
    geometry_ir: Dict[str, Any],
    point_aliases: Dict[str, str],
) -> Dict[str, Dict[str, Dict[str, Any]]]:
    policy: Dict[str, Dict[str, Dict[str, Any]]] = {"by_id": {}, "by_pair": {}}

    def add_display(primitive_id: Any, payload: Any) -> None:
        if not isinstance(payload, dict):
            return
        primitive_id_str = _normalize_token(primitive_id)
        if not primitive_id_str:
            return
        existing = policy["by_id"].setdefault(primitive_id_str, {})
        existing.update(copy.deepcopy(payload))
        segment = _segment_from_id(primitive_id_str, point_aliases)
        if len(segment) == 2:
            pair = _pair_from_points(segment, point_aliases)
            if pair:
                pair_payload = policy["by_pair"].setdefault(_pair_label(pair), {})
                pair_payload.update(copy.deepcopy(payload))

    def add_scene_segment(item: Any) -> None:
        if not isinstance(item, dict):
            return
        segment_id = str(item.get("id", "")).strip()
        points = item.get("points") or item.get("endpoints") or []
        if not segment_id and isinstance(points, (list, tuple)) and len(points) == 2:
            segment_id = f"seg_{points[0]}{points[1]}"
        payload: Dict[str, Any] = {}
        for key in ("style", "role", "source", "visible", "show"):
            if key in item:
                payload[key] = copy.deepcopy(item[key])
        if item.get("visible") is False:
            payload["show"] = False
        if segment_id and payload:
            add_display(segment_id, payload)
        pair = _pair_from_points(points, point_aliases) if isinstance(points, (list, tuple)) else None
        if pair and payload:
            pair_payload = policy["by_pair"].setdefault(_pair_label(pair), {})
            pair_payload.update(copy.deepcopy(payload))

    scene_draft = (
        geometry_ir.get("scene_draft")
        if isinstance(geometry_ir.get("scene_draft"), dict)
        else {}
    )
    for item in scene_draft.get("visible_segments") or []:
        add_scene_segment(item)
    for source in (
        scene_draft.get("display") if isinstance(scene_draft.get("display"), dict) else {},
        (
            geometry_ir.get("geometry_facts", {}).get("display")
            if isinstance(geometry_ir.get("geometry_facts"), dict)
            and isinstance(geometry_ir.get("geometry_facts", {}).get("display"), dict)
            else {}
        ),
        (
            geometry_ir.get("facts", {}).get("visual_observed", {}).get("display")
            if isinstance(geometry_ir.get("facts"), dict)
            and isinstance(geometry_ir.get("facts", {}).get("visual_observed"), dict)
            and isinstance(
                geometry_ir.get("facts", {})
                .get("visual_observed", {})
                .get("display"),
                dict,
            )
            else {}
        ),
    ):
        primitive_display = (
            source.get("primitives") if isinstance(source.get("primitives"), dict) else {}
        )
        for primitive_id, payload in primitive_display.items():
            add_display(primitive_id, payload)
    return policy


def _display_payload_for_primitive(
    primitive: Dict[str, Any],
    pair: Optional[frozenset[str]],
    display_policy: Dict[str, Dict[str, Dict[str, Any]]],
) -> Dict[str, Any]:
    primitive_id = _normalize_token(primitive.get("id"))
    payload: Dict[str, Any] = {}
    if pair:
        payload.update(copy.deepcopy(display_policy.get("by_pair", {}).get(_pair_label(pair), {})))
    if primitive_id:
        payload.update(copy.deepcopy(display_policy.get("by_id", {}).get(primitive_id, {})))
    return payload


def _display_hidden(payload: Optional[Dict[str, Any]]) -> bool:
    if not isinstance(payload, dict):
        return False
    return payload.get("show") is False or payload.get("visible") is False


def _merge_primitive_display(
    scene: Dict[str, Any],
    primitive: Dict[str, Any],
    pair: Optional[frozenset[str]],
    display_payload: Optional[Dict[str, Any]],
) -> None:
    if not isinstance(display_payload, dict) or not display_payload:
        return
    primitive_id = str(primitive.get("id", "")).strip()
    if not primitive_id:
        return
    display = scene.setdefault("display", {})
    if not isinstance(display, dict):
        scene["display"] = display = {}
    primitive_display = display.setdefault("primitives", {})
    if not isinstance(primitive_display, dict):
        display["primitives"] = primitive_display = {}
    existing = primitive_display.setdefault(primitive_id, {})
    if not isinstance(existing, dict):
        existing = {}
    merged = copy.deepcopy(existing)
    merged.update(copy.deepcopy(display_payload))
    primitive_display[primitive_id] = merged


def _suppressed_payload(
    primitive: Dict[str, Any],
    pair: Optional[frozenset[str]],
    reason: str,
) -> Dict[str, Any]:
    return {
        "id": str(primitive.get("id", "")).strip(),
        "type": str(primitive.get("type", "")).strip().lower(),
        "points": sorted(pair) if pair else [],
        "pair": _pair_label(pair) if pair else "",
        "reason": reason,
    }


def _rejected_payload(
    primitive: Dict[str, Any],
    pair: frozenset[str],
    reason: str,
) -> Dict[str, Any]:
    return {
        "id": str(primitive.get("id", "")).strip(),
        "type": str(primitive.get("type", "")).strip().lower(),
        "points": sorted(pair),
        "pair": _pair_label(pair),
        "reason": reason,
    }


def _report(
    *,
    skipped: bool,
    reason: str = "",
    allowed_pairs: Optional[set[frozenset[str]]] = None,
    allowed_sources: Optional[Dict[str, List[str]]] = None,
    rejected: Optional[List[Dict[str, Any]]] = None,
    suppressed: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    rejected_items = rejected or []
    suppressed_items = suppressed or []
    return {
        "version": "render_topology.v1",
        "skipped": skipped,
        "reason": reason,
        "is_valid": not rejected_items,
        "allowed_pairs": sorted(_pair_label(pair) for pair in (allowed_pairs or set())),
        "allowed_sources": copy.deepcopy(allowed_sources or {}),
        "rejected_count": len(rejected_items),
        "rejected": rejected_items,
        "suppressed_count": len(suppressed_items),
        "suppressed": suppressed_items,
    }
