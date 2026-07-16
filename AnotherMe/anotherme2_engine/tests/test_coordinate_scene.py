import unittest

from agents.perception.coordinate_scene import CoordinateSceneCompiler, CoordinateSceneError
from agents.planning.canvas_scene import CanvasScene
from agents.execution.codegen import TemplateCodeGenerator
from agents.perception.geometry_fact_compiler import GeometryFactCompiler


class CoordinateSceneCompilerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.compiler = CoordinateSceneCompiler()
        self.fact_compiler = GeometryFactCompiler()

    def test_pixel_anchor_fallback_solves_midpoint_without_template(self) -> None:
        spec = {
            "mode": "2d",
            "templates": ["unsupported_visual_layout"],
            "points": [
                {"id": "F", "pixel_coord": {"x": 100, "y": 200}, "pixel_coord_space": "source"},
                {"id": "C", "pixel_coord": {"x": 500, "y": 200}, "pixel_coord_space": "source"},
                {"id": "H", "pixel_coord": {"x": 330, "y": 230}, "pixel_coord_space": "source"},
            ],
            "primitives": [
                {"id": "seg_FC", "type": "segment", "points": ["F", "C"]},
            ],
            "constraints": [
                {"type": "point_on_segment", "entities": ["H", "seg_FC"]},
                {"type": "midpoint", "entities": ["H", "seg_FC"]},
            ],
            "display": {},
            "measurements": [],
        }

        scene = self.compiler.solve_coordinate_scene(spec)
        report = self.compiler.validate_coordinate_scene(scene, spec)
        point_lookup = {item["id"]: item["coord"] for item in report["resolved_scene"]["points"]}
        expected_h = [
            (point_lookup["F"][0] + point_lookup["C"][0]) / 2.0,
            (point_lookup["F"][1] + point_lookup["C"][1]) / 2.0,
        ]

        self.assertTrue(report["is_valid"], report)
        self.assertEqual(point_lookup["H"], expected_h)
        self.assertIn("using pixel-anchor fallback layout", " ; ".join(scene["_solver_trace"]))

    def test_rhombus_solver_exports_coordinate_model_trace(self) -> None:
        spec = self.compiler.normalize_geometry_spec(
            {
                "templates": ["rhombus"],
                "points": ["A", "B", "C", "D"],
                "primitives": [
                    {"id": "poly_ABCD", "type": "polygon", "points": ["A", "B", "C", "D"]},
                    {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                    {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
                    {"id": "seg_CD", "type": "segment", "points": ["C", "D"]},
                    {"id": "seg_DA", "type": "segment", "points": ["D", "A"]},
                ],
                "measurements": [
                    {"type": "length", "entities": ["A", "D"], "value": 5},
                    {"type": "angle", "entities": ["A", "B", "C"], "value": "tan B=2"},
                ],
            }
        )

        scene = self.compiler.solve_coordinate_scene(spec)
        trace_items = [
            item["text"]
            for item in scene["coordinate_model_trace"]["items"]
            if isinstance(item, dict)
        ]

        self.assertEqual("template_solver", scene["coordinate_model_trace"]["source"])
        self.assertIn("取 B 为原点，BC 为 x 轴", trace_items)
        self.assertIn("AD=5", trace_items)
        self.assertIn("tan B=2", trace_items)
        self.assertIn("B=(0,0)", trace_items)
        self.assertIn("C=(5,0)", trace_items)

    def test_normalize_geometry_spec_does_not_invent_containment_for_multi_triangle_construction(
        self,
    ) -> None:
        spec = {
            "points": [
                {"id": "A", "pixel_coord": {"x": 1100, "y": 280}},
                {"id": "B", "pixel_coord": {"x": 780, "y": 780}},
                {"id": "C", "pixel_coord": {"x": 1420, "y": 780}},
                {"id": "P", "pixel_coord": {"x": 1050, "y": 520}},
                {"id": "Q", "pixel_coord": {"x": 1180, "y": 760}},
            ],
            "primitives": [
                {"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]},
                {"id": "poly_ABP", "type": "polygon", "points": ["A", "B", "P"]},
                {"id": "poly_PBQ", "type": "polygon", "points": ["P", "B", "Q"]},
                {"id": "poly_PQC", "type": "polygon", "points": ["P", "Q", "C"]},
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
                {"id": "seg_CA", "type": "segment", "points": ["C", "A"]},
                {"id": "seg_BP", "type": "segment", "points": ["B", "P"]},
                {"id": "seg_PA", "type": "segment", "points": ["P", "A"]},
                {"id": "seg_BQ", "type": "segment", "points": ["B", "Q"]},
                {"id": "seg_QC", "type": "segment", "points": ["Q", "C"]},
                {"id": "seg_CP", "type": "segment", "points": ["C", "P"]},
                {"id": "seg_PQ", "type": "segment", "points": ["P", "Q"]},
            ],
            "constraints": [],
            "measurements": [],
        }

        normalized = self.compiler.normalize_geometry_spec(spec)
        primitive_ids = {
            item.get("id")
            for item in normalized.get("primitives", [])
            if isinstance(item, dict)
        }
        containment_constraints = [
            item
            for item in normalized.get("constraints", [])
            if isinstance(item, dict)
            and str(item.get("type", "")).strip().lower() == "point_in_polygon"
        ]

        self.assertNotIn("poly_ACP", primitive_ids)
        self.assertEqual([], containment_constraints)

    def test_pixel_anchor_fallback_projects_point_onto_segment(self) -> None:
        spec = {
            "mode": "2d",
            "templates": ["unsupported_visual_layout"],
            "points": [
                {"id": "A", "pixel_coord": {"x": 100, "y": 100}, "pixel_coord_space": "source"},
                {"id": "B", "pixel_coord": {"x": 500, "y": 100}, "pixel_coord_space": "source"},
                {"id": "P", "pixel_coord": {"x": 300, "y": 145}, "pixel_coord_space": "source"},
            ],
            "primitives": [
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
            ],
            "constraints": [
                {"type": "point_on_segment", "entities": ["P", "seg_AB"]},
            ],
            "display": {},
            "measurements": [],
        }

        scene = self.compiler.solve_coordinate_scene(spec)
        report = self.compiler.validate_coordinate_scene(scene, spec)
        point_lookup = {item["id"]: item["coord"] for item in report["resolved_scene"]["points"]}

        self.assertTrue(report["is_valid"], report)
        self.assertAlmostEqual(point_lookup["A"][1], point_lookup["P"][1], places=6)
        self.assertIn("projected point_on_segment P", " ; ".join(scene["_solver_trace"]))

    def test_pixel_anchor_fallback_projects_square_constraints_before_midpoint(
        self,
    ) -> None:
        def square_relations(edges):
            return [
                {"type": "parallel", "entities": [edges[0], edges[2]]},
                {"type": "parallel", "entities": [edges[1], edges[3]]},
                {"type": "perpendicular", "entities": [edges[0], edges[1]]},
                {"type": "perpendicular", "entities": [edges[1], edges[2]]},
                {"type": "perpendicular", "entities": [edges[2], edges[3]]},
                {"type": "perpendicular", "entities": [edges[3], edges[0]]},
                {"type": "equal_length", "entities": [edges[0], edges[1]]},
                {"type": "equal_length", "entities": [edges[1], edges[2]]},
                {"type": "equal_length", "entities": [edges[2], edges[3]]},
            ]

        spec = {
            "mode": "2d",
            "templates": ["unsupported_visual_layout"],
            "points": [
                {"id": "A", "pixel_coord": {"x": 300, "y": 200}},
                {"id": "B", "pixel_coord": {"x": 500, "y": 190}},
                {"id": "C", "pixel_coord": {"x": 510, "y": 390}},
                {"id": "D", "pixel_coord": {"x": 310, "y": 410}},
                {"id": "E", "pixel_coord": {"x": 180, "y": 80}},
                {"id": "F", "pixel_coord": {"x": 60, "y": 210}},
                {"id": "G", "pixel_coord": {"x": 190, "y": 330}},
                {"id": "H", "pixel_coord": {"x": 280, "y": 300}},
            ],
            "primitives": [
                {
                    "id": "poly_ABCD",
                    "type": "polygon",
                    "points": ["A", "B", "C", "D"],
                },
                {
                    "id": "poly_AEFG",
                    "type": "polygon",
                    "points": ["A", "E", "F", "G"],
                },
                {"id": "seg_FC", "type": "segment", "points": ["F", "C"]},
            ],
            "constraints": [
                *square_relations(["seg_AB", "seg_BC", "seg_CD", "seg_DA"]),
                *square_relations(["seg_AE", "seg_EF", "seg_FG", "seg_GA"]),
                {"type": "point_on_segment", "entities": ["H", "seg_FC"]},
                {"type": "midpoint", "entities": ["H", "seg_FC"]},
            ],
            "display": {},
            "measurements": [],
        }

        scene = self.compiler.solve_coordinate_scene(spec)
        report = self.compiler.validate_coordinate_scene(scene, spec)
        point_lookup = {
            item["id"]: item["coord"] for item in report["resolved_scene"]["points"]
        }
        expected_h = [
            (point_lookup["F"][0] + point_lookup["C"][0]) / 2.0,
            (point_lookup["F"][1] + point_lookup["C"][1]) / 2.0,
        ]

        self.assertTrue(report["is_valid"], report)
        self.assertAlmostEqual(point_lookup["H"][0], expected_h[0], places=5)
        self.assertAlmostEqual(point_lookup["H"][1], expected_h[1], places=5)
        self.assertIn(
            "projected square polygon poly_ABCD",
            " ; ".join(scene["_solver_trace"]),
        )
        self.assertIn(
            "projected square polygon poly_AEFG",
            " ; ".join(scene["_solver_trace"]),
        )

    def test_validate_coordinate_scene_resolves_reflected_point(self) -> None:
        coordinate_scene = {
            "mode": "2d",
            "points": [
                {"id": "C", "coord": [0, 0]},
                {"id": "B", "coord": [0, 6]},
                {"id": "A", "coord": [8, 0]},
                {"id": "D", "coord": [3, 0]},
                {"id": "C1", "derived": {"type": "reflect_point", "source": "C", "axis": ["B", "D"]}},
            ],
            "primitives": [
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
                {"id": "seg_AC", "type": "segment", "points": ["A", "C"]},
                {"id": "seg_BD", "type": "segment", "points": ["B", "D"]},
                {"id": "seg_BC1", "type": "segment", "points": ["B", "C1"]},
                {"id": "seg_DC1", "type": "segment", "points": ["D", "C1"]},
                {"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]},
                {"id": "poly_ADC1", "type": "polygon", "points": ["A", "D", "C1"]},
                {"id": "right_C", "type": "right_angle", "points": ["A", "C", "B"]},
            ],
            "constraints": [
                {"type": "point_on_segment", "entities": ["D", "seg_AC"]},
                {"type": "perpendicular", "entities": ["seg_AC", "seg_BC"]},
                {"type": "collinear", "entities": ["A", "D", "C"]},
                {"type": "equal_length", "entities": ["seg_BC", "seg_BC1"]},
            ],
            "display": {},
            "measurements": [
                {"type": "length", "entities": ["B", "C"], "value": 6},
                {"type": "length", "entities": ["A", "C"], "value": 8},
                {"type": "length", "entities": ["C", "D"], "value": 3},
                {"type": "angle", "entities": ["A", "C", "B"], "value": 90},
            ],
        }

        report = self.compiler.validate_coordinate_scene(coordinate_scene)
        self.assertTrue(report["is_valid"])
        point_lookup = {item["id"]: item["coord"] for item in report["resolved_scene"]["points"]}
        self.assertEqual(point_lookup["C1"], [4.8, 2.4])

    def test_compile_fold_axis_point_from_reflection_constraint(self) -> None:
        spec = {
            "mode": "2d",
            "templates": ["fold", "generic_triangle"],
            "points": [
                {"id": "A"},
                {"id": "B"},
                {"id": "C"},
                {"id": "D"},
                {"id": "C1", "derived": {"type": "reflect_point", "source": "C", "axis": ["B", "D"]}},
            ],
            "primitives": [
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
                {"id": "seg_AC", "type": "segment", "points": ["A", "C"]},
                {"id": "seg_BD", "type": "segment", "points": ["B", "D"]},
                {"id": "seg_DC", "type": "segment", "points": ["D", "C"]},
                {"id": "seg_DC1", "type": "segment", "points": ["D", "C1"]},
                {"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]},
                {"id": "poly_ACD", "type": "polygon", "points": ["A", "C", "D"]},
                {"id": "poly_ADC1", "type": "polygon", "points": ["A", "D", "C1"]},
                {"id": "right_C", "type": "right_angle", "points": ["A", "C", "B"]},
            ],
            "constraints": [
                {"type": "point_on_segment", "entities": ["D", "seg_AC"]},
                {"type": "point_on_segment", "entities": ["C1", "seg_AB"]},
                {"type": "perpendicular", "entities": ["seg_AC", "seg_BC"]},
                {"type": "point_in_polygon", "entities": ["B", "poly_ACD"]},
            ],
            "measurements": [
                {"type": "length", "entities": ["A", "C"], "value": 8},
                {"type": "length", "entities": ["B", "C"], "value": 6},
            ],
        }

        scene = self.compiler.compile(geometry_spec=spec)
        point_lookup = {item["id"]: item["coord"] for item in scene["points"]}
        self.assertEqual(point_lookup["C"], [0.0, 0.0])
        self.assertEqual(point_lookup["A"], [8.0, 0.0])
        self.assertEqual(point_lookup["B"], [0.0, 6.0])
        self.assertAlmostEqual(point_lookup["D"][0], 3.0, places=3)
        self.assertAlmostEqual(point_lookup["D"][1], 0.0, places=3)
        self.assertAlmostEqual(point_lookup["C1"][0], 4.8, places=3)
        self.assertAlmostEqual(point_lookup["C1"][1], 2.4, places=3)

    def test_normalize_geometry_spec_infers_right_triangle_even_with_auxiliary_triangle(self) -> None:
        spec = {
            "templates": ["fold", "generic_triangle"],
            "points": [{"id": "A"}, {"id": "B"}, {"id": "C"}, {"id": "D"}],
            "primitives": [
                {"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]},
                {"id": "poly_ACD", "type": "polygon", "points": ["A", "C", "D"]},
                {"id": "right_C", "type": "right_angle", "points": ["A", "C", "B"]},
            ],
            "constraints": [
                {"type": "point_in_polygon", "entities": ["B", "poly_ACD"]},
                {"type": "perpendicular", "entities": ["seg_AC", "seg_BC"]},
            ],
            "measurements": [
                {"type": "length", "entities": ["A", "C"], "value": 8},
                {"type": "length", "entities": ["B", "C"], "value": 6},
            ],
        }

        normalized = self.compiler.normalize_geometry_spec(spec)
        self.assertIn("right_triangle", normalized["templates"])

    def test_template_sorting_prioritizes_specific_triangle_over_generic(self) -> None:
        ordered = self.compiler._sort_templates_for_solving(
            ["fold", "generic_triangle", "right_triangle"]
        )
        self.assertEqual(ordered[:2], ["right_triangle", "generic_triangle"])

    def test_normalize_geometry_spec_canonicalizes_prime_label(self) -> None:
        spec = {
            "templates": ["right_triangle"],
            "points": [{"id": "A"}, {"id": "B"}, {"id": "C"}, {"id": "C'"}],
            "primitives": [{"type": "segment", "points": ["A", "C'"]}],
            "constraints": [],
            "measurements": [],
        }
        normalized = self.compiler.normalize_geometry_spec(spec)
        point_ids = [item["id"] for item in normalized["points"]]
        self.assertIn("C1", point_ids)
        self.assertEqual(normalized["display"]["points"]["C1"]["label"], "C'")

    def test_solve_right_triangle_geometry_spec(self) -> None:
        spec = {
            "templates": ["right_triangle"],
            "roles": {"right_vertex": "C", "horizontal_point": "A", "vertical_point": "B"},
            "points": [{"id": "A"}, {"id": "B"}, {"id": "C"}],
            "primitives": [{"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]}],
            "constraints": [{"type": "perpendicular", "entities": ["seg_AC", "seg_BC"]}],
            "measurements": [
                {"type": "length", "entities": ["A", "C"], "value": 8},
                {"type": "length", "entities": ["B", "C"], "value": 6},
            ],
        }
        scene = self.compiler.compile(geometry_spec=spec)
        point_lookup = {item["id"]: item["coord"] for item in scene["points"]}
        self.assertEqual(point_lookup["C"], [0.0, 0.0])
        self.assertEqual(point_lookup["A"], [8.0, 0.0])
        self.assertEqual(point_lookup["B"], [0.0, 6.0])

    def test_solve_rectangle_geometry_spec(self) -> None:
        spec = {
            "templates": ["rectangle"],
            "points": [{"id": "A"}, {"id": "B"}, {"id": "C"}, {"id": "D"}],
            "primitives": [{"id": "poly_ABCD", "type": "polygon", "points": ["A", "B", "C", "D"]}],
            "constraints": [
                {"type": "parallel", "entities": ["seg_AB", "seg_CD"]},
                {"type": "parallel", "entities": ["seg_BC", "seg_AD"]},
                {"type": "perpendicular", "entities": ["seg_AB", "seg_BC"]},
            ],
            "measurements": [
                {"type": "length", "entities": ["A", "B"], "value": 10},
                {"type": "length", "entities": ["B", "C"], "value": 4},
            ],
        }
        scene = self.compiler.compile(geometry_spec=spec)
        point_lookup = {item["id"]: item["coord"] for item in scene["points"]}
        self.assertEqual(point_lookup["A"], [0.0, 0.0])
        self.assertEqual(point_lookup["B"], [10.0, 0.0])
        self.assertEqual(point_lookup["C"], [10.0, 4.0])
        self.assertEqual(point_lookup["D"], [0.0, 4.0])

    def test_solve_circle_geometry_spec(self) -> None:
        spec = {
            "templates": ["circle_basic"],
            "points": [{"id": "O"}, {"id": "A"}, {"id": "B"}],
            "primitives": [{"id": "circle_OA", "type": "circle", "center": "O", "radius_point": "A"}],
            "constraints": [{"type": "point_on_circle", "entities": ["B", "circle_OA"]}],
            "measurements": [{"type": "length", "entities": ["O", "A"], "value": 5}],
        }
        scene = self.compiler.compile(geometry_spec=spec)
        report = self.compiler.validate_coordinate_scene(scene)
        self.assertTrue(report["is_valid"])
        point_lookup = {item["id"]: item["coord"] for item in report["resolved_scene"]["points"]}
        self.assertAlmostEqual(point_lookup["A"][0], 5.0, places=6)
        self.assertAlmostEqual(point_lookup["A"][1], 0.0, places=6)

    def test_compile_layout_ir_returns_native_layout_artifact(self) -> None:
        spec = {
            "templates": ["right_triangle"],
            "roles": {"right_vertex": "C", "horizontal_point": "A", "vertical_point": "B"},
            "points": [{"id": "A"}, {"id": "B"}, {"id": "C"}],
            "primitives": [{"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]}],
            "constraints": [{"type": "perpendicular", "entities": ["seg_AC", "seg_BC"]}],
            "measurements": [
                {"type": "length", "entities": ["A", "C"], "value": 8},
                {"type": "length", "entities": ["B", "C"], "value": 6},
            ],
        }

        layout_ir = self.compiler.compile_layout_ir(geometry_spec=spec)

        self.assertEqual("layout_ir.v1", layout_ir["version"])
        self.assertTrue(layout_ir["coordinate_scene_verified"])
        candidate_keys = [item["scene_key"] for item in layout_ir["candidates"]]
        self.assertEqual(["drawable_scene", "coordinate_scene"], candidate_keys)

    def test_point_on_segment_without_measurement_fails_conservatively(self) -> None:
        spec = {
            "templates": ["right_triangle"],
            "points": [{"id": "A"}, {"id": "B"}, {"id": "C"}, {"id": "D"}],
            "primitives": [
                {"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]},
                {"id": "seg_AC", "type": "segment", "points": ["A", "C"]},
            ],
            "constraints": [{"type": "point_on_segment", "entities": ["D", "seg_AC"]}],
            "measurements": [
                {"type": "length", "entities": ["A", "C"], "value": 8},
                {"type": "length", "entities": ["B", "C"], "value": 6},
            ],
        }
        with self.assertRaises(CoordinateSceneError):
            self.compiler.compile(geometry_spec=spec)

    def test_fold_rhombus_geometry_preserves_prime_points_and_solves_axis_point(self) -> None:
        facts = {
            "points": ["A", "B", "C", "D", "E", "B′", "C′"],
            "segments": ["AB", "BC", "CD", "DA", "DE", "EB", "EB′", "B′C′", "C′D"],
            "polygons": ["ABCD", "AB′C′D"],
            "angles": [{"vertex": "B", "sides": ["AB", "BC"], "name": "∠ABC"}],
            "right_angles": [{"vertex": "E", "sides": ["EB", "EB′"], "label": "∠BEB′"}],
            "relations": [
                {"type": "point_on_segment", "point": "E", "segment": "AB"},
                {"type": "parallel", "segments": ["AB", "CD"]},
                {"type": "parallel", "segments": ["AD", "BC"]},
            ],
            "measurements": [
                {"type": "length", "segment": "AD", "value": 5},
                {"type": "angle", "vertex": "B", "value": "arctan(2)", "description": "tan∠ABC = 2"},
            ],
        }

        geometry_spec = self.fact_compiler.compile(
            facts,
            problem_text="在菱形ABCD中，AD=5，tanB=2，E是AB上一点，将菱形ABCD沿DE折叠，使B、C的对应点分别是B′、C′，当∠BEB′=90°时",
        )
        normalized = self.compiler.normalize_geometry_spec(geometry_spec)
        scene = self.compiler.compile(geometry_spec=normalized)
        report = self.compiler.validate_coordinate_scene(scene)

        self.assertTrue(report["is_valid"], report["failed_checks"])
        point_lookup = {item["id"]: item["coord"] for item in report["resolved_scene"]["points"]}
        self.assertIn("B1", point_lookup)
        self.assertIn("C1", point_lookup)
        self.assertIn("E", point_lookup)
        self.assertTrue(0.0 < point_lookup["E"][0] < point_lookup["A"][0])

    def test_fold_guardrail_does_not_auto_expand_reflected_segments(self) -> None:
        facts = {
            "points": ["A", "B", "C", "D", "B′", "C′"],
            "segments": ["AB", "BC", "CD", "DA", "B′C′", "C′D"],
            "polygons": ["ABCD", "AB′C′D"],
            "relations": [],
            "measurements": [],
        }

        geometry_spec = self.fact_compiler.compile(
            facts,
            problem_text="将菱形ABCD沿AD折叠，使B、C对应到B′、C′",
        )

        segment_pairs = {
            tuple(str(p).strip() for p in primitive.get("points", []))
            for primitive in geometry_spec.get("primitives", [])
            if str(primitive.get("type", "")).strip().lower() == "segment"
        }
        undirected_pairs = {frozenset(pair) for pair in segment_pairs if len(pair) == 2}

        self.assertIn(frozenset(("B'", "C'")), undirected_pairs)
        self.assertNotIn(frozenset(("A", "B'")), undirected_pairs)

    def test_fold_guardrail_filters_polygon_only_prime_edges(self) -> None:
        facts = {
            "points": ["A", "B", "C", "D", "E", "B′", "C′"],
            "segments": ["AD", "AB", "DE", "BC"],
            "polygons": ["ABCD", "AB′C′D", "BEB′"],
            "right_angles": [
                {"vertex": "E", "sides": ["EB", "EB′"], "label": "∠BEB′"}
            ],
            "relations": [
                {"type": "point_on_segment", "point": "E", "segment": "AB"},
                {"type": "equal_length", "segments": ["CB", "C′B′"]},
                {"type": "equal_length", "segments": ["CD", "C′D"]},
            ],
            "measurements": [{"type": "length", "segment": "AD", "value": 5}],
            "templates": ["fold", "rhombus"],
        }

        geometry_spec = self.fact_compiler.compile(
            facts,
            problem_text="在菱形ABCD中，AD=5，E是AB上一点，将菱形ABCD沿DE折叠，使B、C的对应点分别是B′、C′，当∠BEB′=90°时",
        )

        segment_pairs = {
            frozenset(str(p).strip() for p in primitive.get("points", []))
            for primitive in geometry_spec.get("primitives", [])
            if str(primitive.get("type", "")).strip().lower() == "segment"
        }

        self.assertIn(frozenset(("E", "B'")), segment_pairs)
        self.assertIn(frozenset(("B'", "C'")), segment_pairs)
        self.assertIn(frozenset(("C'", "D")), segment_pairs)
        self.assertNotIn(frozenset(("A", "B'")), segment_pairs)
        self.assertNotIn(frozenset(("B", "B'")), segment_pairs)

    def test_fold_guardrail_preserves_explicit_reflected_constraints_and_measurements(self) -> None:
        facts = {
            "points": ["A", "B", "D", "B′"],
            "segments": ["AB", "BB′", "DB′"],
            "relations": [
                {"type": "midpoint", "point": "D", "segment": "BB′"},
            ],
            "measurements": [
                {"type": "length", "segment": "DB′", "value": 3},
            ],
        }

        geometry_spec = self.fact_compiler.compile(
            facts,
            problem_text="将线段BB′沿AB折叠后，点D是BB′中点，且DB′=3",
        )

        self.assertTrue(
            any(
                str(item.get("type", "")).strip().lower() == "midpoint"
                and "D" in [str(entity).strip() for entity in (item.get("entities") or [])]
                for item in geometry_spec.get("constraints", [])
            )
        )
        self.assertTrue(
            any(
                str(item.get("type", "")).strip().lower() == "length"
                and float(item.get("value", 0)) == 3.0
                for item in geometry_spec.get("measurements", [])
            )
        )

    def test_parse_tangent_value_supports_fraction_notation(self) -> None:
        self.assertAlmostEqual(self.compiler._parse_tangent_value("tan(∠ABC)=1/2"), 0.5)
        self.assertAlmostEqual(self.compiler._parse_tangent_value("arctan(3/4)"), 0.75)
        self.assertAlmostEqual(self.compiler._parse_tangent_value("tanB=2"), 2.0)

    def test_export_ggb_filters_unapproved_segment_sources(self) -> None:
        coordinate_scene = {
            "mode": "2d",
            "points": [
                {"id": "A", "coord": [0, 0]},
                {"id": "B", "coord": [4, 0]},
                {"id": "C", "coord": [0, 3]},
            ],
            "primitives": [
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
                {"id": "seg_AC", "type": "segment", "points": ["A", "C"]},
            ],
            "constraints": [],
            "measurements": [],
            "display": {
                "primitives": {
                    "seg_AB": {"source": "given"},
                    "seg_BC": {"source": "approved_auxiliary", "style": "dashed", "role": "construction"},
                    "seg_AC": {"source": "derived"},
                }
            },
        }

        commands = self.compiler.export_ggb_commands(coordinate_scene)
        command_text = "\n".join(commands)
        self.assertIn("seg_AB = Segment(A, B)", command_text)
        self.assertIn("seg_BC = Segment(B, C)", command_text)
        self.assertNotIn("seg_AC = Segment(A, C)", command_text)


class TemplateCodeGeneratorTests(unittest.TestCase):
    def test_codegen_uses_circle_primitive(self) -> None:
        generator = TemplateCodeGenerator(
            {
                "frame_height": 8.0,
                "frame_width": 14.222,
                "pixel_height": 1080,
                "pixel_width": 1920,
                "safe_margin": 0.4,
                "left_panel_x_max": 1.0,
            }
        )
        coordinate_scene = {
            "mode": "2d",
            "points": [
                {"id": "O", "coord": [0, 0]},
                {"id": "A", "coord": [5, 0]},
                {"id": "B", "coord": [0, 5]},
            ],
            "primitives": [
                {"id": "circle_OA", "type": "circle", "center": "O", "radius_point": "A"},
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
            ],
            "constraints": [{"type": "point_on_circle", "entities": ["B", "circle_OA"]}],
            "display": {},
            "measurements": [{"type": "length", "entities": ["O", "A"], "value": 5}],
        }
        project = type("Project", (), {"problem_text": "circle", "script_steps": []})()
        code = generator.generate(project, coordinate_scene, [])
        self.assertIn("Circle(radius=np.linalg.norm", code)
        self.assertIn("lines['seg_AB']", code)

    def test_codegen_raises_when_primitive_references_missing_point(self) -> None:
        generator = TemplateCodeGenerator(
            {
                "frame_height": 8.0,
                "frame_width": 14.222,
                "pixel_height": 1080,
                "pixel_width": 1920,
                "safe_margin": 0.4,
                "left_panel_x_max": 1.0,
            }
        )
        coordinate_scene = {
            "mode": "2d",
            "points": [
                {"id": "A", "coord": [0, 0]},
                {"id": "B", "coord": [4, 0]},
            ],
            "primitives": [
                {"id": "seg_AC", "type": "segment", "points": ["A", "C"]},
            ],
            "constraints": [],
            "display": {},
            "measurements": [],
        }
        project = type("Project", (), {"problem_text": "invalid scene", "script_steps": []})()

        with self.assertRaisesRegex(ValueError, "missing points"):
            generator.generate(project, coordinate_scene, [])

    def test_codegen_ignores_degenerate_point_in_polygon_constraint(self) -> None:
        generator = TemplateCodeGenerator(
            {
                "frame_height": 8.0,
                "frame_width": 14.222,
                "pixel_height": 1080,
                "pixel_width": 1920,
                "safe_margin": 0.4,
                "left_panel_x_max": 1.0,
            }
        )
        coordinate_scene = {
            "mode": "2d",
            "points": [
                {"id": "A", "coord": [8, 0]},
                {"id": "B", "coord": [0, 6]},
                {"id": "C", "coord": [0, 0]},
                {"id": "D", "coord": [3, 0]},
            ],
            "primitives": [
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "seg_AC", "type": "segment", "points": ["A", "C"]},
                {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
                {"id": "poly_ACD", "type": "polygon", "points": ["A", "C", "D"]},
            ],
            "constraints": [
                {"type": "point_in_polygon", "entities": ["B", "poly_ACD"]},
            ],
            "display": {},
            "measurements": [],
        }
        project = type("Project", (), {"problem_text": "degenerate polygon", "script_steps": []})()

        code = generator.generate(project, coordinate_scene, [])
        self.assertIn("class SceneMain_", code)

    def test_codegen_renders_polygons_as_wireframes_by_default(self) -> None:
        generator = TemplateCodeGenerator(
            {
                "frame_height": 8.0,
                "frame_width": 14.222,
                "pixel_height": 1080,
                "pixel_width": 1920,
                "safe_margin": 0.4,
                "left_panel_x_max": 1.0,
            }
        )
        coordinate_scene = {
            "mode": "2d",
            "points": [
                {"id": "A", "coord": [0, 0]},
                {"id": "B", "coord": [4, 0]},
                {"id": "C", "coord": [0, 3]},
            ],
            "primitives": [
                {"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]},
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
            ],
            "constraints": [],
            "display": {},
            "measurements": [],
        }
        project = type("Project", (), {"problem_text": "wireframe polygon", "script_steps": []})()

        code = generator.generate(project, coordinate_scene, [])
        self.assertNotIn("Polygon(", code)
        self.assertIn("VGroup(*[lines[k] for k in ['seg_AB']]", code)

    def test_codegen_emits_fold_axis_and_image_point_transition(self) -> None:
        generator = TemplateCodeGenerator(
            {
                "frame_height": 8.0,
                "frame_width": 14.222,
                "pixel_height": 1080,
                "pixel_width": 1920,
                "safe_margin": 0.4,
                "left_panel_x_max": 1.0,
            }
        )
        initial_scene = {
            "mode": "2d",
            "points": [
                {"id": "A", "coord": [8.0, 0.0]},
                {"id": "B", "coord": [0.0, 6.0]},
                {"id": "C", "coord": [0.0, 0.0]},
                {"id": "D", "coord": [3.0, 0.0]},
                {
                    "id": "C1",
                    "coord": [0.0, 0.0],
                    "derived": {"type": "reflect_point", "source": "C", "axis": ["B", "D"]},
                },
            ],
            "primitives": [
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "seg_BD", "type": "segment", "points": ["B", "D"]},
                {"id": "seg_AD", "type": "segment", "points": ["A", "D"]},
                {"id": "poly_ADC1", "type": "polygon", "points": ["A", "D", "C1"]},
            ],
            "constraints": [],
            "display": {
                "points": {
                    "C1": {"label": "C'"}
                }
            },
            "measurements": [],
        }
        current_scene = {
            **initial_scene,
            "points": [
                {"id": "A", "coord": [8.0, 0.0]},
                {"id": "B", "coord": [0.0, 6.0]},
                {"id": "C", "coord": [0.0, 0.0]},
                {"id": "D", "coord": [3.0, 0.0]},
                {
                    "id": "C1",
                    "coord": [4.8, 2.4],
                    "derived": {"type": "reflect_point", "source": "C", "axis": ["B", "D"]},
                },
            ],
        }
        step_contexts = [
            {
                "step_id": 1,
                "step_scene": {"scene": current_scene},
                "animation_spec": {
                    "step_id": 1,
                    "title": "折叠",
                    "focus_entities": ["BD", "D", "C1", "seg_BD", "seg_AD"],
                    "formula_actions": [],
                    "reset_formula_area": False,
                    "movement_actions": [
                        {"type": "move_point", "point_id": "C1", "reveal": True},
                    ],
                    "emphasis_actions": [],
                    "label_actions": [],
                    "restore_actions": [],
                    "helper_line_actions": [],
                    "semantic_actions": [
                        {"action": "highlight_fold_axis", "axis": "seg_BD"},
                        {"action": "create_image_point", "from": "C", "to": "C1"},
                    ],
                    "timing_budget": {
                        "duration": 3.0,
                        "formula_reset": 0.0,
                        "formula_show": 0.0,
                        "movement": 0.6,
                        "emphasis": 0.0,
                        "transform": 0.0,
                        "label_show": 0.0,
                        "label_hide": 0.0,
                        "restore": 0.0,
                        "helper_draw": 0.0,
                        "helper_hold": 0.0,
                        "helper_fade": 0.0,
                        "wait": 2.4,
                    },
                },
            }
        ]
        project = type("Project", (), {"problem_text": "fold transition", "script_steps": []})()

        code = generator.generate(project, initial_scene, step_contexts)
        self.assertIn("fold_axis_anims.append(lines['seg_BD'].animate.set_color(ORANGE)", code)
        self.assertIn("ghost_C1", code)
        self.assertIn("Text('C\\''", code)

    def test_codegen_does_not_hide_visible_derived_points_by_default(self) -> None:
        generator = TemplateCodeGenerator(
            {
                "frame_height": 8.0,
                "frame_width": 14.222,
                "pixel_height": 1080,
                "pixel_width": 1920,
                "safe_margin": 0.4,
                "left_panel_x_max": 1.0,
            }
        )
        scene = {
            "mode": "2d",
            "points": [
                {"id": "B", "coord": [0, 0]},
                {"id": "D", "coord": [1, 1]},
                {"id": "E", "coord": [2, 0]},
                {
                    "id": "B1",
                    "coord": [1, 2],
                    "derived": {
                        "type": "reflect_point",
                        "source": "B",
                        "axis": ["D", "E"],
                    },
                },
            ],
            "primitives": [
                {"id": "seg_DE", "type": "segment", "points": ["D", "E"]},
                {"id": "seg_EB1", "type": "segment", "points": ["E", "B1"]},
            ],
            "constraints": [],
            "display": {"points": {"B1": {"label": "B'"}}},
            "measurements": [],
        }
        project = type(
            "Project", (), {"problem_text": "visible folded point", "script_steps": []}
        )()

        code = generator.generate(project, scene, [])

        self.assertIn("hidden_derived_points = []", code)
        self.assertNotIn(
            "points['B1'] = Dot(point=np.array([1.000, 2.000, 0]), radius=0.05, color=BLACK).set_opacity(0)",
            code,
        )


class CanvasSceneLayoutTests(unittest.TestCase):
    def test_formula_slots_replace_old_content_and_enforce_cap(self) -> None:
        scene = CanvasScene(max_formula_slots=3)

        first = scene.reserve_step_formula_blocks(
            step_id=1,
            formula_items=["AB=4", "BC=6", "AC=10", "overflow"],
        )
        self.assertEqual(len(first), 3)
        self.assertEqual([item.id for item in first], ["formula_slot_1", "formula_slot_2", "formula_slot_3"])

        second = scene.reserve_step_formula_blocks(
            step_id=2,
            formula_items=["S=1/2ab"],
            reset_formula_area=True,
        )
        self.assertEqual(len(second), 1)
        self.assertEqual(second[0].id, "formula_slot_1")

        formula_snapshot = scene.get_formula_snapshot()
        self.assertEqual(len(formula_snapshot), 1)
        self.assertEqual(formula_snapshot[0]["content"], "S=1/2ab")


if __name__ == "__main__":
    unittest.main()
