import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

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

from agents.execution.animation_agent import AnimationAgent
from agents.execution.codegen import TemplateCodeGenerator
from agents.execution.error_classifier import classify_render_error
from agents.execution.formal_video_validator import FormalVideoValidator
from agents.execution.merge_agent import MergeAgent
from agents.foundation.base_agent import BaseAgent
from agents.foundation.state import ScriptStep, VideoProject
from agents.perception.coordinate_scene import CoordinateSceneCompiler
from agents.perception.geometry_fact_compiler import GeometryFactCompiler
from agents.perception.pixel_anchor import scene_point_coordinates
from agents.planning.animation_planner import AnimationPlanner
from agents.planning.canvas_scene import CanvasScene
from agents.planning.script_agent import ScriptAgent
from agents.planning.template_retriever import TemplateRetriever


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


def _coordinate_scene():
    return {
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
            {"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]},
        ],
        "constraints": [],
        "display": {},
        "measurements": [],
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


def _step_contexts():
    formula_layout = {
        "content": "AB = 4",
        "x": 0.72,
        "y": 0.10,
        "width": 0.20,
        "height": 0.10,
    }
    return [
        {
            "step_id": 1,
            "title": "已知条件",
            "step_scene": {
                "allow_geometry_motion": False,
                "scene": _coordinate_scene(),
            },
            "animation_plan": {
                "step_id": 1,
                "title": "已知条件",
                "duration": 2.4,
                "focus_entities": ["A", "seg_AB"],
                "actions": [
                    {"type": "highlight"},
                    {"type": "label"},
                ],
                "time_offset": 0.0,
            },
            "canvas_layout": {
                "reserved_formula_elements": [formula_layout],
            },
            "animation_spec": {
                "step_id": 1,
                "title": "已知条件",
                "fallback_mode": "formal",
                "focus_entities": ["A", "seg_AB"],
                "formula_actions": [
                    {
                        "type": "show_formula",
                        "content": "AB = 4",
                        "layout": formula_layout,
                    }
                ],
                "movement_actions": [
                    {"type": "move_point", "point_id": "B"},
                ],
                "emphasis_actions": [
                    {
                        "type": "highlight",
                        "mode": "highlight",
                        "targets": ["A", "seg_AB"],
                    },
                ],
                "label_actions": [
                    {"type": "show_temp_label", "target": "A"},
                ],
                "restore_actions": [
                    {"type": "restore_style", "targets": ["A", "seg_AB"]},
                ],
                "timing_budget": {
                    "duration": 2.4,
                    "formula_reset": 0.0,
                    "formula_show": 0.4,
                    "movement": 0.5,
                    "emphasis": 0.5,
                    "transform": 0.0,
                    "label_show": 0.3,
                    "label_hide": 0.2,
                    "restore": 0.2,
                    "wait": 0.3,
                },
            },
        }
    ]


def _image_overlay_scene(image_path: str = "D:/tmp/problem.png"):
    scene = _coordinate_scene()
    scene["_visual_geometry_source"] = {
        "mode": "image_overlay",
        "image_path": image_path,
        "crop_size": [360, 260],
        "coordinate_scene_verified": False,
        "layering": {
            "layer_1": "problem_image_base",
            "layer_2": "auxiliary_annotations",
            "layer_3": "formula_derivation",
        },
    }
    return scene


class StubMergeAgent(MergeAgent):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.last_rendered_code = ""

    def _render_manim(
        self, manim_file: str, output_file: str, class_name: str = "MathAnimation"
    ):
        self.last_rendered_code = Path(manim_file).read_text(encoding="utf-8")
        Path(output_file).write_bytes(b"fake-mp4")
        return True, ""


class _StubLLM:
    def __init__(self, response_text: str):
        self.response_text = response_text
        self.last_messages = None

    def invoke(self, messages):
        self.last_messages = messages
        return types.SimpleNamespace(content=self.response_text)


class _ResponseLLM:
    def __init__(self, response):
        self.response = response

    def invoke(self, messages):
        return self.response


class _ConcreteBaseAgent(BaseAgent):
    def process(self, state):
        return state


class _CountingGenerator(TemplateCodeGenerator):
    def __init__(self, canvas_config: dict, code: str):
        super().__init__(canvas_config)
        self.code = code
        self.calls = 0

    def generate(self, project, coordinate_scene_data, step_contexts):
        self.calls += 1
        return self.code


class ManimStabilityTests(unittest.TestCase):
    def test_base_agent_prefers_final_content_over_reasoning_content(self) -> None:
        response = types.SimpleNamespace(
            content="",
            additional_kwargs={"reasoning_content": "不，我再想想。"},
            response_metadata={
                "choices": [
                    {"message": {"content": '{"steps": []}'}}
                ]
            },
        )
        agent = _ConcreteBaseAgent(config={}, llm=_ResponseLLM(response))

        self.assertEqual('{"steps": []}', agent._invoke_llm([]))

    def test_base_agent_does_not_use_reasoning_content_by_default(self) -> None:
        response = types.SimpleNamespace(
            content="",
            additional_kwargs={"reasoning_content": "不，我再想想。"},
            response_metadata={},
        )
        agent = _ConcreteBaseAgent(config={}, llm=_ResponseLLM(response))

        self.assertEqual("", agent._invoke_llm([]))

    def test_script_agent_visible_segments_skips_unit_tokens(self) -> None:
        agent = ScriptAgent(config={}, llm=None)

        segments = agent._normalize_visible_segments(
            value=[],
            narration="已知 AB = 3 cm, BC = 4 cm。",
            visual_cues=[],
            title="长度关系",
        )

        self.assertIn("AB", segments)
        self.assertIn("BC", segments)
        self.assertNotIn("CM", segments)

        explicit_segments = agent._normalize_visible_segments(
            value=["CM", "AB"],
            narration="",
            visual_cues=[],
            title="",
        )
        self.assertIn("CM", explicit_segments)

    def test_script_agent_postprocess_drops_leading_review_steps(self) -> None:
        agent = ScriptAgent(config={}, llm=None)
        steps = [
            ScriptStep(
                id=1,
                title="前置知识复习",
                duration=3.0,
                narration="先回顾菱形和三角函数定义。",
                visual_cues=[],
            ),
            ScriptStep(
                id=2,
                title="读题并整理已知",
                duration=4.0,
                narration="根据题目先标出已知和所求。",
                visual_cues=[],
            ),
        ]

        processed = agent._postprocess_script_steps(steps)
        self.assertEqual(1, len(processed))
        self.assertEqual("读题并整理已知", processed[0].title)
        self.assertEqual(1, processed[0].id)

    def test_script_agent_postprocess_enriches_brief_narration(self) -> None:
        agent = ScriptAgent(config={}, llm=None)
        steps = [
            ScriptStep(
                id=1,
                title="计算关系",
                duration=3.0,
                narration="求出长度。",
                visual_cues=[],
            ),
        ]

        processed = agent._postprocess_script_steps(steps)
        narration = processed[0].narration
        self.assertIn("已知条件", narration)
        self.assertIn("逐步推导", narration)
        self.assertTrue("结论" in narration or "得到" in narration)

    def test_script_agent_builds_prompt_context_from_stable_geometry_ir(self) -> None:
        agent = ScriptAgent(config={}, llm=None)
        metadata = {
            "geometry_ir": {
                "version": "geometry_ir.v1",
                "problem_type": "fold_transform",
                "problem_pattern": "fold_transform",
                "sub_pattern": "fold_then_area",
                "scene_draft": {
                    "points": [{"id": "A"}, {"id": "B"}, {"id": "B1"}],
                    "visible_segments": [{"points": ["A", "B"]}],
                    "fold_correspondences": [{"source": "B", "image": "B1"}],
                },
                "facts": {
                    "visual_observed": {
                        "segments": [{"points": ["A", "B"]}],
                    },
                    "text_explicit": {
                        "relations": [
                            {"type": "parallel", "entities": ["AB", "CD"]},
                        ]
                    },
                },
                "transform": {"fold_axis": "seg_DE"},
            }
        }

        prompt_context = agent._build_geometry_prompt_context(
            metadata,
            problem_text="普通几何题",
        )

        self.assertTrue(prompt_context["has_stable_visual_context"])
        self.assertIn('"visible_segments"', prompt_context["scene_draft_text"])
        self.assertIn('"problem_pattern": "fold_transform"', prompt_context["stable_geometry_text"])
        self.assertIn('"segments"', prompt_context["stable_geometry_text"])
        self.assertEqual("", prompt_context["fallback_geometry_text"])
        self.assertIn("A", prompt_context["known_entities"])
        self.assertIn("AB", prompt_context["known_entities"])

    def test_script_agent_prompt_omits_legacy_scene_blocks_when_stable_geometry_exists(
        self,
    ) -> None:
        response_text = json.dumps(
            {
                "final_answer": "48",
                "answer_verification": {
                    "status": "verified",
                    "method": "代回条件复核",
                    "checks": ["满足题设"],
                },
                "steps": [
                    {
                        "id": 1,
                        "title": "整理条件",
                        "duration": 4.0,
                        "narration": "根据题意先整理已知条件，再逐步推导结论。",
                        "visual_cues": ["标出已知边"],
                        "on_screen_texts": [
                            {"text": "AB = 4", "target_area": "formula_area"}
                        ],
                    }
                ],
                "total_duration": 4.0,
            },
            ensure_ascii=False,
        )
        llm = _StubLLM(response_text)
        agent = ScriptAgent(config={}, llm=llm)
        state = {
            "project": VideoProject(problem_text="普通几何题", problem_image=None),
            "messages": [],
            "metadata": {
                "geometry_ir": {
                    "version": "geometry_ir.v1",
                    "problem_pattern": "fold_transform",
                    "scene_draft": {
                        "points": [{"id": "A"}, {"id": "B"}],
                        "visible_segments": [{"points": ["A", "B"]}],
                    },
                    "facts": {
                        "visual_observed": {
                            "segments": [{"points": ["A", "B"]}],
                        }
                    },
                },
                "scene_graph": {"points": {"Z": {"coord": [9, 9]}}},
                "drawable_scene": {
                    "points": {"Y": {"coord": [8, 8]}},
                    "primitives": [],
                },
            },
        }

        agent.process(state)

        prompt_text = str(llm.last_messages[-1].content)
        self.assertIn("Scene Draft（视觉锚点层，不是最终绘图坐标）", prompt_text)
        self.assertIn("Stable GeometryIR Summary", prompt_text)
        self.assertNotIn("Legacy Semantic Graph", prompt_text)
        self.assertNotIn("Legacy Drawable Scene", prompt_text)
        self.assertNotIn("Fallback Geometry Context", prompt_text)

    def test_animation_agent_template_query_uses_stable_geometry_context(self) -> None:
        agent = AnimationAgent(config={}, llm=None, vision_tool=None)
        metadata = {
            "geometry_ir": {
                "version": "geometry_ir.v1",
                "scene_draft": {
                    "visible_segments": [{"points": ["A", "B"]}],
                    "fold_correspondences": [{"source": "B", "image": "B1"}],
                },
                "facts": {
                    "visual_observed": {
                        "segments": [{"points": ["A", "B"]}],
                        "circles": [{"id": "circle_O", "center": "O"}],
                    }
                },
            }
        }

        query = agent._build_template_retrieval_query(metadata)

        self.assertIn("fold", query["tags"])
        self.assertIn("circle", query["tags"])
        self.assertIn("circle", query["primitives"])
        self.assertIn("segment", query["primitives"])

    def test_codegen_renders_fold_template_segments_and_reference_dashes(self) -> None:
        scene = {
            "mode": "2d",
            "points": [
                {"id": "A", "coord": [0, 1]},
                {"id": "B", "coord": [-1, -1]},
                {"id": "C", "coord": [1, -1]},
                {"id": "D", "coord": [2, 1]},
                {"id": "E", "coord": [-0.5, 0]},
                {"id": "B1", "coord": [-2, 0], "label": "B'"},
                {"id": "C1", "coord": [-1, 2], "label": "C'"},
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
            "display": {
                "primitives": {
                    "seg_AD": {"source": "fold_template", "role": "folded_visible"},
                    "seg_AB": {"show": False, "role": "decomposed_by_fold_template"},
                    "seg_DE": {"source": "fold_template", "role": "folded_visible"},
                    "seg_AE": {"source": "fold_template", "role": "folded_visible"},
                    "seg_EB": {
                        "source": "fold_template",
                        "role": "pre_fold_reference",
                        "style": "dashed",
                    },
                    "seg_BC": {
                        "source": "fold_template",
                        "role": "pre_fold_reference",
                        "style": "dashed",
                    },
                    "seg_CD": {
                        "source": "fold_template",
                        "role": "pre_fold_reference",
                        "style": "dashed",
                    },
                }
            },
        }

        generated_code = TemplateCodeGenerator(_canvas_config()).generate(
            _project(audio_file=""),
            scene,
            [],
        )

        self.assertIn("lines['seg_AD']", generated_code)
        self.assertIn("lines['seg_DE']", generated_code)
        self.assertIn("lines['seg_AE']", generated_code)
        self.assertIn("lines['seg_EB']", generated_code)
        self.assertIn("lines['seg_BC']", generated_code)
        self.assertIn("lines['seg_CD']", generated_code)
        self.assertNotIn("lines['seg_AB'] =", generated_code)
        self.assertIn("DashedLine", generated_code)

    def test_script_agent_duration_policy_compacts_steps_and_narration(self) -> None:
        agent = ScriptAgent(config={}, llm=None)
        policy = {
            "max_steps": 3,
            "max_narration_chars": 28,
            "max_duration_seconds": 30.0,
        }
        steps = [
            ScriptStep(
                id=i,
                title=f"步骤{i}",
                duration=15.0,
                narration="同学们，先来复习三角形的基本定义。然后根据题目条件继续推理。",
                visual_cues=[],
            )
            for i in range(1, 6)
        ]

        processed = agent._apply_duration_policy(steps, policy)

        self.assertEqual([1, 2, 3], [step.id for step in processed])
        self.assertEqual(3, len(processed))
        self.assertLessEqual(sum(step.duration for step in processed), 30.1)
        self.assertLessEqual(max(len(step.narration) for step in processed), 29)
        self.assertNotIn("复习", processed[0].narration)

    def test_script_agent_blocks_public_reasoning_steps_file(self) -> None:
        response_text = json.dumps(
            {
                "final_answer": "48",
                "answer_verification": {
                    "status": "verified",
                    "method": "代回面积关系复核",
                    "checks": ["满足题目条件"],
                },
                "steps": [
                    {
                        "id": 1,
                        "title": "整理条件",
                        "duration": 4.0,
                        "narration": "不，我再想想，先试一下这个关系。",
                        "visual_cues": [],
                        "on_screen_texts": [{"text": "AB = 10", "target_area": "formula_area"}],
                    }
                ],
                "total_duration": 4.0,
            },
            ensure_ascii=False,
        )
        with tempfile.TemporaryDirectory() as tmp:
            agent = ScriptAgent(config={"output_dir": tmp}, llm=_StubLLM(response_text))
            state = {
                "project": VideoProject(problem_text="求面积", problem_image=None),
                "metadata": {},
                "messages": [],
            }

            with self.assertRaises(ValueError):
                agent.process(state)

            intermediate = Path(tmp) / "intermediate"
            self.assertFalse((intermediate / "script_steps.json").exists())
            quality = json.loads((intermediate / "script_steps_quality.json").read_text(encoding="utf-8"))
            self.assertFalse(quality["publishable"])
            self.assertTrue(quality["violations"])

    def test_script_agent_sanitizes_removable_reasoning_sentence(self) -> None:
        response_text = json.dumps(
            {
                "final_answer": "A",
                "answer_verification": {
                    "status": "verified",
                    "method": "代回题目条件复核",
                    "checks": ["满足最终结论"],
                },
                "steps": [
                    {
                        "id": 1,
                        "title": "计算关键长度",
                        "duration": 4.0,
                        "narration": "根据已知先计算关键长度。不对，这句是草稿。最终可得答案选A。",
                        "visual_cues": [],
                        "on_screen_texts": [{"text": "答案选A", "target_area": "formula_area"}],
                    }
                ],
                "total_duration": 4.0,
            },
            ensure_ascii=False,
        )
        with tempfile.TemporaryDirectory() as tmp:
            agent = ScriptAgent(config={"output_dir": tmp}, llm=_StubLLM(response_text))
            state = {
                "project": VideoProject(problem_text="求距离", problem_image=None),
                "metadata": {},
                "messages": [],
            }

            result = agent.process(state)

            intermediate = Path(tmp) / "intermediate"
            steps_payload = json.loads((intermediate / "script_steps.json").read_text(encoding="utf-8"))
            quality = json.loads((intermediate / "script_steps_quality.json").read_text(encoding="utf-8"))
            narration = result["project"].script_steps[0].narration
            self.assertTrue(quality["publishable"])
            self.assertTrue(quality["sanitized"])
            self.assertNotIn("不对", narration)
            self.assertNotIn("草稿", narration)
            self.assertEqual(narration, steps_payload["steps"][0]["narration"])

    def test_codegen_clean_display_text_preserves_si_lu(self) -> None:
        generator = TemplateCodeGenerator(_canvas_config())
        self.assertEqual(
            generator._clean_display_text("思路：根据折叠性质"), "思路：根据折叠性质"
        )

    def test_codegen_normalizes_root_trig_formulas_to_mathtex(self) -> None:
        generator = TemplateCodeGenerator({**_canvas_config(), "prefer_mathtex": True})
        self.assertEqual(
            r"\sin B=2/\sqrt{5}",
            generator._to_mathtex("sinB=2/√5"),
        )

        contexts = _step_contexts()
        formula_layout = {
            "content": "sinB=2/√5",
            "kind": "formula",
            "x": 0.72,
            "y": 0.10,
            "width": 0.20,
            "height": 0.10,
        }
        contexts[0]["canvas_layout"]["reserved_formula_elements"] = [formula_layout]
        contexts[0]["animation_spec"]["formula_actions"] = [
            {"type": "show_formula", "content": "sinB=2/√5", "layout": formula_layout}
        ]

        generated_code = generator.generate(
            _project(audio_file=""),
            _coordinate_scene(),
            contexts,
        )

        self.assertIn(r"\\sin B=2/\\sqrt{5}", generated_code)
        self.assertIn("fit_scale", generated_code)

    def test_canvas_formula_layout_gives_summary_more_room(self) -> None:
        canvas = CanvasScene(max_formula_slots=8)
        elements = canvas.reserve_step_formula_blocks(
            step_id=1,
            formula_items=["思路：先求菱形高", "sinB=2/√5", "DH=2√5"],
            reset_formula_area=True,
        )

        self.assertEqual("text", elements[0].kind)
        self.assertEqual("formula", elements[1].kind)
        self.assertGreater(elements[0].height, elements[1].height)

    def test_animation_planner_prioritizes_spoken_formulas(self) -> None:
        planner = AnimationPlanner()
        step = ScriptStep(
            id=1,
            title="公式讲解",
            duration=2.0,
            narration="由已知可得 AB=BC。",
            visual_cues=["高亮 AB"],
            spoken_formulas=["AB = BC", "AB \\parallel CD"],
            on_screen_texts=[
                {
                    "text": "观察关系",
                    "kind": "description",
                    "target_area": "formula_area",
                }
            ],
            audio_duration=2.0,
        )
        step_scene = {"operations": [], "focus_entities": []}

        plan = planner.plan_step(step, step_scene, time_offset=0.0)
        self.assertTrue(plan["formula_items"][0].startswith("第1步："))
        self.assertIn("AB = BC", plan["formula_items"])
        self.assertIn("AB \\parallel CD", plan["formula_items"])
        self.assertLessEqual(len(plan["formula_items"]), 6)

    def test_animation_planner_adds_explanatory_copy_for_formula_only_step(
        self,
    ) -> None:
        planner = AnimationPlanner()
        step = ScriptStep(
            id=1,
            title="计算 EB",
            duration=2.0,
            narration="结合折叠对应关系计算线段 EB。",
            visual_cues=[],
            spoken_formulas=["EB = 5 - \\sqrt{5}"],
            audio_duration=2.0,
        )
        step_scene = {"operations": [], "focus_entities": []}

        plan = planner.plan_step(step, step_scene, time_offset=0.0)
        self.assertIn("EB = 5 - \\sqrt{5}", plan["formula_items"])
        self.assertTrue(
            any(
                item.startswith("第1步：计算EB")
                or item.startswith("要点：")
                or item.startswith("思路：")
                for item in plan["formula_items"]
            )
        )
        self.assertFalse(any("结合折叠对应关系计算线段 EB" in item for item in plan["formula_items"]))

    def test_animation_planner_trims_long_explanatory_panel_text(self) -> None:
        planner = AnimationPlanner()
        step = ScriptStep(
            id=1,
            title="求菱形高",
            duration=2.0,
            narration="过顶点A作BC的垂线，先把tanB转化成直角三角形中的边长比例。",
            visual_cues=[],
            spoken_formulas=["AH = 2\\sqrt{5}", "BH = \\sqrt{5}"],
            on_screen_texts=[
                {
                    "text": "先作高，把tanB转成边长比例，再用勾股定理求高",
                    "kind": "description",
                    "target_area": "formula_area",
                }
            ],
            audio_duration=2.0,
        )

        plan = planner.plan_step(step, {"operations": [], "focus_entities": []}, time_offset=0.0)

        self.assertLessEqual(len(plan["formula_items"]), 6)
        self.assertTrue(plan["formula_items"][0].startswith("第1步：求菱形高"))
        self.assertIn("先作高", plan["formula_items"][1])
        self.assertLessEqual(len(plan["formula_items"][1]), 40)
        self.assertIn("AH = 2\\sqrt{5}", plan["formula_items"])

    def test_animation_planner_preserves_step_derivation_panel_order(self) -> None:
        planner = AnimationPlanner()
        step = ScriptStep(
            id=3,
            title="求点 E 的位置",
            duration=2.0,
            narration="根据中垂线关系建立坐标，得到 E 点位置。",
            visual_cues=[],
            spoken_formulas=["x_E = 2", "y_E = 3"],
            on_screen_texts=[
                {
                    "text": "第3步：求点 E 的位置",
                    "kind": "title",
                    "target_area": "formula_area",
                },
                {
                    "text": "由中垂线确定横坐标",
                    "kind": "description",
                    "target_area": "formula_area",
                },
                {
                    "text": "x_E = 2",
                    "kind": "formula",
                    "target_area": "formula_area",
                },
                {
                    "text": "y_E = 3",
                    "kind": "formula",
                    "target_area": "formula_area",
                },
                {
                    "text": "E(2, 3)",
                    "kind": "conclusion",
                    "target_area": "formula_area",
                },
            ],
            audio_duration=2.0,
        )

        plan = planner.plan_step(step, {"operations": [], "focus_entities": []}, time_offset=0.0)

        self.assertEqual(
            ["第3步：求点 E 的位置", "由中垂线确定横坐标", "x_E = 2", "y_E = 3", "E(2, 3)"],
            plan["formula_items"],
        )

    def test_animation_planner_filters_empty_formula_panel_placeholders(self) -> None:
        planner = AnimationPlanner()
        step = ScriptStep(
            id=1,
            title="已知条件",
            duration=2.0,
            narration="已知 AB 垂直 BC，且 AB 平行 CD。",
            visual_cues=["标出 AB ⊥ BC 与 AB ∥ CD"],
            spoken_formulas=[],
            on_screen_texts=[
                {"text": "已知", "kind": "description", "target_area": "formula_area"},
                {"text": "AB ⊥ BC", "kind": "formula", "target_area": "formula_area"},
                {"text": "AB ∥ CD", "kind": "formula", "target_area": "formula_area"},
            ],
            audio_duration=2.0,
        )

        plan = planner.plan_step(step, {"operations": [], "focus_entities": []}, time_offset=0.0)

        self.assertNotIn("已知", plan["formula_items"])
        self.assertIn("AB ⊥ BC", plan["formula_items"])
        self.assertIn("AB ∥ CD", plan["formula_items"])

    def test_animation_planner_filters_ambiguous_single_letter_formula(self) -> None:
        planner = AnimationPlanner()
        step = ScriptStep(
            id=2,
            title="三角函数",
            duration=2.0,
            narration="由 tanB=2 推导后续关系。",
            visual_cues=[],
            spoken_formulas=["tan B = 2", "B = 2", "tanB=2"],
            audio_duration=2.0,
        )
        step_scene = {"operations": [], "focus_entities": []}

        plan = planner.plan_step(step, step_scene, time_offset=0.0)
        formulas = plan["formula_items"]
        self.assertIn("tan B = 2", formulas)
        self.assertNotIn("B = 2", formulas)
        self.assertEqual(
            1, sum(1 for item in formulas if item.replace(" ", "").lower() == "tanb=2")
        )

    def test_prepare_animation_context_generates_fold_movement_from_coordinate_scene(
        self,
    ) -> None:
        agent = AnimationAgent(
            config={
                "canvas_config": _canvas_config(),
            },
            llm=None,
        )
        coordinate_scene = {
            "mode": "2d",
            "points": [
                {"id": "A", "coord": [0.0, 0.0]},
                {"id": "B", "coord": [2.0, 0.5]},
                {"id": "D", "coord": [0.0, 2.0]},
                {"id": "E", "coord": [1.0, 1.0]},
                {
                    "id": "B1",
                    "derived": {
                        "type": "reflect_point",
                        "source": "B",
                        "axis": ["D", "E"],
                    },
                },
            ],
            "primitives": [
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "seg_DE", "type": "segment", "points": ["D", "E"]},
            ],
            "constraints": [],
            "display": {},
            "measurements": [],
        }
        steps = [
            ScriptStep(
                id=1,
                title="观察图形",
                duration=2.0,
                narration="先观察已知图形。",
                visual_cues=["高亮 DE"],
                audio_duration=2.0,
            ),
            ScriptStep(
                id=2,
                title="执行折叠",
                duration=2.0,
                narration="沿 DE 折叠得到像点。",
                visual_cues=["折叠"],
                audio_duration=2.0,
            ),
        ]
        teaching_ir = {
            "steps": [
                {
                    "step_id": 1,
                    "focus_targets": ["seg_DE"],
                    "actions": [{"action": "highlight_fold_axis", "axis": "seg_DE"}],
                },
                {
                    "step_id": 2,
                    "focus_targets": ["seg_DE", "B1"],
                    "actions": [
                        {"action": "animate_fold", "axis": "seg_DE", "targets": ["B1"]}
                    ],
                },
            ]
        }

        contexts = agent._prepare_animation_context(
            steps,
            coordinate_scene,
            teaching_ir=teaching_ir,
        )
        agent._attach_animation_specs(
            contexts,
            base_coordinate_scene=coordinate_scene,
            conservative=False,
        )

        movement_actions = contexts[1]["animation_spec"]["movement_actions"]
        moved_points = {item.get("point_id") for item in movement_actions}
        self.assertIn("B1", moved_points)

    def test_prepare_animation_context_merges_teaching_formulas_into_formula_panel(
        self,
    ) -> None:
        agent = AnimationAgent(
            config={
                "canvas_config": _canvas_config(),
            },
            llm=None,
        )
        coordinate_scene = {
            "mode": "2d",
            "points": [
                {"id": "A", "coord": [0.0, 0.0]},
                {"id": "B", "coord": [2.0, 0.0]},
                {"id": "C", "coord": [1.0, 1.5]},
            ],
            "primitives": [
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
                {"id": "seg_CA", "type": "segment", "points": ["C", "A"]},
            ],
            "constraints": [],
            "display": {},
            "measurements": [],
        }
        steps = [
            ScriptStep(
                id=1,
                title="余弦定理",
                duration=2.0,
                narration="利用余弦定理计算边长。",
                visual_cues=["AB", "AC", "BC"],
                audio_duration=2.0,
            ),
        ]
        teaching_ir = {
            "steps": [
                {
                    "step_id": 1,
                    "focus_targets": ["A", "B", "C"],
                    "spoken_formulas": ["BC^2 = AB^2 + AC^2 - 2*AB*AC*cos∠A"],
                    "theorem_hints": [{"theorem": "cosine_theorem"}],
                    "actions": [{"action": "highlight_relation", "targets": ["A", "B", "C"]}],
                }
            ]
        }

        contexts = agent._prepare_animation_context(
            steps,
            coordinate_scene,
            teaching_ir=teaching_ir,
        )

        self.assertIn(
            "BC^2 = AB^2 + AC^2 - 2*AB*AC*cos∠A",
            contexts[0]["animation_plan"]["formula_items"],
        )
        self.assertEqual([], steps[0].spoken_formulas)

    def test_template_retriever_prefers_tangent_component_templates(self) -> None:
        retriever = TemplateRetriever(
            template_dir=Path(__file__).resolve().parents[1]
            / "template"
            / "manim_templates"
        )
        refs = retriever.retrieve(
            {
                "summary": "circle tangent angle",
                "tags": ["circle", "tangent", "angle"],
                "primitives": ["circle", "segment", "angle"],
                "motions": ["highlight"],
            },
            top_k=3,
        )

        self.assertTrue(refs)
        top_ids = {item.id for item in refs}
        self.assertTrue(any("tangent" in item_id for item_id in top_ids))
        self.assertTrue(
            any(
                ("tangent" in item.reason.lower()) or ("angle" in item.reason.lower())
                for item in refs
            )
        )

    def test_template_codegen_emits_expected_actions_and_passes_validation(
        self,
    ) -> None:
        generator = TemplateCodeGenerator(_canvas_config())
        project = _project()
        code = generator.generate(project, _coordinate_scene(), _step_contexts())

        self.assertIn("move_anims.append(points['B'].animate.move_to", code)
        self.assertIn("self.camera.background_color = '#fbfaf7'", code)
        self.assertIn("formula_obj = Text(content, font_size=text_font_size", code)
        self.assertIn("formula_intro_anims.append(Write(formula_obj)", code)
        self.assertIn("LaggedStart(*formula_intro_anims", code)
        self.assertIn(
            "highlight_anims.append(points['A'].animate.set_color(ORANGE))", code
        )
        self.assertNotIn("Polygon(", code)
        self.assertNotIn("line_labels", code)
        self.assertIn(
            "VGroup(*[lines[k] for k in ['seg_AB', 'seg_BC', 'seg_AC']]",
            code,
        )
        self.assertIn("self.play(FadeIn(temp_labels), run_time=0.30)", code)

        validator = FormalVideoValidator(_canvas_config())
        is_valid, error_message, report = validator.validate(
            code,
            expected_steps=[{"step_id": 1, "duration": 2.4}],
        )
        self.assertTrue(is_valid, error_message)
        self.assertTrue(report["is_valid"])

    def test_template_codegen_consumes_soft_sketch_wireframe_scene(self) -> None:
        generator = TemplateCodeGenerator(_canvas_config())
        project = _project()
        scene = {
            "layout_mode": "soft_sketch_reconstruction",
            "coordinate_status": "unverified_soft_sketch",
            "points": {
                "A": {"pos": [-3.4, -2.0]},
                "B": {"pos": [-3.4, 2.0]},
                "C": {"pos": [3.4, -2.0]},
            },
            "primitives": [
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "seg_AC", "type": "segment", "points": ["A", "C"]},
                {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
                {"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]},
            ],
            "display": {
                "primitives": {
                    "poly_ABC": {"fill_opacity": 0.0},
                }
            },
        }

        code = generator.generate(project, scene, _step_contexts())

        self.assertNotIn("problem_image = ImageMobject", code)
        self.assertIn("geometry_render_mode = 'vector_reconstruction'", code)
        self.assertNotIn("Polygon(", code)
        self.assertNotIn("line_labels", code)
        self.assertIn(
            "VGroup(*[lines[k] for k in ['seg_AB', 'seg_BC', 'seg_AC']]",
            code,
        )

        validator = FormalVideoValidator(_canvas_config())
        is_valid, error_message, report = validator.validate(
            code,
            expected_steps=[{"step_id": 1, "duration": 2.4}],
        )
        self.assertTrue(is_valid, error_message)
        self.assertTrue(report["is_valid"])

    def test_template_codegen_uses_problem_image_as_base_layer_when_requested(
        self,
    ) -> None:
        generator = TemplateCodeGenerator(_canvas_config())
        project = _project()
        project.problem_image = "D:/tmp/problem.png"

        code = generator.generate(
            project, _image_overlay_scene(project.problem_image), _step_contexts()
        )

        self.assertIn("geometry_render_mode = 'image_overlay'", code)
        self.assertIn("problem_image = ImageMobject", code)
        self.assertIn("Layer 1: 原题图片底图", code)
        self.assertIn(".set_opacity(0.00).set_z_index(2)", code)
        self.assertIn(".animate.set_color(ORANGE).set_opacity(1.0)", code)
        self.assertIn("self.camera.background_color = '#fbfaf7'", code)
        self.assertIn("formula_obj.set_z_index(3)", code)
        self.assertNotIn("uniform_formula_scale", code)
        self.assertNotIn("formula_obj.scale(uniform_formula_scale)", code)

        validator = FormalVideoValidator(_canvas_config())
        is_valid, error_message, report = validator.validate(
            code,
            expected_steps=[{"step_id": 1, "duration": 2.4}],
        )
        self.assertTrue(is_valid, error_message)
        self.assertTrue(report["is_valid"])

    def test_template_codegen_aligns_overlay_points_from_pixel_coordinates(
        self,
    ) -> None:
        generator = TemplateCodeGenerator(_canvas_config())
        project = _project()
        project.problem_image = "D:/tmp/problem.png"
        scene = _image_overlay_scene(project.problem_image)
        scene["points"] = [
            {
                "id": "A",
                "coord": [0, 0],
                "pixel_coord": {"x": 0, "y": 260},
                "pixel_coord_space": "crop",
            },
            {
                "id": "B",
                "coord": [4, 0],
                "pixel_coord": {"x": 360, "y": 260},
                "pixel_coord_space": "crop",
            },
            {
                "id": "C",
                "coord": [0, 3],
                "pixel_coord": {"x": 0, "y": 0},
                "pixel_coord_space": "crop",
            },
        ]

        code = generator.generate(project, scene, _step_contexts())

        self.assertIn("points['A'] = Dot(point=np.array([-6.711, -2.756, 0])", code)
        self.assertIn("points['B'] = Dot(point=np.array([0.920, -2.756, 0])", code)
        self.assertIn("points['C'] = Dot(point=np.array([-6.711, 2.756, 0])", code)

    def test_animation_agent_crops_problem_image_to_geometry_region(self) -> None:
        try:
            from PIL import Image, ImageDraw
        except Exception as exc:  # pragma: no cover
            self.skipTest(f"Pillow unavailable: {exc}")

        with tempfile.TemporaryDirectory() as tmpdir:
            image_path = Path(tmpdir) / "problem.png"
            image = Image.new("RGB", (820, 520), "white")
            draw = ImageDraw.Draw(image)
            for x in range(410, 760, 42):
                draw.line((x, 52, x + 24, 52), fill=(25, 25, 25), width=3)
                draw.line((x + 4, 63, x + 30, 63), fill=(25, 25, 25), width=2)
            for y in range(50, 260, 32):
                draw.line((35, y, 330, y), fill=(35, 35, 35), width=2)
            draw.line((510, 380, 720, 380), fill=(20, 20, 20), width=5)
            draw.line((510, 380, 590, 150), fill=(20, 20, 20), width=5)
            draw.line((590, 150, 720, 380), fill=(20, 20, 20), width=5)
            draw.text((492, 390), "A", fill=(20, 20, 20))
            draw.text((725, 390), "B", fill=(20, 20, 20))
            draw.text((588, 125), "C", fill=(20, 20, 20))
            image.save(image_path)

            agent = AnimationAgent(
                config={"output_dir": tmpdir, "canvas_config": _canvas_config()}
            )
            crop_info = agent._prepare_problem_figure_crop(
                str(image_path), enabled=True
            )

            self.assertEqual("cropped", crop_info["crop_status"])
            self.assertTrue(Path(crop_info["crop_path"]).exists())
            x1, y1, x2, y2 = crop_info["crop_bbox"]
            self.assertGreater(x1, 360)
            self.assertGreater(y1, 90)
            self.assertLess(x2 - x1, 500)
            self.assertLess(y2 - y1, 420)

    def test_validator_rejects_forbidden_partial_llm_code(self) -> None:
        validator = FormalVideoValidator(_canvas_config())
        invalid_code = """
from manim import *
import os

class MathAnimation(Scene):
    def construct(self):
        points = {}
        lines = {}
        points['A'] = Dot()
        points['B'] = Dot()
        lines['seg_AB'] = Line()
        exec("print('bad')")
"""
        is_valid, error_message, report = validator.validate(
            invalid_code,
            expected_steps=[],
        )
        self.assertFalse(is_valid)
        self.assertIn("forbidden", error_message)
        self.assertEqual(report["failed_checks"][0]["check"], "forbidden_calls")

    def test_llm_prompt_includes_template_references_and_copy_guard(self) -> None:
        generated_code = TemplateCodeGenerator(_canvas_config()).generate(
            _project(),
            _coordinate_scene(),
            _step_contexts(),
        )
        llm = _StubLLM(f"```python\n{generated_code}\n```")
        agent = AnimationAgent(
            config={
                "canvas_config": _canvas_config(),
                "use_template_codegen": False,
                "use_template_retrieval": True,
                "template_retrieval_top_k": 2,
            },
            llm=llm,
        )
        metadata = {
            "drawable_scene": _coordinate_scene(),
            "semantic_graph": _coordinate_scene(),
            "template_references": [
                {
                    "id": "helper.make_angle_mark",
                    "snippet_name": "make_angle_mark",
                    "summary": "Create a reusable angle marker.",
                    "reason": "matched angle, circle",
                    "helpers": ["make_angle_mark"],
                    "excerpt": "def make_angle_mark(...):\n    return angle, label",
                }
            ],
        }

        candidate = agent._build_llm_fallback_candidate(
            steps=_project().script_steps,
            metadata=metadata,
            expected_steps=[{"step_id": 1, "duration": 2.4}],
        )

        self.assertTrue(candidate["ok"], candidate.get("error"))
        prompt_text = str(llm.last_messages[-1].content)
        self.assertIn("模板参考 - 只用于学习写法，不是答案", prompt_text)
        self.assertIn("绝对不能照搬模板里的坐标", prompt_text)
        self.assertIn("helper.make_angle_mark", prompt_text)

    def test_template_candidate_only_generates_full_code_once_by_default(self) -> None:
        generated_code = TemplateCodeGenerator(_canvas_config()).generate(
            _project(),
            _coordinate_scene(),
            _step_contexts(),
        )
        agent = AnimationAgent(
            config={
                "canvas_config": _canvas_config(),
                "use_template_codegen": True,
                "export_incremental_codegen_debug": False,
            }
        )
        counting_generator = _CountingGenerator(_canvas_config(), generated_code)
        agent.template_codegen = counting_generator

        candidate = agent._build_template_candidate(
            project=_project(),
            steps=_project().script_steps,
            coordinate_scene_data=_coordinate_scene(),
            expected_steps=[{"step_id": 1, "duration": 2.4}],
            conservative=False,
        )

        self.assertTrue(candidate["ok"], candidate.get("error"))
        self.assertEqual(counting_generator.calls, 1)

    def test_animation_agent_falls_back_to_vector_when_coordinate_validation_fails(
        self,
    ) -> None:
        agent = AnimationAgent(
            config={
                "canvas_config": _canvas_config(),
                "use_template_codegen": True,
                "use_template_retrieval": False,
            },
            llm=None,
        )
        project = _project()
        project.problem_image = "D:/tmp/problem.png"
        state = {
            "project": project,
            "messages": [],
            "current_step": "voice_completed",
            "metadata": {
                "drawable_scene": _coordinate_scene(),
                "coordinate_scene": None,
                "coordinate_scene_validation": {
                    "is_valid": False,
                    "failed_checks": [{"message": "bad"}],
                },
            },
        }

        result = agent.process(state)

        self.assertEqual(
            "vector_reconstruction", result["metadata"]["visual_geometry_source"]["mode"]
        )
        self.assertFalse(
            result["metadata"]["visual_geometry_source"]["coordinate_scene_verified"]
        )
        self.assertFalse(result["metadata"]["calibration"]["is_valid"])
        self.assertNotIn("ImageMobject", result["metadata"]["manim_code"])
        self.assertEqual("animation_completed", result["current_step"])

    def test_animation_agent_falls_back_to_vector_without_calibration(
        self,
    ) -> None:
        agent = AnimationAgent(
            config={
                "canvas_config": _canvas_config(),
                "use_template_codegen": True,
                "use_template_retrieval": False,
            },
            llm=None,
        )
        project = _project()
        project.problem_image = "D:/tmp/problem.png"
        state = {
            "project": project,
            "messages": [],
            "current_step": "voice_completed",
            "metadata": {
                "drawable_scene": _coordinate_scene(),
                "coordinate_scene": _coordinate_scene(),
                "coordinate_scene_validation": {"is_valid": True, "failed_checks": []},
            },
        }

        result = agent.process(state)

        self.assertEqual(
            "vector_reconstruction", result["metadata"]["visual_geometry_source"]["mode"]
        )
        self.assertTrue(
            result["metadata"]["visual_geometry_source"]["coordinate_scene_verified"]
        )
        self.assertFalse(result["metadata"]["calibration"]["is_valid"])
        self.assertNotIn("ImageMobject", result["metadata"]["manim_code"])
        self.assertEqual("animation_completed", result["current_step"])

    def test_animation_agent_uses_image_overlay_when_calibration_is_valid(
        self,
    ) -> None:
        try:
            from PIL import Image
        except Exception as exc:  # pragma: no cover
            self.skipTest(f"Pillow unavailable: {exc}")

        with tempfile.TemporaryDirectory() as tmpdir:
            image_path = Path(tmpdir) / "problem.png"
            Image.new("RGB", (260, 220), "white").save(image_path)
            scene = _coordinate_scene()
            scene["points"] = [
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
            ]
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
                },
            }

            result = agent.process(state)

            self.assertEqual(
                "image_overlay", result["metadata"]["visual_geometry_source"]["mode"]
            )
            self.assertTrue(result["metadata"]["calibration"]["is_valid"])
            self.assertEqual("ok", result["metadata"]["calibration"]["reason"])
            self.assertIn("ImageMobject", result["metadata"]["manim_code"])
            self.assertTrue((Path(tmpdir) / "debug" / "calibration.json").exists())
            self.assertEqual("animation_completed", result["current_step"])

    def test_animation_agent_prefers_vector_reconstruction_when_verified_scene_exists(
        self,
    ) -> None:
        try:
            from PIL import Image
        except Exception as exc:  # pragma: no cover
            self.skipTest(f"Pillow unavailable: {exc}")

        with tempfile.TemporaryDirectory() as tmpdir:
            image_path = Path(tmpdir) / "problem.png"
            Image.new("RGB", (260, 220), "white").save(image_path)
            scene = _coordinate_scene()
            scene["points"] = [
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
            ]
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
                    "coordinate_scene": scene,
                    "coordinate_scene_validation": {
                        "is_valid": True,
                        "failed_checks": [],
                    },
                },
            }

            result = agent.process(state)

            self.assertEqual(
                "vector_reconstruction",
                result["metadata"]["visual_geometry_source"]["mode"],
            )
            self.assertTrue(
                result["metadata"]["visual_geometry_source"]["coordinate_scene_verified"]
            )
            self.assertFalse(result["metadata"]["calibration"]["is_valid"])
            self.assertNotIn("ImageMobject", result["metadata"]["manim_code"])
            self.assertEqual("animation_completed", result["current_step"])

    def test_animation_agent_prefers_soft_sketch_over_verified_coordinate_scene(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            soft_scene = {
                "layout_mode": "soft_sketch_reconstruction",
                "points": {
                    "A": {"pos": [-3.4, -2.0]},
                    "B": {"pos": [-3.4, 2.0]},
                    "C": {"pos": [3.4, -2.0]},
                },
                "primitives": [
                    {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                    {"id": "seg_AC", "type": "segment", "points": ["A", "C"]},
                    {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
                    {"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]},
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
            state = {
                "project": _project(),
                "messages": [],
                "current_step": "voice_completed",
                "metadata": {
                    "drawable_scene": soft_scene,
                    "coordinate_scene": _coordinate_scene(),
                    "coordinate_scene_validation": {
                        "is_valid": True,
                        "failed_checks": [],
                    },
                },
            }

            result = agent.process(state)

            self.assertEqual(
                "drawable_scene_soft_sketch",
                result["metadata"]["visual_geometry_source"]["selected_scene_source"],
            )
            self.assertNotIn("Polygon(", result["metadata"]["manim_code"])
            self.assertNotIn("line_labels", result["metadata"]["manim_code"])
            self.assertIn(
                "self.camera.background_color = '#fbfaf7'",
                result["metadata"]["manim_code"],
            )

    def test_animation_agent_rejects_uncalibrated_image_overlay_by_default(
        self,
    ) -> None:
        try:
            from PIL import Image, ImageDraw
        except Exception as exc:  # pragma: no cover
            self.skipTest(f"Pillow unavailable: {exc}")

        with tempfile.TemporaryDirectory() as tmpdir:
            image_path = Path(tmpdir) / "problem.png"
            image = Image.new("RGB", (260, 220), "white")
            draw = ImageDraw.Draw(image)
            draw.line([(25, 185), (220, 185), (220, 45), (25, 185)], fill="black", width=5)
            image.save(image_path)

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
                    "drawable_scene": _coordinate_scene(),
                    "coordinate_scene": None,
                    "coordinate_scene_validation": {
                        "is_valid": False,
                        "failed_checks": [{"message": "bad"}],
                    },
                },
            }

            result = agent.process(state)
            visual_source = result["metadata"]["visual_geometry_source"]

            self.assertEqual("vector_reconstruction", visual_source["mode"])
            self.assertFalse(result["metadata"]["calibration"]["is_valid"])
            self.assertEqual(
                "rejected_uncalibrated_image_overlay",
                result["metadata"]["calibration"]["overlay_fallback"],
            )
            self.assertNotIn("ImageMobject", result["metadata"]["manim_code"])
            self.assertEqual("animation_completed", result["current_step"])

    def test_animation_agent_can_explicitly_keep_uncalibrated_image_overlay(
        self,
    ) -> None:
        try:
            from PIL import Image, ImageDraw
        except Exception as exc:  # pragma: no cover
            self.skipTest(f"Pillow unavailable: {exc}")

        with tempfile.TemporaryDirectory() as tmpdir:
            image_path = Path(tmpdir) / "problem.png"
            image = Image.new("RGB", (260, 220), "white")
            draw = ImageDraw.Draw(image)
            draw.line([(25, 185), (220, 185), (220, 45), (25, 185)], fill="black", width=5)
            image.save(image_path)

            agent = AnimationAgent(
                config={
                    "canvas_config": _canvas_config(),
                    "output_dir": tmpdir,
                    "use_template_codegen": True,
                    "use_template_retrieval": False,
                    "allow_uncalibrated_image_overlay": True,
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
                    "drawable_scene": _coordinate_scene(),
                    "coordinate_scene": None,
                    "coordinate_scene_validation": {
                        "is_valid": False,
                        "failed_checks": [{"message": "bad"}],
                    },
                },
            }

            result = agent.process(state)
            visual_source = result["metadata"]["visual_geometry_source"]

            self.assertEqual("image_overlay", visual_source["mode"])
            self.assertEqual("cropped", visual_source["crop_status"])
            self.assertFalse(result["metadata"]["calibration"]["is_valid"])
            self.assertEqual(
                "uncalibrated_image_overlay",
                result["metadata"]["calibration"]["overlay_fallback"],
            )
            self.assertIn("ImageMobject", result["metadata"]["manim_code"])
            self.assertEqual("animation_completed", result["current_step"])

    def test_overlay_calibration_snaps_anchors_to_vector_intersections(self) -> None:
        agent = AnimationAgent(
            config={
                "canvas_config": _canvas_config(),
                "use_template_codegen": True,
                "use_template_retrieval": False,
            },
            llm=None,
        )
        scene = _coordinate_scene()
        scene["points"] = [
            {
                "id": "A",
                "pos": [0, 0],
                "pixel_coord": {"x": 14, "y": 106},
                "pixel_coord_space": "crop",
            },
            {
                "id": "B",
                "pos": [4, 0],
                "pixel_coord": {"x": 107, "y": 107},
                "pixel_coord_space": "crop",
            },
            {
                "id": "C",
                "pos": [0, 3],
                "pixel_coord": {"x": 13, "y": 39},
                "pixel_coord_space": "crop",
            },
        ]
        crop_info = {
            "crop_size": [140, 140],
            "crop_bbox": [0, 0, 140, 140],
            "crop_status": "cropped",
            "vector_hints": {
                "lines": [
                    {"id": "line_ab", "x1": 10, "y1": 110, "x2": 110, "y2": 110},
                    {"id": "line_ac", "x1": 10, "y1": 110, "x2": 10, "y2": 35},
                    {"id": "line_bc", "x1": 110, "y1": 110, "x2": 10, "y2": 35},
                ]
            },
        }

        calibration = agent._build_overlay_calibration(scene, crop_info)
        anchor_lookup = {item["id"]: item for item in calibration["anchors"]}

        self.assertTrue(calibration["is_valid"], calibration)
        self.assertEqual([10.0, 110.0], anchor_lookup["A"]["vector_snap"]["to"])
        self.assertEqual("line_intersection", anchor_lookup["A"]["vector_snap"]["kind"])
        self.assertEqual([110.0, 110.0], anchor_lookup["B"]["vector_snap"]["to"])
        self.assertEqual([10.0, 35.0], anchor_lookup["C"]["vector_snap"]["to"])

    def test_overlay_calibration_binds_label_bbox_to_vector_intersection(self) -> None:
        agent = AnimationAgent(
            config={
                "canvas_config": _canvas_config(),
                "use_template_codegen": True,
                "use_template_retrieval": False,
            },
            llm=None,
        )
        scene = _coordinate_scene()
        scene["points"] = [
            {
                "id": "A",
                "coord": [0, 0],
                "label_bbox": {"x1": 0, "y1": 98, "x2": 8, "y2": 118},
                "label_bbox_space": "crop",
            },
            {
                "id": "B",
                "coord": [4, 0],
                "pixel_coord": {"x": 110, "y": 110},
                "pixel_coord_space": "crop",
            },
            {
                "id": "C",
                "coord": [0, 3],
                "pixel_coord": {"x": 10, "y": 35},
                "pixel_coord_space": "crop",
            },
        ]
        crop_info = {
            "crop_size": [140, 140],
            "crop_bbox": [0, 0, 140, 140],
            "crop_status": "cropped",
            "vector_hints": {
                "lines": [
                    {"id": "line_ab", "x1": 10, "y1": 110, "x2": 110, "y2": 110},
                    {"id": "line_ac", "x1": 10, "y1": 110, "x2": 10, "y2": 35},
                    {"id": "line_bc", "x1": 110, "y1": 110, "x2": 10, "y2": 35},
                ]
            },
        }

        calibration = agent._build_overlay_calibration(scene, crop_info)
        anchor_lookup = {item["id"]: item for item in calibration["anchors"]}

        self.assertTrue(calibration["is_valid"], calibration)
        self.assertEqual([10.0, 110.0], anchor_lookup["A"]["crop_pixel"])
        self.assertEqual(
            "label_bbox_nearest_vector_point",
            anchor_lookup["A"]["label_vector_binding"]["binding_source"],
        )
        self.assertNotIn("vector_snap", anchor_lookup["A"])

    def test_overlay_calibration_uses_label_bbox_when_pixel_coord_is_label_center(
        self,
    ) -> None:
        agent = AnimationAgent(
            config={
                "canvas_config": _canvas_config(),
                "use_template_codegen": True,
                "use_template_retrieval": False,
            },
            llm=None,
        )
        scene = _coordinate_scene()
        scene["points"] = [
            {
                "id": "A",
                "coord": [0, 0],
                "pixel_coord": {"x": 0, "y": 100},
                "pixel_coord_space": "crop",
                "label_bbox": {"x1": 0, "y1": 98, "x2": 8, "y2": 118},
                "label_bbox_space": "crop",
            },
            {
                "id": "B",
                "coord": [4, 0],
                "pixel_coord": {"x": 110, "y": 110},
                "pixel_coord_space": "crop",
            },
            {
                "id": "C",
                "coord": [0, 3],
                "pixel_coord": {"x": 10, "y": 35},
                "pixel_coord_space": "crop",
            },
        ]
        crop_info = {
            "crop_size": [140, 140],
            "crop_bbox": [0, 0, 140, 140],
            "crop_status": "cropped",
            "vector_hints": {
                "lines": [
                    {"id": "line_ab", "x1": 10, "y1": 110, "x2": 110, "y2": 110},
                    {"id": "line_ac", "x1": 10, "y1": 110, "x2": 10, "y2": 35},
                    {"id": "line_bc", "x1": 110, "y1": 110, "x2": 10, "y2": 35},
                ]
            },
        }

        calibration = agent._build_overlay_calibration(scene, crop_info)
        anchor_lookup = {item["id"]: item for item in calibration["anchors"]}

        self.assertTrue(calibration["is_valid"], calibration)
        self.assertEqual([10.0, 110.0], anchor_lookup["A"]["crop_pixel"])
        self.assertEqual(
            "label_bbox_nearest_vector_point",
            anchor_lookup["A"]["label_vector_binding"]["binding_source"],
        )
        self.assertNotIn("vector_snap", anchor_lookup["A"])

    def test_overlay_calibration_snaps_anchors_to_vector_circle(self) -> None:
        agent = AnimationAgent(
            config={
                "canvas_config": _canvas_config(),
                "use_template_codegen": True,
                "use_template_retrieval": False,
            },
            llm=None,
        )
        scene = {
            "mode": "2d",
            "points": [
                {
                    "id": "O",
                    "coord": [0, 0],
                    "pixel_coord": {"x": 73, "y": 68},
                    "pixel_coord_space": "crop",
                },
                {
                    "id": "A",
                    "coord": [5, 0],
                    "pixel_coord": {"x": 117, "y": 70},
                    "pixel_coord_space": "crop",
                },
                {
                    "id": "B",
                    "coord": [0, 5],
                    "pixel_coord": {"x": 70, "y": 23},
                    "pixel_coord_space": "crop",
                },
            ],
            "primitives": [
                {"id": "circle_O", "type": "circle", "center": "O", "radius_point": "A"}
            ],
            "constraints": [],
            "display": {},
            "measurements": [],
        }
        crop_info = {
            "crop_size": [160, 160],
            "crop_bbox": [0, 0, 160, 160],
            "crop_status": "cropped",
            "vector_hints": {
                "lines": [],
                "circles": [{"id": "circle_1", "cx": 70, "cy": 70, "r": 50}],
            },
        }

        calibration = agent._build_overlay_calibration(scene, crop_info)
        anchor_lookup = {item["id"]: item for item in calibration["anchors"]}

        self.assertTrue(calibration["is_valid"], calibration)
        self.assertEqual([70.0, 70.0], anchor_lookup["O"]["vector_snap"]["to"])
        self.assertEqual("circle_center", anchor_lookup["O"]["vector_snap"]["kind"])
        self.assertEqual("circle_projection", anchor_lookup["A"]["vector_snap"]["kind"])
        self.assertAlmostEqual(120.0, anchor_lookup["A"]["vector_snap"]["to"][0], delta=1.5)
        self.assertAlmostEqual(70.0, anchor_lookup["A"]["vector_snap"]["to"][1], delta=1.5)
        self.assertEqual("circle_projection", anchor_lookup["B"]["vector_snap"]["kind"])
        self.assertAlmostEqual(70.0, anchor_lookup["B"]["vector_snap"]["to"][0], delta=1.5)
        self.assertAlmostEqual(20.0, anchor_lookup["B"]["vector_snap"]["to"][1], delta=1.5)

    def test_overlay_calibration_snaps_to_line_circle_intersections(self) -> None:
        agent = AnimationAgent(
            config={
                "canvas_config": _canvas_config(),
                "use_template_codegen": True,
                "use_template_retrieval": False,
            },
            llm=None,
        )
        scene = {
            "mode": "2d",
            "points": [
                {
                    "id": "L",
                    "coord": [-5, 0],
                    "pixel_coord": {"x": 18, "y": 72},
                    "pixel_coord_space": "crop",
                },
                {
                    "id": "R",
                    "coord": [5, 0],
                    "pixel_coord": {"x": 122, "y": 68},
                    "pixel_coord_space": "crop",
                },
                {
                    "id": "O",
                    "coord": [0, 0],
                    "pixel_coord": {"x": 70, "y": 70},
                    "pixel_coord_space": "crop",
                },
            ],
            "primitives": [],
            "constraints": [],
            "display": {},
            "measurements": [],
        }
        crop_info = {
            "crop_size": [160, 160],
            "crop_bbox": [0, 0, 160, 160],
            "crop_status": "cropped",
            "vector_hints": {
                "lines": [{"id": "diameter", "x1": 0, "y1": 70, "x2": 140, "y2": 70}],
                "circles": [{"id": "circle_1", "cx": 70, "cy": 70, "r": 50}],
            },
        }

        calibration = agent._build_overlay_calibration(scene, crop_info)
        anchor_lookup = {item["id"]: item for item in calibration["anchors"]}

        self.assertTrue(calibration["is_valid"], calibration)
        self.assertEqual(
            "line_circle_intersection", anchor_lookup["L"]["vector_snap"]["kind"]
        )
        self.assertAlmostEqual(20.0, anchor_lookup["L"]["vector_snap"]["to"][0], delta=1.5)
        self.assertAlmostEqual(70.0, anchor_lookup["L"]["vector_snap"]["to"][1], delta=1.5)
        self.assertEqual(
            "line_circle_intersection", anchor_lookup["R"]["vector_snap"]["kind"]
        )
        self.assertAlmostEqual(120.0, anchor_lookup["R"]["vector_snap"]["to"][0], delta=1.5)
        self.assertAlmostEqual(70.0, anchor_lookup["R"]["vector_snap"]["to"][1], delta=1.5)

    def test_overlay_calibration_snaps_to_circle_circle_intersections(self) -> None:
        agent = AnimationAgent(
            config={
                "canvas_config": _canvas_config(),
                "use_template_codegen": True,
                "use_template_retrieval": False,
            },
            llm=None,
        )
        scene = {
            "mode": "2d",
            "points": [
                {
                    "id": "A",
                    "coord": [0, 4],
                    "pixel_coord": {"x": 70, "y": 27},
                    "pixel_coord_space": "crop",
                },
                {
                    "id": "B",
                    "coord": [0, -4],
                    "pixel_coord": {"x": 70, "y": 113},
                    "pixel_coord_space": "crop",
                },
                {
                    "id": "M",
                    "coord": [0, 0],
                    "pixel_coord": {"x": 70, "y": 70},
                    "pixel_coord_space": "crop",
                },
            ],
            "primitives": [],
            "constraints": [],
            "display": {},
            "measurements": [],
        }
        crop_info = {
            "crop_size": [160, 160],
            "crop_bbox": [0, 0, 160, 160],
            "crop_status": "cropped",
            "vector_hints": {
                "lines": [],
                "circles": [
                    {"id": "left", "cx": 40, "cy": 70, "r": 50},
                    {"id": "right", "cx": 100, "cy": 70, "r": 50},
                ],
            },
        }

        calibration = agent._build_overlay_calibration(scene, crop_info)
        anchor_lookup = {item["id"]: item for item in calibration["anchors"]}

        self.assertTrue(calibration["is_valid"], calibration)
        self.assertEqual(
            "circle_circle_intersection", anchor_lookup["A"]["vector_snap"]["kind"]
        )
        self.assertAlmostEqual(70.0, anchor_lookup["A"]["vector_snap"]["to"][0], delta=1.5)
        self.assertAlmostEqual(30.0, anchor_lookup["A"]["vector_snap"]["to"][1], delta=4.0)
        self.assertEqual(
            "circle_circle_intersection", anchor_lookup["B"]["vector_snap"]["kind"]
        )
        self.assertAlmostEqual(70.0, anchor_lookup["B"]["vector_snap"]["to"][0], delta=1.5)
        self.assertAlmostEqual(110.0, anchor_lookup["B"]["vector_snap"]["to"][1], delta=4.0)

    def test_overlay_calibration_falls_back_to_affine_when_similarity_residual_is_large(
        self,
    ) -> None:
        agent = AnimationAgent(
            config={
                "canvas_config": _canvas_config(),
                "use_template_codegen": True,
                "use_template_retrieval": False,
            },
            llm=None,
        )
        scene = {
            "mode": "2d",
            "points": [
                {
                    "id": "A",
                    "coord": [0, 0],
                    "pixel_coord": {"x": 20, "y": 120},
                    "pixel_coord_space": "crop",
                },
                {
                    "id": "B",
                    "coord": [4, 0],
                    "pixel_coord": {"x": 160, "y": 120},
                    "pixel_coord_space": "crop",
                },
                {
                    "id": "C",
                    "coord": [0, 3],
                    "pixel_coord": {"x": 20, "y": 84},
                    "pixel_coord_space": "crop",
                },
                {
                    "id": "D",
                    "coord": [4, 3],
                    "pixel_coord": {"x": 160, "y": 84},
                    "pixel_coord_space": "crop",
                },
            ],
            "primitives": [],
            "constraints": [],
            "display": {},
            "measurements": [],
        }
        crop_info = {
            "crop_size": [180, 140],
            "crop_bbox": [0, 0, 180, 140],
            "crop_status": "cropped",
            "vector_hints": {"lines": [], "circles": []},
        }

        calibration = agent._build_overlay_calibration(scene, crop_info)
        attempts = {item["type"]: item for item in calibration["fit_attempts"]}

        self.assertTrue(calibration["is_valid"], calibration)
        self.assertEqual("affine", calibration["mode"])
        self.assertEqual("affine", calibration["transform"]["type"])
        self.assertFalse(attempts["similarity"]["is_valid"])
        self.assertTrue(attempts["affine"]["is_valid"])
        self.assertGreater(attempts["similarity"]["rms_error_px"], calibration["tolerance_px"])
        self.assertLessEqual(calibration["rms_error_px"], 0.001)

    def test_pixel_anchors_survive_fact_compile_and_scene_derivation(self) -> None:
        fact_compiler = GeometryFactCompiler()
        scene_compiler = CoordinateSceneCompiler()
        geometry_spec = fact_compiler.compile(
            {
                "points": [
                    {
                        "id": "A",
                        "pixel_coord": {"x": 12, "y": 34},
                        "pixel_coord_space": "source",
                    },
                    {
                        "id": "B",
                        "pixel_coord": {"x": 212, "y": 34},
                        "pixel_coord_space": "source",
                    },
                    {
                        "id": "C",
                        "pixel_coord": {"x": 80, "y": 180},
                        "pixel_coord_space": "source",
                    },
                ],
                "segments": ["AB", "AC", "BC"],
                "polygons": ["ABC"],
            },
            problem_text="triangle ABC",
        )
        coordinate_scene = scene_compiler.solve_coordinate_scene(geometry_spec)
        drawable_scene = scene_compiler.derive_drawable_scene(coordinate_scene)

        point_a = next(item for item in coordinate_scene["points"] if item["id"] == "A")
        self.assertEqual({"x": 12, "y": 34}, point_a["pixel_coord"])
        self.assertEqual("source", point_a["pixel_coord_space"])
        self.assertEqual(
            {"x": 12, "y": 34}, drawable_scene["points"]["A"]["pixel_coord"]
        )

    def test_bbox_pixel_anchors_are_normalized_into_drawable_scene(self) -> None:
        fact_compiler = GeometryFactCompiler()
        scene_compiler = CoordinateSceneCompiler()
        geometry_spec = fact_compiler.compile(
            {
                "points": [
                    {
                        "id": "A",
                        "bbox": {"x": 10, "y": 20, "width": 30, "height": 40},
                    },
                    {
                        "id": "B",
                        "visual": {
                            "bbox": {
                                "left": 100,
                                "top": 40,
                                "right": 140,
                                "bottom": 80,
                            }
                        },
                    },
                    {"id": "C"},
                ],
                "segments": ["AB", "AC", "BC"],
                "polygons": ["ABC"],
            },
            problem_text="triangle ABC",
        )
        coordinate_scene = scene_compiler.solve_coordinate_scene(geometry_spec)
        drawable_scene = scene_compiler.derive_drawable_scene(coordinate_scene)

        self.assertEqual(
            {"x": 25, "y": 40}, drawable_scene["points"]["A"]["pixel_coord"]
        )
        self.assertEqual(
            {"x": 120, "y": 60}, drawable_scene["points"]["B"]["pixel_coord"]
        )
        self.assertEqual(
            ["A", "B"], drawable_scene["pixel_anchor_coverage"]["anchored_points"]
        )
        self.assertEqual(
            ["C"], drawable_scene["pixel_anchor_coverage"]["missing_points"]
        )

    def test_scene_point_coordinates_accepts_common_coord_aliases(self) -> None:
        self.assertEqual(
            {"A": [1.0, 2.0], "B": [3.0, 4.0]},
            scene_point_coordinates(
                {
                    "points": {
                        "A": {"coord": [1, 2]},
                        "B": {"pos": [3, 4]},
                    }
                }
            ),
        )
        self.assertEqual(
            {"C": [5.0, 6.0], "D": [7.0, 8.0]},
            scene_point_coordinates(
                {
                    "points": [
                        {"id": "C", "pos": [5, 6]},
                        {"id": "D", "position": {"x": 7, "y": 8}},
                    ]
                }
            ),
        )

    def test_error_classifier_maps_common_failures(self) -> None:
        self.assertEqual(
            classify_render_error("SyntaxError: invalid syntax"), "PY_SYNTAX"
        )
        self.assertEqual(
            classify_render_error("ValueError: run_time of 0 <= 0 seconds"),
            "INVALID_TIMING",
        )
        self.assertEqual(
            classify_render_error("LaTeX Error converting to dvi"), "LATEX_TEXT_INVALID"
        )
        self.assertEqual(
            classify_render_error("AttributeError: object has no attribute"),
            "MANIM_API",
        )

    def test_merge_agent_switches_to_conservative_candidate_before_render(self) -> None:
        generator = TemplateCodeGenerator(_canvas_config())
        project = _project()
        conservative_code = generator.generate(
            project, _coordinate_scene(), _step_contexts()
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            agent = StubMergeAgent(
                config={
                    "output_dir": tmpdir,
                    "canvas_config": _canvas_config(),
                    "layout": "left_graph_right_formula",
                    "max_repair_rounds": 1,
                }
            )
            project.manim_class_name = "MathAnimation"
            project.audio_embedded = True
            state = {
                "project": project,
                "messages": [],
                "current_step": "animation_completed",
                "metadata": {
                    "manim_code": "def broken(",
                    "manim_codegen_mode": "template_formal",
                    "manim_code_candidates": {
                        "template_formal": "def broken(",
                        "template_conservative": conservative_code,
                    },
                    "validation_candidates": {
                        "template_formal": {"is_valid": False},
                        "template_conservative": {"is_valid": True},
                    },
                    "fallback_level": "formal",
                },
            }

            result = agent.process(state)

            self.assertEqual(
                result["metadata"]["manim_codegen_mode"], "template_conservative"
            )
            self.assertEqual(result["metadata"]["fallback_level"], "conservative")
            self.assertIn(
                "highlight_anims.append(points['A'].animate.set_color(ORANGE))",
                agent.last_rendered_code,
            )
            self.assertEqual(result["project"].status, "completed")
            self.assertTrue(
                result["project"].final_video_path.endswith("animation.mp4")
            )

    def test_merge_agent_marks_uncalibrated_overlay_as_degraded(self) -> None:
        generator = TemplateCodeGenerator(_canvas_config())
        project = _project()
        manim_code = generator.generate(project, _coordinate_scene(), _step_contexts())

        with tempfile.TemporaryDirectory() as tmpdir:
            agent = StubMergeAgent(
                config={
                    "output_dir": tmpdir,
                    "canvas_config": _canvas_config(),
                    "layout": "left_graph_right_formula",
                    "mobile_compatible_output": False,
                }
            )
            project.manim_class_name = "MathAnimation"
            state = {
                "project": project,
                "messages": [],
                "current_step": "animation_completed",
                "metadata": {
                    "manim_code": manim_code,
                    "calibration": {
                        "is_valid": False,
                        "overlay_fallback": "uncalibrated_image_overlay",
                    },
                    "visual_geometry_source": {"mode": "image_overlay"},
                },
            }

            result = agent.process(state)

            self.assertEqual("completed_degraded", result["project"].status)
            self.assertIn("degraded visual geometry", result["project"].error_message)

    def test_select_rendered_mp4_ignores_partial_movie_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            agent = MergeAgent(config={"output_dir": tmpdir})
            media_dir = Path(tmpdir) / "media"
            partial_file = (
                media_dir
                / "videos"
                / "math_animation"
                / "480p15"
                / "partial_movie_files"
                / "MathAnimation"
                / "00001.mp4"
            )
            final_file = (
                media_dir / "videos" / "math_animation" / "480p15" / "MathAnimation.mp4"
            )

            partial_file.parent.mkdir(parents=True, exist_ok=True)
            final_file.parent.mkdir(parents=True, exist_ok=True)
            partial_file.write_bytes(b"partial")
            final_file.write_bytes(b"final")

            selected = agent._select_rendered_mp4(
                media_dir, pre_existing_state={}, class_name="MathAnimation"
            )
            self.assertEqual(selected, final_file)

    def test_mobile_compatible_transcode_uses_h264_aac(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            agent = MergeAgent(config={"output_dir": tmpdir})
            input_file = Path(tmpdir) / "animation.mp4"
            output_file = Path(tmpdir) / "final_video.mp4"
            input_file.write_bytes(b"video")
            commands = []

            def fake_run(cmd, **_kwargs):
                commands.append(cmd)
                output_file.write_bytes(b"transcoded")
                return types.SimpleNamespace(returncode=0, stderr="")

            with patch("agents.execution.merge_agent.subprocess.run", fake_run):
                ok = agent._transcode_mobile_compatible_mp4(
                    str(input_file), str(output_file)
                )

            self.assertTrue(ok)
            self.assertIn("libx264", commands[0])
            self.assertIn("yuv420p", commands[0])
            self.assertIn("aac", commands[0])
            self.assertIn("+faststart", commands[0])

    def test_select_rendered_mp4_does_not_pick_stale_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            agent = MergeAgent(config={"output_dir": tmpdir})
            media_dir = Path(tmpdir) / "media"
            stale_final = (
                media_dir / "videos" / "math_animation" / "480p15" / "MathAnimation.mp4"
            )
            partial_new = (
                media_dir
                / "videos"
                / "math_animation"
                / "480p15"
                / "partial_movie_files"
                / "MathAnimation"
                / "00002.mp4"
            )

            stale_final.parent.mkdir(parents=True, exist_ok=True)
            partial_new.parent.mkdir(parents=True, exist_ok=True)
            stale_final.write_bytes(b"stale-final")

            pre_existing_state = {
                str(stale_final.resolve()): (
                    stale_final.stat().st_mtime,
                    stale_final.stat().st_size,
                    agent._fingerprint_file(stale_final),
                )
            }
            partial_new.write_bytes(b"new-partial")

            selected = agent._select_rendered_mp4(
                media_dir,
                pre_existing_state=pre_existing_state,
                class_name="MathAnimation",
            )
            self.assertIsNone(selected)

    def test_select_rendered_mp4_prefers_class_name_match(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            agent = MergeAgent(config={"output_dir": tmpdir})
            media_dir = Path(tmpdir) / "media"
            target_file = (
                media_dir / "videos" / "math_animation" / "480p15" / "MathAnimation.mp4"
            )
            other_file = (
                media_dir / "videos" / "math_animation" / "480p15" / "OtherScene.mp4"
            )

            target_file.parent.mkdir(parents=True, exist_ok=True)
            target_file.write_bytes(b"target")
            other_file.write_bytes(b"other")

            selected = agent._select_rendered_mp4(
                media_dir,
                pre_existing_state={},
                class_name="MathAnimation",
            )
            self.assertEqual(selected, target_file)

    def test_select_rendered_mp4_detects_overwrite_when_mtime_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            agent = MergeAgent(config={"output_dir": tmpdir})
            media_dir = Path(tmpdir) / "media"
            final_file = (
                media_dir / "videos" / "math_animation" / "480p15" / "MathAnimation.mp4"
            )

            final_file.parent.mkdir(parents=True, exist_ok=True)
            final_file.write_bytes(b"old")
            old_mtime = final_file.stat().st_mtime
            pre_existing_state = {
                str(final_file.resolve()): (
                    old_mtime,
                    final_file.stat().st_size,
                    agent._fingerprint_file(final_file),
                )
            }

            final_file.write_bytes(b"new-content")
            os.utime(final_file, (old_mtime, old_mtime))

            selected = agent._select_rendered_mp4(
                media_dir,
                pre_existing_state=pre_existing_state,
                class_name="MathAnimation",
            )
            self.assertEqual(selected, final_file)

    def test_select_rendered_mp4_detects_overwrite_when_size_and_mtime_unchanged(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            agent = MergeAgent(config={"output_dir": tmpdir})
            media_dir = Path(tmpdir) / "media"
            final_file = (
                media_dir / "videos" / "math_animation" / "480p15" / "MathAnimation.mp4"
            )

            final_file.parent.mkdir(parents=True, exist_ok=True)
            final_file.write_bytes(b"old_data")
            old_mtime = final_file.stat().st_mtime
            old_size = final_file.stat().st_size
            pre_existing_state = {
                str(final_file.resolve()): (
                    old_mtime,
                    old_size,
                    agent._fingerprint_file(final_file),
                )
            }

            final_file.write_bytes(b"new_data")
            os.utime(final_file, (old_mtime, old_mtime))

            selected = agent._select_rendered_mp4(
                media_dir,
                pre_existing_state=pre_existing_state,
                class_name="MathAnimation",
            )
            self.assertEqual(final_file.stat().st_size, old_size)
            self.assertEqual(selected, final_file)


if __name__ == "__main__":
    unittest.main()
