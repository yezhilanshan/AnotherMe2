import tempfile
import types
import unittest
from pathlib import Path

from agents.execution.animation_agent import AnimationAgent
from agents.execution.codegen import TemplateCodeGenerator
from agents.execution.merge_agent import MergeAgent
from agents.execution.render_review_repair_agent import RenderReviewRepairAgent
from agents.foundation.state import ScriptStep, VideoProject


def _canvas_config():
    return {
        "frame_height": 8.0,
        "frame_width": 14.222,
        "pixel_height": 1080,
        "pixel_width": 1920,
        "safe_margin": 0.4,
        "left_panel_x_max": 1.0,
        "right_panel_x_min": 1.8,
    }


def _project(audio_file: str = "audio/step1.mp3") -> VideoProject:
    return VideoProject(
        problem_text="triangle",
        script_steps=[
            ScriptStep(
                id=1,
                title="已知条件",
                duration=2.4,
                narration="展示三角形的已知条件。",
                visual_cues=["highlight"],
                audio_file=audio_file,
                audio_duration=2.4,
            )
        ],
    )


def _coordinate_scene():
    return {
        "mode": "2d",
        "points": [
            {"id": "A", "coord": [0, 0]},
            {"id": "B", "coord": [4, 0]},
            {"id": "C", "coord": [0, 3]},
            {"id": "B'", "coord": [5, 1]},
        ],
        "primitives": [
            {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
            {"id": "seg_BB'", "type": "segment", "points": ["B", "B'"]},
            {"id": "poly_ABB'", "type": "polygon", "points": ["A", "B", "B'"]},
        ],
        "display": {"primitives": {"seg_AB": {"style": "solid"}}},
    }


def _valid_manim_code():
    return """
from manim import *

class MathAnimation(Scene):
    def construct(self):
        points = {}
        lines = {}
        objects = {}
        points['A'] = Dot()
        points['B'] = Dot()
        points['C'] = Dot()
        lines['seg_AB'] = always_redraw(lambda: Line(points['A'].get_center(), points['B'].get_center()))
        self.add(points['A'], points['B'], points['C'], lines['seg_AB'])
"""


class _StubMergeAgent(MergeAgent):
    def _render_manim(self, manim_file: str, output_file: str, class_name: str = "MathAnimation"):
        Path(output_file).write_bytes(b"fake-mp4")
        return True, ""


class RenderReviewRepairAgentTests(unittest.TestCase):
    def test_repair_agent_removes_rejected_topology_and_records_ir_patch(self) -> None:
        agent = RenderReviewRepairAgent(config={"max_render_review_rounds": 1})
        project = VideoProject(problem_text="fold problem", script_steps=[])
        project.final_video_path = "D:/tmp/final_video.mp4"
        state = {
            "project": project,
            "messages": [],
            "current_step": "merge_completed",
            "metadata": {
                "render_review_retry_requested": True,
                "render_review_retry_count": 0,
                "render_vs_source_validation": {
                    "is_valid": False,
                    "failed_checks": [
                        {"check": "forbidden_topology", "detail": "leaked BB'"}
                    ],
                    "topology": {"rejected_pairs": ["BB'"]},
                },
                "render_topology_validation": {
                    "rejected": [{"id": "seg_BB'", "pair": "BB'"}]
                },
                "drawable_scene": _coordinate_scene(),
                "coordinate_scene": _coordinate_scene(),
                "render_scene": _coordinate_scene(),
                "geometry_ir": {
                    "version": "geometry_ir.v1",
                    "facts": {"solver_derived": {}},
                    "geometry_facts": {},
                },
                "perception_geometry_ir": {
                    "version": "geometry_ir.v1",
                    "facts": {"solver_derived": {}},
                    "geometry_facts": {},
                },
                "visual_geometry_source": {"mode": "vector_reconstruction"},
            },
        }

        result = agent.process(state)

        self.assertEqual("render_review_repair_completed", result["current_step"])
        self.assertEqual("animation", result["metadata"]["render_review_next_step"])
        self.assertEqual(1, result["metadata"]["render_review_retry_count"])
        self.assertEqual("retrying_render_review", result["project"].status)
        self.assertEqual(
            ["seg_AB"],
            [item["id"] for item in result["metadata"]["drawable_scene"]["primitives"] if item["type"] == "segment"],
        )
        layout_candidates = result["metadata"]["layout_ir"]["candidates"]
        drawable_candidate = next(
            item for item in layout_candidates if item["scene_key"] == "drawable_scene"
        )
        self.assertEqual(
            ["seg_AB"],
            [
                item["id"]
                for item in drawable_candidate["scene_payload"]["primitives"]
                if item["type"] == "segment"
            ],
        )
        repairs = result["metadata"]["geometry_ir"]["facts"]["solver_derived"]["review_repairs"]
        self.assertTrue(repairs)
        self.assertEqual("remove_rejected_topology", repairs[0]["kind"])

    def test_repair_agent_forces_vector_after_blank_overlay_review(self) -> None:
        agent = RenderReviewRepairAgent(config={"max_render_review_rounds": 1})
        state = {
            "project": VideoProject(problem_text="triangle", script_steps=[]),
            "messages": [],
            "current_step": "merge_completed",
            "metadata": {
                "render_review_retry_requested": True,
                "render_vs_source_validation": {
                    "is_valid": False,
                    "failed_checks": [
                        {"check": "frame_nonblank", "detail": "frame blank"}
                    ],
                },
                "visual_geometry_source": {"mode": "image_overlay"},
            },
        }

        result = agent.process(state)

        self.assertTrue(
            result["metadata"]["render_review_force_vector_reconstruction"]
        )
        self.assertEqual("animation", result["metadata"]["render_review_next_step"])

    def test_repair_agent_finishes_when_no_deterministic_repair_exists(self) -> None:
        agent = RenderReviewRepairAgent(config={"max_render_review_rounds": 1})
        project = VideoProject(problem_text="triangle", script_steps=[])
        project.final_video_path = "D:/tmp/final_video.mp4"
        project.status = "render_review_retry_pending"
        state = {
            "project": project,
            "messages": [],
            "current_step": "merge_completed",
            "metadata": {
                "render_review_retry_requested": True,
                "render_review_retry_count": 0,
                "render_vs_source_validation": {
                    "is_valid": False,
                    "failed_checks": [
                        {"check": "semantic_review", "detail": "mismatch without supported correction"}
                    ],
                },
                "visual_geometry_source": {"mode": "vector_reconstruction"},
                "semantic_render_review": {
                    "status": "major_mismatch",
                    "issues": [{"severity": "error"}],
                    "corrections": [],
                },
            },
        }

        result = agent.process(state)

        self.assertEqual("completed", result["project"].status)
        self.assertEqual("end", result["metadata"]["render_review_next_step"])

    def test_repair_agent_applies_supported_semantic_corrections(self) -> None:
        agent = RenderReviewRepairAgent(config={"max_render_review_rounds": 1})
        state = {
            "project": VideoProject(problem_text="fold problem", script_steps=[]),
            "messages": [],
            "current_step": "merge_completed",
            "metadata": {
                "render_review_retry_requested": True,
                "render_vs_source_validation": {
                    "is_valid": False,
                    "failed_checks": [
                        {"check": "semantic_review", "detail": "semantic mismatch"}
                    ],
                },
                "drawable_scene": {
                    "points": [],
                    "primitives": [
                        {"id": "seg_BB'", "type": "segment", "points": ["B", "B'"]}
                    ],
                    "display": {"primitives": {"seg_AB": {"style": "solid"}}},
                },
                "coordinate_scene": {"points": [], "primitives": [], "display": {"primitives": {}}},
                "render_scene": {"points": [], "primitives": [], "display": {"primitives": {}}},
                "geometry_ir": {
                    "version": "geometry_ir.v1",
                    "facts": {"solver_derived": {}},
                    "geometry_facts": {},
                },
                "visual_geometry_source": {"mode": "image_overlay"},
                "semantic_render_review": {
                    "status": "needs_correction",
                    "corrections": [
                        {
                            "action": "prefer_vector_reconstruction",
                            "target": {},
                            "confidence": 0.95,
                        },
                        {
                            "action": "remove_segment",
                            "target": {"segment_id": "seg_BB'", "points": ["B", "B'"]},
                            "confidence": 0.92,
                        },
                    ],
                },
            },
        }

        result = agent.process(state)

        self.assertTrue(result["metadata"]["render_review_force_vector_reconstruction"])
        self.assertEqual([], result["metadata"]["drawable_scene"]["primitives"])
        kinds = [item["kind"] for item in result["metadata"]["render_review_repair_actions"]]
        self.assertIn("prefer_vector_reconstruction", kinds)
        self.assertIn("remove_segment", kinds)

    def test_repair_agent_applies_label_fold_and_shape_semantic_corrections(self) -> None:
        agent = RenderReviewRepairAgent(config={"max_render_review_rounds": 1})
        state = {
            "project": VideoProject(problem_text="fold problem", script_steps=[]),
            "messages": [],
            "current_step": "merge_completed",
            "metadata": {
                "render_review_retry_requested": True,
                "render_vs_source_validation": {
                    "is_valid": False,
                    "failed_checks": [
                        {"check": "semantic_review", "detail": "semantic mismatch"}
                    ],
                },
                "drawable_scene": {
                    "points": [{"id": "B", "coord": [1, 0]}, {"id": "B'", "coord": [2, 0]}],
                    "primitives": [],
                    "display": {"points": {}, "primitives": {}},
                },
                "coordinate_scene": {
                    "points": [{"id": "B", "coord": [1, 0]}, {"id": "B'", "coord": [2, 0]}],
                    "primitives": [],
                    "display": {"points": {}, "primitives": {}},
                },
                "render_scene": {
                    "points": [{"id": "B", "coord": [1, 0]}, {"id": "B'", "coord": [2, 0]}],
                    "primitives": [],
                    "display": {"points": {}, "primitives": {}},
                },
                "geometry_ir": {
                    "version": "geometry_ir.v1",
                    "scene_draft": {"points": [{"id": "B"}], "fold_correspondences": []},
                    "facts": {"solver_derived": {}, "visual_observed": {"display": {"points": {}}}},
                    "geometry_facts": {"display": {"points": {}}},
                },
                "visual_geometry_source": {"mode": "vector_reconstruction"},
                "semantic_render_review": {
                    "status": "needs_correction",
                    "corrections": [
                        {
                            "action": "set_label_direction",
                            "target": {"point_id": "B", "label_direction": "down_right"},
                            "confidence": 0.94,
                        },
                        {
                            "action": "update_fold_correspondence",
                            "target": {"source": "B", "image": "B'"},
                            "confidence": 0.9,
                        },
                        {
                            "action": "flag_wrong_overall_shape",
                            "target": {
                                "expected_template": "fold_transform",
                                "bad_shape": "wrong_complete_rhombus",
                            },
                            "confidence": 0.92,
                        },
                    ],
                },
            },
        }

        result = agent.process(state)

        self.assertEqual(
            "down_right",
            result["metadata"]["drawable_scene"]["display"]["points"]["B"]["label_direction"],
        )
        layout_candidates = result["metadata"]["layout_ir"]["candidates"]
        drawable_candidate = next(
            item for item in layout_candidates if item["scene_key"] == "drawable_scene"
        )
        self.assertEqual(
            "down_right",
            drawable_candidate["scene_payload"]["display"]["points"]["B"]["label_direction"],
        )
        self.assertEqual(
            "down_right",
            result["metadata"]["geometry_ir"]["geometry_facts"]["display"]["points"]["B"]["label_direction"],
        )
        self.assertTrue(result["metadata"]["render_review_prefer_verified_coordinate_scene"])
        self.assertTrue(result["metadata"]["render_review_force_vector_reconstruction"])
        self.assertEqual(
            [{"source": "B", "image": "B'", "source_type": "semantic_render_review"}],
            result["metadata"]["geometry_ir"]["scene_draft"]["fold_correspondences"],
        )
        shape_flags = result["metadata"]["geometry_ir"]["facts"]["solver_derived"]["shape_flags"]
        self.assertEqual("wrong_complete_rhombus", shape_flags[0]["bad_shape"])

    def test_animation_agent_honors_force_vector_reconstruction(self) -> None:
        try:
            from PIL import Image
        except Exception as exc:  # pragma: no cover
            self.skipTest(f"Pillow unavailable: {exc}")

        with tempfile.TemporaryDirectory() as tmpdir:
            image_path = Path(tmpdir) / "problem.png"
            Image.new("RGB", (260, 220), "white").save(image_path)
            scene = {
                "mode": "2d",
                "points": [
                    {
                        "id": "A",
                        "coord": [0, 0],
                        "pixel_coord": {"x": 20, "y": 180},
                        "pixel_coord_space": "source",
                    },
                    {
                        "id": "B",
                        "coord": [4, 0],
                        "pixel_coord": {"x": 220, "y": 180},
                        "pixel_coord_space": "source",
                    },
                    {
                        "id": "C",
                        "coord": [0, 3],
                        "pixel_coord": {"x": 20, "y": 30},
                        "pixel_coord_space": "source",
                    },
                ],
                "primitives": [
                    {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                    {"id": "seg_AC", "type": "segment", "points": ["A", "C"]},
                    {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
                ],
            }
            agent = AnimationAgent(
                config={
                    "canvas_config": _canvas_config(),
                    "output_dir": tmpdir,
                    "use_template_codegen": True,
                    "use_template_retrieval": False,
                },
                llm=None,
            )
            project = _project()
            project.problem_image = str(image_path)
            state = {
                "project": project,
                "messages": [],
                "current_step": "voice_completed",
                "metadata": {
                    "drawable_scene": scene,
                    "coordinate_scene": None,
                    "coordinate_scene_validation": {
                        "is_valid": False,
                        "failed_checks": [{"message": "bad"}],
                    },
                    "render_review_force_vector_reconstruction": True,
                },
            }

            result = agent.process(state)

            self.assertEqual(
                "vector_reconstruction",
                result["metadata"]["visual_geometry_source"]["mode"],
            )
            self.assertNotIn("ImageMobject", result["metadata"]["manim_code"])

    def test_animation_agent_prefers_verified_coordinate_scene_when_forced(self) -> None:
        agent = AnimationAgent(
            config={
                "canvas_config": _canvas_config(),
                "use_template_codegen": True,
                "use_template_retrieval": False,
            },
            llm=None,
        )
        drawable_scene = _coordinate_scene()
        drawable_scene["layout_mode"] = "soft_sketch_reconstruction"
        coordinate_scene = {
            "mode": "2d",
            "points": [
                {"id": "A", "coord": [0, 0]},
                {"id": "B", "coord": [4, 0]},
                {"id": "C", "coord": [0, 3]},
            ],
            "primitives": [
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "seg_AC", "type": "segment", "points": ["A", "C"]},
                {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
            ],
        }
        state = {
            "project": _project(),
            "messages": [],
            "current_step": "voice_completed",
            "metadata": {
                "drawable_scene": drawable_scene,
                "coordinate_scene": coordinate_scene,
                "coordinate_scene_validation": {
                    "is_valid": True,
                    "failed_checks": [],
                },
                "render_review_prefer_verified_coordinate_scene": True,
            },
        }

        result = agent.process(state)

        self.assertEqual(
            "coordinate_scene_forced_by_render_review",
            result["metadata"]["visual_geometry_source"]["selected_scene_source"],
        )
        self.assertEqual(
            "layout_contract.v1",
            result["metadata"]["visual_geometry_source"]["layout_contract_version"],
        )
        self.assertEqual(
            "coordinate_scene_forced_by_render_review",
            result["metadata"]["layout_selection"]["selected_scene_source"],
        )

    def test_merge_agent_requests_retry_when_auto_review_repair_is_enabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            agent = _StubMergeAgent(
                config={
                    "output_dir": tmpdir,
                    "canvas_config": _canvas_config(),
                    "auto_render_review_repair": True,
                    "max_render_review_rounds": 1,
                }
            )
            agent.render_review_validator.validate = lambda **_kwargs: {
                "version": "render_vs_source_validation.v1",
                "is_valid": False,
                "failed_checks": [
                    {"check": "forbidden_topology", "detail": "rejected topology leaked"}
                ],
                "warnings": [],
                "checks": [],
                "artifact_review": {},
            }
            state = {
                "project": VideoProject(problem_text="triangle", script_steps=[]),
                "messages": [],
                "current_step": "animation_completed",
                "metadata": {
                    "manim_code": _valid_manim_code(),
                    "render_scene": {
                        "points": [
                            {"id": "A", "coord": [0, 0]},
                            {"id": "B", "coord": [4, 0]},
                            {"id": "C", "coord": [0, 3]},
                        ],
                        "primitives": [
                            {"id": "seg_AB", "type": "segment", "points": ["A", "B"]}
                        ],
                    },
                    "geometry_ir": {"version": "geometry_ir.v1"},
                    "render_topology_validation": {"rejected_count": 0, "rejected": []},
                    "visual_geometry_source": {"mode": "vector_reconstruction"},
                },
            }
            state["project"].manim_class_name = "MathAnimation"
            state["project"].audio_embedded = True

            result = agent.process(state)

        self.assertEqual("merge_completed", result["current_step"])
        self.assertEqual("render_review_retry_pending", result["project"].status)
        self.assertTrue(result["metadata"]["render_review_retry_requested"])
        self.assertEqual("end", result["metadata"]["render_review_next_step"])

    def test_merge_agent_requests_retry_on_semantic_review_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            agent = _StubMergeAgent(
                config={
                    "output_dir": tmpdir,
                    "canvas_config": _canvas_config(),
                    "auto_render_review_repair": True,
                    "max_render_review_rounds": 1,
                }
            )
            agent.render_review_validator.validate = lambda **_kwargs: {
                "version": "render_vs_source_validation.v1",
                "is_valid": True,
                "failed_checks": [],
                "warnings": [],
                "checks": [],
                "artifact_review": {"frame_path": ""},
            }
            agent.semantic_render_reviewer.review = lambda **_kwargs: {
                "version": "semantic_render_review.v1",
                "status": "major_mismatch",
                "overall_match": "major_mismatch",
                "confidence": 0.86,
                "summary": "Rendered shape is a wrong complete rhombus.",
                "issues": [{"severity": "error"}],
                "corrections": [],
            }
            state = {
                "project": VideoProject(problem_text="fold", script_steps=[]),
                "messages": [],
                "current_step": "animation_completed",
                "metadata": {
                    "manim_code": _valid_manim_code(),
                    "render_scene": {
                        "points": [
                            {"id": "A", "coord": [0, 0]},
                            {"id": "B", "coord": [4, 0]},
                        ],
                        "primitives": [
                            {"id": "seg_AB", "type": "segment", "points": ["A", "B"]}
                        ],
                    },
                    "geometry_ir": {"version": "geometry_ir.v1"},
                    "render_topology_validation": {"rejected_count": 0, "rejected": []},
                    "visual_geometry_source": {"mode": "vector_reconstruction"},
                },
            }
            state["project"].manim_class_name = "MathAnimation"
            state["project"].audio_embedded = True

            result = agent.process(state)

        self.assertEqual("merge_completed", result["current_step"])
        self.assertEqual("render_review_retry_pending", result["project"].status)
        self.assertTrue(result["metadata"]["render_review_retry_requested"])
        self.assertEqual(
            "major_mismatch",
            result["metadata"]["semantic_render_review"]["status"],
        )

    def test_merge_agent_skips_semantic_review_exception_without_failing_video(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            agent = _StubMergeAgent(
                config={
                    "output_dir": tmpdir,
                    "canvas_config": _canvas_config(),
                    "auto_render_review_repair": True,
                    "max_render_review_rounds": 1,
                }
            )
            agent.render_review_validator.validate = lambda **_kwargs: {
                "version": "render_vs_source_validation.v1",
                "is_valid": True,
                "failed_checks": [],
                "warnings": [],
                "checks": [],
                "artifact_review": {"frame_path": ""},
            }

            def _raise_semantic(**_kwargs):
                raise RuntimeError("vision provider timeout")

            agent.semantic_render_reviewer.review = _raise_semantic
            state = {
                "project": VideoProject(problem_text="triangle", script_steps=[]),
                "messages": [],
                "current_step": "animation_completed",
                "metadata": {
                    "manim_code": _valid_manim_code(),
                    "render_scene": {
                        "points": [
                            {"id": "A", "coord": [0, 0]},
                            {"id": "B", "coord": [4, 0]},
                        ],
                        "primitives": [
                            {"id": "seg_AB", "type": "segment", "points": ["A", "B"]}
                        ],
                    },
                    "geometry_ir": {"version": "geometry_ir.v1"},
                    "render_topology_validation": {"rejected_count": 0, "rejected": []},
                    "visual_geometry_source": {"mode": "vector_reconstruction"},
                },
            }
            state["project"].manim_class_name = "MathAnimation"
            state["project"].audio_embedded = True

            result = agent.process(state)

        self.assertEqual("completed", result["project"].status)
        self.assertTrue(result["project"].final_video_path)
        self.assertEqual(
            "semantic_review_exception",
            result["metadata"]["semantic_render_review"]["reason"],
        )

    def test_template_codegen_filters_duplicate_and_unknown_point_formulas(self) -> None:
        generator = TemplateCodeGenerator(_canvas_config())
        project = _project(audio_file="")
        project.manim_class_name = "MathAnimation"
        scene = {
            "mode": "2d",
            "points": [
                {"id": "D", "coord": [0, 1]},
                {"id": "E", "coord": [-1, 0]},
                {"id": "H", "coord": [0, 0]},
            ],
            "primitives": [
                {"id": "seg_DH", "type": "segment", "points": ["D", "H"]},
                {"id": "seg_EH", "type": "segment", "points": ["E", "H"]},
            ],
        }
        contexts = [
            {
                "animation_plan": {"step_id": 1, "title": "证明结论", "duration": 2.4},
                "animation_spec": {
                    "timing_budget": {"duration": 2.4, "formula_show": 0.4, "wait": 2.0},
                    "formula_actions": [
                        {
                            "content": "HM = EH",
                            "layout": {
                                "content": "HM = EH",
                                "kind": "formula",
                                "x": 0.68,
                                "y": 0.1,
                                "width": 0.28,
                                "height": 0.12,
                            },
                        },
                        {
                            "content": "EH = DH",
                            "layout": {
                                "content": "EH = DH",
                                "kind": "formula",
                                "x": 0.68,
                                "y": 0.24,
                                "width": 0.28,
                                "height": 0.12,
                            },
                        },
                        {
                            "content": "EH=DH",
                            "layout": {
                                "content": "EH=DH",
                                "kind": "formula",
                                "x": 0.68,
                                "y": 0.38,
                                "width": 0.28,
                                "height": 0.12,
                            },
                        },
                    ],
                    "focus_entities": [],
                    "movement_actions": [],
                    "emphasis_actions": [],
                    "label_actions": [],
                    "restore_actions": [],
                    "helper_line_actions": [],
                },
            }
        ]

        code = generator.generate(project, scene, contexts)

        self.assertNotIn("HM = EH", code)
        self.assertNotIn("HM=EH", code)
        self.assertEqual(1, code.count("EH = DH"))


if __name__ == "__main__":
    unittest.main()
