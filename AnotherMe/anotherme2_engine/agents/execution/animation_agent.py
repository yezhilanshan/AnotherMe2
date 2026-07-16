"""
动画智能体 - 负责生成 Manim 动画代码
直接使用视觉工具分析图片，获取图形信息
"""

import json
import math
import re
from dataclasses import replace
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from ..foundation.base_agent import BaseAgent
from ..foundation.state import ScriptStep, VideoProject
from ..perception.geometry_context import GeometryContext
from ..perception.layout_contract import resolve_animation_layout, resolve_layout_scene
from ..perception.pixel_anchor import scene_point_coordinates
from ..perception.vector_geometry import vectorize_geometry_image
from ..perception.vision_tool import VisionTool
from ..planning.action_executability_checker import ActionExecutabilityChecker
from ..planning.animation_planner import AnimationPlanner
from ..planning.canvas_scene import CanvasScene
from ..planning.problem_pattern import ProblemPatternClassifier
from ..planning.scene_graph_updater import SceneGraphUpdater
from ..planning.teaching_ir import TeachingIRPlanner
from ..planning.template_retriever import TemplateRetriever
from .case_replay_recorder import CaseReplayRecorder
from .codegen import TemplateCodeGenerator
from .render_topology import validate_and_filter_render_topology

try:
    from output_paths import DEFAULT_OUTPUT_DIR
except ModuleNotFoundError:
    from anotherme2_engine.output_paths import DEFAULT_OUTPUT_DIR


class AnimationAgent(BaseAgent):
    """动画智能体"""

    SYSTEM_PROMPT = """你是一个专业的 Manim 动画工程师，专门制作数学解题动画。

你的任务是根据视频脚本和题目图片分析，生成完整的 Manim 动画代码。

要求：
1. 【强制】代码必须完整输出，绝对不能截断、省略或用省略号代替任何部分
2. 【强制】所有字符串必须正确闭合，所有括号、引号必须成对出现
3. 使用 Manim Community Edition 语法
4. 颜色搭配美观，适合教育视频
5. 背景色使用白色或浅暖色系（推荐 #fbfaf7），文字与公式使用黑色/深灰/深蓝以保证对比度
6. 不要使用 `font` 参数设置字体（会报错）
7. 优先使用 `Text` 而不是 `Tex`，避免 LaTeX 依赖问题
8. 不要设置全局字体配置
9. Text 内容中避免过长的字符串，超过 20 字的文本请拆分成多行
10. 【强制】run_time 必须是合法 Python 浮点数，例如 run_time=1.5，绝对不能写成 run_time=0.01.5 或 run_time=1.5.0 等多小数点形式
11. 【强制】几何图形必须以线框为主，Polygon/Circle 等区域对象 fill_opacity 必须为 0 或接近 0，不允许用实体色块遮挡内部线段、点或辅助线

【音画同步要求 - 最重要】：
10. 每个步骤开头必须调用 self.add_sound(r"音频绝对路径", time_offset=0)
    示例：self.add_sound(r"D:/output/audio/narration_001.mp3", time_offset=0)
    说明：这里的 add_sound 放在“当前步骤真正开始执行的位置”，所以 time_offset 应该相对于当前步骤起点，而不是全局累计秒数
11. 每步内所有动画 run_time 之和 + self.wait() 时长，必须严格等于该步骤的音频时长
    - 在步骤末尾加 self.wait(剩余时间) 来对齐，剩余时间 = 音频时长 - 所有动画run_time之和
    - 若剩余时间 <= 0 则不加 wait()
12. 脚本中已列出每步的音频时长；若代码按步骤顺序生成，则每步 add_sound 的 time_offset 固定为 0

输出格式（只输出代码块，不要任何解释）：
```python
# 完整的 Manim 代码
```
"""

    def __init__(
        self,
        config: Dict[str, Any],
        llm: Optional[Any] = None,
        vision_tool: Optional[VisionTool] = None,
    ):
        super().__init__(config, llm)
        self.system_prompt = config.get("system_prompt", self.SYSTEM_PROMPT)
        self.vision_tool = vision_tool
        self.scene_graph_updater = SceneGraphUpdater()
        self.animation_planner = AnimationPlanner()
        self.teaching_ir_planner = TeachingIRPlanner()
        self.problem_pattern_classifier = ProblemPatternClassifier()
        self.action_executability_checker = ActionExecutabilityChecker()
        self.case_replay_recorder = CaseReplayRecorder()
        self.use_template_codegen = bool(config.get("use_template_codegen", True))
        self.canvas_config = config.get(
            "canvas_config",
            {
                "frame_height": 8.0,
                "frame_width": 14.222,
                "pixel_height": 1080,
                "pixel_width": 1920,
                "safe_margin": 0.4,
                "left_panel_x_max": 1.45,
                "right_panel_x_min": 2.1,
                "formula_max_visible_slots": 8,
                "formula_math_font_size": 24,
                "formula_text_font_size": 24,
            },
        )
        self.layout = config.get("layout", "left_graph_right_formula")
        self.output_dir = Path(config.get("output_dir", str(DEFAULT_OUTPUT_DIR)))
        self.template_codegen = TemplateCodeGenerator(self.canvas_config)
        self.use_template_retrieval = bool(config.get("use_template_retrieval", True))
        self.template_retrieval_top_k = int(config.get("template_retrieval_top_k", 3))
        self.template_retrieval_mode = (
            str(config.get("template_retrieval_mode", "component")).strip()
            or "component"
        )
        self.template_retrieval_allow_full_scene_fallback = bool(
            config.get("template_retrieval_allow_full_scene_fallback", True)
        )
        self.prefer_conservative_on_complex = bool(
            config.get("prefer_conservative_on_complex", False)
        )
        self.conservative_step_threshold = int(
            config.get("conservative_step_threshold", 6)
        )
        self.export_incremental_codegen_debug = bool(
            config.get("export_incremental_codegen_debug", False)
        )
        self.allow_uncalibrated_image_overlay = bool(
            config.get("allow_uncalibrated_image_overlay", False)
        )
        self.template_retriever = TemplateRetriever(
            allow_full_scene_fallback=self.template_retrieval_allow_full_scene_fallback,
        )

    def _safe_step_id(self, raw_value: Any, fallback: int) -> int:
        if isinstance(raw_value, int):
            return raw_value
        try:
            return int(raw_value)
        except (TypeError, ValueError):
            pass
        text = str(raw_value or "").strip()
        match = re.search(r"\d+", text)
        if match:
            try:
                return int(match.group(0))
            except ValueError:
                pass
        return fallback

    def _merge_teaching_step_fields(
        self,
        step: ScriptStep,
        teaching_step: Optional[Dict[str, Any]],
    ) -> ScriptStep:
        if not isinstance(teaching_step, dict):
            return step

        merged_spoken_formulas = list(getattr(step, "spoken_formulas", []) or [])
        for item in teaching_step.get("spoken_formulas") or []:
            token = str(item).strip()
            if token and token not in merged_spoken_formulas:
                merged_spoken_formulas.append(token)

        merged_visible_segments = list(getattr(step, "visible_segments", []) or [])
        for item in teaching_step.get("visible_segments") or []:
            token = str(item).strip()
            if token and token not in merged_visible_segments:
                merged_visible_segments.append(token)

        merged_required_actions = list(getattr(step, "required_actions", []) or [])
        for item in teaching_step.get("required_actions") or []:
            if isinstance(item, dict) and item not in merged_required_actions:
                merged_required_actions.append(item)

        merged_auxiliary_actions = list(getattr(step, "auxiliary_line_actions", []) or [])
        for item in teaching_step.get("auxiliary_line_actions") or []:
            if isinstance(item, dict) and item not in merged_auxiliary_actions:
                merged_auxiliary_actions.append(item)

        teaching_policy = str(teaching_step.get("animation_policy", "")).strip()

        return replace(
            step,
            spoken_formulas=merged_spoken_formulas,
            visible_segments=merged_visible_segments,
            required_actions=merged_required_actions,
            auxiliary_line_actions=merged_auxiliary_actions,
            animation_policy=teaching_policy or getattr(step, "animation_policy", "auto"),
        )

    def _build_animation_base_scene(
        self,
        coordinate_scene_data: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """构建动画初始题图：折叠后的派生点先停留在源点，真正移动由 step updater 完成。"""
        base_scene = json.loads(json.dumps(coordinate_scene_data or {}))
        points = base_scene.get("points", [])
        if not isinstance(points, list):
            return base_scene

        point_lookup = {
            str(item.get("id", "")).strip(): item
            for item in points
            if isinstance(item, dict) and item.get("id")
        }
        for item in points:
            if not isinstance(item, dict):
                continue
            derived = item.get("derived")
            if not isinstance(derived, dict):
                continue
            if str(derived.get("type", "")).strip().lower() != "reflect_point":
                continue
            source_id = str(derived.get("source", "")).strip()
            source_item = point_lookup.get(source_id)
            source_coord = (
                source_item.get("coord") if isinstance(source_item, dict) else None
            )
            if isinstance(source_coord, list) and len(source_coord) == 2:
                item["coord"] = [float(source_coord[0]), float(source_coord[1])]
        return base_scene

    def _export_step_debug_code(
        self, step_index: int, manim_code: str, mode_tag: str = "active"
    ) -> str:
        """将每步累计生成代码导出到 output/debug，便于检查循环生成链路。"""
        debug_dir = self.output_dir / "debug"
        debug_dir.mkdir(parents=True, exist_ok=True)
        safe_mode_tag = re.sub(r"[^a-zA-Z0-9_\-]", "_", mode_tag) or "active"
        file_path = debug_dir / f"step_{step_index:02d}_{safe_mode_tag}_manim.py"
        file_path.write_text(manim_code, encoding="utf-8")
        return str(file_path)

    def _layout_step_canvas(
        self, canvas_scene: CanvasScene, plan: Dict[str, Any]
    ) -> Dict[str, Any]:
        """根据 planner 输出给当前步骤分配公式区布局。"""
        max_slots = max(1, int(self.canvas_config.get("formula_max_visible_slots", 8)))
        formula_items = (plan.get("formula_items", []) or [])[
            :max_slots
        ]  # 从计划中获取当前步骤需要展示的公式列表
        reserved_elements = []
        forced_formula_reset = False
        if formula_items:
            # 调用分局器分配位置
            requested_reset = True
            try:
                reserved_elements = canvas_scene.reserve_step_formula_blocks(
                    step_id=plan["step_id"],
                    formula_items=formula_items,
                    reset_formula_area=requested_reset,
                )
            except ValueError:
                # 公式区不足时清空重排，保证当前步骤有可用布局
                forced_formula_reset = True
                reserved_elements = canvas_scene.reserve_step_formula_blocks(
                    step_id=plan["step_id"],
                    formula_items=formula_items,
                    reset_formula_area=True,
                )

        return {
            "reserved_formula_elements": [
                {
                    "id": element.id,
                    "content": element.content,
                    "kind": element.kind,
                    "x": element.x,
                    "y": element.y,
                    "width": element.width,
                    "height": element.height,
                }
                for element in reserved_elements
            ],
            "force_formula_reset": forced_formula_reset,
            "snapshot": canvas_scene.get_layout_snapshot(),
        }

    def _format_script_for_prompt(self, steps: list) -> str:
        """将脚本格式化为提示词，包含音频同步信息"""
        lines = []
        cumulative = 0.0
        for step in steps:
            # 优先使用 TTS 实测时长，没有则用脚本预估时长
            dur = (
                float(step.audio_duration)
                if step.audio_duration
                else float(step.duration)
            )
            audio_path = (
                str(Path(step.audio_file).resolve()).replace("\\", "/")
                if step.audio_file
                else None
            )
            lines.append(f"步骤 {step.id}: {step.title}")
            lines.append(f"  本步骤在全片中的累计开始秒（仅作参考）：{cumulative:.2f}")
            lines.append("  add_sound time_offset（相对当前步骤起点）：0.00")
            if audio_path:
                lines.append(f"  音频文件路径：{audio_path}")
            lines.append(
                f"=此步骤动画总时长必须恰好为 {dur:.2f} 秒（所有run_time + wait()之和）"
            )
            lines.append(f"  旁白：{step.narration}")
            lines.append(f"  视觉：{', '.join(step.visual_cues)}")
            if getattr(step, "on_screen_texts", None):
                display_items = [
                    str(item.get("text", "")).strip()
                    for item in step.on_screen_texts
                    if isinstance(item, dict) and str(item.get("text", "")).strip()
                ]
                if display_items:
                    lines.append(f"  屏幕文字：{' | '.join(display_items)}")
            lines.append("")
            cumulative += dur
        lines.append(f"所有步骤累计总时长：{cumulative:.2f} 秒")
        return "\n".join(lines)

    def _build_canvas_instructions(self) -> str:
        """构建画布尺寸与布局约束，显式告诉模型避免越界"""
        """只是提供一段提示词"""
        cfg = self.canvas_config
        return (
            f"- 必须在代码中设置: config.frame_height={cfg['frame_height']}, "
            f"config.frame_width={cfg['frame_width']}, "
            f"config.pixel_height={cfg['pixel_height']}, "
            f"config.pixel_width={cfg['pixel_width']}\n"
            f"- 安全边距至少 {cfg['safe_margin']}，所有元素必须留在可见区域内，不得超出画布\n"
            f"- 布局模式: {self.layout}\n"
            f"- 左侧图形区: x <= {cfg['left_panel_x_max']}，几何图形与点线标注都放左侧\n"
            f"- 右侧文字区: x >= {cfg['right_panel_x_min']}，可放公式和描述性文字\n"
            f"- 右侧文字区一次最多显示 {int(cfg.get('formula_max_visible_slots', 8))} 条公式，且严格不重叠\n"
            "- 右侧公式字号统一并适当减小，避免同屏公式大小不一致\n"
            "- 右侧文字区使用 VGroup(...).arrange(DOWN, aligned_edge=LEFT) 并固定在右侧，避免与图形重叠"
        )

    def _format_scene_graph_for_prompt(self, scene_graph: Dict[str, Any]) -> str:
        """将 scene graph 序列化为提示词文本。"""
        try:
            return json.dumps(scene_graph, ensure_ascii=False, indent=2)
        except Exception:
            return str(scene_graph)

    def _extract_code_block(self, text: str) -> str:
        """从响应中提取代码块"""
        text = text.strip()

        # 方法 1: 正则提取 ```python 块
        code_pattern = r"```python\s*([\s\S]*?)\s*```"
        match = re.search(code_pattern, text)
        if match:
            code = match.group(1).strip()
            # 递归清理可能嵌套的代码块
            if code.startswith("```"):
                return self._extract_code_block(code)
            return code

        # 方法 2: 提取 ``` 块（不带语言标记）
        code_pattern = r"```\s*([\s\S]*?)\s*```"
        match = re.search(code_pattern, text)
        if match:
            code = match.group(1).strip()
            if code.startswith("```"):
                return self._extract_code_block(code)
            return code

        # 方法 3: 暴力清理 - 删除所有 ``` 行
        lines = text.split("\n")
        cleaned_lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(cleaned_lines).strip()

        # 检查是否包含有效的 Python 代码
        if cleaned.startswith("from manim") or cleaned.startswith("import manim"):
            return cleaned

        # 返回清理后的结果
        return cleaned

    def _collect_known_entities(
        self,
        drawable_scene: Optional[Dict[str, Any]],
        semantic_graph: Optional[Dict[str, Any]],
    ) -> List[str]:
        entity_ids = set()
        for source in (drawable_scene or {}, semantic_graph or {}):
            points = source.get("points") or {}
            if isinstance(points, dict):
                entity_ids.update(str(item) for item in points.keys())
            elif isinstance(points, list):
                entity_ids.update(
                    str(item.get("id"))
                    for item in points
                    if isinstance(item, dict) and item.get("id")
                )

            for bucket in ("lines", "objects", "angles", "primitives"):
                for item in source.get(bucket, []) or []:
                    if isinstance(item, dict) and item.get("id"):
                        entity_ids.add(str(item.get("id")))

        return sorted(item for item in entity_ids if item)

    def _has_drawable_geometry(self, drawable_scene: Optional[Dict[str, Any]]) -> bool:
        if not isinstance(drawable_scene, dict):
            return False
        points = drawable_scene.get("points")
        if isinstance(points, dict):
            has_points = any(
                isinstance(payload, dict)
                and (payload.get("coord") or payload.get("pos"))
                for payload in points.values()
            )
        elif isinstance(points, list):
            has_points = any(
                isinstance(payload, dict)
                and (payload.get("coord") or payload.get("pos"))
                for payload in points
            )
        else:
            has_points = False
        if not has_points:
            return False
        primitives = drawable_scene.get("primitives") or []
        if any(
            isinstance(item, dict) and str(item.get("type", "")).strip()
            for item in primitives
        ):
            return True
        for bucket in (
            "lines",
            "objects",
            "angles",
            "circles",
            "arcs",
            "segments",
            "polygons",
        ):
            items = drawable_scene.get(bucket)
            if isinstance(items, list) and bool(items):
                return True
        return False

    def _scene_point_ids(self, scene: Optional[Dict[str, Any]]) -> Set[str]:
        if not isinstance(scene, dict):
            return set()
        points = scene.get("points")
        if isinstance(points, dict):
            return {str(key) for key in points.keys() if str(key).strip()}
        if isinstance(points, list):
            return {
                str(item.get("id"))
                for item in points
                if isinstance(item, dict) and str(item.get("id", "")).strip()
            }
        return set()

    def _scene_points(self, scene: Optional[Dict[str, Any]]) -> Dict[str, List[float]]:
        """提取当前 scene 中可用于位移动画比对的点坐标。"""
        if not isinstance(scene, dict):
            return {}
        return scene_point_coordinates(scene)

    def _extract_moved_points(
        self,
        prev_scene: Dict[str, Any],
        curr_scene: Dict[str, Any],
        eps: float = 1e-6,
    ) -> Dict[str, List[float]]:
        """比对前后步骤的点位变化，仅提取真正移动过的点。"""
        prev_points = self._scene_points(prev_scene)
        curr_points = self._scene_points(curr_scene)
        moved: Dict[str, List[float]] = {}
        for point_id, curr_pos in curr_points.items():
            prev_pos = prev_points.get(point_id)
            if prev_pos is None:
                continue
            if (
                abs(curr_pos[0] - prev_pos[0]) > eps
                or abs(curr_pos[1] - prev_pos[1]) > eps
            ):
                moved[point_id] = curr_pos
        return moved

    def _authoritative_step_scene(
        self,
        base_scene: Dict[str, Any],
        ctx: Dict[str, Any],
    ) -> Dict[str, Any]:
        """选择当前步骤真正应作为动画真值的 scene。"""
        if not isinstance(ctx, dict):
            return base_scene
        step_scene = ctx.get("step_scene", {})
        if not isinstance(step_scene, dict):
            return base_scene
        if not bool(step_scene.get("allow_geometry_motion", False)):
            return base_scene

        candidate = step_scene.get("scene", {})
        if not isinstance(candidate, dict):
            return base_scene

        if set(self._scene_points(candidate).keys()) != set(
            self._scene_points(base_scene).keys()
        ):
            return base_scene
        return candidate

    def _normalize_step_scene_geometry(
        self,
        base_scene: Optional[Dict[str, Any]],
        step_scene: Optional[Dict[str, Any]],
        *,
        step_index: int,
    ) -> Dict[str, Any]:
        base_scene_dict = base_scene if isinstance(base_scene, dict) else {}
        if not isinstance(step_scene, dict):
            if self._has_drawable_geometry(base_scene_dict):
                return {
                    "scene": json.loads(json.dumps(base_scene_dict)),
                    "allow_geometry_motion": False,
                }
            raise ValueError(f"step {step_index} has no valid scene payload")

        candidate = step_scene.get("scene")
        if not isinstance(candidate, dict) or not self._has_drawable_geometry(
            candidate
        ):
            if self._has_drawable_geometry(base_scene_dict):
                normalized = dict(step_scene)
                normalized["scene"] = json.loads(json.dumps(base_scene_dict))
                normalized["allow_geometry_motion"] = False
                return normalized
            raise ValueError(f"step {step_index} lost all drawable geometry")

        base_point_ids = self._scene_point_ids(base_scene_dict)
        candidate_point_ids = self._scene_point_ids(candidate)
        if base_point_ids and not base_point_ids.issubset(candidate_point_ids):
            raise ValueError(
                f"step {step_index} scene dropped base geometry points: "
                f"{sorted(base_point_ids - candidate_point_ids)}"
            )
        return step_scene

    def _coordinate_scene_verified(self, metadata: Dict[str, Any]) -> bool:
        validation = metadata.get("coordinate_scene_validation")
        return isinstance(validation, dict) and validation.get("is_valid") is True

    def _with_visual_geometry_source(
        self,
        scene: Optional[Dict[str, Any]],
        visual_geometry_source: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        if not isinstance(scene, dict):
            return scene
        enriched = json.loads(json.dumps(scene))
        enriched["_visual_geometry_source"] = dict(visual_geometry_source)
        return enriched

    def _can_use_uncalibrated_image_overlay(
        self,
        crop_info: Dict[str, Any],
        calibration: Dict[str, Any],
    ) -> bool:
        if not self.allow_uncalibrated_image_overlay:
            return False
        if not isinstance(crop_info, dict) or not isinstance(calibration, dict):
            return False
        if crop_info.get("crop_status") != "cropped":
            return False
        crop_path = str(crop_info.get("crop_path") or "").strip()
        crop_size = crop_info.get("crop_size")
        if not crop_path or not isinstance(crop_size, list) or len(crop_size) != 2:
            return False
        try:
            if float(crop_size[0]) <= 8 or float(crop_size[1]) <= 8:
                return False
        except (TypeError, ValueError):
            return False
        return Path(crop_path).exists()

    def _build_overlay_calibration(
        self,
        scene: Optional[Dict[str, Any]],
        crop_info: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Fit one shared geometry->crop-pixel transform for image overlays."""
        result: Dict[str, Any] = {
            "version": "v1",
            "is_valid": False,
            "mode": "similarity",
            "reason": "",
            "anchors": [],
            "min_required_anchors": 3,
            "rms_error_px": None,
            "max_error_px": None,
            "fit_attempts": [],
        }
        if not isinstance(scene, dict):
            result["reason"] = "missing_scene"
            return result

        crop_size = crop_info.get("crop_size")
        crop_bbox = crop_info.get("crop_bbox")
        if not isinstance(crop_size, list) or len(crop_size) != 2:
            result["reason"] = "missing_crop_size"
            return result
        try:
            crop_w = max(float(crop_size[0]), 1.0)
            crop_h = max(float(crop_size[1]), 1.0)
        except (TypeError, ValueError):
            result["reason"] = "invalid_crop_size"
            return result

        anchors: List[Dict[str, Any]] = []
        point_payloads = self._scene_point_payloads(scene)
        point_coords = self._scene_points(scene)
        for point_id, coord in point_coords.items():
            payload = point_payloads.get(point_id)
            pixel = self._point_pixel_to_crop(payload, crop_info)
            label_binding: Optional[Dict[str, Any]] = None
            if pixel is None:
                label_binding = self._bind_label_bbox_to_vector_geometry(
                    point_id,
                    payload,
                    crop_info,
                    crop_w=crop_w,
                    crop_h=crop_h,
                )
                if label_binding is None:
                    continue
                snap = label_binding
            else:
                snap = self._snap_pixel_to_vector_geometry(
                    point_id,
                    pixel,
                    crop_info,
                    crop_w=crop_w,
                    crop_h=crop_h,
                )
                if not snap.get("snapped"):
                    label_binding = self._bind_label_bbox_to_vector_geometry(
                        point_id,
                        payload,
                        crop_info,
                        crop_w=crop_w,
                        crop_h=crop_h,
                    )
                    if label_binding is not None:
                        snap = label_binding
            x, y = snap["pixel"]
            if x < -1e-6 or y < -1e-6 or x > crop_w + 1e-6 or y > crop_h + 1e-6:
                continue
            anchor = {
                "id": point_id,
                "coord": [round(float(coord[0]), 6), round(float(coord[1]), 6)],
                "crop_pixel": [round(float(x), 6), round(float(y), 6)],
            }
            if label_binding is not None:
                anchor["label_vector_binding"] = {
                    key: value for key, value in label_binding.items() if key != "pixel"
                }
            if snap.get("snapped"):
                anchor["vector_snap"] = {
                    key: value for key, value in snap.items() if key != "pixel"
                }
            anchors.append(anchor)

        result["anchors"] = anchors
        if len(anchors) < 3:
            result["reason"] = "insufficient_pixel_anchors"
            return result

        tolerance = max(10.0, min(28.0, 0.045 * max(crop_w, crop_h)))
        similarity_fit = self._fit_similarity_geometry_to_crop(anchors)
        fit_attempts: List[Dict[str, Any]] = []
        if similarity_fit is not None:
            fit_attempts.append(self._calibration_fit_summary(similarity_fit, tolerance))
        if similarity_fit is None:
            result["reason"] = "degenerate_anchor_geometry"
            result["fit_attempts"] = fit_attempts
            return result

        selected_fit = similarity_fit
        selected_reason = "ok"
        similarity_valid = self._calibration_fit_is_valid(similarity_fit, tolerance)
        if not similarity_valid:
            affine_fit = self._fit_affine_geometry_to_crop(anchors)
            if affine_fit is not None:
                fit_attempts.append(self._calibration_fit_summary(affine_fit, tolerance))
                if (
                    self._calibration_fit_is_valid(affine_fit, tolerance)
                    or float(affine_fit["rms_error_px"]) < float(selected_fit["rms_error_px"])
                ):
                    selected_fit = affine_fit
                    selected_reason = (
                        "ok"
                        if self._calibration_fit_is_valid(affine_fit, tolerance)
                        else "residual_too_large"
                    )
            else:
                fit_attempts.append(
                    {
                        "type": "affine",
                        "is_valid": False,
                        "reason": "degenerate_anchor_geometry",
                        "min_required_anchors": 3,
                    }
                )
                selected_reason = "residual_too_large"

        rms_error = float(selected_fit["rms_error_px"])
        max_error = float(selected_fit["max_error_px"])
        result.update(
            {
                "mode": selected_fit["transform"].get("type", "similarity"),
                "transform": selected_fit["transform"],
                "rms_error_px": round(rms_error, 4),
                "max_error_px": round(max_error, 4),
                "tolerance_px": round(tolerance, 4),
                "fit_attempts": fit_attempts,
                "crop_size": [round(crop_w, 6), round(crop_h, 6)],
                "crop_bbox": crop_bbox,
                "source_size": crop_info.get("source_size"),
                "crop_status": crop_info.get("crop_status"),
                "coordinate_system": {
                    "source": "geometry_coord",
                    "target": "crop_pixel",
                    "geometry_y_axis": "up",
                    "pixel_y_axis": "down",
                },
                "anchor_errors": selected_fit["anchor_errors"],
            }
        )
        if self._calibration_fit_is_valid(selected_fit, tolerance):
            result["is_valid"] = True
            result["reason"] = selected_reason
        else:
            result["reason"] = "residual_too_large"
        return result

    def _bind_label_bbox_to_vector_geometry(
        self,
        point_id: str,
        payload: Optional[Dict[str, Any]],
        crop_info: Dict[str, Any],
        *,
        crop_w: float,
        crop_h: float,
    ) -> Optional[Dict[str, Any]]:
        label_bbox = self._point_label_bbox_to_crop(payload, crop_info)
        if label_bbox is None:
            return None
        candidates = self._vector_snap_candidates(crop_info, crop_w=crop_w, crop_h=crop_h)
        candidates.extend(
            self._vector_circle_candidates_for_label(
                crop_info,
                label_bbox=label_bbox,
                crop_w=crop_w,
                crop_h=crop_h,
            )
        )
        candidates = [
            item
            for item in candidates
            if item.get("kind") not in {"line_projection", "circle_projection"}
        ]
        if not candidates:
            return None

        tolerance = max(14.0, min(44.0, 0.08 * max(crop_w, crop_h)))
        best: Optional[Dict[str, Any]] = None
        best_score = float("inf")
        for candidate in candidates:
            candidate_pixel = candidate.get("pixel")
            if not isinstance(candidate_pixel, tuple) or len(candidate_pixel) != 2:
                continue
            distance = self._distance_point_to_bbox(candidate_pixel, label_bbox)
            if distance > tolerance:
                continue
            priority = float(candidate.get("priority", 0.0))
            score = distance - priority
            if score < best_score:
                best = candidate
                best_score = score
        if best is None:
            return None

        x, y = best["pixel"]
        return {
            "pixel": (x, y),
            "snapped": False,
            "point_id": point_id,
            "label_bbox": [round(value, 4) for value in label_bbox],
            "to": [round(x, 4), round(y, 4)],
            "distance_px": round(
                self._distance_point_to_bbox((x, y), label_bbox), 4
            ),
            "kind": best.get("kind"),
            "source": best.get("source"),
            "binding_source": "label_bbox_nearest_vector_point",
        }

    def _snap_pixel_to_vector_geometry(
        self,
        point_id: str,
        pixel: Tuple[float, float],
        crop_info: Dict[str, Any],
        *,
        crop_w: float,
        crop_h: float,
    ) -> Dict[str, Any]:
        """Snap a model-provided point anchor to nearby SVG/vector geometry."""
        original_x, original_y = pixel
        candidates = self._vector_snap_candidates(crop_info, crop_w=crop_w, crop_h=crop_h)
        candidates.extend(
            self._vector_projection_candidates(
                crop_info,
                pixel=pixel,
                crop_w=crop_w,
                crop_h=crop_h,
            )
        )
        candidates.extend(
            self._vector_circle_projection_candidates(
                crop_info,
                pixel=pixel,
                crop_w=crop_w,
                crop_h=crop_h,
            )
        )
        if not candidates:
            return {"pixel": (original_x, original_y), "snapped": False}

        tolerance = max(6.0, min(22.0, 0.035 * max(crop_w, crop_h)))
        structural_candidates = [
            item
            for item in candidates
            if item.get("kind") not in {"line_projection", "circle_projection"}
        ]
        projection_candidates = [
            item
            for item in candidates
            if item.get("kind") in {"line_projection", "circle_projection"}
        ]
        best = self._best_vector_snap_candidate(
            structural_candidates,
            pixel=(original_x, original_y),
            tolerance=tolerance,
        )
        if best is None:
            best = self._best_vector_snap_candidate(
                projection_candidates,
                pixel=(original_x, original_y),
                tolerance=tolerance,
            )

        if not best:
            return {"pixel": (original_x, original_y), "snapped": False}

        snapped_x, snapped_y = best["pixel"]
        distance_px = math.hypot(snapped_x - original_x, snapped_y - original_y)
        return {
            "pixel": (snapped_x, snapped_y),
            "snapped": True,
            "point_id": point_id,
            "from": [round(original_x, 4), round(original_y, 4)],
            "to": [round(snapped_x, 4), round(snapped_y, 4)],
            "distance_px": round(distance_px, 4),
            "kind": best.get("kind"),
            "source": best.get("source"),
        }

    def _best_vector_snap_candidate(
        self,
        candidates: List[Dict[str, Any]],
        *,
        pixel: Tuple[float, float],
        tolerance: float,
    ) -> Optional[Dict[str, Any]]:
        original_x, original_y = pixel
        best: Optional[Dict[str, Any]] = None
        best_score = float("inf")
        for candidate in candidates:
            candidate_pixel = candidate.get("pixel")
            if not isinstance(candidate_pixel, tuple) or len(candidate_pixel) != 2:
                continue
            distance = math.hypot(
                float(candidate_pixel[0]) - original_x,
                float(candidate_pixel[1]) - original_y,
            )
            if distance > tolerance:
                continue
            priority = float(candidate.get("priority", 0.0))
            score = distance - priority
            if score < best_score:
                best = candidate
                best_score = score
        return best

    def _vector_snap_candidates(
        self,
        crop_info: Dict[str, Any],
        *,
        crop_w: float,
        crop_h: float,
    ) -> List[Dict[str, Any]]:
        vector_hints = crop_info.get("vector_hints")
        if not isinstance(vector_hints, dict):
            return []
        primitives = (
            vector_hints.get("geometry_primitives")
            if isinstance(vector_hints.get("geometry_primitives"), dict)
            else {}
        )
        lines = vector_hints.get("lines") or primitives.get("line_segments")

        parsed_lines: List[Dict[str, Any]] = []
        if isinstance(lines, list):
            for line in lines[:32]:
                parsed = self._coerce_vector_line(line)
                if parsed is not None:
                    parsed_lines.append(parsed)

        candidates: List[Dict[str, Any]] = []
        for line in parsed_lines:
            for label, pixel in (("start", line["start"]), ("end", line["end"])):
                candidates.append(
                    {
                        "kind": "line_endpoint",
                        "source": f"{line['id']}:{label}",
                        "pixel": pixel,
                        "priority": 1.5,
                    }
                )

        for i, first in enumerate(parsed_lines):
            for second in parsed_lines[i + 1 :]:
                intersection = self._line_segment_intersection(
                    first,
                    second,
                    crop_w=crop_w,
                    crop_h=crop_h,
                )
                if intersection is None:
                    continue
                candidates.append(
                    {
                        "kind": "line_intersection",
                        "source": f"{first['id']}:{second['id']}",
                        "pixel": intersection,
                        "priority": 3.0,
                    }
                )

        intersections = vector_hints.get("intersections") or primitives.get("intersections")
        if isinstance(intersections, list):
            for intersection in intersections[:64]:
                parsed_intersection = self._coerce_vector_intersection(intersection)
                if parsed_intersection is None:
                    continue
                x, y = parsed_intersection["pixel"]
                if x < -8.0 or y < -8.0 or x > crop_w + 8.0 or y > crop_h + 8.0:
                    continue
                candidates.append(
                    {
                        "kind": parsed_intersection["kind"],
                        "source": parsed_intersection["id"],
                        "pixel": parsed_intersection["pixel"],
                        "priority": 3.5,
                    }
                )

        circles = vector_hints.get("circles") or primitives.get("circles")
        parsed_circles: List[Dict[str, Any]] = []
        if isinstance(circles, list):
            for circle in circles[:16]:
                parsed_circle = self._coerce_vector_circle(circle)
                if parsed_circle is None:
                    continue
                parsed_circles.append(parsed_circle)
                cx, cy = parsed_circle["center"]
                if cx < -1e-6 or cy < -1e-6 or cx > crop_w + 1e-6 or cy > crop_h + 1e-6:
                    continue
                candidates.append(
                    {
                        "kind": "circle_center",
                        "source": parsed_circle["id"],
                        "pixel": (cx, cy),
                        "priority": 2.0,
                    }
                )

        for line in parsed_lines:
            for circle in parsed_circles:
                for index, intersection in enumerate(
                    self._line_circle_intersections(
                        line,
                        circle,
                        crop_w=crop_w,
                        crop_h=crop_h,
                    ),
                    start=1,
                ):
                    candidates.append(
                        {
                            "kind": "line_circle_intersection",
                            "source": f"{line['id']}:{circle['id']}:{index}",
                            "pixel": intersection,
                            "priority": 3.25,
                        }
                    )

        for i, first in enumerate(parsed_circles):
            for second in parsed_circles[i + 1 :]:
                for index, intersection in enumerate(
                    self._circle_circle_intersections(
                        first,
                        second,
                        crop_w=crop_w,
                        crop_h=crop_h,
                    ),
                    start=1,
                ):
                    candidates.append(
                        {
                            "kind": "circle_circle_intersection",
                            "source": f"{first['id']}:{second['id']}:{index}",
                            "pixel": intersection,
                            "priority": 3.25,
                        }
                    )

        return self._dedupe_snap_candidates(candidates)

    def _vector_projection_candidates(
        self,
        crop_info: Dict[str, Any],
        *,
        pixel: Tuple[float, float],
        crop_w: float,
        crop_h: float,
    ) -> List[Dict[str, Any]]:
        vector_hints = crop_info.get("vector_hints")
        if not isinstance(vector_hints, dict):
            return []
        primitives = (
            vector_hints.get("geometry_primitives")
            if isinstance(vector_hints.get("geometry_primitives"), dict)
            else {}
        )
        lines = vector_hints.get("lines") or primitives.get("line_segments")
        if not isinstance(lines, list) or not lines:
            return []

        candidates: List[Dict[str, Any]] = []
        for line in lines[:32]:
            parsed = self._coerce_vector_line(line)
            if parsed is None:
                continue
            projection = self._project_point_to_segment(pixel, parsed)
            if projection is None:
                continue
            px, py = projection
            if px < -1e-6 or py < -1e-6 or px > crop_w + 1e-6 or py > crop_h + 1e-6:
                continue
            candidates.append(
                {
                    "kind": "line_projection",
                    "source": parsed["id"],
                    "pixel": projection,
                    "priority": 0.5,
                }
            )
        return candidates

    def _vector_circle_projection_candidates(
        self,
        crop_info: Dict[str, Any],
        *,
        pixel: Tuple[float, float],
        crop_w: float,
        crop_h: float,
    ) -> List[Dict[str, Any]]:
        vector_hints = crop_info.get("vector_hints")
        if not isinstance(vector_hints, dict):
            return []
        primitives = (
            vector_hints.get("geometry_primitives")
            if isinstance(vector_hints.get("geometry_primitives"), dict)
            else {}
        )
        circles = vector_hints.get("circles") or primitives.get("circles")
        if not isinstance(circles, list) or not circles:
            return []

        candidates: List[Dict[str, Any]] = []
        for circle in circles[:16]:
            parsed = self._coerce_vector_circle(circle)
            if parsed is None:
                continue
            projection = self._project_point_to_circle(pixel, parsed)
            if projection is None:
                continue
            px, py = projection
            if px < -1e-6 or py < -1e-6 or px > crop_w + 1e-6 or py > crop_h + 1e-6:
                continue
            candidates.append(
                {
                    "kind": "circle_projection",
                    "source": parsed["id"],
                    "pixel": projection,
                    "priority": 0.8,
                }
            )
        return candidates

    def _vector_circle_candidates_for_label(
        self,
        crop_info: Dict[str, Any],
        *,
        label_bbox: Tuple[float, float, float, float],
        crop_w: float,
        crop_h: float,
    ) -> List[Dict[str, Any]]:
        center = (
            (label_bbox[0] + label_bbox[2]) / 2.0,
            (label_bbox[1] + label_bbox[3]) / 2.0,
        )
        return self._vector_circle_projection_candidates(
            crop_info,
            pixel=center,
            crop_w=crop_w,
            crop_h=crop_h,
        )

    def _coerce_vector_line(self, line: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(line, dict):
            return None
        try:
            x1 = float(line.get("x1"))
            y1 = float(line.get("y1"))
            x2 = float(line.get("x2"))
            y2 = float(line.get("y2"))
        except (TypeError, ValueError):
            return None
        length = math.hypot(x2 - x1, y2 - y1)
        if length <= 1e-6:
            return None
        return {
            "id": str(line.get("id") or f"line_{len(str(line))}"),
            "start": (x1, y1),
            "end": (x2, y2),
            "length": length,
        }

    def _coerce_vector_circle(self, circle: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(circle, dict):
            return None
        try:
            cx = float(circle.get("cx"))
            cy = float(circle.get("cy"))
            radius = float(circle.get("r") or circle.get("radius"))
        except (TypeError, ValueError):
            return None
        if radius <= 1e-6:
            return None
        return {
            "id": str(circle.get("id") or f"circle_{len(str(circle))}"),
            "center": (cx, cy),
            "radius": radius,
        }

    def _coerce_vector_intersection(
        self, intersection: Any
    ) -> Optional[Dict[str, Any]]:
        if not isinstance(intersection, dict):
            return None
        try:
            x = float(intersection.get("x"))
            y = float(intersection.get("y"))
        except (TypeError, ValueError):
            return None
        raw_type = str(intersection.get("type") or "intersection").strip().lower()
        kind_map = {
            "line_line": "line_intersection",
            "line_circle": "line_circle_intersection",
            "circle_circle": "circle_circle_intersection",
        }
        return {
            "id": str(intersection.get("id") or f"intersection_{len(str(intersection))}"),
            "kind": kind_map.get(raw_type, raw_type or "intersection"),
            "pixel": (x, y),
        }

    def _line_segment_intersection(
        self,
        first: Dict[str, Any],
        second: Dict[str, Any],
        *,
        crop_w: float,
        crop_h: float,
    ) -> Optional[Tuple[float, float]]:
        x1, y1 = first["start"]
        x2, y2 = first["end"]
        x3, y3 = second["start"]
        x4, y4 = second["end"]
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
        if px < -8.0 or py < -8.0 or px > crop_w + 8.0 or py > crop_h + 8.0:
            return None
        if not self._point_near_segment(px, py, first, tolerance=10.0):
            return None
        if not self._point_near_segment(px, py, second, tolerance=10.0):
            return None
        return (px, py)

    def _line_circle_intersections(
        self,
        line: Dict[str, Any],
        circle: Dict[str, Any],
        *,
        crop_w: float,
        crop_h: float,
    ) -> List[Tuple[float, float]]:
        x1, y1 = line["start"]
        x2, y2 = line["end"]
        cx, cy = circle["center"]
        radius = float(circle["radius"])
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
        if abs(discriminant) <= 1e-6:
            roots = [-b / (2.0 * a)]
        else:
            sqrt_disc = math.sqrt(discriminant)
            roots = [(-b - sqrt_disc) / (2.0 * a), (-b + sqrt_disc) / (2.0 * a)]

        points: List[Tuple[float, float]] = []
        for t in roots:
            if t < -0.04 or t > 1.04:
                continue
            px = x1 + t * dx
            py = y1 + t * dy
            if px < -8.0 or py < -8.0 or px > crop_w + 8.0 or py > crop_h + 8.0:
                continue
            points.append((px, py))
        return self._dedupe_intersection_points(points)

    def _circle_circle_intersections(
        self,
        first: Dict[str, Any],
        second: Dict[str, Any],
        *,
        crop_w: float,
        crop_h: float,
    ) -> List[Tuple[float, float]]:
        x0, y0 = first["center"]
        x1, y1 = second["center"]
        r0 = float(first["radius"])
        r1 = float(second["radius"])
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
        rx = -dy * (h / distance)
        ry = dx * (h / distance)
        points = [(xm + rx, ym + ry)]
        if h > 1e-6:
            points.append((xm - rx, ym - ry))

        bounded: List[Tuple[float, float]] = []
        for px, py in points:
            if px < -8.0 or py < -8.0 or px > crop_w + 8.0 or py > crop_h + 8.0:
                continue
            bounded.append((px, py))
        return self._dedupe_intersection_points(bounded)

    def _dedupe_intersection_points(
        self, points: List[Tuple[float, float]]
    ) -> List[Tuple[float, float]]:
        deduped: List[Tuple[float, float]] = []
        for point in points:
            if any(math.hypot(point[0] - other[0], point[1] - other[1]) <= 2.0 for other in deduped):
                continue
            deduped.append(point)
        return deduped

    def _project_point_to_segment(
        self, pixel: Tuple[float, float], line: Dict[str, Any]
    ) -> Optional[Tuple[float, float]]:
        px, py = pixel
        x1, y1 = line["start"]
        x2, y2 = line["end"]
        dx = x2 - x1
        dy = y2 - y1
        denom = dx * dx + dy * dy
        if denom <= 1e-9:
            return None
        t = ((px - x1) * dx + (py - y1) * dy) / denom
        if t < -0.03 or t > 1.03:
            return None
        t = max(0.0, min(1.0, t))
        return (x1 + t * dx, y1 + t * dy)

    def _project_point_to_circle(
        self, pixel: Tuple[float, float], circle: Dict[str, Any]
    ) -> Optional[Tuple[float, float]]:
        px, py = pixel
        cx, cy = circle["center"]
        radius = float(circle["radius"])
        dx = px - cx
        dy = py - cy
        distance = math.hypot(dx, dy)
        if distance <= 1e-6:
            return None
        radial_error = abs(distance - radius)
        if radial_error > max(8.0, radius * 0.18):
            return None
        scale = radius / distance
        return (cx + dx * scale, cy + dy * scale)

    def _point_near_segment(
        self,
        x: float,
        y: float,
        line: Dict[str, Any],
        *,
        tolerance: float,
    ) -> bool:
        x1, y1 = line["start"]
        x2, y2 = line["end"]
        return (
            min(x1, x2) - tolerance <= x <= max(x1, x2) + tolerance
            and min(y1, y2) - tolerance <= y <= max(y1, y2) + tolerance
        )

    def _dedupe_snap_candidates(
        self, candidates: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        deduped: List[Dict[str, Any]] = []
        for candidate in candidates:
            pixel = candidate.get("pixel")
            if not isinstance(pixel, tuple):
                continue
            duplicate = False
            for existing in deduped:
                existing_pixel = existing.get("pixel")
                if not isinstance(existing_pixel, tuple):
                    continue
                if math.hypot(pixel[0] - existing_pixel[0], pixel[1] - existing_pixel[1]) <= 3.0:
                    if float(candidate.get("priority", 0.0)) > float(
                        existing.get("priority", 0.0)
                    ):
                        existing.update(candidate)
                    duplicate = True
                    break
            if not duplicate:
                deduped.append(candidate)
        return deduped

    def _fit_similarity_geometry_to_crop(
        self, anchors: List[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        """Least-squares similarity fit with geometry y inverted into pixel space."""
        src: List[Tuple[float, float]] = []
        dst: List[Tuple[float, float]] = []
        for anchor in anchors:
            coord = anchor.get("coord")
            pixel = anchor.get("crop_pixel")
            if not (
                isinstance(coord, list)
                and len(coord) == 2
                and isinstance(pixel, list)
                and len(pixel) == 2
            ):
                continue
            try:
                src.append((float(coord[0]), -float(coord[1])))
                dst.append((float(pixel[0]), float(pixel[1])))
            except (TypeError, ValueError):
                continue
        if len(src) < 3 or len(dst) != len(src):
            return None

        src_cx = sum(p[0] for p in src) / len(src)
        src_cy = sum(p[1] for p in src) / len(src)
        dst_cx = sum(p[0] for p in dst) / len(dst)
        dst_cy = sum(p[1] for p in dst) / len(dst)

        denom = 0.0
        a_num = 0.0
        b_num = 0.0
        for (sx, sy), (dx, dy) in zip(src, dst):
            px = sx - src_cx
            py = sy - src_cy
            qx = dx - dst_cx
            qy = dy - dst_cy
            denom += px * px + py * py
            a_num += qx * px + qy * py
            b_num += qy * px - qx * py
        if denom <= 1e-9:
            return None

        a = a_num / denom
        b = b_num / denom
        scale = math.hypot(a, b)
        if scale <= 1e-9:
            return None

        tx = dst_cx - (a * src_cx - b * src_cy)
        ty = dst_cy - (b * src_cx + a * src_cy)
        errors: List[Dict[str, Any]] = []
        sq_sum = 0.0
        max_error = 0.0
        for anchor, (sx, sy), (dx, dy) in zip(anchors, src, dst):
            pred_x = a * sx - b * sy + tx
            pred_y = b * sx + a * sy + ty
            error = math.hypot(pred_x - dx, pred_y - dy)
            sq_sum += error * error
            max_error = max(max_error, error)
            errors.append(
                {
                    "id": anchor.get("id"),
                    "expected_crop_pixel": [round(dx, 4), round(dy, 4)],
                    "predicted_crop_pixel": [round(pred_x, 4), round(pred_y, 4)],
                    "error_px": round(error, 4),
                }
            )

        return {
            "transform": {
                "type": "similarity",
                "a": round(a, 10),
                "b": round(b, 10),
                "tx": round(tx, 10),
                "ty": round(ty, 10),
                "scale": round(scale, 10),
                "rotation_deg": round(math.degrees(math.atan2(b, a)), 6),
                "invert_geometry_y": True,
                "formula": "crop_x=a*x-b*(-y)+tx; crop_y=b*x+a*(-y)+ty",
            },
            "rms_error_px": math.sqrt(sq_sum / len(errors)),
            "max_error_px": max_error,
            "anchor_errors": errors,
        }

    def _fit_affine_geometry_to_crop(
        self, anchors: List[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        """Least-squares affine fit with geometry y inverted into pixel space."""
        src: List[Tuple[float, float]] = []
        dst: List[Tuple[float, float]] = []
        for anchor in anchors:
            coord = anchor.get("coord")
            pixel = anchor.get("crop_pixel")
            if not (
                isinstance(coord, list)
                and len(coord) == 2
                and isinstance(pixel, list)
                and len(pixel) == 2
            ):
                continue
            try:
                src.append((float(coord[0]), -float(coord[1])))
                dst.append((float(pixel[0]), float(pixel[1])))
            except (TypeError, ValueError):
                continue
        if len(src) < 3 or len(dst) != len(src):
            return None

        coeff_x = self._solve_affine_coefficients(src, [point[0] for point in dst])
        coeff_y = self._solve_affine_coefficients(src, [point[1] for point in dst])
        if coeff_x is None or coeff_y is None:
            return None
        m00, m01, tx = coeff_x
        m10, m11, ty = coeff_y
        determinant = m00 * m11 - m01 * m10
        if abs(determinant) <= 1e-9:
            return None

        errors: List[Dict[str, Any]] = []
        sq_sum = 0.0
        max_error = 0.0
        for anchor, (sx, sy), (dx, dy) in zip(anchors, src, dst):
            pred_x = m00 * sx + m01 * sy + tx
            pred_y = m10 * sx + m11 * sy + ty
            error = math.hypot(pred_x - dx, pred_y - dy)
            sq_sum += error * error
            max_error = max(max_error, error)
            errors.append(
                {
                    "id": anchor.get("id"),
                    "expected_crop_pixel": [round(dx, 4), round(dy, 4)],
                    "predicted_crop_pixel": [round(pred_x, 4), round(pred_y, 4)],
                    "error_px": round(error, 4),
                }
            )

        return {
            "transform": {
                "type": "affine",
                "m00": round(m00, 10),
                "m01": round(m01, 10),
                "m10": round(m10, 10),
                "m11": round(m11, 10),
                "tx": round(tx, 10),
                "ty": round(ty, 10),
                "determinant": round(determinant, 10),
                "invert_geometry_y": True,
                "formula": "crop_x=m00*x+m01*(-y)+tx; crop_y=m10*x+m11*(-y)+ty",
            },
            "rms_error_px": math.sqrt(sq_sum / len(errors)),
            "max_error_px": max_error,
            "anchor_errors": errors,
        }

    def _solve_affine_coefficients(
        self,
        src: List[Tuple[float, float]],
        values: List[float],
    ) -> Optional[Tuple[float, float, float]]:
        if len(src) != len(values) or len(src) < 3:
            return None
        ata = [[0.0, 0.0, 0.0] for _ in range(3)]
        atb = [0.0, 0.0, 0.0]
        for (sx, sy), value in zip(src, values):
            row = [sx, sy, 1.0]
            for i in range(3):
                atb[i] += row[i] * value
                for j in range(3):
                    ata[i][j] += row[i] * row[j]
        return self._solve_3x3(ata, atb)

    def _solve_3x3(
        self,
        matrix: List[List[float]],
        vector: List[float],
    ) -> Optional[Tuple[float, float, float]]:
        a = [list(row[:3]) + [float(vector[index])] for index, row in enumerate(matrix[:3])]
        for pivot_index in range(3):
            best_row = max(
                range(pivot_index, 3),
                key=lambda row_index: abs(a[row_index][pivot_index]),
            )
            if abs(a[best_row][pivot_index]) <= 1e-9:
                return None
            if best_row != pivot_index:
                a[pivot_index], a[best_row] = a[best_row], a[pivot_index]
            pivot = a[pivot_index][pivot_index]
            for col in range(pivot_index, 4):
                a[pivot_index][col] /= pivot
            for row_index in range(3):
                if row_index == pivot_index:
                    continue
                factor = a[row_index][pivot_index]
                if abs(factor) <= 1e-12:
                    continue
                for col in range(pivot_index, 4):
                    a[row_index][col] -= factor * a[pivot_index][col]
        return (a[0][3], a[1][3], a[2][3])

    def _calibration_fit_summary(
        self,
        fit: Dict[str, Any],
        tolerance: float,
    ) -> Dict[str, Any]:
        transform = fit.get("transform") if isinstance(fit.get("transform"), dict) else {}
        rms_error = float(fit.get("rms_error_px", 0.0))
        max_error = float(fit.get("max_error_px", 0.0))
        return {
            "type": transform.get("type", "unknown"),
            "is_valid": self._calibration_fit_is_valid(fit, tolerance),
            "rms_error_px": round(rms_error, 4),
            "max_error_px": round(max_error, 4),
            "tolerance_px": round(tolerance, 4),
            "max_tolerance_px": round(tolerance * 1.75, 4),
            "anchor_count": len(fit.get("anchor_errors") or []),
        }

    def _calibration_fit_is_valid(
        self,
        fit: Dict[str, Any],
        tolerance: float,
    ) -> bool:
        try:
            return (
                float(fit["rms_error_px"]) <= tolerance
                and float(fit["max_error_px"]) <= tolerance * 1.75
            )
        except (KeyError, TypeError, ValueError):
            return False

    def _scene_point_payloads(
        self, scene: Optional[Dict[str, Any]]
    ) -> Dict[str, Dict[str, Any]]:
        lookup: Dict[str, Dict[str, Any]] = {}
        if not isinstance(scene, dict):
            return lookup
        points = scene.get("points")
        if isinstance(points, dict):
            for point_id, payload in points.items():
                if isinstance(payload, dict):
                    lookup[str(point_id)] = payload
            return lookup
        if isinstance(points, list):
            for item in points:
                if not isinstance(item, dict):
                    continue
                point_id = str(item.get("id", "")).strip()
                if point_id:
                    lookup[point_id] = item
        return lookup

    def _point_pixel_to_crop(
        self,
        payload: Optional[Dict[str, Any]],
        crop_info: Dict[str, Any],
    ) -> Optional[Tuple[float, float]]:
        pixel = self._extract_point_pixel_coord(payload)
        if pixel is None:
            return None
        x, y = pixel
        space = self._point_pixel_space(payload)
        crop_bbox = crop_info.get("crop_bbox")
        if isinstance(crop_bbox, list) and len(crop_bbox) == 4 and space != "crop":
            try:
                x1, y1, x2, y2 = [float(v) for v in crop_bbox]
            except (TypeError, ValueError):
                x1 = y1 = x2 = y2 = 0.0
            if space == "source" or (x1 <= x <= x2 and y1 <= y <= y2):
                x -= x1
                y -= y1
        return x, y

    def _point_label_bbox_to_crop(
        self,
        payload: Optional[Dict[str, Any]],
        crop_info: Dict[str, Any],
    ) -> Optional[Tuple[float, float, float, float]]:
        bbox = self._extract_point_label_bbox(payload)
        if bbox is None:
            return None
        x1, y1, x2, y2 = bbox
        space = self._point_label_bbox_space(payload)
        crop_bbox = crop_info.get("crop_bbox")
        if isinstance(crop_bbox, list) and len(crop_bbox) == 4 and space != "crop":
            try:
                crop_x1, crop_y1, crop_x2, crop_y2 = [float(v) for v in crop_bbox]
            except (TypeError, ValueError):
                crop_x1 = crop_y1 = crop_x2 = crop_y2 = 0.0
            center_x = (x1 + x2) / 2.0
            center_y = (y1 + y2) / 2.0
            if (
                space == "source"
                or (crop_x1 <= center_x <= crop_x2 and crop_y1 <= center_y <= crop_y2)
            ):
                x1 -= crop_x1
                x2 -= crop_x1
                y1 -= crop_y1
                y2 -= crop_y1
        return (min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2))

    def _extract_point_pixel_coord(
        self, payload: Optional[Dict[str, Any]]
    ) -> Optional[Tuple[float, float]]:
        if not isinstance(payload, dict):
            return None
        for key in (
            "pixel_coord",
            "pixel_position",
            "image_coord",
            "image_position",
            "bbox_position",
            "source_pixel",
        ):
            coord = self._coerce_xy_pair(payload.get(key))
            if coord is not None:
                return coord
        visual = payload.get("visual")
        if isinstance(visual, dict):
            for key in ("pixel_coord", "pixel_position", "bbox_position"):
                coord = self._coerce_xy_pair(visual.get(key))
                if coord is not None:
                    return coord
        return None

    def _extract_point_label_bbox(
        self, payload: Optional[Dict[str, Any]]
    ) -> Optional[Tuple[float, float, float, float]]:
        if not isinstance(payload, dict):
            return None
        for source in (
            payload,
            payload.get("visual") if isinstance(payload.get("visual"), dict) else {},
        ):
            for key in ("label_bbox", "label_box", "text_bbox", "text_box"):
                bbox = self._coerce_bbox(source.get(key))
                if bbox is not None:
                    return bbox
        return None

    def _point_pixel_space(self, payload: Optional[Dict[str, Any]]) -> str:
        if not isinstance(payload, dict):
            return ""
        for source in (
            payload,
            payload.get("visual") if isinstance(payload.get("visual"), dict) else {},
        ):
            for key in (
                "pixel_coord_space",
                "pixel_space",
                "coordinate_space",
                "image_space",
            ):
                value = str(source.get(key, "")).strip().lower()
                if value in {"crop", "cropped", "crop_image"}:
                    return "crop"
                if value in {"source", "original", "original_image", "full_image"}:
                    return "source"
        return ""

    def _point_label_bbox_space(self, payload: Optional[Dict[str, Any]]) -> str:
        if not isinstance(payload, dict):
            return ""
        for source in (
            payload,
            payload.get("visual") if isinstance(payload.get("visual"), dict) else {},
        ):
            for key in (
                "label_bbox_space",
                "pixel_coord_space",
                "pixel_space",
                "coordinate_space",
                "image_space",
            ):
                value = str(source.get(key, "")).strip().lower()
                if value in {"crop", "cropped", "crop_image"}:
                    return "crop"
                if value in {"source", "original", "original_image", "full_image"}:
                    return "source"
        return ""

    def _coerce_xy_pair(self, value: Any) -> Optional[Tuple[float, float]]:
        if isinstance(value, dict):
            if "x" in value and "y" in value:
                try:
                    return float(value["x"]), float(value["y"])
                except (TypeError, ValueError):
                    return None
            return None
        if isinstance(value, (list, tuple)) and len(value) >= 2:
            try:
                return float(value[0]), float(value[1])
            except (TypeError, ValueError):
                return None
        return None

    def _coerce_bbox(self, value: Any) -> Optional[Tuple[float, float, float, float]]:
        if isinstance(value, dict):
            try:
                if "x1" in value and "y1" in value and "x2" in value and "y2" in value:
                    return (
                        float(value["x1"]),
                        float(value["y1"]),
                        float(value["x2"]),
                        float(value["y2"]),
                    )
                if all(key in value for key in ("left", "top", "right", "bottom")):
                    return (
                        float(value["left"]),
                        float(value["top"]),
                        float(value["right"]),
                        float(value["bottom"]),
                    )
                if all(key in value for key in ("x", "y", "width", "height")):
                    x = float(value["x"])
                    y = float(value["y"])
                    return (x, y, x + float(value["width"]), y + float(value["height"]))
            except (TypeError, ValueError):
                return None
            return None
        if isinstance(value, (list, tuple)) and len(value) >= 4:
            try:
                return (
                    float(value[0]),
                    float(value[1]),
                    float(value[2]),
                    float(value[3]),
                )
            except (TypeError, ValueError):
                return None
        return None

    def _distance_point_to_bbox(
        self,
        pixel: Tuple[float, float],
        bbox: Tuple[float, float, float, float],
    ) -> float:
        x, y = pixel
        x1, y1, x2, y2 = bbox
        dx = max(x1 - x, 0.0, x - x2)
        dy = max(y1 - y, 0.0, y - y2)
        return math.hypot(dx, dy)

    def _prepare_problem_figure_crop(
        self,
        image_path: str,
        *,
        enabled: bool,
    ) -> Dict[str, Any]:
        """Best-effort crop of the actual geometry figure from the full problem image."""
        result: Dict[str, Any] = {
            "image_path": image_path,
            "crop_path": image_path,
            "crop_bbox": None,
            "crop_status": "disabled" if not enabled else "not_started",
        }
        if not enabled or not image_path:
            return result
        source_path = Path(image_path)
        if not source_path.exists():
            result["crop_status"] = "source_missing"
            return result

        try:
            from PIL import Image
        except Exception as exc:  # pragma: no cover - dependency is declared.
            result["crop_status"] = f"pillow_unavailable: {exc}"
            return result

        try:
            image = Image.open(source_path).convert("RGB")
            width, height = image.size
            result.update(
                {
                    "crop_bbox": [0, 0, width, height],
                    "source_size": [width, height],
                    "crop_size": [width, height],
                    "coordinate_transform": {
                        "pixel_space": "source",
                        "source_to_crop": {"translate": [0, 0], "scale": [1.0, 1.0]},
                        "crop_origin_in_source": [0, 0],
                    },
                }
            )
            if width <= 4 or height <= 4:
                result["crop_status"] = "source_too_small"
                return result

            max_side = 720
            scale = min(1.0, max_side / max(width, height))
            small_size = (max(1, int(width * scale)), max(1, int(height * scale)))
            gray = image.convert("L").resize(small_size)
            sw, sh = gray.size
            pixels = list(gray.tobytes())
            corner_samples = (
                pixels[: max(1, sw * max(1, sh // 20))]
                + pixels[-max(1, sw * max(1, sh // 20)) :]
                + pixels[0 :: max(1, sw * 20)]
                + pixels[sw - 1 :: max(1, sw * 20)]
            )
            bg = (
                sorted(corner_samples)[len(corner_samples) // 2]
                if corner_samples
                else 245
            )
            threshold = max(150, min(230, int(bg) - 35))
            mask = bytearray(1 if value < threshold else 0 for value in pixels)
            visited = bytearray(len(mask))

            components: List[Dict[str, Any]] = []
            for start, active in enumerate(mask):
                if not active or visited[start]:
                    continue
                stack = [start]
                visited[start] = 1
                min_x = max_x = start % sw
                min_y = max_y = start // sw
                count = 0
                while stack:
                    idx = stack.pop()
                    count += 1
                    x = idx % sw
                    y = idx // sw
                    if x < min_x:
                        min_x = x
                    if x > max_x:
                        max_x = x
                    if y < min_y:
                        min_y = y
                    if y > max_y:
                        max_y = y
                    for neighbor in (idx - 1, idx + 1, idx - sw, idx + sw):
                        if (
                            neighbor < 0
                            or neighbor >= len(mask)
                            or visited[neighbor]
                            or not mask[neighbor]
                        ):
                            continue
                        nx = neighbor % sw
                        ny = neighbor // sw
                        if abs(nx - x) + abs(ny - y) != 1:
                            continue
                        visited[neighbor] = 1
                        stack.append(neighbor)
                bw = max_x - min_x + 1
                bh = max_y - min_y + 1
                if count < 8:
                    continue
                components.append(
                    {
                        "bbox": (min_x, min_y, max_x + 1, max_y + 1),
                        "count": count,
                        "width": bw,
                        "height": bh,
                    }
                )

            if not components:
                result["crop_status"] = "no_dark_components"
                return result

            def score_component(component: Dict[str, Any]) -> float:
                bw = float(component["width"])
                bh = float(component["height"])
                area = max(bw * bh, 1.0)
                wr = bw / max(sw, 1)
                hr = bh / max(sh, 1)
                density = float(component["count"]) / area
                if wr < 0.035 or hr < 0.045:
                    return -1.0
                if hr < 0.07 and wr > 0.45:
                    return -1.0
                if bw / max(bh, 1.0) > 9.0:
                    return -1.0
                x1, y1, x2, y2 = component["bbox"]
                center_bias = 1.15 if ((x1 + x2) / 2.0) > sw * 0.32 else 1.0
                lower_bias = 1.35 if ((y1 + y2) / 2.0) > sh * 0.34 else 0.82
                line_bias = 1.20 if density < 0.42 else 0.82
                return (
                    (area**0.55 + min(bw, bh) * 1.8)
                    * center_bias
                    * lower_bias
                    * line_bias
                )

            seed = max(components, key=score_component)
            if score_component(seed) <= 0:
                result["crop_status"] = "no_geometry_like_component"
                return result

            sx1, sy1, sx2, sy2 = seed["bbox"]
            gap_x = max(8, int(sw * 0.045))
            gap_y = max(8, int(sh * 0.045))
            merged = [sx1, sy1, sx2, sy2]
            px1 = max(0, merged[0] - gap_x)
            py1 = max(0, merged[1] - gap_y)
            px2 = min(sw, merged[2] + gap_x)
            py2 = min(sh, merged[3] + gap_y)
            for component in components:
                cx1, cy1, cx2, cy2 = component["bbox"]
                intersects = not (cx2 < px1 or cx1 > px2 or cy2 < py1 or cy1 > py2)
                if not intersects:
                    continue
                comp_w = max(cx2 - cx1, 1)
                comp_h = max(cy2 - cy1, 1)
                comp_density = float(component["count"]) / float(comp_w * comp_h)
                text_fragment_like = (
                    comp_density > 0.36
                    and comp_w > sw * 0.08
                    and comp_h > sh * 0.035
                    and cy2 < sy1 + max(gap_y * 2, int(sh * 0.10))
                )
                if text_fragment_like:
                    continue
                merged = [
                    min(merged[0], cx1),
                    min(merged[1], cy1),
                    max(merged[2], cx2),
                    max(merged[3], cy2),
                ]

            pad_x = max(12, int((merged[2] - merged[0]) * 0.12))
            pad_y_top = max(8, int((merged[3] - merged[1]) * 0.045))
            pad_y_bottom = max(12, int((merged[3] - merged[1]) * 0.12))
            crop_small = (
                max(0, merged[0] - pad_x),
                max(0, merged[1] - pad_y_top),
                min(sw, merged[2] + pad_x),
                min(sh, merged[3] + pad_y_bottom),
            )
            crop_small = self._trim_crop_top_to_figure(mask, sw, sh, crop_small)
            crop_small = self._trim_crop_left_to_figure(mask, sw, sh, crop_small)
            inv_scale = 1.0 / max(scale, 1e-6)
            crop_box = (
                max(0, int(crop_small[0] * inv_scale)),
                max(0, int(crop_small[1] * inv_scale)),
                min(width, int(crop_small[2] * inv_scale)),
                min(height, int(crop_small[3] * inv_scale)),
            )
            if (
                crop_box[2] - crop_box[0] < width * 0.08
                or crop_box[3] - crop_box[1] < height * 0.08
            ):
                result["crop_status"] = "crop_too_small"
                return result

            crop_dir = self.output_dir / "debug" / "geometry_crops"
            crop_dir.mkdir(parents=True, exist_ok=True)
            crop_path = crop_dir / f"{source_path.stem}_geometry_crop.png"
            image.crop(crop_box).save(crop_path)
            vector_hints = vectorize_geometry_image(
                str(crop_path),
                output_svg_path=str(crop_path.with_suffix(".svg")),
                output_json_path=str(crop_path.with_suffix(".geometry_primitives.json")),
            )
            result.update(
                {
                    "crop_path": str(crop_path).replace("\\", "/"),
                    "crop_bbox": list(crop_box),
                    "crop_status": "cropped",
                    "source_size": [width, height],
                    "crop_size": [crop_box[2] - crop_box[0], crop_box[3] - crop_box[1]],
                    "coordinate_transform": {
                        "pixel_space": "source",
                        "source_to_crop": {
                            "translate": [-crop_box[0], -crop_box[1]],
                            "scale": [1.0, 1.0],
                        },
                        "crop_origin_in_source": [crop_box[0], crop_box[1]],
                    },
                    "svg_path": vector_hints.get("svg_path"),
                    "svg_status": vector_hints.get("status"),
                    "geometry_primitives_path": vector_hints.get("geometry_primitives_path"),
                    "vector_hints": {
                        "version": vector_hints.get("version"),
                        "coordinate_space": vector_hints.get("coordinate_space"),
                        "image_size": vector_hints.get("image_size"),
                        "geometry_primitives_path": vector_hints.get("geometry_primitives_path"),
                        "lines": vector_hints.get("lines", []),
                        "circles": vector_hints.get("circles", []),
                        "intersections": vector_hints.get("intersections", []),
                        "markers": vector_hints.get("markers", []),
                        "confidence": vector_hints.get("confidence", 0.0),
                        "geometry_primitives": vector_hints.get("geometry_primitives"),
                    },
                }
            )
            return result
        except Exception as exc:
            result["crop_status"] = f"crop_failed: {exc}"
            return result

    def _trim_crop_top_to_figure(
        self,
        mask: bytearray,
        width: int,
        height: int,
        crop_box: Tuple[int, int, int, int],
    ) -> Tuple[int, int, int, int]:
        left, top, right, bottom = crop_box
        crop_width = max(right - left, 1)
        if crop_width < 20 or bottom - top < 20:
            return crop_box
        right_band_start = left + int(crop_width * 0.42)
        required = max(2, int(crop_width * 0.006))
        for y in range(top, min(bottom, top + max(8, int((bottom - top) * 0.35)))):
            hits = 0
            for yy in range(y, min(bottom, y + 4)):
                row_start = yy * width
                hits += sum(mask[row_start + right_band_start : row_start + right])
            if hits >= required:
                new_top = max(top, y - max(4, int((bottom - top) * 0.03)))
                return (left, new_top, right, bottom)
        return crop_box

    def _trim_crop_left_to_figure(
        self,
        mask: bytearray,
        width: int,
        height: int,
        crop_box: Tuple[int, int, int, int],
    ) -> Tuple[int, int, int, int]:
        left, top, right, bottom = crop_box
        crop_width = max(right - left, 1)
        crop_height = max(bottom - top, 1)
        if crop_width < 20 or crop_height < 20:
            return crop_box
        lower_band_start = top + int(crop_height * 0.32)
        required = max(2, int(crop_height * 0.006))
        scan_right = min(right, left + max(8, int(crop_width * 0.36)))
        for x in range(left, scan_right):
            hits = 0
            for xx in range(x, min(right, x + 4)):
                hits += sum(
                    mask[yy * width + xx] for yy in range(lower_band_start, bottom)
                )
            if hits >= required:
                new_left = max(left, x - max(4, int(crop_width * 0.04)))
                return (new_left, top, right, bottom)
        return crop_box

    def _ensure_presentable_video_code(
        self,
        manim_code: str,
        expected_steps: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        is_valid, error_message, report = self.template_codegen.validator.validate(
            manim_code,
            expected_steps=expected_steps,
        )
        if not is_valid:
            raise ValueError(error_message)
        return report

    def _generate_text_only_video(
        self,
        state: Dict[str, Any],
        script_steps: List[ScriptStep],
        metadata: Dict[str, Any],
        problem_text: str,
        adaptive_plan: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Generate Manim video for non-geometry problems (text/formula only)."""
        project = state["project"]

        expected_steps = self._build_expected_steps(script_steps)
        problem_pattern = metadata.get("problem_pattern", {})
        problem_constraints = metadata.get("problem_constraints", {})

        # Build a text-focused prompt
        prompt = (
            "请根据以下数学题目的讲解脚本，输出完整可运行的 Manim 代码。\n"
            "本题无几何图形，需要制作纯文字/公式/示意图形式的讲解动画。\n"
            "必须满足音画同步与时长约束，禁止省略代码。\n\n"
            "[画布约束]\n"
            f"{self._build_canvas_instructions()}\n\n"
            "[题目文字]\n"
            f"{problem_text}\n\n"
            "[脚本步骤]\n"
            f"{self._format_script_for_prompt(script_steps)}\n\n"
            "[动画要求]\n"
            "- 使用 Text 展示题目文字、关键概念和结论\n"
            "- 使用 MathTex 或 Text 展示公式和计算过程\n"
            "- 可以用 Rectangle、Arrow、Line 等绘制简单的示意图（如流程图、表格、框图）\n"
            '- 每步开头用 self.add_sound(r"音频路径", time_offset=0) 同步音频\n'
            "- 每步动画总时长必须严格等于该步音频时长\n"
            "- 颜色搭配美观，背景色使用白色或浅暖色系（推荐 #fbfaf7），文字/公式用黑色、深灰或深蓝\n"
            "- 如果绘制几何区域，Polygon/Circle 的 fill_opacity 必须为 0 或接近 0，不能用实体色块遮挡内部结构\n"
            "- 不要使用 font 参数\n"
            "- 优先使用 Text 而不是 Tex\n"
        )

        if problem_constraints:
            prompt += f"\n[题型信息]\n{json.dumps(problem_constraints, ensure_ascii=False, indent=2)}\n"

        # Add step timing info
        prompt += "\n[步骤时长]\n"
        for i, step in enumerate(script_steps, 1):
            audio_path = metadata.get("audio_paths", [None] * len(script_steps))
            path = audio_path[i - 1] if i - 1 < len(audio_path) else None
            prompt += f"步骤{i}: {step.duration}秒"
            if path:
                prompt += f" 音频={path}"
            prompt += "\n"

        try:
            messages = self._format_messages(
                system_prompt=self.system_prompt, user_prompt=prompt
            )
            response = self._invoke_llm(messages)
            code = self._extract_code_block(response or "")
            if not str(code).strip():
                raise ValueError("LLM returned empty Manim code for text-only video")

            report = self._ensure_presentable_video_code(code, expected_steps)

            metadata["manim_code"] = code
            metadata["codegen_mode"] = "text_only_llm"
            metadata["fallback_level"] = "text_only"
            metadata["animation_report"] = report
            project.manim_class_name = self._extract_class_name(code)
            project.status = "animation_completed"
            state["project"] = project
            state["current_step"] = "animation_completed"
            state["messages"].append(
                {
                    "role": "assistant",
                    "content": f"文字动画代码生成完成（text_only_llm 模式），类名: {project.manim_class_name}",
                }
            )
        except Exception as exc:
            return self._fail_with_geometry_error(
                state,
                f"文字动画生成失败: {exc}",
                str(exc),
            )

        return state

    def _extract_class_name(self, code: str) -> str:
        """Extract the main Scene class name from Manim code."""
        match = re.search(r"class\s+(\w+)\s*\([^)]*Scene[^)]*\)", code or "")
        return match.group(1) if match else "MathAnimation"

    def _fail_with_geometry_error(
        self,
        state: Dict[str, Any],
        message: str,
        error_message: str,
    ) -> Dict[str, Any]:
        if "messages" not in state:
            state["messages"] = []
        state["messages"].append({"role": "assistant", "content": message})
        project = state.get("project")
        if project is not None:
            project.status = "failed"
            project.error_message = error_message
            state["project"] = project

        metadata = (
            state.get("metadata") if isinstance(state.get("metadata"), dict) else {}
        )
        try:
            case_path = self.case_replay_recorder.record(
                output_dir=self.output_dir,
                payload={
                    "problem_text": str(getattr(project, "problem_text", "") or "")[
                        :240
                    ],
                    "problem_pattern": str(
                        (metadata.get("problem_pattern") or {}).get(
                            "problem_pattern", ""
                        )
                    ),
                    "sub_pattern": str(
                        (metadata.get("problem_pattern") or {}).get("sub_pattern", "")
                    ),
                    "execution_check": metadata.get("teaching_ir_execution_check", {}),
                    "render_result": {
                        "status": "failed",
                        "reason": str(error_message),
                    },
                },
            )
            metadata["case_record_path"] = case_path
            state["metadata"] = metadata
        except Exception:
            pass

        state["current_step"] = "animation_failed"
        return state

    def _build_expected_steps(self, steps: List[ScriptStep]) -> List[Dict[str, Any]]:
        expected: List[Dict[str, Any]] = []
        for index, step in enumerate(steps, start=1):
            duration = (
                float(step.audio_duration)
                if step.audio_duration
                else float(step.duration)
            )
            expected.append(
                {
                    "step_id": self._safe_step_id(getattr(step, "id", None), index),
                    "duration": round(duration, 2),
                }
            )
        return expected

    def _derived_point_ids(self, scene: Optional[Dict[str, Any]]) -> Set[str]:
        result: Set[str] = set()
        if not isinstance(scene, dict):
            return result
        points = scene.get("points")
        if isinstance(points, list):
            for item in points:
                if not isinstance(item, dict):
                    continue
                if not isinstance(item.get("derived"), dict):
                    continue
                point_id = str(item.get("id", "")).strip()
                if point_id:
                    result.add(point_id)
        elif isinstance(points, dict):
            for point_id, payload in points.items():
                if isinstance(payload, dict) and isinstance(
                    payload.get("derived"), dict
                ):
                    result.add(str(point_id))
        return result

    def _build_timing_budget(
        self,
        *,
        duration: float,
        formula_actions: List[Dict[str, Any]],
        movement_actions: List[Dict[str, Any]],
        emphasis_actions: List[Dict[str, Any]],
        label_actions: List[Dict[str, Any]],
        restore_actions: List[Dict[str, Any]],
        helper_line_actions: List[Dict[str, Any]],
        formula_reset: float,
    ) -> Dict[str, float]:
        transform_enabled = any(
            str(item.get("mode", "")).strip().lower() == "transform"
            for item in emphasis_actions
            if isinstance(item, dict)
        )
        budget = {
            "duration": round(float(duration), 2),
            "formula_reset": round(formula_reset if formula_actions else 0.0, 2),
            "formula_show": round(min(1.0, duration * 0.25), 2)
            if formula_actions
            else 0.0,
            "movement": round(min(0.8, duration * 0.30), 2)
            if movement_actions
            else 0.0,
            "emphasis": round(min(0.6, duration * 0.22), 2)
            if emphasis_actions
            else 0.0,
            "transform": round(min(0.7, duration * 0.22), 2)
            if transform_enabled
            else 0.0,
            "label_show": round(min(0.6, duration * 0.20), 2) if label_actions else 0.0,
            "label_hide": round(min(0.4, duration * 0.15), 2) if label_actions else 0.0,
            "restore": round(min(0.25, duration * 0.10), 2) if restore_actions else 0.0,
            "helper_draw": round(min(1.2, duration * 0.25), 2)
            if helper_line_actions
            else 0.0,
            "helper_hold": round(min(0.5, duration * 0.10), 2)
            if helper_line_actions
            else 0.0,
            "helper_fade": round(min(0.4, duration * 0.12), 2)
            if helper_line_actions
            else 0.0,
        }
        used = sum(float(v) for k, v in budget.items() if k != "duration")
        budget["wait"] = round(max(duration - used, 0.0), 2)
        return budget

    def _apply_timing_profile(
        self,
        budget: Dict[str, float],
        *,
        duration: float,
        formula_scale: float,
        movement_scale: float,
        emphasis_scale: float,
        label_scale: float,
    ) -> Dict[str, float]:
        tuned = dict(budget)
        scale_map = {
            "formula_show": formula_scale,
            "movement": movement_scale,
            "emphasis": emphasis_scale,
            "transform": emphasis_scale,
            "label_show": label_scale,
            "label_hide": label_scale,
        }
        for key, scale in scale_map.items():
            raw_value = float(tuned.get(key, 0.0) or 0.0)
            if raw_value <= 0:
                continue
            tuned[key] = round(min(duration * 0.7, raw_value * scale), 2)

        used = sum(float(v) for k, v in tuned.items() if k not in {"duration", "wait"})
        tuned["wait"] = round(max(duration - used, 0.0), 2)
        tuned["duration"] = round(duration, 2)
        return tuned

    def _attach_animation_specs(
        self,
        contexts: List[Dict[str, Any]],
        *,
        base_coordinate_scene: Optional[Dict[str, Any]],
        conservative: bool,
        adaptive_plan: Optional[Dict[str, Any]] = None,
    ) -> None:
        prev_scene = self._build_animation_base_scene(base_coordinate_scene)
        hidden_derived = self._derived_point_ids(prev_scene)
        has_formula_visible = False

        visual_profile = (
            adaptive_plan.get("visual_profile")
            if isinstance(adaptive_plan, dict)
            and isinstance(adaptive_plan.get("visual_profile"), dict)
            else {}
        )
        scaffold_level = str(
            visual_profile.get("scaffold_level", "medium") or "medium"
        ).lower()
        highlight_intensity = str(
            visual_profile.get("highlight_intensity", "medium") or "medium"
        ).lower()
        label_key_entities = bool(visual_profile.get("label_key_entities", False))
        blink_auxiliary_lines = bool(visual_profile.get("blink_auxiliary_lines", False))

        formula_scale = 1.0
        movement_scale = 1.0
        emphasis_scale = 1.0
        label_scale = 1.0
        force_labels = False
        if scaffold_level == "high":
            formula_scale = 1.35
            movement_scale = 1.15
            emphasis_scale = 1.35
            label_scale = 1.3
            force_labels = True
        elif scaffold_level == "low":
            formula_scale = 0.9
            movement_scale = 0.9
            emphasis_scale = 0.85
            label_scale = 0.85

        if highlight_intensity == "high":
            emphasis_scale = max(emphasis_scale, 1.5)
        elif highlight_intensity == "low":
            emphasis_scale = min(emphasis_scale, 0.85)

        for index, ctx in enumerate(contexts, start=1):
            plan = ctx.get("animation_plan", {})
            step_scene = ctx.get("step_scene", {})
            current_scene = self._authoritative_step_scene(prev_scene, ctx)
            focus_entities = list(plan.get("focus_entities", []) or [])
            duration = float(plan.get("duration", 1.0) or 1.0)
            action_types = {
                str(item.get("type", "")).strip().lower()
                for item in (plan.get("actions", []) or [])
                if isinstance(item, dict)
            }
            layout = ctx.get("canvas_layout", {})
            formula_elements = list(layout.get("reserved_formula_elements", []) or [])
            force_formula_reset = bool(layout.get("force_formula_reset", False))
            formula_actions = [
                {
                    "type": "show_formula",
                    "content": str(item.get("content", "")),
                    "layout": item,
                }
                for item in formula_elements
                if isinstance(item, dict)
            ]

            moved_points = self._extract_moved_points(prev_scene, current_scene)
            movement_actions: List[Dict[str, Any]] = []
            if not conservative:
                movement_actions = [
                    {
                        "type": "move_point",
                        "point_id": point_id,
                        "reveal": point_id in hidden_derived,
                    }
                    for point_id in moved_points.keys()
                ]

            emphasis_mode = (
                "transform"
                if ("transform" in action_types and not conservative)
                else "highlight"
            )
            if not conservative and highlight_intensity == "high":
                emphasis_mode = "maintain"
            emphasis_actions: List[Dict[str, Any]] = []
            if focus_entities:
                emphasis_actions.append(
                    {
                        "type": "highlight",
                        "mode": emphasis_mode,
                        "targets": focus_entities,
                    }
                )

            label_actions: List[Dict[str, Any]] = []
            if not conservative and (
                "label" in action_types or force_labels or label_key_entities
            ):
                label_actions = [
                    {
                        "type": "show_temp_label",
                        "target": entity_id,
                    }
                    for entity_id in (
                        focus_entities[:3] if force_labels else focus_entities
                    )
                ]

            if not conservative and blink_auxiliary_lines and focus_entities:
                emphasis_actions.append(
                    {
                        "type": "highlight",
                        "mode": "transform",
                        "targets": focus_entities[:2],
                    }
                )

            restore_actions: List[Dict[str, Any]] = []
            if focus_entities:
                restore_actions.append(
                    {
                        "type": "restore_style",
                        "targets": focus_entities,
                    }
                )

            helper_line_actions: List[Dict[str, Any]] = []
            step_scene_data = (
                step_scene.get("scene") if isinstance(step_scene, dict) else step_scene
            )
            if isinstance(step_scene_data, dict):
                operations = step_scene_data.get("operations") or []
                for op in operations:
                    if not isinstance(op, dict):
                        continue
                    if str(op.get("type", "")).strip().lower() == "helper_line":
                        helper_line_actions.append(op)

            teaching_step = plan.get("teaching_step") or {}
            semantic_actions: List[Dict[str, Any]] = []
            if isinstance(teaching_step, dict):
                for action in teaching_step.get("actions") or []:
                    if isinstance(action, dict):
                        semantic_actions.append(copy.deepcopy(action))
                for action in teaching_step.get("auxiliary_line_actions") or []:
                    if isinstance(action, dict):
                        helper_line_actions.append(action)

            timing_budget = self._build_timing_budget(
                duration=duration,
                formula_actions=formula_actions,
                movement_actions=movement_actions,
                emphasis_actions=emphasis_actions,
                label_actions=label_actions,
                restore_actions=restore_actions,
                helper_line_actions=helper_line_actions,
                formula_reset=0.20
                if (
                    (plan.get("reset_formula_area", False) or force_formula_reset)
                    and has_formula_visible
                    and formula_actions
                )
                else 0.0,
            )
            timing_budget = self._apply_timing_profile(
                timing_budget,
                duration=duration,
                formula_scale=formula_scale,
                movement_scale=movement_scale,
                emphasis_scale=emphasis_scale,
                label_scale=label_scale,
            )

            ctx["animation_spec"] = {
                "step_id": self._safe_step_id(plan.get("step_id"), index),
                "title": str(plan.get("title", "")),
                "fallback_mode": "conservative" if conservative else "formal",
                "focus_entities": focus_entities,
                "formula_actions": formula_actions,
                "reset_formula_area": bool(
                    plan.get("reset_formula_area", False) or force_formula_reset
                ),
                "movement_actions": movement_actions,
                "emphasis_actions": emphasis_actions,
                "label_actions": label_actions,
                "restore_actions": restore_actions,
                "helper_line_actions": helper_line_actions,
                "semantic_actions": semantic_actions,
                "timing_budget": timing_budget,
            }

            has_formula_visible = bool(formula_actions)
            prev_scene = (
                current_scene
                if isinstance(current_scene, dict) and current_scene
                else prev_scene
            )

    def _write_debug_json(self, filename: str, payload: Any) -> None:
        debug_dir = self.output_dir / "debug"
        debug_dir.mkdir(parents=True, exist_ok=True)
        (debug_dir / filename).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _write_debug_text(self, filename: str, content: str) -> None:
        debug_dir = self.output_dir / "debug"
        debug_dir.mkdir(parents=True, exist_ok=True)
        (debug_dir / filename).write_text(str(content), encoding="utf-8")

    def _normalize_string_items(self, value: Any) -> List[str]:
        if value is None:
            return []
        if isinstance(value, str):
            parts = re.split(r"[\s,;/|]+", value)
            return sorted({part.strip().lower() for part in parts if part.strip()})
        if isinstance(value, list):
            result: List[str] = []
            for item in value:
                result.extend(self._normalize_string_items(item))
            return sorted(set(result))
        return [str(value).strip().lower()]

    def _build_template_retrieval_query(
        self,
        metadata: Dict[str, Any],
        *,
        ctx: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        geometry_context = GeometryContext.from_metadata(
            metadata,
            problem_text=str(metadata.get("problem_text", "")).strip(),
        )
        primitive_types = {
            str(item.get("type", "")).strip().lower()
            for item in geometry_context.shapes
            if isinstance(item, dict) and str(item.get("type", "")).strip()
        }
        if geometry_context.segments:
            primitive_types.add("segment")
        primitives = sorted(
            primitive_types
        )
        template_hints = self._normalize_string_items(
            geometry_context.templates or metadata.get("template_hints") or []
        )
        motions: List[str] = []
        tags = set(template_hints)
        summary_parts: List[str] = []

        if ctx:
            plan = ctx.get("animation_plan", {})
            animation_spec = ctx.get("animation_spec", {})
            summary_parts.extend(
                [
                    str(ctx.get("title", "")).strip(),
                    str(plan.get("title", "")).strip(),
                ]
            )
            for item in plan.get("actions") or []:
                if isinstance(item, dict) and str(item.get("type", "")).strip():
                    motions.append(str(item.get("type", "")).strip().lower())
            for field_name in (
                "movement_actions",
                "emphasis_actions",
                "label_actions",
                "restore_actions",
                "formula_actions",
            ):
                for item in animation_spec.get(field_name, []) or []:
                    if isinstance(item, dict) and str(item.get("type", "")).strip():
                        motions.append(str(item.get("type", "")).strip().lower())

        if "circle" in primitives:
            tags.add("circle")
        if "angle" in primitives or "right_angle" in primitives:
            tags.add("angle")
        if "arc" in primitives:
            tags.add("circle")
        if any(item in motions for item in {"move_point", "translation"}):
            tags.add("translation")
        if any(item in motions for item in {"transform", "rotation"}):
            tags.add("rotation")
        if "fold" in template_hints or "reflection" in template_hints:
            tags.add("fold")

        summary = " ".join(part for part in summary_parts if part).strip()
        return {
            "summary": summary,
            "tags": sorted(tags),
            "primitives": primitives,
            "motions": sorted(set(motions)),
            "helpers": [],
            "template_hints": template_hints,
        }

    def _annotate_template_references(
        self,
        metadata: Dict[str, Any],
        contexts: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        if not self.use_template_retrieval:
            metadata["template_references"] = []
            metadata["template_retrieval_query"] = {}
            metadata["template_retrieval_mode"] = "disabled"
            return []

        aggregate: Dict[str, Dict[str, Any]] = {}
        query_log: Dict[str, Any] = {
            "mode": self.template_retrieval_mode,
            "top_k": self.template_retrieval_top_k,
            "steps": [],
        }

        global_query = self._build_template_retrieval_query(metadata)
        query_log["global"] = global_query

        for ctx in contexts:
            step_query = self._build_template_retrieval_query(metadata, ctx=ctx)
            refs = [
                item.to_payload()
                for item in self.template_retriever.retrieve(
                    step_query, top_k=self.template_retrieval_top_k
                )
            ]
            ctx["retrieved_templates"] = refs
            query_log["steps"].append(
                {
                    "step_id": ctx.get("step_id"),
                    "query": step_query,
                    "result_ids": [item.get("id") for item in refs],
                }
            )
            for item in refs:
                current = aggregate.get(str(item.get("id")))
                if current is None or float(item.get("score", 0.0)) > float(
                    current.get("score", 0.0)
                ):
                    aggregate[str(item.get("id"))] = item

        if not aggregate:
            for item in self.template_retriever.retrieve(
                global_query, top_k=self.template_retrieval_top_k
            ):
                aggregate[item.id] = item.to_payload()

        ordered = sorted(
            aggregate.values(),
            key=lambda item: (-float(item.get("score", 0.0)), str(item.get("id", ""))),
        )
        metadata["template_references"] = ordered
        metadata["template_retrieval_query"] = query_log
        metadata["template_retrieval_mode"] = self.template_retrieval_mode
        return ordered

    def _format_template_references_for_prompt(
        self, references: List[Dict[str, Any]]
    ) -> str:
        if not references:
            return "无"
        chunks: List[str] = []
        for item in references[: max(1, self.template_retrieval_top_k + 1)]:
            chunks.append(
                "\n".join(
                    [
                        f"- 模板ID: {item.get('id', '')}",
                        f"  场景/片段: {item.get('snippet_name', '')}",
                        f"  摘要: {item.get('summary', '')}",
                        f"  命中原因: {item.get('reason', '')}",
                        f"  可用 helper: {', '.join(item.get('helpers', []) or []) or '无'}",
                        f"  参考代码片段:\n```python\n{item.get('excerpt', '')}\n```",
                    ]
                )
            )
        return "\n\n".join(chunks)

    def _summarize_template_adoption(
        self,
        manim_code: str,
        references: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        helper_hits = sorted(
            {
                helper
                for item in references
                for helper in (item.get("helpers") or [])
                if helper and re.search(rf"\b{re.escape(str(helper))}\b", manim_code)
            }
        )
        matched_reference_ids = sorted(
            {
                str(item.get("id"))
                for item in references
                if any(
                    helper and re.search(rf"\b{re.escape(str(helper))}\b", manim_code)
                    for helper in (item.get("helpers") or [])
                )
            }
        )
        return {
            "helper_hits": helper_hits,
            "matched_reference_ids": matched_reference_ids,
            "reference_count": len(references),
        }

    def _build_template_candidate(
        self,
        *,
        project: VideoProject,
        steps: List[ScriptStep],
        coordinate_scene_data: Optional[Dict[str, Any]],
        teaching_ir: Optional[Dict[str, Any]] = None,
        expected_steps: List[Dict[str, Any]],
        conservative: bool,
        adaptive_plan: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        candidate = {
            "ok": False,
            "mode": "template_conservative" if conservative else "template_formal",
            "fallback_level": "conservative" if conservative else "formal",
            "code": "",
            "contexts": [],
            "snapshots": [],
            "report": {},
            "error": None,
        }
        try:
            code, contexts, snapshots = self._generate_template_code_iteratively(
                project=project,
                steps=steps,
                coordinate_scene_data=coordinate_scene_data,
                teaching_ir=teaching_ir,
                expected_steps=expected_steps,
                conservative=conservative,
                adaptive_plan=adaptive_plan,
            )
            report = self._ensure_presentable_video_code(code, expected_steps)
            candidate.update(
                {
                    "ok": True,
                    "code": code,
                    "contexts": contexts,
                    "snapshots": snapshots,
                    "report": report,
                }
            )
        except Exception as exc:
            candidate["error"] = str(exc)
        return candidate

    def _build_llm_fallback_candidate(
        self,
        *,
        steps: List[ScriptStep],
        metadata: Dict[str, Any],
        expected_steps: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        candidate = {
            "ok": False,
            "mode": "llm_fallback",
            "fallback_level": "llm",
            "code": "",
            "contexts": [],
            "snapshots": [],
            "report": {},
            "error": None,
        }
        if self.llm is None:
            candidate["error"] = "llm is not configured"
            return candidate

        try:
            layout_selection = resolve_layout_scene(
                metadata,
                allow_semantic_fallback=True,
            )
            scene_payload = layout_selection["selected_scene"]
            geometry_context = GeometryContext.from_metadata(
                metadata,
                problem_text=str(metadata.get("problem_text", "")).strip(),
            )
            known_entities = sorted(
                {
                    *[str(item).strip() for item in geometry_context.points if str(item).strip()],
                    *[
                        str(item.get("label") or item.get("id") or "").strip()
                        for item in geometry_context.segments
                        if isinstance(item, dict)
                        and str(item.get("label") or item.get("id") or "").strip()
                    ],
                    *[
                        str(item.get("id", "")).strip()
                        for item in geometry_context.shapes
                        if isinstance(item, dict) and str(item.get("id", "")).strip()
                    ],
                }
            )
            template_references = metadata.get("template_references", [])
            visual_geometry_source = (
                metadata.get("visual_geometry_source")
                if isinstance(metadata.get("visual_geometry_source"), dict)
                else {}
            )
            visual_mode = str(
                visual_geometry_source.get("mode", "vector_reconstruction")
            )
            visual_image = str(visual_geometry_source.get("image_path", ""))
            prompt = (
                "请根据以下结构化几何信息与讲解脚本，输出完整可运行的 Manim 代码。\n"
                "必须满足音画同步与时长约束，禁止省略代码。\n\n"
                "[画布约束]\n"
                f"{self._build_canvas_instructions()}\n\n"
                "[几何呈现策略]\n"
                f"- 当前模式: {visual_mode}\n"
                f"- 原题图片路径: {visual_image or '无'}\n"
                "- 若当前模式为 image_overlay，必须按三层组织：Layer 1 用 ImageMobject 放原题图片底图；Layer 2 只叠加高亮、辅助线和临时标注；Layer 3 放右侧公式推导。\n"
                "- image_overlay 模式下不要用 Manim 全量重画主体题图，结构化坐标只作为叠加层对齐锚点。\n"
                "- 只有当前模式为 vector_reconstruction 时，才允许全矢量重建主体几何图形。\n\n"
                "- 当前视频统一使用浅色背景：推荐 self.camera.background_color = '#fbfaf7'；文字、公式、点标签使用 BLACK 或深灰；高亮使用 ORANGE/BLUE_E。\n"
                "- 几何图形必须以线框呈现：Polygon/Circle/闭合区域的 fill_opacity 必须为 0 或接近 0，不能用实体色块遮挡内部线段、点、折痕或辅助线。\n\n"
                "[已知几何实体 ID]\n"
                f"{', '.join(known_entities) if known_entities else '无'}\n\n"
                "[脚本步骤]\n"
                f"{self._format_script_for_prompt(steps)}\n\n"
                "[结构化几何 Scene]\n"
                f"{self._format_scene_graph_for_prompt(scene_payload)}\n\n"
                "[模板参考 - 只用于学习写法，不是答案]\n"
                f"{self._format_template_references_for_prompt(template_references)}\n\n"
                "[模板使用规则]\n"
                "- 这些模板只用于学习对象组织、动画写法和 helper 用法。\n"
                "- 绝对不能照搬模板里的坐标、点名、题设关系、整段场景流程。\n"
                "- 几何实体、位置、步骤顺序必须以当前题目的结构化数据为准。\n"
                "- 若模板与当前题目冲突，必须服从当前题目的 scene_graph / drawable_scene。\n"
                "- 如果借鉴 helper，请在生成代码里内联必要 helper，不要 import 外部模板文件。"
            )
            messages = self._format_messages(
                system_prompt=self.system_prompt, user_prompt=prompt
            )
            response = self._invoke_llm(messages)
            code = self._extract_code_block(response or "")
            if not str(code).strip():
                raise ValueError("llm returned empty code")

            report = self._ensure_presentable_video_code(code, expected_steps)
            candidate.update(
                {
                    "ok": True,
                    "code": str(code),
                    "report": report,
                }
            )
        except Exception as exc:
            candidate["error"] = str(exc)

        return candidate

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Generate formal Manim lecture-video code from validated geometry only."""
        project = state["project"]
        if getattr(project, "status", "") == "failed":
            return state

        script_steps = project.script_steps
        if not script_steps:
            state["messages"].append(
                {
                    "role": "assistant",
                    "content": "缺少讲解脚本步骤，无法生成正式讲解视频。",
                }
            )
            return state

        metadata = state.setdefault("metadata", {})
        perception_geometry_ir = (
            metadata.get("geometry_ir")
            if isinstance(metadata.get("geometry_ir"), dict)
            and str(metadata.get("geometry_ir", {}).get("version", "")).strip()
            == "geometry_ir.v1"
            else None
        )
        if perception_geometry_ir is not None:
            metadata["perception_geometry_ir"] = perception_geometry_ir
        adaptive_plan = (
            metadata.get("adaptive_plan")
            if isinstance(metadata.get("adaptive_plan"), dict)
            else {}
        )
        problem_text = str(getattr(project, "problem_text", "") or "")
        problem_constraints = (
            metadata.get("problem_constraints")
            if isinstance(metadata.get("problem_constraints"), dict)
            else {}
        )

        if problem_constraints.get("version") == "v1":
            problem_pattern = {
                "problem_pattern": problem_constraints.get("problem_pattern", ""),
                "sub_pattern": problem_constraints.get("sub_pattern", ""),
                "confidence": problem_constraints.get("confidence", 0.0),
                "requires_geometry_animation": problem_constraints.get(
                    "requires_geometry_animation", False
                ),
                "recommended_geometry_actions": problem_constraints.get(
                    "recommended_geometry_actions", []
                ),
                "source": "pre_planner",
            }
        else:
            problem_pattern = self.problem_pattern_classifier.classify(
                problem_text=problem_text,
                metadata=metadata,
            )
        metadata["problem_pattern"] = problem_pattern
        self._write_debug_json("problem_pattern.json", problem_pattern)

        coordinate_scene_verified = self._coordinate_scene_verified(metadata)
        problem_image_path = str(getattr(project, "problem_image", "") or "").strip()
        layout_selection = resolve_animation_layout(
            metadata,
            has_problem_image=bool(problem_image_path),
        )
        metadata["layout_contract"] = layout_selection["layout_contract"]
        animation_scene_data = layout_selection["selected_scene"]
        geometry_render_mode = layout_selection["geometry_render_mode"]
        selected_scene_source = layout_selection["selected_scene_source"]
        candidate_scenes = (
            layout_selection.get("candidate_scenes")
            if isinstance(layout_selection.get("candidate_scenes"), dict)
            else {}
        )

        crop_info = self._prepare_problem_figure_crop(
            problem_image_path,
            enabled=geometry_render_mode == "image_overlay",
        )
        calibration = (
            self._build_overlay_calibration(animation_scene_data, crop_info)
            if geometry_render_mode == "image_overlay"
            else {
                "version": "v1",
                "is_valid": False,
                "reason": "not_image_overlay",
            }
        )
        metadata["calibration"] = calibration
        if geometry_render_mode == "image_overlay" and not calibration.get("is_valid"):
            if self._can_use_uncalibrated_image_overlay(crop_info, calibration):
                calibration["overlay_fallback"] = "uncalibrated_image_overlay"
                state.setdefault("messages", []).append(
                    {
                        "role": "assistant",
                        "content": (
                            "原图叠加校准未通过，但几何截图可用；已保留原图作为底图，"
                            "避免矢量重建改变原始图形："
                            f"{calibration.get('reason', 'unknown')}"
                        ),
                    }
                )
            else:
                calibration["overlay_fallback"] = "rejected_uncalibrated_image_overlay"
                geometry_render_mode = "vector_reconstruction"
                contract = (
                    metadata.get("layout_contract")
                    if isinstance(metadata.get("layout_contract"), dict)
                    else {}
                )
                candidate_map = {
                    str(item.get("key", "")).strip(): item
                    for item in (contract.get("candidates") or [])
                    if isinstance(item, dict) and str(item.get("key", "")).strip()
                }
                coordinate_candidate = candidate_map.get("coordinate_scene")
                verified_coordinate_scene = (
                    candidate_scenes.get("coordinate_scene")
                    if isinstance(candidate_scenes.get("coordinate_scene"), dict)
                    else {}
                )
                drawable_candidate_scene = (
                    candidate_scenes.get("drawable_scene")
                    if isinstance(candidate_scenes.get("drawable_scene"), dict)
                    else {}
                )
                if (
                    coordinate_candidate
                    and coordinate_candidate.get("is_verified")
                    and self._has_drawable_geometry(verified_coordinate_scene)
                ):
                    animation_scene_data = verified_coordinate_scene
                    selected_scene_source = "coordinate_scene_verified"
                elif self._has_drawable_geometry(drawable_candidate_scene):
                    animation_scene_data = drawable_candidate_scene
                    selected_scene_source = (
                        "drawable_scene_soft_sketch"
                        if str(drawable_candidate_scene.get("layout_mode", "")).strip()
                        == "soft_sketch_reconstruction"
                        else "drawable_scene"
                    )
                metadata.setdefault("messages", [])
                state.setdefault("messages", []).append(
                    {
                        "role": "assistant",
                        "content": (
                            "原图叠加校准未通过，已切换为矢量重建几何图："
                            f"{calibration.get('reason', 'unknown')}"
                        ),
                    }
                )
        self._write_debug_json("calibration.json", calibration)
        animation_scene_data, render_topology_validation = (
            validate_and_filter_render_topology(
                animation_scene_data,
                perception_geometry_ir,
            )
        )
        metadata["render_topology_validation"] = render_topology_validation
        self._write_debug_json(
            "render_topology_validation.json",
            render_topology_validation,
        )
        visual_geometry_source = {
            "mode": geometry_render_mode,
            "image_path": (
                crop_info.get("crop_path") or problem_image_path
                if geometry_render_mode == "image_overlay"
                else ""
            ),
            "source_image_path": problem_image_path,
            "crop_bbox": crop_info.get("crop_bbox"),
            "crop_size": crop_info.get("crop_size"),
            "source_size": crop_info.get("source_size"),
            "crop_status": crop_info.get("crop_status"),
            "coordinate_transform": crop_info.get("coordinate_transform"),
            "selected_scene_source": selected_scene_source,
            "layout_contract_version": str(
                ((metadata.get("layout_contract") or {}).get("version", ""))
            ).strip(),
            "layout_ir_version": str(
                ((metadata.get("layout_ir") or {}).get("version", ""))
            ).strip(),
            "svg_path": crop_info.get("svg_path"),
            "svg_status": crop_info.get("svg_status"),
            "geometry_primitives_path": crop_info.get("geometry_primitives_path"),
            "vector_hints": crop_info.get("vector_hints"),
            "calibration": calibration,
            "render_topology_validation": render_topology_validation,
            "coordinate_scene_verified": coordinate_scene_verified,
            "layering": {
                "layer_1": "problem_image_base"
                if geometry_render_mode == "image_overlay"
                else "vector_geometry_base",
                "layer_2": "auxiliary_annotations",
                "layer_3": "formula_derivation",
            },
        }
        animation_scene_data = self._with_visual_geometry_source(
            animation_scene_data,
            visual_geometry_source,
        )
        layout_selection_metadata = (
            metadata.get("layout_selection")
            if isinstance(metadata.get("layout_selection"), dict)
            else {}
        )
        metadata["layout_selection"] = {
            "selected_scene_key": str(
                layout_selection_metadata.get("selected_scene_key", "")
            ).strip(),
            "selected_scene_source": selected_scene_source,
            "geometry_render_mode": geometry_render_mode,
            "layout_contract_version": visual_geometry_source[
                "layout_contract_version"
            ],
            "layout_ir_version": visual_geometry_source["layout_ir_version"],
        }
        metadata["visual_geometry_source"] = visual_geometry_source
        metadata["render_scene"] = animation_scene_data
        self._write_debug_json("render_scene.json", animation_scene_data)
        drawable_scene_presentable = self._has_drawable_geometry(animation_scene_data)

        # 非几何题：跳过几何 pipeline，直接用 LLM 生成文字/公式动画
        if not drawable_scene_presentable:
            return self._generate_text_only_video(
                state, script_steps, metadata, problem_text, adaptive_plan
            )

        teaching_geometry_ir = self.teaching_ir_planner.build_geometry_ir(
            metadata=metadata,
            problem_text=problem_text,
        )
        if not str(teaching_geometry_ir.get("problem_pattern", "")).strip():
            teaching_geometry_ir["problem_pattern"] = str(
                problem_pattern.get("problem_pattern", "")
            )
        if not str(teaching_geometry_ir.get("sub_pattern", "")).strip():
            teaching_geometry_ir["sub_pattern"] = str(
                problem_pattern.get("sub_pattern", "")
            )

        # 用预计算约束补全 geometry_ir（当 OCR 漏检时兜底）
        if problem_constraints.get("fold_axis") and not teaching_geometry_ir.get(
            "transform", {}
        ).get("fold_axis"):
            teaching_geometry_ir.setdefault("transform", {})["fold_axis"] = (
                problem_constraints["fold_axis"]
            )
        if problem_constraints.get("image_pairs") and not teaching_geometry_ir.get(
            "transform", {}
        ).get("image_pairs"):
            teaching_geometry_ir.setdefault("transform", {})["image_pairs"] = (
                problem_constraints["image_pairs"]
            )

        teaching_ir = self.teaching_ir_planner.build_teaching_ir(
            steps=script_steps,
            geometry_ir=teaching_geometry_ir,
            metadata=metadata,
            problem_text=problem_text,
        )

        teaching_ir, execution_check = (
            self.action_executability_checker.check_and_repair(
                teaching_ir=teaching_ir,
                geometry_ir=teaching_geometry_ir,
            )
        )

        if perception_geometry_ir is not None:
            metadata["geometry_ir"] = perception_geometry_ir
        else:
            metadata["geometry_ir"] = teaching_geometry_ir
        metadata["teaching_geometry_ir"] = teaching_geometry_ir
        metadata["teaching_ir"] = teaching_ir
        metadata["teaching_ir_execution_check"] = execution_check
        self._write_debug_json("geometry_ir.json", metadata["geometry_ir"])
        self._write_debug_json("teaching_geometry_ir.json", teaching_geometry_ir)
        self._write_debug_json("teaching_ir.json", teaching_ir)
        self._write_debug_json("teaching_ir_execution_check.json", execution_check)

        expected_steps = self._build_expected_steps(script_steps)
        if self.use_template_codegen:
            formal_candidate = self._build_template_candidate(
                project=project,
                steps=script_steps,
                coordinate_scene_data=animation_scene_data,
                teaching_ir=teaching_ir,
                expected_steps=expected_steps,
                conservative=False,
                adaptive_plan=adaptive_plan,
            )
            conservative_candidate = self._build_template_candidate(
                project=project,
                steps=script_steps,
                coordinate_scene_data=animation_scene_data,
                teaching_ir=teaching_ir,
                expected_steps=expected_steps,
                conservative=True,
                adaptive_plan=adaptive_plan,
            )
        else:
            formal_candidate = {
                "ok": False,
                "mode": "template_formal",
                "fallback_level": "formal",
                "code": "",
                "contexts": [],
                "snapshots": [],
                "report": {},
                "error": "template generation disabled by config",
            }
            conservative_candidate = {
                "ok": False,
                "mode": "template_conservative",
                "fallback_level": "conservative",
                "code": "",
                "contexts": [],
                "snapshots": [],
                "report": {},
                "error": "template generation disabled by config",
            }

        retrieval_contexts = list(
            formal_candidate["contexts"] or conservative_candidate["contexts"] or []
        )
        if not retrieval_contexts:
            retrieval_contexts = self._prepare_animation_context(
                script_steps,
                animation_scene_data,
                teaching_ir=teaching_ir,
            )
            self._attach_animation_specs(
                retrieval_contexts,
                base_coordinate_scene=animation_scene_data,
                conservative=False,
                adaptive_plan=adaptive_plan,
            )
        template_references = self._annotate_template_references(
            metadata, retrieval_contexts
        )
        self._write_debug_json("template_references.json", template_references)
        self._write_debug_json(
            "template_retrieval_query.json",
            metadata.get("template_retrieval_query", {}),
        )
        if formal_candidate["contexts"]:
            for src_ctx, retrieval_ctx in zip(
                formal_candidate["contexts"], retrieval_contexts
            ):
                src_ctx["retrieved_templates"] = list(
                    retrieval_ctx.get("retrieved_templates", [])
                )
        if conservative_candidate["contexts"]:
            for src_ctx, retrieval_ctx in zip(
                conservative_candidate["contexts"], retrieval_contexts
            ):
                src_ctx["retrieved_templates"] = list(
                    retrieval_ctx.get("retrieved_templates", [])
                )

        llm_fallback_candidate = {
            "ok": False,
            "mode": "llm_fallback",
            "fallback_level": "llm",
            "code": "",
            "contexts": [],
            "snapshots": [],
            "report": {},
            "error": "not attempted",
        }
        if not self.use_template_codegen or (
            not formal_candidate["ok"] and not conservative_candidate["ok"]
        ):
            llm_fallback_candidate = self._build_llm_fallback_candidate(
                steps=script_steps,
                metadata=metadata,
                expected_steps=expected_steps,
            )

        prefer_conservative = (
            self.prefer_conservative_on_complex
            and self.conservative_step_threshold > 0
            and len(script_steps) >= self.conservative_step_threshold
        )

        if prefer_conservative and conservative_candidate["ok"]:
            selected = conservative_candidate
        else:
            selected = (
                formal_candidate if formal_candidate["ok"] else conservative_candidate
            )

        if not selected["ok"] and llm_fallback_candidate["ok"]:
            selected = llm_fallback_candidate
        if not selected["ok"]:
            self._write_debug_json(
                "formal_validation.json",
                {
                    "selected_mode": None,
                    "candidates": {
                        "formal": {
                            "ok": formal_candidate["ok"],
                            "error": formal_candidate["error"],
                            "report": formal_candidate["report"],
                        },
                        "conservative": {
                            "ok": conservative_candidate["ok"],
                            "error": conservative_candidate["error"],
                            "report": conservative_candidate["report"],
                        },
                        "llm_fallback": {
                            "ok": llm_fallback_candidate["ok"],
                            "error": llm_fallback_candidate["error"],
                            "report": llm_fallback_candidate["report"],
                        },
                    },
                },
            )
            return self._fail_with_geometry_error(
                state,
                "模板路径未通过静态校验，且 LLM 兜底也失败；调试信息已保存到 debug/。",
                str(
                    formal_candidate["error"]
                    or conservative_candidate["error"]
                    or llm_fallback_candidate["error"]
                    or "animation generation failed"
                ),
            )

        manim_code = str(selected["code"])
        codegen_mode = str(selected["mode"])
        fallback_level = str(selected["fallback_level"])
        step_contexts = list(selected["contexts"])
        if not step_contexts and retrieval_contexts:
            step_contexts = retrieval_contexts
        step_codegen_snapshots = list(selected["snapshots"])
        validation_report = dict(selected["report"])
        step_specs = [ctx.get("animation_spec", {}) for ctx in step_contexts]
        template_adoption = self._summarize_template_adoption(
            manim_code, template_references
        )

        self._write_debug_json("step_contexts.json", step_contexts)
        self._write_debug_json("step_animation_specs.json", step_specs)
        self._write_debug_json("template_reference_adoption.json", template_adoption)
        self._write_debug_json(
            "formal_validation.json",
            {
                "selected_mode": codegen_mode,
                "prefer_conservative": prefer_conservative,
                "selected_report": validation_report,
                "candidates": {
                    "formal": {
                        "ok": formal_candidate["ok"],
                        "error": formal_candidate["error"],
                        "report": formal_candidate["report"],
                    },
                    "conservative": {
                        "ok": conservative_candidate["ok"],
                        "error": conservative_candidate["error"],
                        "report": conservative_candidate["report"],
                    },
                    "llm_fallback": {
                        "ok": llm_fallback_candidate["ok"],
                        "error": llm_fallback_candidate["error"],
                        "report": llm_fallback_candidate["report"],
                    },
                },
            },
        )
        self._write_debug_json("error_classification.json", {"render_error_code": None})
        self._write_debug_text("final_codegen_mode.txt", codegen_mode)

        class_match = re.search(r"class\s+(\w+)\s*\([^)]*Scene[^)]*\)", manim_code)
        class_name = class_match.group(1) if class_match else "MathAnimation"

        project.manim_class_name = class_name
        project.manim_file_path = "math_animation.py"
        project.audio_embedded = True

        state["project"] = project
        state["current_step"] = "animation_completed"
        state["messages"].append(
            {
                "role": "assistant",
                "content": f"正式 Manim 讲解脚本已生成：{project.manim_class_name}",
            }
        )

        if "metadata" not in state:
            state["metadata"] = {}
        state["metadata"]["manim_code"] = manim_code
        state["metadata"]["animation_step_contexts"] = step_contexts
        state["metadata"]["step_animation_specs"] = step_specs
        state["metadata"]["formal_validation"] = validation_report
        state["metadata"]["manim_codegen_mode"] = codegen_mode
        state["metadata"]["manim_code_candidates"] = {
            "template_formal": formal_candidate["code"],
            "template_conservative": conservative_candidate["code"],
            "llm_fallback": llm_fallback_candidate["code"],
        }
        state["metadata"]["validation_candidates"] = {
            "template_formal": formal_candidate["report"],
            "template_conservative": conservative_candidate["report"],
            "llm_fallback": llm_fallback_candidate["report"],
        }
        state["metadata"]["template_references"] = template_references
        state["metadata"]["template_retrieval_query"] = metadata.get(
            "template_retrieval_query", {}
        )
        state["metadata"]["template_retrieval_mode"] = metadata.get(
            "template_retrieval_mode", "component_hybrid"
        )
        state["metadata"]["template_reference_adoption"] = template_adoption
        state["metadata"]["fallback_level"] = fallback_level
        state["metadata"]["render_error_code"] = None
        state["metadata"]["geometry_ir"] = metadata["geometry_ir"]
        state["metadata"]["teaching_geometry_ir"] = teaching_geometry_ir
        if perception_geometry_ir is not None:
            state["metadata"]["perception_geometry_ir"] = perception_geometry_ir
        state["metadata"]["render_scene"] = animation_scene_data
        state["metadata"]["render_topology_validation"] = render_topology_validation
        state["metadata"]["teaching_ir"] = teaching_ir
        state["metadata"]["problem_pattern"] = problem_pattern
        state["metadata"]["teaching_ir_execution_check"] = execution_check
        if step_codegen_snapshots:
            state["metadata"]["animation_step_codegen_snapshots"] = (
                step_codegen_snapshots
            )

        case_path = self.case_replay_recorder.record(
            output_dir=self.output_dir,
            payload={
                "problem_text": problem_text[:240],
                "problem_pattern": str(problem_pattern.get("problem_pattern", "")),
                "sub_pattern": str(problem_pattern.get("sub_pattern", "")),
                "geometry_ir_version": str(
                    (perception_geometry_ir or teaching_geometry_ir).get("version", "v1")
                ),
                "teaching_geometry_ir_version": str(
                    teaching_geometry_ir.get("version", "v1")
                ),
                "teaching_ir_version": str(teaching_ir.get("version", "v1")),
                "execution_check": execution_check,
                "render_result": {
                    "status": "success",
                    "manim_codegen_mode": codegen_mode,
                },
            },
        )
        state["metadata"]["case_record_path"] = case_path

        return state

    def _prepare_animation_context(
        self,
        steps: List[ScriptStep],
        coordinate_scene_data: Optional[Dict[str, Any]],
        teaching_ir: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        canvas_scene = CanvasScene(
            max_formula_slots=max(
                1, int(self.canvas_config.get("formula_max_visible_slots", 8))
            )
        )
        contexts: List[Dict[str, Any]] = []
        cumulative = 0.0
        running_scene = self._build_animation_base_scene(coordinate_scene_data)

        for index, step in enumerate(steps, start=1):
            teaching_step = self.teaching_ir_planner.get_step_plan(
                teaching_ir,
                step_id=getattr(step, "id", index),
                fallback_index=index,
            )
            planner_step = self._merge_teaching_step_fields(step, teaching_step)
            raw_step_scene = self.scene_graph_updater.build_step_scene(
                base_scene_graph=running_scene,
                step=step,
                step_index=index,
                teaching_step=teaching_step,
            )
            step_scene = self._normalize_step_scene_geometry(
                running_scene,
                raw_step_scene,
                step_index=index,
            )
            running_scene = step_scene.get("scene", running_scene)
            plan = self.animation_planner.plan_step(planner_step, step_scene, cumulative)
            layout = self._layout_step_canvas(canvas_scene, plan)

            contexts.append(
                {
                    "step_id": step.id,
                    "title": step.title,
                    "step_scene": step_scene,
                    "animation_plan": plan,
                    "canvas_layout": layout,
                    "teaching_step": teaching_step,
                }
            )
            cumulative += plan["duration"]

        return contexts

    def _generate_template_code_iteratively(
        self,
        project: VideoProject,
        steps: List[ScriptStep],
        coordinate_scene_data: Optional[Dict[str, Any]],
        teaching_ir: Optional[Dict[str, Any]] = None,
        *,
        expected_steps: List[Dict[str, Any]],
        conservative: bool,
        adaptive_plan: Optional[Dict[str, Any]] = None,
    ) -> Tuple[str, List[Dict[str, Any]], List[Dict[str, Any]]]:
        canvas_scene = CanvasScene(
            max_formula_slots=max(
                1, int(self.canvas_config.get("formula_max_visible_slots", 8))
            )
        )
        cumulative = 0.0
        contexts: List[Dict[str, Any]] = []
        snapshots: List[Dict[str, Any]] = []
        manim_code = ""

        base_coordinate_scene = self._build_animation_base_scene(coordinate_scene_data)
        running_scene = base_coordinate_scene

        for index, step in enumerate(steps, start=1):
            teaching_step = self.teaching_ir_planner.get_step_plan(
                teaching_ir,
                step_id=getattr(step, "id", index),
                fallback_index=index,
            )
            planner_step = self._merge_teaching_step_fields(step, teaching_step)
            raw_step_scene = self.scene_graph_updater.build_step_scene(
                base_scene_graph=running_scene,
                step=step,
                step_index=index,
                teaching_step=teaching_step,
            )
            step_scene = self._normalize_step_scene_geometry(
                running_scene,
                raw_step_scene,
                step_index=index,
            )
            running_scene = step_scene.get("scene", running_scene)
            plan = self.animation_planner.plan_step(planner_step, step_scene, cumulative)
            layout = self._layout_step_canvas(canvas_scene, plan)

            ctx = {
                "step_id": step.id,
                "title": step.title,
                "step_scene": step_scene,
                "animation_plan": plan,
                "canvas_layout": layout,
                "teaching_step": teaching_step,
            }
            contexts.append(ctx)

            if self.export_incremental_codegen_debug:
                self._attach_animation_specs(
                    contexts,
                    base_coordinate_scene=base_coordinate_scene,
                    conservative=conservative,
                    adaptive_plan=adaptive_plan,
                )
            snapshot = {
                "step_id": step.id,
                "code_length": None,
                "debug_code_path": None,
                "context": ctx,
            }
            if self.export_incremental_codegen_debug:
                partial_code = self.template_codegen.generate(
                    project=project,
                    coordinate_scene_data=base_coordinate_scene,
                    step_contexts=contexts,
                )
                self._ensure_presentable_video_code(
                    partial_code,
                    expected_steps=expected_steps[: len(contexts)],
                )
                snapshot["code_length"] = len(partial_code)
                snapshot["debug_code_path"] = self._export_step_debug_code(
                    index,
                    partial_code,
                    "conservative" if conservative else "formal",
                )
            snapshots.append(snapshot)
            cumulative += plan["duration"]

        if not self.export_incremental_codegen_debug:
            self._attach_animation_specs(
                contexts,
                base_coordinate_scene=base_coordinate_scene,
                conservative=conservative,
                adaptive_plan=adaptive_plan,
            )

        manim_code = self.template_codegen.generate(
            project=project,
            coordinate_scene_data=base_coordinate_scene,
            step_contexts=contexts,
        )
        self._ensure_presentable_video_code(
            manim_code,
            expected_steps=expected_steps,
        )
        if snapshots:
            snapshots[-1]["code_length"] = len(manim_code)
            if not snapshots[-1].get("debug_code_path"):
                snapshots[-1]["debug_code_path"] = self._export_step_debug_code(
                    len(contexts),
                    manim_code,
                    "conservative" if conservative else "formal",
                )

        return manim_code, contexts, snapshots
