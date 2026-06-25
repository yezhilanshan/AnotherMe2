"""
Vision agent: single-pass OCR + geometry-spec extraction.
"""

import base64
import copy
import json
import math
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ..foundation.base_agent import BaseAgent
from .coordinate_scene import CoordinateSceneCompiler, CoordinateSceneError
from .geometry_fact_compiler import GeometryFactCompiler
from .layout_contract import build_layout_contract
from .layout_ir import scene_payload_from_layout_ir
from .geometry_normalizer import GeometryNormalizer
from .graph_builder import GeometryGraph
from .image_preprocess import preprocess_problem_image
from .pixel_anchor import normalize_point_pixel_anchor
from .scene_graph import SceneGraph

try:
    from output_paths import DEFAULT_OUTPUT_DIR
except ModuleNotFoundError:
    from anotherme2_engine.output_paths import DEFAULT_OUTPUT_DIR


class VisionAgent(BaseAgent):
    """Extract problem text and structural geometry information from an image."""

    SYSTEM_PROMPT = (
        "You are an expert math-geometry vision model. "
        "Do OCR accurately, then extract geometry entities, relations, and measurements. "
        "Never invent coordinates unless explicitly asked."
    )

    def __init__(
        self,
        config: Dict[str, Any],
        llm: Optional[Any] = None,
        ocr_llm: Optional[Any] = None,
    ):
        super().__init__(config, llm)
        self.ocr_llm = ocr_llm or llm
        self.system_prompt = config.get("system_prompt", self.SYSTEM_PROMPT)
        self.output_dir = config.get("output_dir", str(DEFAULT_OUTPUT_DIR))
        self.export_ggb = bool(config.get("export_ggb", True))
        self.debug_exceptions = bool(config.get("debug_exceptions", False))
        self.scan_preprocess_enabled = bool(config.get("scan_preprocess_enabled", True))
        self.scan_preprocess_target_min_side = int(
            config.get("scan_preprocess_target_min_side", 1400)
        )
        self.scan_preprocess_max_output_side = int(
            config.get("scan_preprocess_max_output_side", 2200)
        )
        self.scan_preprocess_remove_colored_ink = bool(
            config.get("scan_preprocess_remove_colored_ink", True)
        )
        self.prefer_soft_sketch_reconstruction = bool(
            config.get("prefer_soft_sketch_reconstruction", True)
        )
        self.geometry_normalizer = GeometryNormalizer()
        self.geometry_fact_compiler = GeometryFactCompiler()
        self.coordinate_scene_compiler = CoordinateSceneCompiler()
        self._init_paddleocr(config)

    def _init_paddleocr(self, config: Dict[str, Any]) -> None:
        self.paddleocr_engine = None
        ocr_engine = str(config.get("ocr_engine", "llm")).strip().lower()
        if ocr_engine == "paddleocr":
            try:
                from paddleocr import PaddleOCR

                self.paddleocr_engine = PaddleOCR(
                    use_angle_cls=True,
                    lang="ch",
                    show_log=False,
                )
            except Exception as exc:
                self._record_debug_issue("paddleocr_init", exc)

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        project = state["project"]
        image_path = project.problem_image

        if not image_path or not Path(image_path).exists():
            project.status = "failed"
            project.error_message = "Problem image does not exist."
            state["project"] = project
            state["current_step"] = "vision_failed"
            state["messages"].append(
                {"role": "assistant", "content": project.error_message}
            )
            return state

        metadata = state.setdefault("metadata", {})
        preprocess_report = self._preprocess_problem_image(image_path)
        metadata["image_preprocess"] = preprocess_report
        if preprocess_report.get("used_processed_image"):
            metadata["original_problem_image"] = image_path
            image_path = str(preprocess_report.get("processed_path") or image_path)
            project.problem_image = image_path

        geometry_file = project.geometry_file or metadata.get("geometry_file")
        export_ggb = bool(
            metadata.get(
                "export_ggb",
                project.export_ggb
                if project.export_ggb is not None
                else self.export_ggb,
            )
        )

        extract_payload = self._extract_and_stabilize_bundle(
            image_path=image_path,
            project_problem_text=project.problem_text or "",
        )
        bundle = extract_payload["bundle"]
        problem_text = extract_payload["problem_text"]
        geometry_facts = extract_payload["geometry_facts"]
        scene_draft = (
            extract_payload.get("scene_draft")
            if isinstance(extract_payload.get("scene_draft"), dict)
            else self.geometry_normalizer.build_scene_draft(
                geometry_facts,
                problem_text=problem_text,
            )
        )
        geometry_ir = (
            extract_payload.get("geometry_ir")
            if isinstance(extract_payload.get("geometry_ir"), dict)
            else self.geometry_normalizer.build_geometry_ir(
                geometry_facts,
                problem_text=problem_text,
                scene_draft=scene_draft,
            )
        )
        vision_quality = extract_payload["vision_quality"]

        compile_payload = self._compile_and_infer(
            problem_text=problem_text,
            geometry_facts=geometry_facts,
            geometry_ir=geometry_ir,
        )
        geometry_spec = compile_payload["geometry_spec"]
        semantic_signals = compile_payload["semantic_signals"]
        if compile_payload.get("compile_error"):
            vision_quality["fallback_events"].append("geometry_spec_compile_fallback")
        bundle["semantic_signals"] = semantic_signals
        if not problem_text and not self._geometry_facts_have_content(geometry_facts):
            project.status = "failed"
            project.error_message = (
                "Vision extraction returned empty OCR text and empty geometry facts. "
                "Please verify the input image or provide --problem text."
            )
            metadata["problem_bundle"] = bundle
            metadata["scene_draft"] = scene_draft
            metadata["geometry_ir"] = geometry_ir
            metadata["geometry_facts"] = geometry_facts
            metadata["geometry_spec"] = geometry_spec
            metadata["vision_quality"] = vision_quality
            state["project"] = project
            state["current_step"] = "vision_failed"
            state["messages"].append(
                {"role": "assistant", "content": project.error_message}
            )
            return state
        project.problem_text = problem_text
        metadata["problem_bundle"] = bundle
        metadata["scene_draft"] = scene_draft
        metadata["geometry_ir"] = geometry_ir
        metadata["geometry_facts"] = geometry_facts
        metadata["geometry_spec"] = geometry_spec
        metadata["vision_semantic_signals"] = semantic_signals

        normalized_spec: Optional[Dict[str, Any]] = None
        geometry_spec_validation: Dict[str, Any] = {
            "is_valid": True,
            "failed_checks": [],
            "missing_entities": [],
            "unsupported_relations": [],
            "solver_trace": [],
        }
        coordinate_scene: Optional[Dict[str, Any]] = None
        coordinate_scene_validation: Optional[Dict[str, Any]] = None
        layout_bundle: Optional[Dict[str, Any]] = None

        try:
            if geometry_file:
                layout_bundle = self.coordinate_scene_compiler.compile_layout_bundle(
                    geometry_file=geometry_file,
                )
                coordinate_scene = layout_bundle.get("coordinate_scene")
                coordinate_scene_validation = layout_bundle.get(
                    "coordinate_scene_validation"
                )
                metadata["auto_geometry_status"] = "success"
            else:
                normalized_spec = (
                    self.coordinate_scene_compiler.normalize_geometry_spec(
                        geometry_spec
                    )
                )
                geometry_spec_validation = {
                    "is_valid": bool(normalized_spec.get("points"))
                    and bool(normalized_spec.get("primitives")),
                    "failed_checks": [],
                    "missing_entities": [],
                    "unsupported_relations": [],
                    "solver_trace": [],
                }
                layout_bundle = self.coordinate_scene_compiler.solve_layout_bundle(
                    normalized_spec
                )
                coordinate_scene = layout_bundle.get("coordinate_scene")
                coordinate_scene_validation = layout_bundle.get(
                    "coordinate_scene_validation"
                )
                metadata["auto_geometry_status"] = (
                    "success" if coordinate_scene_validation["is_valid"] else "invalid"
                )
        except CoordinateSceneError as exc:
            if not geometry_file:
                try:
                    normalized_spec = (
                        normalized_spec
                        or self.coordinate_scene_compiler.normalize_geometry_spec(
                            geometry_spec
                        )
                    )
                except Exception:
                    normalized_spec = None

            metadata["normalized_geometry_spec"] = normalized_spec
            metadata["geometry_spec_validation"] = geometry_spec_validation
            metadata["coordinate_scene_validation"] = coordinate_scene_validation or {
                "is_valid": False,
                "failed_checks": [{"type": "compile", "message": str(exc)}],
                "missing_entities": [],
                "unsupported_relations": [],
                "solver_trace": [],
            }
            metadata["auto_geometry_status"] = metadata.get(
                "auto_geometry_status", "unsupported"
            )
            metadata["debug_exports"] = (
                self.coordinate_scene_compiler.write_debug_exports(
                    coordinate_scene=None,
                    output_dir=self.output_dir,
                    export_ggb=export_ggb,
                    extra_payloads={
                        "problem_bundle": bundle,
                        "scene_draft": scene_draft,
                        "geometry_ir": geometry_ir,
                        "geometry_facts": geometry_facts,
                        "geometry_spec": geometry_spec,
                        "vision_semantic_signals": semantic_signals,
                        "normalized_geometry_spec": normalized_spec,
                        "geometry_spec_validation": geometry_spec_validation,
                        "coordinate_scene_validation": metadata[
                            "coordinate_scene_validation"
                        ],
                    },
                )
            )

            if geometry_file:
                project.status = "failed"
                project.error_message = (
                    "Geometry file validation failed; stopping the workflow. "
                    f"geometry_file={geometry_file}. Details: {exc}"
                )
                vision_quality["scene_source"] = "failed_geometry_file_validation"
                vision_quality["vision_quality_level"] = "degraded"
                metadata["vision_quality"] = vision_quality
                state["project"] = project
                state["current_step"] = "vision_failed"
                state["messages"].append(
                    {"role": "assistant", "content": project.error_message}
                )
                return state

            vision_quality["fallback_events"].append("coordinate_scene_fallback")
            fold_solver_failed = self._fold_solver_failed(
                metadata["coordinate_scene_validation"]
            )
            if fold_solver_failed:
                vision_quality["fallback_events"].append(
                    "fold_solver_failed_soft_sketch"
                )
            fallback_geometry = normalized_spec or geometry_spec
            fallback_policy = self._assess_schematic_scene_policy(
                problem_text=problem_text,
                semantic_signals=semantic_signals,
            )
            has_pixel_anchor_fallback = self._has_sufficient_pixel_anchor_coverage(
                fallback_geometry
            )
            if (
                fold_solver_failed
                or str(fallback_policy.get("mode", "")).strip() == "limited"
                or has_pixel_anchor_fallback
            ):
                if has_pixel_anchor_fallback and not fold_solver_failed:
                    vision_quality["fallback_events"].append(
                        "pixel_anchor_soft_sketch_fallback"
                    )
                fallback_policy = {
                    "mode": "soft_sketch",
                    "allow_solver_fallback": False,
                    "animation_mode": "soft_graph_strong_explanation",
                }
            semantic_signals = self._downgrade_semantic_signals_for_schematic(
                semantic_signals,
                policy=fallback_policy,
            )
            bundle["semantic_signals"] = semantic_signals
            semantic_graph = self._build_semantic_graph(fallback_geometry)
            if str(fallback_policy.get("mode", "")).strip() == "soft_sketch":
                vision_quality["fallback_events"].append("soft_sketch_reconstruction")
                drawable_scene = self._build_soft_sketch_drawable_scene(
                    fallback_geometry,
                    geometry_facts=geometry_facts,
                    scene_error=str(exc),
                    policy=fallback_policy,
                )
            else:
                drawable_scene = self._build_schematic_drawable_scene(
                    fallback_geometry,
                    allow_solver_fallback=bool(
                        fallback_policy.get("allow_solver_fallback", True)
                    ),
                )
            fallback_geometry_graph = self._build_geometry_graph_payload(drawable_scene)

            metadata["coordinate_scene"] = None
            metadata["coordinate_scene_validation"] = metadata[
                "coordinate_scene_validation"
            ]
            drawable_scene_source = (
                "soft_sketch_from_normalized_geometry_spec"
                if str(drawable_scene.get("layout_mode", "")).strip()
                == "soft_sketch_reconstruction"
                else "schematic_from_normalized_geometry_spec"
            )
            layout_bundle = self.coordinate_scene_compiler.derive_layout_bundle(
                drawable_scene=drawable_scene,
                coordinate_scene=None,
                coordinate_scene_validation=metadata["coordinate_scene_validation"],
                drawable_scene_source=drawable_scene_source,
            )
            metadata["layout_ir"] = layout_bundle["layout_ir"]
            metadata["semantic_graph"] = semantic_graph
            metadata["semantic_graph_json"] = json.dumps(
                semantic_graph, ensure_ascii=False
            )
            metadata["drawable_scene"] = (
                layout_bundle.get("drawable_scene") or drawable_scene
            )
            metadata["drawable_scene_json"] = json.dumps(
                metadata["drawable_scene"], ensure_ascii=False
            )
            metadata["scene_graph"] = semantic_graph
            metadata["scene_graph_json"] = metadata["semantic_graph_json"]
            metadata["drawable_scene_source"] = drawable_scene_source
            fallback_geometry_graph = self._build_geometry_graph_payload(
                metadata["drawable_scene"]
            )
            metadata["geometry_graph"] = fallback_geometry_graph
            metadata["geometry_graph_json"] = json.dumps(
                fallback_geometry_graph, ensure_ascii=False
            )
            metadata["layout_contract"] = build_layout_contract(metadata)
            metadata["layout_ir_json"] = json.dumps(
                metadata.get("layout_ir", {}), ensure_ascii=False
            )
            metadata["semantic_graph_source"] = "normalized_geometry_spec_fallback"
            metadata["scene_graph_source"] = metadata["semantic_graph_source"]
            metadata["vision_semantic_signals"] = semantic_signals

            vision_quality["scene_source"] = str(
                drawable_scene.get("layout_mode", "schematic_fallback")
            )
            vision_quality["vision_quality_level"] = self._compute_vision_quality_level(
                text_source=str(vision_quality.get("text_source", "")),
                geometry_source=str(vision_quality.get("geometry_source", "")),
                scene_source=str(vision_quality.get("scene_source", "")),
            )
            metadata["vision_quality"] = vision_quality
            metadata["vision_quality_level"] = vision_quality["vision_quality_level"]
            metadata["vision_text_source"] = vision_quality.get("text_source")
            metadata["vision_geometry_source"] = vision_quality.get("geometry_source")
            metadata["vision_scene_source"] = vision_quality.get("scene_source")

            self._write_debug_text(
                "vision_diagnostic_report.json",
                json.dumps(
                    {
                        "vision_quality": vision_quality,
                        "fallback_policy": fallback_policy,
                        "scene_error": str(exc),
                        "compile_error": compile_payload.get("compile_error"),
                        "coordinate_scene_validation": metadata[
                            "coordinate_scene_validation"
                        ],
                        "geometry_spec_validation": geometry_spec_validation,
                        "soft_sketch_report": drawable_scene.get("soft_sketch_report"),
                        "recommended_geometry_actions": semantic_signals.get(
                            "recommended_geometry_actions",
                            [],
                        ),
                        "recommended_geometry_action_details": semantic_signals.get(
                            "recommended_geometry_action_details",
                            [],
                        ),
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
            )
            if drawable_scene.get("soft_sketch_report"):
                self._write_debug_text(
                    "soft_sketch_report.json",
                    json.dumps(
                        drawable_scene.get("soft_sketch_report"),
                        ensure_ascii=False,
                        indent=2,
                    ),
                )

            state["project"] = project
            state["current_step"] = "vision_completed"
            state["messages"].append(
                {
                    "role": "assistant",
                    "content": (
                        "Automatic coordinate-scene compilation failed, "
                        f"but the workflow will continue with structured geometry fallback: {exc}"
                    ),
                }
            )

            # Add user-visible fallback notification
            fallback_notification = self._build_fallback_notification(vision_quality)
            if fallback_notification:
                state["messages"].append(fallback_notification)

            return state

        semantic_graph = self.coordinate_scene_compiler.derive_semantic_graph(
            coordinate_scene
        )
        drawable_scene = (
            layout_bundle.get("drawable_scene")
            if isinstance(layout_bundle, dict)
            and isinstance(layout_bundle.get("drawable_scene"), dict)
            else self.coordinate_scene_compiler.derive_drawable_scene(coordinate_scene)
        )
        drawable_scene_source = "derived_from_coordinate_scene"
        if (
            self.prefer_soft_sketch_reconstruction
            and not geometry_file
            and isinstance(normalized_spec, dict)
            and normalized_spec.get("points")
            and normalized_spec.get("primitives")
            and self._allow_soft_sketch_priority(
                normalized_spec=normalized_spec,
                geometry_facts=geometry_facts,
                coordinate_scene_validation=coordinate_scene_validation,
            )
        ):
            soft_drawable_scene = self._build_soft_sketch_drawable_scene(
                normalized_spec,
                geometry_facts=geometry_facts,
                scene_error="coordinate_scene_succeeded_soft_sketch_priority",
                policy={
                    "mode": "soft_sketch_priority",
                    "allow_solver_fallback": False,
                    "animation_mode": "soft_graph_strong_explanation",
                },
            )
            if self._semantic_graph_has_drawable_geometry(soft_drawable_scene):
                drawable_scene = soft_drawable_scene
                drawable_scene_source = (
                    "soft_sketch_priority_from_normalized_geometry_spec"
                )
        if (
            not isinstance(layout_bundle, dict)
            or drawable_scene_source != "derived_from_coordinate_scene"
        ):
            layout_bundle = self.coordinate_scene_compiler.derive_layout_bundle(
                drawable_scene=drawable_scene,
                coordinate_scene=coordinate_scene,
                coordinate_scene_validation=coordinate_scene_validation,
                drawable_scene_source=drawable_scene_source,
            )
        ggb_commands = self.coordinate_scene_compiler.export_ggb_commands(
            coordinate_scene
        )
        debug_exports = self.coordinate_scene_compiler.write_debug_exports(
            coordinate_scene=coordinate_scene,
            output_dir=self.output_dir,
            export_ggb=export_ggb,
            extra_payloads={
                "problem_bundle": bundle,
                "scene_draft": scene_draft,
                "geometry_ir": geometry_ir,
                "geometry_facts": geometry_facts,
                "geometry_spec": geometry_spec,
                "vision_semantic_signals": semantic_signals,
                "normalized_geometry_spec": normalized_spec,
                "geometry_spec_validation": geometry_spec_validation,
                "coordinate_scene_validation": coordinate_scene_validation,
            },
        )

        metadata["normalized_geometry_spec"] = normalized_spec
        metadata["geometry_spec_validation"] = geometry_spec_validation
        metadata["layout_ir"] = layout_bundle["layout_ir"]
        metadata["coordinate_scene"] = (
            layout_bundle.get("coordinate_scene") or coordinate_scene
        )
        metadata["coordinate_scene_json"] = json.dumps(
            metadata["coordinate_scene"], ensure_ascii=False
        )
        metadata["coordinate_scene_validation"] = coordinate_scene_validation
        metadata["ggb_commands"] = ggb_commands
        metadata["semantic_graph"] = semantic_graph
        metadata["semantic_graph_json"] = json.dumps(semantic_graph, ensure_ascii=False)
        metadata["drawable_scene"] = layout_bundle.get("drawable_scene") or drawable_scene
        metadata["drawable_scene_json"] = json.dumps(
            metadata["drawable_scene"], ensure_ascii=False
        )
        metadata["scene_graph"] = semantic_graph
        metadata["scene_graph_json"] = metadata["semantic_graph_json"]
        geometry_graph_payload = self._build_geometry_graph_payload(
            metadata["drawable_scene"]
        )
        metadata["geometry_graph"] = geometry_graph_payload
        metadata["geometry_graph_json"] = json.dumps(
            geometry_graph_payload, ensure_ascii=False
        )
        metadata["drawable_scene_source"] = drawable_scene_source
        metadata["layout_contract"] = build_layout_contract(metadata)
        metadata["layout_ir_json"] = json.dumps(
            metadata.get("layout_ir", {}), ensure_ascii=False
        )
        metadata["semantic_graph_source"] = "derived_from_coordinate_scene"
        metadata["scene_graph_source"] = metadata["semantic_graph_source"]
        metadata["debug_exports"] = debug_exports
        metadata["vision_semantic_signals"] = semantic_signals

        vision_quality["scene_source"] = (
            str(drawable_scene.get("layout_mode", "soft_sketch_reconstruction"))
            if drawable_scene_source.startswith("soft_sketch")
            else "coordinate_scene"
        )
        vision_quality["vision_quality_level"] = self._compute_vision_quality_level(
            text_source=str(vision_quality.get("text_source", "")),
            geometry_source=str(vision_quality.get("geometry_source", "")),
            scene_source=str(vision_quality.get("scene_source", "")),
        )
        metadata["vision_quality"] = vision_quality
        metadata["vision_quality_level"] = vision_quality["vision_quality_level"]
        metadata["vision_text_source"] = vision_quality.get("text_source")
        metadata["vision_geometry_source"] = vision_quality.get("geometry_source")
        metadata["vision_scene_source"] = vision_quality.get("scene_source")

        self._write_debug_text(
            "vision_diagnostic_report.json",
            json.dumps(
                {
                    "vision_quality": vision_quality,
                    "compile_error": compile_payload.get("compile_error"),
                    "geometry_spec_validation": geometry_spec_validation,
                    "coordinate_scene_validation": coordinate_scene_validation,
                    "soft_sketch_report": drawable_scene.get("soft_sketch_report"),
                    "recommended_geometry_actions": semantic_signals.get(
                        "recommended_geometry_actions",
                        [],
                    ),
                    "recommended_geometry_action_details": semantic_signals.get(
                        "recommended_geometry_action_details",
                        [],
                    ),
                },
                ensure_ascii=False,
                indent=2,
            ),
        )
        if drawable_scene.get("soft_sketch_report"):
            self._write_debug_text(
                "soft_sketch_report.json",
                json.dumps(
                    drawable_scene.get("soft_sketch_report"),
                    ensure_ascii=False,
                    indent=2,
                ),
            )

        state["project"] = project
        state["current_step"] = "vision_completed"
        state["messages"].append(
            {
                "role": "assistant",
                "content": f"Problem recognition completed: {problem_text[:50]}...",
            }
        )

        # Add user-visible fallback notification if quality is degraded
        fallback_notification = self._build_fallback_notification(vision_quality)
        if fallback_notification:
            state["messages"].append(fallback_notification)

        return state

    def _preprocess_problem_image(self, image_path: str) -> Dict[str, Any]:
        report = preprocess_problem_image(
            image_path,
            output_dir=self.output_dir,
            enabled=self.scan_preprocess_enabled,
            target_min_side=self.scan_preprocess_target_min_side,
            max_output_side=self.scan_preprocess_max_output_side,
            remove_colored_ink=self.scan_preprocess_remove_colored_ink,
        )
        try:
            self._write_debug_text(
                "vision_image_preprocess.json",
                json.dumps(report, ensure_ascii=False, indent=2),
            )
        except Exception as exc:
            self._record_debug_issue("write_image_preprocess_report", exc)
        return report

    def _allow_soft_sketch_priority(
        self,
        *,
        normalized_spec: Dict[str, Any],
        geometry_facts: Dict[str, Any],
        coordinate_scene_validation: Optional[Dict[str, Any]],
    ) -> bool:
        if not isinstance(coordinate_scene_validation, dict) or not bool(
            coordinate_scene_validation.get("is_valid")
        ):
            return True
        return not self._has_hard_geometry_constraints(
            normalized_spec=normalized_spec,
            geometry_facts=geometry_facts,
        )

    def _has_sufficient_pixel_anchor_coverage(
        self,
        geometry_data: Optional[Dict[str, Any]],
        *,
        min_anchors: int = 3,
        min_ratio: float = 0.5,
    ) -> bool:
        if not isinstance(geometry_data, dict):
            return False
        points = geometry_data.get("points") or []
        if not isinstance(points, list) or not points:
            return False

        point_count = 0
        anchor_count = 0
        for item in points:
            if not isinstance(item, dict):
                continue
            point_id = str(item.get("id", "")).strip()
            if not point_id:
                continue
            point_count += 1
            payload = copy.deepcopy(item)
            normalize_point_pixel_anchor(payload)
            coord = payload.get("pixel_coord")
            if not isinstance(coord, dict):
                continue
            try:
                x = float(coord.get("x"))
                y = float(coord.get("y"))
            except (TypeError, ValueError):
                continue
            if math.isfinite(x) and math.isfinite(y):
                anchor_count += 1

        if anchor_count < min_anchors or point_count <= 0:
            return False
        coverage = anchor_count / point_count
        return coverage >= min_ratio or anchor_count >= 4

    def _has_hard_geometry_constraints(
        self,
        *,
        normalized_spec: Dict[str, Any],
        geometry_facts: Dict[str, Any],
    ) -> bool:
        hard_types = {
            "angle",
            "collinear",
            "equal_length",
            "length",
            "midpoint",
            "parallel",
            "perpendicular",
            "point_on_segment",
            "ratio",
        }
        for bucket in (
            geometry_facts.get("text_explicit_relations"),
            geometry_facts.get("text_explicit_measurements"),
        ):
            for item in bucket or []:
                if (
                    isinstance(item, dict)
                    and str(item.get("type", "")).strip().lower() in hard_types
                ):
                    return True
        if isinstance(normalized_spec, dict):
            for bucket_name in ("constraints", "measurements"):
                for item in normalized_spec.get(bucket_name) or []:
                    if (
                        isinstance(item, dict)
                        and str(item.get("type", "")).strip().lower() in hard_types
                    ):
                        return True
        return False

    def _extract_and_stabilize_bundle(
        self,
        *,
        image_path: str,
        project_problem_text: str,
    ) -> Dict[str, Any]:
        bundle = self._analyze_problem_bundle(image_path)
        fallback_events: List[str] = []
        if self._bundle_is_effectively_empty(bundle):
            fallback_events.append("recover_problem_bundle")
            bundle = self._recover_problem_bundle(image_path, bundle)
        bundle = self._stabilize_problem_bundle(bundle, image_path=image_path)

        problem_text = (
            str(project_problem_text or "").strip()
            or str(bundle.get("problem_text", "")).strip()
        )
        if str(project_problem_text or "").strip():
            text_source = "manual_override"
        else:
            text_source = str(bundle.get("problem_text_source", "model"))
        geometry_source = str(bundle.get("geometry_facts_source", "model"))
        fallback_events.extend(list(bundle.get("fallback_events") or []))

        raw_geometry_facts = bundle.get("geometry_facts")
        legacy_geometry_spec = bundle.get("geometry_spec")
        geometry_facts = (
            raw_geometry_facts
            if isinstance(raw_geometry_facts, dict)
            else legacy_geometry_spec
            if isinstance(legacy_geometry_spec, dict)
            else {}
        )
        scene_draft = (
            bundle.get("scene_draft")
            if isinstance(bundle.get("scene_draft"), dict)
            else self.geometry_normalizer.build_scene_draft(
                geometry_facts,
                problem_text=problem_text,
            )
        )
        geometry_ir = (
            bundle.get("geometry_ir")
            if isinstance(bundle.get("geometry_ir"), dict)
            else self.geometry_normalizer.build_geometry_ir(
                geometry_facts,
                problem_text=problem_text,
                scene_draft=scene_draft,
            )
        )
        vision_quality = {
            "text_source": text_source,
            "geometry_source": geometry_source,
            "scene_source": "unknown",
            "vision_quality_level": "recovered",
            "fallback_events": list(dict.fromkeys(fallback_events)),
        }
        return {
            "bundle": bundle,
            "problem_text": problem_text,
            "geometry_facts": geometry_facts,
            "scene_draft": scene_draft,
            "geometry_ir": geometry_ir,
            "vision_quality": vision_quality,
        }

    def _build_fallback_notification(
        self,
        vision_quality: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """Build a user-visible notification when fallback/degradation occurred."""
        quality_level = vision_quality.get("vision_quality_level", "unknown")
        fallback_events = list(vision_quality.get("fallback_events") or [])

        if quality_level == "exact" or not fallback_events:
            return None

        severity_map = {
            "recovered": "info",
            "schematic": "warning",
            "degraded": "warning",
        }
        severity = severity_map.get(quality_level, "info")

        descriptions = {
            "recover_problem_bundle": "题目内容识别不完整，已使用备用方案恢复",
            "ocr_fallback": "主要识别方式失败，已切换到 OCR 文字提取",
            "recover_problem_text_fallback": "题目文本提取失败，已使用备用 OCR",
            "recover_geometry_facts_fallback": "几何信息提取失败，已使用备用方案",
            "problem_text_fallback": "题目文本提取失败，已使用备用方案",
            "problem_text_upgrade": "题目文本质量较低，已尝试优化",
            "geometry_facts_fallback": "几何信息提取失败，已使用备用方案",
            "geometry_spec_compile_fallback": "几何规格编译失败，已使用空规格继续",
            "coordinate_scene_fallback": "坐标系构建失败，已使用示意图模式",
            "fold_solver_failed_safe_fallback": "折叠类题目处理失败，已使用安全降级模式",
            "fold_solver_failed_soft_sketch": "折叠类坐标精确求解失败，已使用软草图重建",
            "soft_sketch_reconstruction": "已按视觉锚点和软约束重建线框草图",
            "fold_safe_fallback_pruned": "已裁剪不可靠的折叠反射数据",
        }

        triggered = []
        for event in fallback_events:
            desc = descriptions.get(event, event)
            if desc not in triggered:
                triggered.append(desc)

        return {
            "role": "assistant",
            "content": (
                f"⚠️ 题目识别使用了降级模式（{quality_level}）。"
                f"以下环节使用了备用方案：{'；'.join(triggered)}。"
                "结果可能不够精确，建议核实题目内容。"
            ),
            "metadata": {
                "type": "vision_fallback_warning",
                "severity": severity,
                "quality_level": quality_level,
                "fallback_events": fallback_events,
            },
        }

    def _compile_and_infer(
        self,
        *,
        problem_text: str,
        geometry_facts: Dict[str, Any],
        geometry_ir: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        geometry_spec, compile_error = self._compile_geometry_spec_with_diagnostics(
            geometry_facts,
            problem_text=problem_text,
            geometry_ir=geometry_ir,
        )
        semantic_signals = self._infer_semantic_signals(
            problem_text=problem_text,
            geometry_facts=geometry_facts,
            geometry_spec=geometry_spec,
        )
        return {
            "geometry_spec": geometry_spec,
            "semantic_signals": semantic_signals,
            "compile_error": compile_error,
        }

    def _compose_compiler_geometry_facts(
        self,
        geometry_facts: Optional[Dict[str, Any]],
        *,
        problem_text: str,
    ) -> Dict[str, Any]:
        merged = copy.deepcopy(geometry_facts or {})
        has_fold_semantics = self._contains_fold_semantics(problem_text)
        has_explicit_midpoint = bool(
            re.search(r"中点|midpoint", str(problem_text or ""), re.IGNORECASE)
        )
        has_high_risk_semantics = bool(
            re.search(
                r"折叠|翻折|对折|切线|圆幂|轨迹|圆|⊙|○|locus|fold|reflect|tangent|circle|dynamic|moving",
                str(problem_text or ""),
                re.IGNORECASE,
            )
        )
        allow_derived_for_compiler = bool(
            self.config.get("allow_derived_facts_for_compiler", False)
        )
        allow_derived_for_compiler = (
            allow_derived_for_compiler and not has_high_risk_semantics
        )

        def keep_inferred_relation(item: Any) -> bool:
            if not isinstance(item, dict):
                return False
            status = str(item.get("status", "")).strip().lower()
            role = str(item.get("role", "")).strip().lower()
            source = str(item.get("source", "")).strip().lower()
            if status in {"goal", "proof_goal", "to_prove", "conclusion"}:
                return False
            if role in {"goal", "proof_goal", "to_prove", "conclusion"}:
                return False
            if source in {"problem_text_goal", "proof_goal"}:
                return False
            confidence = item.get("confidence")
            if confidence is not None:
                try:
                    if float(confidence) < 0.7:
                        return False
                except (TypeError, ValueError):
                    pass
            relation_type = str(item.get("type", "")).strip().lower()
            if (
                has_fold_semantics
                and relation_type == "midpoint"
                and not has_explicit_midpoint
            ):
                return False
            return True

        def keep_inferred_measurement(item: Any) -> bool:
            if not isinstance(item, dict):
                return False
            confidence = item.get("confidence")
            if confidence is not None:
                try:
                    if float(confidence) < 0.7:
                        return False
                except (TypeError, ValueError):
                    pass
            return True

        observed_relations = list(
            merged.get("observed_relations") or merged.get("relations") or []
        )
        text_explicit_relations = list(merged.get("text_explicit_relations") or [])
        derived_relations = list(
            merged.get("derived_relations") or merged.get("inferred_relations") or []
        )

        observed_measurements = list(
            merged.get("observed_measurements") or merged.get("measurements") or []
        )
        text_explicit_measurements = list(
            merged.get("text_explicit_measurements") or []
        )
        derived_measurements = list(
            merged.get("derived_measurements")
            or merged.get("inferred_measurements")
            or []
        )

        compiler_relations = self._dedupe_fact_dicts(
            [*observed_relations, *text_explicit_relations]
        )
        compiler_measurements = self._dedupe_fact_dicts(
            [*observed_measurements, *text_explicit_measurements]
        )

        if allow_derived_for_compiler:
            compiler_relations = self._dedupe_fact_dicts(
                [
                    *compiler_relations,
                    *[
                        item
                        for item in derived_relations
                        if keep_inferred_relation(item)
                    ],
                ]
            )
            compiler_measurements = self._dedupe_fact_dicts(
                [
                    *compiler_measurements,
                    *[
                        item
                        for item in derived_measurements
                        if keep_inferred_measurement(item)
                    ],
                ]
            )

        merged["relations"] = compiler_relations
        merged["measurements"] = compiler_measurements
        merged["compiler_fact_layers"] = {
            "observed_relations": len(observed_relations),
            "text_explicit_relations": len(text_explicit_relations),
            "derived_relations": len(derived_relations),
            "observed_measurements": len(observed_measurements),
            "text_explicit_measurements": len(text_explicit_measurements),
            "derived_measurements": len(derived_measurements),
            "allow_derived_for_compiler": allow_derived_for_compiler,
        }
        return merged

    def _compile_geometry_spec_with_diagnostics(
        self,
        geometry_facts: Optional[Dict[str, Any]],
        *,
        problem_text: str,
        geometry_ir: Optional[Dict[str, Any]] = None,
    ) -> Tuple[Dict[str, Any], Optional[str]]:
        if isinstance(geometry_ir, dict):
            geometry_facts = self.geometry_normalizer.compiler_facts(geometry_ir)
        merged_facts = self._compose_compiler_geometry_facts(
            geometry_facts,
            problem_text=problem_text,
        )
        try:
            return (
                self.geometry_fact_compiler.compile(
                    merged_facts,
                    problem_text=problem_text,
                ),
                None,
            )
        except Exception as exc:
            self._record_debug_issue("compile_geometry_spec", exc)
            return (
                {
                    "templates": [],
                    "confidence": 0.0,
                    "ambiguities": [],
                    "roles": {},
                    "points": [],
                    "primitives": [],
                    "constraints": [],
                    "measurements": [],
                },
                str(exc),
            )

    def _compute_vision_quality_level(
        self,
        *,
        text_source: str,
        geometry_source: str,
        scene_source: str,
    ) -> str:
        normalized_scene_source = str(scene_source or "").strip().lower()
        if normalized_scene_source == "coordinate_scene":
            if str(text_source) == "model" and str(geometry_source) == "model":
                return "exact"
            return "recovered"
        if (
            "solver_fallback" in normalized_scene_source
            or "safe_fallback" in normalized_scene_source
            or "soft_sketch" in normalized_scene_source
        ):
            return "schematic"
        return "degraded"

    def _contains_fold_semantics(self, problem_text: str) -> bool:
        return bool(
            re.search(
                r"折叠|翻折|对折|折痕|对应点|fold|reflect",
                str(problem_text or ""),
                re.IGNORECASE,
            )
        )

    def _fold_solver_failed(self, validation_report: Optional[Dict[str, Any]]) -> bool:
        if not isinstance(validation_report, dict):
            return False
        solver_trace = validation_report.get("solver_trace") or []
        for item in solver_trace:
            if (
                "template fold failed" in str(item).lower()
                or "unsupported template: fold" in str(item).lower()
            ):
                return True
        return False

    def _prune_fold_reflection_artifacts(
        self, geometry_data: Optional[Dict[str, Any]]
    ) -> Dict[str, Any]:
        payload = copy.deepcopy(geometry_data or {})
        if not isinstance(payload, dict):
            return {}

        points = payload.get("points") or []
        reflected_point_ids: set = set()
        if isinstance(points, list):
            filtered_points: List[Dict[str, Any]] = []
            for item in points:
                if not isinstance(item, dict):
                    filtered_points.append(item)
                    continue
                point_id = str(item.get("id", "")).strip()
                raw_derived = item.get("derived")
                derived = raw_derived if isinstance(raw_derived, dict) else {}
                if str(derived.get("type", "")).strip().lower() == "reflect_point":
                    if point_id:
                        reflected_point_ids.add(point_id)
                    continue
                filtered_points.append(item)
            payload["points"] = filtered_points

        removed_primitive_ids: set = set()
        primitives = payload.get("primitives") or []
        if isinstance(primitives, list):
            filtered_primitives: List[Dict[str, Any]] = []
            for item in primitives:
                if not isinstance(item, dict):
                    filtered_primitives.append(item)
                    continue
                primitive_id = str(item.get("id", "")).strip()
                primitive_type = str(item.get("type", "")).strip().lower()
                refs = [
                    str(ref).strip()
                    for ref in (item.get("points") or [])
                    if str(ref).strip()
                ]
                should_drop = False
                if primitive_type in {
                    "segment",
                    "polygon",
                    "angle",
                    "right_angle",
                    "arc",
                }:
                    should_drop = any(ref in reflected_point_ids for ref in refs)
                elif primitive_type == "circle":
                    center = str(item.get("center", "")).strip()
                    radius_point = str(item.get("radius_point", "")).strip()
                    should_drop = (
                        center in reflected_point_ids
                        or radius_point in reflected_point_ids
                    )
                if should_drop:
                    if primitive_id:
                        removed_primitive_ids.add(primitive_id)
                    continue
                filtered_primitives.append(item)
            payload["primitives"] = filtered_primitives

        constraints = payload.get("constraints") or []
        if isinstance(constraints, list):
            filtered_constraints: List[Dict[str, Any]] = []
            for item in constraints:
                if not isinstance(item, dict):
                    filtered_constraints.append(item)
                    continue
                entities = [
                    str(entity).strip()
                    for entity in (item.get("entities") or [])
                    if str(entity).strip()
                ]
                if any(
                    entity in reflected_point_ids or entity in removed_primitive_ids
                    for entity in entities
                ):
                    continue
                filtered_constraints.append(item)
            payload["constraints"] = filtered_constraints

        measurements = payload.get("measurements") or []
        if isinstance(measurements, list):
            filtered_measurements: List[Dict[str, Any]] = []
            for item in measurements:
                if not isinstance(item, dict):
                    filtered_measurements.append(item)
                    continue
                entities = [
                    str(entity).strip()
                    for entity in (item.get("entities") or [])
                    if str(entity).strip()
                ]
                if any(
                    entity in reflected_point_ids or entity in removed_primitive_ids
                    for entity in entities
                ):
                    continue
                filtered_measurements.append(item)
            payload["measurements"] = filtered_measurements

        display = payload.get("display")
        if isinstance(display, dict):
            point_display = display.get("points")
            if isinstance(point_display, dict):
                for point_id in reflected_point_ids:
                    point_display.pop(point_id, None)
            primitive_display = display.get("primitives")
            if isinstance(primitive_display, dict):
                for primitive_id in removed_primitive_ids:
                    primitive_display.pop(primitive_id, None)

        return payload

    def _assess_schematic_scene_policy(
        self,
        *,
        problem_text: str,
        semantic_signals: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        text = str(problem_text or "")
        signals = semantic_signals if isinstance(semantic_signals, dict) else {}
        inferred_pattern = str(signals.get("inferred_problem_pattern", "")).strip()
        high_risk_pattern = inferred_pattern in {
            "fold_transform",
            "circle_geometry",
            "dynamic_point",
        }
        high_risk_text = bool(
            re.search(
                r"折叠|翻折|对折|切线|圆幂|轨迹|locus|fold|tangent|dynamic|moving",
                text,
                re.IGNORECASE,
            )
        )
        if high_risk_pattern or high_risk_text:
            return {
                "mode": "limited",
                "allow_solver_fallback": False,
                "animation_mode": "weak_graph_strong_explanation",
            }
        return {
            "mode": "standard",
            "allow_solver_fallback": True,
            "animation_mode": "normal",
        }

    def _downgrade_semantic_signals_for_schematic(
        self,
        semantic_signals: Dict[str, Any],
        *,
        policy: Dict[str, Any],
    ) -> Dict[str, Any]:
        adjusted = copy.deepcopy(semantic_signals or {})
        mode = str(policy.get("mode", "")).strip()
        if mode == "soft_sketch":
            adjusted["fallback_animation_mode"] = str(
                policy.get("animation_mode", "soft_graph_strong_explanation")
            )
            adjusted["uses_soft_sketch_reconstruction"] = True
            return adjusted
        if mode != "limited":
            return adjusted
        adjusted["needs_extra_geometry_animation"] = False
        adjusted["recommended_geometry_actions"] = []
        adjusted["recommended_geometry_action_details"] = []
        adjusted["fallback_animation_mode"] = str(
            policy.get("animation_mode", "weak_graph_strong_explanation")
        )
        return adjusted

    def _read_image_size(self, image_path: str) -> Tuple[Optional[int], Optional[int]]:
        try:
            from PIL import Image

            with Image.open(image_path) as image:
                width, height = image.size
            return int(width), int(height)
        except Exception as exc:
            self._record_debug_issue("read_image_size", exc)
            return None, None

    def _analyze_problem_bundle(self, image_path: str) -> Dict[str, Any]:
        with open(image_path, "rb") as file:
            image_data = base64.b64encode(file.read()).decode()

        source_width, source_height = self._read_image_size(image_path)
        image_size_hint = (
            f"The uploaded source image size is {source_width}x{source_height} pixels."
            if source_width and source_height
            else "The uploaded source image pixel size is unavailable."
        )

        prompt = """
Analyze this plane-geometry problem image and return JSON only.
__IMAGE_SIZE_HINT__

Requirements:
1. `problem_text` must contain the full OCR text.
2. Treat the visual output as a Scene Draft: visible points, label boxes, visible segments, line style, faces, fold correspondences, and OCR. Do not output final Manim coordinates or abstract math coordinates.
3. `geometry_facts` must contain only visual facts, text-explicit facts, and known measurements. Do not invent solver-derived topology.
4. Be conservative. If something is uncertain, leave it out instead of guessing.
5. For every visible labeled point, include its approximate original uploaded-image pixel anchor in `geometry_facts.points` as an object: `{ "id": "A", "pixel_coord": {"x": 123, "y": 456}, "pixel_coord_space": "source" }`. Pixel origin is the top-left of the uploaded source image; x grows right and y grows down. `pixel_coord` must be the geometric point/dot/vertex, not the center of the text label. If the point is visible but hard to localize, omit only the pixel field, not the point.
6. If the text label is visible, also include its text bounding box as `label_bbox`: `{ "x1": 100, "y1": 80, "x2": 130, "y2": 105 }`, with `label_bbox_space: "source"`. Use this only for the printed label region; do not substitute it for `pixel_coord`.
7. Segment or line names such as `AB`, `AC`, `BE` are not point ids. Only labeled points like `A`, `B`, `C`, `O`, `D`, `E`, `M`, `P`, `C1` belong in `points`.
8. Prefer simple fact buckets instead of final compiler-ready schema:
   - `points`
   - `segments`
   - `polygons`
   - `circles`
   - `arcs`
   - `angles`
   - `right_angles`
   - `relations`
   - `measurements`
9. Each relation item must use one of:
   `point_on_segment`, `point_on_circle`, `collinear`, `perpendicular`, `parallel`, `midpoint`, `equal_length`, `intersect`.
10. Each measurement item must use one of:
   `length`, `angle`, `ratio`.
11. For a circle, include `center`, and if possible include `radius_point` or `points_on_circle`.
12. For an arc, include `center` and only the two arc endpoints.
13. Put facts directly visible in the diagram in `relations` or `measurements`; put facts explicitly stated in OCR in `text_explicit_relations` or `text_explicit_measurements`; put inferred facts only in `derived_relations` or `derived_measurements`.
14. If you cannot fit something into the simple fact buckets, omit it instead of inventing a new schema.

Return exactly:
{
  "problem_text": "full OCR text",
  "geometry_facts": {
    "confidence": 0.0,
    "ambiguities": [],
    "roles": {},
    "points": [{"id": "A", "pixel_coord": {"x": 0, "y": 0}, "pixel_coord_space": "source", "label_bbox": {"x1": 0, "y1": 0, "x2": 0, "y2": 0}, "label_bbox_space": "source"}],
    "segments": [],
    "polygons": [],
    "circles": [],
    "arcs": [],
    "angles": [],
    "right_angles": [],
    "relations": [],
    "measurements": [],
    "text_explicit_relations": [],
    "text_explicit_measurements": [],
    "derived_relations": [],
    "derived_measurements": []
  }
}
""".replace("__IMAGE_SIZE_HINT__", image_size_hint)

        messages = [
            {"role": "system", "content": self.system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_data}"},
                    },
                ],
            },
        ]

        result = self._invoke_model(messages, model_role="geometry").strip()
        try:
            Path(self.output_dir).mkdir(parents=True, exist_ok=True)
            debug_dir = Path(self.output_dir) / "debug"
            debug_dir.mkdir(parents=True, exist_ok=True)
            (debug_dir / "vision_bundle_raw_response.txt").write_text(
                result, encoding="utf-8"
            )
        except Exception as exc:
            self._record_debug_issue("analyze_problem_bundle_raw_response", exc)
        parsed_bundle = self._parse_json_like_output(
            result,
            {
                "problem_text": "",
                "geometry_facts": {
                    "confidence": 0.0,
                    "ambiguities": [],
                    "roles": {},
                    "points": [],
                    "segments": [],
                    "polygons": [],
                    "circles": [],
                    "arcs": [],
                    "angles": [],
                    "right_angles": [],
                    "relations": [],
                    "measurements": [],
                },
                "geometry_spec": {
                    "templates": [],
                    "confidence": 0.0,
                    "ambiguities": [],
                    "roles": {},
                    "points": [],
                    "primitives": [],
                    "constraints": [],
                    "measurements": [],
                },
            },
        )
        if not isinstance(parsed_bundle, dict):
            parsed_bundle = {}

        model_problem_text = str(parsed_bundle.get("problem_text", "")).strip()
        ocr_problem_text = ""
        try:
            ocr_problem_text = self._extract_problem_text_fallback(image_path)
        except Exception as exc:
            self._record_debug_issue("extract_problem_text_fallback", exc)
        model_score = self._problem_text_quality_score(model_problem_text)
        ocr_score = self._problem_text_quality_score(ocr_problem_text)
        parsed_bundle["problem_text_source"] = "model"
        if ocr_problem_text and (
            not model_problem_text or ocr_score >= (model_score - 0.2)
        ):
            parsed_bundle["problem_text"] = ocr_problem_text
            parsed_bundle["problem_text_source"] = "ocr_fallback"

        if not isinstance(parsed_bundle.get("geometry_facts"), dict):
            parsed_bundle["geometry_facts"] = self._extract_geometry_facts_fallback(
                image_path=image_path,
                problem_text=str(parsed_bundle.get("problem_text", "")).strip(),
            )
            parsed_bundle["geometry_facts_source"] = "geometry_fallback"
        else:
            parsed_bundle["geometry_facts_source"] = "model"

        self._write_debug_text(
            "vision_ocr_vs_geometry_text_quality.json",
            json.dumps(
                {
                    "model_score": round(model_score, 2),
                    "ocr_score": round(ocr_score, 2),
                    "picked": "ocr"
                    if str(parsed_bundle.get("problem_text", "")).strip()
                    == ocr_problem_text
                    else "geometry_bundle",
                },
                ensure_ascii=False,
                indent=2,
            ),
        )

        return parsed_bundle

    def _bundle_is_effectively_empty(self, bundle: Optional[Dict[str, Any]]) -> bool:
        if not isinstance(bundle, dict):
            return True
        problem_text = str(bundle.get("problem_text", "")).strip()
        geometry_facts = (
            bundle.get("geometry_facts") or bundle.get("geometry_spec") or {}
        )
        return (not problem_text) and (
            not self._geometry_facts_have_content(geometry_facts)
        )

    def _geometry_facts_have_content(
        self, geometry_facts: Optional[Dict[str, Any]]
    ) -> bool:
        if not isinstance(geometry_facts, dict):
            return False
        buckets = [
            "points",
            "segments",
            "polygons",
            "circles",
            "arcs",
            "angles",
            "right_angles",
            "relations",
            "text_explicit_relations",
            "derived_relations",
            "measurements",
            "text_explicit_measurements",
            "derived_measurements",
            "inferred_relations",
            "inferred_measurements",
            "primitives",
            "constraints",
        ]
        for bucket in buckets:
            items = geometry_facts.get(bucket)
            if isinstance(items, list) and items:
                return True
            if isinstance(items, dict) and items:
                return True
        return False

    def _recover_problem_bundle(
        self,
        image_path: str,
        original_bundle: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        recovered = copy.deepcopy(original_bundle or {})
        fallback_events = list(recovered.get("fallback_events") or [])
        recovered.setdefault("problem_text", "")
        recovered.setdefault(
            "geometry_facts",
            {
                "confidence": 0.0,
                "ambiguities": [],
                "roles": {},
                "points": [],
                "segments": [],
                "polygons": [],
                "circles": [],
                "arcs": [],
                "angles": [],
                "right_angles": [],
                "relations": [],
                "measurements": [],
            },
        )

        if not str(recovered.get("problem_text", "")).strip():
            recovered["problem_text"] = self._extract_problem_text_fallback(image_path)
            recovered["problem_text_source"] = "ocr_fallback"
            fallback_events.append("recover_problem_text_fallback")

        if not self._geometry_facts_have_content(recovered.get("geometry_facts")):
            recovered["geometry_facts"] = self._extract_geometry_facts_fallback(
                image_path=image_path,
                problem_text=str(recovered.get("problem_text", "")).strip(),
            )
            recovered["geometry_facts_source"] = "geometry_fallback"
            fallback_events.append("recover_geometry_facts_fallback")

        recovered["fallback_events"] = list(dict.fromkeys(fallback_events))

        return recovered

    def _stabilize_problem_bundle(
        self,
        bundle: Optional[Dict[str, Any]],
        *,
        image_path: str,
    ) -> Dict[str, Any]:
        stabilized = copy.deepcopy(bundle or {})
        fallback_events = list(stabilized.get("fallback_events") or [])
        problem_text = str(stabilized.get("problem_text", "")).strip()
        geometry_facts = stabilized.get("geometry_facts")
        if not isinstance(geometry_facts, dict):
            geometry_facts = {}
        source_width, source_height = self._read_image_size(image_path)
        image_size = (source_width, source_height)
        text_source = str(stabilized.get("problem_text_source", "model"))
        geometry_source = str(stabilized.get("geometry_facts_source", "model"))

        if not problem_text:
            problem_text = self._extract_problem_text_fallback(image_path)
            text_source = "ocr_fallback"
            fallback_events.append("problem_text_fallback")
        else:
            upgraded = self._upgrade_problem_text_if_needed(
                problem_text, image_path=image_path
            )
            if upgraded != problem_text:
                text_source = "upgraded_ocr"
                fallback_events.append("problem_text_upgrade")
            problem_text = upgraded

        text_facts = self._extract_text_facts_from_problem_text(problem_text)
        geometry_facts = self._merge_text_facts_into_geometry_facts(
            geometry_facts,
            text_facts,
        )
        geometry_facts = self._sanitize_geometry_facts(
            geometry_facts, problem_text=problem_text, image_size=image_size
        )
        if (
            geometry_facts.get("text_explicit_relations")
            or geometry_facts.get("text_explicit_measurements")
            or geometry_facts.get("derived_relations")
            or geometry_facts.get("derived_measurements")
            or geometry_facts.get("inferred_relations")
            or geometry_facts.get("inferred_measurements")
        ):
            if geometry_source == "model":
                geometry_source = "sanitized_layered_facts"

        if not self._geometry_facts_have_content(geometry_facts):
            fallback = self._extract_geometry_facts_fallback(
                image_path=image_path,
                problem_text=problem_text,
            )
            geometry_facts = self._sanitize_geometry_facts(
                fallback, problem_text=problem_text, image_size=image_size
            )
            geometry_source = "geometry_fallback"
            fallback_events.append("geometry_facts_fallback")

        normalized = self.geometry_normalizer.normalize(
            geometry_facts,
            problem_text=problem_text,
            image_size=image_size,
        )
        scene_draft = normalized["scene_draft"]
        geometry_ir = normalized["geometry_ir"]
        stabilized["problem_text"] = problem_text
        stabilized["geometry_facts"] = geometry_facts
        stabilized["scene_draft"] = scene_draft
        stabilized["geometry_ir"] = geometry_ir
        stabilized["text_facts"] = text_facts
        stabilized["problem_text_source"] = text_source
        stabilized["geometry_facts_source"] = geometry_source
        stabilized["fallback_events"] = list(dict.fromkeys(fallback_events))
        return stabilized

    def _extract_text_facts_from_problem_text(
        self, problem_text: str
    ) -> Dict[str, Any]:
        normalized = self._normalize_prime_markers(problem_text)
        result: Dict[str, Any] = {
            "points": [],
            "segments": [],
            "text_explicit_relations": [],
            "text_explicit_measurements": [],
            "derived_relations": [],
            "derived_measurements": [],
        }
        if not str(normalized or "").strip():
            return result

        points: List[str] = []
        for token in self._iter_problem_text_point_tokens(normalized):
            point = self._normalize_point_token(token)
            if point:
                points.append(point)
        result["points"] = self._ordered_unique_tokens(points)

        segments: List[str] = []
        for match in re.findall(
            r"(?<!\d\s)(?<![A-Za-z0-9_'])([A-Z]\d*['′]?\s*[A-Z]\d*['′]?)(?![A-Za-z0-9_'])",
            normalized,
        ):
            seg = self._normalize_segment_token(match)
            if seg:
                segments.append(seg)
        result["segments"] = self._ordered_unique_tokens(segments)

        text_relations: List[Dict[str, Any]] = []
        text_measurements: List[Dict[str, Any]] = []
        derived_measurements: List[Dict[str, Any]] = []

        for match in re.finditer(
            r"([A-Z]\d*'*)\s*是\s*([A-Z]\d*'*[A-Z]\d*'*)\s*的?中点", normalized
        ):
            point_id = self._normalize_point_token(match.group(1))
            segment_id = self._normalize_segment_token(match.group(2))
            if point_id and segment_id:
                text_relations.append(
                    {"type": "midpoint", "point": point_id, "segment": segment_id}
                )

        for match in re.finditer(
            r"([A-Z]\d*'*)\s*(?:在|是)\s*([A-Z]\d*'*[A-Z]\d*'*)\s*(?:上|上一点|上的一点)",
            normalized,
        ):
            point_id = self._normalize_point_token(match.group(1))
            segment_id = self._normalize_segment_token(match.group(2))
            if point_id and segment_id:
                text_relations.append(
                    {
                        "type": "point_on_segment",
                        "point": point_id,
                        "segment": segment_id,
                    }
                )

        for match in re.finditer(
            r"([A-Z]\d*'*)\s*(?:在|属于)?\s*[⊙○]\s*([A-Z]\d*'*)\s*(?:上|内)?",
            normalized,
        ):
            point_id = self._normalize_point_token(match.group(1))
            center = self._normalize_point_token(match.group(2))
            if point_id and center:
                text_relations.append(
                    {
                        "type": "point_on_circle",
                        "point": point_id,
                        "circle": f"circle_{center}",
                    }
                )

        segment_pattern = r"([A-Z]\d*['′]?[A-Z]\d*['′]?)"
        explicit_relation_patterns = [
            ("parallel", rf"{segment_pattern}\s*(?:∥|//)\s*{segment_pattern}"),
            (
                "parallel",
                rf"{segment_pattern}\s*与\s*{segment_pattern}\s*(?:互相)?平行",
            ),
            ("perpendicular", rf"{segment_pattern}\s*(?:⊥|⟂)\s*{segment_pattern}"),
            (
                "perpendicular",
                rf"{segment_pattern}\s*与\s*{segment_pattern}\s*(?:互相)?垂直",
            ),
            ("equal_length", rf"{segment_pattern}\s*=\s*{segment_pattern}"),
        ]
        for relation_type, pattern in explicit_relation_patterns:
            for match in re.finditer(pattern, normalized):
                first = self._normalize_segment_token(match.group(1))
                second = self._normalize_segment_token(match.group(2))
                if first and second and first != second:
                    payload = {"type": relation_type, "segments": [first, second]}
                    if self._is_problem_text_goal_relation(normalized, match.start()):
                        payload.update(
                            {
                                "source": "problem_text_goal",
                                "status": "goal",
                                "confidence": 0.98,
                            }
                        )
                        result["derived_relations"].append(payload)
                    else:
                        text_relations.append(payload)

        for match in re.finditer(
            r"(?<![A-Z0-9'′])([A-Z]\d*['′]?[A-Z]\d*['′]?)\s*=\s*([-+]?\d+(?:\.\d+)?)",
            normalized,
        ):
            segment_id = self._normalize_segment_token(match.group(1))
            if not segment_id:
                continue
            value = self._safe_float(match.group(2), default=None)
            if value is None:
                continue
            text_measurements.append(
                {"type": "length", "segment": segment_id, "value": value}
            )

        for match in re.finditer(
            r"∠\s*([A-Z]\d*'*(?:[A-Z]\d*'*){2})\s*=\s*([-+]?\d+(?:\.\d+)?)", normalized
        ):
            angle_name = self._normalize_angle_name("∠" + match.group(1))
            value = self._safe_float(match.group(2), default=None)
            if angle_name and value is not None:
                text_measurements.append(
                    {"type": "angle", "angle": angle_name, "value": value}
                )

        for match in re.finditer(
            r"tan\s*([A-Z]\d*'*)\s*=\s*([-+]?\d+(?:\.\d+)?)",
            normalized,
            flags=re.IGNORECASE,
        ):
            angle_name = self._normalize_angle_name("∠" + match.group(1))
            if angle_name:
                derived_measurements.append(
                    {
                        "type": "angle",
                        "angle": angle_name,
                        "value": f"arctan({match.group(2)})",
                    }
                )

        result["text_explicit_relations"] = self._dedupe_fact_dicts(text_relations)
        result["text_explicit_measurements"] = self._dedupe_fact_dicts(
            text_measurements
        )
        result["derived_relations"] = self._dedupe_fact_dicts(
            result.get("derived_relations") or []
        )
        result["derived_measurements"] = self._dedupe_fact_dicts(derived_measurements)
        return result

    def _merge_text_facts_into_geometry_facts(
        self,
        geometry_facts: Optional[Dict[str, Any]],
        text_facts: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        merged = copy.deepcopy(geometry_facts or {})
        text_payload = text_facts if isinstance(text_facts, dict) else {}

        merged_point_payloads = self._point_payloads_from_raw(merged.get("points"))
        merged_point_ids = self._ordered_unique_tokens(
            [
                *list(merged_point_payloads.keys()),
                *[
                    str(item).strip()
                    for item in (text_payload.get("points") or [])
                    if str(item).strip()
                ],
            ]
        )
        merged_points = [
            copy.deepcopy(merged_point_payloads[point_id])
            if point_id in merged_point_payloads
            else point_id
            for point_id in merged_point_ids
        ]
        merged_segments = self._ordered_unique_tokens(
            [
                *[
                    str(item).strip()
                    for item in (merged.get("segments") or [])
                    if str(item).strip()
                ],
                *[
                    str(item).strip()
                    for item in (text_payload.get("segments") or [])
                    if str(item).strip()
                ],
            ]
        )
        merged["points"] = merged_points
        merged["segments"] = merged_segments

        for bucket in (
            "text_explicit_relations",
            "text_explicit_measurements",
            "derived_relations",
            "derived_measurements",
        ):
            combined = [
                *[
                    item
                    for item in (merged.get(bucket) or [])
                    if isinstance(item, dict)
                ],
                *[
                    item
                    for item in (text_payload.get(bucket) or [])
                    if isinstance(item, dict)
                ],
            ]
            merged[bucket] = self._dedupe_fact_dicts(combined)

        return merged

    def _upgrade_problem_text_if_needed(
        self, problem_text: str, *, image_path: str
    ) -> str:
        base_text = str(problem_text or "").strip()
        if not self._should_retry_problem_text(base_text):
            return base_text

        try:
            fallback_text = self._extract_problem_text_fallback(image_path)
        except Exception:
            return base_text

        fallback_text = str(fallback_text or "").strip()
        base_score = self._problem_text_quality_score(base_text)
        fallback_score = self._problem_text_quality_score(fallback_text)

        picked = fallback_text if fallback_score > (base_score + 0.8) else base_text
        debug_payload = {
            "base_score": round(base_score, 2),
            "fallback_score": round(fallback_score, 2),
            "picked": "fallback" if picked == fallback_text else "base",
            "base_preview": base_text[:160],
            "fallback_preview": fallback_text[:160],
        }
        self._write_debug_text(
            "problem_text_quality_check.json",
            json.dumps(debug_payload, ensure_ascii=False, indent=2),
        )
        return picked

    def _should_retry_problem_text(self, problem_text: str) -> bool:
        text = str(problem_text or "").strip()
        if not text:
            return True
        if len(text) < 40:
            if not re.search(r"[。！？?]$", text) and ("\n" not in text):
                return True
            return False

        has_blank = bool(re.search(r"（\s*\)|\(\s*\)", text))
        has_choice_markers = bool(
            re.search(r"(?:^|\n)\s*[A-DＡ-Ｄ][\.、．\)]\s*", text, re.IGNORECASE)
        )
        has_terminal_punctuation = bool(re.search(r"[。！？?]$", text))
        if has_blank and not has_choice_markers:
            return True

        if (
            len(text) < 80
            and (not has_choice_markers)
            and (not has_terminal_punctuation)
            and ("\n" not in text)
        ):
            return True

        if text.endswith(("，", ",", "、", "；", ";", ":", "：")):
            return True
        return False

    def _problem_text_quality_score(self, problem_text: str) -> float:
        text = str(problem_text or "").strip()
        if not text:
            return 0.0

        score = min(len(text), 600) / 120.0
        if "\n" in text:
            score += 0.8
        if re.search(r"(?:^|\n)\s*[A-DＡ-Ｄ][\.、．\)]\s*", text, re.IGNORECASE):
            score += 1.5
        if re.search(r"（\s*\)|\(\s*\)", text):
            score += 0.6
        if re.search(r"[。！？?]$", text):
            score += 0.4
        return score

    def _sanitize_geometry_facts(
        self,
        geometry_facts: Optional[Dict[str, Any]],
        *,
        problem_text: str,
        image_size: Optional[Tuple[Optional[int], Optional[int]]] = None,
    ) -> Dict[str, Any]:
        facts = copy.deepcopy(geometry_facts or {})
        sanitized: Dict[str, Any] = {
            "confidence": self._safe_float(facts.get("confidence"), default=0.0),
            "ambiguities": [
                str(item).strip()
                for item in (facts.get("ambiguities") or [])
                if str(item).strip()
            ],
            "roles": facts.get("roles") if isinstance(facts.get("roles"), dict) else {},
            "points": [],
            "segments": [],
            "polygons": [],
            "circles": [],
            "arcs": [],
            "angles": [],
            "right_angles": [],
            "relations": [],
            "observed_relations": [],
            "unverified_observed_relations": [],
            "text_explicit_relations": [],
            "derived_relations": [],
            "inferred_relations": [],
            "measurements": [],
            "observed_measurements": [],
            "text_explicit_measurements": [],
            "derived_measurements": [],
            "inferred_measurements": [],
            "display": copy.deepcopy(facts.get("display"))
            if isinstance(facts.get("display"), dict)
            else {"points": {}, "primitives": {}},
        }

        point_payloads = self._point_payloads_from_raw(
            facts.get("points"), image_size=image_size
        )
        points = self._ordered_unique_tokens(
            list(point_payloads.keys())
            + list(self._iter_point_tokens(facts.get("points")))
            + list(self._iter_problem_text_points(problem_text))
        )
        point_set = set(points)
        sanitized["points"] = [
            copy.deepcopy(point_payloads[point_id])
            if point_id in point_payloads
            else point_id
            for point_id in points
        ]

        segments = self._ordered_unique_tokens(
            list(self._iter_segment_tokens(facts.get("segments")))
            + self._infer_problem_text_segments(problem_text, point_set)
        )
        segment_set = set(segments)
        sanitized["segments"] = segments

        polygons = self._ordered_unique_tokens(
            list(self._iter_polygon_tokens(facts.get("polygons")))
            + self._infer_problem_text_polygons(problem_text, point_set)
        )
        sanitized["polygons"] = polygons

        circles = self._sanitize_circle_bucket(
            facts.get("circles"),
            point_set=point_set,
        )
        sanitized["circles"] = circles

        circle_ref_map: Dict[str, str] = {}
        for item in circles:
            circle_id = str(item.get("id", "")).strip()
            center = str(item.get("center", "")).strip()
            if circle_id:
                circle_ref_map[circle_id] = circle_id
            if center:
                circle_ref_map[center] = circle_id or center

        arcs = self._sanitize_arc_bucket(
            facts.get("arcs"),
            point_set=point_set,
            circle_ref_map=circle_ref_map,
        )
        sanitized["arcs"] = arcs

        # Ensure circle/arc referenced points are retained with deterministic ordering.
        sanitized["points"] = self._merge_ordered_points(sanitized["points"], point_set)

        sanitized["angles"] = self._sanitize_angle_bucket(
            facts.get("angles"),
            point_set=point_set,
        )
        sanitized["right_angles"] = self._sanitize_angle_bucket(
            facts.get("right_angles"),
            point_set=point_set,
            force_right=True,
        )
        sanitized["measurements"] = self._sanitize_measurement_bucket(
            facts.get("measurements"),
            point_set=point_set,
            segment_set=segment_set,
        )
        angle_vertices = self._collect_angle_vertices(
            angles=sanitized["angles"],
            right_angles=sanitized["right_angles"],
            measurements=sanitized["measurements"],
        )
        has_fold_semantics = self._contains_fold_semantics(problem_text)
        has_explicit_midpoint = bool(
            re.search(r"中点|midpoint", str(problem_text or ""), re.IGNORECASE)
        )

        sanitized["text_explicit_relations"] = self._sanitize_relation_bucket(
            facts.get("text_explicit_relations"),
            point_set=point_set,
            segment_set=segment_set,
            circle_ref_map=circle_ref_map,
            angle_vertices=angle_vertices,
            has_fold_semantics=has_fold_semantics,
            allow_midpoint=has_explicit_midpoint,
        )
        sanitized["derived_relations"] = self._sanitize_relation_bucket(
            [
                *(facts.get("derived_relations") or []),
                *(facts.get("inferred_relations") or []),
            ],
            point_set=point_set,
            segment_set=segment_set,
            circle_ref_map=circle_ref_map,
            angle_vertices=angle_vertices,
            has_fold_semantics=has_fold_semantics,
            allow_midpoint=has_explicit_midpoint,
        )
        sanitized["text_explicit_measurements"] = self._sanitize_measurement_bucket(
            facts.get("text_explicit_measurements"),
            point_set=point_set,
            segment_set=segment_set,
        )
        sanitized["derived_measurements"] = self._sanitize_measurement_bucket(
            [
                *(facts.get("derived_measurements") or []),
                *(facts.get("inferred_measurements") or []),
            ],
            point_set=point_set,
            segment_set=segment_set,
        )

        sanitized["text_explicit_relations"] = self._ensure_fact_metadata(
            sanitized["text_explicit_relations"],
            source="problem_text_explicit",
            status="text_explicit",
            default_confidence=0.98,
        )
        sanitized["derived_relations"] = self._ensure_fact_metadata(
            sanitized["derived_relations"],
            source="problem_text_derived",
            status="derived",
            default_confidence=0.72,
        )
        sanitized["text_explicit_measurements"] = self._ensure_fact_metadata(
            sanitized["text_explicit_measurements"],
            source="problem_text_explicit",
            status="text_explicit",
            default_confidence=0.98,
        )
        sanitized["derived_measurements"] = self._ensure_fact_metadata(
            sanitized["derived_measurements"],
            source="problem_text_derived",
            status="derived",
            default_confidence=0.72,
        )
        sanitized["relations"] = self._sanitize_relation_bucket(
            facts.get("relations"),
            point_set=point_set,
            segment_set=segment_set,
            circle_ref_map=circle_ref_map,
            angle_vertices=angle_vertices,
            has_fold_semantics=has_fold_semantics,
            allow_midpoint=has_explicit_midpoint,
        )
        sanitized["observed_relations"] = copy.deepcopy(sanitized["relations"])
        sanitized["observed_measurements"] = copy.deepcopy(sanitized["measurements"])

        self._augment_facts_from_problem_text(
            sanitized,
            problem_text=problem_text,
            point_set=point_set,
            segment_set=segment_set,
        )
        self._prune_conflicting_polygon_topology(
            sanitized,
            problem_text=problem_text,
            point_set=point_set,
        )
        segment_set = set(sanitized.get("segments") or [])
        self._augment_fold_visible_structure(
            sanitized,
            problem_text=problem_text,
            point_set=point_set,
            segment_set=segment_set,
        )

        relation_verification = self._verify_observed_relations_against_text(
            sanitized.get("observed_relations", []),
            text_relations=[
                *sanitized.get("text_explicit_relations", []),
                *sanitized.get("derived_relations", []),
            ],
            problem_text=problem_text,
        )
        sanitized["observed_relations"] = relation_verification["verified_relations"]
        sanitized["unverified_observed_relations"] = relation_verification[
            "unverified_relations"
        ]
        sanitized["fact_verification_report"] = relation_verification["report"]

        sanitized["relations"] = self._dedupe_fact_dicts(
            [
                *sanitized.get("observed_relations", []),
                *sanitized.get("text_explicit_relations", []),
            ]
        )
        sanitized["measurements"] = self._dedupe_fact_dicts(
            [
                *sanitized.get("observed_measurements", []),
                *sanitized.get("text_explicit_measurements", []),
            ]
        )
        sanitized["derived_relations"] = self._dedupe_fact_dicts(
            sanitized.get("derived_relations", [])
        )
        sanitized["derived_measurements"] = self._dedupe_fact_dicts(
            sanitized.get("derived_measurements", [])
        )
        # Backward compatibility for downstream consumers still reading inferred_*.
        sanitized["inferred_relations"] = copy.deepcopy(sanitized["derived_relations"])
        sanitized["inferred_measurements"] = copy.deepcopy(
            sanitized["derived_measurements"]
        )
        sanitized["points"] = self._merge_ordered_points(sanitized["points"], point_set)
        return sanitized

    def _augment_fold_visible_structure(
        self,
        facts: Dict[str, Any],
        *,
        problem_text: str,
        point_set: set,
        segment_set: set,
    ) -> None:
        normalized_text = self._normalize_prime_markers(problem_text)
        if not re.search(
            r"折叠|翻折|对折|fold|reflect",
            str(normalized_text or ""),
            re.IGNORECASE,
        ):
            return

        axis_segment = self._infer_text_fold_axis_segment(normalized_text)
        image_pairs = self._infer_fold_image_pairs_from_points(point_set)
        if not axis_segment or not image_pairs:
            return

        axis_refs = self._segment_endpoints_from_token(axis_segment)
        if len(axis_refs) != 2:
            return

        source_to_image = {
            source: image
            for source, image in image_pairs
            if source and image and source != image
        }
        if not source_to_image:
            return

        if axis_segment not in segment_set:
            facts.setdefault("segments", []).append(axis_segment)
            segment_set.add(axis_segment)

        display = facts.setdefault("display", {})
        primitive_display = display.setdefault("primitives", {})
        primitive_display.setdefault(f"seg_{axis_segment}", {}).update(
            {"style": "solid", "role": "fold_axis", "source": "fold_transform"}
        )

        original_segments = self._dedupe_undirected_segments(facts.get("segments") or [])
        folded_segments: List[str] = []
        dashed_original_segments: List[str] = []
        folded_segment_pairs: List[Tuple[str, str]] = []
        for segment in original_segments:
            refs = self._segment_endpoints_from_token(segment)
            if len(refs) != 2:
                continue
            mapped_refs = [source_to_image.get(ref, ref) for ref in refs]
            if mapped_refs == refs:
                continue
            folded_segment = self._normalize_segment_token("".join(mapped_refs))
            if folded_segment:
                folded_segments.append(folded_segment)
                folded_segment_pairs.append((segment, folded_segment))
            if set(refs) != set(axis_refs):
                dashed_original_segments.append(segment)

        for segment in self._dedupe_undirected_segments(folded_segments):
            if segment not in segment_set:
                facts.setdefault("segments", []).append(segment)
                segment_set.add(segment)
            primitive_display.setdefault(f"seg_{segment}", {}).update(
                {
                    "style": "solid",
                    "role": "folded_visible",
                    "source": "fold_transform",
                }
            )

        for segment in self._dedupe_undirected_segments(dashed_original_segments):
            primitive_display.setdefault(f"seg_{segment}", {}).update(
                {
                    "style": "dashed",
                    "role": "pre_fold_reference",
                    "source": "fold_transform",
                }
            )

        polygons = facts.setdefault("polygons", [])
        folded_polygons: List[str] = []
        for polygon in list(self._iter_polygon_tokens(polygons)):
            refs = self._polygon_refs_from_token(polygon)
            if len(refs) < 3:
                continue
            mapped_refs = [source_to_image.get(ref, ref) for ref in refs]
            if mapped_refs == refs or len(set(mapped_refs)) < 3:
                continue
            folded_polygon = self._normalize_polygon_token("".join(mapped_refs))
            if folded_polygon:
                folded_polygons.append(folded_polygon)

        for polygon in self._ordered_unique_tokens(folded_polygons):
            if polygon not in polygons:
                polygons.append(polygon)
            primitive_display.setdefault(f"poly_{polygon}", {}).update(
                {
                    "role": "folded_visible_outline",
                    "source": "fold_transform",
                }
            )

        seen_relation_pairs: set[frozenset] = set()
        for original, folded in folded_segment_pairs:
            if original == folded:
                continue
            pair_key = frozenset((original, folded))
            if pair_key in seen_relation_pairs:
                continue
            seen_relation_pairs.add(pair_key)
            relation = {"type": "equal_length", "segments": [original, folded]}
            self._append_unique_relation(facts, "derived_relations", relation)

    def _infer_text_fold_axis_segment(self, text: Any) -> str:
        plain = self._plain_geometry_text(text)
        patterns = [
            r"沿([A-Z]\d*'*[A-Z]\d*'*)(?:折叠|翻折|对折)",
            r"关于(?:直线)?([A-Z]\d*'*[A-Z]\d*'*).{0,6}(?:折叠|翻折|对折|对称)",
        ]
        for pattern in patterns:
            match = re.search(pattern, plain, re.IGNORECASE)
            if not match:
                continue
            segment = self._normalize_segment_token(match.group(1))
            if segment:
                return segment
        return ""

    def _infer_fold_image_pairs_from_points(self, point_set: set) -> List[Tuple[str, str]]:
        normalized_points = {
            self._normalize_point_token(point)
            for point in point_set or set()
            if self._normalize_point_token(point)
        }
        pairs: List[Tuple[str, str]] = []
        for point in sorted(normalized_points):
            if not point.endswith("'"):
                continue
            source = point[:-1]
            if source in normalized_points:
                pairs.append((source, point))
        return pairs

    def _plain_geometry_text(self, text: Any) -> str:
        plain = self._normalize_prime_markers(text)
        plain = plain.replace("\\(", "").replace("\\)", "")
        plain = plain.replace("\\[", "").replace("\\]", "")
        plain = plain.replace("{", "").replace("}", "")
        plain = plain.replace("\\", "")
        plain = re.sub(r"\s+", "", plain)
        return plain

    def _is_problem_text_goal_relation(
        self, normalized_text: str, match_start: int
    ) -> bool:
        text = self._normalize_prime_markers(normalized_text)
        try:
            start = int(match_start)
        except (TypeError, ValueError):
            return False
        if start <= 0:
            return False
        prefix = text[:start]
        lower_prefix = prefix.lower()
        goal_markers = ("求证", "证明", "证：", "证:", "prove", "show that")
        last_goal = max(
            (lower_prefix.rfind(marker) for marker in goal_markers),
            default=-1,
        )
        if last_goal < 0:
            return False
        last_boundary = max(
            (
                prefix.rfind(marker)
                for marker in ("。", "！", "？", "?", "；", ";", "\n")
            ),
            default=-1,
        )
        if last_goal < last_boundary:
            return False
        last_given = max(
            (prefix.rfind(marker) for marker in ("已知", "设", "令", "连接", "作")),
            default=-1,
        )
        return last_goal >= last_given

    def _append_unique_relation(
        self,
        facts: Dict[str, Any],
        bucket: str,
        relation: Dict[str, Any],
    ) -> None:
        items = facts.setdefault(bucket, [])
        candidate = json.dumps(relation, ensure_ascii=False, sort_keys=True)
        existing = {
            json.dumps(item, ensure_ascii=False, sort_keys=True)
            for item in items
            if isinstance(item, dict)
        }
        if candidate not in existing:
            items.append(relation)

    def _append_unique_angle(
        self,
        facts: Dict[str, Any],
        bucket: str,
        angle: Dict[str, Any],
    ) -> None:
        self._append_unique_relation(facts, bucket, angle)

    def _verify_observed_relations_against_text(
        self,
        observed_relations: List[Dict[str, Any]],
        *,
        text_relations: List[Dict[str, Any]],
        problem_text: str,
    ) -> Dict[str, Any]:
        gated_types = {
            "parallel",
            "perpendicular",
            "equal_length",
            "midpoint",
            "collinear",
        }
        verified: List[Dict[str, Any]] = []
        unverified: List[Dict[str, Any]] = []
        normalized_text = self._normalize_prime_markers(problem_text)
        text_signatures = {
            self._relation_text_signature(item)
            for item in text_relations
            if isinstance(item, dict)
        }
        text_signatures.discard("")

        for relation in observed_relations or []:
            if not isinstance(relation, dict):
                continue
            relation_type = str(relation.get("type", "")).strip().lower()
            if (
                relation_type not in gated_types
                or not str(normalized_text or "").strip()
            ):
                verified.append(copy.deepcopy(relation))
                continue
            signature = self._relation_text_signature(relation)
            has_text_fact = bool(signature and signature in text_signatures)
            has_keyword_support = self._problem_text_supports_relation_type(
                relation_type, normalized_text
            )
            if has_text_fact or has_keyword_support:
                item = copy.deepcopy(relation)
                item.setdefault("source", "vision_geometry_guess")
                item.setdefault("status", "text_supported")
                item.setdefault("confidence", 0.8)
                item["text_verification"] = (
                    "matched_text_fact" if has_text_fact else "matched_text_keyword"
                )
                verified.append(item)
                continue

            item = copy.deepcopy(relation)
            item["source"] = str(item.get("source") or "vision_geometry_guess")
            item["status"] = "unverified_from_text"
            base_confidence = self._safe_float(item.get("confidence"), default=0.55)
            item["confidence"] = round(max(0.05, min(1.0, base_confidence * 0.3)), 4)
            item["text_verification"] = "missing_text_support"
            evidence = item.get("evidence")
            if not isinstance(evidence, list):
                evidence = []
            evidence.append("problem_text:no supporting explicit or keyword evidence")
            item["evidence"] = evidence
            unverified.append(item)

        report = {
            "version": "v1",
            "policy": "text_grounded_geometry_relations",
            "gated_relation_types": sorted(gated_types),
            "verified_observed_relations": len(verified),
            "unverified_observed_relations": len(unverified),
        }
        return {
            "verified_relations": self._dedupe_fact_dicts(verified),
            "unverified_relations": self._dedupe_fact_dicts(unverified),
            "report": report,
        }

    def _relation_text_signature(self, relation: Dict[str, Any]) -> str:
        relation_type = str(relation.get("type", "")).strip().lower()
        if not relation_type:
            return ""
        if relation_type in {"parallel", "perpendicular", "equal_length"}:
            raw_segments = relation.get("segments") or relation.get("lines") or []
            segments = [self._normalize_segment_token(item) for item in raw_segments]
            segments = [item for item in segments if item]
            if len(segments) < 2:
                return ""
            return f"{relation_type}:{'|'.join(sorted(segments[:2]))}"
        if relation_type == "midpoint":
            point_id = self._normalize_point_token(
                relation.get("point") or relation.get("midpoint")
            )
            segment_id = self._normalize_segment_token(
                relation.get("segment") or relation.get("line")
            )
            if point_id and segment_id:
                return f"{relation_type}:{point_id}|{segment_id}"
        if relation_type == "collinear":
            points = [
                self._normalize_point_token(item)
                for item in (relation.get("points") or relation.get("entities") or [])
            ]
            points = [item for item in points if item]
            if len(points) >= 3:
                return f"{relation_type}:{'|'.join(sorted(points[:3]))}"
        return ""

    def _problem_text_supports_relation_type(
        self,
        relation_type: str,
        normalized_text: str,
    ) -> bool:
        patterns = {
            "parallel": r"平行|∥|//|平行四边形|矩形|正方形|菱形|梯形",
            "perpendicular": r"垂直|直角|⊥|⟂|90\s*°?|矩形|正方形|对角线互相垂直",
            "equal_length": r"相等|等长|等腰|等边|菱形|正方形|半径|直径|(?<!\d)=[A-Z]",
            "midpoint": r"中点|平分",
            "collinear": r"共线|在.+上",
        }
        pattern = patterns.get(str(relation_type or "").strip().lower())
        if not pattern:
            return False
        return bool(re.search(pattern, str(normalized_text or ""), re.IGNORECASE))

    def _point_payloads_from_raw(
        self,
        raw: Any,
        *,
        image_size: Optional[Tuple[Optional[int], Optional[int]]] = None,
    ) -> Dict[str, Dict[str, Any]]:
        payloads: Dict[str, Dict[str, Any]] = {}

        def add_payload(raw_id: Any, payload: Optional[Dict[str, Any]] = None) -> None:
            point_id = self._normalize_point_token(raw_id)
            if not point_id:
                return
            if not isinstance(payload, dict):
                return
            item = copy.deepcopy(payload)
            item["id"] = point_id
            normalize_point_pixel_anchor(item, image_size=image_size)
            payloads[point_id] = item

        if isinstance(raw, dict):
            for key, value in raw.items():
                add_payload(key, value if isinstance(value, dict) else None)
        elif isinstance(raw, (list, tuple)):
            for item in raw:
                if isinstance(item, dict):
                    add_payload(
                        item.get("id") or item.get("label") or item.get("name"), item
                    )
                else:
                    add_payload(item)
        else:
            add_payload(raw)
        return payloads

    def _iter_point_tokens(self, raw: Any):
        if isinstance(raw, dict):
            for key, value in raw.items():
                token = self._normalize_point_token(key)
                if token:
                    yield token
                if isinstance(value, dict):
                    nested = self._normalize_point_token(
                        value.get("id") or value.get("label") or value.get("name")
                    )
                    if nested:
                        yield nested
        elif isinstance(raw, (list, tuple)):
            for item in raw:
                token = self._normalize_point_token(
                    item
                    if not isinstance(item, dict)
                    else item.get("id") or item.get("label") or item.get("name")
                )
                if token:
                    yield token

    def _iter_problem_text_points(self, text: str):
        normalized = self._normalize_prime_markers(text)
        for token in self._iter_problem_text_point_tokens(normalized):
            point = self._normalize_point_token(token)
            if point:
                yield point

    def _iter_problem_text_point_tokens(self, normalized_text: str):
        text = str(normalized_text or "")
        for match in re.finditer(r"[A-Z]\d*['′]?", text):
            start, end = match.span()
            prev_char = text[start - 1] if start > 0 else ""
            next_char = text[end] if end < len(text) else ""
            if prev_char and re.match(r"[a-z]", prev_char):
                continue
            if next_char and re.match(r"[a-z]", next_char):
                continue
            yield match.group(0)

    def _iter_segment_tokens(self, raw: Any):
        if isinstance(raw, (list, tuple)):
            for item in raw:
                token = self._normalize_segment_token(
                    item
                    if not isinstance(item, dict)
                    else item.get("id") or item.get("segment") or item.get("label")
                )
                if token:
                    yield token

    def _iter_polygon_tokens(self, raw: Any):
        if isinstance(raw, (list, tuple)):
            for item in raw:
                token = self._normalize_polygon_token(
                    item
                    if not isinstance(item, dict)
                    else item.get("id") or item.get("polygon") or item.get("label")
                )
                if token:
                    yield token

    def _sanitize_angle_bucket(
        self,
        raw_bucket: Any,
        *,
        point_set: set,
        force_right: bool = False,
    ) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []
        seen: set = set()
        for raw in raw_bucket or []:
            if not isinstance(raw, dict):
                continue
            vertex = self._normalize_point_token(raw.get("vertex"))
            refs: List[str] = []
            sides = raw.get("sides")
            if vertex and isinstance(sides, (list, tuple)) and len(sides) == 2:
                for side in sides:
                    endpoints = self._segment_endpoints_from_token(side)
                    if len(endpoints) == 2 and vertex in endpoints:
                        refs.append(
                            endpoints[0] if endpoints[1] == vertex else endpoints[1]
                        )

            if len(refs) != 2:
                angle_points = self._extract_angle_points_from_text(
                    raw.get("angle")
                    or raw.get("name")
                    or raw.get("label")
                    or raw.get("description")
                    or ""
                )
                if len(angle_points) == 3:
                    refs = [angle_points[0], angle_points[2]]
                    vertex = vertex or angle_points[1]

            if len(refs) == 2 and vertex:
                point_set.add(vertex)
                point_set.add(refs[0])
                point_set.add(refs[1])

            if (
                len(refs) == 2
                and vertex
                and vertex in point_set
                and refs[0] in point_set
                and refs[1] in point_set
            ):
                payload = {
                    "vertex": vertex,
                    "sides": [
                        self._normalize_segment_token(vertex + refs[0]),
                        self._normalize_segment_token(vertex + refs[1]),
                    ],
                }
                for key in ("name", "label", "description"):
                    if str(raw.get(key, "")).strip():
                        payload[key] = str(raw.get(key)).strip()
                        break
                signature = (vertex, tuple(sorted(refs)), force_right)
                if signature not in seen:
                    seen.add(signature)
                    result.append(payload)
        return result

    def _sanitize_circle_bucket(
        self,
        raw_bucket: Any,
        *,
        point_set: set,
    ) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []
        seen: set = set()
        for raw in raw_bucket or []:
            circle_id = ""
            center = ""
            radius_point = ""
            points_on_circle: List[str] = []

            if isinstance(raw, str):
                center = self._normalize_circle_center_token(raw)
            elif isinstance(raw, dict):
                circle_id = self._normalize_circle_id(
                    raw.get("id") or raw.get("circle") or raw.get("circle_id")
                )
                center = self._normalize_point_token(
                    raw.get("center") or raw.get("origin") or raw.get("o")
                )
                if not center:
                    center = self._normalize_circle_center_token(
                        raw.get("label") or raw.get("name") or raw.get("id")
                    )
                radius_point = self._normalize_point_token(
                    raw.get("radius_point") or raw.get("point")
                )
                points_on_circle = [
                    self._normalize_point_token(item)
                    for item in self._extract_points_from_any(
                        raw.get("points_on_circle")
                        or raw.get("points")
                        or raw.get("on_points")
                        or raw.get("entities")
                    )
                ]
                points_on_circle = [
                    item for item in points_on_circle if item and item != center
                ]

            if not center:
                continue
            if not circle_id:
                circle_id = f"circle_{center}"

            if center:
                point_set.add(center)
            if radius_point:
                point_set.add(radius_point)
            for point_id in points_on_circle:
                point_set.add(point_id)

            payload: Dict[str, Any] = {"id": circle_id, "center": center}
            if radius_point and radius_point != center:
                payload["radius_point"] = radius_point
            unique_circle_points = self._ordered_unique_tokens(points_on_circle)
            if unique_circle_points:
                payload["points_on_circle"] = unique_circle_points

            signature = json.dumps(payload, ensure_ascii=False, sort_keys=True)
            if signature in seen:
                continue
            seen.add(signature)
            result.append(payload)
        return result

    def _sanitize_arc_bucket(
        self,
        raw_bucket: Any,
        *,
        point_set: set,
        circle_ref_map: Dict[str, str],
    ) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []
        seen: set = set()
        for raw in raw_bucket or []:
            arc_id = ""
            center = ""
            circle_ref = ""
            endpoints: List[str] = []

            if isinstance(raw, str):
                refs = [
                    self._normalize_point_token(item)
                    for item in self._extract_points_from_any(raw)
                ]
                endpoints = [item for item in refs if item][:2]
            elif isinstance(raw, dict):
                arc_id = str(raw.get("id") or "").strip().replace(" ", "_")
                center = self._normalize_point_token(
                    raw.get("center") or raw.get("origin")
                )
                circle_ref = self._resolve_circle_ref(
                    raw.get("circle") or raw.get("circle_id"),
                    circle_ref_map,
                )
                refs = [
                    self._normalize_point_token(item)
                    for item in self._extract_points_from_any(
                        raw.get("points")
                        or raw.get("endpoints")
                        or [raw.get("start"), raw.get("end")]
                        or raw.get("entities")
                    )
                ]
                endpoints = [item for item in refs if item][:2]

            if len(endpoints) != 2:
                continue

            for point_id in endpoints:
                point_set.add(point_id)
            if center:
                point_set.add(center)

            if not arc_id:
                arc_id = f"arc_{endpoints[0]}{endpoints[1]}"

            payload: Dict[str, Any] = {
                "id": arc_id,
                "points": endpoints,
            }
            if center:
                payload["center"] = center
            if circle_ref:
                payload["circle"] = circle_ref

            signature = json.dumps(payload, ensure_ascii=False, sort_keys=True)
            if signature in seen:
                continue
            seen.add(signature)
            result.append(payload)
        return result

    def _sanitize_relation_bucket(
        self,
        raw_bucket: Any,
        *,
        point_set: set,
        segment_set: set,
        circle_ref_map: Dict[str, str],
        angle_vertices: set,
        has_fold_semantics: bool,
        allow_midpoint: bool,
    ) -> List[Dict[str, Any]]:
        allowed = {
            "point_on_segment",
            "point_on_circle",
            "collinear",
            "perpendicular",
            "parallel",
            "midpoint",
            "equal_length",
            "intersect",
        }
        result: List[Dict[str, Any]] = []
        seen: set = set()
        for raw in raw_bucket or []:
            if not isinstance(raw, dict):
                continue
            relation_type = str(raw.get("type", "")).strip().lower()
            if relation_type not in allowed:
                continue
            item = None
            entity_refs = [
                str(item).strip()
                for item in (raw.get("entities") or [])
                if str(item).strip()
            ]
            if relation_type == "point_on_segment":
                point_id = self._normalize_point_token(
                    raw.get("point") or (entity_refs[0] if entity_refs else "")
                )
                segment_raw = (
                    raw.get("segment")
                    or raw.get("line")
                    or (entity_refs[1] if len(entity_refs) >= 2 else "")
                )
                segment_id = self._normalize_segment_token(segment_raw)
                if point_id and point_id in point_set and segment_id:
                    item = {
                        "type": relation_type,
                        "point": point_id,
                        "segment": segment_id,
                    }
            elif relation_type == "collinear":
                raw_points = raw.get("points") or entity_refs
                pts = [self._normalize_point_token(item) for item in raw_points]
                pts = [item for item in pts if item and item in point_set]
                if len(dict.fromkeys(pts)) == 3:
                    item = {"type": relation_type, "points": list(dict.fromkeys(pts))}
            elif relation_type in {"parallel", "perpendicular", "equal_length"}:
                raw_segments = raw.get("segments") or raw.get("lines") or entity_refs
                segs = [self._normalize_segment_token(item) for item in raw_segments]
                segs = [item for item in segs if item]
                if relation_type == "equal_length" and len(segs) >= 2:
                    item = {
                        "type": relation_type,
                        "segments": list(dict.fromkeys(segs)),
                    }
                elif len(dict.fromkeys(segs)) == 2:
                    item = {
                        "type": relation_type,
                        "segments": list(dict.fromkeys(segs)),
                    }
            elif relation_type == "midpoint":
                point_id = self._normalize_point_token(
                    raw.get("point")
                    or raw.get("midpoint")
                    or (entity_refs[0] if entity_refs else "")
                )
                segment_raw = (
                    raw.get("segment")
                    or raw.get("line")
                    or (entity_refs[1] if len(entity_refs) >= 2 else "")
                )
                segment_id = self._normalize_segment_token(segment_raw)
                if has_fold_semantics and not allow_midpoint:
                    continue
                if point_id and point_id in point_set and segment_id:
                    item = {
                        "type": relation_type,
                        "point": point_id,
                        "segment": segment_id,
                    }
            elif relation_type == "intersect":
                point_id = self._normalize_point_token(
                    raw.get("point")
                    or raw.get("intersection")
                    or (entity_refs[0] if entity_refs else "")
                )
                raw_segments = (
                    raw.get("segments") or raw.get("lines") or entity_refs[1:]
                )
                segs = [self._normalize_segment_token(item) for item in raw_segments]
                segs = [item for item in segs if item]
                if point_id and point_id in point_set and len(dict.fromkeys(segs)) == 2:
                    item = {
                        "type": relation_type,
                        "point": point_id,
                        "segments": list(dict.fromkeys(segs)),
                    }
            elif relation_type == "point_on_circle":
                point_id = self._normalize_point_token(
                    raw.get("point") or (entity_refs[0] if entity_refs else "")
                )
                circle_raw = (
                    raw.get("circle")
                    or raw.get("circle_id")
                    or (entity_refs[1] if len(entity_refs) >= 2 else "")
                )
                circle_id = self._resolve_circle_ref(circle_raw, circle_ref_map)
                if point_id and point_id in point_set and circle_id:
                    item = {
                        "type": relation_type,
                        "point": point_id,
                        "circle": circle_id,
                    }

            if not item:
                continue
            item = self._carry_fact_metadata(item=item, raw=raw)
            signature = json.dumps(item, ensure_ascii=False, sort_keys=True)
            if signature in seen:
                continue
            seen.add(signature)
            result.append(item)
        return result

    def _sanitize_measurement_bucket(
        self,
        raw_bucket: Any,
        *,
        point_set: set,
        segment_set: set,
    ) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []
        seen: set = set()
        for raw in raw_bucket or []:
            if not isinstance(raw, dict):
                continue
            measurement_type = str(raw.get("type", "")).strip().lower()
            item = None
            if measurement_type == "length":
                segment_id = self._normalize_segment_token(
                    raw.get("segment") or raw.get("line")
                )
                if not segment_id:
                    entities = [
                        str(item).strip()
                        for item in (raw.get("entities") or [])
                        if str(item).strip()
                    ]
                    if len(entities) == 2:
                        segment_id = self._normalize_segment_token("".join(entities))
                value = self._extract_numeric_or_symbolic_value(raw.get("value"))
                if segment_id and value is not None:
                    item = {"type": "length", "segment": segment_id, "value": value}
            elif measurement_type == "angle":
                value = self._extract_angle_value(raw.get("value"))
                angle_name = self._normalize_angle_name(
                    raw.get("angle") or raw.get("name") or raw.get("label")
                )
                vertex = self._normalize_point_token(raw.get("vertex"))
                if angle_name and value is not None:
                    item = {"type": "angle", "angle": angle_name, "value": value}
                elif vertex and value is not None:
                    payload = {"type": "angle", "vertex": vertex, "value": value}
                    if str(raw.get("description", "")).strip():
                        payload["description"] = str(raw.get("description")).strip()
                    item = payload
                else:
                    entities = [
                        self._normalize_point_token(entity)
                        for entity in (raw.get("entities") or [])
                    ]
                    entities = [entity for entity in entities if entity]
                    if len(entities) == 3 and value is not None:
                        item = {"type": "angle", "entities": entities, "value": value}
            elif measurement_type == "ratio":
                value = self._extract_numeric_or_symbolic_value(raw.get("value"))
                raw_segments = (
                    raw.get("segments") or raw.get("lines") or raw.get("entities") or []
                )
                segs = [self._normalize_segment_token(item) for item in raw_segments]
                segs = [item for item in segs if item]
                if len(segs) >= 2 and value is not None:
                    item = {"type": "ratio", "segments": segs[:2], "value": value}
            if not item:
                continue
            item = self._carry_fact_metadata(item=item, raw=raw)
            signature = json.dumps(item, ensure_ascii=False, sort_keys=True)
            if signature in seen:
                continue
            seen.add(signature)
            result.append(item)
        return result

    def _collect_angle_vertices(
        self,
        *,
        angles: List[Dict[str, Any]],
        right_angles: List[Dict[str, Any]],
        measurements: List[Dict[str, Any]],
    ) -> set:
        vertices: set = set()
        for bucket in (angles, right_angles):
            for item in bucket:
                if not isinstance(item, dict):
                    continue
                vertex = self._normalize_point_token(item.get("vertex"))
                if vertex:
                    vertices.add(vertex)
        for item in measurements:
            if not isinstance(item, dict):
                continue
            vertex = self._normalize_point_token(item.get("vertex"))
            if vertex:
                vertices.add(vertex)
                continue
            entities = [
                self._normalize_point_token(entity)
                for entity in (item.get("entities") or [])
            ]
            entities = [entity for entity in entities if entity]
            if len(entities) == 3:
                vertices.add(entities[1])
                continue
            angle_points = self._extract_angle_points_from_text(item.get("angle") or "")
            if len(angle_points) == 3:
                vertices.add(angle_points[1])
        return vertices

    def _augment_facts_from_problem_text(
        self,
        facts: Dict[str, Any],
        *,
        problem_text: str,
        point_set: set,
        segment_set: set,
    ) -> None:
        normalized = self._normalize_prime_markers(problem_text)
        facts.setdefault(
            "observed_relations", copy.deepcopy(facts.get("relations") or [])
        )
        facts.setdefault(
            "observed_measurements", copy.deepcopy(facts.get("measurements") or [])
        )
        facts.setdefault("text_explicit_relations", [])
        facts.setdefault("text_explicit_measurements", [])
        facts.setdefault("derived_relations", [])
        facts.setdefault("derived_measurements", [])
        facts.setdefault("inferred_relations", [])
        facts.setdefault("inferred_measurements", [])

        def with_provenance(
            payload: Dict[str, Any],
            *,
            source: str,
            status: str,
            evidence: str,
            confidence: float,
        ) -> Dict[str, Any]:
            item = copy.deepcopy(payload)
            item["source"] = source
            item["status"] = status
            item["confidence"] = confidence
            item["evidence"] = [evidence]
            return item

        def push_relation(
            payload: Dict[str, Any],
            *,
            bucket: str,
            source: str,
            status: str,
            confidence: float,
            also_primary: bool,
        ) -> None:
            enriched = with_provenance(
                payload,
                source=source,
                status=status,
                evidence=f"problem_text:{str(problem_text or '').strip()[:120]}",
                confidence=confidence,
            )
            if enriched not in facts[bucket]:
                facts[bucket].append(enriched)
            if also_primary and enriched not in facts["relations"]:
                facts["relations"].append(copy.deepcopy(enriched))

        def push_measurement(
            payload: Dict[str, Any],
            *,
            bucket: str,
            source: str,
            status: str,
            confidence: float,
            also_primary: bool,
        ) -> None:
            enriched = with_provenance(
                payload,
                source=source,
                status=status,
                evidence=f"problem_text:{str(problem_text or '').strip()[:120]}",
                confidence=confidence,
            )
            if enriched not in facts[bucket]:
                facts[bucket].append(enriched)
            if also_primary and enriched not in facts["measurements"]:
                facts["measurements"].append(copy.deepcopy(enriched))

        for match in re.finditer(r"[⊙○]\s*([A-Z]\d*'*)", normalized):
            center = self._normalize_point_token(match.group(1))
            if not center:
                continue
            point_set.add(center)
            if center not in facts["points"]:
                facts["points"].append(center)
            circle_payload = {"id": f"circle_{center}", "center": center}
            if circle_payload not in facts["circles"]:
                facts["circles"].append(circle_payload)

        for match in re.finditer(
            r"([A-Z]\d*'*)\s*(?:在|属于)?\s*[⊙○]\s*([A-Z]\d*'*)\s*(?:上|内)?",
            normalized,
        ):
            point_id = self._normalize_point_token(match.group(1))
            center = self._normalize_point_token(match.group(2))
            if not point_id or not center:
                continue
            point_set.add(point_id)
            point_set.add(center)
            if point_id not in facts["points"]:
                facts["points"].append(point_id)
            if center not in facts["points"]:
                facts["points"].append(center)
            circle_id = f"circle_{center}"
            circle_payload = {"id": circle_id, "center": center}
            if circle_payload not in facts["circles"]:
                facts["circles"].append(circle_payload)
            relation_payload = {
                "type": "point_on_circle",
                "point": point_id,
                "circle": circle_id,
            }
            push_relation(
                relation_payload,
                bucket="text_explicit_relations",
                source="problem_text_explicit",
                status="text_explicit",
                confidence=0.98,
                also_primary=True,
            )

        segment_pattern = r"([A-Z]\d*['′]?[A-Z]\d*['′]?)"
        explicit_relation_patterns = [
            ("parallel", rf"{segment_pattern}\s*(?:∥|//)\s*{segment_pattern}"),
            (
                "parallel",
                rf"{segment_pattern}\s*与\s*{segment_pattern}\s*(?:互相)?平行",
            ),
            ("perpendicular", rf"{segment_pattern}\s*(?:⊥|⟂)\s*{segment_pattern}"),
            (
                "perpendicular",
                rf"{segment_pattern}\s*与\s*{segment_pattern}\s*(?:互相)?垂直",
            ),
            ("equal_length", rf"{segment_pattern}\s*=\s*{segment_pattern}"),
        ]
        for relation_type, pattern in explicit_relation_patterns:
            for match in re.finditer(pattern, normalized):
                first = self._normalize_segment_token(match.group(1))
                second = self._normalize_segment_token(match.group(2))
                if not first or not second or first == second:
                    continue
                is_goal_relation = self._is_problem_text_goal_relation(
                    normalized, match.start()
                )
                push_relation(
                    {"type": relation_type, "segments": [first, second]},
                    bucket=(
                        "derived_relations"
                        if is_goal_relation
                        else "text_explicit_relations"
                    ),
                    source=(
                        "problem_text_goal"
                        if is_goal_relation
                        else "problem_text_explicit"
                    ),
                    status="goal" if is_goal_relation else "text_explicit",
                    confidence=0.98,
                    also_primary=not is_goal_relation,
                )

        for match in re.finditer(
            r"正方形\s*([A-Z]\d*'*)([A-Z]\d*'*)([A-Z]\d*'*)([A-Z]\d*'*)",
            normalized,
        ):
            refs = [self._normalize_point_token(token) for token in match.groups()]
            refs = [item for item in refs if item]
            if len(refs) != 4 or len(set(refs)) != 4:
                continue
            polygon = "".join(refs)
            if polygon not in facts["polygons"]:
                facts["polygons"].append(polygon)
            edges = []
            for first, second in zip(refs, refs[1:] + refs[:1]):
                seg = self._normalize_segment_token(first + second)
                if not seg:
                    continue
                edges.append(seg)
                if seg not in facts["segments"]:
                    facts["segments"].append(seg)
            if len(edges) != 4:
                continue
            is_goal_shape = self._is_problem_text_goal_relation(
                normalized, match.start()
            )
            square_relations = [
                {"type": "parallel", "segments": [edges[0], edges[2]]},
                {"type": "parallel", "segments": [edges[1], edges[3]]},
                {"type": "perpendicular", "segments": [edges[0], edges[1]]},
                {"type": "perpendicular", "segments": [edges[1], edges[2]]},
                {"type": "perpendicular", "segments": [edges[2], edges[3]]},
                {"type": "perpendicular", "segments": [edges[3], edges[0]]},
                {"type": "equal_length", "segments": [edges[0], edges[1]]},
                {"type": "equal_length", "segments": [edges[1], edges[2]]},
                {"type": "equal_length", "segments": [edges[2], edges[3]]},
            ]
            for relation in square_relations:
                push_relation(
                    relation,
                    bucket=(
                        "derived_relations"
                        if is_goal_shape
                        else "text_explicit_relations"
                    ),
                    source=(
                        "problem_text_goal"
                        if is_goal_shape
                        else "problem_text_explicit"
                    ),
                    status="goal" if is_goal_shape else "text_explicit",
                    confidence=0.98,
                    also_primary=not is_goal_shape,
                )

        if "菱形" in normalized:
            for match in re.finditer(
                r"菱形\s*([A-Z]\d*'*)([A-Z]\d*'*)([A-Z]\d*'*)([A-Z]\d*'*)", normalized
            ):
                refs = [self._normalize_point_token(token) for token in match.groups()]
                refs = [item for item in refs if item]
                if len(refs) != 4:
                    continue
                polygon = "".join(refs)
                if polygon not in facts["polygons"]:
                    facts["polygons"].append(polygon)
                for first, second in zip(refs, refs[1:] + refs[:1]):
                    seg = self._normalize_segment_token(first + second)
                    if seg and seg not in facts["segments"]:
                        facts["segments"].append(seg)
                parallels = [
                    {
                        "type": "parallel",
                        "segments": [
                            self._normalize_segment_token(refs[0] + refs[1]),
                            self._normalize_segment_token(refs[2] + refs[3]),
                        ],
                    },
                    {
                        "type": "parallel",
                        "segments": [
                            self._normalize_segment_token(refs[1] + refs[2]),
                            self._normalize_segment_token(refs[3] + refs[0]),
                        ],
                    },
                    {
                        "type": "equal_length",
                        "segments": [
                            self._normalize_segment_token(refs[0] + refs[1]),
                            self._normalize_segment_token(refs[1] + refs[2]),
                        ],
                    },
                    {
                        "type": "equal_length",
                        "segments": [
                            self._normalize_segment_token(refs[1] + refs[2]),
                            self._normalize_segment_token(refs[2] + refs[3]),
                        ],
                    },
                    {
                        "type": "equal_length",
                        "segments": [
                            self._normalize_segment_token(refs[2] + refs[3]),
                            self._normalize_segment_token(refs[3] + refs[0]),
                        ],
                    },
                ]
                for relation in parallels:
                    push_relation(
                        relation,
                        bucket="derived_relations",
                        source="problem_text_derived",
                        status="derived",
                        confidence=0.72,
                        also_primary=False,
                    )

        for match in re.finditer(
            r"沿\s*([A-Z]\d*'*[A-Z]\d*'*)\s*(?:折叠|翻折)", normalized
        ):
            seg = self._normalize_segment_token(match.group(1))
            if seg and seg not in facts["segments"]:
                facts["segments"].append(seg)

        for match in re.finditer(
            r"(?<![A-Z0-9'′])([A-Z]\d*['′]?[A-Z]\d*['′]?)\s*=\s*([-+]?\d+(?:\.\d+)?)",
            normalized,
        ):
            token = self._normalize_segment_token(match.group(1))
            if token:
                payload = {
                    "type": "length",
                    "segment": token,
                    "value": self._safe_float(match.group(2), default=None),
                }
                if payload["value"] is not None:
                    push_measurement(
                        payload,
                        bucket="text_explicit_measurements",
                        source="problem_text_explicit",
                        status="text_explicit",
                        confidence=0.98,
                        also_primary=True,
                    )

        for match in re.finditer(
            r"tan\s*([A-Z]\d*'*)\s*=\s*([-+]?\d+(?:\.\d+)?)",
            normalized,
            flags=re.IGNORECASE,
        ):
            angle_name = self._normalize_angle_name("∠" + match.group(1))
            if angle_name:
                payload = {
                    "type": "angle",
                    "angle": angle_name,
                    "value": f"arctan({match.group(2)})",
                }
                push_measurement(
                    payload,
                    bucket="derived_measurements",
                    source="problem_text_derived",
                    status="derived",
                    confidence=0.68,
                    also_primary=False,
                )

        for match in re.finditer(
            r"∠\s*([A-Z]\d*'*(?:[A-Z]\d*'*){2})\s*=\s*([-+]?\d+(?:\.\d+)?)", normalized
        ):
            angle_name = self._normalize_angle_name("∠" + match.group(1))
            value = self._safe_float(match.group(2), default=None)
            if angle_name and value is not None:
                payload = {"type": "angle", "angle": angle_name, "value": value}
                push_measurement(
                    payload,
                    bucket="text_explicit_measurements",
                    source="problem_text_explicit",
                    status="text_explicit",
                    confidence=0.98,
                    also_primary=True,
                )

    def _infer_problem_text_segments(self, text: str, point_set: set) -> List[str]:
        normalized = self._normalize_prime_markers(text)
        result: List[str] = []
        pattern = re.compile(r"(?<![A-Z0-9'])([A-Z]\d*'*[A-Z]\d*'*)(?![A-Z0-9'])")
        for match in pattern.finditer(normalized):
            segment = self._normalize_segment_token(match.group(1))
            if not segment:
                continue
            endpoints = self._segment_endpoints_from_token(segment)
            if (
                len(endpoints) == 2
                and point_set
                and (endpoints[0] not in point_set or endpoints[1] not in point_set)
            ):
                continue
            result.append(segment)
        return result

    def _infer_problem_text_polygons(self, text: str, point_set: set) -> List[str]:
        normalized = self._normalize_prime_markers(text)
        result: List[str] = []
        for match in re.finditer(
            r"(?:正方形|矩形|菱形|平行四边形|四边形|△|三角形)?\s*([A-Z]\d*'*(?:[A-Z]\d*'*){2,3})",
            normalized,
        ):
            token = self._normalize_polygon_token(match.group(1))
            if token:
                result.append(token)
        return result

    def _infer_explicit_text_polygons(self, text: str, point_set: set) -> List[str]:
        normalized = self._normalize_prime_markers(text)
        result: List[str] = []
        shape_patterns = [
            r"(?:正方形|矩形|菱形|平行四边形|四边形|square|rectangle|rhombus|parallelogram|quadrilateral)\s*([A-Z]\d*'*)\s*([A-Z]\d*'*)\s*([A-Z]\d*'*)\s*([A-Z]\d*'*)",
            r"(?:△|三角形|triangle)\s*([A-Z]\d*'*)\s*([A-Z]\d*'*)\s*([A-Z]\d*'*)",
        ]
        for pattern in shape_patterns:
            for match in re.finditer(pattern, normalized, re.IGNORECASE):
                refs = [self._normalize_point_token(token) for token in match.groups()]
                refs = [item for item in refs if item]
                if len(refs) < 3 or len(set(refs)) != len(refs):
                    continue
                if point_set and any(ref not in point_set for ref in refs):
                    continue
                result.append("".join(refs))
        return self._ordered_unique_tokens(result)

    def _polygon_refs_from_token(self, token: Any) -> List[str]:
        normalized = self._normalize_polygon_token(token)
        if not normalized:
            return []
        return [
            self._normalize_point_token(item)
            for item in self._extract_points_from_any(normalized)
        ]

    def _polygon_edge_keys(self, polygon: Any) -> List[frozenset]:
        refs = [item for item in self._polygon_refs_from_token(polygon) if item]
        if len(refs) < 3:
            return []
        edges: List[frozenset] = []
        for first, second in zip(refs, refs[1:] + refs[:1]):
            key = self._segment_edge_key(first + second)
            if key:
                edges.append(key)
        return edges

    def _segment_edge_key(self, raw_segment: Any) -> Optional[frozenset]:
        segment = self._normalize_segment_token(raw_segment)
        endpoints = self._segment_endpoints_from_token(segment)
        if len(endpoints) != 2:
            return None
        return frozenset(endpoints)

    def _relation_segment_edge_keys(self, relation: Dict[str, Any]) -> List[frozenset]:
        if not isinstance(relation, dict):
            return []
        refs = relation.get("segments") or relation.get("lines") or []
        if not isinstance(refs, (list, tuple)):
            refs = [refs]
        keys: List[frozenset] = []
        for ref in refs:
            key = self._segment_edge_key(ref)
            if key:
                keys.append(key)
        segment = relation.get("segment") or relation.get("line")
        key = self._segment_edge_key(segment)
        if key:
            keys.append(key)
        return keys

    def _prune_conflicting_polygon_topology(
        self,
        facts: Dict[str, Any],
        *,
        problem_text: str,
        point_set: set,
    ) -> None:
        explicit_polygons = self._infer_explicit_text_polygons(
            problem_text,
            point_set,
        )
        input_polygons = self._ordered_unique_tokens(
            list(self._iter_polygon_tokens(facts.get("polygons")))
        )
        if not input_polygons and not explicit_polygons:
            return

        segment_support = {
            key
            for key in (self._segment_edge_key(segment) for segment in facts.get("segments") or [])
            if key
        }
        explicit_by_point_set: Dict[frozenset, List[str]] = {}
        for polygon in explicit_polygons:
            refs = self._polygon_refs_from_token(polygon)
            if len(refs) >= 3:
                explicit_by_point_set.setdefault(frozenset(refs), []).append(polygon)

        candidates_by_point_set: Dict[frozenset, List[str]] = {}
        candidate_order = self._ordered_unique_tokens(input_polygons + explicit_polygons)
        for polygon in candidate_order:
            refs = self._polygon_refs_from_token(polygon)
            if len(refs) < 3:
                continue
            candidates_by_point_set.setdefault(frozenset(refs), []).append(polygon)

        selected_by_point_set: Dict[frozenset, str] = {}
        removed_polygons: List[str] = []
        for point_key, candidates in candidates_by_point_set.items():
            unique_edge_sets = {
                tuple(sorted(tuple(sorted(edge)) for edge in self._polygon_edge_keys(candidate)))
                for candidate in candidates
            }
            if len(candidates) == 1 or len(unique_edge_sets) <= 1:
                selected_by_point_set[point_key] = candidates[0]
                continue

            explicit_candidates = explicit_by_point_set.get(point_key, [])

            def score(candidate: str) -> Tuple[int, int, int]:
                explicit_score = (
                    len(explicit_candidates) - explicit_candidates.index(candidate)
                    if candidate in explicit_candidates
                    else 0
                )
                edge_score = sum(
                    1 for edge in self._polygon_edge_keys(candidate) if edge in segment_support
                )
                order_score = len(candidate_order) - candidate_order.index(candidate)
                return (explicit_score, edge_score, order_score)

            selected = max(candidates, key=score)
            selected_by_point_set[point_key] = selected
            removed_polygons.extend(
                candidate
                for candidate in candidates
                if candidate != selected
                and set(self._polygon_edge_keys(candidate))
                != set(self._polygon_edge_keys(selected))
            )

        kept_polygons: List[str] = []
        for polygon in candidate_order:
            refs = self._polygon_refs_from_token(polygon)
            selected = selected_by_point_set.get(frozenset(refs))
            if selected == polygon and polygon not in kept_polygons:
                kept_polygons.append(polygon)

        if not removed_polygons:
            facts["polygons"] = kept_polygons
            facts["segments"] = self._dedupe_undirected_segments(
                facts.get("segments") or []
            )
            return

        removed_edges: set[frozenset] = set()
        for polygon in removed_polygons:
            removed_edges.update(self._polygon_edge_keys(polygon))
        protected_edges: set[frozenset] = set()
        for polygon in kept_polygons:
            protected_edges.update(self._polygon_edge_keys(polygon))
        for segment in self._infer_problem_text_segments(problem_text, point_set):
            key = self._segment_edge_key(segment)
            if key:
                protected_edges.add(key)

        pruned_segments: List[str] = []
        for segment in self._dedupe_undirected_segments(facts.get("segments") or []):
            key = self._segment_edge_key(segment)
            if key and key in removed_edges and key not in protected_edges:
                continue
            pruned_segments.append(segment)

        def keep_relation(relation: Dict[str, Any]) -> bool:
            for key in self._relation_segment_edge_keys(relation):
                if key in removed_edges and key not in protected_edges:
                    return False
            return True

        for bucket in (
            "relations",
            "observed_relations",
            "text_explicit_relations",
            "derived_relations",
            "inferred_relations",
        ):
            facts[bucket] = [
                item
                for item in facts.get(bucket, []) or []
                if keep_relation(item)
            ]
        facts["polygons"] = kept_polygons
        facts["segments"] = pruned_segments

    def _dedupe_undirected_segments(self, values: Any) -> List[str]:
        result: List[str] = []
        seen: set[frozenset] = set()
        for segment in self._iter_segment_tokens(values):
            key = self._segment_edge_key(segment)
            if not key or key in seen:
                continue
            seen.add(key)
            result.append(segment)
        return result

    def _normalize_point_token(self, raw: Any) -> str:
        text = self._normalize_prime_markers(raw).strip().replace(" ", "")
        if not text:
            return ""
        if re.fullmatch(r"[A-Za-z]\d*'*", text):
            return text[0].upper() + text[1:]
        return ""

    def _normalize_segment_token(self, raw: Any) -> str:
        text = self._normalize_prime_markers(raw).strip().replace(" ", "")
        if text.startswith("seg_"):
            text = text[4:]
        refs = re.findall(r"[A-Za-z]\d*'*", text)
        if len(refs) == 2 and "".join(refs) == text:
            return refs[0][0].upper() + refs[0][1:] + refs[1][0].upper() + refs[1][1:]
        return ""

    def _normalize_polygon_token(self, raw: Any) -> str:
        text = self._normalize_prime_markers(raw).strip().replace(" ", "")
        refs = re.findall(r"[A-Za-z]\d*'*", text)
        if len(refs) >= 3 and "".join(refs) == text:
            return "".join(ref[0].upper() + ref[1:] for ref in refs)
        return ""

    def _normalize_circle_center_token(self, raw: Any) -> str:
        text = self._normalize_prime_markers(raw).strip().replace(" ", "")
        if not text:
            return ""
        marker_match = re.search(r"[⊙○]([A-Za-z]\d*'*)", text)
        if marker_match:
            return self._normalize_point_token(marker_match.group(1))
        if text.lower().startswith("circle_"):
            return self._normalize_point_token(text.split("_", 1)[1])
        refs = re.findall(r"[A-Za-z]\d*'*", text)
        if len(refs) == 1:
            return self._normalize_point_token(refs[0])
        return ""

    def _normalize_circle_id(self, raw: Any) -> str:
        text = str(raw or "").strip().replace(" ", "_")
        if not text:
            return ""
        return self._normalize_prime_markers(text)

    def _resolve_circle_ref(self, raw: Any, circle_ref_map: Dict[str, str]) -> str:
        direct = self._normalize_circle_id(raw)
        if direct and direct in circle_ref_map:
            return circle_ref_map[direct]
        center = self._normalize_circle_center_token(raw)
        if center and center in circle_ref_map:
            return circle_ref_map[center]
        return direct or center

    def _extract_points_from_any(self, raw: Any) -> List[str]:
        if raw is None:
            return []
        if isinstance(raw, str):
            normalized = self._normalize_prime_markers(raw)
            return re.findall(r"[A-Za-z]\d*'*", normalized)
        if isinstance(raw, dict):
            for key in ("points", "endpoints", "entities", "vertices"):
                if raw.get(key) is not None:
                    return self._extract_points_from_any(raw.get(key))
            for key in ("id", "label", "name"):
                if raw.get(key) is not None:
                    return self._extract_points_from_any(raw.get(key))
            return []
        if isinstance(raw, (list, tuple)):
            result: List[str] = []
            for item in raw:
                result.extend(self._extract_points_from_any(item))
            return result
        return []

    def _segment_endpoints_from_token(self, raw: Any) -> List[str]:
        text = self._normalize_prime_markers(raw).strip().replace(" ", "")
        if text.startswith("seg_"):
            text = text[4:]
        refs = re.findall(r"[A-Za-z]\d*'*", text)
        if len(refs) == 2 and "".join(refs) == text:
            return [refs[0][0].upper() + refs[0][1:], refs[1][0].upper() + refs[1][1:]]
        return []

    def _normalize_angle_name(self, raw: Any) -> str:
        text = self._normalize_prime_markers(raw).strip().replace(" ", "")
        if not text:
            return ""
        if not text.startswith("∠"):
            text = "∠" + text
        refs = re.findall(r"[A-Za-z]\d*'*", text)
        if len(refs) in {1, 3}:
            return "∠" + "".join(ref[0].upper() + ref[1:] for ref in refs)
        return ""

    def _extract_angle_points_from_text(self, raw: Any) -> List[str]:
        text = self._normalize_prime_markers(raw).strip()
        if not text:
            return []
        match = re.search(
            r"(?:∠|angle)?\s*([A-Za-z]\d*'*(?:[A-Za-z]\d*'*){2})",
            text,
            flags=re.IGNORECASE,
        )
        if not match:
            return []
        refs = [
            self._normalize_point_token(item)
            for item in re.findall(r"[A-Za-z]\d*'*", match.group(1))
        ]
        refs = [item for item in refs if item]
        if len(refs) == 3:
            return refs
        return []

    def _extract_angle_value(self, raw: Any) -> Any:
        text = str(raw or "").strip()
        if not text:
            return None
        arctan_match = re.search(
            r"arctan\(\s*[-+]?\d+(?:\.\d+)?\s*\)", text, flags=re.IGNORECASE
        )
        if arctan_match:
            return arctan_match.group(0)
        numeric = self._safe_float(text, default=None)
        if numeric is not None:
            return numeric
        match = re.search(r"[-+]?\d+(?:\.\d+)?", text)
        if match and ("tan" in text.lower() or "arctan" in text.lower()):
            return f"arctan({match.group(0)})"
        return None

    def _extract_numeric_or_symbolic_value(self, raw: Any) -> Any:
        numeric = self._safe_float(raw, default=None)
        if numeric is not None:
            return numeric
        text = str(raw or "").strip()
        return text if text else None

    def _ordered_unique_tokens(self, values: List[str]) -> List[str]:
        seen = set()
        ordered: List[str] = []
        for value in values:
            if not value or value in seen:
                continue
            seen.add(value)
            ordered.append(value)
        return ordered

    def _dedupe_fact_dicts(self, values: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        deduped: List[Dict[str, Any]] = []
        seen = set()
        for value in values:
            if not isinstance(value, dict):
                continue
            try:
                signature = json.dumps(value, ensure_ascii=False, sort_keys=True)
            except Exception:
                signature = repr(sorted(value.items(), key=lambda item: item[0]))
            if signature in seen:
                continue
            seen.add(signature)
            deduped.append(copy.deepcopy(value))
        return deduped

    def _ensure_fact_metadata(
        self,
        values: List[Dict[str, Any]],
        *,
        source: str,
        status: str,
        default_confidence: float,
    ) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        for value in values:
            if not isinstance(value, dict):
                continue
            item = copy.deepcopy(value)
            item.setdefault("source", source)
            item.setdefault("status", status)
            item.setdefault("confidence", default_confidence)
            if not isinstance(item.get("evidence"), list):
                item["evidence"] = []
            normalized.append(item)
        return self._dedupe_fact_dicts(normalized)

    def _carry_fact_metadata(
        self, *, item: Dict[str, Any], raw: Dict[str, Any]
    ) -> Dict[str, Any]:
        merged = copy.deepcopy(item)
        if not isinstance(raw, dict):
            return merged

        for key in ("source", "status"):
            value = raw.get(key)
            if str(value or "").strip():
                merged[key] = str(value).strip()

        if raw.get("confidence") is not None:
            confidence = self._safe_float(raw.get("confidence"), default=None)
            if confidence is not None:
                merged["confidence"] = confidence

        evidence = raw.get("evidence")
        if isinstance(evidence, list):
            merged["evidence"] = [
                str(item).strip() for item in evidence if str(item).strip()
            ]
        elif str(evidence or "").strip():
            merged["evidence"] = [str(evidence).strip()]

        return merged

    def _merge_ordered_points(
        self, existing_points: List[Any], point_set: set
    ) -> List[Any]:
        ordered: List[Any] = []
        seen = set()
        for item in existing_points or []:
            point_id = self._normalize_point_token(
                item.get("id") or item.get("label") or item.get("name")
                if isinstance(item, dict)
                else item
            )
            if not point_id or point_id in seen:
                continue
            seen.add(point_id)
            if isinstance(item, dict):
                payload = copy.deepcopy(item)
                payload["id"] = point_id
                ordered.append(payload)
            else:
                ordered.append(point_id)
        extras = sorted(item for item in point_set if item and item not in seen)
        ordered.extend(extras)
        return ordered

    def _safe_float(self, raw: Any, default: Optional[float]) -> Optional[float]:
        try:
            return float(raw)
        except (TypeError, ValueError):
            return default

    def _normalize_prime_markers(self, raw: Any) -> str:
        return str(raw or "").replace("′", "'").replace("’", "'").replace("`", "'")

    def _extract_problem_text_fallback(self, image_path: str) -> str:
        if self.paddleocr_engine is not None:
            try:
                result = self._run_paddleocr(image_path)
                self._write_debug_text("vision_problem_text_fallback.txt", result)
                return result
            except Exception as exc:
                self._record_debug_issue("paddleocr_extract", exc)

        prompt = (
            "Read the image carefully and transcribe the full OCR text of the math problem. "
            "You must include all visible text in order: title/number, problem statement, known conditions, "
            "diagram labels that appear in text, and all multiple-choice options if present. "
            "Preserve line breaks and output plain text only. Do not explain anything."
        )
        result = self.analyze_image(image_path, prompt, model_role="ocr")
        self._write_debug_text("vision_problem_text_fallback.txt", result)
        return str(result or "").strip()

    def _run_paddleocr(self, image_path: str) -> str:
        if self.paddleocr_engine is None:
            return ""
        raw_result = self.paddleocr_engine.ocr(image_path, cls=True)
        lines: List[str] = []
        if isinstance(raw_result, list):
            for page in raw_result:
                if not isinstance(page, list):
                    continue
                for item in page:
                    if isinstance(item, (list, tuple)) and len(item) >= 2:
                        text = str(
                            item[1]
                            if len(item) == 2
                            else item[1][0]
                            if isinstance(item[1], (list, tuple))
                            else ""
                        ).strip()
                        if text:
                            lines.append(text)
        return "\n".join(lines)

    def _extract_geometry_facts_fallback(
        self,
        *,
        image_path: str,
        problem_text: str,
    ) -> Dict[str, Any]:
        prompt = f"""
Analyze the plane-geometry image and return JSON only.

Problem text (may be partial OCR):
{problem_text}

Return exactly:
{{
  "confidence": 0.0,
  "ambiguities": [],
  "roles": {{}},
  "points": [],
  "segments": [],
  "polygons": [],
  "circles": [],
  "arcs": [],
  "angles": [],
  "right_angles": [],
  "relations": [],
  "measurements": []
}}

Be conservative. If uncertain, omit instead of guessing.
"""
        result = self.analyze_image(image_path, prompt, model_role="geometry")
        self._write_debug_text("vision_geometry_facts_fallback.txt", result)
        parsed = self._parse_json_like_output(
            result,
            {
                "confidence": 0.0,
                "ambiguities": [],
                "roles": {},
                "points": [],
                "segments": [],
                "polygons": [],
                "circles": [],
                "arcs": [],
                "angles": [],
                "right_angles": [],
                "relations": [],
                "measurements": [],
            },
        )
        return (
            parsed
            if isinstance(parsed, dict)
            else {
                "confidence": 0.0,
                "ambiguities": [],
                "roles": {},
                "points": [],
                "segments": [],
                "polygons": [],
                "circles": [],
                "arcs": [],
                "angles": [],
                "right_angles": [],
                "relations": [],
                "measurements": [],
            }
        )

    def _infer_semantic_signals(
        self,
        *,
        problem_text: str,
        geometry_facts: Dict[str, Any],
        geometry_spec: Dict[str, Any],
    ) -> Dict[str, Any]:
        text = str(problem_text or "")
        lower_text = text.lower()
        templates = {
            str(item).strip().lower()
            for item in (
                geometry_spec.get("templates") or geometry_facts.get("templates") or []
            )
            if str(item).strip()
        }
        relation_types = {
            str(item.get("type", "")).strip().lower()
            for item in (geometry_facts.get("relations") or [])
            if isinstance(item, dict)
        }
        relation_types.update(
            {
                str(item.get("type", "")).strip().lower()
                for item in (geometry_spec.get("constraints") or [])
                if isinstance(item, dict)
            }
        )

        is_fold = bool(
            re.search(r"折叠|翻折|对折|fold|reflect|镜像", text, re.IGNORECASE)
        ) or ("fold" in templates)
        is_circle = bool(
            re.search(r"圆|弧|切线|圆心|circle|tangent|chord", text, re.IGNORECASE)
        ) or any(token in templates for token in {"circle", "arc"})
        is_dynamic = bool(
            re.search(r"动点|轨迹|变化|locus|moving", text, re.IGNORECASE)
        )
        has_similarity = bool(
            re.search(r"相似|全等|similar|congruent", text, re.IGNORECASE)
        )
        has_distance_goal = bool(
            re.search(
                r"距离|distance|最短|shortest|垂线|perpendicular", text, re.IGNORECASE
            )
        )
        has_tangent = bool(re.search(r"切线|tangent", text, re.IGNORECASE))

        inferred_pattern = "static_proof"
        inferred_sub_pattern = "direct_relation_proof"
        confidence = 0.62
        if is_fold:
            inferred_pattern = "fold_transform"
            if has_distance_goal:
                inferred_sub_pattern = "fold_point_to_point_distance"
            elif has_similarity:
                inferred_sub_pattern = "fold_then_similarity"
            else:
                inferred_sub_pattern = "fold_transform_generic"
            confidence = 0.9
        elif is_dynamic:
            inferred_pattern = "dynamic_point"
            inferred_sub_pattern = "locus_tracking"
            confidence = 0.84
        elif is_circle:
            inferred_pattern = "circle_geometry"
            inferred_sub_pattern = "radius_chord_tangent"
            confidence = 0.82
        elif has_similarity:
            inferred_pattern = "similarity_congruence"
            inferred_sub_pattern = "triangle_similarity"
            confidence = 0.8
        elif has_distance_goal:
            inferred_pattern = "metric_computation"
            inferred_sub_pattern = "length_area_computation"
            confidence = 0.74

        action_details: List[Dict[str, Any]] = []

        def push_action(
            action: str, confidence_value: float, evidence: List[str]
        ) -> None:
            token = str(action or "").strip()
            if not token:
                return
            action_details.append(
                {
                    "action": token,
                    "confidence": round(float(confidence_value), 2),
                    "evidence": list(
                        dict.fromkeys(
                            [
                                str(item).strip()
                                for item in evidence
                                if str(item).strip()
                            ]
                        )
                    ),
                }
            )

        if is_fold:
            push_action(
                "highlight_fold_axis",
                0.93,
                ["text: 折叠关键词", "pattern: fold_transform"],
            )
            push_action(
                "animate_fold", 0.92, ["text: 折叠关键词", "pattern: fold_transform"]
            )
            if has_distance_goal or "midpoint" in relation_types:
                push_action(
                    "draw_perpendicular_auxiliary",
                    0.81,
                    ["fold + distance/midpoint", "relation: midpoint/perpendicular"],
                )
        if has_tangent or (is_circle and "perpendicular" in relation_types):
            push_action(
                "connect_center_tangent",
                0.79 if has_tangent else 0.7,
                ["text: tangent/circle", "relation: perpendicular"],
            )
        if has_similarity:
            push_action("draw_connection_auxiliary", 0.77, ["text: 相似/全等"])
        elif "parallel" in relation_types and inferred_pattern in {
            "static_proof",
            "similarity_congruence",
        }:
            push_action("draw_connection_auxiliary", 0.66, ["relation: parallel"])

        best_action_confidence: Dict[str, float] = {}
        best_action_evidence: Dict[str, List[str]] = {}
        for item in action_details:
            action = str(item.get("action", "")).strip()
            confidence_value = float(item.get("confidence", 0.0) or 0.0)
            if (
                action not in best_action_confidence
                or confidence_value > best_action_confidence[action]
            ):
                best_action_confidence[action] = confidence_value
                best_action_evidence[action] = list(item.get("evidence") or [])

        recommended_action_details = [
            {
                "action": action,
                "confidence": round(best_action_confidence[action], 2),
                "evidence": best_action_evidence[action],
            }
            for action in self._normalize_action_hints(
                list(best_action_confidence.keys())
            )
        ]
        recommended_actions = [
            item["action"]
            for item in recommended_action_details
            if float(item.get("confidence", 0.0) or 0.0) >= 0.7
        ]

        return {
            "signal_version": "v1",
            "inferred_problem_pattern": inferred_pattern,
            "inferred_sub_pattern": inferred_sub_pattern,
            "needs_extra_geometry_animation": bool(recommended_actions),
            "recommended_geometry_actions": recommended_actions,
            "recommended_geometry_action_details": recommended_action_details,
            "confidence": round(confidence, 2),
            "evidence": {
                "templates": sorted(templates),
                "relation_types": sorted(item for item in relation_types if item),
                "text_flags": {
                    "is_fold": is_fold,
                    "is_circle": is_circle,
                    "is_dynamic": is_dynamic,
                    "has_similarity": has_similarity,
                    "has_distance_goal": has_distance_goal,
                    "has_tangent": has_tangent,
                },
            },
        }

    def _normalize_action_hints(self, actions: List[str]) -> List[str]:
        normalized: List[str] = []
        seen = set()
        for action in actions:
            token = str(action or "").strip()
            if not token or token in seen:
                continue
            seen.add(token)
            normalized.append(token)
        return normalized

    def _write_debug_text(self, filename: str, content: str) -> None:
        try:
            debug_dir = Path(self.output_dir) / "debug"
            debug_dir.mkdir(parents=True, exist_ok=True)
            (debug_dir / filename).write_text(str(content or ""), encoding="utf-8")
        except Exception as exc:
            self._record_debug_issue("write_debug_text", exc)

    def _record_debug_issue(self, scope: str, exc: Exception) -> None:
        if not self.debug_exceptions:
            return
        try:
            debug_dir = Path(self.output_dir) / "debug"
            debug_dir.mkdir(parents=True, exist_ok=True)
            log_file = debug_dir / "vision_internal_errors.log"
            existing = ""
            if log_file.exists():
                existing = log_file.read_text(encoding="utf-8")
            timestamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
            snippet = f"[{timestamp}] {scope}: {exc.__class__.__name__}: {exc}\n"
            log_file.write_text(existing + snippet, encoding="utf-8")
        except Exception:
            return

    def _build_geometry_graph_payload(
        self, scene_graph_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        try:
            scene = SceneGraph(scene_graph_data)
            geometry_graph = GeometryGraph(scene)
            return geometry_graph.to_payload()
        except Exception:
            return {
                "nodes": [],
                "edges": [],
                "stats": {"node_count": 0, "edge_count": 0},
            }

    def _semantic_graph_has_drawable_geometry(
        self,
        scene_graph_data: Optional[Dict[str, Any]],
    ) -> bool:
        if not isinstance(scene_graph_data, dict):
            return False
        points = scene_graph_data.get("points")
        if isinstance(points, dict):
            has_points = any(
                isinstance(payload, dict)
                and (payload.get("pos") or payload.get("coord"))
                for payload in points.values()
            )
        elif isinstance(points, list):
            has_points = any(
                isinstance(payload, dict)
                and (payload.get("pos") or payload.get("coord"))
                for payload in points
            )
        else:
            has_points = False
        if not has_points:
            return False
        for primitive in scene_graph_data.get("primitives") or []:
            if not isinstance(primitive, dict):
                continue
            primitive_type = str(primitive.get("type", "")).strip().lower()
            refs = [
                item for item in (primitive.get("points") or []) if str(item).strip()
            ]
            if primitive_type == "segment" and len(refs) == 2:
                return True
            if primitive_type == "polygon" and len(refs) >= 3:
                return True
            if (
                primitive_type == "circle"
                and primitive.get("center")
                and primitive.get("radius_point")
            ):
                return True
        return False

    def _build_semantic_graph(
        self, geometry_data: Optional[Dict[str, Any]]
    ) -> Dict[str, Any]:
        geometry_data = geometry_data or {}
        semantic_graph = {
            "points": {},
            "lines": [],
            "objects": [],
            "incidence": [],
            "angles": [],
            "relations": [],
            "primitives": copy.deepcopy(geometry_data.get("primitives", [])),
        }

        for point in geometry_data.get("points", []):
            if isinstance(point, dict):
                point_id = str(point.get("id", "")).strip()
                point_payload = copy.deepcopy(point)
                point_payload.pop("id", None)
            else:
                point_id = str(point).strip()
                point_payload = {}
            if point_id:
                semantic_graph["points"][point_id] = point_payload

        for primitive in geometry_data.get("primitives", []):
            primitive_type = str(primitive.get("type", "")).strip().lower()
            primitive_id = str(primitive.get("id", "")).strip()
            refs = [str(item) for item in (primitive.get("points") or [])]
            if primitive_type == "segment" and len(refs) == 2:
                semantic_graph["lines"].append(
                    {"id": primitive_id, "type": "segment", "points": refs}
                )
            elif primitive_type == "polygon" and len(refs) >= 3:
                semantic_graph["objects"].append(
                    {"id": primitive_id, "type": "polygon", "points": refs}
                )
            elif primitive_type == "circle":
                semantic_graph["objects"].append(
                    {
                        "id": primitive_id,
                        "type": "circle",
                        "center": primitive.get("center"),
                        "radius_point": primitive.get("radius_point"),
                    }
                )
            elif primitive_type == "arc":
                semantic_graph["objects"].append(
                    {
                        "id": primitive_id,
                        "type": "arc",
                        "points": refs,
                        "center": primitive.get("center"),
                    }
                )
            elif primitive_type in {"angle", "right_angle"} and len(refs) == 3:
                semantic_graph["angles"].append(
                    {
                        "id": primitive_id,
                        "points": refs,
                        "value": primitive.get("value"),
                    }
                )

        for constraint in geometry_data.get("constraints", []):
            relation_type = str(constraint.get("type", "")).strip().lower()
            entities = [str(item) for item in (constraint.get("entities") or [])]
            if relation_type == "point_on_segment" and len(entities) == 2:
                semantic_graph["incidence"].append(
                    {"type": "point_on_line", "entities": entities}
                )
            elif relation_type == "point_on_circle" and len(entities) == 2:
                semantic_graph["incidence"].append(
                    {"type": "point_on_object", "entities": entities}
                )
            else:
                semantic_graph["relations"].append(
                    {"type": relation_type, "entities": entities}
                )

        return semantic_graph

    def _build_schematic_drawable_scene(
        self,
        geometry_data: Optional[Dict[str, Any]],
        *,
        allow_solver_fallback: bool = True,
    ) -> Dict[str, Any]:
        if (
            allow_solver_fallback
            and isinstance(geometry_data, dict)
            and geometry_data.get("points")
            and geometry_data.get("primitives")
        ):
            try:
                layout_bundle = self.coordinate_scene_compiler.solve_layout_bundle(
                    geometry_data,
                    drawable_scene_source="schematic_solver_fallback",
                )
                drawable_scene = (
                    layout_bundle.get("drawable_scene")
                    if isinstance(layout_bundle.get("drawable_scene"), dict)
                    else scene_payload_from_layout_ir(
                        layout_bundle.get("layout_ir", {}),
                        "drawable_scene",
                    )
                ) or {}
                drawable_scene["layout_mode"] = "schematic_solver_fallback"
                return drawable_scene
            except Exception:
                pass
        drawable_scene = self._build_semantic_graph(geometry_data)
        drawable_scene["layout_mode"] = "schematic_fallback"
        self._attach_fallback_positions(drawable_scene, geometry_data or {})
        return drawable_scene

    def _build_soft_sketch_drawable_scene(
        self,
        geometry_data: Optional[Dict[str, Any]],
        *,
        geometry_facts: Optional[Dict[str, Any]] = None,
        scene_error: str = "",
        policy: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Build a wireframe scene from visual anchors and unverified soft facts.

        This is deliberately not a coordinate-scene substitute. It preserves the
        model/detector primitives as a teachable sketch, while reporting that the
        mathematical coordinate solver failed.
        """

        geometry_data = geometry_data or {}
        drawable_scene = self._build_semantic_graph(geometry_data)
        drawable_scene["layout_mode"] = "soft_sketch_reconstruction"
        drawable_scene["reconstruction_mode"] = "soft_constraints"
        drawable_scene["coordinate_status"] = "unverified_soft_sketch"
        drawable_scene["primitives"] = copy.deepcopy(
            geometry_data.get("primitives", [])
        )

        anchor_report = self._attach_pixel_anchor_positions(
            drawable_scene,
            geometry_data,
        )
        self._attach_fallback_positions(drawable_scene, geometry_data)

        soft_constraints, hard_constraints = self._split_soft_sketch_constraints(
            geometry_data=geometry_data,
            geometry_facts=geometry_facts or {},
        )
        refinement_report = self._refine_soft_sketch_with_hard_constraints(
            drawable_scene,
            geometry_data=geometry_data,
        )
        self._apply_wireframe_display(drawable_scene)

        drawable_scene["soft_constraints"] = soft_constraints
        drawable_scene["hard_constraints"] = hard_constraints
        drawable_scene["soft_refinement_report"] = refinement_report
        drawable_scene["soft_sketch_report"] = {
            "mode": "soft_sketch_reconstruction",
            "reason": scene_error,
            "policy": copy.deepcopy(policy or {}),
            "anchor_count": int(anchor_report.get("anchor_count", 0)),
            "point_count": int(anchor_report.get("point_count", 0)),
            "anchored_points": list(anchor_report.get("anchored_points", [])),
            "missing_points": list(anchor_report.get("missing_points", [])),
            "soft_constraint_count": len(soft_constraints),
            "hard_constraint_count": len(hard_constraints),
            "refinement": refinement_report,
            "notes": [
                "Pixel anchors initialize sketch layout and remain soft anchors during refinement.",
                "Hard math facts refine the sketch when they can be applied without a full coordinate solve.",
                "Unverified visual relations are retained as soft constraints instead of pruning the diagram.",
            ],
        }
        return drawable_scene

    def _attach_pixel_anchor_positions(
        self,
        scene_graph: Dict[str, Any],
        geometry_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        points = scene_graph.get("points") or {}
        if not isinstance(points, dict) or not points:
            return {
                "anchor_count": 0,
                "point_count": 0,
                "anchored_points": [],
                "missing_points": [],
            }

        anchor_payloads = self._point_payloads_by_id(geometry_data)
        anchors: Dict[str, Tuple[float, float]] = {}
        for point_id, payload in points.items():
            merged_payload: Dict[str, Any] = {}
            if isinstance(anchor_payloads.get(point_id), dict):
                merged_payload.update(copy.deepcopy(anchor_payloads[point_id]))
            if isinstance(payload, dict):
                merged_payload.update(copy.deepcopy(payload))
            if not merged_payload:
                continue
            normalize_point_pixel_anchor(merged_payload)
            coord = merged_payload.get("pixel_coord")
            if not isinstance(coord, dict):
                continue
            try:
                x = float(coord.get("x"))
                y = float(coord.get("y"))
            except (TypeError, ValueError):
                continue
            if math.isfinite(x) and math.isfinite(y):
                anchors[str(point_id)] = (x, y)
                if isinstance(payload, dict):
                    payload.setdefault("pixel_coord", copy.deepcopy(coord))
                    if merged_payload.get("pixel_coord_space"):
                        payload.setdefault(
                            "pixel_coord_space",
                            merged_payload.get("pixel_coord_space"),
                        )
                    if merged_payload.get("label_bbox"):
                        payload.setdefault(
                            "label_bbox", copy.deepcopy(merged_payload["label_bbox"])
                        )

        if anchors:
            xs = [coord[0] for coord in anchors.values()]
            ys = [coord[1] for coord in anchors.values()]
            min_x, max_x = min(xs), max(xs)
            min_y, max_y = min(ys), max(ys)
            width = max(max_x - min_x, 1.0)
            height = max(max_y - min_y, 1.0)
            scale = 6.8 / max(width, height)
            cx = (min_x + max_x) / 2.0
            cy = (min_y + max_y) / 2.0
            if len(anchors) == 1:
                scale = 1.0
            for point_id, (x, y) in anchors.items():
                payload = points.get(point_id)
                if not isinstance(payload, dict):
                    payload = {}
                    points[point_id] = payload
                payload["pos"] = [
                    round((x - cx) * scale, 6),
                    round((cy - y) * scale, 6),
                ]
                payload["position_source"] = "pixel_anchor_soft_sketch"

        anchored_points = sorted(anchors.keys())
        missing_points = sorted(
            str(point_id) for point_id in points.keys() if str(point_id) not in anchors
        )
        report = {
            "anchor_count": len(anchored_points),
            "point_count": len(points),
            "anchored_points": anchored_points,
            "missing_points": missing_points,
        }
        scene_graph["pixel_anchor_coverage"] = report
        return report

    def _point_payloads_by_id(
        self,
        geometry_data: Optional[Dict[str, Any]],
    ) -> Dict[str, Dict[str, Any]]:
        result: Dict[str, Dict[str, Any]] = {}
        if not isinstance(geometry_data, dict):
            return result
        for point in geometry_data.get("points") or []:
            if not isinstance(point, dict):
                continue
            point_id = str(point.get("id", "")).strip()
            if point_id:
                result[point_id] = copy.deepcopy(point)
        return result

    def _apply_wireframe_display(self, scene_graph: Dict[str, Any]) -> None:
        display = scene_graph.setdefault("display", {})
        if not isinstance(display, dict):
            display = {}
            scene_graph["display"] = display
        primitive_display = display.setdefault("primitives", {})
        if not isinstance(primitive_display, dict):
            primitive_display = {}
            display["primitives"] = primitive_display

        for primitive in scene_graph.get("primitives") or []:
            if not isinstance(primitive, dict):
                continue
            primitive_id = str(primitive.get("id", "")).strip()
            primitive_type = str(primitive.get("type", "")).strip().lower()
            if not primitive_id:
                continue
            item_display = primitive_display.setdefault(primitive_id, {})
            if not isinstance(item_display, dict):
                item_display = {}
                primitive_display[primitive_id] = item_display
            if primitive_type in {"polygon", "circle"}:
                item_display["fill_opacity"] = 0.0
            if primitive_type == "segment":
                item_display.setdefault("stroke_width", 3)

    def _split_soft_sketch_constraints(
        self,
        *,
        geometry_data: Dict[str, Any],
        geometry_facts: Dict[str, Any],
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        hard_constraints: List[Dict[str, Any]] = []
        soft_constraints: List[Dict[str, Any]] = []

        def append_items(
            target: List[Dict[str, Any]],
            source: Any,
            *,
            layer: str,
        ) -> None:
            if not isinstance(source, list):
                return
            for item in source:
                if not isinstance(item, dict):
                    continue
                payload = copy.deepcopy(item)
                payload.setdefault("layer", layer)
                target.append(payload)

        append_items(
            hard_constraints,
            geometry_facts.get("text_explicit_relations"),
            layer="text_explicit_relation",
        )
        append_items(
            hard_constraints,
            geometry_facts.get("text_explicit_measurements"),
            layer="text_explicit_measurement",
        )
        append_items(
            hard_constraints,
            geometry_data.get("measurements"),
            layer="compiled_measurement",
        )

        append_items(
            soft_constraints,
            geometry_facts.get("observed_relations") or geometry_facts.get("relations"),
            layer="observed_relation",
        )
        append_items(
            soft_constraints,
            geometry_facts.get("unverified_observed_relations"),
            layer="unverified_observed_relation",
        )
        append_items(
            soft_constraints,
            geometry_facts.get("derived_relations")
            or geometry_facts.get("inferred_relations"),
            layer="derived_relation",
        )
        append_items(
            soft_constraints,
            geometry_facts.get("observed_measurements"),
            layer="observed_measurement",
        )
        append_items(
            soft_constraints,
            geometry_data.get("constraints"),
            layer="compiled_constraint_unverified",
        )
        return soft_constraints, hard_constraints

    def _refine_soft_sketch_with_hard_constraints(
        self,
        scene_graph: Dict[str, Any],
        *,
        geometry_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        points = scene_graph.get("points") or {}
        if not isinstance(points, dict) or len(points) < 2:
            return {
                "applied": False,
                "reason": "insufficient_points",
                "iterations": 0,
                "constraint_counts": {},
            }

        positions = self._scene_positions(points)
        if len(positions) < 2:
            return {
                "applied": False,
                "reason": "missing_positions",
                "iterations": 0,
                "constraint_counts": {},
            }

        initial_positions = copy.deepcopy(positions)
        anchor_positions = {
            point_id: coord
            for point_id, coord in initial_positions.items()
            if isinstance(points.get(point_id), dict)
            and str(points[point_id].get("position_source", "")).strip()
            == "pixel_anchor_soft_sketch"
        }
        refinement_policy = self._soft_sketch_refinement_policy(
            scene_graph,
            geometry_data=geometry_data,
            anchor_positions=anchor_positions,
        )
        segment_map = self._soft_sketch_segment_map(geometry_data, scene_graph)
        length_targets, length_unit_scale = self._soft_sketch_length_targets(
            geometry_data,
            positions=positions,
            segment_map=segment_map,
        )
        angle_targets = self._soft_sketch_angle_targets(geometry_data)
        relation_targets = [
            item
            for item in (geometry_data.get("constraints") or [])
            if isinstance(item, dict)
        ]
        counts = {
            "length": len(length_targets),
            "angle": len(angle_targets),
            "relation": len(relation_targets),
        }
        if not any(counts.values()):
            self._write_scene_positions(points, positions)
            return {
                "applied": False,
                "reason": "no_supported_hard_constraints",
                "iterations": 0,
                "constraint_counts": counts,
                "length_unit_scale": length_unit_scale,
                "profile": refinement_policy["profile"],
            }

        before = self._soft_sketch_refinement_residuals(
            positions,
            segment_map=segment_map,
            length_targets=length_targets,
            angle_targets=angle_targets,
            relation_targets=relation_targets,
        )
        for _iteration in range(int(refinement_policy["iterations"])):
            for point_id, segment_id in self._relation_entities(
                relation_targets,
                "point_on_segment",
                expected_len=2,
            ):
                self._project_point_to_segment(
                    positions,
                    point_id=point_id,
                    segment_id=segment_id,
                    segment_map=segment_map,
                    ratio=None,
                    strength=float(refinement_policy["point_on_segment_strength"]),
                )
            for point_id, segment_id in self._relation_entities(
                relation_targets,
                "midpoint",
                expected_len=2,
            ):
                self._project_point_to_segment(
                    positions,
                    point_id=point_id,
                    segment_id=segment_id,
                    segment_map=segment_map,
                    ratio=0.5,
                    strength=float(refinement_policy["midpoint_strength"]),
                )
            for first, second in self._relation_entities(
                relation_targets,
                "equal_length",
                expected_len=2,
            ):
                seg_a = self._resolve_segment_ref(first, segment_map, positions)
                seg_b = self._resolve_segment_ref(second, segment_map, positions)
                if seg_a and seg_b:
                    self._project_equal_length(
                        positions,
                        seg_a=seg_a,
                        seg_b=seg_b,
                        strength=float(refinement_policy["equal_length_strength"]),
                    )
            for first, second in self._relation_entities(
                relation_targets,
                "perpendicular",
                expected_len=2,
            ):
                seg_a = self._resolve_segment_ref(first, segment_map, positions)
                seg_b = self._resolve_segment_ref(second, segment_map, positions)
                if seg_a and seg_b:
                    self._project_perpendicular(
                        positions,
                        seg_a=seg_a,
                        seg_b=seg_b,
                        strength=float(refinement_policy["perpendicular_strength"]),
                    )
            for point_a, point_b, target_length in length_targets:
                self._project_pair_distance(
                    positions,
                    point_a=point_a,
                    point_b=point_b,
                    target=target_length,
                    strength=float(refinement_policy["length_strength"]),
                )
            for point_a, vertex, point_c, target_degrees in angle_targets:
                self._project_angle(
                    positions,
                    point_a=point_a,
                    vertex=vertex,
                    point_c=point_c,
                    target_degrees=target_degrees,
                    strength=float(refinement_policy["angle_strength"]),
                )
            self._pull_soft_sketch_anchors(
                positions,
                anchor_positions=anchor_positions,
                strength=float(refinement_policy["anchor_pull_strength"]),
            )
            self._clamp_soft_sketch_anchor_drift(
                positions,
                anchor_positions=anchor_positions,
                max_drift=refinement_policy.get("max_anchor_drift"),
            )

        after = self._soft_sketch_refinement_residuals(
            positions,
            segment_map=segment_map,
            length_targets=length_targets,
            angle_targets=angle_targets,
            relation_targets=relation_targets,
        )
        self._write_scene_positions(points, positions)
        adjusted_points = sorted(
            point_id
            for point_id, coord in positions.items()
            if point_id in initial_positions
            and (
                abs(coord[0] - initial_positions[point_id][0]) > 1e-4
                or abs(coord[1] - initial_positions[point_id][1]) > 1e-4
            )
        )
        return {
            "applied": True,
            "iterations": int(refinement_policy["iterations"]),
            "constraint_counts": counts,
            "length_unit_scale": length_unit_scale,
            "anchored_points": sorted(anchor_positions.keys()),
            "adjusted_points": adjusted_points,
            "residual_before": before,
            "residual_after": after,
            "profile": refinement_policy["profile"],
            "max_anchor_drift": refinement_policy.get("max_anchor_drift"),
        }

    def _soft_sketch_refinement_policy(
        self,
        scene_graph: Dict[str, Any],
        *,
        geometry_data: Dict[str, Any],
        anchor_positions: Dict[str, List[float]],
    ) -> Dict[str, Any]:
        policy = {
            "profile": "default_soft_projection",
            "iterations": 24,
            "point_on_segment_strength": 0.72,
            "midpoint_strength": 0.78,
            "equal_length_strength": 0.24,
            "perpendicular_strength": 0.20,
            "length_strength": 0.26,
            "angle_strength": 0.18,
            "anchor_pull_strength": 0.055,
            "max_anchor_drift": None,
        }
        point_count = len(self._scene_positions(scene_graph.get("points") or {}))
        anchor_count = len(anchor_positions)
        anchor_coverage = (anchor_count / point_count) if point_count else 0.0
        if (
            self._soft_sketch_has_fold_semantics(scene_graph, geometry_data)
            and anchor_count >= 4
            and anchor_coverage >= 0.8
        ):
            span = self._soft_sketch_anchor_span(anchor_positions)
            policy.update(
                {
                    "profile": "fold_anchor_preserving",
                    "iterations": 8,
                    "point_on_segment_strength": 0.18,
                    "midpoint_strength": 0.20,
                    "equal_length_strength": 0.08,
                    "perpendicular_strength": 0.08,
                    "length_strength": 0.10,
                    "angle_strength": 0.08,
                    "anchor_pull_strength": 0.22,
                    "max_anchor_drift": round(max(0.18, span * 0.05), 6),
                }
            )
        return policy

    def _soft_sketch_has_fold_semantics(
        self,
        scene_graph: Dict[str, Any],
        geometry_data: Dict[str, Any],
    ) -> bool:
        if scene_graph.get("fold_correspondences") or geometry_data.get(
            "fold_correspondences"
        ):
            return True
        for point in geometry_data.get("points") or []:
            if not isinstance(point, dict):
                continue
            derived = point.get("derived")
            if not isinstance(derived, dict):
                continue
            if str(derived.get("type", "")).strip().lower() == "reflect_point":
                return True
        return False

    def _soft_sketch_anchor_span(
        self,
        anchor_positions: Dict[str, List[float]],
    ) -> float:
        if not anchor_positions:
            return 1.0
        xs = [float(coord[0]) for coord in anchor_positions.values()]
        ys = [float(coord[1]) for coord in anchor_positions.values()]
        return max(max(xs) - min(xs), max(ys) - min(ys), 1.0)

    def _clamp_soft_sketch_anchor_drift(
        self,
        positions: Dict[str, List[float]],
        *,
        anchor_positions: Dict[str, List[float]],
        max_drift: Optional[float],
    ) -> None:
        if max_drift is None or max_drift <= 0:
            return
        for point_id, anchor in anchor_positions.items():
            current = positions.get(point_id)
            if current is None:
                continue
            dx = float(current[0]) - float(anchor[0])
            dy = float(current[1]) - float(anchor[1])
            distance = math.hypot(dx, dy)
            if distance <= max_drift or distance <= 1e-9:
                continue
            scale = float(max_drift) / distance
            positions[point_id] = [
                float(anchor[0]) + dx * scale,
                float(anchor[1]) + dy * scale,
            ]

    def _scene_positions(
        self,
        points: Dict[str, Any],
    ) -> Dict[str, List[float]]:
        positions: Dict[str, List[float]] = {}
        for point_id, payload in points.items():
            if not isinstance(payload, dict):
                continue
            coord = payload.get("pos") or payload.get("coord")
            if not isinstance(coord, (list, tuple)) or len(coord) < 2:
                continue
            try:
                x = float(coord[0])
                y = float(coord[1])
            except (TypeError, ValueError):
                continue
            if math.isfinite(x) and math.isfinite(y):
                positions[str(point_id)] = [x, y]
        return positions

    def _write_scene_positions(
        self,
        points: Dict[str, Any],
        positions: Dict[str, List[float]],
    ) -> None:
        for point_id, coord in positions.items():
            payload = points.get(point_id)
            if not isinstance(payload, dict):
                payload = {}
                points[point_id] = payload
            payload["pos"] = [round(float(coord[0]), 6), round(float(coord[1]), 6)]
            if payload.get("position_source") == "pixel_anchor_soft_sketch":
                payload["position_refined_by"] = "hard_constraints_soft_projection"

    def _soft_sketch_segment_map(
        self,
        geometry_data: Dict[str, Any],
        scene_graph: Dict[str, Any],
    ) -> Dict[str, Tuple[str, str]]:
        segment_map: Dict[str, Tuple[str, str]] = {}
        for primitive in [
            *(geometry_data.get("primitives") or []),
            *(scene_graph.get("primitives") or []),
            *(scene_graph.get("lines") or []),
        ]:
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
            segment_id = str(primitive.get("id", "")).strip()
            for candidate in [
                segment_id,
                f"seg_{refs[0]}{refs[1]}",
                f"seg_{refs[1]}{refs[0]}",
                f"line_{refs[0]}{refs[1]}",
                f"line_{refs[1]}{refs[0]}",
                f"{refs[0]}{refs[1]}",
                f"{refs[1]}{refs[0]}",
            ]:
                if candidate:
                    segment_map.setdefault(candidate, (refs[0], refs[1]))
        return segment_map

    def _soft_sketch_length_targets(
        self,
        geometry_data: Dict[str, Any],
        *,
        positions: Dict[str, List[float]],
        segment_map: Dict[str, Tuple[str, str]],
    ) -> Tuple[List[Tuple[str, str, float]], Optional[float]]:
        raw_targets: List[Tuple[str, str, float]] = []
        ratios: List[float] = []
        for measurement in geometry_data.get("measurements") or []:
            if not isinstance(measurement, dict):
                continue
            if str(measurement.get("type", "")).strip().lower() != "length":
                continue
            value = self._coerce_float(measurement.get("value"), default=0.0)
            if value <= 1e-9:
                continue
            endpoints = self._measurement_length_endpoints(
                measurement,
                segment_map=segment_map,
                positions=positions,
            )
            if not endpoints:
                continue
            first, second = endpoints
            raw_targets.append((first, second, value))
            current = self._distance_2d(positions.get(first), positions.get(second))
            if current and current > 1e-9:
                ratios.append(current / value)
        if not raw_targets:
            return [], None
        if ratios:
            ratios = sorted(ratios)
            unit_scale = ratios[len(ratios) // 2]
        else:
            unit_scale = 1.0
        return [
            (first, second, value * unit_scale) for first, second, value in raw_targets
        ], round(float(unit_scale), 6)

    def _measurement_length_endpoints(
        self,
        measurement: Dict[str, Any],
        *,
        segment_map: Dict[str, Tuple[str, str]],
        positions: Dict[str, List[float]],
    ) -> Optional[Tuple[str, str]]:
        entities = [
            str(item).strip()
            for item in (measurement.get("entities") or [])
            if str(item).strip()
        ]
        if len(entities) == 2 and all(entity in positions for entity in entities):
            return entities[0], entities[1]
        if len(entities) == 1:
            resolved = self._resolve_segment_ref(entities[0], segment_map, positions)
            if resolved:
                return resolved
        raw_segment = measurement.get("segment") or measurement.get("line")
        if raw_segment:
            resolved = self._resolve_segment_ref(raw_segment, segment_map, positions)
            if resolved:
                return resolved
        return None

    def _soft_sketch_angle_targets(
        self,
        geometry_data: Dict[str, Any],
    ) -> List[Tuple[str, str, str, float]]:
        targets: List[Tuple[str, str, str, float]] = []
        for primitive in geometry_data.get("primitives") or []:
            if not isinstance(primitive, dict):
                continue
            primitive_type = str(primitive.get("type", "")).strip().lower()
            refs = [
                str(item).strip()
                for item in (primitive.get("points") or [])
                if str(item).strip()
            ]
            if len(refs) != 3:
                continue
            if primitive_type == "right_angle":
                targets.append((refs[0], refs[1], refs[2], 90.0))
        for measurement in geometry_data.get("measurements") or []:
            if not isinstance(measurement, dict):
                continue
            if str(measurement.get("type", "")).strip().lower() != "angle":
                continue
            refs = [
                str(item).strip()
                for item in (measurement.get("entities") or [])
                if str(item).strip()
            ]
            if len(refs) != 3:
                continue
            value = self._coerce_float(measurement.get("value"), default=0.0)
            if value > 0:
                targets.append((refs[0], refs[1], refs[2], value))
        return list(dict.fromkeys(targets))

    def _relation_entities(
        self,
        relations: List[Dict[str, Any]],
        relation_type: str,
        *,
        expected_len: int,
    ) -> List[List[str]]:
        result: List[List[str]] = []
        for relation in relations:
            if not isinstance(relation, dict):
                continue
            if str(relation.get("type", "")).strip().lower() != relation_type:
                continue
            entities = [
                str(item).strip()
                for item in (relation.get("entities") or [])
                if str(item).strip()
            ]
            if len(entities) == expected_len:
                result.append(entities)
        return result

    def _resolve_segment_ref(
        self,
        ref: Any,
        segment_map: Dict[str, Tuple[str, str]],
        positions: Dict[str, List[float]],
    ) -> Optional[Tuple[str, str]]:
        token = str(ref).strip()
        if not token:
            return None
        if token in segment_map:
            return segment_map[token]
        normalized = token.replace("seg_", "").replace("line_", "")
        normalized = re.sub(r"[^A-Za-z0-9_′']", "", normalized)
        point_ids = list(positions.keys())
        for first in point_ids:
            for second in point_ids:
                if first == second:
                    continue
                if normalized in {
                    f"{first}{second}",
                    f"{second}{first}",
                    f"{first}_{second}",
                    f"{second}_{first}",
                }:
                    return first, second
        return None

    def _project_point_to_segment(
        self,
        positions: Dict[str, List[float]],
        *,
        point_id: str,
        segment_id: str,
        segment_map: Dict[str, Tuple[str, str]],
        ratio: Optional[float],
        strength: float,
    ) -> None:
        endpoints = self._resolve_segment_ref(segment_id, segment_map, positions)
        if not endpoints or point_id not in positions:
            return
        start, end = endpoints
        if start not in positions or end not in positions:
            return
        ax, ay = positions[start]
        bx, by = positions[end]
        px, py = positions[point_id]
        vx, vy = bx - ax, by - ay
        denom = vx * vx + vy * vy
        if denom <= 1e-9:
            return
        if ratio is None:
            t = ((px - ax) * vx + (py - ay) * vy) / denom
            t = max(0.0, min(1.0, t))
        else:
            t = max(0.0, min(1.0, ratio))
        target = [ax + vx * t, ay + vy * t]
        self._move_point_toward(positions, point_id, target, strength)

    def _project_pair_distance(
        self,
        positions: Dict[str, List[float]],
        *,
        point_a: str,
        point_b: str,
        target: float,
        strength: float,
    ) -> None:
        if point_a not in positions or point_b not in positions or target <= 0:
            return
        ax, ay = positions[point_a]
        bx, by = positions[point_b]
        dx, dy = bx - ax, by - ay
        dist = math.hypot(dx, dy)
        if dist <= 1e-9:
            return
        delta = (dist - target) * strength * 0.5
        ux, uy = dx / dist, dy / dist
        positions[point_a] = [ax + ux * delta, ay + uy * delta]
        positions[point_b] = [bx - ux * delta, by - uy * delta]

    def _project_equal_length(
        self,
        positions: Dict[str, List[float]],
        *,
        seg_a: Tuple[str, str],
        seg_b: Tuple[str, str],
        strength: float,
    ) -> None:
        len_a = self._distance_2d(positions.get(seg_a[0]), positions.get(seg_a[1]))
        len_b = self._distance_2d(positions.get(seg_b[0]), positions.get(seg_b[1]))
        if not len_a or not len_b:
            return
        target = (len_a + len_b) / 2.0
        self._project_pair_distance(
            positions,
            point_a=seg_a[0],
            point_b=seg_a[1],
            target=target,
            strength=strength,
        )
        self._project_pair_distance(
            positions,
            point_a=seg_b[0],
            point_b=seg_b[1],
            target=target,
            strength=strength,
        )

    def _project_perpendicular(
        self,
        positions: Dict[str, List[float]],
        *,
        seg_a: Tuple[str, str],
        seg_b: Tuple[str, str],
        strength: float,
    ) -> None:
        if not all(point in positions for point in [*seg_a, *seg_b]):
            return
        ax, ay = positions[seg_a[0]]
        bx, by = positions[seg_a[1]]
        vx, vy = bx - ax, by - ay
        norm = math.hypot(vx, vy)
        if norm <= 1e-9:
            return
        ux, uy = -vy / norm, vx / norm
        c, d = seg_b
        cx, cy = positions[c]
        dx, dy = positions[d]
        mid = [(cx + dx) / 2.0, (cy + dy) / 2.0]
        half_len = max(math.hypot(dx - cx, dy - cy) / 2.0, 0.25)
        target_c = [mid[0] - ux * half_len, mid[1] - uy * half_len]
        target_d = [mid[0] + ux * half_len, mid[1] + uy * half_len]
        self._move_point_toward(positions, c, target_c, strength)
        self._move_point_toward(positions, d, target_d, strength)

    def _project_angle(
        self,
        positions: Dict[str, List[float]],
        *,
        point_a: str,
        vertex: str,
        point_c: str,
        target_degrees: float,
        strength: float,
    ) -> None:
        if (
            point_a not in positions
            or vertex not in positions
            or point_c not in positions
        ):
            return
        if abs(target_degrees - 90.0) > 1e-3:
            return
        vx = positions[point_a][0] - positions[vertex][0]
        vy = positions[point_a][1] - positions[vertex][1]
        norm = math.hypot(vx, vy)
        current_len = self._distance_2d(positions.get(vertex), positions.get(point_c))
        if norm <= 1e-9 or not current_len:
            return
        dirs = [(-vy / norm, vx / norm), (vy / norm, -vx / norm)]
        candidates = [
            [
                positions[vertex][0] + direction[0] * current_len,
                positions[vertex][1] + direction[1] * current_len,
            ]
            for direction in dirs
        ]
        current = positions[point_c]
        target = min(
            candidates,
            key=lambda item: (item[0] - current[0]) ** 2 + (item[1] - current[1]) ** 2,
        )
        self._move_point_toward(positions, point_c, target, strength)

    def _pull_soft_sketch_anchors(
        self,
        positions: Dict[str, List[float]],
        *,
        anchor_positions: Dict[str, List[float]],
        strength: float,
    ) -> None:
        for point_id, target in anchor_positions.items():
            self._move_point_toward(positions, point_id, target, strength)

    def _move_point_toward(
        self,
        positions: Dict[str, List[float]],
        point_id: str,
        target: List[float],
        strength: float,
    ) -> None:
        if point_id not in positions:
            return
        x, y = positions[point_id]
        positions[point_id] = [
            x + (float(target[0]) - x) * strength,
            y + (float(target[1]) - y) * strength,
        ]

    def _soft_sketch_refinement_residuals(
        self,
        positions: Dict[str, List[float]],
        *,
        segment_map: Dict[str, Tuple[str, str]],
        length_targets: List[Tuple[str, str, float]],
        angle_targets: List[Tuple[str, str, str, float]],
        relation_targets: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        residuals: List[float] = []
        for point_a, point_b, target in length_targets:
            current = self._distance_2d(positions.get(point_a), positions.get(point_b))
            if current is not None and target > 0:
                residuals.append(abs(current - target) / max(target, 1e-9))
        for point_a, vertex, point_c, target in angle_targets:
            current = self._angle_degrees_2d(
                positions.get(point_a),
                positions.get(vertex),
                positions.get(point_c),
            )
            if current is not None and target > 0:
                residuals.append(abs(current - target) / max(target, 1.0))
        for point_id, segment_id in self._relation_entities(
            relation_targets, "point_on_segment", expected_len=2
        ):
            residual = self._point_segment_normalized_distance(
                positions,
                point_id=point_id,
                segment_id=segment_id,
                segment_map=segment_map,
            )
            if residual is not None:
                residuals.append(residual)
        for first, second in self._relation_entities(
            relation_targets, "equal_length", expected_len=2
        ):
            seg_a = self._resolve_segment_ref(first, segment_map, positions)
            seg_b = self._resolve_segment_ref(second, segment_map, positions)
            if seg_a and seg_b:
                len_a = self._distance_2d(
                    positions.get(seg_a[0]), positions.get(seg_a[1])
                )
                len_b = self._distance_2d(
                    positions.get(seg_b[0]), positions.get(seg_b[1])
                )
                if len_a and len_b:
                    residuals.append(
                        abs(len_a - len_b) / max((len_a + len_b) / 2.0, 1e-9)
                    )
        for first, second in self._relation_entities(
            relation_targets, "perpendicular", expected_len=2
        ):
            seg_a = self._resolve_segment_ref(first, segment_map, positions)
            seg_b = self._resolve_segment_ref(second, segment_map, positions)
            if seg_a and seg_b:
                residual = self._perpendicular_residual(positions, seg_a, seg_b)
                if residual is not None:
                    residuals.append(residual)
        if not residuals:
            return {"count": 0, "mean": 0.0, "max": 0.0}
        return {
            "count": len(residuals),
            "mean": round(sum(residuals) / len(residuals), 6),
            "max": round(max(residuals), 6),
        }

    def _distance_2d(
        self,
        first: Optional[List[float]],
        second: Optional[List[float]],
    ) -> Optional[float]:
        if first is None or second is None:
            return None
        return math.hypot(
            float(second[0]) - float(first[0]), float(second[1]) - float(first[1])
        )

    def _angle_degrees_2d(
        self,
        point_a: Optional[List[float]],
        vertex: Optional[List[float]],
        point_c: Optional[List[float]],
    ) -> Optional[float]:
        if point_a is None or vertex is None or point_c is None:
            return None
        ax, ay = (
            float(point_a[0]) - float(vertex[0]),
            float(point_a[1]) - float(vertex[1]),
        )
        cx, cy = (
            float(point_c[0]) - float(vertex[0]),
            float(point_c[1]) - float(vertex[1]),
        )
        denom = math.hypot(ax, ay) * math.hypot(cx, cy)
        if denom <= 1e-9:
            return None
        cos_value = max(-1.0, min(1.0, (ax * cx + ay * cy) / denom))
        return math.degrees(math.acos(cos_value))

    def _point_segment_normalized_distance(
        self,
        positions: Dict[str, List[float]],
        *,
        point_id: str,
        segment_id: str,
        segment_map: Dict[str, Tuple[str, str]],
    ) -> Optional[float]:
        endpoints = self._resolve_segment_ref(segment_id, segment_map, positions)
        if not endpoints or point_id not in positions:
            return None
        start, end = endpoints
        if start not in positions or end not in positions:
            return None
        ax, ay = positions[start]
        bx, by = positions[end]
        px, py = positions[point_id]
        vx, vy = bx - ax, by - ay
        denom = vx * vx + vy * vy
        if denom <= 1e-9:
            return None
        t = max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / denom))
        closest = [ax + vx * t, ay + vy * t]
        dist = math.hypot(px - closest[0], py - closest[1])
        return dist / max(math.sqrt(denom), 1e-9)

    def _perpendicular_residual(
        self,
        positions: Dict[str, List[float]],
        seg_a: Tuple[str, str],
        seg_b: Tuple[str, str],
    ) -> Optional[float]:
        if not all(point in positions for point in [*seg_a, *seg_b]):
            return None
        ax, ay = positions[seg_a[0]]
        bx, by = positions[seg_a[1]]
        cx, cy = positions[seg_b[0]]
        dx, dy = positions[seg_b[1]]
        v1 = [bx - ax, by - ay]
        v2 = [dx - cx, dy - cy]
        denom = math.hypot(v1[0], v1[1]) * math.hypot(v2[0], v2[1])
        if denom <= 1e-9:
            return None
        return abs((v1[0] * v2[0] + v1[1] * v2[1]) / denom)

    def _compile_geometry_spec(
        self,
        geometry_facts: Optional[Dict[str, Any]],
        *,
        problem_text: str,
    ) -> Dict[str, Any]:
        compiled, _ = self._compile_geometry_spec_with_diagnostics(
            geometry_facts,
            problem_text=problem_text,
        )
        return compiled

    def _attach_fallback_positions(
        self,
        scene_graph: Dict[str, Any],
        geometry_data: Dict[str, Any],
    ) -> None:
        points = scene_graph.get("points") or {}
        if not isinstance(points, dict) or not points:
            return

        positions: Dict[str, List[float]] = {}
        lines = scene_graph.get("lines") or []
        objects = scene_graph.get("objects") or []
        constraints = geometry_data.get("constraints") or []
        measurements = geometry_data.get("measurements") or []
        segment_map: Dict[str, Tuple[str, str]] = {}

        for point_id, payload in points.items():
            if not isinstance(payload, dict):
                continue
            coord = payload.get("pos") or payload.get("coord")
            if not isinstance(coord, (list, tuple)) or len(coord) < 2:
                continue
            try:
                x = float(coord[0])
                y = float(coord[1])
            except (TypeError, ValueError):
                continue
            if math.isfinite(x) and math.isfinite(y):
                positions[str(point_id)] = [x, y]

        for line in lines:
            if not isinstance(line, dict):
                continue
            line_id = str(line.get("id", "")).strip()
            refs = [
                str(item).strip()
                for item in (line.get("points") or [])
                if str(item).strip()
            ]
            if line_id and len(refs) == 2:
                segment_map[line_id] = (refs[0], refs[1])

        if not positions:
            self._apply_circle_parallel_extension_layout(
                positions=positions,
                objects=objects,
                constraints=constraints,
                measurements=measurements,
                segment_map=segment_map,
            )

        for obj in objects:
            if not isinstance(obj, dict):
                continue
            obj_type = str(obj.get("type", "")).strip().lower()
            refs = [
                str(item).strip()
                for item in (obj.get("points") or [])
                if str(item).strip()
            ]
            if obj_type in {"polygon", "triangle"} and len(refs) >= 3:
                radius = 3.2
                for index, point_id in enumerate(refs):
                    angle = (math.pi / 2) - (2 * math.pi * index / len(refs))
                    positions.setdefault(
                        point_id,
                        [
                            round(radius * math.cos(angle), 6),
                            round(radius * math.sin(angle), 6),
                        ],
                    )
                break

        for obj in objects:
            if not isinstance(obj, dict):
                continue
            if str(obj.get("type", "")).strip().lower() != "circle":
                continue
            center = str(obj.get("center", "")).strip()
            if center:
                positions.setdefault(center, [0.0, 0.0])

        for obj in objects:
            if not isinstance(obj, dict):
                continue
            if str(obj.get("type", "")).strip().lower() != "circle":
                continue
            circle_id = str(obj.get("id", "")).strip()
            center = str(obj.get("center", "")).strip()
            radius_point = str(obj.get("radius_point", "")).strip()
            members: List[str] = []
            if radius_point:
                members.append(radius_point)
            for constraint in constraints:
                if str(constraint.get("type", "")).strip().lower() != "point_on_circle":
                    continue
                entities = [
                    str(item).strip() for item in (constraint.get("entities") or [])
                ]
                if len(entities) == 2 and entities[1] == circle_id and entities[0]:
                    members.append(entities[0])
            members = list(dict.fromkeys(members))
            if not center or center not in positions or not members:
                continue
            cx, cy = positions[center]
            radius = 3.0
            for index, point_id in enumerate(members):
                angle = (5 * math.pi / 6) - (2 * math.pi * index / max(len(members), 3))
                positions.setdefault(
                    point_id,
                    [
                        round(cx + radius * math.cos(angle), 6),
                        round(cy + radius * math.sin(angle), 6),
                    ],
                )

        for start, end in segment_map.values():
            if start in positions and end in positions:
                continue
            if start not in positions and end not in positions:
                positions[start] = [-3.0, 0.0]
                positions[end] = [3.0, 0.0]
                break

        for _ in range(4):
            changed = False
            for start, end in segment_map.values():
                if start in positions and end not in positions:
                    positions[end] = [
                        positions[start][0] + 2.6,
                        positions[start][1] + 1.2,
                    ]
                    changed = True
                elif end in positions and start not in positions:
                    positions[start] = [
                        positions[end][0] - 2.6,
                        positions[end][1] - 1.2,
                    ]
                    changed = True
            if not changed:
                break

        segment_mid_counts: Dict[str, int] = {}
        for constraint in constraints:
            if str(constraint.get("type", "")).strip().lower() != "point_on_segment":
                continue
            entities = [
                str(item).strip() for item in (constraint.get("entities") or [])
            ]
            if len(entities) != 2:
                continue
            point_id, segment_id = entities
            endpoints = segment_map.get(segment_id)
            if (
                not endpoints
                or endpoints[0] not in positions
                or endpoints[1] not in positions
            ):
                continue
            count = segment_mid_counts.get(segment_id, 0)
            segment_mid_counts[segment_id] = count + 1
            ratio = 0.5 if count == 0 else min(0.25 + 0.25 * count, 0.8)
            ax, ay = positions[endpoints[0]]
            bx, by = positions[endpoints[1]]
            positions.setdefault(
                point_id,
                [round(ax + (bx - ax) * ratio, 6), round(ay + (by - ay) * ratio, 6)],
            )

        unresolved = [
            point_id for point_id in points.keys() if point_id not in positions
        ]
        for index, point_id in enumerate(unresolved):
            col = index % 3
            row = index // 3
            positions[point_id] = [-4.0 + col * 3.0, -2.0 - row * 2.0]

        for point_id, payload in points.items():
            coord = positions.get(point_id)
            if coord is None:
                continue
            if not isinstance(payload, dict):
                payload = {}
                points[point_id] = payload
            payload["pos"] = [float(coord[0]), float(coord[1])]

    def _apply_circle_parallel_extension_layout(
        self,
        *,
        positions: Dict[str, List[float]],
        objects: List[Dict[str, Any]],
        constraints: List[Dict[str, Any]],
        measurements: List[Dict[str, Any]],
        segment_map: Dict[str, Tuple[str, str]],
    ) -> bool:
        circle_objects = [
            obj
            for obj in objects
            if isinstance(obj, dict)
            and str(obj.get("type", "")).strip().lower() == "circle"
        ]
        parallel_constraints = [
            item
            for item in constraints
            if str(item.get("type", "")).strip().lower() == "parallel"
        ]
        if not circle_objects or not parallel_constraints:
            return False

        for circle in circle_objects:
            circle_id = str(circle.get("id", "")).strip()
            center = str(circle.get("center", "")).strip()
            if not circle_id or not center:
                continue
            members = self._circle_members(circle_id, circle, constraints)
            if len(members) < 3:
                continue

            for relation in parallel_constraints:
                entities = [
                    str(item).strip()
                    for item in (relation.get("entities") or [])
                    if str(item).strip()
                ]
                if len(entities) != 2:
                    continue
                seg1 = segment_map.get(entities[0])
                seg2 = segment_map.get(entities[1])
                if not seg1 or not seg2:
                    continue

                layout = self._classify_parallel_layout(
                    seg1=seg1,
                    seg2=seg2,
                    members=members,
                    segment_map=segment_map,
                )
                if layout is None:
                    continue

                chord_a, chord_c, anchor_b, external_point = layout
                remaining = [
                    item for item in members if item not in {chord_a, chord_c, anchor_b}
                ]
                if len(remaining) == 1:
                    angle_map = {
                        chord_a: 210.0,
                        remaining[0]: 285.0,
                        chord_c: 350.0,
                        anchor_b: 75.0,
                    }
                else:
                    angle_map = {
                        chord_a: 210.0,
                        chord_c: 350.0,
                        anchor_b: 75.0,
                    }
                    extra_count = max(len(remaining), 1)
                    for index, point_id in enumerate(remaining):
                        angle_map[point_id] = 285.0 - index * (50.0 / extra_count)

                radius = self._infer_radius_from_measurements(angle_map, measurements)
                positions.setdefault(center, [0.0, 0.0])
                cx, cy = positions[center]
                for point_id, angle_deg in angle_map.items():
                    angle = math.radians(angle_deg)
                    positions[point_id] = [
                        round(cx + radius * math.cos(angle), 6),
                        round(cy + radius * math.sin(angle), 6),
                    ]

                ext_length = self._measurement_length_between(
                    measurements,
                    anchor_b,
                    external_point,
                ) or (radius * 1.9)
                chord_dir = [
                    positions[chord_c][0] - positions[chord_a][0],
                    positions[chord_c][1] - positions[chord_a][1],
                ]
                norm = math.hypot(chord_dir[0], chord_dir[1]) or 1.0
                direction = [chord_dir[0] / norm, chord_dir[1] / norm]
                positions[external_point] = [
                    round(positions[anchor_b][0] + direction[0] * ext_length, 6),
                    round(positions[anchor_b][1] + direction[1] * ext_length, 6),
                ]
                return True

        return False

    def _circle_members(
        self,
        circle_id: str,
        circle: Dict[str, Any],
        constraints: List[Dict[str, Any]],
    ) -> List[str]:
        members: List[str] = []
        radius_point = str(circle.get("radius_point", "")).strip()
        if radius_point:
            members.append(radius_point)
        for constraint in constraints:
            if str(constraint.get("type", "")).strip().lower() != "point_on_circle":
                continue
            entities = [
                str(item).strip()
                for item in (constraint.get("entities") or [])
                if str(item).strip()
            ]
            if len(entities) == 2 and entities[1] == circle_id:
                members.append(entities[0])
        return list(dict.fromkeys(members))

    def _classify_parallel_layout(
        self,
        *,
        seg1: Tuple[str, str],
        seg2: Tuple[str, str],
        members: List[str],
        segment_map: Dict[str, Tuple[str, str]],
    ) -> Optional[Tuple[str, str, str, str]]:
        member_set = set(members)
        for chord_seg, ext_seg in ((seg1, seg2), (seg2, seg1)):
            if not all(point in member_set for point in chord_seg):
                continue
            circle_points = [point for point in ext_seg if point in member_set]
            external_points = [point for point in ext_seg if point not in member_set]
            if len(circle_points) != 1 or len(external_points) != 1:
                continue
            anchor_b = circle_points[0]
            external_point = external_points[0]
            chord_a, chord_c = chord_seg

            linked_candidates = []
            for endpoints in segment_map.values():
                if external_point not in endpoints:
                    continue
                other = endpoints[0] if endpoints[1] == external_point else endpoints[1]
                if other in chord_seg:
                    linked_candidates.append(other)
            if linked_candidates:
                chord_c = linked_candidates[0]
                chord_a = chord_seg[0] if chord_seg[1] == chord_c else chord_seg[1]

            return chord_a, chord_c, anchor_b, external_point
        return None

    def _infer_radius_from_measurements(
        self,
        angle_map: Dict[str, float],
        measurements: List[Dict[str, Any]],
    ) -> float:
        for measurement in measurements:
            if str(measurement.get("type", "")).strip().lower() != "length":
                continue
            entities = [
                str(item).strip()
                for item in (measurement.get("entities") or [])
                if str(item).strip()
            ]
            if len(entities) != 2:
                continue
            first, second = entities
            if first not in angle_map or second not in angle_map:
                continue
            value = self._coerce_float(measurement.get("value"), default=0.0)
            if value <= 0:
                continue
            delta = abs(angle_map[first] - angle_map[second]) % 360.0
            delta = min(delta, 360.0 - delta)
            if delta <= 1e-6:
                continue
            radius = value / (2 * math.sin(math.radians(delta) / 2))
            if radius > 0:
                return radius
        return 3.0

    def _measurement_length_between(
        self,
        measurements: List[Dict[str, Any]],
        first: str,
        second: str,
    ) -> Optional[float]:
        pair = {first, second}
        for measurement in measurements:
            if str(measurement.get("type", "")).strip().lower() != "length":
                continue
            entities = [
                str(item).strip()
                for item in (measurement.get("entities") or [])
                if str(item).strip()
            ]
            if len(entities) == 2 and set(entities) == pair:
                value = self._coerce_float(measurement.get("value"), default=0.0)
                if value > 0:
                    return value
        return None

    def _coerce_float(self, value: Any, *, default: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def analyze_image(
        self,
        image_path: str,
        prompt: str,
        *,
        model_role: str = "geometry",
    ) -> str:
        if not image_path or not Path(image_path).exists():
            return f"Error: image file does not exist: {image_path}"

        with open(image_path, "rb") as file:
            image_data = base64.b64encode(file.read()).decode()

        messages = [
            {"role": "system", "content": self.system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_data}"},
                    },
                ],
            },
        ]
        return self._invoke_model(messages, model_role=model_role).strip()

    def _invoke_model(self, messages: list, *, model_role: str = "geometry") -> str:
        if model_role != "ocr" or self.ocr_llm is None or self.ocr_llm is self.llm:
            return self._invoke_llm(messages)

        last_error: Optional[Exception] = None
        attempts = max(self.max_retries, 1)
        for attempt in range(attempts):
            try:
                response = self.ocr_llm.invoke(messages)
                content = response.content
                if not content:
                    content = self._extract_content_from_response(response)
                    if not content and self._is_response_refusal(response):
                        return ""
                return content
            except Exception as exc:
                last_error = exc
                if not self._is_retryable_llm_error(exc) or attempt >= attempts - 1:
                    raise
                sleep_seconds = self.retry_backoff_seconds * (2**attempt)
                print(
                    f"[{self.__class__.__name__}] OCR request hit a temporary limit; "
                    f"retrying in {sleep_seconds:.1f}s ({attempt + 1}/{attempts})"
                )
                time.sleep(sleep_seconds)

        if last_error is not None:
            raise last_error
        raise RuntimeError("OCR model invocation failed without an exception.")

    def parse_geometry_spec(self, image_path: str) -> dict:
        bundle = self._analyze_problem_bundle(image_path)
        geometry_facts = (
            bundle.get("geometry_facts") or bundle.get("geometry_spec") or {}
        )
        return self._compile_geometry_spec(
            geometry_facts,
            problem_text=str(bundle.get("problem_text", "")).strip(),
        )

    def parse_geometry_scene(self, image_path: str) -> dict:
        return self.parse_geometry_spec(image_path)

    def _parse_json_like_output(
        self, result: str, fallback: Dict[str, Any]
    ) -> Dict[str, Any]:
        candidates = [result]
        match = re.search(r"```json\s*([\s\S]*?)\s*```", result)
        if match:
            candidates.append(match.group(1).strip())
        brace_match = re.search(r"\{[\s\S]*\}", result)
        if brace_match:
            candidates.append(brace_match.group(0))

        for candidate in candidates:
            for variant in (candidate, self._clean_json_like_text(candidate)):
                try:
                    return json.loads(variant)
                except json.JSONDecodeError:
                    continue
        return fallback

    def _clean_json_like_text(self, text: str) -> str:
        cleaned = str(text or "")
        cleaned = re.sub(r"```json\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = cleaned.replace("```", "")
        cleaned = re.sub(r"//.*?$", "", cleaned, flags=re.MULTILINE)
        cleaned = re.sub(r"/\*[\s\S]*?\*/", "", cleaned)
        cleaned = re.sub(r"(\})(\s*\{)", r"\1,\2", cleaned)
        cleaned = re.sub(r"(\])(\s*\{)", r"\1,\2", cleaned)
        cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
        return cleaned.strip()
