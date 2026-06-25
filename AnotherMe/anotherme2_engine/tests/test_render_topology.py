import unittest
from tempfile import TemporaryDirectory

from agents.execution.animation_agent import AnimationAgent
from agents.execution.render_topology import validate_and_filter_render_topology
from agents.foundation.state import ScriptStep, VideoProject


class RenderTopologyTests(unittest.TestCase):
    def test_filter_rejects_undeclared_fold_segments_before_render(self) -> None:
        geometry_ir = {
            "version": "geometry_ir.v1",
            "scene_draft": {
                "visible_segments": [
                    {"id": "seg_AD", "points": ["A", "D"]},
                    {"id": "seg_DE", "points": ["D", "E"]},
                    {"id": "seg_EB'", "points": ["E", "B'"]},
                    {"id": "seg_B'C'", "points": ["B'", "C'"]},
                    {"id": "seg_C'D", "points": ["C'", "D"]},
                ]
            },
            "facts": {
                "visual_observed": {
                    "segments": ["AD", "DE", "EB'", "B'C'", "C'D"],
                    "polygons": ["ADC'B'E"],
                },
                "text_explicit": {"relations": [], "measurements": []},
                "solver_derived": {"relations": [], "measurements": []},
            },
            "geometry_facts": {"display": {"primitives": {}}},
        }
        scene = {
            "points": {
                "A": {"pos": [0, 0]},
                "B": {"pos": [1, 0]},
                "D": {"pos": [0, 1]},
                "E": {"pos": [0.5, 0]},
                "B'": {"pos": [1, 1]},
                "C'": {"pos": [2, 1]},
            },
            "primitives": [
                {"id": "seg_AD", "type": "segment", "points": ["A", "D"]},
                {"id": "seg_EB'", "type": "segment", "points": ["E", "B'"]},
                {"id": "seg_AB'", "type": "segment", "points": ["A", "B'"]},
                {"id": "seg_BB'", "type": "segment", "points": ["B", "B'"]},
                {"id": "poly_AB'C'D", "type": "polygon", "points": ["A", "B'", "C'", "D"]},
            ],
        }

        filtered, report = validate_and_filter_render_topology(scene, geometry_ir)
        kept_ids = {
            item["id"]
            for item in filtered.get("primitives", [])
            if isinstance(item, dict)
        }
        rejected_ids = {item["id"] for item in report["rejected"]}

        self.assertFalse(report["is_valid"])
        self.assertIn("seg_AD", kept_ids)
        self.assertIn("seg_EB'", kept_ids)
        self.assertNotIn("seg_AB'", kept_ids)
        self.assertNotIn("seg_BB'", kept_ids)
        self.assertNotIn("poly_AB'C'D", kept_ids)
        self.assertIn("seg_AB'", rejected_ids)
        self.assertIn("seg_BB'", rejected_ids)
        self.assertIn("poly_AB'C'D", rejected_ids)

    def test_filter_allows_approved_auxiliary_display_segment(self) -> None:
        geometry_ir = {
            "version": "geometry_ir.v1",
            "scene_draft": {"visible_segments": []},
            "facts": {
                "visual_observed": {"segments": ["AB"]},
                "text_explicit": {"relations": [], "measurements": []},
                "solver_derived": {"relations": [], "measurements": []},
            },
            "geometry_facts": {
                "display": {
                    "primitives": {
                        "seg_CD": {
                            "style": "dashed",
                            "role": "construction",
                            "source": "approved_auxiliary",
                        }
                    }
                }
            },
        }
        scene = {
            "points": {
                "A": {"pos": [0, 0]},
                "B": {"pos": [1, 0]},
                "C": {"pos": [0, 1]},
                "D": {"pos": [1, 1]},
            },
            "primitives": [
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "seg_CD", "type": "segment", "points": ["C", "D"]},
            ],
        }

        filtered, report = validate_and_filter_render_topology(scene, geometry_ir)
        kept_ids = {
            item["id"]
            for item in filtered.get("primitives", [])
            if isinstance(item, dict)
        }

        self.assertTrue(report["is_valid"])
        self.assertEqual({"seg_AB", "seg_CD"}, kept_ids)

    def test_filter_does_not_let_text_explicit_create_drawable_topology(self) -> None:
        geometry_ir = {
            "version": "geometry_ir.v1",
            "scene_draft": {"visible_segments": [{"points": ["A", "B"]}]},
            "facts": {
                "visual_observed": {"segments": ["AB"], "polygons": []},
                "text_explicit": {
                    "relations": [{"type": "parallel", "segments": ["AB", "CD"]}],
                    "measurements": [{"segment": "CD", "value": "3"}],
                },
                "solver_derived": {"relations": [], "measurements": []},
            },
            "geometry_facts": {"display": {"primitives": {}}},
        }
        scene = {
            "points": {
                "A": {"pos": [0, 0]},
                "B": {"pos": [1, 0]},
                "C": {"pos": [0, 1]},
                "D": {"pos": [1, 1]},
            },
            "primitives": [
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "seg_CD", "type": "segment", "points": ["C", "D"]},
            ],
        }

        filtered, report = validate_and_filter_render_topology(scene, geometry_ir)
        kept_ids = {
            item["id"]
            for item in filtered.get("primitives", [])
            if isinstance(item, dict)
        }

        self.assertFalse(report["is_valid"])
        self.assertEqual({"seg_AB"}, kept_ids)
        self.assertEqual(["AB"], report["allowed_pairs"])
        self.assertNotIn("text_explicit.relations", report["allowed_sources"].get("CD", []))
        self.assertEqual("seg_CD", report["rejected"][0]["id"])

    def test_filter_preserves_fold_prime_aliases_and_display_policy(self) -> None:
        geometry_ir = {
            "version": "geometry_ir.v1",
            "scene_draft": {
                "points": [{"id": "A"}, {"id": "B"}, {"id": "C"}, {"id": "D"}, {"id": "E"}, {"id": "B'"}, {"id": "C'"}],
                "visible_segments": [
                    {"id": "seg_AD", "points": ["A", "D"], "style": "solid", "visible": True},
                    {"id": "seg_AB", "points": ["A", "B"], "visible": False},
                    {"id": "seg_DE", "points": ["D", "E"], "style": "solid", "visible": True},
                    {"id": "seg_AE", "points": ["A", "E"], "style": "solid", "visible": True},
                    {"id": "seg_EB'", "points": ["E", "B'"], "style": "solid", "visible": True},
                    {"id": "seg_B'C'", "points": ["B'", "C'"], "style": "solid", "visible": True},
                    {"id": "seg_C'D", "points": ["C'", "D"], "style": "solid", "visible": True},
                    {"id": "seg_EB", "points": ["E", "B"], "style": "dashed", "visible": True},
                    {"id": "seg_BC", "points": ["B", "C"], "style": "dashed", "visible": True},
                    {"id": "seg_CD", "points": ["C", "D"], "style": "dashed", "visible": True},
                ],
                "display": {
                    "primitives": {
                        "seg_AB": {"show": False, "role": "decomposed_by_fold_template"},
                        "seg_EB": {"style": "dashed", "role": "pre_fold_reference", "source": "fold_template"},
                        "seg_BC": {"style": "dashed", "role": "pre_fold_reference", "source": "fold_template"},
                        "seg_CD": {"style": "dashed", "role": "pre_fold_reference", "source": "fold_template"},
                        "seg_EB'": {"style": "solid", "role": "folded_visible", "source": "fold_template"},
                        "seg_B'C'": {"style": "solid", "role": "folded_visible", "source": "fold_template"},
                        "seg_C'D": {"style": "solid", "role": "folded_visible", "source": "fold_template"},
                    }
                },
            },
            "facts": {
                "visual_observed": {
                    "segments": ["AD", "AB", "DE", "AE", "EB'", "B'C'", "C'D", "EB", "BC", "CD"],
                    "polygons": [],
                },
                "text_explicit": {"relations": [], "measurements": []},
                "solver_derived": {"relations": [], "measurements": []},
            },
            "geometry_facts": {"display": {"primitives": {}}},
        }
        scene = {
            "points": [
                {"id": "A", "pos": [0, 1], "label": "A"},
                {"id": "B", "pos": [-1, -1], "label": "B"},
                {"id": "C", "pos": [1, -1], "label": "C"},
                {"id": "D", "pos": [2, 1], "label": "D"},
                {"id": "E", "pos": [-0.5, 0], "label": "E"},
                {"id": "B1", "pos": [-2, 0], "label": "B'"},
                {"id": "C1", "pos": [-1, 2], "label": "C'"},
            ],
            "primitives": [
                {"id": "seg_AD", "type": "segment", "points": ["A", "D"]},
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "seg_DE", "type": "segment", "points": ["D", "E"]},
                {"id": "seg_AE", "type": "segment", "points": ["A", "E"]},
                {"id": "seg_EB'", "type": "segment", "points": ["E", "B1"]},
                {"id": "seg_B'C'", "type": "segment", "points": ["B1", "C1"]},
                {"id": "seg_C'D", "type": "segment", "points": ["C1", "D"]},
                {"id": "seg_EB", "type": "segment", "points": ["E", "B"]},
                {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
                {"id": "seg_CD", "type": "segment", "points": ["C", "D"]},
            ],
            "display": {"primitives": {"seg_BC": {"stroke_width": 3}}},
        }

        filtered, report = validate_and_filter_render_topology(scene, geometry_ir)
        kept_ids = {
            item["id"]
            for item in filtered.get("primitives", [])
            if isinstance(item, dict)
        }
        primitive_display = filtered.get("display", {}).get("primitives", {})

        self.assertTrue(report["is_valid"])
        self.assertIn("seg_EB'", kept_ids)
        self.assertIn("seg_B'C'", kept_ids)
        self.assertIn("seg_C'D", kept_ids)
        self.assertNotIn("seg_AB", kept_ids)
        self.assertEqual(1, report["suppressed_count"])
        self.assertEqual("seg_AB", report["suppressed"][0]["id"])
        self.assertEqual("dashed", primitive_display["seg_BC"]["style"])
        self.assertEqual("dashed", primitive_display["seg_CD"]["style"])
        self.assertEqual("dashed", primitive_display["seg_EB"]["style"])
        self.assertEqual(3, primitive_display["seg_BC"]["stroke_width"])

    def test_animation_agent_preserves_perception_geometry_ir_and_reports_gate(
        self,
    ) -> None:
        perception_geometry_ir = {
            "version": "geometry_ir.v1",
            "scene_draft": {"visible_segments": [{"points": ["A", "B"]}]},
            "facts": {
                "visual_observed": {"segments": ["AB"]},
                "text_explicit": {"relations": [], "measurements": []},
                "solver_derived": {"relations": [], "measurements": []},
            },
            "geometry_facts": {"display": {"primitives": {}}},
        }
        drawable_scene = {
            "points": {
                "A": {"pos": [0, 0]},
                "B": {"pos": [1, 0]},
                "B'": {"pos": [1, 1]},
            },
            "primitives": [
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "seg_AB'", "type": "segment", "points": ["A", "B'"]},
            ],
            "display": {"primitives": {}},
        }
        project = VideoProject(
            problem_text="沿AB折叠",
            problem_image=None,
            script_steps=[
                ScriptStep(
                    id=1,
                    title="观察图形",
                    duration=1.0,
                    narration="观察图形。",
                    visual_cues=["highlight AB"],
                )
            ],
        )

        with TemporaryDirectory() as tmp_dir:
            agent = AnimationAgent(config={"output_dir": tmp_dir})
            agent.problem_pattern_classifier.classify = lambda **_kwargs: {}
            agent.teaching_ir_planner.build_geometry_ir = lambda **_kwargs: {
                "version": "teaching_geometry_ir.v1",
                "problem_pattern": "",
                "sub_pattern": "",
                "transform": {},
            }
            agent.teaching_ir_planner.build_teaching_ir = lambda **_kwargs: {
                "version": "teaching_ir.v1",
                "steps": [],
            }
            agent.action_executability_checker.check_and_repair = (
                lambda **_kwargs: ({"version": "teaching_ir.v1", "steps": []}, {})
            )
            agent._annotate_template_references = lambda *_args, **_kwargs: []

            def _candidate(**kwargs):
                scene = kwargs["coordinate_scene_data"]
                primitive_ids = {
                    item["id"]
                    for item in scene.get("primitives", [])
                    if isinstance(item, dict)
                }
                assert "seg_AB" in primitive_ids
                assert "seg_AB'" not in primitive_ids
                return {
                    "ok": True,
                    "mode": "template_formal",
                    "fallback_level": "formal",
                    "code": (
                        "from manim import *\n"
                        "class MathAnimation(Scene):\n"
                        "    def construct(self):\n"
                        "        pass\n"
                    ),
                    "contexts": [{"animation_spec": {}}],
                    "snapshots": [],
                    "report": {"is_valid": True},
                    "error": None,
                }

            agent._build_template_candidate = _candidate

            state = {
                "project": project,
                "messages": [],
                "current_step": "vision_completed",
                "metadata": {
                    "geometry_ir": perception_geometry_ir,
                    "drawable_scene": drawable_scene,
                    "coordinate_scene": None,
                    "coordinate_scene_validation": {"is_valid": False},
                },
            }

            result = agent.process(state)

        metadata = result["metadata"]
        self.assertEqual(perception_geometry_ir, metadata["geometry_ir"])
        self.assertEqual(perception_geometry_ir, metadata["perception_geometry_ir"])
        self.assertEqual(
            "teaching_geometry_ir.v1",
            metadata["teaching_geometry_ir"]["version"],
        )
        self.assertEqual(
            1,
            metadata["render_topology_validation"]["rejected_count"],
        )
        self.assertEqual(
            "seg_AB'",
            metadata["render_topology_validation"]["rejected"][0]["id"],
        )


if __name__ == "__main__":
    unittest.main()
