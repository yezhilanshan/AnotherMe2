"""
状态定义 - 用于 LangGraph 的状态管理
"""
from copy import deepcopy
from typing import Annotated, Dict, List, Any, Optional, TypedDict
from dataclasses import dataclass, field


@dataclass
class ScriptStep:
    """脚本步骤"""
    id: int
    title: str
    duration: float
    narration: str
    visual_cues: List[str]
    on_screen_texts: List[Dict[str, Any]] = field(default_factory=list)
    spoken_formulas: List[str] = field(default_factory=list)
    visible_segments: List[str] = field(default_factory=list)
    required_actions: List[Dict[str, Any]] = field(default_factory=list)
    auxiliary_line_actions: List[Dict[str, Any]] = field(default_factory=list)
    animation_policy: str = "auto"
    manim_code: Optional[str] = None
    audio_file: Optional[str] = None
    audio_duration: Optional[float] = None


@dataclass
class VideoProject:
    """视频项目完整状态"""
    # 输入
    problem_text: str = ""
    problem_image: Optional[str] = None  # 图片路径
    geometry_file: Optional[str] = None  # 显式几何定义文件
    export_ggb: bool = True              # 是否导出 GGB 调试指令

    # 脚本阶段输出
    script_steps: List[ScriptStep] = field(default_factory=list)
    total_duration: float = 0.0

    # 动画阶段输出
    manim_class_name: str = ""
    manim_file_path: Optional[str] = None
    animation_rendered: bool = False
    audio_embedded: bool = False  # 音频是否已通过 Manim add_sound 嵌入视频

    # 音频阶段输出
    tts_audio_files: List[str] = field(default_factory=list)
    background_music: Optional[str] = None
    sound_effects: List[str] = field(default_factory=list)
    audio_merged_file: Optional[str] = None

    # 合成阶段输出
    final_video_path: Optional[str] = None
    status: str = "pending"  # pending, running, completed, failed
    error_message: Optional[str] = None


def _merge_project(left: VideoProject, right: VideoProject) -> VideoProject:
    """LangGraph reducer for shared VideoProject state.

    Parallel planning nodes receive the same project and normally do not
    independently mutate it. Prefer the newest non-empty value while keeping a
    stable fallback if one branch returns an empty payload.
    """
    return right or left


def _message_key(message: Any) -> tuple[str, str]:
    if not isinstance(message, dict):
        return ("", repr(message))
    return (str(message.get("role", "")), str(message.get("content", "")))


def _merge_messages(left: List[Dict[str, Any]], right: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for message in [*(left or []), *(right or [])]:
        key = _message_key(message)
        if key in seen:
            continue
        seen.add(key)
        merged.append(message)
    return merged


def _deep_merge_dict(left: Dict[str, Any], right: Dict[str, Any]) -> Dict[str, Any]:
    result = deepcopy(left or {})
    for key, value in (right or {}).items():
        if isinstance(result.get(key), dict) and isinstance(value, dict):
            result[key] = _deep_merge_dict(result[key], value)
        elif isinstance(result.get(key), list) and isinstance(value, list):
            merged_list = list(result[key])
            for item in value:
                if item not in merged_list:
                    merged_list.append(item)
            result[key] = merged_list
        else:
            result[key] = deepcopy(value)
    return result


def _merge_step(left: str, right: str) -> str:
    return right or left


class AgentState(TypedDict):
    """LangGraph 状态"""
    project: Annotated[VideoProject, _merge_project]
    messages: Annotated[List[Dict[str, Any]], _merge_messages]
    current_step: Annotated[str, _merge_step]
    metadata: Annotated[Dict[str, Any], _deep_merge_dict]
