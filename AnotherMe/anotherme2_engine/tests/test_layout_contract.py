import unittest

from agents.perception.layout_ir import build_layout_ir, build_layout_ir_from_scenes
from agents.perception.layout_contract import (
    build_layout_contract,
    resolve_animation_layout,
    resolve_layout_scene,
)


class LayoutContractTests(unittest.TestCase):
    def test_build_layout_ir_normalizes_solver_and_drawable_candidates(self) -> None:
        metadata = {
            "drawable_scene": {
                "layout_mode": "soft_sketch_reconstruction",
                "points": {"A": {"coord": [0, 0]}, "B": {"coord": [1, 0]}},
                "primitives": [
                    {"id": "seg_AB", "type": "segment", "points": ["A", "B"]}
                ],
            },
            "drawable_scene_source": "soft_sketch_from_normalized_geometry_spec",
            "coordinate_scene": {
                "mode": "2d",
                "points": [{"id": "A", "coord": [0, 0]}, {"id": "B", "coord": [1, 0]}],
                "primitives": [
                    {"id": "seg_AB", "type": "segment", "points": ["A", "B"]}
                ],
            },
            "coordinate_scene_validation": {"is_valid": True, "failed_checks": []},
        }

        layout_ir = build_layout_ir(metadata)

        self.assertEqual("layout_ir.v1", layout_ir["version"])
        self.assertTrue(layout_ir["coordinate_scene_verified"])
        candidate_keys = [item["scene_key"] for item in layout_ir["candidates"]]
        self.assertEqual(["drawable_scene", "coordinate_scene"], candidate_keys)
        self.assertEqual(
            "soft_sketch_reconstruction",
            layout_ir["candidates"][0]["scene_payload"]["layout_mode"],
        )

    def test_build_layout_ir_from_scenes_preserves_coordinate_scene_measurements(self) -> None:
        layout_ir = build_layout_ir_from_scenes(
            drawable_scene=None,
            coordinate_scene={
                "mode": "2d",
                "points": [{"id": "A", "coord": [0, 0]}, {"id": "B", "coord": [1, 0]}],
                "primitives": [{"id": "seg_AB", "type": "segment", "points": ["A", "B"]}],
                "measurements": [{"type": "length", "entities": ["A", "B"], "value": 1}],
            },
            coordinate_scene_verified=True,
        )

        coordinate_candidate = layout_ir["candidates"][0]
        self.assertEqual("coordinate_scene", coordinate_candidate["scene_key"])
        self.assertEqual(
            1,
            coordinate_candidate["scene_payload"]["measurements"][0]["value"],
        )

    def test_build_layout_contract_prefers_soft_sketch_drawable_scene(self) -> None:
        metadata = {
            "drawable_scene": {
                "layout_mode": "soft_sketch_reconstruction",
                "points": {"A": {"coord": [0, 0]}, "B": {"coord": [1, 0]}},
                "primitives": [
                    {"id": "seg_AB", "type": "segment", "points": ["A", "B"]}
                ],
            },
            "drawable_scene_source": "soft_sketch_from_normalized_geometry_spec",
            "coordinate_scene": {
                "mode": "2d",
                "points": [{"id": "A", "coord": [0, 0]}, {"id": "B", "coord": [1, 0]}],
                "primitives": [
                    {"id": "seg_AB", "type": "segment", "points": ["A", "B"]}
                ],
            },
            "coordinate_scene_validation": {"is_valid": True, "failed_checks": []},
        }

        contract = build_layout_contract(metadata)

        self.assertEqual("layout_contract.v1", contract["version"])
        self.assertEqual("layout_ir.v1", contract["layout_ir_version"])
        self.assertEqual("drawable_scene", contract["default_scene_key"])
        self.assertEqual("soft_sketch_priority", contract["default_selection_reason"])

    def test_resolve_animation_layout_honors_render_review_override(self) -> None:
        metadata = {
            "drawable_scene": {
                "layout_mode": "soft_sketch_reconstruction",
                "points": {"A": {"coord": [0, 0]}, "B": {"coord": [1, 0]}},
                "primitives": [
                    {"id": "seg_AB", "type": "segment", "points": ["A", "B"]}
                ],
            },
            "drawable_scene_source": "soft_sketch_from_normalized_geometry_spec",
            "coordinate_scene": {
                "mode": "2d",
                "points": [{"id": "A", "coord": [0, 0]}, {"id": "B", "coord": [1, 0]}],
                "primitives": [
                    {"id": "seg_AB", "type": "segment", "points": ["A", "B"]}
                ],
            },
            "coordinate_scene_validation": {"is_valid": True, "failed_checks": []},
            "render_review_prefer_verified_coordinate_scene": True,
        }

        selection = resolve_animation_layout(metadata, has_problem_image=True)

        self.assertEqual(
            "coordinate_scene_forced_by_render_review",
            selection["selected_scene_source"],
        )
        self.assertEqual("coordinate_scene", selection["selected_scene_key"])
        self.assertEqual("vector_reconstruction", selection["geometry_render_mode"])

    def test_resolve_layout_scene_allows_semantic_fallback_when_no_layout_scene(self) -> None:
        metadata = {
            "semantic_graph": {
                "points": {"A": {"coord": [0, 0]}, "B": {"coord": [1, 0]}},
                "primitives": [
                    {"id": "seg_AB", "type": "segment", "points": ["A", "B"]}
                ],
            }
        }

        selection = resolve_layout_scene(metadata, allow_semantic_fallback=True)

        self.assertEqual("semantic_graph", selection["selected_scene_key"])
        self.assertEqual("semantic_graph_fallback", selection["selected_scene_source"])


if __name__ == "__main__":
    unittest.main()
