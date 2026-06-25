"""Stable geometry context built from GeometryIR-first metadata."""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from .geometry_normalizer import GeometryNormalizer


@dataclass
class GeometryContext:
    stable_geometry_ir: Dict[str, Any]
    drawable_scene: Dict[str, Any]
    coordinate_scene: Dict[str, Any]
    semantic_graph: Dict[str, Any]
    geometry_facts: Dict[str, Any]
    geometry_spec: Dict[str, Any]
    problem_pattern: Dict[str, Any]
    points: List[str]
    segments: List[Dict[str, Any]]
    shapes: List[Dict[str, Any]]
    relations: List[Dict[str, Any]]
    templates: List[str]
    image_pairs: List[Dict[str, str]]

    @classmethod
    def from_metadata(
        cls,
        metadata: Dict[str, Any],
        *,
        problem_text: str = "",
    ) -> "GeometryContext":
        normalizer = GeometryNormalizer()
        drawable_scene = (
            metadata.get("drawable_scene")
            if isinstance(metadata.get("drawable_scene"), dict)
            else {}
        )
        coordinate_scene = (
            metadata.get("coordinate_scene")
            if isinstance(metadata.get("coordinate_scene"), dict)
            else {}
        )
        semantic_graph = (
            metadata.get("semantic_graph")
            if isinstance(metadata.get("semantic_graph"), dict)
            else {}
        )
        geometry_facts = (
            metadata.get("geometry_facts")
            if isinstance(metadata.get("geometry_facts"), dict)
            else {}
        )
        geometry_spec = (
            metadata.get("geometry_spec")
            if isinstance(metadata.get("geometry_spec"), dict)
            else {}
        )
        problem_pattern = (
            metadata.get("problem_pattern")
            if isinstance(metadata.get("problem_pattern"), dict)
            else {}
        )

        stable_geometry_ir = cls._stable_geometry_ir(
            metadata=metadata,
            geometry_facts=geometry_facts,
            problem_text=problem_text,
            normalizer=normalizer,
        )
        points = cls._collect_points(
            stable_geometry_ir=stable_geometry_ir,
            drawable_scene=drawable_scene,
            semantic_graph=semantic_graph,
            geometry_facts=geometry_facts,
        )
        segments = cls._collect_segments(
            stable_geometry_ir=stable_geometry_ir,
            drawable_scene=drawable_scene,
            semantic_graph=semantic_graph,
            geometry_facts=geometry_facts,
        )
        shapes = cls._collect_shapes(
            stable_geometry_ir=stable_geometry_ir,
            drawable_scene=drawable_scene,
            semantic_graph=semantic_graph,
        )
        relations = cls._collect_relations(
            stable_geometry_ir=stable_geometry_ir,
            geometry_spec=geometry_spec,
        )
        templates = cls._collect_templates(
            stable_geometry_ir=stable_geometry_ir,
            geometry_facts=geometry_facts,
            geometry_spec=geometry_spec,
        )
        image_pairs = cls._extract_image_pairs(
            stable_geometry_ir=stable_geometry_ir,
            drawable_scene=drawable_scene,
            coordinate_scene=coordinate_scene,
        )

        return cls(
            stable_geometry_ir=stable_geometry_ir,
            drawable_scene=drawable_scene,
            coordinate_scene=coordinate_scene,
            semantic_graph=semantic_graph,
            geometry_facts=geometry_facts,
            geometry_spec=geometry_spec,
            problem_pattern=problem_pattern,
            points=points,
            segments=segments,
            shapes=shapes,
            relations=relations,
            templates=templates,
            image_pairs=image_pairs,
        )

    @staticmethod
    def _stable_geometry_ir(
        *,
        metadata: Dict[str, Any],
        geometry_facts: Dict[str, Any],
        problem_text: str,
        normalizer: GeometryNormalizer,
    ) -> Dict[str, Any]:
        geometry_ir = metadata.get("geometry_ir")
        if (
            isinstance(geometry_ir, dict)
            and str(geometry_ir.get("version", "")).strip() == "geometry_ir.v1"
        ):
            return copy.deepcopy(geometry_ir)
        scene_draft = (
            metadata.get("scene_draft")
            if isinstance(metadata.get("scene_draft"), dict)
            else None
        )
        return normalizer.build_geometry_ir(
            geometry_facts,
            problem_text=problem_text,
            scene_draft=scene_draft,
        )

    @classmethod
    def _collect_points(
        cls,
        *,
        stable_geometry_ir: Dict[str, Any],
        drawable_scene: Dict[str, Any],
        semantic_graph: Dict[str, Any],
        geometry_facts: Dict[str, Any],
    ) -> List[str]:
        points: List[str] = []
        points.extend(cls._point_ids_from_scene_draft(stable_geometry_ir))
        points.extend(cls._point_ids_from_scene(drawable_scene))
        points.extend(cls._point_ids_from_scene(semantic_graph))
        points.extend(
            str(item).strip()
            for item in (geometry_facts.get("points") or [])
            if str(item).strip()
        )
        return sorted({item for item in points if item})

    @classmethod
    def _collect_segments(
        cls,
        *,
        stable_geometry_ir: Dict[str, Any],
        drawable_scene: Dict[str, Any],
        semantic_graph: Dict[str, Any],
        geometry_facts: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        segments: List[Dict[str, Any]] = []
        segments.extend(cls._segments_from_stable_ir(stable_geometry_ir))
        segments.extend(cls._segments_from_scene(drawable_scene))
        segments.extend(cls._segments_from_scene(semantic_graph))
        for token in geometry_facts.get("segments") or []:
            label = str(token).strip().replace("seg_", "")
            if not label:
                continue
            segments.append(
                {
                    "id": f"seg_{label}",
                    "label": label,
                    "points": cls._split_segment_points(label),
                }
            )
        return cls._dedupe_by_key(segments, key_fields=("id", "label"))

    @classmethod
    def _collect_shapes(
        cls,
        *,
        stable_geometry_ir: Dict[str, Any],
        drawable_scene: Dict[str, Any],
        semantic_graph: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        shapes: List[Dict[str, Any]] = []
        shapes.extend(cls._shapes_from_stable_ir(stable_geometry_ir))
        shapes.extend(cls._shapes_from_scene(drawable_scene))
        shapes.extend(cls._shapes_from_scene(semantic_graph))
        return cls._dedupe_by_key(shapes, key_fields=("id", "type"))

    @classmethod
    def _collect_relations(
        cls,
        *,
        stable_geometry_ir: Dict[str, Any],
        geometry_spec: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        relations: List[Dict[str, Any]] = []
        facts = stable_geometry_ir.get("facts") if isinstance(stable_geometry_ir.get("facts"), dict) else {}
        for bucket_name in ("visual_observed", "text_explicit"):
            bucket = facts.get(bucket_name) if isinstance(facts.get(bucket_name), dict) else {}
            for item in bucket.get("relations") or []:
                if not isinstance(item, dict):
                    continue
                relations.append(
                    {
                        "type": str(item.get("type", "")).strip().lower(),
                        "entities": [
                            str(entity).strip()
                            for entity in (item.get("entities") or [])
                            if str(entity).strip()
                        ],
                    }
                )
        if relations:
            return cls._dedupe_by_key(relations, key_fields=("type", "entities"))
        for item in geometry_spec.get("constraints") or []:
            if not isinstance(item, dict):
                continue
            relations.append(
                {
                    "type": str(item.get("type", "")).strip().lower(),
                    "entities": [
                        str(entity).strip()
                        for entity in (item.get("entities") or [])
                        if str(entity).strip()
                    ],
                }
            )
        return relations

    @classmethod
    def _collect_templates(
        cls,
        *,
        stable_geometry_ir: Dict[str, Any],
        geometry_facts: Dict[str, Any],
        geometry_spec: Dict[str, Any],
    ) -> List[str]:
        templates = [
            str(item).strip().lower()
            for item in (
                geometry_spec.get("templates")
                or geometry_facts.get("templates")
                or stable_geometry_ir.get("geometry_facts", {}).get("templates")
                or []
            )
            if str(item).strip()
        ]
        if not templates:
            scene_draft = stable_geometry_ir.get("scene_draft")
            if isinstance(scene_draft, dict) and scene_draft.get("fold_correspondences"):
                templates.append("fold")
        return sorted(set(templates))

    @classmethod
    def _extract_image_pairs(
        cls,
        *,
        stable_geometry_ir: Dict[str, Any],
        drawable_scene: Dict[str, Any],
        coordinate_scene: Dict[str, Any],
    ) -> List[Dict[str, str]]:
        pairs: List[Dict[str, str]] = []
        scene_draft = (
            stable_geometry_ir.get("scene_draft")
            if isinstance(stable_geometry_ir.get("scene_draft"), dict)
            else {}
        )
        for item in scene_draft.get("fold_correspondences") or []:
            if not isinstance(item, dict):
                continue
            source = str(item.get("source", "")).strip()
            image = str(item.get("image", "")).strip()
            if source and image:
                pairs.append({"source": source, "image": image})
        if pairs:
            return cls._dedupe_image_pairs(pairs)
        pairs.extend(cls._reflect_pairs_from_scene(drawable_scene))
        pairs.extend(cls._reflect_pairs_from_scene(coordinate_scene))
        if not pairs:
            point_ids = set(cls._point_ids_from_scene(drawable_scene))
            for point_id in sorted(item for item in point_ids if item):
                match = re.fullmatch(r"([A-Z])1", point_id)
                if not match:
                    continue
                source = match.group(1)
                if source in point_ids:
                    pairs.append({"source": source, "image": point_id})
        return cls._dedupe_image_pairs(pairs)

    @staticmethod
    def _point_ids_from_scene(scene: Dict[str, Any]) -> List[str]:
        points: List[str] = []
        payload = scene.get("points")
        if isinstance(payload, dict):
            points.extend(str(item).strip() for item in payload.keys())
        elif isinstance(payload, list):
            points.extend(
                str(item.get("id", "")).strip()
                for item in payload
                if isinstance(item, dict)
            )
        return [item for item in points if item]

    @staticmethod
    def _point_ids_from_scene_draft(stable_geometry_ir: Dict[str, Any]) -> List[str]:
        scene_draft = stable_geometry_ir.get("scene_draft")
        if not isinstance(scene_draft, dict):
            return []
        return [
            str(item.get("id", "")).strip()
            for item in (scene_draft.get("points") or [])
            if isinstance(item, dict) and str(item.get("id", "")).strip()
        ]

    @classmethod
    def _segments_from_stable_ir(cls, stable_geometry_ir: Dict[str, Any]) -> List[Dict[str, Any]]:
        segments: List[Dict[str, Any]] = []
        facts = stable_geometry_ir.get("facts") if isinstance(stable_geometry_ir.get("facts"), dict) else {}
        visual = facts.get("visual_observed") if isinstance(facts.get("visual_observed"), dict) else {}
        for item in visual.get("segments") or []:
            segment = cls._segment_payload(item)
            if segment:
                segments.append(segment)
        scene_draft = stable_geometry_ir.get("scene_draft")
        if isinstance(scene_draft, dict):
            for item in scene_draft.get("visible_segments") or []:
                segment = cls._segment_payload(item)
                if segment:
                    segments.append(segment)
        return segments

    @classmethod
    def _segment_payload(cls, raw: Any) -> Optional[Dict[str, Any]]:
        if isinstance(raw, str):
            label = raw.strip().replace("seg_", "")
            refs = cls._split_segment_points(label)
            if len(refs) != 2:
                return None
            return {"id": f"seg_{label}", "label": label, "points": refs}
        if not isinstance(raw, dict):
            return None
        refs = [
            str(item).strip()
            for item in (raw.get("points") or raw.get("endpoints") or [])
            if str(item).strip()
        ]
        segment_id = str(raw.get("id", "")).strip()
        if len(refs) != 2:
            token = str(raw.get("segment") or raw.get("name") or raw.get("id") or "").strip()
            refs = cls._split_segment_points(token.replace("seg_", ""))
        if len(refs) != 2:
            return None
        label = "".join(refs)
        return {"id": segment_id or f"seg_{label}", "label": label, "points": refs}

    @staticmethod
    def _segments_from_scene(scene: Dict[str, Any]) -> List[Dict[str, Any]]:
        segments: List[Dict[str, Any]] = []
        for primitive in scene.get("primitives") or []:
            if not isinstance(primitive, dict):
                continue
            if str(primitive.get("type", "")).strip().lower() != "segment":
                continue
            refs = [
                str(item).strip()
                for item in (primitive.get("points") or [])
                if str(item).strip()
            ]
            if len(refs) != 2:
                continue
            label = "".join(refs)
            segments.append(
                {
                    "id": str(primitive.get("id", "")).strip() or f"seg_{label}",
                    "label": label,
                    "points": refs,
                }
            )
        return segments

    @classmethod
    def _shapes_from_stable_ir(cls, stable_geometry_ir: Dict[str, Any]) -> List[Dict[str, Any]]:
        shapes: List[Dict[str, Any]] = []
        facts = stable_geometry_ir.get("facts") if isinstance(stable_geometry_ir.get("facts"), dict) else {}
        visual = facts.get("visual_observed") if isinstance(facts.get("visual_observed"), dict) else {}
        for bucket_name, shape_type in (
            ("polygons", "polygon"),
            ("circles", "circle"),
            ("arcs", "arc"),
            ("angles", "angle"),
            ("right_angles", "right_angle"),
        ):
            for item in visual.get(bucket_name) or []:
                payload = cls._shape_payload(item, shape_type=shape_type)
                if payload:
                    shapes.append(payload)
        return shapes

    @staticmethod
    def _shape_payload(raw: Any, *, shape_type: str) -> Optional[Dict[str, Any]]:
        if not isinstance(raw, dict):
            return None
        payload = {
            "id": str(raw.get("id", "")).strip(),
            "type": shape_type,
        }
        if raw.get("points"):
            payload["points"] = [str(item).strip() for item in raw.get("points") or []]
        if raw.get("center"):
            payload["center"] = str(raw.get("center")).strip()
        return payload

    @staticmethod
    def _shapes_from_scene(scene: Dict[str, Any]) -> List[Dict[str, Any]]:
        shapes: List[Dict[str, Any]] = []
        for primitive in scene.get("primitives") or []:
            if not isinstance(primitive, dict):
                continue
            primitive_type = str(primitive.get("type", "")).strip().lower()
            if primitive_type not in {"polygon", "circle", "arc", "angle", "right_angle"}:
                continue
            payload = {
                "id": str(primitive.get("id", "")).strip(),
                "type": primitive_type,
            }
            if primitive.get("points"):
                payload["points"] = [str(item).strip() for item in primitive.get("points") or []]
            if primitive.get("center"):
                payload["center"] = str(primitive.get("center")).strip()
            shapes.append(payload)
        return shapes

    @staticmethod
    def _reflect_pairs_from_scene(scene: Dict[str, Any]) -> List[Dict[str, str]]:
        pairs: List[Dict[str, str]] = []
        points = scene.get("points")
        if not isinstance(points, list):
            return pairs
        for item in points:
            if not isinstance(item, dict):
                continue
            point_id = str(item.get("id", "")).strip()
            derived = item.get("derived")
            if not point_id or not isinstance(derived, dict):
                continue
            if str(derived.get("type", "")).strip().lower() != "reflect_point":
                continue
            source = str(derived.get("source", "")).strip()
            if source:
                pairs.append({"source": source, "image": point_id})
        return pairs

    @staticmethod
    def _split_segment_points(label: str) -> List[str]:
        return re.findall(r"[A-Za-z]\d*'?", str(label or ""))

    @staticmethod
    def _dedupe_image_pairs(pairs: List[Dict[str, str]]) -> List[Dict[str, str]]:
        dedup: Dict[str, Dict[str, str]] = {}
        for pair in pairs:
            key = f"{pair.get('source', '')}->{pair.get('image', '')}"
            dedup[key] = pair
        return list(dedup.values())

    @staticmethod
    def _dedupe_by_key(
        items: List[Dict[str, Any]],
        *,
        key_fields: tuple[str, ...],
    ) -> List[Dict[str, Any]]:
        dedup: Dict[str, Dict[str, Any]] = {}
        for item in items:
            key = "|".join(str(item.get(field, "")).strip() for field in key_fields)
            if key:
                dedup[key] = item
        return sorted(dedup.values(), key=lambda item: repr(item))
