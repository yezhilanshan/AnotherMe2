"""Helpers for preserving source-image pixel anchors on geometry points."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Tuple, Union

PIXEL_COORD_KEYS = (
    "pixel_coord",
    "pixel_position",
    "image_coord",
    "image_position",
    "bbox_position",
    "source_pixel",
)

PIXEL_SPACE_KEYS = (
    "pixel_coord_space",
    "pixel_space",
    "coordinate_space",
    "image_space",
)

BBOX_KEYS = (
    "bbox",
    "bounding_box",
    "box",
    "detection_box",
    "point_bbox",
)

LABEL_BBOX_KEYS = (
    "label_bbox",
    "label_box",
    "text_bbox",
    "text_box",
    "label_detection_box",
)

GEOMETRY_COORD_KEYS = (
    "coord",
    "pos",
    "position",
)


def coerce_point_geometry_coord(payload: Dict[str, Any]) -> Optional[List[float]]:
    """Return the canonical 2D geometry coordinate from supported point fields."""

    if not isinstance(payload, dict):
        return None
    for key in GEOMETRY_COORD_KEYS:
        coord = _coerce_xy_pair(payload.get(key))
        if coord is not None:
            return [float(coord[0]), float(coord[1])]
    return None


def scene_point_coordinates(scene: Dict[str, Any]) -> Dict[str, List[float]]:
    """Extract point coordinates from either dict- or list-shaped scene payloads."""

    result: Dict[str, List[float]] = {}
    if not isinstance(scene, dict):
        return result

    points = scene.get("points", {})
    if isinstance(points, dict):
        for point_id, payload in points.items():
            if not isinstance(payload, dict):
                continue
            coord = coerce_point_geometry_coord(payload)
            if coord is not None and str(point_id).strip():
                result[str(point_id)] = coord
        return result

    if isinstance(points, list):
        for item in points:
            if not isinstance(item, dict):
                continue
            point_id = str(item.get("id", "")).strip()
            coord = coerce_point_geometry_coord(item)
            if point_id and coord is not None:
                result[point_id] = coord
    return result


def normalize_point_pixel_anchor(
    payload: Dict[str, Any],
    *,
    image_size: Optional[Tuple[Optional[int], Optional[int]]] = None,
    default_space: str = "source",
) -> bool:
    """Normalize supported pixel/bbox fields into `pixel_coord`.

    The pipeline accepts model and detector payloads that use several aliases for
    point anchors. This helper preserves the original fields while adding a
    canonical `pixel_coord`, `pixel_coord_space`, and `pixel_anchor_source` when
    enough information is available.
    """

    if not isinstance(payload, dict):
        return False

    normalize_point_label_bbox(payload, image_size=image_size, default_space=default_space)

    space = _normalize_space(_first_space(payload)) or default_space
    coord, source = _find_xy_anchor(payload)
    if coord is None:
        coord, source = _find_bbox_anchor(payload)

    if coord is None:
        visual = payload.get("visual")
        if isinstance(visual, dict):
            space = _normalize_space(_first_space(visual)) or space
            coord, source = _find_xy_anchor(visual, prefix="visual.")
            if coord is None:
                coord, source = _find_bbox_anchor(visual, prefix="visual.")

    if coord is None:
        return False

    x, y = _scale_unit_coord(coord, image_size)
    payload["pixel_coord"] = {"x": _clean_number(x), "y": _clean_number(y)}
    payload["pixel_coord_space"] = space
    payload.setdefault("pixel_anchor_source", source or "pixel_coord")
    return True


def normalize_point_label_bbox(
    payload: Dict[str, Any],
    *,
    image_size: Optional[Tuple[Optional[int], Optional[int]]] = None,
    default_space: str = "source",
) -> bool:
    """Normalize label/text bounding boxes without treating them as point anchors."""

    if not isinstance(payload, dict):
        return False

    bbox, source = _find_label_bbox(payload)
    space = _normalize_space(_first_space(payload)) or default_space
    if bbox is None:
        visual = payload.get("visual")
        if isinstance(visual, dict):
            bbox, source = _find_label_bbox(visual, prefix="visual.")
            space = _normalize_space(_first_space(visual)) or space
    if bbox is None:
        return False

    x1, y1, x2, y2 = _scale_unit_bbox(bbox, image_size)
    payload["label_bbox"] = {
        "x1": _clean_number(min(x1, x2)),
        "y1": _clean_number(min(y1, y2)),
        "x2": _clean_number(max(x1, x2)),
        "y2": _clean_number(max(y1, y2)),
    }
    payload["label_bbox_space"] = space
    payload.setdefault("label_bbox_source", source or "label_bbox")
    return True


def point_has_pixel_anchor(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    return (
        _find_xy_anchor(payload)[0] is not None
        or _find_bbox_anchor(payload)[0] is not None
    )


def _find_xy_anchor(
    payload: Dict[str, Any], *, prefix: str = ""
) -> Tuple[Optional[Tuple[float, float]], str]:
    for key in PIXEL_COORD_KEYS:
        coord = _coerce_xy_pair(payload.get(key))
        if coord is not None:
            return coord, f"{prefix}{key}"
    return None, ""


def _find_bbox_anchor(
    payload: Dict[str, Any], *, prefix: str = ""
) -> Tuple[Optional[Tuple[float, float]], str]:
    for key in BBOX_KEYS:
        coord = _coerce_bbox_center(payload.get(key))
        if coord is not None:
            return coord, f"{prefix}{key}_center"
    return None, ""


def _find_label_bbox(
    payload: Dict[str, Any], *, prefix: str = ""
) -> Tuple[Optional[Tuple[float, float, float, float]], str]:
    for key in LABEL_BBOX_KEYS:
        bbox = _coerce_bbox(payload.get(key))
        if bbox is not None:
            return bbox, f"{prefix}{key}"
    return None, ""


def _coerce_xy_pair(value: Any) -> Optional[Tuple[float, float]]:
    if isinstance(value, dict):
        if "x" in value and "y" in value:
            return _float_pair(value.get("x"), value.get("y"))
        if "left" in value and "top" in value:
            return _float_pair(value.get("left"), value.get("top"))
        if "cx" in value and "cy" in value:
            return _float_pair(value.get("cx"), value.get("cy"))
        if "center_x" in value and "center_y" in value:
            return _float_pair(value.get("center_x"), value.get("center_y"))
        center = value.get("center")
        if center is not None:
            return _coerce_xy_pair(center)
        return None
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        return _float_pair(value[0], value[1])
    return None


def _coerce_bbox(value: Any) -> Optional[Tuple[float, float, float, float]]:
    if isinstance(value, dict):
        if "x1" in value and "y1" in value and "x2" in value and "y2" in value:
            pair1 = _float_pair(value.get("x1"), value.get("y1"))
            pair2 = _float_pair(value.get("x2"), value.get("y2"))
            if pair1 is not None and pair2 is not None:
                return pair1[0], pair1[1], pair2[0], pair2[1]

        if all(key in value for key in ("left", "top", "right", "bottom")):
            pair1 = _float_pair(value.get("left"), value.get("top"))
            pair2 = _float_pair(value.get("right"), value.get("bottom"))
            if pair1 is not None and pair2 is not None:
                return pair1[0], pair1[1], pair2[0], pair2[1]

        if all(key in value for key in ("x", "y", "width", "height")):
            origin = _float_pair(value.get("x"), value.get("y"))
            size = _float_pair(value.get("width"), value.get("height"))
            if origin is not None and size is not None:
                return (
                    origin[0],
                    origin[1],
                    origin[0] + size[0],
                    origin[1] + size[1],
                )
        return None

    if isinstance(value, (list, tuple)) and len(value) >= 4:
        numbers = _float_values(value[:4])
        if numbers is None:
            return None
        return numbers
    return None


def _coerce_bbox_center(value: Any) -> Optional[Tuple[float, float]]:
    if isinstance(value, dict):
        center = value.get("center") or value.get("centroid")
        if center is not None:
            coord = _coerce_xy_pair(center)
            if coord is not None:
                return coord

        if "x1" in value and "y1" in value and "x2" in value and "y2" in value:
            pair1 = _float_pair(value.get("x1"), value.get("y1"))
            pair2 = _float_pair(value.get("x2"), value.get("y2"))
            if pair1 is not None and pair2 is not None:
                return ((pair1[0] + pair2[0]) / 2.0, (pair1[1] + pair2[1]) / 2.0)

        if all(key in value for key in ("left", "top", "right", "bottom")):
            pair1 = _float_pair(value.get("left"), value.get("top"))
            pair2 = _float_pair(value.get("right"), value.get("bottom"))
            if pair1 is not None and pair2 is not None:
                return ((pair1[0] + pair2[0]) / 2.0, (pair1[1] + pair2[1]) / 2.0)

        if all(key in value for key in ("x", "y", "width", "height")):
            origin = _float_pair(value.get("x"), value.get("y"))
            size = _float_pair(value.get("width"), value.get("height"))
            if origin is not None and size is not None:
                return (origin[0] + size[0] / 2.0, origin[1] + size[1] / 2.0)
        return None

    if isinstance(value, (list, tuple)) and len(value) >= 4:
        numbers = _float_values(value[:4])
        if numbers is None:
            return None
        x1, y1, x2, y2 = numbers
        return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)
    return None


def _first_space(payload: Dict[str, Any]) -> str:
    for key in PIXEL_SPACE_KEYS:
        value = str(payload.get(key, "")).strip()
        if value:
            return value
    return ""


def _normalize_space(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"crop", "cropped", "crop_image"}:
        return "crop"
    if normalized in {"source", "original", "original_image", "full_image"}:
        return "source"
    return ""


def _scale_unit_coord(
    coord: Tuple[float, float],
    image_size: Optional[Tuple[Optional[int], Optional[int]]],
) -> Tuple[float, float]:
    x, y = coord
    if not image_size or len(image_size) != 2:
        return x, y
    width, height = image_size
    try:
        width_f = float(width) if width else 0.0
        height_f = float(height) if height else 0.0
    except (TypeError, ValueError):
        return x, y
    if width_f <= 0 or height_f <= 0:
        return x, y
    if 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0:
        return x * width_f, y * height_f
    return x, y


def _scale_unit_bbox(
    bbox: Tuple[float, float, float, float],
    image_size: Optional[Tuple[Optional[int], Optional[int]]],
) -> Tuple[float, float, float, float]:
    x1, y1, x2, y2 = bbox
    if not image_size or len(image_size) != 2:
        return x1, y1, x2, y2
    width, height = image_size
    try:
        width_f = float(width) if width else 0.0
        height_f = float(height) if height else 0.0
    except (TypeError, ValueError):
        return x1, y1, x2, y2
    if width_f <= 0 or height_f <= 0:
        return x1, y1, x2, y2
    values = (x1, y1, x2, y2)
    if all(0.0 <= value <= 1.0 for value in values):
        return x1 * width_f, y1 * height_f, x2 * width_f, y2 * height_f
    return x1, y1, x2, y2


def _float_pair(x_raw: Any, y_raw: Any) -> Optional[Tuple[float, float]]:
    try:
        return float(x_raw), float(y_raw)
    except (TypeError, ValueError):
        return None


def _float_values(values: Iterable[Any]) -> Optional[Tuple[float, float, float, float]]:
    try:
        converted = tuple(float(value) for value in values)
    except (TypeError, ValueError):
        return None
    if len(converted) != 4:
        return None
    return converted  # type: ignore[return-value]


def _clean_number(value: float) -> Union[float, int]:
    rounded = round(float(value), 6)
    if abs(rounded - round(rounded)) < 1e-9:
        return int(round(rounded))
    return rounded
