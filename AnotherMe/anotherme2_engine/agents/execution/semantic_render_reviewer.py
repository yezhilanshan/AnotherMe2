"""Model-backed source-vs-render reviewer that only emits IR-scoped corrections."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional


class SemanticRenderReviewer:
    """Compare source image and rendered frame with constrained structured output."""

    def __init__(self, vision_tool: Optional[Any] = None):
        self.vision_tool = vision_tool

    def review(
        self,
        *,
        source_image_path: str,
        rendered_frame_path: str,
        problem_text: str,
        geometry_ir: Optional[Dict[str, Any]],
        render_scene: Optional[Dict[str, Any]],
        render_review: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        report = {
            "version": "semantic_render_review.v1",
            "status": "skipped",
            "reason": "",
            "overall_match": "unknown",
            "confidence": 0.0,
            "summary": "",
            "issues": [],
            "corrections": [],
        }
        if self.vision_tool is None:
            report["reason"] = "vision_tool_unavailable"
            return report
        if not source_image_path or not Path(source_image_path).exists():
            report["reason"] = "missing_source_image"
            return report
        if not rendered_frame_path or not Path(rendered_frame_path).exists():
            report["reason"] = "missing_rendered_frame"
            return report

        prompt = self._build_prompt(
            problem_text=problem_text,
            geometry_ir=geometry_ir,
            render_scene=render_scene,
            render_review=render_review,
        )
        raw = self.vision_tool.analyze_images(
            [source_image_path, rendered_frame_path],
            prompt,
            model_role="geometry",
        )
        report["raw_response"] = str(raw or "")[:4000]
        parsed = self._parse_review(raw)
        report.update(parsed)
        return report

    def _build_prompt(
        self,
        *,
        problem_text: str,
        geometry_ir: Optional[Dict[str, Any]],
        render_scene: Optional[Dict[str, Any]],
        render_review: Optional[Dict[str, Any]],
    ) -> str:
        source_summary = (
            render_review.get("source_summary")
            if isinstance(render_review, dict)
            and isinstance(render_review.get("source_summary"), dict)
            else {}
        )
        deterministic_failures = (
            render_review.get("failed_checks")
            if isinstance(render_review, dict)
            and isinstance(render_review.get("failed_checks"), list)
            else []
        )
        return (
            "你会看到两张图片：第一张是原始几何题图，第二张是当前系统渲染后的结果帧。\n"
            "你的任务不是重写代码，也不是发明新拓扑，而是做结构化评审，并只输出 GeometryIR 级别的 corrections。\n"
            "必须遵守：\n"
            "1. 不允许输出任何 Manim 代码。\n"
            "2. 不允许建议新增视觉上不存在的边或点。\n"
            "3. correction 只能来自以下动作：remove_segment, set_segment_style, set_label_direction, prefer_vector_reconstruction, update_fold_correspondence, flag_wrong_overall_shape。\n"
            "4. 如果不确定，写 issues 但不要给 correction。\n"
            "5. 重点检查：点线数量、虚线/实线、标签位置、折叠对应、是否出现错误完整大菱形或整体形状错误。\n\n"
            f"题干 OCR:\n{str(problem_text or '').strip()}\n\n"
            f"当前 GeometryIR 版本: {str((geometry_ir or {}).get('version', ''))}\n"
            f"当前 render scene 摘要: {json.dumps(source_summary, ensure_ascii=False)}\n"
            f"当前 deterministic review 失败项: {json.dumps(deterministic_failures, ensure_ascii=False)}\n\n"
            "严格输出 JSON，对象格式如下：\n"
            "{\n"
            '  "version": "semantic_render_review.v1",\n'
            '  "status": "ok|needs_correction|major_mismatch",\n'
            '  "overall_match": "match|minor_mismatch|major_mismatch",\n'
            '  "confidence": 0.0,\n'
            '  "summary": "一句话总结",\n'
            '  "issues": [\n'
            "    {\n"
            '      "type": "missing_segment|extra_segment|dashed_solid_mismatch|label_misplaced|fold_mismatch|wrong_overall_shape|point_count_mismatch",\n'
            '      "severity": "warning|error",\n'
            '      "target": {"segment_id": "seg_AB", "points": ["A","B"]},\n'
            '      "evidence": "简短证据"\n'
            "    }\n"
            "  ],\n"
            '  "corrections": [\n'
            "    {\n"
            '      "action": "remove_segment|set_segment_style|set_label_direction|prefer_vector_reconstruction|update_fold_correspondence|flag_wrong_overall_shape",\n'
            '      "target": {"segment_id": "seg_AB", "points": ["A","B"], "style": "dashed", "point_id": "A", "label_direction": "up_right", "source": "B", "image": "B\\\'", "expected_template": "fold_transform", "bad_shape": "wrong_complete_rhombus"},\n'
            '      "confidence": 0.0,\n'
            '      "rationale": "简短原因"\n'
            "    }\n"
            "  ]\n"
            "}\n"
        )

    def _parse_review(self, raw: Any) -> Dict[str, Any]:
        fallback = {
            "status": "unparsed",
            "reason": "invalid_json",
            "overall_match": "unknown",
            "confidence": 0.0,
            "summary": "",
            "issues": [],
            "corrections": [],
        }
        text = str(raw or "").strip()
        if not text:
            fallback["reason"] = "empty_response"
            return fallback
        candidates = [text]
        fenced = re.search(r"```json\s*([\s\S]*?)\s*```", text, flags=re.IGNORECASE)
        if fenced:
            candidates.append(fenced.group(1).strip())
        braced = re.search(r"\{[\s\S]*\}", text)
        if braced:
            candidates.append(braced.group(0))
        for candidate in candidates:
            normalized = self._clean_json_like_text(candidate)
            try:
                payload = json.loads(normalized)
            except json.JSONDecodeError:
                continue
            return {
                "status": str(payload.get("status", "unparsed")).strip() or "unparsed",
                "reason": "",
                "overall_match": str(payload.get("overall_match", "unknown")).strip()
                or "unknown",
                "confidence": self._coerce_float(payload.get("confidence"), default=0.0),
                "summary": str(payload.get("summary", "")).strip(),
                "issues": payload.get("issues") if isinstance(payload.get("issues"), list) else [],
                "corrections": payload.get("corrections")
                if isinstance(payload.get("corrections"), list)
                else [],
            }
        return fallback

    def _clean_json_like_text(self, text: str) -> str:
        cleaned = str(text or "")
        cleaned = re.sub(r"```json\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = cleaned.replace("```", "")
        cleaned = re.sub(r"//.*?$", "", cleaned, flags=re.MULTILINE)
        cleaned = re.sub(r"/\*[\s\S]*?\*/", "", cleaned)
        cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
        return cleaned.strip()

    def _coerce_float(self, value: Any, *, default: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default
