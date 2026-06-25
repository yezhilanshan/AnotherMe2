from pathlib import Path
import json
import tempfile
import unittest

from PIL import Image, ImageDraw

from agents.perception.vector_geometry import _derive_intersections, vectorize_geometry_image


class VectorGeometryTests(unittest.TestCase):
    def test_vectorize_geometry_image_writes_svg_and_line_hints(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "triangle.png"
            svg_path = Path(temp_dir) / "triangle.svg"
            json_path = Path(temp_dir) / "triangle.geometry_primitives.json"

            image = Image.new("RGB", (320, 240), "white")
            draw = ImageDraw.Draw(image)
            draw.line(
                [(45, 190), (160, 40), (275, 190), (45, 190)],
                fill="black",
                width=4,
            )
            image.save(image_path)

            result = vectorize_geometry_image(
                str(image_path),
                output_svg_path=str(svg_path),
                output_json_path=str(json_path),
            )

            self.assertEqual("ok", result["status"])
            self.assertTrue(svg_path.exists())
            self.assertTrue(json_path.exists())
            self.assertEqual(str(json_path).replace("\\", "/"), result["geometry_primitives_path"])
            self.assertGreaterEqual(len(result["lines"]), 2)
            primitives = result["geometry_primitives"]
            self.assertEqual("v1", primitives["version"])
            self.assertGreaterEqual(len(primitives["line_segments"]), 2)
            self.assertIn("confidence", primitives)
            payload = json.loads(json_path.read_text(encoding="utf-8"))
            self.assertEqual("v1", payload["geometry_primitives"]["version"])
            self.assertGreaterEqual(
                payload["geometry_primitives"]["evidence_counts"]["line_segments"],
                2,
            )
            self.assertIn("<svg", svg_path.read_text(encoding="utf-8"))

    def test_vectorize_geometry_image_writes_circle_hints(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "circle.png"
            svg_path = Path(temp_dir) / "circle.svg"

            image = Image.new("RGB", (260, 220), "white")
            draw = ImageDraw.Draw(image)
            draw.ellipse((60, 35, 200, 175), outline="black", width=4)
            image.save(image_path)

            result = vectorize_geometry_image(
                str(image_path),
                output_svg_path=str(svg_path),
            )

            self.assertEqual("ok", result["status"])
            self.assertTrue(svg_path.exists())
            self.assertGreaterEqual(len(result["circles"]), 1)
            primitives = result["geometry_primitives"]
            self.assertGreaterEqual(len(primitives["circles"]), 1)
            self.assertEqual(result["circles"], primitives["circles"])
            circle = result["circles"][0]
            self.assertAlmostEqual(130, circle["cx"], delta=8)
            self.assertAlmostEqual(105, circle["cy"], delta=8)
            self.assertAlmostEqual(70, circle["r"], delta=10)
            self.assertIn("<circle", svg_path.read_text(encoding="utf-8"))

    def test_derive_intersections_from_fitted_primitives(self) -> None:
        lines = [
            {
                "id": "diameter",
                "type": "line_segment",
                "x1": 20,
                "y1": 70,
                "x2": 120,
                "y2": 70,
                "confidence": 0.9,
            }
        ]
        circles = [
            {
                "id": "circle_1",
                "type": "circle",
                "cx": 70,
                "cy": 70,
                "r": 50,
                "confidence": 0.88,
            },
            {
                "id": "circle_2",
                "type": "circle",
                "cx": 100,
                "cy": 70,
                "r": 50,
                "confidence": 0.86,
            },
        ]

        intersections = _derive_intersections(lines, circles, width=160, height=160)
        by_type = {}
        for item in intersections:
            by_type.setdefault(item["type"], []).append(item)

        self.assertGreaterEqual(len(by_type["line_circle"]), 2)
        self.assertGreaterEqual(len(by_type["circle_circle"]), 2)
        self.assertTrue(all("confidence" in item for item in intersections))


if __name__ == "__main__":
    unittest.main()
