"""Tests for ProblemTypePrePlanner."""

import unittest

from agents.planning.problem_type_pre_planner import ProblemTypePrePlanner


def _fold_metadata():
    """Metadata with a derived reflection point, simulating a fold problem."""
    return {
        "drawable_scene": {
            "points": [
                {"id": "A", "coord": [0.0, 2.0]},
                {"id": "B", "coord": [2.0, 0.0]},
                {"id": "C", "coord": [-2.0, 0.0]},
                {"id": "D", "coord": [-3.0, 2.0]},
                {"id": "E", "coord": [3.0, 2.0]},
                {
                    "id": "B1",
                    "coord": [2.0, 0.0],
                    "derived": {"type": "reflect_point", "source": "B", "axis": ["D", "E"]},
                },
            ],
            "primitives": [
                {"id": "seg_DE", "type": "segment", "points": ["D", "E"]},
                {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
                {"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]},
            ],
        },
        "coordinate_scene": {
            "points": [
                {"id": "A", "coord": [0.0, 2.0]},
                {"id": "B", "coord": [2.0, 0.0]},
                {"id": "C", "coord": [-2.0, 0.0]},
                {"id": "D", "coord": [-3.0, 2.0]},
                {"id": "E", "coord": [3.0, 2.0]},
                {
                    "id": "B1",
                    "coord": [2.0, 0.0],
                    "derived": {"type": "reflect_point", "source": "B", "axis": ["D", "E"]},
                },
            ],
            "primitives": [
                {"id": "seg_DE", "type": "segment", "points": ["D", "E"]},
                {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
            ],
        },
        "geometry_spec": {
            "templates": ["fold"],
            "constraints": [],
        },
    }


def _rotation_metadata():
    return {
        "drawable_scene": {
            "points": [
                {"id": "O", "coord": [0.0, 0.0]},
                {"id": "A", "coord": [2.0, 0.0]},
                {"id": "B", "coord": [0.0, 2.0]},
            ],
            "primitives": [
                {"id": "seg_OA", "type": "segment", "points": ["O", "A"]},
                {"id": "seg_OB", "type": "segment", "points": ["O", "B"]},
            ],
        },
    }


def _static_metadata():
    return {
        "drawable_scene": {
            "points": [
                {"id": "A", "coord": [0.0, 0.0]},
                {"id": "B", "coord": [3.0, 0.0]},
                {"id": "C", "coord": [1.5, 2.5]},
            ],
            "primitives": [
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]},
            ],
        },
    }


class ProblemTypePrePlannerTests(unittest.TestCase):

    def setUp(self):
        self.planner = ProblemTypePrePlanner()

    def _run(self, problem_text, metadata):
        state = {
            "project": type("Project", (), {
                "problem_text": problem_text,
                "status": "",
            })(),
            "metadata": dict(metadata),
            "messages": [],
            "current_step": "start",
        }
        result = self.planner.process(state)
        return result

    def test_fold_problem_classification(self):
        result = self._run("沿 DE 折叠三角形 ABC，求像点到 BC 的距离", _fold_metadata())
        constraints = result["metadata"]["problem_constraints"]
        self.assertEqual(constraints["problem_type"], "fold_transform")
        self.assertEqual(constraints["problem_pattern"], "fold_transform")
        self.assertIn("fold", constraints["sub_pattern"])

    def test_fold_axis_detected(self):
        result = self._run("沿 DE 折叠三角形 ABC，求像点到 BC 的距离", _fold_metadata())
        constraints = result["metadata"]["problem_constraints"]
        self.assertTrue(constraints["fold_axis"])

    def test_fold_parts_computed(self):
        result = self._run("沿 DE 折叠三角形 ABC，求像点到 BC 的距离", _fold_metadata())
        constraints = result["metadata"]["problem_constraints"]
        self.assertTrue(constraints["image_pairs"])
        self.assertIsInstance(constraints["moving_part"], list)
        self.assertIsInstance(constraints["fixed_part"], list)
        self.assertTrue(len(constraints["moving_part"]) > 0)

    def test_rotation_problem(self):
        result = self._run("将三角形 OAB 绕点 O 旋转 90 度", _rotation_metadata())
        constraints = result["metadata"]["problem_constraints"]
        self.assertEqual(constraints["problem_type"], "rotation_transform")

    def test_static_problem(self):
        result = self._run("求三角形 ABC 的面积", _static_metadata())
        constraints = result["metadata"]["problem_constraints"]
        self.assertEqual(constraints["problem_type"], "geometry_static")
        self.assertEqual(constraints["fold_axis"], "")
        self.assertEqual(constraints["image_pairs"], [])

    def test_writes_to_metadata(self):
        result = self._run("沿 DE 折叠三角形 ABC", _fold_metadata())
        constraints = result["metadata"]["problem_constraints"]
        self.assertEqual(constraints["version"], "v1")
        self.assertIn("problem_type", constraints)
        self.assertIn("confidence", constraints)
        self.assertIn("recommended_geometry_actions", constraints)

    def test_handles_empty_metadata(self):
        result = self._run("求三角形面积", {})
        constraints = result["metadata"]["problem_constraints"]
        self.assertEqual(constraints["version"], "v1")
        self.assertIn(constraints["problem_type"], [
            "geometry_static", "fold_transform", "rotation_transform",
            "translation_transform",
        ])

    def test_preserves_existing_metadata(self):
        state = {
            "project": type("Project", (), {
                "problem_text": "沿 DE 折叠",
                "status": "",
            })(),
            "metadata": {
                "adaptive_plan": {"mode": "remedial"},
                "learner_profile": {"grade": "初二"},
            },
            "messages": [],
            "current_step": "start",
        }
        result = self.planner.process(state)
        self.assertEqual(result["metadata"]["adaptive_plan"]["mode"], "remedial")
        self.assertEqual(result["metadata"]["learner_profile"]["grade"], "初二")
        self.assertIn("problem_constraints", result["metadata"])

    def test_sets_current_step(self):
        result = self._run("求面积", _static_metadata())
        self.assertEqual(result["current_step"], "pre_planning_completed")

    def test_appends_message(self):
        result = self._run("沿 DE 折叠", _fold_metadata())
        messages = result["messages"]
        self.assertTrue(any("题型预分析完成" in m.get("content", "") for m in messages))


if __name__ == "__main__":
    unittest.main()
