"""
Build Geometry IR + Teaching IR for step-level animation planning.

教学表示规划器 - 将脚本步骤转换为教学表示，指导动画生成
"""

from __future__ import annotations

import copy
import re
from typing import Any, Dict, List, Optional, Sequence, Set

from ..perception.geometry_context import GeometryContext


class FoldActionTemplateLibrary:
    """Template actions for fold-transform problem sub patterns."""

    DISTANCE_HINT = re.compile(r"距离|distance|垂线|perpendicular", re.IGNORECASE)

    def build_actions(
        self,
        *,
        sub_pattern: str,
        fold_axis: str,
        focus_targets: Sequence[str],
        image_pairs: Sequence[Dict[str, Any]],
        step_text: str,
        is_fold_step: bool,
    ) -> List[Dict[str, Any]]:
        if not fold_axis or not is_fold_step:
            return []

        actions: List[Dict[str, Any]] = [
            {
                "action": "highlight_fold_axis",
                "axis": fold_axis,
            },
            {
                "action": "animate_fold",
                "axis": fold_axis,
                "targets": list(focus_targets or []),
            },
        ]

        for pair in list(image_pairs or [])[:3]:
            source = str(pair.get("source", "")).strip()
            image = str(pair.get("image", "")).strip()
            if source and image:
                actions.append(
                    {
                        "action": "create_image_point",
                        "from": source,
                        "to": image,
                    }
                )

        actions.append({"action": "show_fold_invariants"})

        normalized_sub_pattern = str(sub_pattern or "").strip()
        if normalized_sub_pattern in {
            "fold_with_perpendicular_construction",
            "fold_point_to_point_distance",
        } and self.DISTANCE_HINT.search(str(step_text or "")):
            image_point = self._pick_image_point(image_pairs)
            if image_point:
                actions.append(
                    {
                        "action": "draw_perpendicular_auxiliary",
                        "from": image_point,
                        "to_line": fold_axis,
                        "reason": "fold_template_distance_support",
                    }
                )

        return actions

    def _pick_image_point(self, image_pairs: Sequence[Dict[str, Any]]) -> str:
        for pair in image_pairs or []:
            image = str(pair.get("image", "")).strip()
            if image:
                return image
        return ""


class AuxiliaryLineStrategyEngine:
    """Rule-based auxiliary-line suggestions for geometry teaching steps."""

    DISTANCE_PATTERN = re.compile(r"距离|到.*线|distance|垂线|perpendicular", re.IGNORECASE)
    TANGENT_PATTERN = re.compile(r"切线|tangent", re.IGNORECASE)
    SIMILAR_PATTERN = re.compile(r"全等|相似|congruent|similar", re.IGNORECASE)
    ALTITUDE_PATTERN = re.compile(r"高(?!亮)|高线|altitude|height", re.IGNORECASE)
    MIDPOINT_PATTERN = re.compile(r"中点|midpoint|平分", re.IGNORECASE)
    PARALLEL_PATTERN = re.compile(r"平行|parallel", re.IGNORECASE)
    ANGLE_BISECTOR_PATTERN = re.compile(r"角平分线|bisector", re.IGNORECASE)
    MAX_SUGGESTIONS = 3

    SCENARIO_CONFIG = {
        "point_to_line_distance": {
            "action": "draw_perpendicular_auxiliary",
            "confidence_base": 0.85,
            "keywords": ["距离", "distance", "垂线", "perpendicular"],
        },
        "construct_altitude": {
            "action": "draw_perpendicular_auxiliary",
            "confidence_base": 0.80,
            "keywords": ["高", "高线", "altitude", "height"],
        },
        "tangent_radius": {
            "action": "connect_center_tangent",
            "confidence_base": 0.90,
            "keywords": ["切线", "tangent", "半径", "radius"],
        },
        "prove_congruent": {
            "action": "draw_connection_auxiliary",
            "confidence_base": 0.75,
            "keywords": ["全等", "congruent"],
        },
        "prove_similar": {
            "action": "draw_connection_auxiliary",
            "confidence_base": 0.75,
            "keywords": ["相似", "similar"],
        },
        "parallel_proportion": {
            "action": "draw_parallel_auxiliary",
            "confidence_base": 0.70,
            "keywords": ["平行", "parallel", "比例", "proportion"],
        },
        "fold_image_distance": {
            "action": "draw_perpendicular_auxiliary",
            "confidence_base": 0.85,
            "keywords": ["折叠", "fold", "翻折"],
        },
    }

    VISUAL_STYLE_DEFAULTS = {
        "draw_perpendicular_auxiliary": {
            "color": "BLUE",
            "dashed": True,
            "stroke_width": 3,
        },
        "draw_connection_auxiliary": {
            "color": "BLUE",
            "dashed": True,
            "stroke_width": 3,
        },
        "connect_center_tangent": {
            "color": "BLUE",
            "dashed": True,
            "stroke_width": 3,
        },
        "draw_parallel_auxiliary": {
            "color": "BLUE",
            "dashed": True,
            "stroke_width": 3,
        },
        "extend_segment": {
            "color": "BLUE",
            "dashed": True,
            "stroke_width": 3,
        },
    }

    def suggest(
        self,
        *,
        step_text: str,
        geometry_ir: Dict[str, Any],
        focus_targets: Sequence[str],
        problem_pattern: str = "",
        sub_pattern: str = "",
        script_auxiliary_actions: Optional[Sequence[Dict[str, Any]]] = None,
    ) -> List[Dict[str, Any]]:
        text = str(step_text or "")

        if script_auxiliary_actions:
            validated = []
            for action in script_auxiliary_actions:
                if not isinstance(action, dict):
                    continue
                validated_action = self._validate_and_enrich_script_action(action, geometry_ir, text)
                if validated_action:
                    validated.append(validated_action)
            if validated:
                return validated[:self.MAX_SUGGESTIONS]

        candidates = self._build_candidates(
            text=text,
            geometry_ir=geometry_ir,
            focus_targets=focus_targets,
            problem_pattern=problem_pattern,
            sub_pattern=sub_pattern,
        )
        if not candidates:
            return []

        scored: List[tuple] = []
        for item in candidates:
            score = self._score_candidate(
                candidate=item,
                step_text=text,
                problem_pattern=problem_pattern,
                sub_pattern=sub_pattern,
            )
            confidence = self._compute_confidence(item, score, text)
            item["confidence"] = confidence
            scored.append((score, item))

        scored.sort(key=lambda row: row[0], reverse=True)
        selected: List[Dict[str, Any]] = []
        for _, item in scored[: self.MAX_SUGGESTIONS]:
            selected.append(item)
        return selected

    def _validate_and_enrich_script_action(
        self,
        action: Dict[str, Any],
        geometry_ir: Dict[str, Any],
        step_text: str,
    ) -> Optional[Dict[str, Any]]:
        action_type = str(action.get("action") or "").strip()
        if not action_type:
            return None

        valid_actions = {
            "draw_perpendicular_auxiliary",
            "draw_connection_auxiliary",
            "connect_center_tangent",
            "draw_parallel_auxiliary",
            "extend_segment",
        }
        if action_type not in valid_actions:
            return None

        enriched = dict(action)
        enriched["id"] = str(action.get("id") or f"aux_{action_type[:4]}_{len(action)}").strip()

        if not enriched.get("persist"):
            enriched["persist"] = "until_step_end"

        style_defaults = self.VISUAL_STYLE_DEFAULTS.get(action_type, {})
        if "style" not in enriched:
            enriched["style"] = dict(style_defaults)
        else:
            merged_style = dict(style_defaults)
            merged_style.update(enriched.get("style") or {})
            enriched["style"] = merged_style

        score = self._score_candidate_from_script(action_type, action.get("reason", ""), step_text)
        enriched["confidence"] = self._compute_confidence(enriched, score, step_text)

        return enriched

    def _score_candidate_from_script(self, action: str, reason: str, step_text: str) -> float:
        score = 2.0
        if reason:
            scenario_config = self.SCENARIO_CONFIG.get(reason, {})
            if scenario_config:
                score += scenario_config.get("confidence_base", 0.5) * 2
        return score

    def _compute_confidence(self, candidate: Dict[str, Any], score: float, step_text: str) -> float:
        base_confidence = 0.5
        action = str(candidate.get("action", "")).strip()
        reason = str(candidate.get("reason", "")).strip()

        scenario_config = self.SCENARIO_CONFIG.get(reason, {})
        if scenario_config:
            base_confidence = scenario_config.get("confidence_base", 0.5)

        keyword_boost = 0.0
        keywords = scenario_config.get("keywords", [])
        for kw in keywords:
            if kw.lower() in step_text.lower():
                keyword_boost += 0.05
        keyword_boost = min(keyword_boost, 0.15)

        score_factor = min(score / 5.0, 0.2)

        confidence = base_confidence + keyword_boost + score_factor
        return round(min(confidence, 0.98), 2)

    def _build_candidates(
        self,
        *,
        text: str,
        geometry_ir: Dict[str, Any],
        focus_targets: Sequence[str],
        problem_pattern: str,
        sub_pattern: str,
    ) -> List[Dict[str, Any]]:
        suggestions: List[Dict[str, Any]] = []

        if self.DISTANCE_PATTERN.search(text):
            from_point = self._pick_point(focus_targets, geometry_ir)
            to_line = self._pick_segment(focus_targets, geometry_ir)
            if from_point and to_line:
                foot = self._generate_foot_label(from_point, to_line, geometry_ir)
                suggestions.append(
                    {
                        "action": "draw_perpendicular_auxiliary",
                        "id": f"aux_perp_{from_point}_to_{to_line}",
                        "from": from_point,
                        "to_line": to_line,
                        "foot": foot,
                        "reason": "point_to_line_distance",
                        "persist": "until_step_end",
                        "style": dict(self.VISUAL_STYLE_DEFAULTS["draw_perpendicular_auxiliary"]),
                    }
                )

        if self.ALTITUDE_PATTERN.search(text):
            from_point = self._pick_point(focus_targets, geometry_ir)
            to_line = self._pick_segment(focus_targets, geometry_ir)
            if from_point and to_line:
                foot = self._generate_foot_label(from_point, to_line, geometry_ir)
                suggestions.append(
                    {
                        "action": "draw_perpendicular_auxiliary",
                        "id": f"aux_alt_{from_point}_to_{to_line}",
                        "from": from_point,
                        "to_line": to_line,
                        "foot": foot,
                        "reason": "construct_altitude",
                        "persist": "until_video_end",
                        "style": dict(self.VISUAL_STYLE_DEFAULTS["draw_perpendicular_auxiliary"]),
                    }
                )

        if self.TANGENT_PATTERN.search(text):
            center = self._pick_center_point(geometry_ir)
            tangent_point = self._pick_point(focus_targets, geometry_ir)
            if center and tangent_point and center != tangent_point:
                suggestions.append(
                    {
                        "action": "connect_center_tangent",
                        "id": f"aux_tangent_{center}_{tangent_point}",
                        "from": center,
                        "to": tangent_point,
                        "reason": "tangent_radius",
                        "persist": "until_step_end",
                        "style": dict(self.VISUAL_STYLE_DEFAULTS["connect_center_tangent"]),
                    }
                )

        if self.SIMILAR_PATTERN.search(text):
            pair = self._pick_two_points(focus_targets, geometry_ir)
            if pair:
                suggestions.append(
                    {
                        "action": "draw_connection_auxiliary",
                        "id": f"aux_conn_{pair[0]}_{pair[1]}",
                        "from": pair[0],
                        "to": pair[1],
                        "reason": "prove_similar",
                        "persist": "until_step_end",
                        "style": dict(self.VISUAL_STYLE_DEFAULTS["draw_connection_auxiliary"]),
                    }
                )

        if self.PARALLEL_PATTERN.search(text):
            from_point = self._pick_point(focus_targets, geometry_ir)
            to_line = self._pick_segment(focus_targets, geometry_ir)
            if from_point and to_line:
                suggestions.append(
                    {
                        "action": "draw_parallel_auxiliary",
                        "id": f"aux_parallel_{from_point}_to_{to_line}",
                        "from": from_point,
                        "to_line": to_line,
                        "reason": "parallel_proportion",
                        "persist": "until_step_end",
                        "style": dict(self.VISUAL_STYLE_DEFAULTS["draw_parallel_auxiliary"]),
                    }
                )

        is_fold_step = bool(re.search(r"折叠|翻折|fold|reflect", text, re.IGNORECASE))
        if str(problem_pattern).strip() == "fold_transform" and is_fold_step and self.DISTANCE_PATTERN.search(text):
            image_point = self._pick_image_point(geometry_ir)
            fold_axis = str(geometry_ir.get("transform", {}).get("fold_axis", "")).strip()
            if image_point and fold_axis and str(sub_pattern).strip() in {
                "fold_with_perpendicular_construction",
                "fold_point_to_point_distance",
            }:
                foot = self._generate_foot_label(image_point, fold_axis, geometry_ir)
                suggestions.append(
                    {
                        "action": "draw_perpendicular_auxiliary",
                        "id": f"aux_fold_{image_point}_to_{fold_axis}",
                        "from": image_point,
                        "to_line": fold_axis,
                        "foot": foot,
                        "reason": "fold_image_distance",
                        "persist": "until_step_end",
                        "style": dict(self.VISUAL_STYLE_DEFAULTS["draw_perpendicular_auxiliary"]),
                    }
                )

        return suggestions

    def _generate_foot_label(self, from_point: str, to_line: str, geometry_ir: Dict[str, Any]) -> str:
        existing_points = set(geometry_ir.get("points", []))
        base_labels = ["H", "M", "N", "P", "Q", "R"]
        for label in base_labels:
            if label not in existing_points:
                return label
        return f"H_{from_point}"

    def _score_candidate(
        self,
        *,
        candidate: Dict[str, Any],
        step_text: str,
        problem_pattern: str,
        sub_pattern: str,
    ) -> float:
        action = str(candidate.get("action", "")).strip()
        reason = str(candidate.get("reason", "")).strip()
        score = 0.0

        if "distance" in str(step_text).lower() or "距离" in step_text or "垂线" in step_text:
            if action == "draw_perpendicular_auxiliary":
                score += 3.0

        if "高" in step_text or "高线" in step_text or "altitude" in step_text.lower():
            if action == "draw_perpendicular_auxiliary":
                score += 2.8

        if "tangent" in str(step_text).lower() or "切线" in step_text:
            if action == "connect_center_tangent":
                score += 3.0

        if "similar" in str(step_text).lower() or "全等" in step_text or "相似" in step_text:
            if action == "draw_connection_auxiliary":
                score += 2.4

        if "平行" in step_text or "parallel" in step_text.lower():
            if action == "draw_parallel_auxiliary":
                score += 2.5

        if str(problem_pattern).strip() == "fold_transform":
            if reason.startswith("fold"):
                score += 1.2
            if str(sub_pattern).strip() in {"fold_with_perpendicular_construction", "fold_point_to_point_distance"}:
                if action == "draw_perpendicular_auxiliary":
                    score += 1.8

        return score

    def _pick_point(self, focus_targets: Sequence[str], geometry_ir: Dict[str, Any]) -> str:
        points = set(geometry_ir.get("points", []))
        for target in focus_targets:
            if target in points:
                return target
        if points:
            return sorted(points)[0]
        return ""

    def _pick_two_points(self, focus_targets: Sequence[str], geometry_ir: Dict[str, Any]) -> Optional[List[str]]:
        points = [item for item in focus_targets if item in set(geometry_ir.get("points", []))]
        if len(points) >= 2:
            return [points[0], points[1]]
        all_points = sorted(set(geometry_ir.get("points", [])))
        if len(all_points) >= 2:
            return [all_points[0], all_points[1]]
        return None

    def _pick_segment(self, focus_targets: Sequence[str], geometry_ir: Dict[str, Any]) -> str:
        segment_ids = {item.get("id", "") for item in geometry_ir.get("segments", []) if isinstance(item, dict)}
        segment_labels = {item.get("label", "") for item in geometry_ir.get("segments", []) if isinstance(item, dict)}
        for target in focus_targets:
            if target in segment_ids or target in segment_labels:
                return target
        segments = geometry_ir.get("segments", [])
        if segments:
            first = segments[0]
            if isinstance(first, dict):
                return str(first.get("id") or first.get("label") or "")
        return ""

    def _pick_center_point(self, geometry_ir: Dict[str, Any]) -> str:
        for shape in geometry_ir.get("shapes", []):
            if not isinstance(shape, dict):
                continue
            if str(shape.get("type", "")).lower() == "circle":
                center = str(shape.get("center", "")).strip()
                if center:
                    return center
        return ""

    def _pick_image_point(self, geometry_ir: Dict[str, Any]) -> str:
        transform = geometry_ir.get("transform") if isinstance(geometry_ir.get("transform"), dict) else {}
        for pair in transform.get("image_pairs", []) or []:
            if not isinstance(pair, dict):
                continue
            image = str(pair.get("image", "")).strip()
            if image:
                return image
        return ""


class TeachingIRPlanner:
    """Produce dual-layer IR for geometry execution and teaching animation."""

    FOLD_PATTERN = re.compile(
        r"沿\s*([A-Z]\d*'?\s*[A-Z]\d*'?)\s*(?:折叠|翻折|对折)|关于\s*(?:直线)?\s*([A-Z]\d*'?\s*[A-Z]\d*'?)\s*(?:折叠|翻折|对折)?",
        re.IGNORECASE,
    )
    TRIANGLE_SUM_PATTERN = re.compile(
        r"三角形内角和|内角和|angle\s+sum|sum\s+of\s+angles",
        re.IGNORECASE,
    )
    PARALLEL_THEOREM_PATTERN = re.compile(
        r"平行线|内错角|同位角|同旁内角|parallel\s+lines?|alternate\s+interior|corresponding\s+angles?",
        re.IGNORECASE,
    )
    SIMILAR_THEOREM_PATTERN = re.compile(
        r"相似三角形|利用相似|证明相似|similar\s+triangles?|triangle\s+similarity",
        re.IGNORECASE,
    )
    CONGRUENT_THEOREM_PATTERN = re.compile(
        r"全等三角形|利用全等|证明全等|congruent\s+triangles?|triangle\s+congruence",
        re.IGNORECASE,
    )
    COSINE_THEOREM_PATTERN = re.compile(
        r"余弦定理|cosine\s+theorem|law\s+of\s+cosines?",
        re.IGNORECASE,
    )

    def __init__(self) -> None:
        self.aux_engine = AuxiliaryLineStrategyEngine()
        self.fold_templates = FoldActionTemplateLibrary()

    def build_geometry_ir(self, metadata: Dict[str, Any], problem_text: str) -> Dict[str, Any]:
        context = GeometryContext.from_metadata(metadata, problem_text=problem_text)
        points = list(context.points)
        segments = list(context.segments)
        shapes = list(context.shapes)
        templates = list(context.templates)
        problem_pattern_payload = context.problem_pattern
        pattern_name = str(problem_pattern_payload.get("problem_pattern", "")).strip()
        sub_pattern = str(problem_pattern_payload.get("sub_pattern", "")).strip()
        image_pairs = list(context.image_pairs)
        allow_scene_axis_inference = bool(
            re.search(r"折叠|翻折|对折|fold|reflect", str(problem_text or ""), re.IGNORECASE)
            or ("fold" in {item.lower() for item in templates})
            or pattern_name == "fold_transform"
        )
        fold_axis = self._detect_fold_axis(
            problem_text,
            segments,
            coordinate_scene=context.coordinate_scene,
            allow_scene_inference=allow_scene_axis_inference,
        )
        relations = list(context.relations)

        problem_type = self._classify_problem_type(problem_text, templates, fold_axis)
        pattern_problem_type = self._problem_type_from_pattern(pattern_name)
        if pattern_problem_type:
            problem_type = pattern_problem_type

        transform = {
            "fold_axis": fold_axis,
            "image_pairs": image_pairs,
            "invariants": [
                "equal_distance_to_fold_axis",
                "equal_corresponding_angles",
                "axis_is_perpendicular_bisector",
            ]
            if fold_axis
            else [],
        }

        return {
            "version": "v1",
            "problem_type": problem_type,
            "problem_pattern": pattern_name,
            "sub_pattern": sub_pattern,
            "points": points,
            "segments": segments,
            "shapes": shapes,
            "relations": relations,
            "templates": sorted(set(templates)),
            "transform": transform,
            "coordinate_model_trace": copy.deepcopy(
                context.coordinate_scene.get("coordinate_model_trace")
                if isinstance(context.coordinate_scene, dict)
                else {}
            ),
        }

    def build_teaching_ir(
        self,
        *,
        steps: Sequence[Any],
        geometry_ir: Dict[str, Any],
        metadata: Optional[Dict[str, Any]] = None,
        problem_text: str = "",
    ) -> Dict[str, Any]:
        problem_type = str(geometry_ir.get("problem_type", "geometry_static"))
        problem_pattern = str(geometry_ir.get("problem_pattern", "")).strip()
        sub_pattern = str(geometry_ir.get("sub_pattern", "")).strip()
        all_targets = self._all_entity_targets(geometry_ir)
        fold_axis = str(geometry_ir.get("transform", {}).get("fold_axis", "")).strip()
        image_pairs = list(geometry_ir.get("transform", {}).get("image_pairs", []))
        extra_geometry_hints = self._resolve_extra_geometry_hints(
            metadata=metadata or {},
            geometry_ir=geometry_ir,
            problem_type=problem_type,
        )
        coordinate_trace_items = self._coordinate_model_trace_items(geometry_ir)

        step_payloads: List[Dict[str, Any]] = []
        fold_executed = False
        main_fold_step_id = None

        # 计算 moving_part 和 fixed_part
        moving_part, fixed_part = self._compute_fold_parts(
            image_pairs=image_pairs,
            geometry_ir=geometry_ir,
        )

        for index, step in enumerate(steps, start=1):
            step_id = self._safe_step_id(getattr(step, "id", index), index)
            title = str(getattr(step, "title", "") or "")
            narration = str(getattr(step, "narration", "") or "")
            visual_cues = list(getattr(step, "visual_cues", []) or [])
            spoken_formulas = self._normalize_string_list(getattr(step, "spoken_formulas", []) or [])
            visible_segments = self._normalize_string_list(getattr(step, "visible_segments", []) or [])
            required_actions = self._normalize_required_actions(getattr(step, "required_actions", []) or [])
            animation_policy = self._normalize_animation_policy(
                getattr(step, "animation_policy", "auto")
            )
            step_text = "\n".join([title, narration, " ".join(str(item) for item in visual_cues)])

            focus_targets = self._extract_focus_targets(step_text, all_targets)
            actions: List[Dict[str, Any]] = []

            if index == 1:
                actions.append({"action": "show_original_figure"})

            if focus_targets:
                actions.append(
                    {
                        "action": "highlight_entity",
                        "targets": focus_targets,
                    }
                )

            if animation_policy != "none":
                actions.extend(required_actions)

            # 判断是否是折叠步骤
            is_fold_step = (
                animation_policy == "auto"
                and problem_type == "fold_transform"
                and fold_axis
                and self._is_fold_step(step_text, index)
            )

            if is_fold_step:
                actions.extend(
                    self.fold_templates.build_actions(
                        sub_pattern=sub_pattern,
                        fold_axis=fold_axis,
                        focus_targets=focus_targets,
                        image_pairs=image_pairs,
                        step_text=step_text,
                        is_fold_step=True,
                    )
                )

            if animation_policy == "auto":
                actions.extend(
                    self.aux_engine.suggest(
                        step_text=step_text,
                        geometry_ir=geometry_ir,
                        focus_targets=focus_targets,
                        problem_pattern=problem_pattern,
                        sub_pattern=sub_pattern,
                    )
                )
                actions.extend(
                    self._actions_from_extra_geometry_hints(
                        step_text=step_text,
                        step_index=index,
                        focus_targets=focus_targets,
                        geometry_ir=geometry_ir,
                        fold_axis=fold_axis,
                        hints=extra_geometry_hints,
                    )
                )

            theorem_hints = self._infer_theorem_hints(
                step_text=step_text,
                geometry_ir=geometry_ir,
                focus_targets=focus_targets,
            )
            if theorem_hints:
                actions.extend(self._actions_from_theorem_hints(theorem_hints))
                spoken_formulas = self._merge_theorem_formulas(spoken_formulas, theorem_hints)

            if index == 1 and coordinate_trace_items:
                spoken_formulas = self._merge_coordinate_trace_formulas(
                    spoken_formulas,
                    coordinate_trace_items,
                )

            if animation_policy in {"auto", "required"} and self._contains_relation_words(step_text):
                actions.append(
                    {
                        "action": "highlight_relation",
                        "targets": focus_targets,
                    }
                )

            if not actions:
                actions.append({"action": "maintain_scene"})

            # 去重动作
            actions = self._dedupe_actions(actions)

            # 检查是否包含 animate_fold
            has_animate_fold = any(
                str(a.get("action", "")).strip() == "animate_fold"
                for a in actions
                if isinstance(a, dict)
            )

            # 构建 fold_execution 信息
            fold_execution: Dict[str, Any] = {
                "is_fold_step": is_fold_step and has_animate_fold,
                "allow_refold": False,  # 默认不允许重新折叠
            }

            if has_animate_fold:
                if not fold_executed:
                    fold_executed = True
                    main_fold_step_id = step_id
                    fold_execution["is_main_fold"] = True
                    # 在主折叠步骤添加 moving_part
                    fold_execution["moving_part"] = list(moving_part)
                    fold_execution["fixed_part"] = list(fixed_part)
                else:
                    fold_execution["is_main_fold"] = False
                    fold_execution["fold_executed_before"] = True
                    # 如果不是主折叠，从 actions 中移除 animate_fold
                    actions = [
                        a for a in actions
                        if not (isinstance(a, dict) and str(a.get("action", "")).strip() == "animate_fold")
                    ]
                    # 同时移除相关的折叠动作
                    actions = [
                        a for a in actions
                        if not (isinstance(a, dict) and str(a.get("action", "")).strip() in {
                            "highlight_fold_axis", "create_image_point", "show_fold_invariants"
                        })
                    ]

            step_payloads.append(
                {
                    "step_id": step_id,
                    "title": title,
                    "focus_targets": focus_targets,
                    "actions": actions,
                    "spoken_formulas": spoken_formulas,
                    "visible_segments": visible_segments,
                    "required_actions": required_actions,
                    "animation_policy": animation_policy,
                    "theorem_hints": theorem_hints,
                    "fold_execution": fold_execution,
                }
            )

        # 构建完整的 fold_plan
        fold_plan: Dict[str, Any] = {}
        if problem_type == "fold_transform" and fold_axis:
            fold_plan = {
                "axis": fold_axis,
                "moving_part": list(moving_part),
                "fixed_part": list(fixed_part),
                "image_pairs": image_pairs,
                "main_fold_step_id": main_fold_step_id,
            }

        return {
            "version": "v1",
            "problem_type": problem_type,
            "problem_pattern": problem_pattern,
            "sub_pattern": sub_pattern,
            "steps": step_payloads,
            "global": {
                "fold_axis": fold_axis,
                "image_pairs": image_pairs,
                "fold_plan": fold_plan,
                "coordinate_model_trace": copy.deepcopy(
                    geometry_ir.get("coordinate_model_trace")
                    if isinstance(geometry_ir.get("coordinate_model_trace"), dict)
                    else {}
                ),
                "problem_text": str(problem_text or "")[:200],
            },
        }

    def _coordinate_model_trace_items(
        self,
        geometry_ir: Dict[str, Any],
    ) -> List[str]:
        trace = (
            geometry_ir.get("coordinate_model_trace")
            if isinstance(geometry_ir.get("coordinate_model_trace"), dict)
            else {}
        )
        if str(trace.get("source", "")).strip() == "pixel_anchor_fallback":
            return []
        items: List[str] = []
        for item in trace.get("items") or []:
            if not isinstance(item, dict):
                continue
            text = str(item.get("text", "")).strip()
            if text:
                items.append(text)
        return items

    def _merge_coordinate_trace_formulas(
        self,
        spoken_formulas: Sequence[str],
        coordinate_trace_items: Sequence[str],
    ) -> List[str]:
        merged = [str(item).strip() for item in (spoken_formulas or []) if str(item).strip()]
        for item in coordinate_trace_items:
            token = str(item).strip()
            if not token or token in merged:
                continue
            merged.append(token)
            if len(merged) >= 6:
                break
        return merged

    def _resolve_extra_geometry_hints(
        self,
        *,
        metadata: Dict[str, Any],
        geometry_ir: Dict[str, Any],
        problem_type: str,
    ) -> Dict[str, Any]:
        vision_signals = (
            metadata.get("vision_semantic_signals")
            if isinstance(metadata.get("vision_semantic_signals"), dict)
            else {}
        )
        pattern_payload = (
            metadata.get("problem_pattern")
            if isinstance(metadata.get("problem_pattern"), dict)
            else {}
        )

        recommended_actions: List[str] = []
        for action in vision_signals.get("recommended_geometry_actions", []) or []:
            token = str(action).strip()
            if token:
                recommended_actions.append(token)
        for action in pattern_payload.get("recommended_geometry_actions", []) or []:
            token = str(action).strip()
            if token:
                recommended_actions.append(token)
        recommended_actions = list(dict.fromkeys(recommended_actions))

        requires_extra = bool(
            vision_signals.get("needs_extra_geometry_animation", False)
            or pattern_payload.get("requires_geometry_animation", False)
            or (problem_type == "fold_transform")
        )
        return {
            "requires_extra": requires_extra,
            "recommended_actions": recommended_actions,
        }

    def _actions_from_extra_geometry_hints(
        self,
        *,
        step_text: str,
        step_index: int,
        focus_targets: Sequence[str],
        geometry_ir: Dict[str, Any],
        fold_axis: str,
        hints: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        if not hints.get("requires_extra"):
            return []

        actions: List[Dict[str, Any]] = []
        suggested = {
            str(item).strip()
            for item in (hints.get("recommended_actions") or [])
            if str(item).strip()
        }
        has_relation_words = self._contains_relation_words(step_text)
        has_distance_signal = bool(re.search(r"距离|垂线|perpendicular|distance", step_text, re.IGNORECASE))
        has_similarity_signal = bool(re.search(r"相似|全等|similar|congruent", step_text, re.IGNORECASE))

        # 只有在明确的折叠步骤中才添加折叠动作
        is_fold_step = self._is_fold_step(step_text, step_index)

        if "animate_fold" in suggested and fold_axis and is_fold_step:
            actions.append({"action": "highlight_fold_axis", "axis": fold_axis})
            actions.append(
                {
                    "action": "animate_fold",
                    "axis": fold_axis,
                    "targets": list(focus_targets or []),
                }
            )

        # 只有在有距离信号时才添加垂线辅助线
        if "draw_perpendicular_auxiliary" in suggested and has_distance_signal:
            from_point = self.aux_engine._pick_point(focus_targets, geometry_ir)
            to_line = fold_axis or self.aux_engine._pick_segment(focus_targets, geometry_ir)
            if from_point and to_line:
                actions.append(
                    {
                        "action": "draw_perpendicular_auxiliary",
                        "from": from_point,
                        "to_line": to_line,
                        "reason": "vision_semantic_hint",
                    }
                )

        if "draw_connection_auxiliary" in suggested and (has_relation_words or has_similarity_signal):
            pair = self.aux_engine._pick_two_points(focus_targets, geometry_ir)
            if pair:
                actions.append(
                    {
                        "action": "draw_connection_auxiliary",
                        "from": pair[0],
                        "to": pair[1],
                        "reason": "vision_semantic_hint",
                    }
                )

        if "connect_center_tangent" in suggested and (
            ("切线" in step_text) or ("tangent" in step_text.lower())
        ):
            center = self.aux_engine._pick_center_point(geometry_ir)
            tangent_point = self.aux_engine._pick_point(focus_targets, geometry_ir)
            if center and tangent_point and center != tangent_point:
                actions.append(
                    {
                        "action": "connect_center_tangent",
                        "from": center,
                        "to": tangent_point,
                        "reason": "vision_semantic_hint",
                    }
                )

        return actions

    def _infer_theorem_hints(
        self,
        *,
        step_text: str,
        geometry_ir: Dict[str, Any],
        focus_targets: Sequence[str],
    ) -> List[Dict[str, Any]]:
        text = str(step_text or "")
        hints: List[Dict[str, Any]] = []

        triangle_targets = self._resolve_triangle_targets(
            focus_targets=focus_targets,
            geometry_ir=geometry_ir,
        )

        if self.TRIANGLE_SUM_PATTERN.search(text) and len(triangle_targets) >= 3:
            points = triangle_targets[:3]
            hints.append(
                {
                    "theorem": "triangle_angle_sum",
                    "source_theorem_ids": [1, 2],
                    "targets": points,
                    "relation_targets": points,
                    "formula_hints": [f"∠{points[0]} + ∠{points[1]} + ∠{points[2]} = 180°"],
                }
            )

        if self.PARALLEL_THEOREM_PATTERN.search(text):
            parallel_relation = self._pick_relation_by_type(
                geometry_ir=geometry_ir,
                relation_type="parallel",
                focus_targets=focus_targets,
            )
            parallel_targets = self._relation_visual_targets(parallel_relation, geometry_ir)
            if len(parallel_targets) >= 2:
                hints.append(
                    {
                        "theorem": "parallel_lines",
                        "source_theorem_ids": [10],
                        "targets": parallel_targets,
                        "relation_targets": parallel_targets,
                        "formula_hints": ["平行线性质：内错角相等，同位角相等"],
                    }
                )

        if self.SIMILAR_THEOREM_PATTERN.search(text):
            similar_relation = self._pick_relation_by_type(
                geometry_ir=geometry_ir,
                relation_type="similar",
                focus_targets=focus_targets,
            )
            similar_targets = self._relation_visual_targets(similar_relation, geometry_ir)
            similar_formula = self._relation_formula_hint(
                similar_relation,
                fallback="相似三角形：对应角相等，对应边成比例",
                relation_mark="∼",
            )
            if len(similar_targets) >= 3:
                hints.append(
                    {
                        "theorem": "similar_triangles",
                        "source_theorem_ids": [14],
                        "targets": similar_targets,
                        "relation_targets": similar_targets,
                        "formula_hints": [similar_formula],
                    }
                )

        if self.CONGRUENT_THEOREM_PATTERN.search(text):
            congruent_relation = self._pick_relation_by_type(
                geometry_ir=geometry_ir,
                relation_type="congruent",
                focus_targets=focus_targets,
            )
            congruent_targets = self._relation_visual_targets(congruent_relation, geometry_ir)
            congruent_formula = self._relation_formula_hint(
                congruent_relation,
                fallback="全等三角形：对应边相等，对应角相等",
                relation_mark="≅",
            )
            if len(congruent_targets) >= 3:
                hints.append(
                    {
                        "theorem": "congruent_triangles",
                        "source_theorem_ids": [5, 6],
                        "targets": congruent_targets,
                        "relation_targets": congruent_targets,
                        "formula_hints": [congruent_formula],
                    }
                )

        if self.COSINE_THEOREM_PATTERN.search(text) and len(triangle_targets) >= 3:
            points = triangle_targets[:3]
            hints.append(
                {
                    "theorem": "cosine_theorem",
                    "source_theorem_ids": [16],
                    "targets": points,
                    "relation_targets": points,
                    "formula_hints": [
                        (
                            f"{points[1]}{points[2]}^2 = {points[0]}{points[1]}^2 + "
                            f"{points[0]}{points[2]}^2 - 2*{points[0]}{points[1]}*"
                            f"{points[0]}{points[2]}*cos∠{points[0]}"
                        )
                    ],
                }
            )

        return hints

    def _actions_from_theorem_hints(
        self,
        theorem_hints: Sequence[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        actions: List[Dict[str, Any]] = []
        for hint in theorem_hints or []:
            if not isinstance(hint, dict):
                continue
            entity_targets = [
                str(item).strip()
                for item in (hint.get("targets") or [])
                if str(item).strip()
            ]
            relation_targets = [
                str(item).strip()
                for item in (hint.get("relation_targets") or [])
                if str(item).strip()
            ]
            if entity_targets:
                actions.append({"action": "highlight_entity", "targets": entity_targets})
            if relation_targets:
                actions.append({"action": "highlight_relation", "targets": relation_targets})
        return actions

    def _merge_theorem_formulas(
        self,
        spoken_formulas: Sequence[str],
        theorem_hints: Sequence[Dict[str, Any]],
    ) -> List[str]:
        merged = [
            str(item).strip()
            for item in (spoken_formulas or [])
            if str(item).strip()
        ]
        seen = set(merged)
        for hint in theorem_hints or []:
            if not isinstance(hint, dict):
                continue
            for formula in hint.get("formula_hints") or []:
                token = str(formula).strip()
                if not token or token in seen:
                    continue
                seen.add(token)
                merged.append(token)
        return merged

    def _pick_relation_by_type(
        self,
        *,
        geometry_ir: Dict[str, Any],
        relation_type: str,
        focus_targets: Sequence[str],
    ) -> Optional[Dict[str, Any]]:
        desired = str(relation_type or "").strip().lower()
        if not desired:
            return None

        focus_set = {str(item).strip() for item in (focus_targets or []) if str(item).strip()}
        best_match: Optional[Dict[str, Any]] = None
        best_score = -1
        for relation in geometry_ir.get("relations", []) or []:
            if not isinstance(relation, dict):
                continue
            if str(relation.get("type", "")).strip().lower() != desired:
                continue
            relation_targets = self._relation_visual_targets(relation, geometry_ir)
            score = len(focus_set.intersection(relation_targets))
            if score > best_score:
                best_match = relation
                best_score = score
        return best_match

    def _relation_visual_targets(
        self,
        relation: Optional[Dict[str, Any]],
        geometry_ir: Dict[str, Any],
    ) -> List[str]:
        if not isinstance(relation, dict):
            return []

        all_targets = set(self._all_entity_targets(geometry_ir))
        segment_ids = {
            str(item.get("id", "")).strip()
            for item in (geometry_ir.get("segments") or [])
            if isinstance(item, dict)
        }
        segment_labels = {
            str(item.get("label", "")).strip()
            for item in (geometry_ir.get("segments") or [])
            if isinstance(item, dict)
        }
        point_ids = {
            str(item).strip()
            for item in (geometry_ir.get("points") or [])
            if str(item).strip()
        }

        candidates: List[str] = []
        for key in ("entities", "segments", "lines", "polygons", "triangles"):
            for item in relation.get(key) or []:
                candidates.extend(
                    self._expand_relation_token(
                        token=item,
                        all_targets=all_targets,
                        point_ids=point_ids,
                        segment_ids=segment_ids,
                        segment_labels=segment_labels,
                    )
                )

        for key in ("line", "segment", "polygon", "triangle", "point", "circle"):
            token = relation.get(key)
            if token:
                candidates.extend(
                    self._expand_relation_token(
                        token=token,
                        all_targets=all_targets,
                        point_ids=point_ids,
                        segment_ids=segment_ids,
                        segment_labels=segment_labels,
                    )
                )

        seen: Set[str] = set()
        result: List[str] = []
        for item in candidates:
            token = str(item).strip()
            if not token or token in seen:
                continue
            seen.add(token)
            result.append(token)
        return result

    def _expand_relation_token(
        self,
        *,
        token: Any,
        all_targets: Set[str],
        point_ids: Set[str],
        segment_ids: Set[str],
        segment_labels: Set[str],
    ) -> List[str]:
        value = str(token or "").strip()
        if not value:
            return []

        if value in all_targets:
            return [value]

        upper_value = value.upper()
        seg_id = f"seg_{upper_value}"
        if seg_id in segment_ids:
            return [seg_id]
        if upper_value in segment_labels:
            return [upper_value]

        point_tokens = re.findall(r"[A-Z]\d*'?", upper_value)
        expanded: List[str] = [item for item in point_tokens if item in point_ids]
        if len(point_tokens) >= 2:
            for left, right in zip(point_tokens, point_tokens[1:]):
                segment_token = f"{left}{right}"
                reverse_segment_token = f"{right}{left}"
                if segment_token in segment_labels:
                    expanded.append(segment_token)
                elif reverse_segment_token in segment_labels:
                    expanded.append(reverse_segment_token)
                elif f"seg_{segment_token}" in segment_ids:
                    expanded.append(f"seg_{segment_token}")
                elif f"seg_{reverse_segment_token}" in segment_ids:
                    expanded.append(f"seg_{reverse_segment_token}")
            if len(point_tokens) >= 3:
                closing_segment = f"{point_tokens[-1]}{point_tokens[0]}"
                reverse_closing_segment = f"{point_tokens[0]}{point_tokens[-1]}"
                if closing_segment in segment_labels:
                    expanded.append(closing_segment)
                elif reverse_closing_segment in segment_labels:
                    expanded.append(reverse_closing_segment)
                elif f"seg_{closing_segment}" in segment_ids:
                    expanded.append(f"seg_{closing_segment}")
                elif f"seg_{reverse_closing_segment}" in segment_ids:
                    expanded.append(f"seg_{reverse_closing_segment}")
        return expanded

    def _relation_formula_hint(
        self,
        relation: Optional[Dict[str, Any]],
        *,
        fallback: str,
        relation_mark: str,
    ) -> str:
        if not isinstance(relation, dict):
            return fallback

        polygon_like = relation.get("polygons") or relation.get("triangles") or []
        if isinstance(polygon_like, list) and len(polygon_like) >= 2:
            left = str(polygon_like[0]).strip()
            right = str(polygon_like[1]).strip()
            if left and right:
                return f"△{left} {relation_mark} △{right}"
        return fallback

    def _resolve_triangle_targets(
        self,
        *,
        focus_targets: Sequence[str],
        geometry_ir: Dict[str, Any],
    ) -> List[str]:
        point_ids = {
            str(item).strip()
            for item in (geometry_ir.get("points") or [])
            if str(item).strip()
        }
        direct_points = [
            str(item).strip()
            for item in (focus_targets or [])
            if str(item).strip() in point_ids
        ]
        if len(direct_points) >= 3:
            return list(dict.fromkeys(direct_points))[:3]

        expanded_points: List[str] = []
        for token in focus_targets or []:
            for point in re.findall(r"[A-Z]\d*'?", str(token or "").upper()):
                if point in point_ids:
                    expanded_points.append(point)
        expanded_points = list(dict.fromkeys(expanded_points))
        if len(expanded_points) >= 3:
            return expanded_points[:3]

        triangle_shapes = [
            item
            for item in (geometry_ir.get("shapes") or [])
            if isinstance(item, dict)
            and str(item.get("type", "")).strip().lower() == "polygon"
            and len(item.get("points") or []) == 3
        ]
        if triangle_shapes:
            points = [
                str(item).strip()
                for item in (triangle_shapes[0].get("points") or [])
                if str(item).strip() in point_ids
            ]
            if len(points) >= 3:
                return points[:3]

        return expanded_points[:3]

    def get_step_plan(
        self,
        teaching_ir: Optional[Dict[str, Any]],
        *,
        step_id: Any,
        fallback_index: int,
    ) -> Dict[str, Any]:
        if not isinstance(teaching_ir, dict):
            return {"step_id": self._safe_step_id(step_id, fallback_index), "focus_targets": [], "actions": []}

        normalized_step_id = self._safe_step_id(step_id, fallback_index)
        for item in teaching_ir.get("steps", []) or []:
            if not isinstance(item, dict):
                continue
            if self._safe_step_id(item.get("step_id"), -1) == normalized_step_id:
                return item

        steps = [item for item in (teaching_ir.get("steps", []) or []) if isinstance(item, dict)]
        if 0 < fallback_index <= len(steps):
            return steps[fallback_index - 1]

        return {"step_id": normalized_step_id, "focus_targets": [], "actions": []}

    def _collect_points(self, drawable_scene: Dict[str, Any], semantic_graph: Dict[str, Any], geometry_facts: Dict[str, Any]) -> List[str]:
        points: List[str] = []
        drawable_points = drawable_scene.get("points")
        if isinstance(drawable_points, dict):
            points.extend(str(item).strip() for item in drawable_points.keys())
        elif isinstance(drawable_points, list):
            points.extend(
                str(item.get("id", "")).strip()
                for item in drawable_points
                if isinstance(item, dict)
            )

        semantic_points = semantic_graph.get("points")
        if isinstance(semantic_points, dict):
            points.extend(str(item).strip() for item in semantic_points.keys())
        elif isinstance(semantic_points, list):
            points.extend(
                str(item.get("id", "")).strip()
                for item in semantic_points
                if isinstance(item, dict)
            )

        points.extend(str(item).strip() for item in (geometry_facts.get("points") or []) if str(item).strip())
        return sorted({item for item in points if item})

    def _collect_segments(self, drawable_scene: Dict[str, Any], semantic_graph: Dict[str, Any], geometry_facts: Dict[str, Any]) -> List[Dict[str, Any]]:
        segments: List[Dict[str, Any]] = []
        primitives = list(drawable_scene.get("primitives") or []) + list(semantic_graph.get("primitives") or [])
        for primitive in primitives:
            if not isinstance(primitive, dict):
                continue
            if str(primitive.get("type", "")).strip().lower() != "segment":
                continue
            segment_id = str(primitive.get("id", "")).strip()
            refs = [str(item).strip() for item in (primitive.get("points") or []) if str(item).strip()]
            label = "".join(refs) if len(refs) == 2 else segment_id
            segments.append({"id": segment_id, "label": label, "points": refs})

        for token in geometry_facts.get("segments") or []:
            label = str(token).strip().replace("seg_", "")
            if not label:
                continue
            segment_id = f"seg_{label}"
            segments.append({"id": segment_id, "label": label, "points": self._split_segment_points(label)})

        unique: Dict[str, Dict[str, Any]] = {}
        for item in segments:
            key = str(item.get("id") or item.get("label") or "").strip()
            if not key:
                continue
            unique[key] = item
        return sorted(unique.values(), key=lambda item: str(item.get("id", "")))

    def _collect_shapes(self, drawable_scene: Dict[str, Any], semantic_graph: Dict[str, Any]) -> List[Dict[str, Any]]:
        shapes: List[Dict[str, Any]] = []
        primitives = list(drawable_scene.get("primitives") or []) + list(semantic_graph.get("primitives") or [])
        for primitive in primitives:
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

    def _collect_relations(self, metadata: Dict[str, Any]) -> List[Dict[str, Any]]:
        relations: List[Dict[str, Any]] = []
        geometry_spec = metadata.get("geometry_spec") if isinstance(metadata.get("geometry_spec"), dict) else {}
        for item in geometry_spec.get("constraints") or []:
            if not isinstance(item, dict):
                continue
            relations.append(
                {
                    "type": str(item.get("type", "")).strip().lower(),
                    "entities": [str(entity).strip() for entity in (item.get("entities") or []) if str(entity).strip()],
                }
            )
        return relations

    def _extract_image_pairs(
        self,
        drawable_scene: Dict[str, Any],
        *,
        coordinate_scene: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, str]]:
        pairs: List[Dict[str, str]] = []

        def _append_pairs_from_points(points_payload: Any) -> None:
            if not isinstance(points_payload, list):
                return
            for item in points_payload:
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

        points = drawable_scene.get("points")
        _append_pairs_from_points(points)
        if isinstance(coordinate_scene, dict):
            _append_pairs_from_points(coordinate_scene.get("points"))

        if not pairs:
            point_ids: Set[str] = set()
            if isinstance(points, dict):
                point_ids.update(str(item).strip() for item in points.keys())
            elif isinstance(points, list):
                point_ids.update(
                    str(item.get("id", "")).strip()
                    for item in points
                    if isinstance(item, dict)
                )
            for point_id in sorted(item for item in point_ids if item):
                match = re.fullmatch(r"([A-Z])1", point_id)
                if not match:
                    continue
                source = match.group(1)
                if source in point_ids:
                    pairs.append({"source": source, "image": point_id})

        dedup: Dict[str, Dict[str, str]] = {}
        for pair in pairs:
            key = f"{pair.get('source', '')}->{pair.get('image', '')}"
            dedup[key] = pair
        return list(dedup.values())

    def _detect_fold_axis(
        self,
        problem_text: str,
        segments: Sequence[Dict[str, Any]],
        *,
        coordinate_scene: Optional[Dict[str, Any]] = None,
        allow_scene_inference: bool = False,
    ) -> str:
        label_to_id: Dict[str, str] = {}
        for segment in segments:
            if not isinstance(segment, dict):
                continue
            seg_id = str(segment.get("id", "")).strip()
            seg_label = str(segment.get("label", "")).strip().replace(" ", "")
            if seg_label:
                label_to_id[seg_label.upper()] = seg_id or seg_label
            if seg_id:
                label_to_id[seg_id.upper()] = seg_id

        text = str(problem_text or "")
        if text:
            for match in self.FOLD_PATTERN.finditer(text):
                raw = (match.group(1) or match.group(2) or "").strip().replace(" ", "")
                resolved = self._resolve_axis_token(raw, label_to_id)
                if resolved:
                    return resolved

        # OCR 可能漏掉“沿XX折叠”，此时从 coordinate_scene 的 reflect_point 轴信息回推。
        if allow_scene_inference and isinstance(coordinate_scene, dict):
            for point in coordinate_scene.get("points", []) or []:
                if not isinstance(point, dict):
                    continue
                derived = point.get("derived")
                if not isinstance(derived, dict):
                    continue
                if str(derived.get("type", "")).strip().lower() != "reflect_point":
                    continue
                axis_refs = [str(item).strip() for item in (derived.get("axis") or []) if str(item).strip()]
                if len(axis_refs) < 2:
                    continue
                axis_token = f"{axis_refs[0]}{axis_refs[1]}"
                resolved = self._resolve_axis_token(axis_token, label_to_id)
                if resolved:
                    return resolved

        return ""

    def _resolve_axis_token(self, raw: str, label_to_id: Dict[str, str]) -> str:
        token = str(raw or "").strip().replace(" ", "")
        if not token:
            return ""
        upper_token = token.upper()
        if upper_token in label_to_id:
            return label_to_id[upper_token]
        prefixed = f"SEG_{upper_token}"
        if prefixed in label_to_id:
            return label_to_id[prefixed]

        refs = self._split_segment_points(upper_token)
        if len(refs) == 2:
            reversed_token = f"{refs[1]}{refs[0]}"
            if reversed_token in label_to_id:
                return label_to_id[reversed_token]
            reversed_prefixed = f"SEG_{reversed_token}"
            if reversed_prefixed in label_to_id:
                return label_to_id[reversed_prefixed]

        return f"seg_{upper_token}"

    def _classify_problem_type(self, problem_text: str, templates: Sequence[str], fold_axis: str) -> str:
        text = str(problem_text or "").lower()
        template_set = {str(item).strip().lower() for item in templates}
        if fold_axis or "fold" in template_set or "折叠" in text or "翻折" in text:
            return "fold_transform"
        if "旋转" in text or "rotation" in text:
            return "rotation_transform"
        if "平移" in text or "translation" in text:
            return "translation_transform"
        return "geometry_static"

    def _problem_type_from_pattern(self, pattern_name: str) -> str:
        mapping = {
            "fold_transform": "fold_transform",
            "dynamic_point": "geometry_static",
            "metric_computation": "geometry_static",
            "similarity_congruence": "geometry_static",
            "circle_geometry": "geometry_static",
            "solid_geometry_section": "geometry_static",
            "static_proof": "geometry_static",
        }
        return mapping.get(str(pattern_name or "").strip(), "")

    def _extract_focus_targets(self, step_text: str, all_targets: Sequence[str]) -> List[str]:
        upper_text = str(step_text or "").upper()
        matched: List[str] = []
        for target in all_targets:
            token = str(target).strip()
            if not token:
                continue
            pattern = rf"(?<![A-Z0-9_']){re.escape(token.upper())}(?![A-Z0-9_'])"
            if re.search(pattern, upper_text):
                matched.append(token)
        return sorted(set(matched))

    def _all_entity_targets(self, geometry_ir: Dict[str, Any]) -> List[str]:
        targets: Set[str] = set(geometry_ir.get("points", []))
        for segment in geometry_ir.get("segments", []):
            if not isinstance(segment, dict):
                continue
            seg_id = str(segment.get("id", "")).strip()
            seg_label = str(segment.get("label", "")).strip()
            if seg_id:
                targets.add(seg_id)
            if seg_label:
                targets.add(seg_label)
        for shape in geometry_ir.get("shapes", []):
            if not isinstance(shape, dict):
                continue
            shape_id = str(shape.get("id", "")).strip()
            if shape_id:
                targets.add(shape_id)
        return sorted(item for item in targets if item)

    def _contains_relation_words(self, step_text: str) -> bool:
        text = str(step_text or "")
        return bool(
            re.search(r"垂直|平行|相等|全等|相似|perpendicular|parallel|equal|congruent|similar", text, re.IGNORECASE)
        )

    def _is_fold_step(self, step_text: str, index: int) -> bool:
        text = str(step_text or "")
        
        # 检查是否包含折叠关键词
        has_fold_keyword = bool(re.search(r"折叠|翻折|对称|对应点|镜像|fold|reflect", text, re.IGNORECASE))
        
        if not has_fold_keyword:
            return False
        
        # 排除否定语境
        suppress_patterns = [
            r"不执行折叠",
            r"不折叠",
            r"仅观察",
            r"先观察",
            r"仅高亮",
            r"只高亮",
            r"不翻折",
        ]
        
        for pattern in suppress_patterns:
            if re.search(pattern, text, re.IGNORECASE):
                return False
        
        # 如果只提到"折叠轴"而没有执行折叠的关键词，通常只是讲解/识别步骤
        if "折叠轴" in text and not re.search(r"沿|折叠后|翻折后|得到|执行|得到像点", text, re.IGNORECASE):
            return False
        
        return True

    def _split_segment_points(self, label: str) -> List[str]:
        refs = re.findall(r"[A-Z]\d*'?", str(label or "").upper())
        return refs[:2] if len(refs) >= 2 else []

    def _safe_step_id(self, raw: Any, fallback: int) -> int:
        if isinstance(raw, int):
            return raw
        try:
            return int(raw)
        except (TypeError, ValueError):
            pass
        match = re.search(r"\d+", str(raw or ""))
        if match:
            return int(match.group(0))
        return fallback

    def _dedupe_actions(self, actions: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
        seen: Set[str] = set()
        unique: List[Dict[str, Any]] = []
        for item in actions:
            if not isinstance(item, dict):
                continue
            key = self._action_key(item)
            if key in seen:
                continue
            seen.add(key)
            unique.append(item)
        return unique

    def _normalize_string_list(self, value: Any) -> List[str]:
        if isinstance(value, str):
            token = value.strip()
            return [token] if token else []
        if not isinstance(value, list):
            return []
        result: List[str] = []
        for item in value:
            token = str(item).strip()
            if token:
                result.append(token)
        return list(dict.fromkeys(result))

    def _normalize_animation_policy(self, value: Any) -> str:
        policy = str(value or "auto").strip().lower()
        if policy in {"auto", "required", "none"}:
            return policy
        return "auto"

    def _normalize_required_actions(self, value: Any) -> List[Dict[str, Any]]:
        if not isinstance(value, list):
            return []

        normalized: List[Dict[str, Any]] = []
        for item in value:
            if not isinstance(item, dict):
                continue

            action_type = str(item.get("action") or item.get("type") or "").strip().lower()
            if not action_type:
                continue

            target = str(item.get("target", "")).strip()
            targets = [
                str(token).strip()
                for token in (item.get("targets") or [])
                if str(token).strip()
            ]
            if target and target not in targets:
                targets.insert(0, target)

            if action_type in {"show_point", "show_segment", "show_auxiliary_segment", "fade_out_object"}:
                normalized.append({"action": "maintain_scene", "targets": targets})
                continue

            if action_type in {"highlight_segment", "highlight_angle", "highlight_triangle", "highlight_entity"}:
                normalized.append({"action": "highlight_entity", "targets": targets})
                continue

            if action_type in {"highlight_parallel", "show_formula_relation"}:
                normalized.append({"action": "highlight_relation", "targets": targets})
                continue

            if action_type in {"move_point", "reflect_point_over_line", "animate_fold"}:
                axis = str(item.get("axis") or item.get("to_line") or item.get("line") or "").strip()
                payload: Dict[str, Any] = {"action": "animate_fold", "targets": targets}
                if axis:
                    payload["axis"] = axis
                normalized.append(payload)
                continue

            if action_type in {
                "draw_perpendicular_auxiliary",
                "draw_connection_auxiliary",
                "connect_center_tangent",
            }:
                payload = {"action": action_type}
                for key in ("from", "to", "to_line", "reason"):
                    val = str(item.get(key, "")).strip()
                    if val:
                        payload[key] = val
                if targets:
                    payload["targets"] = targets
                normalized.append(payload)
                continue

            # 保留未知动作，交由执行层进行二次过滤。
            copied = copy.deepcopy(item)
            copied["action"] = str(copied.get("action") or copied.get("type") or "").strip()
            normalized.append(copied)

        return normalized

    def _compute_fold_parts(
        self,
        *,
        image_pairs: List[Dict[str, str]],
        geometry_ir: Dict[str, Any],
    ) -> Tuple[Set[str], Set[str]]:
        """
        计算折叠的 moving_part 和 fixed_part
        
        Returns:
            (moving_part, fixed_part)
        """
        # 获取所有点
        all_points = set(geometry_ir.get("points", []))
        
        # 从 image_pairs 中提取源点和像点
        source_points = set()
        image_points = set()
        
        for pair in image_pairs:
            if isinstance(pair, dict):
                source = str(pair.get("source", "")).strip()
                image = str(pair.get("image", "")).strip()
                if source:
                    source_points.add(source)
                if image:
                    image_points.add(image)
        
        # moving_part 包含源点和像点
        moving_part = source_points | image_points
        
        # fixed_part 是不参与折叠的点
        fixed_part = all_points - moving_part
        
        return moving_part, fixed_part

    def _action_key(self, action: Dict[str, Any]) -> str:
        action_name = str(action.get("action", "")).strip()
        if action_name in {"highlight_entity", "highlight_relation"}:
            targets = sorted(str(item).strip() for item in (action.get("targets") or []) if str(item).strip())
            return f"{action_name}:{','.join(targets)}"
        if action_name == "animate_fold":
            axis = str(action.get("axis", "")).strip()
            return f"{action_name}:{axis}"
        if action_name == "create_image_point":
            return f"{action_name}:{action.get('from', '')}->{action.get('to', '')}"
        if action_name == "draw_perpendicular_auxiliary":
            return (
                f"{action_name}:{action.get('from', '')}->{action.get('to_line', '')}:"
                f"{action.get('new_point', '')}"
            )
        if action_name == "draw_connection_auxiliary":
            return f"{action_name}:{action.get('from', '')}->{action.get('to', '')}"
        if action_name == "connect_center_tangent":
            return f"{action_name}:{action.get('from', '')}->{action.get('to', '')}"
        return action_name
