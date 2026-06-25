"""
LangGraph 工作流定义
使用并行架构 - 所有智能体共享视觉工具
"""

import subprocess
from typing import Any, Dict, Optional, cast

from langgraph.graph import END, StateGraph

from ..execution.animation_agent import AnimationAgent
from ..execution.interactive_agent import InteractiveAgent
from ..execution.matplotlib_agent import MatplotlibAgent
from ..execution.merge_agent import MergeAgent
from ..execution.render_review_repair_agent import RenderReviewRepairAgent
from ..execution.repair_agent import RepairAgent
from ..execution.voice_agent import VoiceAgent
from ..foundation.config import AGENT_CONFIGS, MANIM_CANVAS_CONFIG
from ..foundation.state import AgentState, VideoProject
from ..foundation.state_contracts import wrap_agent_node
from ..perception.vision_agent import VisionAgent
from ..perception.vision_tool import VisionTool
from ..planning.learner_modeling_agent import LearnerModelingAgent
from ..planning.problem_type_pre_planner import ProblemTypePrePlanner
from ..planning.script_agent import ScriptAgent

try:
    from output_paths import DEFAULT_OUTPUT_DIR
except ModuleNotFoundError:
    from anotherme2_engine.output_paths import DEFAULT_OUTPUT_DIR


def _detect_latex_support() -> bool:
    """检测本机是否具备可用的 LaTeX + dvisvgm 环境。"""
    commands = [
        ["latex", "--version"],
        ["dvisvgm", "--version"],
    ]
    for cmd in commands:
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="ignore",
                timeout=10,
            )
        except Exception:
            return False
        if result.returncode != 0:
            return False
    return True


def _model_supports_vision(model_name: str) -> bool:
    """检测模型是否支持图片输入（基于阿里云百炼官方模型列表）。

    官方文档参考：https://help.aliyun.com/zh/model-studio/models
    https://help.aliyun.com/zh/model-studio/user-guide/vision

    Qwen3.6 系列（含 plus/flash）均为多模态模型，支持图像理解。
    Qwen3.7 系列（含 plus/max）均为统一多模态 Agent 模型。
    Qwen3.5-omni-plus 为全模态模型。
    qwen3.5-plus-2026-04-20 在百炼兼容接口中支持图像理解。
    """
    # 不支持视觉的纯文本模型关键词
    _text_only_patterns = [
        "qwen3.5-flash",
        "qwen3.5-plus",
        "qwen2.5",
        "qwen2-",
        "deepseek",
        "glm",
        "minimax",
        "doubao-1.5-pro",
        "doubao-1.5-lite",
    ]
    # 支持视觉的模型关键词
    _vision_patterns = [
        "vl",
        "vision",
        "omni",
        "qwen3.7-plus",
        "qwen3.7-max",
        "qwen3.6-plus",
        "qwen3.6-flash",
        "qwen3.6-",
        "qwen3.5-plus-2026",
        "qwen-vl",
        "doubao-1.5-vision",
    ]
    name = model_name.lower()
    # 明确支持视觉
    for pat in _vision_patterns:
        if pat in name:
            return True
    # 明确不支持视觉
    for pat in _text_only_patterns:
        if pat in name:
            return False
    # 未知模型，默认认为支持（向后兼容）
    return True


def _get_vision_fallback_model(text_model_name: str) -> Optional[str]:
    """为不支持视觉的文本模型选择同 provider 的视觉替代模型。

    注意：qwen3.6-plus / qwen3.6-flash 已支持视觉，不需要 fallback。
    此函数仅对 qwen3.5 及更早的纯文本系列生效。
    """
    name = text_model_name.lower()
    # DashScope (阿里云百炼) 系列
    if "qwen" in name:
        # qwen3.5-plus-2026-04-20 已是视觉模型，无需 fallback
        if name == "qwen3.5-plus-2026-04-20":
            return None
        # qwen3.5 纯文本系列 → qwen3.6-plus（支持视觉的均衡模型）
        if "qwen3.5" in name:
            return "qwen3.6-plus"
        # 其他 qwen 纯文本模型 → qwen-vl-max
        return "qwen-vl-max"
    # 字节跳动 doubao 系列
    if "doubao" in name:
        return "doubao-1.5-vision-pro-250328"
    # 无法确定替代模型
    return None


def _planning_join_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Fan-in node: waits for both learner_modeling and pre_planning to complete."""
    state.setdefault("metadata", {})
    state["current_step"] = "planning_completed"
    state.setdefault("messages", []).append(
        {"role": "assistant", "content": "并行规划完成：学情建模 + 题型预分析"}
    )
    return state


def _route_after_render_review_repair(state: Dict[str, Any]) -> str:
    metadata = state.get("metadata") or {}
    return (
        "animation"
        if str(metadata.get("render_review_next_step", "")).strip() == "animation"
        else "end"
    )


def create_workflow(
    vision_agent: VisionAgent,
    learner_modeling_agent: LearnerModelingAgent,
    script_agent: ScriptAgent,
    animation_agent: AnimationAgent,
    repair_agent: RepairAgent,
    render_review_repair_agent: RenderReviewRepairAgent,
    voice_agent: VoiceAgent,
    merge_agent: MergeAgent,
    vision_tool: VisionTool,
    problem_type_pre_planner: Optional[ProblemTypePrePlanner] = None,
    matplotlib_agent: Optional[MatplotlibAgent] = None,
    interactive_agent: Optional[InteractiveAgent] = None,
    render_mode: str = "video",
) -> Any:
    """
    创建 LangGraph 工作流

    render_mode="video"（默认）：
    1. Vision → [Learner, PrePlanning] → Join → Script → Voice → Animation → Repair → Merge → END

    render_mode="matplotlib"：
    1. Vision → [Learner, PrePlanning] → Join → Script → MatplotlibRender → END

    render_mode="interactive"：
    1. Vision → [Learner, PrePlanning] → Join → Script → InteractiveRender → END
    """
    builder = StateGraph(AgentState)

    # 添加节点
    builder.add_node(
        "vision", cast(Any, wrap_agent_node("vision", vision_agent.process))
    )
    builder.add_node(
        "learner_modeling",
        cast(Any, wrap_agent_node("learner_modeling", learner_modeling_agent.process)),
    )
    builder.add_node(
        "script", cast(Any, wrap_agent_node("script", script_agent.process))
    )

    # 并行规划节点
    if problem_type_pre_planner is not None:
        builder.add_node(
            "pre_planning",
            cast(
                Any, wrap_agent_node("pre_planning", problem_type_pre_planner.process)
            ),
        )
        builder.add_node("planning_join", cast(Any, _planning_join_node))

    # 设置入口
    builder.set_entry_point("vision")

    # 构建边 — 前半段（共用）
    if problem_type_pre_planner is not None:
        builder.add_edge("vision", "learner_modeling")
        builder.add_edge("vision", "pre_planning")
        builder.add_edge("learner_modeling", "planning_join")
        builder.add_edge("pre_planning", "planning_join")
        builder.add_edge("planning_join", "script")
    else:
        builder.add_edge("vision", "learner_modeling")
        builder.add_edge("learner_modeling", "script")

    if render_mode == "matplotlib" and matplotlib_agent is not None:
        # Matplotlib 模式：script 之后直接渲染图片
        builder.add_node(
            "matplotlib_render",
            cast(Any, wrap_agent_node("matplotlib_render", matplotlib_agent.process)),
        )
        builder.add_edge("script", "matplotlib_render")
        builder.add_edge("matplotlib_render", END)
    elif render_mode == "interactive" and interactive_agent is not None:
        # 交互模式：script 之后直接生成前端几何包和自包含 HTML
        builder.add_node(
            "interactive_render",
            cast(Any, wrap_agent_node("interactive_render", interactive_agent.process)),
        )
        builder.add_edge("script", "interactive_render")
        builder.add_edge("interactive_render", END)
    else:
        # 视频模式：voice → animation → repair → merge
        builder.add_node(
            "animation",
            cast(Any, wrap_agent_node("animation", animation_agent.process)),
        )
        builder.add_node(
            "repair", cast(Any, wrap_agent_node("repair", repair_agent.process))
        )
        builder.add_node(
            "voice", cast(Any, wrap_agent_node("voice", voice_agent.process))
        )
        builder.add_node(
            "merge", cast(Any, wrap_agent_node("merge", merge_agent.process))
        )
        builder.add_node(
            "render_review_repair",
            cast(
                Any,
                wrap_agent_node(
                    "render_review_repair", render_review_repair_agent.process
                ),
            ),
        )

        builder.add_edge("script", "voice")
        builder.add_edge("voice", "animation")
        builder.add_edge("animation", "repair")
        builder.add_edge("repair", "merge")
        builder.add_edge("merge", "render_review_repair")
        builder.add_conditional_edges(
            "render_review_repair",
            cast(Any, _route_after_render_review_repair),
            {
                "animation": "animation",
                "end": END,
            },
        )

    workflow = builder.compile()
    return workflow


def create_default_workflow(
    llm_config: Dict[str, Any],
    vision_llm_config: Optional[Dict[str, Any]] = None,
    ocr_llm_config: Optional[Dict[str, Any]] = None,
    output_dir: str = str(DEFAULT_OUTPUT_DIR),
    export_ggb: bool = True,
    render_mode: str = "video",
) -> Any:
    """
    创建默认工作流

    所有智能体共享同一个 VisionTool，可以直接分析原图
    """
    from langchain_openai import ChatOpenAI

    chat_openai_cls: Any = ChatOpenAI

    # Validate model configs early — ChatOpenAI/OpenAI SDK throws confusing
    # provider-level errors when api_key/base_url/model are empty.
    for role, cfg in [
        ("文本模型", llm_config),
        ("视觉模型", vision_llm_config or llm_config),
        ("OCR模型", ocr_llm_config or vision_llm_config or llm_config),
    ]:
        api_key = cfg.get("api_key", "") if cfg else ""
        model = cfg.get("model", "") if cfg else ""
        base_url = cfg.get("base_url", "") if cfg else ""
        missing = []
        if not api_key:
            missing.append("API Key")
        if not base_url:
            missing.append("Base URL")
        if not model:
            missing.append("Model")
        if missing:
            raise ValueError(
                f"{role}配置不完整（缺少: {', '.join(missing)}，model={model}, base_url={base_url}）。"
                f"请在设置页面配置对应模型，或在服务端配置该 provider。"
            )

    if vision_llm_config is None:
        vision_llm_config = llm_config

    # 自动检测：如果视觉模型不支持视觉输入，切换到同 provider 的视觉模型
    vision_model_name = str(vision_llm_config.get("model", "")).lower()
    if vision_model_name and not _model_supports_vision(vision_model_name):
        fallback_vision = _get_vision_fallback_model(vision_model_name)
        if fallback_vision:
            print(
                f"[workflow] 视觉模型 {vision_model_name} 不支持图片输入，自动切换到 {fallback_vision}"
            )
            vision_llm_config = {**vision_llm_config, "model": fallback_vision}

    if ocr_llm_config is None:
        ocr_llm_config = vision_llm_config

    latex_ready = _detect_latex_support()

    print(f"[workflow] create_default_workflow: render_mode={render_mode}")

    # 创建文本 LLM（供 ScriptAgent / VoiceAgent / MergeAgent 使用）
    # DashScope thinking 模型（如 qwen3.5-plus / qwen3.7-plus）支持思考模式。
    # 策略：启用 thinking + 设置 thinking_budget 限制思考 token + 增大 max_tokens。
    # 公式：max_tokens = thinking_budget + 内容输出所需 tokens
    _is_thinking_model = "qwen3" in str(llm_config.get("model", "")).lower()

    # thinking_budget：限制思考过程的最大 token 数，防止耗尽 max_tokens
    # 可通过配置 thinking_budget 参数调整，默认 8192
    _thinking_budget = int(llm_config.get("thinking_budget", 8192))

    # 各 agent 的内容输出 token 需求
    _text_content_tokens = int(
        llm_config.get("max_tokens", 4096)
    )  # ScriptAgent/VoiceAgent
    _anim_content_tokens = 16384  # AnimationAgent 需要更大窗口

    def _build_extra_body(enable_thinking: bool, budget: int) -> Dict[str, Any]:
        """构建 thinking 模型的 extra_body 参数。"""
        if not _is_thinking_model:
            return {}
        if not enable_thinking:
            return {"enable_thinking": False}
        return {
            "enable_thinking": True,
            "thinking_budget": budget,
        }

    # 文本 LLM：启用 thinking，thinking_budget 限制思考 token
    _text_extra_body = _build_extra_body(True, _thinking_budget)
    _text_max_tokens = (
        _thinking_budget + _text_content_tokens
        if _is_thinking_model
        else _text_content_tokens
    )

    llm = chat_openai_cls(
        api_key=llm_config.get("api_key", ""),
        base_url=llm_config.get("base_url", ""),
        model=llm_config.get("model", ""),
        temperature=llm_config.get("temperature", 0.1),
        model_kwargs={"max_tokens": _text_max_tokens},
        extra_body=_text_extra_body or None,
    )

    # AnimationAgent 需要更大的 token 窗口来输出完整代码
    _anim_extra_body = _build_extra_body(True, _thinking_budget)
    _anim_max_tokens = (
        _thinking_budget + _anim_content_tokens
        if _is_thinking_model
        else _anim_content_tokens
    )

    animation_llm = chat_openai_cls(
        api_key=llm_config.get("api_key", ""),
        base_url=llm_config.get("base_url", ""),
        model=llm_config.get("model", ""),
        temperature=0.05,
        model_kwargs={"max_tokens": _anim_max_tokens},
        extra_body=_anim_extra_body or None,
    )

    # 创建视觉工具（共享给所有需要图像分析的智能体）
    vision_tool = VisionTool(
        {
            **vision_llm_config,
            "max_retries": 5,
            "retry_backoff_seconds": 10.0,
        },
        ocr_llm_config={
            **ocr_llm_config,
            "max_retries": 5,
            "retry_backoff_seconds": 10.0,
        },
    )

    # VisionAgent 使用视觉模型直接生成 OCR 与 Scene Graph
    # 视觉模型同样支持 thinking + thinking_budget
    _vision_is_thinking = "qwen3" in str(vision_llm_config.get("model", "")).lower()
    _vision_thinking_budget = int(
        vision_llm_config.get("thinking_budget", _thinking_budget)
    )
    _vision_content_tokens = int(vision_llm_config.get("max_tokens", 4096))
    _vision_extra_body = (
        _build_extra_body(True, _vision_thinking_budget) if _vision_is_thinking else {}
    )
    _vision_max_tokens = (
        _vision_thinking_budget + _vision_content_tokens
        if _vision_is_thinking
        else _vision_content_tokens
    )

    _ocr_is_thinking = "qwen3" in str(ocr_llm_config.get("model", "")).lower()
    _ocr_thinking_budget = int(ocr_llm_config.get("thinking_budget", _thinking_budget))
    _ocr_content_tokens = int(ocr_llm_config.get("max_tokens", 4096))
    _ocr_extra_body = (
        _build_extra_body(True, _ocr_thinking_budget) if _ocr_is_thinking else {}
    )
    _ocr_max_tokens = (
        _ocr_thinking_budget + _ocr_content_tokens
        if _ocr_is_thinking
        else _ocr_content_tokens
    )

    vision_llm = chat_openai_cls(
        api_key=vision_llm_config.get("api_key", ""),
        base_url=vision_llm_config.get("base_url", ""),
        model=vision_llm_config.get("model", ""),
        temperature=vision_llm_config.get("temperature", 0.05),
        model_kwargs={"max_tokens": _vision_max_tokens},
        extra_body=_vision_extra_body or None,
    )
    ocr_vision_llm = chat_openai_cls(
        api_key=ocr_llm_config.get("api_key", ""),
        base_url=ocr_llm_config.get("base_url", ""),
        model=ocr_llm_config.get("model", ""),
        temperature=ocr_llm_config.get("temperature", 0.0),
        model_kwargs={"max_tokens": _ocr_max_tokens},
        extra_body=_ocr_extra_body or None,
    )

    vision_agent = VisionAgent(
        config={
            "temperature": 0.05,
            "output_dir": output_dir,
            "export_ggb": export_ggb,
            "max_retries": 5,
            "retry_backoff_seconds": 10.0,
            "ocr_engine": ocr_llm_config.get("ocr_engine", "llm")
            if ocr_llm_config
            else "llm",
        },
        llm=vision_llm,
        ocr_llm=ocr_vision_llm,
    )

    # 创建智能体 - 都注入 vision_tool，可以按需调用
    learner_modeling_agent = LearnerModelingAgent(
        config={
            "temperature": 0.0,
        },
        llm=None,
    )

    # ScriptAgent 需要输出包含 steps 数组的大型 JSON，需要更大的 token 窗口
    _script_content_tokens = 16384
    _script_max_tokens = (
        _thinking_budget + _script_content_tokens
        if _is_thinking_model
        else _script_content_tokens
    )

    script_llm = chat_openai_cls(
        api_key=llm_config.get("api_key", ""),
        base_url=llm_config.get("base_url", ""),
        model=llm_config.get("model", ""),
        temperature=0.1,
        model_kwargs={"max_tokens": _script_max_tokens},
        extra_body=_text_extra_body or None,
    )

    script_agent = ScriptAgent(
        config={"temperature": 0.1, "output_dir": output_dir},
        llm=script_llm,
        vision_tool=vision_tool,
    )

    animation_agent = AnimationAgent(
        config={
            "temperature": 0.05,
            "max_tokens": 16384,
            "canvas_config": {
                **MANIM_CANVAS_CONFIG,
                "prefer_mathtex": latex_ready,
                "formula_math_font_size": 24,
                "formula_text_font_size": 24,
            },
            "layout": "left_graph_right_formula",
            "output_dir": output_dir,
        },
        llm=animation_llm,
        vision_tool=vision_tool,
    )

    voice_agent = VoiceAgent(
        config={
            "temperature": 0.05,
            "output_dir": output_dir,
            **AGENT_CONFIGS.get("voice", {}),
        },
        llm=llm,
        vision_tool=vision_tool,
    )

    repair_agent = RepairAgent(
        config={
            "temperature": 0.0,
            "use_llm_repair": False,
        },
        llm=llm,
    )

    render_review_repair_agent = RenderReviewRepairAgent(
        config={
            "temperature": 0.0,
            "max_render_review_rounds": 1,
        },
        llm=None,
    )

    merge_agent = MergeAgent(
        config={
            "temperature": 0.05,
            "output_dir": output_dir,
            "canvas_config": MANIM_CANVAS_CONFIG,
            "layout": "left_graph_right_formula",
            "manim_quality": "-ql",
            "render_timeout": 900,
            "max_repair_rounds": 3,
            "auto_render_review_repair": True,
            "max_render_review_rounds": 1,
        },
        llm=llm,
        vision_tool=vision_tool,
    )

    problem_type_pre_planner = ProblemTypePrePlanner()

    # Matplotlib 可视化智能体（仅在 matplotlib 模式下使用）
    matplotlib_agent = (
        MatplotlibAgent(
            config={
                "temperature": 0.1,
                "output_dir": output_dir,
            },
            llm=llm,
        )
        if render_mode == "matplotlib"
        else None
    )

    interactive_agent = (
        InteractiveAgent(
            config={
                "temperature": 0.0,
                "output_dir": output_dir,
            },
            llm=None,
        )
        if render_mode == "interactive"
        else None
    )

    workflow = create_workflow(
        vision_agent=vision_agent,
        learner_modeling_agent=learner_modeling_agent,
        script_agent=script_agent,
        animation_agent=animation_agent,
        repair_agent=repair_agent,
        render_review_repair_agent=render_review_repair_agent,
        voice_agent=voice_agent,
        merge_agent=merge_agent,
        vision_tool=vision_tool,
        problem_type_pre_planner=problem_type_pre_planner,
        matplotlib_agent=matplotlib_agent,
        interactive_agent=interactive_agent,
        render_mode=render_mode,
    )

    return workflow
