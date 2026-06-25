"""Stable intermediate representation for geometry vision facts."""

from __future__ import annotations

import copy
import re
from typing import Any, Dict, List, Optional, Tuple

from .pixel_anchor import normalize_point_pixel_anchor


VISUAL_OBSERVED = "visual_observed"
TEXT_EXPLICIT = "text_explicit"
SOLVER_DERIVED = "solver_derived"

INTERGPS_SCHEMA = "intergps_predicates.v1"

INTERGPS_BUCKETS = (
    "geometric_shapes",
    "unary_attributes",
    "geometric_attributes",
    "binary_relations",
    "isxof_relations",
    "numerical_relations",
)

INTERGPS_RELATION_BUCKETS = {
    "point_on_segment": "binary_relations",
    "point_on_line": "binary_relations",
    "collinear": "binary_relations",
    "point_on_circle": "binary_relations",
    "parallel": "binary_relations",
    "perpendicular": "binary_relations",
    "intersect": "binary_relations",
    "intersect_at": "binary_relations",
    "bisects_angle": "binary_relations",
    "angle_bisector": "binary_relations",
    "congruent": "binary_relations",
    "similar": "binary_relations",
    "tangent": "binary_relations",
    "secant": "binary_relations",
    "circumscribed_to": "binary_relations",
    "inscribed_in": "binary_relations",
    "midpoint": "isxof_relations",
    "is_midpoint_of": "isxof_relations",
    "centroid": "isxof_relations",
    "incenter": "isxof_relations",
    "radius": "isxof_relations",
    "diameter": "isxof_relations",
    "midsegment": "isxof_relations",
    "chord": "isxof_relations",
    "side": "isxof_relations",
    "hypotenuse": "isxof_relations",
    "perpendicular_bisector": "isxof_relations",
    "altitude": "isxof_relations",
    "median": "isxof_relations",
    "base": "isxof_relations",
    "diagonal": "isxof_relations",
    "leg": "isxof_relations",
}

INTERGPS_BINARY_PREDICATES = {
    "parallel": "Parallel",
    "perpendicular": "Perpendicular",
    "intersect": "IntersectAt",
    "intersect_at": "IntersectAt",
    "bisects_angle": "BisectsAngle",
    "angle_bisector": "BisectsAngle",
    "congruent": "Congruent",
    "similar": "Similar",
    "tangent": "Tangent",
    "secant": "Secant",
    "circumscribed_to": "CircumscribedTo",
    "inscribed_in": "InscribedIn",
}

INTERGPS_ISXOF_PREDICATES = {
    "midpoint": "IsMidpointOf",
    "is_midpoint_of": "IsMidpointOf",
    "centroid": "IsCentroidOf",
    "incenter": "IsIncenterOf",
    "radius": "IsRadiusOf",
    "diameter": "IsDiameterOf",
    "midsegment": "IsMidsegmentOf",
    "chord": "IsChordOf",
    "side": "IsSideOf",
    "hypotenuse": "IsHypotenuseOf",
    "perpendicular_bisector": "IsPerpendicularBisectorOf",
    "altitude": "IsAltitudeOf",
    "median": "IsMedianOf",
    "base": "IsBaseOf",
    "diagonal": "IsDiagonalOf",
    "leg": "IsLegOf",
}

INTERGPS_UNARY_ATTRIBUTE_PREDICATES = {
    "right": "Right",
    "right_triangle": "Right",
    "isosceles": "Isosceles",
    "equilateral": "Equilateral",
    "regular": "Regular",
    "red": "Red",
    "blue": "Blue",
    "green": "Green",
    "shaded": "Shaded",
}

INTERGPS_ATTRIBUTE_FOR_MEASUREMENT = {
    "area": "AreaOf",
    "perimeter": "PerimeterOf",
    "circumference": "CircumferenceOf",
    "radius": "RadiusOf",
    "diameter": "DiameterOf",
    "altitude": "AltitudeOf",
    "hypotenuse": "HypotenuseOf",
    "side": "SideOf",
    "width": "WidthOf",
    "height": "HeightOf",
    "leg": "LegOf",
    "base": "BaseOf",
    "median": "MedianOf",
    "measure": "MeasureOf",
    "angle": "MeasureOf",
    "length": "LengthOf",
    "scale_factor": "ScaleFactorOf",
    "ratio": "RatioOf",
}


def build_scene_draft(
    geometry_facts: Optional[Dict[str, Any]],
    *,
    problem_text: str = "",
    image_size: Optional[Tuple[Optional[int], Optional[int]]] = None,
) -> Dict[str, Any]:
    """Build the vision-only draft consumed by the normalizer."""

    facts = copy.deepcopy(geometry_facts or {})
    points = _scene_points(facts.get("points"), image_size=image_size)
    point_ids = {point["id"] for point in points if point.get("id")}
    display = facts.get("display") if isinstance(facts.get("display"), dict) else {}
    primitive_display = (
        display.get("primitives") if isinstance(display.get("primitives"), dict) else {}
    )

    visible_segments: List[Dict[str, Any]] = []
    for token in _iter_segment_tokens(facts.get("segments")):
        endpoints = _segment_endpoints(token)
        if len(endpoints) != 2:
            continue
        segment_id = f"seg_{''.join(endpoints)}"
        style = primitive_display.get(segment_id, {})
        visible_segments.append(
            {
                "id": segment_id,
                "points": endpoints,
                "style": str(style.get("style", "solid")).strip() or "solid",
                "visible": bool(style.get("show", True)),
                "role": str(style.get("role", "observed_segment")).strip()
                or "observed_segment",
                "source": VISUAL_OBSERVED,
            }
        )

    fold_pairs = _infer_fold_pairs(problem_text=problem_text, point_ids=point_ids)
    return {
        "version": "scene_draft.v1",
        "problem_ocr": str(problem_text or "").strip(),
        "source_policy": {
            "pixel_coord_role": "visual_anchor_only",
            "forbid_final_manim_coordinates": True,
            "forbid_topology_invention": True,
        },
        "points": points,
        "visible_segments": _dedupe_objects(visible_segments),
        "polygons": copy.deepcopy(facts.get("polygons") or []),
        "circles": copy.deepcopy(facts.get("circles") or []),
        "arcs": copy.deepcopy(facts.get("arcs") or []),
        "angles": copy.deepcopy(facts.get("angles") or []),
        "right_angles": copy.deepcopy(facts.get("right_angles") or []),
        "fold_correspondences": fold_pairs,
        "display": copy.deepcopy(display or {"points": {}, "primitives": {}}),
    }


def build_geometry_ir(
    geometry_facts: Optional[Dict[str, Any]],
    *,
    problem_text: str,
    scene_draft: Optional[Dict[str, Any]] = None,
    image_size: Optional[Tuple[Optional[int], Optional[int]]] = None,
) -> Dict[str, Any]:
    """Build the single merge point for visual, text, and derived facts."""

    facts = copy.deepcopy(geometry_facts or {})
    draft = scene_draft or build_scene_draft(
        facts, problem_text=problem_text, image_size=image_size
    )
    visual = {
        "points": copy.deepcopy(facts.get("points") or []),
        "segments": copy.deepcopy(facts.get("segments") or []),
        "polygons": copy.deepcopy(facts.get("polygons") or []),
        "circles": copy.deepcopy(facts.get("circles") or []),
        "arcs": copy.deepcopy(facts.get("arcs") or []),
        "angles": copy.deepcopy(facts.get("angles") or []),
        "right_angles": copy.deepcopy(facts.get("right_angles") or []),
        "relations": copy.deepcopy(
            facts.get("observed_relations") or facts.get("relations") or []
        ),
        "measurements": copy.deepcopy(
            facts.get("observed_measurements") or facts.get("measurements") or []
        ),
        "display": copy.deepcopy(facts.get("display") or {"points": {}, "primitives": {}}),
    }
    visual["intergps"] = _build_intergps_fact_layer(visual, source=VISUAL_OBSERVED)
    text = {
        "relations": copy.deepcopy(facts.get("text_explicit_relations") or []),
        "measurements": copy.deepcopy(facts.get("text_explicit_measurements") or []),
        "goals": copy.deepcopy(
            facts.get("text_explicit_goals") or facts.get("goals") or []
        ),
        "theorems": copy.deepcopy(facts.get("text_explicit_theorems") or []),
    }
    text["intergps"] = _build_intergps_fact_layer(text, source=TEXT_EXPLICIT)
    derived = {
        "relations": copy.deepcopy(
            facts.get("derived_relations") or facts.get("inferred_relations") or []
        ),
        "measurements": copy.deepcopy(
            facts.get("derived_measurements") or facts.get("inferred_measurements") or []
        ),
        "goals": copy.deepcopy(facts.get("derived_goals") or []),
        "theorems": copy.deepcopy(facts.get("derived_theorems") or []),
    }
    derived["intergps"] = _build_intergps_fact_layer(derived, source=SOLVER_DERIVED)

    return {
        "version": "geometry_ir.v1",
        "problem_text": str(problem_text or "").strip(),
        "scene_draft": copy.deepcopy(draft),
        "facts": {
            VISUAL_OBSERVED: _with_bucket_source(visual, VISUAL_OBSERVED),
            TEXT_EXPLICIT: _with_bucket_source(text, TEXT_EXPLICIT),
            SOLVER_DERIVED: _with_bucket_source(derived, SOLVER_DERIVED),
            "unverified_observed": {
                "relations": copy.deepcopy(
                    facts.get("unverified_observed_relations") or []
                )
            },
        },
        "geometry_facts": facts,
        "merge_policy": {
            "compiler_hard_layers": [VISUAL_OBSERVED, TEXT_EXPLICIT],
            "derived_layer_requires_opt_in": True,
            "text_must_not_overwrite_visual": True,
            "pixel_anchors_are_layout_hints": True,
        },
    }


def compiler_facts_from_geometry_ir(geometry_ir: Dict[str, Any]) -> Dict[str, Any]:
    """Return the flattened compatibility view used by the current compiler."""

    base = copy.deepcopy(geometry_ir.get("geometry_facts") or {})
    facts = geometry_ir.get("facts") if isinstance(geometry_ir.get("facts"), dict) else {}
    visual = facts.get(VISUAL_OBSERVED) if isinstance(facts.get(VISUAL_OBSERVED), dict) else {}
    text = facts.get(TEXT_EXPLICIT) if isinstance(facts.get(TEXT_EXPLICIT), dict) else {}
    derived = facts.get(SOLVER_DERIVED) if isinstance(facts.get(SOLVER_DERIVED), dict) else {}

    for key in ("points", "segments", "polygons", "circles", "arcs", "angles", "right_angles", "display"):
        if key in visual:
            base[key] = copy.deepcopy(visual[key])
    base["observed_relations"] = copy.deepcopy(visual.get("relations") or [])
    base["observed_measurements"] = copy.deepcopy(visual.get("measurements") or [])
    base["text_explicit_relations"] = copy.deepcopy(text.get("relations") or [])
    base["text_explicit_measurements"] = copy.deepcopy(text.get("measurements") or [])
    base["derived_relations"] = copy.deepcopy(derived.get("relations") or [])
    base["derived_measurements"] = copy.deepcopy(derived.get("measurements") or [])
    return base


def _scene_points(
    raw_points: Any,
    *,
    image_size: Optional[Tuple[Optional[int], Optional[int]]],
) -> List[Dict[str, Any]]:
    points: List[Dict[str, Any]] = []
    for point_id, payload in _point_payloads(raw_points, image_size=image_size).items():
        item = {"id": point_id, "source": VISUAL_OBSERVED}
        for key in (
            "label",
            "pixel_coord",
            "pixel_coord_space",
            "pixel_anchor_source",
            "label_bbox",
            "label_bbox_space",
            "label_bbox_source",
        ):
            if key in payload:
                item[key] = copy.deepcopy(payload[key])
        points.append(item)
    return points


def _point_payloads(
    raw: Any,
    *,
    image_size: Optional[Tuple[Optional[int], Optional[int]]],
) -> Dict[str, Dict[str, Any]]:
    payloads: Dict[str, Dict[str, Any]] = {}

    def add(raw_id: Any, payload: Optional[Dict[str, Any]] = None) -> None:
        point_id = _normalize_point(raw_id)
        if not point_id:
            return
        item = copy.deepcopy(payload or {})
        item["id"] = point_id
        normalize_point_pixel_anchor(item, image_size=image_size)
        payloads[point_id] = item

    if isinstance(raw, dict):
        for key, value in raw.items():
            add(key, value if isinstance(value, dict) else None)
    elif isinstance(raw, (list, tuple)):
        for item in raw:
            if isinstance(item, dict):
                add(item.get("id") or item.get("name") or item.get("label"), item)
            else:
                add(item)
    else:
        add(raw)
    return payloads


def _iter_segment_tokens(raw: Any):
    if isinstance(raw, str):
        yield _normalize_segment(raw)
    elif isinstance(raw, dict):
        token = raw.get("id") or raw.get("name") or raw.get("segment")
        if token:
            yield _normalize_segment(token)
        points = raw.get("points") or raw.get("endpoints")
        if isinstance(points, (list, tuple)) and len(points) == 2:
            first = _normalize_point(points[0])
            second = _normalize_point(points[1])
            if first and second:
                yield first + second
    elif isinstance(raw, (list, tuple)):
        for item in raw:
            yield from _iter_segment_tokens(item)


def _normalize_segment(raw: Any) -> str:
    token = str(raw or "").strip().replace("′", "'").replace("`", "'")
    return re.sub(r"\s+", "", token)


def _normalize_point(raw: Any) -> str:
    token = str(raw or "").strip().replace("′", "'").replace("`", "'")
    token = re.sub(r"\s+", "", token)
    if re.fullmatch(r"[A-Za-z]\d*'?", token):
        return token.upper()
    return ""


def _segment_endpoints(segment: str) -> List[str]:
    token = _strip_wrapped_ref(_normalize_segment(segment), "Line")
    token = _strip_known_prefix(token, ("seg_", "line_"))
    refs = [_normalize_point(item) for item in re.findall(r"[A-Za-z]\d*'?", token)]
    refs = [item for item in refs if item]
    return refs[:2]


def _infer_fold_pairs(*, problem_text: str, point_ids: set[str]) -> List[Dict[str, Any]]:
    pairs: List[Dict[str, Any]] = []
    if not re.search(r"折叠|翻折|对折|fold|reflect", str(problem_text or ""), re.IGNORECASE):
        return pairs
    for point_id in sorted(point_ids):
        if not point_id.endswith("'"):
            continue
        base = point_id[:-1]
        if base in point_ids:
            pairs.append(
                {
                    "source": base,
                    "image": point_id,
                    "source_type": "fold_correspondence",
                }
            )
    return pairs


def _with_bucket_source(payload: Dict[str, Any], source: str) -> Dict[str, Any]:
    result = copy.deepcopy(payload)
    result["source"] = source
    return result


def _build_intergps_visual_observed(visual: Dict[str, Any]) -> Dict[str, Any]:
    return _build_intergps_fact_layer(visual, source=VISUAL_OBSERVED)


def _build_intergps_fact_layer(layer: Dict[str, Any], *, source: str) -> Dict[str, Any]:
    intergps: Dict[str, Any] = {
        "schema": INTERGPS_SCHEMA,
        "source": source,
        "predicate_groups": list(INTERGPS_BUCKETS),
        "logic_forms": [],
    }
    for bucket in INTERGPS_BUCKETS:
        intergps[bucket] = []

    def add(
        bucket: str,
        predicate: str,
        logic_form: str,
        payload: Dict[str, Any],
    ) -> None:
        if bucket not in INTERGPS_BUCKETS or not logic_form:
            return
        item = {
            "predicate": predicate,
            "logic_form": logic_form,
            "source": source,
            "payload": copy.deepcopy(payload),
        }
        if item in intergps[bucket]:
            return
        intergps[bucket].append(item)
        if logic_form not in intergps["logic_forms"]:
            intergps["logic_forms"].append(logic_form)

    for point_id in _iter_point_ids(layer.get("points")):
        add(
            "geometric_shapes",
            "Point",
            f"Point({point_id})",
            {"point": point_id},
        )

    for segment in _iter_segment_tokens(layer.get("segments")):
        endpoints = _segment_endpoints(segment)
        if len(endpoints) != 2:
            continue
        add(
            "geometric_shapes",
            "Line",
            _line_form(endpoints),
            {"segment": "".join(endpoints), "points": endpoints},
        )

    for polygon in layer.get("polygons") or []:
        polygon_points = _polygon_points(polygon)
        if len(polygon_points) < 3:
            continue
        predicate = _polygon_predicate(polygon_points, polygon)
        add(
            "geometric_shapes",
            predicate,
            f"{predicate}({','.join(polygon_points)})",
            {"polygon": copy.deepcopy(polygon), "points": polygon_points},
        )

    for circle in layer.get("circles") or []:
        circle_id = _circle_ref(circle)
        if not circle_id:
            continue
        add(
            "geometric_shapes",
            "Circle",
            f"Circle({circle_id})",
            {"circle": copy.deepcopy(circle), "circle_ref": circle_id},
        )

    for arc in layer.get("arcs") or []:
        arc_points = _arc_points(arc)
        if len(arc_points) not in {2, 3}:
            continue
        add(
            "geometric_shapes",
            "Arc",
            f"Arc({','.join(arc_points)})",
            {"arc": copy.deepcopy(arc), "points": arc_points},
        )

    for angle in layer.get("angles") or []:
        angle_points = _angle_points(angle)
        angle_name = _angle_form(angle_points, angle)
        if not angle_name:
            continue
        add(
            "geometric_shapes",
            "Angle",
            angle_name,
            {"angle": copy.deepcopy(angle), "points": angle_points},
        )

    for angle in layer.get("right_angles") or []:
        angle_points = _angle_points(angle)
        angle_name = _angle_form(angle_points, angle)
        if not angle_name:
            continue
        add(
            "unary_attributes",
            "RightAngle",
            f"RightAngle({angle_name})",
            {"angle": copy.deepcopy(angle), "points": angle_points},
        )

    for attribute in layer.get("attributes") or []:
        if isinstance(attribute, dict):
            _add_intergps_unary_attribute(add, attribute)

    for relation in layer.get("relations") or []:
        if not isinstance(relation, dict):
            continue
        _add_intergps_relation(add, relation)

    for measurement in layer.get("measurements") or []:
        if not isinstance(measurement, dict):
            continue
        _add_intergps_measurement(add, measurement)

    for goal in layer.get("goals") or []:
        _add_intergps_goal(add, goal)

    for theorem in layer.get("theorems") or []:
        _add_intergps_theorem(add, theorem)

    return intergps


def _iter_point_ids(raw: Any):
    if isinstance(raw, dict):
        for key, value in raw.items():
            point_id = _normalize_point(
                value.get("id") or value.get("name") or value.get("label")
                if isinstance(value, dict)
                else key
            )
            if point_id:
                yield point_id
    elif isinstance(raw, (list, tuple)):
        for item in raw:
            if isinstance(item, dict):
                point_id = _normalize_point(
                    item.get("id") or item.get("name") or item.get("label")
                )
            else:
                point_id = _normalize_point(item)
            if point_id:
                yield point_id
    else:
        point_id = _normalize_point(raw)
        if point_id:
            yield point_id


def _polygon_points(raw: Any) -> List[str]:
    if isinstance(raw, str):
        raw = _strip_wrapped_shape_ref(_strip_known_prefix(raw, ("poly_",)))
        return [
            _normalize_point(item)
            for item in re.findall(r"[A-Za-z]\d*'?", raw)
            if _normalize_point(item)
        ]
    if isinstance(raw, dict):
        points = raw.get("points") or raw.get("vertices") or raw.get("entities")
        if isinstance(points, (list, tuple)):
            return [
                _normalize_point(item) for item in points if _normalize_point(item)
            ]
        token = raw.get("id") or raw.get("name") or raw.get("polygon")
        return _polygon_points(token)
    if isinstance(raw, (list, tuple)):
        return [_normalize_point(item) for item in raw if _normalize_point(item)]
    return []


def _polygon_predicate(points: List[str], raw: Any) -> str:
    raw_type = ""
    if isinstance(raw, dict):
        raw_type = str(raw.get("type") or raw.get("shape_type") or "").strip().lower()
    by_type = {
        "triangle": "Triangle",
        "quadrilateral": "Quadrilateral",
        "parallelogram": "Parallelogram",
        "square": "Square",
        "rectangle": "Rectangle",
        "rhombus": "Rhombus",
        "trapezoid": "Trapezoid",
        "kite": "Kite",
        "pentagon": "Pentagon",
        "hexagon": "Hexagon",
        "heptagon": "Heptagon",
        "octagon": "Octagon",
    }
    if raw_type in by_type:
        return by_type[raw_type]
    by_size = {
        3: "Triangle",
        4: "Quadrilateral",
        5: "Pentagon",
        6: "Hexagon",
        7: "Heptagon",
        8: "Octagon",
    }
    return by_size.get(len(points), "Polygon")


def _circle_ref(raw: Any) -> str:
    if isinstance(raw, str):
        token = _strip_wrapped_ref(raw.strip(), "Circle")
        token = _strip_known_prefix(token, ("circle_",))
        return _normalize_point(token) or token
    if isinstance(raw, dict):
        center = _normalize_point(raw.get("center"))
        if center:
            return center
        token = str(raw.get("id") or raw.get("name") or raw.get("circle") or "").strip()
        if token.startswith("circle_"):
            token = token[len("circle_") :]
        return _normalize_point(token) or token
    return ""


def _arc_points(raw: Any) -> List[str]:
    if isinstance(raw, dict):
        points = raw.get("points") or raw.get("endpoints") or raw.get("entities")
        if isinstance(points, (list, tuple)):
            return [
                _normalize_point(item) for item in points if _normalize_point(item)
            ][:3]
        token = raw.get("id") or raw.get("name") or raw.get("arc")
        return _arc_points(token)
    if isinstance(raw, str):
        raw = _strip_wrapped_ref(_strip_known_prefix(raw, ("arc_",)), "Arc")
        return [
            _normalize_point(item)
            for item in re.findall(r"[A-Za-z]\d*'?", raw)
            if _normalize_point(item)
        ][:3]
    if isinstance(raw, (list, tuple)):
        return [_normalize_point(item) for item in raw if _normalize_point(item)][:3]
    return []


def _angle_points(raw: Any) -> List[str]:
    if isinstance(raw, dict):
        points = raw.get("points") or raw.get("vertices") or raw.get("entities")
        if isinstance(points, (list, tuple)):
            return [
                _normalize_point(item) for item in points if _normalize_point(item)
            ][:3]
        angle = raw.get("angle") or raw.get("id") or raw.get("name")
        return _angle_points(angle)
    if isinstance(raw, str):
        raw = _strip_wrapped_ref(_strip_known_prefix(raw, ("angle_", "ang_")), "Angle")
        return [
            _normalize_point(item)
            for item in re.findall(r"[A-Za-z]\d*'?", raw)
            if _normalize_point(item)
        ][:3]
    if isinstance(raw, (list, tuple)):
        return [_normalize_point(item) for item in raw if _normalize_point(item)][:3]
    return []


def _angle_form(points: List[str], raw: Any) -> str:
    if len(points) == 3:
        return f"Angle({','.join(points)})"
    if len(points) == 1:
        return f"Angle({points[0]})"
    if isinstance(raw, dict):
        label = str(raw.get("label") or raw.get("id") or raw.get("name") or "").strip()
    else:
        label = str(raw or "").strip()
    if label:
        cleaned = label.replace("∠", "").strip()
        if cleaned:
            return f"Angle({cleaned})"
    return ""


def _line_form(points: List[str]) -> str:
    return f"Line({points[0]},{points[1]})"


def _line_form_from_ref(raw: Any) -> str:
    if isinstance(raw, dict):
        points = raw.get("points") or raw.get("endpoints") or raw.get("entities")
        if isinstance(points, (list, tuple)) and len(points) >= 2:
            normalized = [_normalize_point(item) for item in points if _normalize_point(item)]
            if len(normalized) >= 2:
                return _line_form(normalized[:2])
        token = raw.get("id") or raw.get("name") or raw.get("segment") or raw.get("line")
        return _line_form_from_ref(token)
    if isinstance(raw, (list, tuple)):
        normalized = [_normalize_point(item) for item in raw if _normalize_point(item)]
        if len(normalized) >= 2:
            return _line_form(normalized[:2])
        return ""
    points = _segment_endpoints(_normalize_segment(raw))
    if len(points) == 2:
        return _line_form(points)
    return ""


def _shape_form_from_ref(raw: Any) -> str:
    circle_ref = _circle_ref(raw)
    if circle_ref and (
        isinstance(raw, dict)
        or str(raw or "").strip().lower().startswith("circle")
        or str(raw or "").strip().startswith(("⊙", "○"))
    ):
        return f"Circle({circle_ref})"
    points = _polygon_points(raw)
    if len(points) >= 3:
        predicate = _polygon_predicate(points, raw)
        return f"{predicate}({','.join(points)})"
    line_form = _line_form_from_ref(raw)
    if line_form:
        return line_form
    if circle_ref:
        return f"Circle({circle_ref})"
    return ""


def _relation_lines(relation: Dict[str, Any]) -> List[str]:
    raw_items: List[Any] = []
    for key in ("segments", "lines", "entities"):
        value = relation.get(key)
        if isinstance(value, (list, tuple)):
            raw_items.extend(value)
    for key in ("segment", "line", "segment1", "segment2", "line1", "line2"):
        if relation.get(key):
            raw_items.append(relation.get(key))
    forms: List[str] = []
    for item in raw_items:
        form = _line_form_from_ref(item)
        if form and form not in forms:
            forms.append(form)
    return forms


def _relation_shapes(relation: Dict[str, Any]) -> List[str]:
    raw_items: List[Any] = []
    for key in ("shapes", "polygons", "entities"):
        value = relation.get(key)
        if isinstance(value, (list, tuple)):
            raw_items.extend(value)
    for key in ("shape", "polygon", "shape1", "shape2", "polygon1", "polygon2"):
        if relation.get(key):
            raw_items.append(relation.get(key))
    forms: List[str] = []
    for item in raw_items:
        form = _shape_form_from_ref(item)
        if form and form not in forms:
            forms.append(form)
    return forms


def _relation_entity_list(relation: Dict[str, Any]) -> List[Any]:
    entities = relation.get("entities")
    return list(entities) if isinstance(entities, (list, tuple)) else []


def _add_intergps_relation(add, relation: Dict[str, Any]) -> None:
    relation_type = str(relation.get("type", "")).strip().lower()
    line_forms = _relation_lines(relation)
    entity_list = _relation_entity_list(relation)

    if relation_type in {"point_on_segment", "point_on_line", "collinear"}:
        point = _normalize_point(
            relation.get("point")
            or relation.get("entity")
            or (entity_list[0] if entity_list else "")
        )
        line_form = _line_form_from_ref(relation.get("segment") or relation.get("line"))
        if not line_form and line_forms:
            line_form = line_forms[0]
        if point and line_form:
            add(
                "binary_relations",
                "PointLiesOnLine",
                f"PointLiesOnLine(Point({point}),{line_form})",
                relation,
            )
        return

    if relation_type == "point_on_circle":
        point = _normalize_point(
            relation.get("point")
            or relation.get("entity")
            or (entity_list[0] if entity_list else "")
        )
        circle = _circle_ref(
            relation.get("circle")
            or relation.get("target")
            or (entity_list[1] if len(entity_list) > 1 else "")
        )
        if point and circle:
            add(
                "binary_relations",
                "PointLiesOnCircle",
                f"PointLiesOnCircle(Point({point}),Circle({circle}))",
                relation,
            )
        return

    if relation_type == "equal_length" and len(line_forms) >= 2:
        add(
            "numerical_relations",
            "Equals",
            f"Equals(LengthOf({line_forms[0]}),LengthOf({line_forms[1]}))",
            relation,
        )
        return

    if relation_type in INTERGPS_UNARY_ATTRIBUTE_PREDICATES:
        _add_intergps_unary_attribute(add, relation)
        return

    if relation_type in INTERGPS_BINARY_PREDICATES:
        predicate = INTERGPS_BINARY_PREDICATES[relation_type]
        args = line_forms
        if predicate in {"Congruent", "Similar", "CircumscribedTo", "InscribedIn"}:
            args = _relation_shapes(relation)
        elif predicate in {"Tangent", "Secant"}:
            circle = _circle_ref(
                relation.get("circle")
                or relation.get("target")
                or (entity_list[1] if len(entity_list) > 1 else "")
            )
            args = line_forms[:1] + ([f"Circle({circle})"] if circle else [])
        if predicate == "IntersectAt" and len(args) >= 2:
            point = _normalize_point(
                relation.get("point")
                or relation.get("intersection")
                or (entity_list[0] if entity_list else "")
            )
            logic_args = args[:2] + ([f"Point({point})"] if point else [])
            add(
                "binary_relations",
                predicate,
                f"{predicate}({','.join(logic_args)})",
                relation,
            )
        elif len(args) >= 2:
            add(
                "binary_relations",
                predicate,
                f"{predicate}({','.join(args[:2])})",
                relation,
        )
        return

    if relation_type in INTERGPS_ISXOF_PREDICATES:
        predicate = INTERGPS_ISXOF_PREDICATES[relation_type]
        point = _normalize_point(relation.get("point") or (entity_list[0] if entity_list else ""))
        line_form = _line_form_from_ref(
            relation.get("segment")
            or relation.get("line")
            or (entity_list[1] if len(entity_list) > 1 else entity_list[0] if entity_list else "")
        )
        target = _shape_form_from_ref(
            relation.get("shape")
            or relation.get("polygon")
            or relation.get("target")
            or (entity_list[1] if len(entity_list) > 1 else "")
        )
        if predicate == "IsMidpointOf" and point and line_form:
            add(
                "isxof_relations",
                predicate,
                f"{predicate}(Point({point}),{line_form})",
                relation,
            )
        elif line_form and target:
            add(
                "isxof_relations",
                predicate,
                f"{predicate}({line_form},{target})",
                relation,
            )


def _add_intergps_unary_attribute(add, attribute: Dict[str, Any]) -> None:
    relation_type = str(attribute.get("type", "")).strip().lower()
    predicate = INTERGPS_UNARY_ATTRIBUTE_PREDICATES.get(relation_type)
    if not predicate:
        return
    target = _shape_form_from_ref(
        attribute.get("shape")
        or attribute.get("polygon")
        or attribute.get("target")
        or attribute.get("entity")
        or attribute.get("entities")
    )
    if not target:
        return
    add(
        "unary_attributes",
        predicate,
        f"{predicate}({target})",
        attribute,
    )


def _add_intergps_measurement(add, measurement: Dict[str, Any]) -> None:
    measurement_type = str(measurement.get("type", "")).strip().lower()
    value = measurement.get("value")
    if value is None:
        value = measurement.get("measure")
    if value is None:
        return
    value_text = str(value).strip()
    if not value_text:
        return
    if measurement_type == "length":
        line_form = _line_form_from_ref(
            measurement.get("segment")
            or measurement.get("line")
            or measurement.get("entities")
        )
        if line_form:
            add(
                "numerical_relations",
                "Equals",
                f"Equals(LengthOf({line_form}),{value_text})",
                measurement,
            )
        return
    if measurement_type == "angle":
        angle_points = _angle_points(measurement.get("angle") or measurement)
        angle_form = _angle_form(angle_points, measurement.get("angle") or measurement)
        if angle_form:
            add(
                "numerical_relations",
                "Equals",
                f"Equals(MeasureOf({angle_form}),{value_text})",
                measurement,
        )
        return
    if measurement_type in {
        "area",
        "perimeter",
        "circumference",
        "radius",
        "diameter",
        "altitude",
        "hypotenuse",
        "side",
        "width",
        "height",
        "leg",
        "base",
        "median",
        "scale_factor",
    }:
        attribute = INTERGPS_ATTRIBUTE_FOR_MEASUREMENT.get(measurement_type)
        target = _measurement_target_form(measurement)
        if attribute and target:
            add(
                "numerical_relations",
                "Equals",
                f"Equals({attribute}({target}),{value_text})",
                measurement,
            )
        return
    if measurement_type == "ratio":
        target = (
            _measurement_target_form(measurement)
            or str(measurement.get("target") or measurement.get("entity") or "").strip()
        )
        if not target:
            return
        add(
            "numerical_relations",
            "Equals",
            f"Equals(RatioOf({target}),{value_text})",
            measurement,
        )


def _add_intergps_goal(add, goal: Any) -> None:
    target = _goal_target_form(goal)
    if not target:
        return
    add(
        "numerical_relations",
        "Find",
        f"Find({target})",
        goal if isinstance(goal, dict) else {"target": goal},
    )


def _add_intergps_theorem(add, theorem: Any) -> None:
    if isinstance(theorem, dict):
        token = str(theorem.get("name") or theorem.get("theorem") or theorem.get("id") or "").strip()
        payload = theorem
    else:
        token = str(theorem or "").strip()
        payload = {"theorem": token}
    if not token:
        return
    token = re.sub(r"\s+", "_", token)
    add("numerical_relations", "UseTheorem", f"UseTheorem({token})", payload)


def _measurement_target_form(measurement: Dict[str, Any]) -> str:
    for key in ("shape", "polygon", "circle", "target", "entity"):
        target = _shape_form_from_ref(measurement.get(key))
        if target:
            return target
    line_form = _line_form_from_ref(measurement.get("segment") or measurement.get("line"))
    if line_form:
        return line_form
    entities = measurement.get("entities")
    if isinstance(entities, (list, tuple)):
        if len(entities) == 2:
            line_form = _line_form_from_ref(entities)
            if line_form:
                return line_form
        if len(entities) >= 3:
            return _shape_form_from_ref(list(entities))
    return ""


def _goal_target_form(goal: Any) -> str:
    if isinstance(goal, dict):
        if goal.get("logic_form"):
            return str(goal.get("logic_form")).strip()
        measurement_type = str(goal.get("type") or goal.get("target_type") or "").strip().lower()
        if measurement_type in INTERGPS_ATTRIBUTE_FOR_MEASUREMENT:
            target = _measurement_target_form(goal)
            attribute = INTERGPS_ATTRIBUTE_FOR_MEASUREMENT[measurement_type]
            if target:
                return f"{attribute}({target})"
        target = _measurement_target_form(goal)
        if target:
            return target
        return str(goal.get("target") or goal.get("entity") or "").strip()
    return str(goal or "").strip()


def _strip_known_prefix(token: str, prefixes: Tuple[str, ...]) -> str:
    normalized = str(token or "").strip()
    lowered = normalized.lower()
    for prefix in prefixes:
        if lowered.startswith(prefix):
            return normalized[len(prefix) :]
    return normalized


def _strip_wrapped_ref(token: str, wrapper: str) -> str:
    value = str(token or "").strip()
    match = re.fullmatch(rf"{re.escape(wrapper)}\((.*)\)", value, flags=re.IGNORECASE)
    if match:
        return match.group(1)
    return value


def _strip_wrapped_shape_ref(token: str) -> str:
    value = str(token or "").strip()
    match = re.fullmatch(r"[A-Za-z_]+\((.*)\)", value)
    if match:
        return match.group(1)
    return value


def _dedupe_objects(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    deduped: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        key = repr(sorted(item.items(), key=lambda pair: pair[0]))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped
