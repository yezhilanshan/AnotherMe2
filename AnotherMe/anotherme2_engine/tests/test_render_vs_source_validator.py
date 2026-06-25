import tempfile
import unittest
from pathlib import Path

from agents.execution.merge_agent import MergeAgent
from agents.execution.render_vs_source_validator import RenderVsSourceValidator
from agents.foundation.state import VideoProject


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


def _render_scene():
    return {
        "mode": "2d",
        "points": [
            {"id": "A", "coord": [0, 0]},
            {"id": "B", "coord": [4, 0]},
            {"id": "C", "coord": [0, 3]},
        ],
        "primitives": [
            {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
            {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
            {"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]},
        ],
        "display": {
            "primitives": {
                "seg_BC": {"style": "dashed", "source": "approved_auxiliary"},
            }
        },
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
        lines['seg_BC'] = always_redraw(lambda: DashedLine(points['B'].get_center(), points['C'].get_center()))
        self.add(points['A'], points['B'], points['C'], lines['seg_AB'], lines['seg_BC'])
"""


class _StubMergeAgent(MergeAgent):
    def _render_manim(self, manim_file: str, output_file: str, class_name: str = "MathAnimation"):
        Path(output_file).write_bytes(b"fake-mp4")
        return True, ""


class RenderVsSourceValidatorTests(unittest.TestCase):
    def test_validator_flags_rejected_topology_leaking_into_code(self) -> None:
        validator = RenderVsSourceValidator(_canvas_config())
        with tempfile.TemporaryDirectory() as tmpdir:
            report = validator.validate(
                render_scene=_render_scene(),
                geometry_ir={"version": "geometry_ir.v1"},
                manim_code=_valid_manim_code()
                + "\nlines['seg_BB\\''] = always_redraw(lambda: Line(points['B'].get_center(), points['B'].get_center()))\n",
                render_topology_validation={
                    "rejected_count": 1,
                    "rejected": [
                        {"id": "seg_BB'", "pair": "BB'", "reason": "undeclared_segment"}
                    ],
                },
                visual_geometry_source={"mode": "vector_reconstruction"},
                final_video_path=None,
                output_dir=Path(tmpdir),
            )

        self.assertFalse(report["is_valid"])
        self.assertIn(
            "forbidden_topology",
            {item["check"] for item in report["failed_checks"]},
        )

    def test_validator_uses_frame_evidence_when_available(self) -> None:
        try:
            from PIL import Image, ImageDraw
        except Exception as exc:  # pragma: no cover
            self.skipTest(f"Pillow unavailable: {exc}")

        validator = RenderVsSourceValidator(_canvas_config())
        with tempfile.TemporaryDirectory() as tmpdir:
            frame_path = Path(tmpdir) / "frame.png"
            image = Image.new("RGB", (320, 180), "white")
            draw = ImageDraw.Draw(image)
            draw.line((40, 140, 260, 40), fill="black", width=4)
            image.save(frame_path)

            validator._extract_review_frame = lambda **_kwargs: (frame_path, "")
            report = validator.validate(
                render_scene=_render_scene(),
                geometry_ir={"version": "geometry_ir.v1"},
                manim_code=_valid_manim_code(),
                render_topology_validation={"rejected_count": 0, "rejected": []},
                visual_geometry_source={"mode": "vector_reconstruction"},
                final_video_path=str(Path(tmpdir) / "final_video.mp4"),
                output_dir=Path(tmpdir),
            )

        self.assertTrue(report["is_valid"])
        self.assertTrue(report["artifact_review"]["frame_extracted"])
        self.assertFalse(report["artifact_review"]["appears_blank"])
        self.assertEqual([320, 180], report["artifact_review"]["frame_size"])
        self.assertIsNotNone(report["artifact_review"]["content_bbox"])
        self.assertIsNotNone(report["artifact_review"]["content_center_norm"])
        self.assertIn(
            "frame_content_bbox",
            {item["check"] for item in report["checks"]},
        )

    def test_merge_agent_can_enforce_render_review(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            agent = _StubMergeAgent(
                config={
                    "output_dir": tmpdir,
                    "canvas_config": _canvas_config(),
                    "enforce_render_review": True,
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
                    "render_scene": _render_scene(),
                    "geometry_ir": {"version": "geometry_ir.v1"},
                    "render_topology_validation": {"rejected_count": 0, "rejected": []},
                    "visual_geometry_source": {"mode": "vector_reconstruction"},
                },
            }
            state["project"].manim_class_name = "MathAnimation"

            result = agent.process(state)

            self.assertEqual("failed", result["project"].status)
            self.assertEqual("merge_failed", result["current_step"])
            self.assertFalse(result["metadata"]["render_vs_source_validation"]["is_valid"])
            self.assertTrue(
                (Path(tmpdir) / "debug" / "render_vs_source_validation.json").exists()
            )


if __name__ == "__main__":
    unittest.main()
