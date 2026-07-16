from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageDraw

from agents.perception.image_preprocess import preprocess_problem_image


class ImagePreprocessTests(unittest.TestCase):
    def test_preprocess_problem_image_enhances_scan_and_suppresses_colored_ink(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source_path = Path(temp_dir) / "photo.png"
            output_dir = Path(temp_dir) / "out"

            image = Image.new("RGB", (360, 240), (238, 236, 224))
            draw = ImageDraw.Draw(image)
            for y in range(image.height):
                shade = int(24 * (y / max(image.height - 1, 1)))
                draw.line(
                    [(0, y), (image.width, y)],
                    fill=(238 - shade, 236 - shade, 224 - shade),
                )
            draw.rectangle((30, 24, 330, 214), outline=(235, 235, 235), width=1)
            draw.text((48, 42), "AB=3", fill=(20, 20, 20))
            draw.line([(58, 178), (174, 52), (296, 178), (58, 178)], fill=(15, 15, 15), width=4)
            draw.line([(70, 78), (298, 106)], fill=(210, 30, 40), width=5)
            image.save(source_path)

            result = preprocess_problem_image(
                str(source_path),
                output_dir=str(output_dir),
                target_min_side=520,
                max_output_side=900,
            )

            self.assertEqual("ok", result["status"])
            self.assertTrue(result["used_processed_image"])
            processed_path = Path(str(result["processed_path"]))
            self.assertTrue(processed_path.exists())

            processed = Image.open(processed_path).convert("RGB")
            self.assertGreaterEqual(min(processed.size), 500)
            getter = getattr(processed, "get_flattened_data", None)
            pixels = list(getter() if callable(getter) else processed.getdata())
            red_dominant = sum(1 for r, g, b in pixels if r > g + 40 and r > b + 40)
            dark_pixels = sum(1 for r, g, b in pixels if r < 90 and g < 90 and b < 90)
            self.assertLess(red_dominant, 10)
            self.assertGreater(dark_pixels, 120)

    def test_preprocess_problem_image_can_be_disabled(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source_path = Path(temp_dir) / "photo.png"
            Image.new("RGB", (80, 60), "white").save(source_path)

            result = preprocess_problem_image(
                str(source_path),
                output_dir=temp_dir,
                enabled=False,
            )

            self.assertEqual("disabled", result["status"])
            self.assertFalse(result["used_processed_image"])
            self.assertEqual(str(source_path), result["processed_path"])


if __name__ == "__main__":
    unittest.main()
