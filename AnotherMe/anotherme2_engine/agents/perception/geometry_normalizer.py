"""Explicit GeometryIR-first normalization boundary."""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from .geometry_ir import (
    build_geometry_ir,
    build_scene_draft,
    compiler_facts_from_geometry_ir,
)


class GeometryNormalizer:
    """Single merge point for scene-draft and GeometryIR construction."""

    def normalize(
        self,
        geometry_facts: Optional[Dict[str, Any]],
        *,
        problem_text: str,
        image_size: Optional[Tuple[Optional[int], Optional[int]]] = None,
        scene_draft: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Dict[str, Any]]:
        draft = self.build_scene_draft(
            geometry_facts,
            problem_text=problem_text,
            image_size=image_size,
        )
        if isinstance(scene_draft, dict):
            draft = scene_draft
        geometry_ir = self.build_geometry_ir(
            geometry_facts,
            problem_text=problem_text,
            image_size=image_size,
            scene_draft=draft,
        )
        return {
            "scene_draft": draft,
            "geometry_ir": geometry_ir,
        }

    def build_scene_draft(
        self,
        geometry_facts: Optional[Dict[str, Any]],
        *,
        problem_text: str = "",
        image_size: Optional[Tuple[Optional[int], Optional[int]]] = None,
    ) -> Dict[str, Any]:
        return build_scene_draft(
            geometry_facts,
            problem_text=problem_text,
            image_size=image_size,
        )

    def build_geometry_ir(
        self,
        geometry_facts: Optional[Dict[str, Any]],
        *,
        problem_text: str,
        image_size: Optional[Tuple[Optional[int], Optional[int]]] = None,
        scene_draft: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return build_geometry_ir(
            geometry_facts,
            problem_text=problem_text,
            scene_draft=scene_draft,
            image_size=image_size,
        )

    def compiler_facts(
        self,
        geometry_ir: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        if not isinstance(geometry_ir, dict):
            return {}
        return compiler_facts_from_geometry_ir(geometry_ir)
