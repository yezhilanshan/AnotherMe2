import tempfile
import unittest
from pathlib import Path

from agents.execution.semantic_render_reviewer import SemanticRenderReviewer


class _StubVisionTool:
    def __init__(self, response_text: str):
        self.response_text = response_text
        self.last_image_paths = None
        self.last_prompt = None

    def analyze_images(self, image_paths, prompt, *, model_role="geometry"):
        self.last_image_paths = list(image_paths)
        self.last_prompt = prompt
        return self.response_text


class SemanticRenderReviewerTests(unittest.TestCase):
    def test_review_parses_structured_corrections_from_two_images(self) -> None:
        try:
            from PIL import Image
        except Exception as exc:  # pragma: no cover
            self.skipTest(f"Pillow unavailable: {exc}")

        response = """
```json
{
  "version": "semantic_render_review.v1",
  "status": "needs_correction",
  "overall_match": "major_mismatch",
  "confidence": 0.91,
  "summary": "Rendered fold shape includes an extra segment.",
  "issues": [
    {
      "type": "extra_segment",
      "severity": "error",
      "target": {"segment_id": "seg_BB'", "points": ["B", "B'"]},
      "evidence": "Original image does not show segment BB'."
    }
  ],
  "corrections": [
    {
      "action": "remove_segment",
      "target": {"segment_id": "seg_BB'", "points": ["B", "B'"]},
      "confidence": 0.88,
      "rationale": "BB' is absent in the source image."
    }
  ]
}
```
"""
        with tempfile.TemporaryDirectory() as tmpdir:
            source_path = Path(tmpdir) / "source.png"
            render_path = Path(tmpdir) / "render.png"
            Image.new("RGB", (120, 80), "white").save(source_path)
            Image.new("RGB", (120, 80), "white").save(render_path)
            vision_tool = _StubVisionTool(response)
            reviewer = SemanticRenderReviewer(vision_tool=vision_tool)

            report = reviewer.review(
                source_image_path=str(source_path),
                rendered_frame_path=str(render_path),
                problem_text="折叠题",
                geometry_ir={"version": "geometry_ir.v1"},
                render_scene={"points": [], "primitives": []},
                render_review={"source_summary": {"segment_count": 4}},
            )

        self.assertEqual("needs_correction", report["status"])
        self.assertEqual("major_mismatch", report["overall_match"])
        self.assertEqual(0.91, report["confidence"])
        self.assertEqual(2, len(vision_tool.last_image_paths))
        self.assertIn("GeometryIR", vision_tool.last_prompt)
        self.assertEqual("remove_segment", report["corrections"][0]["action"])

    def test_review_skips_when_images_are_missing(self) -> None:
        reviewer = SemanticRenderReviewer(vision_tool=_StubVisionTool("{}"))

        report = reviewer.review(
            source_image_path="",
            rendered_frame_path="",
            problem_text="triangle",
            geometry_ir=None,
            render_scene=None,
            render_review=None,
        )

        self.assertEqual("skipped", report["status"])
        self.assertEqual("missing_source_image", report["reason"])


if __name__ == "__main__":
    unittest.main()
