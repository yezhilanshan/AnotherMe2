import json
import sys
import types
from pathlib import Path

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

from agents.execution.interactive_agent import InteractiveAgent
from agents.foundation.state import ScriptStep, VideoProject


def test_interactive_agent_writes_scene_package_and_html(tmp_path: Path):
    agent = InteractiveAgent(config={"output_dir": str(tmp_path)}, llm=None)
    project = VideoProject(
        problem_text="如图，在三角形 ABC 中作辅助线。",
        script_steps=[
            ScriptStep(
                id=1,
                title="观察图形",
                duration=2.0,
                narration="先观察三角形 ABC。",
                visual_cues=["显示三角形"],
                visible_segments=["AB", "BC", "CA"],
            ),
            ScriptStep(
                id=2,
                title="添加辅助线",
                duration=2.0,
                narration="拖动点 D，观察辅助线 AD 的变化。",
                visual_cues=["显示 AD"],
                visible_segments=["AB", "BC", "CA", "AD"],
            ),
        ],
    )
    state = {
        "project": project,
        "messages": [],
        "current_step": "script_completed",
        "metadata": {
            "coordinate_scene": {
                "mode": "2d",
                "points": [
                    {"id": "A", "coord": [0, 0]},
                    {"id": "B", "coord": [4, 0]},
                    {"id": "C", "coord": [1, 3]},
                    {"id": "D", "coord": [2, 1], "draggable": True},
                ],
                "primitives": [
                    {"id": "AB", "type": "segment", "points": ["A", "B"]},
                    {"id": "BC", "type": "segment", "points": ["B", "C"]},
                    {"id": "CA", "type": "segment", "points": ["C", "A"]},
                    {
                        "id": "AD",
                        "type": "segment",
                        "points": ["A", "D"],
                        "style": {"dash": True},
                    },
                ],
            }
        },
    }

    result = agent.process(state)

    output_project = result["project"]
    assert output_project.status == "completed"
    assert output_project.interactive_html_path
    assert output_project.scene_package_path
    html_path = Path(output_project.interactive_html_path)
    package_path = Path(output_project.scene_package_path)
    assert html_path.exists()
    assert package_path.exists()

    package = json.loads(package_path.read_text(encoding="utf-8"))
    assert package["scene_source"] == "coordinate_scene"
    assert [point["id"] for point in package["scene"]["points"]] == ["A", "B", "C", "D"]
    assert len(package["scene"]["primitives"]) == 4
    assert len(package["steps"]) == 2

    html = html_path.read_text(encoding="utf-8")
    assert "scene-package" in html
    assert "pointerdown" in html
    assert "anotherme-frontend-geometry" in html


def test_interactive_agent_prefers_layout_selection_source(tmp_path: Path):
    agent = InteractiveAgent(config={"output_dir": str(tmp_path)}, llm=None)
    project = VideoProject(
        problem_text="折叠题交互预览",
        script_steps=[
            ScriptStep(
                id=1,
                title="观察",
                duration=2.0,
                narration="观察折前图形。",
                visual_cues=["显示折线"],
            )
        ],
    )
    coordinate_scene = {
        "mode": "2d",
        "points": [
            {"id": "A", "coord": [0, 0]},
            {"id": "B", "coord": [4, 0]},
            {"id": "C", "coord": [1, 3]},
        ],
        "primitives": [
            {"id": "AB", "type": "segment", "points": ["A", "B"]},
            {"id": "BC", "type": "segment", "points": ["B", "C"]},
        ],
    }
    soft_scene = {
        "mode": "2d",
        "layout_mode": "soft_sketch_reconstruction",
        "points": {
            "A": {"id": "A", "coord": [0, 0]},
            "B": {"id": "B", "coord": [4, 0]},
            "C": {"id": "C", "coord": [1, 3]},
        },
        "primitives": [
            {"id": "AB", "type": "segment", "points": ["A", "B"]},
            {"id": "BC", "type": "segment", "points": ["B", "C"]},
        ],
    }
    state = {
        "project": project,
        "messages": [],
        "current_step": "script_completed",
        "metadata": {
            "coordinate_scene": coordinate_scene,
            "coordinate_scene_validation": {"is_valid": True, "failed_checks": []},
            "drawable_scene": soft_scene,
            "drawable_scene_source": "soft_sketch_from_normalized_geometry_spec",
        },
    }

    result = agent.process(state)

    package_path = Path(result["project"].scene_package_path)
    package = json.loads(package_path.read_text(encoding="utf-8"))
    assert package["scene_source"] == "drawable_scene_soft_sketch"
    assert (
        package["metadata"]["layout_selection"]["selected_scene_source"]
        == "drawable_scene_soft_sketch"
    )
