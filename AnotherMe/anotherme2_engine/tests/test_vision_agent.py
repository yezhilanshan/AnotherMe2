import copy
import json
import sys
import types
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

langchain_core_module = types.ModuleType("langchain_core")
langchain_core_messages = types.ModuleType("langchain_core.messages")


class _DummyMessage:
    def __init__(self, content=None):
        self.content = content


langchain_core_messages.HumanMessage = _DummyMessage
langchain_core_messages.SystemMessage = _DummyMessage
langchain_core_module.messages = langchain_core_messages
sys.modules.setdefault("langchain_core", langchain_core_module)
sys.modules.setdefault("langchain_core.messages", langchain_core_messages)

from agents.perception.coordinate_scene import CoordinateSceneCompiler
from agents.perception.coordinate_scene import CoordinateSceneError
from agents.foundation.state import VideoProject
from agents.perception.geometry_fact_compiler import GeometryFactCompiler
from agents.perception.vision_agent import VisionAgent


class VisionAgentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.agent = VisionAgent(config={"output_dir": "./output_test"})
        self.fact_compiler = GeometryFactCompiler()
        self.scene_compiler = CoordinateSceneCompiler()

    def test_parse_json_like_output_handles_inline_comments(self) -> None:
        raw = """
{
  "problem_text": "demo",
  "geometry_facts": {
    "points": ["A", "B"], // comment
    "segments": ["AB",],
    "relations": [
      {"type": "point_on_segment", "point": "A", "segment": "AB"}, // trailing
    ]
  }
}
"""
        parsed = self.agent._parse_json_like_output(
            raw, {"problem_text": "", "geometry_facts": {}}
        )
        self.assertEqual(parsed["problem_text"], "demo")
        self.assertEqual(parsed["geometry_facts"]["segments"], ["AB"])

    def test_sanitize_geometry_facts_drops_unlabeled_and_keeps_fold_core(self) -> None:
        facts = {
            "confidence": 0.95,
            "points": ["A", "B", "C", "D", "E", "B′", "C′"],
            "segments": [
                "AB",
                "BC",
                "CD",
                "DA",
                "DE",
                "BE",
                "EB′",
                "B′C′",
                "C′D",
                "AE",
            ],
            "polygons": ["ABCD", "AB′C′D", "BEB′"],
            "angles": [{"vertex": "B", "sides": ["AB", "BC"], "name": "∠ABC"}],
            "right_angles": [
                {"vertex": "E", "sides": ["BE", "EB′"], "description": "∠BEB′ = 90°"}
            ],
            "relations": [
                {"type": "point_on_segment", "point": "E", "segment": "AB"},
                {"type": "perpendicular", "lines": ["BE", "EB′"]},
                {"type": "equal_length", "segments": ["DB", "DB′"]},
                {"type": "intersect", "lines": ["DE", "BB′"], "point": "F"},
            ],
            "measurements": [
                {"type": "length", "segment": "AD", "value": 5},
                {
                    "type": "angle",
                    "vertex": "B",
                    "value": "arctan(2) is not angle B; tan B = 2 means tan(∠ABC) = 2",
                },
                {"type": "angle", "angle": "∠BEB′", "value": 90},
            ],
        }
        problem_text = "在菱形ABCD中，AD=5，tanB=2，E是AB上一点，将菱形ABCD沿DE折叠，使B、C的对应点分别是B′、C′，当∠BEB′=90°时"
        sanitized = self.agent._sanitize_geometry_facts(
            facts, problem_text=problem_text
        )

        self.assertIn("B'", sanitized["points"])
        self.assertIn("C'", sanitized["points"])
        self.assertTrue(
            any(
                item.get("segment") == "AD"
                for item in sanitized["measurements"]
                if item.get("type") == "length"
            )
        )
        self.assertFalse(
            any(
                item.get("angle") in {"∠B", "∠ABC"}
                for item in sanitized["measurements"]
                if item.get("type") == "angle"
            )
        )
        self.assertTrue(
            any(
                item.get("angle") in {"∠B", "∠ABC"}
                for item in sanitized.get("derived_measurements", [])
                if item.get("type") == "angle"
            )
        )
        self.assertFalse(
            any(item.get("point") == "F" for item in sanitized["relations"])
        )

    def test_stabilized_fold_bundle_compiles_to_valid_coordinate_scene(self) -> None:
        raw_bundle = {
            "problem_text": "题1 如图，在菱形ABCD中，AD=5，tanB=2，E是AB上一点，将菱形ABCD沿DE折叠，使B、C的对应点分别是B′、C′，当∠BEB′=90°时",
            "geometry_facts": {
                "confidence": 0.95,
                "points": ["A", "B", "C", "D", "E", "B′", "C′"],
                "segments": [
                    "AB",
                    "BC",
                    "CD",
                    "DA",
                    "DE",
                    "BE",
                    "EB′",
                    "B′C′",
                    "C′D",
                    "AE",
                ],
                "polygons": ["ABCD", "AB′C′D"],
                "angles": [{"vertex": "B", "sides": ["AB", "BC"], "label": "∠B"}],
                "right_angles": [
                    {
                        "vertex": "E",
                        "sides": ["BE", "EB′"],
                        "description": "∠BEB′ = 90°",
                    }
                ],
                "relations": [
                    {"type": "point_on_segment", "point": "E", "segment": "AB"},
                    {"type": "collinear", "points": ["A", "E", "B"]},
                ],
                "measurements": [
                    {"type": "length", "segment": "AD", "value": 5},
                    {"type": "angle", "angle": "∠B", "value": "arctan(2)"},
                ],
            },
        }

        stabilized = self.agent._stabilize_problem_bundle(
            raw_bundle, image_path=__file__
        )
        geometry_spec = self.fact_compiler.compile(
            stabilized["geometry_facts"],
            problem_text=stabilized["problem_text"],
        )
        normalized = self.scene_compiler.normalize_geometry_spec(geometry_spec)
        scene = self.scene_compiler.compile(normalized)
        report = self.scene_compiler.validate_coordinate_scene(scene)

        self.assertTrue(report["is_valid"], report["failed_checks"])
        point_lookup = {
            item["id"]: item["coord"] for item in report["resolved_scene"]["points"]
        }
        self.assertIn("B1", point_lookup)
        self.assertIn("C1", point_lookup)
        self.assertIn("E", point_lookup)

    def test_fold_text_adds_generic_folded_visible_structure(self) -> None:
        problem_text = (
            "如图，在四边形PQRS中，T是PS上一点，"
            "将四边形PQRS沿ST折叠，使Q、R的对应点分别是Q′、R′，"
            "求折叠后的相关线段关系。"
        )
        facts = {
            "points": ["P", "Q", "R", "S", "T", "Q′", "R′"],
            "segments": ["PQ", "QR", "RS", "SP", "ST"],
            "polygons": ["PQRS"],
        }

        sanitized = self.agent._sanitize_geometry_facts(
            facts,
            problem_text=problem_text,
        )
        segment_set = set(sanitized["segments"])
        display = sanitized.get("display", {}).get("primitives", {})

        for segment in ("ST", "PQ'", "Q'R'", "R'S"):
            self.assertIn(segment, segment_set)
            self.assertNotEqual("dashed", display.get(f"seg_{segment}", {}).get("style"))

        for segment in ("PQ", "QR", "RS"):
            self.assertIn(segment, segment_set)
            self.assertEqual("dashed", display.get(f"seg_{segment}", {}).get("style"))

        self.assertIn("PQ'R'S", sanitized["polygons"])
        self.assertIn(
            {"type": "equal_length", "segments": ["QR", "Q'R'"]},
            sanitized.get("derived_relations", []),
        )

    def test_fold_latex_text_adds_generic_folded_visible_structure(
        self,
    ) -> None:
        problem_text = (
            "1 如图, 在四边形 \\(LMNO\\) 中, 将四边形 \\(LMNO\\) 沿 \\(OU\\) 折叠, "
            "使 \\(M\\)、\\(N\\) 的对应点分别是 \\(M'\\)、\\(N'\\), "
            "求折叠后的相关线段关系。"
        )
        facts = {
            "points": ["L", "M", "N", "O", "U", "M'", "N'"],
            "segments": ["LM", "MN", "NO", "OL", "OU"],
            "polygons": ["LMNO"],
        }

        sanitized = self.agent._sanitize_geometry_facts(
            facts,
            problem_text=problem_text,
        )
        segment_set = set(sanitized["segments"])
        display = sanitized.get("display", {}).get("primitives", {})

        self.assertIn("M'N'", segment_set)
        self.assertIn("N'O", segment_set)
        self.assertIn("LM'", segment_set)
        self.assertEqual("dashed", display.get("seg_MN", {}).get("style"))
        self.assertEqual("solid", display.get("seg_OU", {}).get("style"))
        self.assertIn("LM'N'O", sanitized["polygons"])

    def test_sanitize_geometry_facts_normalizes_point_pixel_anchors(self) -> None:
        facts = {
            "points": [
                {"id": "A", "bbox": {"x": 10, "y": 20, "width": 30, "height": 40}},
                {"id": "B", "image_position": [0.5, 0.25]},
                {
                    "id": "C",
                    "visual": {
                        "bbox": {"left": 100, "top": 120, "right": 140, "bottom": 160}
                    },
                },
            ],
            "segments": ["AB", "BC", "CA"],
        }

        sanitized = self.agent._sanitize_geometry_facts(
            facts,
            problem_text="在三角形ABC中",
            image_size=(400, 200),
        )
        point_lookup = {
            item["id"]: item for item in sanitized["points"] if isinstance(item, dict)
        }

        self.assertEqual({"x": 25, "y": 40}, point_lookup["A"]["pixel_coord"])
        self.assertEqual("bbox_center", point_lookup["A"]["pixel_anchor_source"])
        self.assertEqual({"x": 200, "y": 50}, point_lookup["B"]["pixel_coord"])
        self.assertEqual("image_position", point_lookup["B"]["pixel_anchor_source"])
        self.assertEqual({"x": 120, "y": 140}, point_lookup["C"]["pixel_coord"])
        self.assertEqual("visual.bbox_center", point_lookup["C"]["pixel_anchor_source"])

    def test_sanitize_geometry_facts_keeps_label_bbox_separate_from_point_anchor(
        self,
    ) -> None:
        facts = {
            "points": [
                {
                    "id": "A",
                    "label_bbox": {"x": 0.1, "y": 0.2, "width": 0.1, "height": 0.1},
                    "label_bbox_space": "source",
                }
            ],
            "segments": [],
        }

        sanitized = self.agent._sanitize_geometry_facts(
            facts,
            problem_text="点A",
            image_size=(400, 200),
        )
        point_lookup = {
            item["id"]: item for item in sanitized["points"] if isinstance(item, dict)
        }

        self.assertNotIn("pixel_coord", point_lookup["A"])
        self.assertEqual(
            {"x1": 40, "y1": 40, "x2": 80, "y2": 60},
            point_lookup["A"]["label_bbox"],
        )
        self.assertEqual("label_bbox", point_lookup["A"]["label_bbox_source"])

    def test_soft_sketch_reconstruction_uses_pixel_anchors_and_reports_layers(
        self,
    ) -> None:
        geometry_data = {
            "points": [
                {"id": "A", "pixel_coord": {"x": 10, "y": 90}},
                {"id": "B", "pixel_coord": {"x": 10, "y": 10}},
                {"id": "C", "pixel_coord": {"x": 110, "y": 90}},
                {"id": "D"},
            ],
            "primitives": [
                {"id": "line_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "line_AC", "type": "segment", "points": ["A", "C"]},
                {"id": "line_BC", "type": "segment", "points": ["B", "C"]},
                {"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]},
            ],
            "constraints": [
                {"type": "point_on_segment", "entities": ["D", "line_AC"]},
            ],
            "measurements": [
                {"type": "length", "entities": ["A", "C"], "value": 8},
            ],
        }
        geometry_facts = {
            "text_explicit_measurements": [
                {"type": "length", "segment": "AC", "value": 8}
            ],
            "observed_relations": [
                {"type": "point_on_segment", "point": "D", "segment": "AC"}
            ],
        }

        scene = self.agent._build_soft_sketch_drawable_scene(
            geometry_data,
            geometry_facts=geometry_facts,
            scene_error="solver failed",
            policy={"mode": "soft_sketch"},
        )

        self.assertEqual("soft_sketch_reconstruction", scene["layout_mode"])
        self.assertEqual("unverified_soft_sketch", scene["coordinate_status"])
        self.assertGreater(scene["points"]["B"]["pos"][1], scene["points"]["A"]["pos"][1])
        self.assertGreater(scene["points"]["C"]["pos"][0], scene["points"]["A"]["pos"][0])
        self.assertAlmostEqual(
            scene["points"]["D"]["pos"][1],
            scene["points"]["A"]["pos"][1],
            places=6,
        )
        self.assertEqual(
            0.0,
            scene["display"]["primitives"]["poly_ABC"]["fill_opacity"],
        )
        self.assertEqual(3, scene["soft_sketch_report"]["anchor_count"])
        self.assertIn("D", scene["soft_sketch_report"]["missing_points"])
        self.assertGreaterEqual(scene["soft_sketch_report"]["soft_constraint_count"], 1)
        self.assertGreaterEqual(scene["soft_sketch_report"]["hard_constraint_count"], 1)
        self.assertIn("refinement", scene["soft_sketch_report"])
        self.assertEqual(
            "schematic",
            self.agent._compute_vision_quality_level(
                text_source="model",
                geometry_source="model",
                scene_source="soft_sketch_reconstruction",
            ),
        )

    def test_soft_sketch_refines_distorted_anchors_toward_hard_right_angle(
        self,
    ) -> None:
        geometry_data = {
            "points": [
                {"id": "A", "pixel_coord": {"x": 10, "y": 90}},
                {"id": "B", "pixel_coord": {"x": 50, "y": 10}},
                {"id": "C", "pixel_coord": {"x": 110, "y": 90}},
            ],
            "primitives": [
                {"id": "line_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "line_AC", "type": "segment", "points": ["A", "C"]},
                {"id": "line_BC", "type": "segment", "points": ["B", "C"]},
                {"id": "right_BAC", "type": "right_angle", "points": ["B", "A", "C"]},
            ],
            "constraints": [],
            "measurements": [
                {"type": "angle", "entities": ["B", "A", "C"], "value": 90},
            ],
        }

        unrefined = self.agent._build_semantic_graph(geometry_data)
        self.agent._attach_pixel_anchor_positions(unrefined, geometry_data)
        before = self.agent._angle_degrees_2d(
            unrefined["points"]["B"]["pos"],
            unrefined["points"]["A"]["pos"],
            unrefined["points"]["C"]["pos"],
        )

        scene = self.agent._build_soft_sketch_drawable_scene(
            geometry_data,
            geometry_facts={
                "text_explicit_measurements": [
                    {"type": "angle", "entities": ["B", "A", "C"], "value": 90}
                ]
            },
            scene_error="solver failed",
            policy={"mode": "soft_sketch"},
        )
        after = self.agent._angle_degrees_2d(
            scene["points"]["B"]["pos"],
            scene["points"]["A"]["pos"],
            scene["points"]["C"]["pos"],
        )

        self.assertIsNotNone(before)
        self.assertIsNotNone(after)
        self.assertGreater(abs(before - 90.0), abs(after - 90.0))
        self.assertTrue(scene["soft_refinement_report"]["applied"])
        self.assertIn("C", scene["soft_refinement_report"]["adjusted_points"])

    def test_soft_sketch_fold_refinement_preserves_visual_anchor_shape(self) -> None:
        geometry_data = {
            "points": [
                {
                    "id": "C1",
                    "label": "C'",
                    "pixel_coord": {"x": 550, "y": 200},
                    "derived": {"type": "reflect_point", "source": "C", "axis": ["D", "E"]},
                },
                {"id": "A", "pixel_coord": {"x": 850, "y": 350}},
                {"id": "D", "pixel_coord": {"x": 1450, "y": 400}},
                {
                    "id": "B1",
                    "label": "B'",
                    "pixel_coord": {"x": 250, "y": 450},
                    "derived": {"type": "reflect_point", "source": "B", "axis": ["D", "E"]},
                },
                {"id": "E", "pixel_coord": {"x": 600, "y": 500}},
                {"id": "B", "pixel_coord": {"x": 400, "y": 700}},
                {"id": "C", "pixel_coord": {"x": 900, "y": 700}},
            ],
            "primitives": [
                {"id": "seg_AD", "type": "segment", "points": ["A", "D"]},
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "seg_DE", "type": "segment", "points": ["D", "E"]},
                {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
                {"id": "seg_AE", "type": "segment", "points": ["A", "E"]},
                {"id": "seg_EB1", "type": "segment", "points": ["E", "B1"]},
                {"id": "seg_B1C1", "type": "segment", "points": ["B1", "C1"]},
                {"id": "seg_C1D", "type": "segment", "points": ["C1", "D"]},
                {"id": "seg_EB", "type": "segment", "points": ["E", "B"]},
                {"id": "seg_CD", "type": "segment", "points": ["C", "D"]},
                {"id": "right_BEB1", "type": "right_angle", "points": ["B", "E", "B1"]},
            ],
            "constraints": [
                {"type": "point_on_segment", "entities": ["E", "AB"]},
                {"type": "equal_length", "entities": ["EB", "EB1"]},
                {"type": "perpendicular", "entities": ["EB", "EB1"]},
            ],
            "measurements": [
                {"type": "length", "entities": ["A", "D"], "value": 5},
            ],
            "fold_correspondences": [
                {"source": "B", "image": "B1"},
                {"source": "C", "image": "C1"},
            ],
        }
        base_scene = self.agent._build_semantic_graph(geometry_data)
        self.agent._attach_pixel_anchor_positions(base_scene, geometry_data)
        base_positions = {
            point_id: list(payload["pos"])
            for point_id, payload in base_scene["points"].items()
            if isinstance(payload, dict) and isinstance(payload.get("pos"), list)
        }

        scene = self.agent._build_soft_sketch_drawable_scene(
            geometry_data,
            geometry_facts={},
            scene_error="unsupported template: fold",
            policy={"mode": "soft_sketch"},
        )

        self.assertEqual(
            "fold_anchor_preserving",
            scene["soft_refinement_report"]["profile"],
        )
        self.assertLessEqual(scene["soft_refinement_report"]["iterations"], 8)

        max_anchor_drift = float(scene["soft_refinement_report"]["max_anchor_drift"])
        for point_id in ("A", "B1", "E"):
            current = scene["points"][point_id]["pos"]
            base = base_positions[point_id]
            drift = ((current[0] - base[0]) ** 2 + (current[1] - base[1]) ** 2) ** 0.5
            self.assertLessEqual(drift, max_anchor_drift + 1e-6)

    def test_process_uses_soft_sketch_when_coordinate_solver_fails(self) -> None:
        geometry_spec = {
            "points": [
                {"id": "A", "pixel_coord": {"x": 10, "y": 90}},
                {"id": "B", "pixel_coord": {"x": 10, "y": 10}},
                {"id": "C", "pixel_coord": {"x": 110, "y": 90}},
            ],
            "primitives": [
                {"id": "line_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "line_AC", "type": "segment", "points": ["A", "C"]},
                {"id": "line_BC", "type": "segment", "points": ["B", "C"]},
                {"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]},
            ],
            "constraints": [],
            "measurements": [],
        }

        with TemporaryDirectory() as tmp_dir:
            agent = VisionAgent(
                config={
                    "output_dir": tmp_dir,
                    "scan_preprocess_enabled": False,
                }
            )
            agent._extract_and_stabilize_bundle = lambda **_kwargs: {
                "bundle": {"problem_text": "沿BD折叠"},
                "problem_text": "沿BD折叠",
                "geometry_facts": {
                    "points": ["A", "B", "C"],
                    "text_explicit_measurements": [],
                },
                "vision_quality": {
                    "text_source": "model",
                    "geometry_source": "model",
                    "scene_source": "unknown",
                    "vision_quality_level": "recovered",
                    "fallback_events": [],
                },
            }
            agent._compile_and_infer = lambda **_kwargs: {
                "geometry_spec": geometry_spec,
                "semantic_signals": {"inferred_problem_pattern": "fold_transform"},
                "compile_error": None,
            }

            def _raise_solver_failure(_spec):
                raise CoordinateSceneError("template fold failed")

            agent.coordinate_scene_compiler.solve_coordinate_scene = _raise_solver_failure
            state = {
                "project": VideoProject(problem_image=__file__),
                "current_step": "start",
                "messages": [],
                "metadata": {},
            }

            result = agent.process(state)

            metadata = result["metadata"]
            self.assertEqual("vision_completed", result["current_step"])
            self.assertEqual(
                "soft_sketch_reconstruction",
                metadata["drawable_scene"]["layout_mode"],
            )
            self.assertEqual(
                "soft_sketch_from_normalized_geometry_spec",
                metadata["drawable_scene_source"],
            )
            self.assertEqual(
                "layout_contract.v1", metadata["layout_contract"]["version"]
            )
            self.assertEqual("layout_ir.v1", metadata["layout_ir"]["version"])
            self.assertEqual(
                "drawable_scene", metadata["layout_contract"]["default_scene_key"]
            )
            self.assertIn(
                "soft_sketch_reconstruction",
                metadata["vision_quality"]["fallback_events"],
            )
            self.assertEqual(
                "schematic",
                metadata["vision_quality"]["vision_quality_level"],
            )
            self.assertIn(
                "refinement",
                metadata["drawable_scene"]["soft_sketch_report"],
            )
            self.assertTrue(
                (Path(tmp_dir) / "debug" / "soft_sketch_report.json").exists()
            )

    def test_process_preserves_pixel_anchor_layout_when_static_solver_fails(
        self,
    ) -> None:
        geometry_spec = {
            "points": [
                {"id": "A", "pixel_coord": {"x": 1100, "y": 280}},
                {"id": "B", "pixel_coord": {"x": 780, "y": 780}},
                {"id": "C", "pixel_coord": {"x": 1420, "y": 780}},
                {"id": "P", "pixel_coord": {"x": 1050, "y": 520}},
                {"id": "Q", "pixel_coord": {"x": 1180, "y": 760}},
            ],
            "primitives": [
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
                {"id": "seg_CA", "type": "segment", "points": ["C", "A"]},
                {"id": "seg_BP", "type": "segment", "points": ["B", "P"]},
                {"id": "seg_PA", "type": "segment", "points": ["P", "A"]},
                {"id": "seg_BQ", "type": "segment", "points": ["B", "Q"]},
                {"id": "seg_QC", "type": "segment", "points": ["Q", "C"]},
                {"id": "seg_CP", "type": "segment", "points": ["C", "P"]},
                {"id": "seg_PQ", "type": "segment", "points": ["P", "Q"]},
                {"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]},
                {"id": "poly_ABP", "type": "polygon", "points": ["A", "B", "P"]},
                {"id": "poly_PBQ", "type": "polygon", "points": ["P", "B", "Q"]},
                {"id": "poly_PQC", "type": "polygon", "points": ["P", "Q", "C"]},
            ],
            "constraints": [],
            "measurements": [],
        }

        with TemporaryDirectory() as tmp_dir:
            agent = VisionAgent(
                config={
                    "output_dir": tmp_dir,
                    "scan_preprocess_enabled": False,
                }
            )
            agent._extract_and_stabilize_bundle = lambda **_kwargs: {
                "bundle": {"problem_text": "顺时针旋转三角形ABP 60度，连接PQ"},
                "problem_text": "顺时针旋转三角形ABP 60度，连接PQ",
                "geometry_facts": {"points": ["A", "B", "C", "P", "Q"]},
                "vision_quality": {
                    "text_source": "model",
                    "geometry_source": "model",
                    "scene_source": "unknown",
                    "vision_quality_level": "recovered",
                    "fallback_events": [],
                },
            }
            agent._compile_and_infer = lambda **_kwargs: {
                "geometry_spec": geometry_spec,
                "semantic_signals": {"inferred_problem_pattern": "static_proof"},
                "compile_error": None,
            }
            agent.coordinate_scene_compiler.solve_coordinate_scene = (
                lambda _spec: (_ for _ in ()).throw(
                    CoordinateSceneError("template generic_triangle failed")
                )
            )
            state = {
                "project": VideoProject(problem_image=__file__),
                "current_step": "start",
                "messages": [],
                "metadata": {},
            }

            result = agent.process(state)

            scene = result["metadata"]["drawable_scene"]
            points = {
                item["id"]: item
                for item in scene["points"]
                if isinstance(item, dict) and item.get("id")
            }
            self.assertEqual("soft_sketch_reconstruction", scene["layout_mode"])
            self.assertIn(
                "pixel_anchor_soft_sketch_fallback",
                result["metadata"]["vision_quality"]["fallback_events"],
            )
            point_pos = {
                point_id: payload.get("pos") or payload.get("coord")
                for point_id, payload in points.items()
            }
            self.assertLess(point_pos["B"][0], point_pos["C"][0])
            self.assertGreater(point_pos["P"][1], point_pos["Q"][1])
            self.assertGreater(point_pos["A"][1], point_pos["P"][1])

    def test_process_prefers_soft_sketch_even_when_coordinate_scene_succeeds(
        self,
    ) -> None:
        geometry_spec = {
            "points": [
                {"id": "A", "pixel_coord": {"x": 10, "y": 90}},
                {"id": "B", "pixel_coord": {"x": 10, "y": 10}},
                {"id": "C", "pixel_coord": {"x": 110, "y": 90}},
            ],
            "primitives": [
                {"id": "line_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "line_AC", "type": "segment", "points": ["A", "C"]},
                {"id": "line_BC", "type": "segment", "points": ["B", "C"]},
                {"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]},
            ],
            "constraints": [],
            "measurements": [],
        }

        with TemporaryDirectory() as tmp_dir:
            agent = VisionAgent(
                config={
                    "output_dir": tmp_dir,
                    "scan_preprocess_enabled": False,
                }
            )
            agent._extract_and_stabilize_bundle = lambda **_kwargs: {
                "bundle": {"problem_text": "在三角形ABC中"},
                "problem_text": "在三角形ABC中",
                "geometry_facts": {
                    "points": ["A", "B", "C"],
                    "text_explicit_measurements": [],
                },
                "vision_quality": {
                    "text_source": "model",
                    "geometry_source": "model",
                    "scene_source": "unknown",
                    "vision_quality_level": "recovered",
                    "fallback_events": [],
                },
            }
            agent._compile_and_infer = lambda **_kwargs: {
                "geometry_spec": geometry_spec,
                "semantic_signals": {},
                "compile_error": None,
            }
            coordinate_scene = {
                "mode": "2d",
                "points": [
                    {"id": "A", "coord": [0, 0]},
                    {"id": "B", "coord": [0, 6]},
                    {"id": "C", "coord": [8, 0]},
                ],
                "primitives": geometry_spec["primitives"],
                "constraints": [],
                "measurements": [],
            }
            agent.coordinate_scene_compiler.normalize_geometry_spec = (
                lambda _spec: geometry_spec
            )
            agent.coordinate_scene_compiler.solve_coordinate_scene = (
                lambda _spec: coordinate_scene
            )
            agent.coordinate_scene_compiler.validate_coordinate_scene = (
                lambda *_args, **_kwargs: {
                    "is_valid": True,
                    "failed_checks": [],
                    "missing_entities": [],
                    "unsupported_relations": [],
                    "solver_trace": [],
                }
            )
            agent.coordinate_scene_compiler.derive_semantic_graph = (
                lambda _scene: {"points": {}, "primitives": []}
            )
            agent.coordinate_scene_compiler.derive_drawable_scene = (
                lambda _scene: coordinate_scene
            )
            agent.coordinate_scene_compiler.export_ggb_commands = lambda _scene: []
            agent.coordinate_scene_compiler.write_debug_exports = (
                lambda **_kwargs: {}
            )
            state = {
                "project": VideoProject(problem_image=__file__),
                "current_step": "start",
                "messages": [],
                "metadata": {},
            }

            result = agent.process(state)

            metadata = result["metadata"]
            self.assertIsNotNone(metadata["coordinate_scene"])
            self.assertEqual(
                "soft_sketch_reconstruction",
                metadata["drawable_scene"]["layout_mode"],
            )
            self.assertEqual(
                "soft_sketch_priority_from_normalized_geometry_spec",
                metadata["drawable_scene_source"],
            )
            self.assertEqual(
                "soft_sketch_reconstruction",
                metadata["vision_scene_source"],
            )
            self.assertEqual(
                "layout_contract.v1", metadata["layout_contract"]["version"]
            )
            self.assertEqual("layout_ir.v1", metadata["layout_ir"]["version"])
            self.assertEqual(
                "drawable_scene", metadata["layout_contract"]["default_scene_key"]
            )

    def test_sanitize_geometry_facts_preserves_circle_and_arc_content(self) -> None:
        facts = {
            "points": ["A", "B", "C"],
            "circles": [
                {"id": "circle_O", "center": "O", "points_on_circle": ["A", "B", "C"]}
            ],
            "arcs": [{"id": "arc_AB", "circle": "circle_O", "points": ["A", "B"]}],
            "relations": [{"type": "point_on_circle", "entities": ["C", "circle_O"]}],
            "measurements": [{"type": "length", "entities": ["A", "B"], "value": 4}],
        }

        sanitized = self.agent._sanitize_geometry_facts(
            facts,
            problem_text="在⊙O中，AB=4，点C在⊙O上，弧AB所对的圆周角为锐角",
        )
        self.assertTrue(any(item.get("center") == "O" for item in sanitized["circles"]))
        self.assertTrue(
            any(item.get("circle") == "circle_O" for item in sanitized["arcs"])
        )
        self.assertIn("O", sanitized["points"])

        geometry_spec = self.fact_compiler.compile(
            sanitized,
            problem_text="在⊙O中，AB=4，点C在⊙O上",
        )

        primitive_types = {
            str(item.get("type", "")).lower()
            for item in geometry_spec.get("primitives", [])
        }
        self.assertIn("circle", primitive_types)
        self.assertIn("arc", primitive_types)
        self.assertTrue(
            any(
                str(item.get("type", "")).lower() == "point_on_circle"
                for item in geometry_spec.get("constraints", [])
            )
        )

    def test_process_success_path_uses_compiler_layout_bundle_boundary(self) -> None:
        with TemporaryDirectory() as tmp_dir:
            agent = VisionAgent(
                config={
                    "output_dir": tmp_dir,
                    "scan_preprocess_enabled": False,
                }
            )
            geometry_spec = {
                "points": [{"id": "A"}, {"id": "B"}],
                "primitives": [{"id": "seg_AB", "type": "segment", "points": ["A", "B"]}],
                "constraints": [],
                "measurements": [],
            }
            agent._extract_and_stabilize_bundle = lambda **_kwargs: {
                "bundle": {"problem_text": "已知AB"},
                "problem_text": "已知AB",
                "geometry_facts": {"points": ["A", "B"], "segments": ["AB"]},
                "vision_quality": {
                    "text_source": "model",
                    "geometry_source": "model",
                    "scene_source": "unknown",
                    "vision_quality_level": "recovered",
                    "fallback_events": [],
                },
            }
            agent._compile_and_infer = lambda **_kwargs: {
                "geometry_spec": geometry_spec,
                "semantic_signals": {},
                "compile_error": None,
            }
            calls = []
            normalized_spec = {
                "points": [{"id": "A"}, {"id": "B"}],
                "primitives": [{"id": "seg_AB", "type": "segment", "points": ["A", "B"]}],
                "constraints": [],
                "measurements": [],
            }
            agent.coordinate_scene_compiler.normalize_geometry_spec = (
                lambda _spec: normalized_spec
            )

            def _solve_layout_bundle(_normalized_spec, **_kwargs):
                calls.append(copy.deepcopy(_normalized_spec))
                return {
                    "layout_ir": {
                        "version": "layout_ir.v1",
                        "coordinate_scene_verified": True,
                        "candidates": [],
                    },
                    "coordinate_scene": {
                        "mode": "2d",
                        "points": [{"id": "A", "coord": [0, 0]}, {"id": "B", "coord": [1, 0]}],
                        "primitives": [{"id": "seg_AB", "type": "segment", "points": ["A", "B"]}],
                    },
                    "drawable_scene": {
                        "mode": "2d",
                        "layout_mode": "solved_coordinate_scene",
                        "points": {"A": {"coord": [0, 0]}, "B": {"coord": [1, 0]}},
                        "primitives": [{"id": "seg_AB", "type": "segment", "points": ["A", "B"]}],
                    },
                    "coordinate_scene_validation": {
                        "is_valid": True,
                        "failed_checks": [],
                        "missing_entities": [],
                        "unsupported_relations": [],
                        "solver_trace": [],
                    },
                    "normalized_spec": normalized_spec,
                }

            agent.coordinate_scene_compiler.solve_layout_bundle = _solve_layout_bundle
            agent.coordinate_scene_compiler.solve_coordinate_scene = (
                lambda _spec: (_ for _ in ()).throw(AssertionError("should not call solve_coordinate_scene directly"))
            )
            agent.coordinate_scene_compiler.derive_semantic_graph = (
                lambda _scene: {"points": {}, "primitives": []}
            )
            agent.coordinate_scene_compiler.derive_drawable_scene = (
                lambda _scene: (_ for _ in ()).throw(AssertionError("should not call derive_drawable_scene on default path"))
            )
            agent.coordinate_scene_compiler.export_ggb_commands = lambda _scene: []
            agent.coordinate_scene_compiler.write_debug_exports = lambda **_kwargs: {}
            state = {
                "project": VideoProject(problem_image=__file__),
                "current_step": "start",
                "messages": [],
                "metadata": {},
            }

            result = agent.process(state)

        self.assertEqual(1, len(calls))
        self.assertEqual(normalized_spec, calls[0])
        self.assertEqual("layout_ir.v1", result["metadata"]["layout_ir"]["version"])

    def test_schematic_drawable_scene_solver_fallback_uses_layout_bundle_boundary(
        self,
    ) -> None:
        geometry_data = {
            "points": [{"id": "A"}, {"id": "B"}],
            "primitives": [{"id": "seg_AB", "type": "segment", "points": ["A", "B"]}],
            "constraints": [],
            "measurements": [],
        }
        calls = []

        def _solve_layout_bundle(_normalized_spec, **kwargs):
            calls.append({"spec": copy.deepcopy(_normalized_spec), "kwargs": kwargs})
            return {
                "layout_ir": {"version": "layout_ir.v1", "candidates": []},
                "coordinate_scene": {
                    "mode": "2d",
                    "points": [{"id": "A", "coord": [0, 0]}, {"id": "B", "coord": [1, 0]}],
                    "primitives": [{"id": "seg_AB", "type": "segment", "points": ["A", "B"]}],
                },
                "drawable_scene": {
                    "mode": "2d",
                    "layout_mode": "solved_coordinate_scene",
                    "points": {"A": {"coord": [0, 0]}, "B": {"coord": [1, 0]}},
                    "primitives": [{"id": "seg_AB", "type": "segment", "points": ["A", "B"]}],
                },
                "coordinate_scene_validation": {"is_valid": True, "failed_checks": []},
            }

        self.agent.coordinate_scene_compiler.solve_layout_bundle = _solve_layout_bundle
        self.agent.coordinate_scene_compiler.solve_coordinate_scene = (
            lambda _spec: (_ for _ in ()).throw(AssertionError("should not call solve_coordinate_scene in schematic fallback"))
        )
        self.agent.coordinate_scene_compiler.derive_drawable_scene = (
            lambda _scene: (_ for _ in ()).throw(AssertionError("should not call derive_drawable_scene in schematic fallback"))
        )

        scene = self.agent._build_schematic_drawable_scene(
            geometry_data,
            allow_solver_fallback=True,
        )

        self.assertEqual(1, len(calls))
        self.assertEqual("schematic_solver_fallback", scene["layout_mode"])

    def test_sanitize_keeps_angle_entities_and_label_defined_angle(self) -> None:
        facts = {
            "points": ["A", "B", "C"],
            "angles": [{"label": "∠ABC"}],
            "measurements": [
                {"type": "angle", "entities": ["A", "B", "C"], "value": 60}
            ],
        }

        sanitized = self.agent._sanitize_geometry_facts(
            facts,
            problem_text="在三角形ABC中，∠ABC=60°",
        )
        self.assertTrue(any(item.get("vertex") == "B" for item in sanitized["angles"]))
        self.assertTrue(
            any(
                item.get("type") == "angle" and item.get("entities") == ["A", "B", "C"]
                for item in sanitized["measurements"]
            )
        )

        geometry_spec = self.fact_compiler.compile(
            sanitized, problem_text="在三角形ABC中，∠ABC=60°"
        )
        self.assertTrue(
            any(
                item.get("type") == "angle" and item.get("entities") == ["A", "B", "C"]
                for item in geometry_spec.get("measurements", [])
            )
        )

    def test_rhombus_equal_length_relations_are_pairwise(self) -> None:
        sanitized = self.agent._sanitize_geometry_facts(
            {"points": ["A", "B", "C", "D"]},
            problem_text="在菱形ABCD中，求证对角线互相垂直",
        )

        equal_relations = [
            item
            for item in sanitized.get("derived_relations", [])
            if str(item.get("type", "")).lower() == "equal_length"
        ]
        self.assertGreaterEqual(len(equal_relations), 3)
        self.assertTrue(
            all(len(item.get("segments", [])) == 2 for item in equal_relations)
        )
        self.assertFalse(
            any(
                str(item.get("type", "")).lower() == "equal_length"
                for item in sanitized.get("relations", [])
            )
        )

    def test_compose_compiler_geometry_facts_ignores_derived_by_default(self) -> None:
        geometry_facts = {
            "observed_relations": [
                {"type": "point_on_segment", "point": "E", "segment": "AB"}
            ],
            "text_explicit_relations": [{"type": "parallel", "segments": ["AB", "CD"]}],
            "derived_relations": [
                {"type": "equal_length", "segments": ["AB", "BC"], "confidence": 0.95}
            ],
            "observed_measurements": [{"type": "length", "segment": "AD", "value": 5}],
            "text_explicit_measurements": [
                {"type": "angle", "angle": "∠ABC", "value": 60}
            ],
            "derived_measurements": [
                {
                    "type": "angle",
                    "angle": "∠B",
                    "value": "arctan(2)",
                    "confidence": 0.95,
                }
            ],
        }

        composed = self.agent._compose_compiler_geometry_facts(
            geometry_facts,
            problem_text="在菱形ABCD中，AD=5，tanB=2",
        )

        relation_types = {
            str(item.get("type", "")).lower() for item in composed.get("relations", [])
        }
        measurement_angles = {
            str(item.get("angle", "")).strip()
            for item in composed.get("measurements", [])
            if str(item.get("type", "")).lower() == "angle"
        }
        self.assertIn("point_on_segment", relation_types)
        self.assertIn("parallel", relation_types)
        self.assertNotIn("equal_length", relation_types)
        self.assertIn("∠ABC", measurement_angles)
        self.assertNotIn("∠B", measurement_angles)

    def test_compose_compiler_geometry_facts_blocks_derived_on_high_risk_even_if_enabled(
        self,
    ) -> None:
        agent = VisionAgent(
            config={
                "output_dir": "./output_test",
                "allow_derived_facts_for_compiler": True,
            }
        )
        geometry_facts = {
            "observed_relations": [
                {"type": "point_on_segment", "point": "E", "segment": "AB"}
            ],
            "derived_relations": [
                {"type": "equal_length", "segments": ["AB", "BC"], "confidence": 0.99}
            ],
            "observed_measurements": [{"type": "length", "segment": "AD", "value": 5}],
            "derived_measurements": [
                {
                    "type": "angle",
                    "angle": "∠B",
                    "value": "arctan(2)",
                    "confidence": 0.99,
                }
            ],
        }

        composed = agent._compose_compiler_geometry_facts(
            geometry_facts,
            problem_text="沿DE折叠后求值",
        )

        relation_types = {
            str(item.get("type", "")).lower() for item in composed.get("relations", [])
        }
        measurement_angles = {
            str(item.get("angle", "")).strip()
            for item in composed.get("measurements", [])
            if str(item.get("type", "")).lower() == "angle"
        }
        self.assertIn("point_on_segment", relation_types)
        self.assertNotIn("equal_length", relation_types)
        self.assertNotIn("∠B", measurement_angles)

    def test_compose_compiler_geometry_facts_filters_low_confidence_derived_even_when_enabled(
        self,
    ) -> None:
        agent = VisionAgent(
            config={
                "output_dir": "./output_test",
                "allow_derived_facts_for_compiler": True,
            }
        )

        raw_bundle = {
            "problem_text": "在四边形ABCD中，已知条件如下",
            "geometry_facts": {
                "points": ["A", "B", "C", "D"],
                "segments": ["AB", "BC", "CD", "DA"],
                "derived_relations": [
                    {"type": "parallel", "segments": ["AB", "CD"], "confidence": 0.35}
                ],
                "derived_measurements": [
                    {
                        "type": "angle",
                        "angle": "∠B",
                        "value": "arctan(2)",
                        "confidence": 0.35,
                    }
                ],
            },
        }

        stabilized = agent._stabilize_problem_bundle(raw_bundle, image_path=__file__)
        composed = agent._compose_compiler_geometry_facts(
            stabilized.get("geometry_facts") or {},
            problem_text=stabilized.get("problem_text", ""),
        )

        relation_types = {
            str(item.get("type", "")).lower() for item in composed.get("relations", [])
        }
        measurement_angles = {
            str(item.get("angle", "")).strip()
            for item in composed.get("measurements", [])
            if str(item.get("type", "")).lower() == "angle"
        }
        self.assertNotIn("parallel", relation_types)
        self.assertNotIn("∠B", measurement_angles)

    def test_sanitize_preserves_input_layered_fact_buckets(self) -> None:
        facts = {
            "points": ["A", "B", "C", "D", "E"],
            "segments": ["AB", "BC", "CD", "DA"],
            "relations": [{"type": "point_on_segment", "point": "E", "segment": "AB"}],
            "text_explicit_relations": [{"type": "parallel", "segments": ["AB", "CD"]}],
            "inferred_relations": [
                {"type": "equal_length", "segments": ["AB", "BC"], "confidence": 0.92}
            ],
            "measurements": [{"type": "length", "segment": "AB", "value": 3}],
            "text_explicit_measurements": [
                {"type": "angle", "angle": "∠ABC", "value": 60}
            ],
            "inferred_measurements": [
                {
                    "type": "angle",
                    "angle": "∠B",
                    "value": "arctan(2)",
                    "confidence": 0.9,
                }
            ],
        }

        sanitized = self.agent._sanitize_geometry_facts(
            facts,
            problem_text="在四边形ABCD中，AB∥CD，AB=3，∠ABC=60°",
        )

        self.assertTrue(
            any(
                item.get("type") == "parallel"
                for item in sanitized.get("text_explicit_relations", [])
            )
        )
        self.assertTrue(
            any(
                item.get("type") == "equal_length"
                for item in sanitized.get("derived_relations", [])
            )
        )
        self.assertTrue(
            any(
                item.get("angle") == "∠ABC"
                for item in sanitized.get("text_explicit_measurements", [])
            )
        )
        self.assertTrue(
            any(
                item.get("angle") == "∠B"
                for item in sanitized.get("derived_measurements", [])
            )
        )

    def test_sanitize_downgrades_unverified_visual_geometry_guess(self) -> None:
        sanitized = self.agent._sanitize_geometry_facts(
            {
                "points": ["A", "B", "C", "D"],
                "segments": ["AB", "CD"],
                "relations": [
                    {"type": "perpendicular", "segments": ["AB", "CD"], "confidence": 0.7}
                ],
            },
            problem_text="如图，在四边形ABCD中，已知AB=5，求CD的长。",
        )

        relation_types = {
            str(item.get("type", "")).lower() for item in sanitized.get("relations", [])
        }
        unverified = sanitized.get("unverified_observed_relations", [])

        self.assertNotIn("perpendicular", relation_types)
        self.assertEqual(1, len(unverified))
        self.assertEqual("unverified_from_text", unverified[0].get("status"))
        self.assertLess(unverified[0].get("confidence", 1.0), 0.3)
        self.assertEqual(
            1,
            sanitized["fact_verification_report"]["unverified_observed_relations"],
        )

    def test_text_explicit_parallel_supports_visual_parallel_guess(self) -> None:
        sanitized = self.agent._sanitize_geometry_facts(
            {
                "points": ["A", "B", "C", "D"],
                "segments": ["AB", "CD"],
                "relations": [
                    {"type": "parallel", "segments": ["AB", "CD"], "confidence": 0.62}
                ],
            },
            problem_text="已知AB∥CD，求证相关结论。",
        )

        relation_types = [
            str(item.get("type", "")).lower() for item in sanitized.get("relations", [])
        ]
        text_explicit = sanitized.get("text_explicit_relations", [])
        observed = sanitized.get("observed_relations", [])

        self.assertIn("parallel", relation_types)
        self.assertFalse(sanitized.get("unverified_observed_relations"))
        self.assertTrue(
            any(item.get("type") == "parallel" for item in text_explicit)
        )
        self.assertTrue(
            any(item.get("text_verification") == "matched_text_fact" for item in observed)
        )

    def test_compose_compiler_geometry_facts_blocks_derived_on_circle_high_risk(
        self,
    ) -> None:
        agent = VisionAgent(
            config={
                "output_dir": "./output_test",
                "allow_derived_facts_for_compiler": True,
            }
        )
        geometry_facts = {
            "observed_relations": [
                {"type": "point_on_circle", "point": "C", "circle": "circle_O"}
            ],
            "derived_relations": [
                {"type": "parallel", "segments": ["AB", "CD"], "confidence": 0.99}
            ],
            "observed_measurements": [{"type": "length", "segment": "AB", "value": 4}],
            "derived_measurements": [
                {
                    "type": "angle",
                    "angle": "∠B",
                    "value": "arctan(2)",
                    "confidence": 0.99,
                }
            ],
        }

        composed = agent._compose_compiler_geometry_facts(
            geometry_facts,
            problem_text="在圆O中，已知点C在圆上，求证某结论",
        )

        relation_types = {
            str(item.get("type", "")).lower() for item in composed.get("relations", [])
        }
        measurement_angles = {
            str(item.get("angle", "")).strip()
            for item in composed.get("measurements", [])
            if str(item.get("type", "")).lower() == "angle"
        }
        self.assertIn("point_on_circle", relation_types)
        self.assertNotIn("parallel", relation_types)
        self.assertNotIn("∠B", measurement_angles)

    def test_extract_text_facts_from_problem_text_outputs_structured_layers(
        self,
    ) -> None:
        text = "在Rt△ABC中，菱形ABCD中，E是AB上一点，M是CD的中点，AD=5，∠ABC=60°，tanB=2"
        text_facts = self.agent._extract_text_facts_from_problem_text(text)

        relation_types = {
            str(item.get("type", "")).lower()
            for item in text_facts.get("text_explicit_relations", [])
        }
        angle_values = {
            str(item.get("angle", "")).strip(): item.get("value")
            for item in text_facts.get("text_explicit_measurements", [])
            if str(item.get("type", "")).lower() == "angle"
        }
        derived_angles = {
            str(item.get("angle", "")).strip()
            for item in text_facts.get("derived_measurements", [])
            if str(item.get("type", "")).lower() == "angle"
        }

        self.assertIn("point_on_segment", relation_types)
        self.assertIn("midpoint", relation_types)
        self.assertNotIn("R", text_facts.get("points", []))
        self.assertEqual(angle_values.get("∠ABC"), 60.0)
        self.assertIn("∠B", derived_angles)

    def test_extract_text_facts_keeps_proof_goals_out_of_hard_relations(
        self,
    ) -> None:
        text = (
            "已知，FC是正方形ABCD和正方形AEFG上的点F、C的连线，"
            "点H是FC的中点，连接EH、DH。求证：EH=DH且EH⊥DH。"
        )
        text_facts = self.agent._extract_text_facts_from_problem_text(text)

        hard_relations = text_facts.get("text_explicit_relations", [])
        goal_relations = text_facts.get("derived_relations", [])
        hard_types = {str(item.get("type", "")).lower() for item in hard_relations}
        goal_types = {str(item.get("type", "")).lower() for item in goal_relations}

        self.assertIn("midpoint", hard_types)
        self.assertNotIn("equal_length", hard_types)
        self.assertNotIn("perpendicular", hard_types)
        self.assertIn("equal_length", goal_types)
        self.assertIn("perpendicular", goal_types)
        self.assertTrue(
            all(
                str(item.get("status", "")).lower() == "goal"
                for item in goal_relations
            )
        )

    def test_stabilize_problem_bundle_merges_text_facts_into_layered_geometry_facts(
        self,
    ) -> None:
        bundle = {
            "problem_text": "在菱形ABCD中，E是AB上一点，AD=5，∠ABC=60°，tanB=2",
            "geometry_facts": {
                "points": ["A", "B", "C", "D"],
                "segments": ["AB", "BC", "CD", "DA"],
                "relations": [],
                "measurements": [],
            },
        }

        self.agent._extract_problem_text_fallback = lambda _image_path: bundle[
            "problem_text"
        ]
        stabilized = self.agent._stabilize_problem_bundle(bundle, image_path=__file__)
        geometry_facts = stabilized.get("geometry_facts") or {}

        self.assertTrue(stabilized.get("text_facts"))
        self.assertTrue(geometry_facts.get("text_explicit_relations"))
        self.assertTrue(geometry_facts.get("text_explicit_measurements"))
        self.assertTrue(geometry_facts.get("derived_measurements"))
        self.assertTrue(geometry_facts.get("inferred_measurements"))

    def test_stabilize_problem_bundle_emits_scene_draft_and_geometry_ir(self) -> None:
        bundle = {
            "problem_text": "在四边形ABCD中，已知AB∥CD，点E在AB上，∠ABC=90°，求证相关结论。",
            "geometry_facts": {
                "points": [
                    {
                        "id": "A",
                        "pixel_coord": {"x": 10, "y": 80},
                        "pixel_coord_space": "source",
                        "label_bbox": {"x1": 4, "y1": 70, "x2": 14, "y2": 82},
                    },
                    {"id": "B", "pixel_coord": {"x": 110, "y": 80}},
                    {"id": "C", "pixel_coord": {"x": 100, "y": 20}},
                    {"id": "D", "pixel_coord": {"x": 20, "y": 20}},
                    {"id": "E", "pixel_coord": {"x": 55, "y": 80}},
                ],
                "segments": ["AB", "BC", "CD", "DA"],
                "relations": [
                    {
                        "type": "parallel",
                        "segments": ["AB", "CD"],
                        "confidence": 0.62,
                    }
                ],
                "measurements": [
                    {"type": "length", "segment": "AB", "value": 5},
                    {"type": "angle", "angle": "∠ABC", "value": 90},
                ],
            },
        }

        stabilized = self.agent._stabilize_problem_bundle(bundle, image_path=__file__)
        scene_draft = stabilized.get("scene_draft") or {}
        geometry_ir = stabilized.get("geometry_ir") or {}

        self.assertEqual("scene_draft.v1", scene_draft.get("version"))
        point_a = {
            item["id"]: item for item in scene_draft.get("points", []) if "id" in item
        }["A"]
        self.assertEqual({"x": 10, "y": 80}, point_a.get("pixel_coord"))
        self.assertNotIn("coord", point_a)
        self.assertEqual("geometry_ir.v1", geometry_ir.get("version"))
        self.assertTrue(
            geometry_ir.get("merge_policy", {}).get("text_must_not_overwrite_visual")
        )
        self.assertEqual(
            "visual_observed",
            geometry_ir.get("facts", {})
            .get("visual_observed", {})
            .get("source"),
        )
        visual_intergps = (
            geometry_ir.get("facts", {})
            .get("visual_observed", {})
            .get("intergps", {})
        )
        self.assertEqual("intergps_predicates.v1", visual_intergps.get("schema"))
        self.assertIn(
            "Parallel(Line(A,B),Line(C,D))",
            visual_intergps.get("logic_forms", []),
        )
        self.assertIn(
            "Equals(LengthOf(Line(A,B)),5.0)",
            visual_intergps.get("logic_forms", []),
        )
        self.assertIn(
            "Equals(MeasureOf(Angle(A,B,C)),90.0)",
            visual_intergps.get("logic_forms", []),
        )
        self.assertTrue(visual_intergps.get("geometric_shapes"))
        self.assertTrue(visual_intergps.get("binary_relations"))
        self.assertTrue(visual_intergps.get("numerical_relations"))
        self.assertTrue(
            geometry_ir.get("facts", {})
            .get("text_explicit", {})
            .get("relations")
        )

    def test_geometry_ir_intergps_visual_observed_maps_circle_and_angle_predicates(
        self,
    ) -> None:
        geometry_ir = self.agent.geometry_normalizer.build_geometry_ir(
            {
                "points": ["O", "A", "B", "C"],
                "segments": ["OA", "AB", "BC"],
                "circles": [{"id": "circle_O", "center": "O"}],
                "right_angles": [{"points": ["A", "B", "C"]}],
                "relations": [
                    {"type": "point_on_circle", "point": "A", "circle": "circle_O"},
                    {"type": "perpendicular", "segments": ["AB", "BC"]},
                ],
            },
            problem_text="",
        )

        visual_intergps = (
            geometry_ir.get("facts", {})
            .get("visual_observed", {})
            .get("intergps", {})
        )
        logic_forms = visual_intergps.get("logic_forms", [])

        self.assertIn("Circle(O)", logic_forms)
        self.assertIn("PointLiesOnCircle(Point(A),Circle(O))", logic_forms)
        self.assertIn("Perpendicular(Line(A,B),Line(B,C))", logic_forms)
        self.assertIn("RightAngle(Angle(A,B,C))", logic_forms)
        self.assertTrue(visual_intergps.get("geometric_shapes"))
        self.assertTrue(visual_intergps.get("binary_relations"))
        self.assertTrue(visual_intergps.get("unary_attributes"))

    def test_geometry_ir_intergps_accepts_dict_segment_refs(self) -> None:
        geometry_ir = self.agent.geometry_normalizer.build_geometry_ir(
            {
                "points": ["A", "B", "C", "D", "E"],
                "segments": [{"id": "seg_AB", "points": ["A", "B"]}, "CD"],
                "relations": [
                    {
                        "type": "parallel",
                        "segments": [
                            {"id": "seg_AB", "points": ["A", "B"]},
                            {"points": ["C", "D"]},
                        ],
                    },
                    {
                        "type": "point_on_segment",
                        "point": "E",
                        "segment": {"points": ["A", "B"]},
                    },
                ],
                "measurements": [
                    {"type": "length", "segment": {"points": ["A", "B"]}, "value": 3}
                ],
            },
            problem_text="",
        )

        logic_forms = (
            geometry_ir.get("facts", {})
            .get("visual_observed", {})
            .get("intergps", {})
            .get("logic_forms", [])
        )

        self.assertIn("Line(A,B)", logic_forms)
        self.assertIn("Parallel(Line(A,B),Line(C,D))", logic_forms)
        self.assertIn("PointLiesOnLine(Point(E),Line(A,B))", logic_forms)
        self.assertIn("Equals(LengthOf(Line(A,B)),3)", logic_forms)

    def test_geometry_ir_intergps_covers_text_layer_semantic_predicates(self) -> None:
        geometry_ir = self.agent.geometry_normalizer.build_geometry_ir(
            {
                "points": ["A", "B", "C", "D", "E", "F", "O"],
                "segments": ["AB", "BC", "DE", "EF", "AO"],
                "circles": [{"id": "circle_O", "center": "O"}],
                "text_explicit_relations": [
                    {
                        "type": "similar",
                        "polygons": ["ABC", "DEF"],
                    },
                    {
                        "type": "tangent",
                        "line": "AB",
                        "circle": "circle_O",
                    },
                    {
                        "type": "midpoint",
                        "point": "B",
                        "segment": "AC",
                    },
                ],
                "text_explicit_measurements": [
                    {"type": "area", "polygon": "ABC", "value": 12},
                    {"type": "perimeter", "polygon": "DEF", "value": 18},
                ],
                "goals": [{"type": "area", "polygon": "ABC"}],
                "text_explicit_theorems": ["Triangle Similarity"],
            },
            problem_text="",
        )

        text_intergps = (
            geometry_ir.get("facts", {})
            .get("text_explicit", {})
            .get("intergps", {})
        )
        logic_forms = text_intergps.get("logic_forms", [])

        self.assertIn("Similar(Triangle(A,B,C),Triangle(D,E,F))", logic_forms)
        self.assertIn("Tangent(Line(A,B),Circle(O))", logic_forms)
        self.assertIn("IsMidpointOf(Point(B),Line(A,C))", logic_forms)
        self.assertIn("Equals(AreaOf(Triangle(A,B,C)),12)", logic_forms)
        self.assertIn("Equals(PerimeterOf(Triangle(D,E,F)),18)", logic_forms)
        self.assertIn("Find(AreaOf(Triangle(A,B,C)))", logic_forms)
        self.assertIn("UseTheorem(Triangle_Similarity)", logic_forms)

    def test_geometry_fact_compiler_preserves_semantic_relations_and_measurements(
        self,
    ) -> None:
        geometry_spec = self.fact_compiler.compile(
            {
                "points": ["A", "B", "C", "D", "E", "F", "O"],
                "segments": ["AB", "BC", "CA", "DE", "EF", "FD", "AO"],
                "polygons": ["ABC", "DEF"],
                "circles": [{"id": "circle_O", "center": "O", "radius_point": "A"}],
                "relations": [
                    {"type": "similar", "polygons": ["ABC", "DEF"]},
                    {"type": "tangent", "line": "AB", "circle": "circle_O"},
                    {"type": "radius", "line": "AO", "circle": "circle_O"},
                ],
                "measurements": [
                    {"type": "area", "polygon": "ABC", "value": 12},
                    {"type": "perimeter", "polygon": "DEF", "value": 18},
                ],
            },
            problem_text="",
        )

        constraints = geometry_spec.get("constraints", [])
        measurements = geometry_spec.get("measurements", [])
        relation_types = {str(item.get("type", "")).lower() for item in constraints}
        measurement_types = {
            str(item.get("type", "")).lower() for item in measurements
        }

        self.assertIn("similar", relation_types)
        self.assertIn("tangent", relation_types)
        self.assertIn("radius", relation_types)
        self.assertIn("area", measurement_types)
        self.assertIn("perimeter", measurement_types)

    def test_stabilize_problem_bundle_uses_geometry_normalizer_boundary(self) -> None:
        calls = []

        class _StubNormalizer:
            def normalize(self, geometry_facts, *, problem_text, image_size=None, scene_draft=None):
                calls.append(
                    {
                        "geometry_facts": geometry_facts,
                        "problem_text": problem_text,
                        "image_size": image_size,
                        "scene_draft": scene_draft,
                    }
                )
                return {
                    "scene_draft": {"version": "scene_draft.v1", "points": [{"id": "A"}]},
                    "geometry_ir": {"version": "geometry_ir.v1", "facts": {}},
                }

        self.agent.geometry_normalizer = _StubNormalizer()
        bundle = {
            "problem_text": "已知AB=3。",
            "geometry_facts": {"points": ["A", "B"], "segments": ["AB"]},
        }

        stabilized = self.agent._stabilize_problem_bundle(bundle, image_path=__file__)

        self.assertEqual(1, len(calls))
        self.assertEqual("已知AB=3。", calls[0]["problem_text"])
        self.assertEqual("scene_draft.v1", stabilized["scene_draft"]["version"])
        self.assertEqual("geometry_ir.v1", stabilized["geometry_ir"]["version"])

    def test_compile_geometry_spec_from_geometry_ir_uses_only_hard_layers_by_default(
        self,
    ) -> None:
        bundle = {
            "problem_text": "在四边形ABCD中，已知AB∥CD，点E在AB上，求证相关结论。",
            "geometry_facts": {
                "points": ["A", "B", "C", "D", "E"],
                "segments": ["AB", "BC", "CD", "DA"],
                "relations": [
                    {"type": "point_on_segment", "point": "E", "segment": "AB"}
                ],
                "derived_relations": [
                    {
                        "type": "equal_length",
                        "segments": ["AB", "BC"],
                        "confidence": 0.99,
                    }
                ],
            },
        }
        stabilized = self.agent._stabilize_problem_bundle(bundle, image_path=__file__)
        geometry_spec, compile_error = self.agent._compile_geometry_spec_with_diagnostics(
            stabilized.get("geometry_facts"),
            problem_text=stabilized.get("problem_text", ""),
            geometry_ir=stabilized.get("geometry_ir"),
        )

        self.assertIsNone(compile_error)
        relation_types = {
            str(item.get("type", "")).lower()
            for item in geometry_spec.get("constraints", [])
        }
        self.assertIn("point_on_segment", relation_types)
        self.assertIn("parallel", relation_types)
        self.assertNotIn("equal_length", relation_types)

    def test_compile_geometry_spec_excludes_text_proof_goals(
        self,
    ) -> None:
        bundle = {
            "problem_text": (
                "已知，FC是正方形ABCD和正方形AEFG上的点F、C的连线，"
                "点H是FC的中点，连接EH、DH。求证：EH=DH且EH⊥DH。"
            ),
            "geometry_facts": {
                "points": ["A", "B", "C", "D", "E", "F", "G", "H"],
                "segments": ["FC", "EH", "DH"],
                "relations": [],
                "measurements": [],
            },
        }
        stabilized = self.agent._stabilize_problem_bundle(bundle, image_path=__file__)
        geometry_facts = stabilized.get("geometry_facts") or {}
        self.assertTrue(
            any(
                str(item.get("status", "")).lower() == "goal"
                for item in geometry_facts.get("derived_relations", [])
            )
        )

        geometry_spec, compile_error = self.agent._compile_geometry_spec_with_diagnostics(
            geometry_facts,
            problem_text=stabilized.get("problem_text", ""),
            geometry_ir=stabilized.get("geometry_ir"),
        )

        self.assertIsNone(compile_error)
        hard_relation_types = {
            str(item.get("type", "")).lower()
            for item in geometry_spec.get("constraints", [])
        }
        goal_constraints = [
            item
            for item in geometry_spec.get("constraints", [])
            if set(item.get("entities", [])) == {"seg_EH", "seg_DH"}
        ]
        self.assertIn("midpoint", hard_relation_types)
        self.assertFalse(goal_constraints)

    def test_square_text_adds_generic_hard_constraints_without_proof_goals(
        self,
    ) -> None:
        bundle = {
            "problem_text": (
                "已知，FC是正方形ABCD和正方形AEFG上的点F、C的连线，"
                "点H是FC的中点，连接EH、DH。求证：EH=DH且EH⊥DH。"
            ),
            "geometry_facts": {
                "points": ["A", "B", "C", "D", "E", "F", "G", "H"],
                "segments": ["FC", "EH", "DH"],
                "relations": [],
                "measurements": [],
            },
        }

        stabilized = self.agent._stabilize_problem_bundle(bundle, image_path=__file__)
        geometry_facts = stabilized.get("geometry_facts") or {}
        geometry_spec, compile_error = self.agent._compile_geometry_spec_with_diagnostics(
            geometry_facts,
            problem_text=stabilized.get("problem_text", ""),
            geometry_ir=stabilized.get("geometry_ir"),
        )

        self.assertIsNone(compile_error)
        self.assertIn("ABCD", geometry_facts.get("polygons", []))
        self.assertIn("AEFG", geometry_facts.get("polygons", []))
        constraints = geometry_spec.get("constraints", [])
        square_constraints = [
            item
            for item in constraints
            if set(item.get("entities", []))
            & {
                "seg_AB",
                "seg_BC",
                "seg_CD",
                "seg_DA",
                "seg_AE",
                "seg_EF",
                "seg_FG",
                "seg_GA",
            }
        ]
        relation_types = {str(item.get("type", "")).lower() for item in constraints}
        goal_entities = {
            tuple(item.get("entities", []))
            for item in constraints
            if set(item.get("entities", [])) == {"seg_EH", "seg_DH"}
        }

        self.assertGreaterEqual(len(square_constraints), 10)
        self.assertIn("parallel", relation_types)
        self.assertIn("perpendicular", relation_types)
        self.assertIn("equal_length", relation_types)
        self.assertFalse(goal_entities)

    def test_text_shape_prunes_conflicting_same_point_polygon_topology(
        self,
    ) -> None:
        bundle = {
            "problem_text": (
                "已知，四边形WXYZ中，点P在四边形内部，连接PX、PY。"
                "求证相关结论。"
            ),
            "geometry_facts": {
                "points": ["W", "X", "Y", "Z", "P"],
                "segments": [
                    "WX",
                    "XY",
                    "YZ",
                    "ZW",
                    "PX",
                    "PY",
                    "XZ",
                    "YW",
                ],
                "polygons": ["WXYZ", "WXZY"],
                "relations": [
                    {"type": "parallel", "segments": ["XZ", "YW"]},
                    {"type": "intersect", "segments": ["PX", "PY"]},
                ],
                "measurements": [],
            },
        }

        stabilized = self.agent._stabilize_problem_bundle(bundle, image_path=__file__)
        geometry_facts = stabilized.get("geometry_facts") or {}
        relations = geometry_facts.get("relations") or []
        relation_segments = {
            tuple(item.get("segments", []))
            for item in relations
            if isinstance(item, dict) and item.get("segments")
        }

        self.assertEqual(["WXYZ"], geometry_facts.get("polygons", []))
        self.assertNotIn("XZ", geometry_facts.get("segments", []))
        self.assertNotIn("YW", geometry_facts.get("segments", []))
        self.assertIn("XY", geometry_facts.get("segments", []))
        self.assertIn("PY", geometry_facts.get("segments", []))
        self.assertNotIn(("XZ", "YW"), relation_segments)

    def test_valid_hard_geometry_disables_soft_sketch_priority(self) -> None:
        self.assertFalse(
            self.agent._allow_soft_sketch_priority(
                normalized_spec={
                    "constraints": [
                        {"type": "equal_length", "entities": ["seg_WX", "seg_XY"]},
                        {"type": "perpendicular", "entities": ["seg_WX", "seg_XY"]},
                    ],
                    "measurements": [],
                },
                geometry_facts={},
                coordinate_scene_validation={"is_valid": True},
            )
        )
        self.assertTrue(
            self.agent._allow_soft_sketch_priority(
                normalized_spec={"constraints": [], "measurements": []},
                geometry_facts={},
                coordinate_scene_validation={"is_valid": True},
            )
        )

    def test_sanitize_fold_conflicting_midpoint_is_dropped_without_explicit_midpoint(
        self,
    ) -> None:
        facts = {
            "points": ["A", "B", "D", "E", "B′"],
            "segments": ["AB", "AE", "EB", "DE"],
            "angles": [{"vertex": "E", "sides": ["AE", "EB"], "name": "∠AEB"}],
            "relations": [{"type": "midpoint", "point": "E", "segment": "AB"}],
        }

        sanitized = self.agent._sanitize_geometry_facts(
            facts,
            problem_text="在图形中，将△ABD沿DE折叠后得到点B′，且∠AEB为锐角",
        )

        self.assertFalse(
            any(
                str(item.get("type", "")).lower() == "midpoint"
                for item in sanitized.get("relations", [])
            )
        )

    def test_sanitize_fold_explicit_midpoint_is_preserved(self) -> None:
        facts = {
            "points": ["A", "B", "D", "E", "B′"],
            "segments": ["AB", "AE", "EB", "DE"],
            "angles": [{"vertex": "E", "sides": ["AE", "EB"], "name": "∠AEB"}],
            "relations": [{"type": "midpoint", "point": "E", "segment": "AB"}],
        }

        sanitized = self.agent._sanitize_geometry_facts(
            facts,
            problem_text="在图形中，E是AB的中点，将△ABD沿DE折叠后得到点B′",
        )

        self.assertTrue(
            any(
                str(item.get("type", "")).lower() == "midpoint"
                for item in sanitized.get("relations", [])
            )
        )

    def test_upgrade_problem_text_prefers_higher_quality_fallback(self) -> None:
        original = "题1 如图，求线段长度（ ）"
        fallback = "题1 如图，求线段长度（ ）\nA. 2\nB. 3\nC. 4\nD. 5"
        self.agent._extract_problem_text_fallback = lambda _image_path: fallback

        upgraded = self.agent._upgrade_problem_text_if_needed(
            original, image_path=__file__
        )

        self.assertEqual(upgraded, fallback)

    def test_upgrade_problem_text_skips_retry_for_short_complete_sentence(self) -> None:
        original = "题1 已知AB=3，求BC。"
        called = {"value": False}

        def _fallback(_image_path):
            called["value"] = True
            return "unused"

        self.agent._extract_problem_text_fallback = _fallback
        upgraded = self.agent._upgrade_problem_text_if_needed(
            original, image_path=__file__
        )

        self.assertEqual(upgraded, original)
        self.assertFalse(called["value"])

    def test_analyze_bundle_survives_ocr_fallback_exception(self) -> None:
        self.agent._encode_image = lambda _image_path: "ZmFrZQ=="
        self.agent._invoke_model = lambda _messages, model_role=None: json.dumps(
            {
                "problem_text": "在三角形ABC中，AB=3",
                "geometry_facts": {
                    "points": ["A", "B", "C"],
                    "segments": ["AB", "BC", "CA"],
                    "relations": [],
                    "measurements": [{"type": "length", "segment": "AB", "value": 3}],
                },
            },
            ensure_ascii=False,
        )

        def _raise_ocr(_image_path):
            raise RuntimeError("ocr down")

        self.agent._extract_problem_text_fallback = _raise_ocr

        bundle = self.agent._analyze_problem_bundle(__file__)

        self.assertEqual(bundle.get("problem_text_source"), "model")
        self.assertEqual(
            str(bundle.get("problem_text", "")).strip(), "在三角形ABC中，AB=3"
        )
        self.assertIsInstance(bundle.get("geometry_facts"), dict)


if __name__ == "__main__":
    unittest.main()
