"""
题型预规划器 — 在脚本生成之前确定问题类型约束。

纯函数计算，不调用 LLM。与 LearnerModelingAgent 并行执行，
将结构化的题型约束（折叠轴、运动部分、像点对等）注入
metadata["problem_constraints"]，供 ScriptAgent 和 AnimationAgent 消费。
"""

from __future__ import annotations

from typing import Any, Dict, List

from .problem_pattern import ProblemPatternClassifier
from .teaching_ir import TeachingIRPlanner


class ProblemTypePrePlanner:
    """Pre-compute problem-type constraints before script generation."""

    def __init__(self) -> None:
        self.pattern_classifier = ProblemPatternClassifier()
        self.teaching_ir_planner = TeachingIRPlanner()

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        project = state.get("project")
        if project is None or getattr(project, "status", "") == "failed":
            return state

        metadata = state.setdefault("metadata", {})
        problem_text = str(getattr(project, "problem_text", "") or "")

        pattern_result = self.pattern_classifier.classify(
            problem_text=problem_text,
            metadata=metadata,
        )

        geometry_ir = self.teaching_ir_planner.build_geometry_ir(
            metadata=metadata,
            problem_text=problem_text,
        )

        problem_type = str(geometry_ir.get("problem_type", "geometry_static")).strip()
        fold_axis = str(geometry_ir.get("transform", {}).get("fold_axis", "")).strip()
        image_pairs = list(geometry_ir.get("transform", {}).get("image_pairs", []))

        moving_part: List[str] = []
        fixed_part: List[str] = []
        if problem_type == "fold_transform" and image_pairs:
            moving_part, fixed_part = self.teaching_ir_planner._compute_fold_parts(
                image_pairs=image_pairs,
                geometry_ir=geometry_ir,
            )

        problem_constraints: Dict[str, Any] = {
            "version": "v1",
            "problem_type": problem_type,
            "problem_pattern": str(pattern_result.get("problem_pattern", "")).strip(),
            "sub_pattern": str(pattern_result.get("sub_pattern", "")).strip(),
            "confidence": float(pattern_result.get("confidence", 0.0) or 0.0),
            "presentation_mode": str(pattern_result.get("presentation_mode", "")).strip(),
            "reasoning_mode": str(pattern_result.get("reasoning_mode", "")).strip(),
            "requires_geometry_animation": bool(pattern_result.get("requires_geometry_animation", False)),
            "recommended_geometry_actions": list(pattern_result.get("recommended_geometry_actions") or []),
            "fold_axis": fold_axis,
            "moving_part": list(moving_part),
            "fixed_part": list(fixed_part),
            "image_pairs": image_pairs,
        }

        metadata["problem_constraints"] = problem_constraints

        messages = state.setdefault("messages", [])
        messages.append({
            "role": "assistant",
            "content": (
                "题型预分析完成："
                f"type={problem_type}，"
                f"pattern={pattern_result.get('problem_pattern', '')}，"
                f"confidence={pattern_result.get('confidence', 0.0)}"
            ),
        })
        state["current_step"] = "pre_planning_completed"
        return state
