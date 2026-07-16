"""Deterministic repair loop for post-render review failures."""

from __future__ import annotations

import copy
import re
from typing import Any, Dict, List, Optional, Sequence, Set

from ..foundation.base_agent import BaseAgent
from ..perception.layout_contract import resolve_layout_scene
from ..perception.layout_ir import build_layout_ir


class RenderReviewRepairAgent(BaseAgent):
    """Apply deterministic scene/IR repairs after render-vs-source review."""

    def __init__(self, config: Dict[str, Any], llm: Optional[Any] = None):
        super().__init__(config, llm)
        self.max_render_review_rounds = int(
            config.get("max_render_review_rounds", 1)
        )

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        project = state.get("project")
        if project is not None and getattr(project, "status", "") == "failed":
            return state

        metadata = state.setdefault("metadata", {})
        report = (
            metadata.get("render_vs_source_validation")
            if isinstance(metadata.get("render_vs_source_validation"), dict)
            else {}
        )
        retry_requested = bool(metadata.get("render_review_retry_requested"))
        retry_count = int(metadata.get("render_review_retry_count", 0) or 0)

        metadata["render_review_next_step"] = "end"
        state["current_step"] = "render_review_repair_completed"

        if not retry_requested or not report or report.get("is_valid") is True:
            state.setdefault("messages", []).append(
                {
                    "role": "assistant",
                    "content": "渲染后评审未请求回环修复，继续结束当前流程。",
                }
            )
            return state

        if retry_count >= self.max_render_review_rounds:
            metadata["render_review_retry_requested"] = False
            state.setdefault("messages", []).append(
                {
                    "role": "assistant",
                    "content": (
                        "渲染后评审已达到最大回环次数，停止自动修复并保留评审报告。"
                    ),
                }
            )
            return state

        repair_actions: List[Dict[str, Any]] = []
        failed_checks = {
            str(item.get("check", "")).strip()
            for item in report.get("failed_checks", [])
            if isinstance(item, dict)
        }
        rejected_pairs = self._rejected_pairs(
            metadata.get("render_topology_validation"),
            report,
        )
        if rejected_pairs:
            removed = self._remove_rejected_topology(metadata, rejected_pairs)
            if removed:
                repair_actions.append(
                    {
                        "kind": "remove_rejected_topology",
                        "rejected_pairs": sorted(rejected_pairs),
                        "applied_targets": removed,
                    }
                )

        if "frame_nonblank" in failed_checks and str(
            (metadata.get("visual_geometry_source") or {}).get("mode", "")
        ).strip() == "image_overlay":
            metadata["render_review_force_vector_reconstruction"] = True
            repair_actions.append(
                {
                    "kind": "force_vector_reconstruction",
                    "reason": "frame_nonblank",
                }
            )

        if "dashed_segments" in failed_checks:
            normalized = self._normalize_segment_styles(metadata)
            if normalized:
                repair_actions.append(
                    {
                        "kind": "normalize_segment_styles",
                        "targets": normalized,
                    }
                )

        semantic_review = (
            metadata.get("semantic_render_review")
            if isinstance(metadata.get("semantic_render_review"), dict)
            else {}
        )
        semantic_actions = self._apply_semantic_review_corrections(
            metadata,
            semantic_review,
        )
        repair_actions.extend(semantic_actions)

        self._record_geometry_ir_repairs(metadata, repair_actions)
        metadata["render_review_repair_actions"] = repair_actions
        metadata["render_review_retry_requested"] = False

        if not repair_actions:
            if project is not None and getattr(project, "final_video_path", None):
                project.status = "completed"
                project.error_message = ""
                state["project"] = project
            state.setdefault("messages", []).append(
                {
                    "role": "assistant",
                    "content": "渲染后评审发现问题，但当前没有命中的确定性修复规则，停止自动回环。",
                }
            )
            return state

        metadata["render_review_retry_count"] = retry_count + 1
        metadata["render_review_next_step"] = "animation"
        if project is not None:
            project.status = "retrying_render_review"
            project.error_message = ""
            project.final_video_path = None
            project.animation_rendered = False
            state["project"] = project
        state.setdefault("messages", []).append(
            {
                "role": "assistant",
                "content": (
                    "渲染后评审触发确定性回环修复，已更新 GeometryIR/scene，"
                    f"准备第 {metadata['render_review_retry_count']} 次重新生成动画。"
                ),
            }
        )
        return state

    def _apply_semantic_review_corrections(
        self,
        metadata: Dict[str, Any],
        semantic_review: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        actions: List[Dict[str, Any]] = []
        corrections = (
            semantic_review.get("corrections")
            if isinstance(semantic_review.get("corrections"), list)
            else []
        )
        for correction in corrections:
            if not isinstance(correction, dict):
                continue
            action = str(correction.get("action", "")).strip()
            confidence = float(correction.get("confidence", 0.0) or 0.0)
            if confidence < 0.6:
                continue
            target = correction.get("target") if isinstance(correction.get("target"), dict) else {}
            if action == "prefer_vector_reconstruction":
                metadata["render_review_force_vector_reconstruction"] = True
                actions.append(
                    {
                        "kind": "prefer_vector_reconstruction",
                        "source": "semantic_render_review",
                        "confidence": confidence,
                    }
                )
            elif action == "remove_segment":
                pair = self._pair_from_target(target)
                if not pair:
                    continue
                removed = self._remove_rejected_topology(metadata, {pair})
                if removed:
                    actions.append(
                        {
                            "kind": "remove_segment",
                            "source": "semantic_render_review",
                            "confidence": confidence,
                            "pair": pair,
                            "applied_targets": removed,
                        }
                    )
            elif action == "set_segment_style":
                segment_id = self._segment_id_from_target(target)
                style = str(target.get("style", "")).strip().lower()
                if not segment_id or style not in {"dashed", "solid"}:
                    continue
                changed = self._set_segment_style(metadata, segment_id, style)
                if changed:
                    actions.append(
                        {
                            "kind": "set_segment_style",
                            "source": "semantic_render_review",
                            "confidence": confidence,
                            "segment_id": segment_id,
                            "style": style,
                            "targets": changed,
                        }
                    )
            elif action == "set_label_direction":
                point_id = self._normalize_point(target.get("point_id"))
                direction = str(target.get("label_direction", "")).strip().lower()
                if not point_id or direction not in {
                    "up",
                    "down",
                    "left",
                    "right",
                    "up_left",
                    "up_right",
                    "down_left",
                    "down_right",
                }:
                    continue
                changed = self._set_label_direction(metadata, point_id, direction)
                if changed:
                    actions.append(
                        {
                            "kind": "set_label_direction",
                            "source": "semantic_render_review",
                            "confidence": confidence,
                            "point_id": point_id,
                            "label_direction": direction,
                            "targets": changed,
                        }
                    )
            elif action == "update_fold_correspondence":
                source_id = self._normalize_point(target.get("source"))
                image_id = self._normalize_point(target.get("image"))
                if not source_id or not image_id:
                    continue
                changed = self._update_fold_correspondence(
                    metadata,
                    source_id=source_id,
                    image_id=image_id,
                )
                if changed:
                    actions.append(
                        {
                            "kind": "update_fold_correspondence",
                            "source": "semantic_render_review",
                            "confidence": confidence,
                            "source_point": source_id,
                            "image_point": image_id,
                            "targets": changed,
                        }
                    )
            elif action == "flag_wrong_overall_shape":
                changed = self._flag_wrong_overall_shape(
                    metadata,
                    expected_template=str(target.get("expected_template", "")).strip(),
                    bad_shape=str(target.get("bad_shape", "")).strip(),
                )
                if changed:
                    actions.append(
                        {
                            "kind": "flag_wrong_overall_shape",
                            "source": "semantic_render_review",
                            "confidence": confidence,
                            "expected_template": str(
                                target.get("expected_template", "")
                            ).strip(),
                            "bad_shape": str(target.get("bad_shape", "")).strip(),
                            "targets": changed,
                        }
                    )
        return actions

    def _remove_rejected_topology(
        self,
        metadata: Dict[str, Any],
        rejected_pairs: Set[str],
    ) -> List[Dict[str, Any]]:
        applied: List[Dict[str, Any]] = []
        layout_targets = self._layout_scene_targets(metadata)
        if layout_targets:
            layout_changed = False
            for key, scene in layout_targets:
                updated, removed_ids = self._strip_scene_topology(scene, rejected_pairs)
                if not removed_ids:
                    continue
                scene.clear()
                scene.update(updated)
                applied.append({"target": f"layout_ir.{key}", "removed_ids": removed_ids})
                layout_changed = True
            if layout_changed:
                self._sync_layout_metadata_from_ir(metadata)
                return applied

        for key in ("drawable_scene", "coordinate_scene", "render_scene"):
            scene = metadata.get(key)
            if not isinstance(scene, dict):
                continue
            updated, removed_ids = self._strip_scene_topology(scene, rejected_pairs)
            if not removed_ids:
                continue
            metadata[key] = updated
            applied.append({"target": key, "removed_ids": removed_ids})
        return applied

    def _normalize_segment_styles(self, metadata: Dict[str, Any]) -> List[Dict[str, Any]]:
        source_summary = (
            metadata.get("render_vs_source_validation", {}).get("source_summary", {})
        )
        dashed_ids = {
            str(item).strip()
            for item in source_summary.get("dashed_segment_ids", [])
            if str(item).strip()
        }
        segment_ids = {
            str(item).strip()
            for item in source_summary.get("segment_ids", [])
            if str(item).strip()
        }
        if not segment_ids:
            return []

        applied: List[Dict[str, Any]] = []
        layout_targets = self._layout_scene_targets(metadata)
        if layout_targets:
            layout_changed = False
            for key, scene in layout_targets:
                display = scene.setdefault("display", {})
                primitive_display = display.setdefault("primitives", {})
                changed: List[str] = []
                for segment_id in sorted(segment_ids):
                    payload = primitive_display.setdefault(segment_id, {})
                    expected_style = "dashed" if segment_id in dashed_ids else "solid"
                    if str(payload.get("style", "")).strip().lower() != expected_style:
                        payload["style"] = expected_style
                        changed.append(segment_id)
                if changed:
                    applied.append({"target": f"layout_ir.{key}", "segment_ids": changed})
                    layout_changed = True
            if layout_changed:
                self._sync_layout_metadata_from_ir(metadata)
                return applied

        for key in ("drawable_scene", "coordinate_scene", "render_scene"):
            scene = metadata.get(key)
            if not isinstance(scene, dict):
                continue
            display = scene.setdefault("display", {})
            primitive_display = display.setdefault("primitives", {})
            changed: List[str] = []
            for segment_id in sorted(segment_ids):
                payload = primitive_display.setdefault(segment_id, {})
                expected_style = "dashed" if segment_id in dashed_ids else "solid"
                if str(payload.get("style", "")).strip().lower() != expected_style:
                    payload["style"] = expected_style
                    changed.append(segment_id)
            if changed:
                applied.append({"target": key, "segment_ids": changed})
        return applied

    def _strip_scene_topology(
        self,
        scene: Dict[str, Any],
        rejected_pairs: Set[str],
    ) -> tuple[Dict[str, Any], List[str]]:
        updated = copy.deepcopy(scene)
        removed_ids: List[str] = []
        kept_primitives: List[Dict[str, Any]] = []
        for primitive in updated.get("primitives") or []:
            if not isinstance(primitive, dict):
                kept_primitives.append(primitive)
                continue
            primitive_type = str(primitive.get("type", "")).strip().lower()
            primitive_id = str(primitive.get("id", "")).strip()
            if primitive_type == "segment":
                pair = self._pair_from_points(primitive.get("points") or [])
                if pair and pair in rejected_pairs:
                    removed_ids.append(primitive_id or pair)
                    continue
            elif primitive_type == "polygon":
                edges = self._polygon_edges(primitive.get("points") or [])
                if any(edge in rejected_pairs for edge in edges):
                    removed_ids.append(primitive_id or "polygon")
                    continue
            kept_primitives.append(primitive)
        if not removed_ids:
            return updated, []
        updated["primitives"] = kept_primitives
        display = updated.get("display") if isinstance(updated.get("display"), dict) else {}
        primitive_display = (
            display.get("primitives") if isinstance(display.get("primitives"), dict) else {}
        )
        for primitive_id in removed_ids:
            primitive_display.pop(primitive_id, None)
        return updated, removed_ids

    def _set_segment_style(
        self,
        metadata: Dict[str, Any],
        segment_id: str,
        style: str,
    ) -> List[str]:
        changed: List[str] = []
        layout_targets = self._layout_scene_targets(metadata)
        if layout_targets:
            layout_changed = False
            for key, scene in layout_targets:
                display = scene.setdefault("display", {})
                primitive_display = display.setdefault("primitives", {})
                payload = primitive_display.setdefault(segment_id, {})
                if str(payload.get("style", "")).strip().lower() == style:
                    continue
                payload["style"] = style
                changed.append(f"layout_ir.{key}")
                layout_changed = True
            if layout_changed:
                self._sync_layout_metadata_from_ir(metadata)
                return changed

        for key in ("drawable_scene", "coordinate_scene", "render_scene"):
            scene = metadata.get(key)
            if not isinstance(scene, dict):
                continue
            display = scene.setdefault("display", {})
            primitive_display = display.setdefault("primitives", {})
            payload = primitive_display.setdefault(segment_id, {})
            if str(payload.get("style", "")).strip().lower() == style:
                continue
            payload["style"] = style
            changed.append(key)
        return changed

    def _set_label_direction(
        self,
        metadata: Dict[str, Any],
        point_id: str,
        direction: str,
    ) -> List[str]:
        changed: List[str] = []
        layout_targets = self._layout_scene_targets(metadata)
        if layout_targets:
            layout_changed = False
            for key, scene in layout_targets:
                display = scene.setdefault("display", {})
                point_display = display.setdefault("points", {})
                payload = point_display.setdefault(point_id, {})
                if str(payload.get("label_direction", "")).strip().lower() == direction:
                    continue
                payload["label_direction"] = direction
                changed.append(f"layout_ir.{key}")
                layout_changed = True
            if layout_changed:
                self._sync_layout_metadata_from_ir(metadata)
        else:
            for key in ("drawable_scene", "coordinate_scene", "render_scene"):
                scene = metadata.get(key)
                if not isinstance(scene, dict):
                    continue
                display = scene.setdefault("display", {})
                point_display = display.setdefault("points", {})
                payload = point_display.setdefault(point_id, {})
                if str(payload.get("label_direction", "")).strip().lower() == direction:
                    continue
                payload["label_direction"] = direction
                changed.append(key)
        for key in ("geometry_ir", "perception_geometry_ir"):
            geometry_ir = metadata.get(key)
            if not isinstance(geometry_ir, dict):
                continue
            if self._sync_geometry_ir_label_direction(geometry_ir, point_id, direction):
                changed.append(f"{key}.display.points")
        return changed

    def _update_fold_correspondence(
        self,
        metadata: Dict[str, Any],
        *,
        source_id: str,
        image_id: str,
    ) -> List[str]:
        changed: List[str] = []
        for key in ("geometry_ir", "perception_geometry_ir"):
            geometry_ir = metadata.get(key)
            if not isinstance(geometry_ir, dict):
                continue
            scene_draft = (
                geometry_ir.setdefault("scene_draft", {})
                if isinstance(geometry_ir.get("scene_draft"), dict)
                else {}
            )
            pairs = (
                scene_draft.setdefault("fold_correspondences", [])
                if isinstance(scene_draft, dict)
                else []
            )
            if not isinstance(pairs, list):
                continue
            pair = {
                "source": source_id,
                "image": image_id,
                "source_type": "semantic_render_review",
            }
            if not any(
                isinstance(item, dict)
                and str(item.get("source", "")).strip().upper() == source_id
                and str(item.get("image", "")).strip().upper() == image_id
                for item in pairs
            ):
                pairs.append(pair)
                changed.append(key)
            facts = geometry_ir.setdefault("facts", {})
            solver = facts.setdefault("solver_derived", {})
            fold_pairs = solver.setdefault("fold_correspondences", [])
            if isinstance(fold_pairs, list) and pair not in fold_pairs:
                fold_pairs.append(copy.deepcopy(pair))
            geometry_facts = geometry_ir.setdefault("geometry_facts", {})
            geometry_facts["fold_correspondences"] = copy.deepcopy(pairs)
        return changed

    def _flag_wrong_overall_shape(
        self,
        metadata: Dict[str, Any],
        *,
        expected_template: str,
        bad_shape: str,
    ) -> List[str]:
        changed: List[str] = []
        metadata["render_review_force_vector_reconstruction"] = True
        metadata["render_review_prefer_verified_coordinate_scene"] = True
        changed.extend(
            [
                "metadata.render_review_force_vector_reconstruction",
                "metadata.render_review_prefer_verified_coordinate_scene",
            ]
        )
        for key in ("geometry_ir", "perception_geometry_ir"):
            geometry_ir = metadata.get(key)
            if not isinstance(geometry_ir, dict):
                continue
            facts = geometry_ir.setdefault("facts", {})
            solver = facts.setdefault("solver_derived", {})
            shape_flags = solver.setdefault("shape_flags", [])
            flag = {
                "type": "wrong_overall_shape",
                "expected_template": expected_template,
                "bad_shape": bad_shape,
                "source": "semantic_render_review",
            }
            if isinstance(shape_flags, list) and flag not in shape_flags:
                shape_flags.append(flag)
                changed.append(f"{key}.facts.solver_derived.shape_flags")
        return changed

    def _sync_geometry_ir_label_direction(
        self,
        geometry_ir: Dict[str, Any],
        point_id: str,
        direction: str,
    ) -> bool:
        changed = False
        geometry_facts = geometry_ir.setdefault("geometry_facts", {})
        display = geometry_facts.setdefault("display", {})
        if isinstance(display, dict):
            point_display = display.setdefault("points", {})
            if isinstance(point_display, dict):
                payload = point_display.setdefault(point_id, {})
                if str(payload.get("label_direction", "")).strip().lower() != direction:
                    payload["label_direction"] = direction
                    changed = True

        facts = geometry_ir.setdefault("facts", {})
        visual = facts.setdefault("visual_observed", {})
        if isinstance(visual, dict):
            visual_display = visual.setdefault("display", {})
            if isinstance(visual_display, dict):
                point_display = visual_display.setdefault("points", {})
                if isinstance(point_display, dict):
                    payload = point_display.setdefault(point_id, {})
                    if (
                        str(payload.get("label_direction", "")).strip().lower()
                        != direction
                    ):
                        payload["label_direction"] = direction
                        changed = True

        scene_draft = geometry_ir.get("scene_draft")
        if isinstance(scene_draft, dict):
            points = scene_draft.get("points")
            if isinstance(points, list):
                for item in points:
                    if not isinstance(item, dict):
                        continue
                    if str(item.get("id", "")).strip().upper() != point_id:
                        continue
                    if (
                        str(item.get("label_direction", "")).strip().lower()
                        != direction
                    ):
                        item["label_direction"] = direction
                        changed = True
        return changed

    def _record_geometry_ir_repairs(
        self,
        metadata: Dict[str, Any],
        repair_actions: Sequence[Dict[str, Any]],
    ) -> None:
        if not repair_actions:
            return
        for key in ("geometry_ir", "perception_geometry_ir"):
            geometry_ir = metadata.get(key)
            if not isinstance(geometry_ir, dict):
                continue
            facts = geometry_ir.setdefault("facts", {})
            solver = facts.setdefault("solver_derived", {})
            repairs = solver.setdefault("review_repairs", [])
            repairs.extend(copy.deepcopy(list(repair_actions)))
            geometry_facts = geometry_ir.setdefault("geometry_facts", {})
            geometry_facts["review_repairs"] = copy.deepcopy(repairs)

    def _ensure_layout_ir(self, metadata: Dict[str, Any]) -> Dict[str, Any]:
        layout_ir = metadata.get("layout_ir")
        if (
            isinstance(layout_ir, dict)
            and str(layout_ir.get("version", "")).strip() == "layout_ir.v1"
        ):
            return layout_ir
        layout_ir = build_layout_ir(metadata)
        metadata["layout_ir"] = layout_ir
        return layout_ir

    def _layout_scene_targets(
        self,
        metadata: Dict[str, Any],
    ) -> List[tuple[str, Dict[str, Any]]]:
        layout_ir = self._ensure_layout_ir(metadata)
        targets: List[tuple[str, Dict[str, Any]]] = []
        for candidate in layout_ir.get("candidates") or []:
            if not isinstance(candidate, dict):
                continue
            scene_key = str(candidate.get("scene_key", "")).strip()
            scene_payload = candidate.get("scene_payload")
            if scene_key and isinstance(scene_payload, dict):
                targets.append((scene_key, scene_payload))
        return targets

    def _sync_layout_metadata_from_ir(self, metadata: Dict[str, Any]) -> None:
        layout_ir = self._ensure_layout_ir(metadata)
        for candidate in layout_ir.get("candidates") or []:
            if not isinstance(candidate, dict):
                continue
            scene_key = str(candidate.get("scene_key", "")).strip()
            scene_payload = candidate.get("scene_payload")
            if scene_key and isinstance(scene_payload, dict):
                metadata[scene_key] = copy.deepcopy(scene_payload)
        selection = resolve_layout_scene(metadata, allow_semantic_fallback=False)
        selected_scene = (
            selection.get("selected_scene")
            if isinstance(selection.get("selected_scene"), dict)
            else {}
        )
        if selected_scene:
            metadata["render_scene"] = copy.deepcopy(selected_scene)

    def _rejected_pairs(
        self,
        render_topology_validation: Any,
        review_report: Dict[str, Any],
    ) -> Set[str]:
        pairs: Set[str] = set()
        for source in (
            render_topology_validation if isinstance(render_topology_validation, dict) else {},
            review_report.get("topology") if isinstance(review_report.get("topology"), dict) else {},
        ):
            rejected = source.get("rejected") if isinstance(source.get("rejected"), list) else []
            for item in rejected:
                if not isinstance(item, dict):
                    continue
                pair = str(item.get("pair", "")).strip()
                if pair:
                    pairs.add(pair)
                    continue
                derived = self._pair_from_points(item.get("points") or [])
                if derived:
                    pairs.add(derived)
            for item in source.get("rejected_pairs", []) or []:
                token = str(item).strip()
                if token:
                    pairs.add(token)
        return pairs

    def _pair_from_points(self, raw_points: Sequence[Any]) -> str:
        points = [self._normalize_point(item) for item in raw_points]
        points = [item for item in points if item]
        if len(points) != 2 or points[0] == points[1]:
            return ""
        return "".join(sorted(points))

    def _polygon_edges(self, raw_points: Sequence[Any]) -> List[str]:
        points = [self._normalize_point(item) for item in raw_points]
        points = [item for item in points if item]
        if len(points) < 3:
            return []
        return [
            "".join(sorted((points[index], points[(index + 1) % len(points)])))
            for index in range(len(points))
            if points[index] != points[(index + 1) % len(points)]
        ]

    def _pair_from_target(self, target: Dict[str, Any]) -> str:
        points = target.get("points") if isinstance(target.get("points"), list) else []
        pair = self._pair_from_points(points)
        if pair:
            return pair
        segment_id = self._segment_id_from_target(target)
        if segment_id.startswith("seg_"):
            refs = re.findall(r"[A-Za-z]\d*'?", segment_id[4:])
            return self._pair_from_points(refs)
        return ""

    def _segment_id_from_target(self, target: Dict[str, Any]) -> str:
        segment_id = str(target.get("segment_id", "")).strip()
        if segment_id:
            return segment_id
        points = target.get("points") if isinstance(target.get("points"), list) else []
        pair = [self._normalize_point(item) for item in points]
        pair = [item for item in pair if item]
        if len(pair) == 2:
            return f"seg_{pair[0]}{pair[1]}"
        return ""

    def _normalize_point(self, raw: Any) -> str:
        token = str(raw or "").strip().replace("′", "'").replace("`", "'")
        token = "".join(token.split())
        if len(token) >= 1:
            return token.upper()
        return ""
