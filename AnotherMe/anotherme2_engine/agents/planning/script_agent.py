"""
脚本智能体 - 负责生成解题视频的脚本
优先消费稳定的 GeometryIR / Scene Draft，再兼容旧场景层。
"""
import json
import re
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple
from langchain_core.messages import HumanMessage, SystemMessage

from ..foundation.base_agent import BaseAgent
from ..foundation.state import ScriptStep, VideoProject
from ..perception.geometry_context import GeometryContext
from ..perception.vision_tool import VisionTool


class ScriptAgent(BaseAgent):
    """脚本智能体"""

    PUBLIC_THINKING_RE = re.compile(
        r"(<\s*/?\s*think\s*>|reasoning_content|chain\s+of\s+thought|scratchpad|inner\s+monologue|"
        # 纠错类
        r"不[,，]?\s*我再想想|我再想想|让我想|等一下|等等[,，]?\s*不|不对|算错|重新想|"
        r"推理草稿|思考过程|草稿|先试一下|推翻|刚才[^。！？]*错|再来一遍|"
        r"错了|搞错了|弄错了|搞错了|重新来|再算一次|换个思路|重新计算|"
        r"不不不|等等等等|稍等|稍等一下|"
        # 犹豫/不确定类
        r"嗯[，,。.]|这个[，,。.]|让我看看|我想想|"
        r"我觉得这样|可能是这样|应该是这样|大概是|"
        # 英文 thinking 标记
        r"\bwait\b|\blet me think\b|\bhold on\b|\bactually\b|\bcorrection\b|\bwrong\b|\bretry\b)",
        re.IGNORECASE,
    )
    CONCLUSIVE_SOLUTION_RE = re.compile(
        r"(答案|所以|因此|故|可得|得到|结论|得证|选\s*[A-D]|最终|=)"
    )

    SYSTEM_PROMPT = """你是一个专业的教育视频脚本作家，专门制作数学解题视频。

你的任务是根据数学题目（文字 + 图片分析），生成详细的视频脚本。

输出格式必须是严格的 JSON：
{
    "final_answer": "最终答案或最终结论，必须先算对再填写；证明题写最终要证结论",
    "answer_verification": {
        "status": "verified",
        "method": "用一句话说明如何复核答案，例如代回已知条件/面积关系/选项检验",
        "checks": ["复核点1", "复核点2"]
    },
    "steps": [
        {
            "id": 1,
            "title": "步骤标题",
            "duration": 5.0,
            "narration": "旁白文案",
            "visual_cues": ["视觉元素 1", "视觉元素 2"],
            "on_screen_texts": [
                {
                    "text": "屏幕上展示的文字（可为描述性文字或公式）",
                    "kind": "description",
                    "target_area": "formula_area"
                }
            ],
            "spoken_formulas": ["AB=BC"],
            "visible_segments": ["AB", "BC", "DE"],
            "required_actions": [
                {"type": "show_segment", "target": "DE"},
                {"type": "highlight_segment", "target": "DE"}
            ],
            "auxiliary_line_actions": [
                {
                    "action": "draw_perpendicular_auxiliary",
                    "from": "P",
                    "to_line": "seg_AB",
                    "foot": "H",
                    "reason": "point_to_line_distance",
                    "persist": "until_step_end"
                }
            ],
            "animation_policy": "auto"
        }
    ],
    "total_duration": 30.0
}

【公开输出安全要求 - 重要】：
- 先在内部完成解题和复核，再输出 JSON；JSON 中只能包含最终确定的讲解脚本。
- 禁止在 title、narration、visual_cues、on_screen_texts 中出现思考草稿、自我纠错或犹豫语句，例如”我再想想””不对””算错了””先试一下””可能不对””草稿””嗯””这个””等等””让我看看””我觉得””可能是””应该是””搞错了””重新来””换个思路”。
- 禁止出现英文思考标记，如 “wait”、”let me think”、”hold on”、”actually”、”correction”、”wrong”、”retry”。
- 如果发现前一步推理不成立，必须在输出 JSON 前修正；不要把修正过程写入步骤。
- final_answer 与 answer_verification 必须反映最终确认后的答案；不要输出未验证答案。
- 每个步骤的 narration 必须是完整的、可直接朗读的文案，不能是碎片化的思考记录。

【辅助线动作规范 - 重要】：
当解题需要添加辅助线时，必须在 auxiliary_line_actions 中明确指定，不要只写在 visual_cues 里。

支持的辅助线类型：
1. draw_perpendicular_auxiliary - 作垂线
   必填字段：from（起点）, to_line（目标线段）, foot（垂足）, reason
   适用场景：求点到直线距离、构造高线、证明垂直关系

2. draw_connection_auxiliary - 连接两点
   必填字段：from（起点）, to（终点）, reason
   适用场景：构造三角形、连接关键点、证明全等/相似

3. connect_center_tangent - 连接圆心与切点
   必填字段：from（圆心）, to（切点）, reason
   适用场景：切线问题、证明半径垂直切线

4. draw_parallel_auxiliary - 作平行线
   必填字段：from（经过的点）, to_line（平行于哪条线）, reason
   适用场景：平行线分线段成比例、相似三角形

5. extend_segment - 延长线段
   必填字段：segment（线段ID）, from_endpoint（从哪个端点延长）, length_factor（延长倍数）, reason
   适用场景：构造全等三角形、补全图形

persist 字段说明：
- "until_step_end"：辅助线在本步骤结束后淡出（临时辅助线）
- "until_video_end"：辅助线持续到视频结束（重要构造线）

reason 字段示例：
- "point_to_line_distance"：点到直线距离
- "construct_altitude"：构造高线
- "prove_congruent"：证明全等
- "prove_similar"：证明相似
- "tangent_radius"：切线半径关系
- "fold_image_distance"：折叠问题像点距离"""

    def __init__(self, config: Dict[str, Any], llm: Optional[Any] = None,
                 vision_tool: Optional[VisionTool] = None):
        super().__init__(config, llm)
        self.system_prompt = config.get("system_prompt", self.SYSTEM_PROMPT)
        self.vision_tool = vision_tool
        self.duration_profiles = config.get("duration_profiles", {
            "simple": {"target": 65.0, "max": 85.0, "max_steps": 5, "max_narration_chars": 80},
            "standard": {"target": 90.0, "max": 120.0, "max_steps": 6, "max_narration_chars": 95},
            "complex": {"target": 130.0, "max": 165.0, "max_steps": 8, "max_narration_chars": 115},
        })

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """
        处理状态，生成脚本
        直接使用视觉工具分析图片
        """
        print("\n[ScriptAgent] 开始生成脚本...")

        project = state["project"]
        if getattr(project, "status", "") == "failed":
            return state
        problem_text = project.problem_text
        image_path = project.problem_image

        print(f"[ScriptAgent] 题目文字：{problem_text[:50] if problem_text else '无'}...")
        print(f"[ScriptAgent] 图片路径：{image_path}")

        # 构建提示词：优先使用稳定的 GeometryIR / Scene Draft，旧图层仅作兼容参考
        metadata = state.get("metadata", {})
        geometry_prompt_context = self._build_geometry_prompt_context(
            metadata,
            problem_text=problem_text,
        )
        adaptive_plan = metadata.get("adaptive_plan") if isinstance(metadata.get("adaptive_plan"), dict) else {}
        learner_profile = metadata.get("learner_profile") if isinstance(metadata.get("learner_profile"), dict) else {}
        problem_constraints = metadata.get("problem_constraints") if isinstance(metadata.get("problem_constraints"), dict) else {}

        scene_draft_text = geometry_prompt_context["scene_draft_text"]
        stable_geometry_text = geometry_prompt_context["stable_geometry_text"]
        fallback_geometry_text = geometry_prompt_context["fallback_geometry_text"]
        known_entities_text = ", ".join(geometry_prompt_context["known_entities"])
        adaptive_prompt = self._build_adaptive_prompt(adaptive_plan, learner_profile)

        # 回退路径：若结构化信息缺失，再调用视觉描述
        geometry_info = ""
        if not geometry_prompt_context["has_stable_visual_context"] and image_path and self.vision_tool:
            geometry_info = self.vision_tool.describe_geometry(image_path)

        if (
            scene_draft_text
            or stable_geometry_text
            or fallback_geometry_text
            or geometry_info
        ):
            geometry_sections = []
            if scene_draft_text:
                geometry_sections.append(
                    "Scene Draft（视觉锚点层，不是最终绘图坐标）：\n"
                    f"{scene_draft_text}"
                )
            if stable_geometry_text:
                geometry_sections.append(
                    "Stable GeometryIR Summary（脚本阶段唯一事实层，优先于旧 scene）：\n"
                    f"{stable_geometry_text}"
                )
            if fallback_geometry_text:
                geometry_sections.append(
                    "Fallback Geometry Context（仅当稳定几何上下文不足时参考，不能覆盖 Stable GeometryIR）：\n"
                    f"{fallback_geometry_text}"
                )
            if geometry_info:
                geometry_sections.append(
                    "图形文字描述（仅兜底参考）：\n"
                    f"{geometry_info}"
                )
            geometry_block = "\n\n".join(section for section in geometry_sections if section)
            user_prompt = f"""请为以下数学题目生成视频脚本：

题目文字：{problem_text}

{geometry_block}

请生成详细的视频脚本，包括解题步骤、旁白文案、视觉描述和屏幕展示文字。
要求：步骤中的视觉变化应围绕同一题图对象逐步推进，不要每一步都把整图重画。
当前已知可引用实体：{known_entities_text}"""
        else:
            user_prompt = f"""请为以下数学题目生成视频脚本：

题目：{problem_text}

请生成详细的视频脚本。"""

        if adaptive_prompt:
            user_prompt += f"""

    学情自适应策略（必须执行）：
    {adaptive_prompt}"""

        duration_policy = self._build_duration_policy(adaptive_plan, problem_constraints)
        duration_prompt = self._build_duration_policy_prompt(duration_policy)
        if duration_prompt:
            user_prompt += f"""

    视频节奏策略（必须执行）：
    {duration_prompt}"""

        constraints_prompt = self._build_problem_constraints_prompt(problem_constraints)
        if constraints_prompt:
            user_prompt += f"""

    题型预分析约束（必须遵守）：
    {constraints_prompt}"""

        user_prompt += """

额外强约束：
1) 输出必须是严格 JSON，不要附加解释。
2) 每个步骤都要同时提供 narration（音频讲解）和 on_screen_texts（动画展示文字）。
3) on_screen_texts 中允许描述性文字，不仅是公式。
4) target_area 可用值：formula_area、geometry_area；默认使用 formula_area。
5) on_screen_texts 是右侧公式推导区的数据源，每步建议 3-6 条，必须按展示顺序排列。
   - formula_area 推荐结构：1 条步骤标题/目标 + 1 条操作或依据说明 + 2-4 条关键公式/推导 + 必要时 1 条结论。
   - 标题示例：“第1步：先确定已知关系”；说明示例：“由正方形可得边相等且垂直”；公式示例：“AB = BC”“AB ⊥ BC”“∠EHD = 90°”。
   - kind 应尽量使用 title、description、formula、conclusion；target_area 默认 formula_area。
   - 禁止只写“已知”“求证”“结论”这类无信息占位词；必须带出具体对象、公式或依据。
   - 描述性文字不要复述整段旁白，通常控制在 8-28 个中文字符；公式可保留完整推导链。
   - 不要把多个等价公式重复上屏；同一步只保留最能推进解题的公式。
5.1) 直接开始讲题，不要写“先分析你的学情/你没掌握某知识点/下面复习前置知识”这类独立学情段。
6) 不要发明题图中不存在的新点、新线、新圆或新辅助对象；若确实需要构造新对象，必须在 narration 和 visual_cues 中明确写出"作.../构造..."。
7) spoken_formulas 要覆盖本步音频里提到且应上屏的公式（可为空数组）。
8) visible_segments 只写当前步骤允许显示的线段（如 AB、DE；可为空数组）。
9) required_actions 是本步必须执行的几何动作（可为空数组）；animation_policy 可选 auto/required/none。
10) 【辅助线规范】当解题需要添加辅助线时，必须在 auxiliary_line_actions 中明确指定：
    - 必填字段：action, reason
    - 垂线：from, to_line, foot
    - 连线：from, to
    - 圆心切点：from（圆心）, to（切点）
    - persist 可选值：until_step_end（临时）, until_video_end（持久）
    - 不要只把辅助线写在 visual_cues 里，必须结构化声明
11) 必须先给出 final_answer 和 answer_verification；只有确认解法后，才生成 steps。"""

        # 调用 LLM（带重试机制）
        messages = self._format_messages(
            system_prompt=self.system_prompt,
            user_prompt=user_prompt
        )

        max_attempts = 3  # 最多重试 3 次
        script_data = None
        script_steps = []
        public_quality = {}
        degraded = False

        for attempt in range(max_attempts):
            try:
                response_content = self._invoke_llm(messages)
            except Exception as e:
                print(f"[ScriptAgent] LLM 调用失败 (attempt {attempt + 1}): {type(e).__name__}: {e}")
                if attempt >= max_attempts - 1:
                    raise
                continue

            # 解析 JSON 响应
            script_data = self._parse_json_response(response_content)

            # 转换为 ScriptStep 对象
            script_steps = []
            for step_data in script_data.get("steps", []):
                on_screen_texts = self._normalize_on_screen_texts(step_data.get("on_screen_texts", []))
                spoken_formulas = self._normalize_spoken_formulas(
                    step_data.get("spoken_formulas", []),
                    on_screen_texts=on_screen_texts,
                    narration=step_data.get("narration", ""),
                    visual_cues=step_data.get("visual_cues", []),
                    title=step_data.get("title", ""),
                )
                visible_segments = self._normalize_visible_segments(
                    step_data.get("visible_segments", []),
                    narration=step_data.get("narration", ""),
                    visual_cues=step_data.get("visual_cues", []),
                    title=step_data.get("title", ""),
                )
                required_actions = self._normalize_required_actions(step_data.get("required_actions", []))
                animation_policy = self._normalize_animation_policy(step_data.get("animation_policy", "auto"))
                auxiliary_line_actions = self._normalize_auxiliary_line_actions(step_data.get("auxiliary_line_actions", []))
                step = ScriptStep(
                    id=step_data["id"],
                    title=step_data["title"],
                    duration=step_data["duration"],
                    narration=step_data["narration"],
                    visual_cues=step_data.get("visual_cues", []),
                    on_screen_texts=on_screen_texts,
                    spoken_formulas=spoken_formulas,
                    visible_segments=visible_segments,
                    required_actions=required_actions,
                    auxiliary_line_actions=auxiliary_line_actions,
                    animation_policy=animation_policy,
                )
                script_steps.append(step)

            script_steps = self._postprocess_script_steps(script_steps)
            script_steps = self._apply_duration_policy(script_steps, duration_policy)
            script_steps, public_quality = self._prepare_public_script_steps(script_data, script_steps)

            # 质量检查通过，直接使用
            if public_quality.get("publishable"):
                break

            # 检测到 thinking 内容泄漏，重试
            violations = public_quality.get("violations", [])
            has_thinking_violations = any(
                "thinking" in str(v.get("reason", "")).lower()
                or "thinking" in str(v.get("marker", "")).lower()
                for v in violations
            )

            if has_thinking_violations and attempt < max_attempts - 1:
                print(f"[ScriptAgent] 检测到 thinking 内容泄漏 (attempt {attempt + 1})，重试...")
                # 在 prompt 末尾追加更强的约束
                messages = self._format_messages(
                    system_prompt=self.system_prompt,
                    user_prompt=user_prompt + "\n\n【特别警告】上一次输出包含了思考过程标记，被系统拒绝。"
                    "请严格遵守公开输出安全要求，绝对不能在 JSON 中包含任何思考、纠错、犹豫内容。"
                    "只输出最终确定的、完整的讲解脚本。"
                )
                continue

            # 非 thinking 相关的失败，不重试
            break

        # 如果重试后仍不通过，尝试降级使用清理后的版本
        if not public_quality.get("publishable"):
            # 检查是否有足够的清理后内容可用
            usable_steps = [
                s for s in script_steps
                if str(getattr(s, "narration", "") or "").strip()
            ]
            if usable_steps and script_data and script_data.get("steps"):
                print("[ScriptAgent] 质量检查未通过，降级使用清理后的版本")
                degraded = True
                public_quality["degraded"] = True
                public_quality["degrade_reason"] = public_quality.get("reason", "quality check failed")
            else:
                # 无法降级，报错
                metadata["script_publication_quality"] = public_quality
                self._write_script_quality_report(public_quality)
                raise ValueError(public_quality.get("reason") or "Script generation failed after retries.")

        # 更新项目状态
        project.script_steps = script_steps
        project.total_duration = self._estimate_script_duration(script_steps, script_data.get("total_duration", 0.0))
        metadata["video_duration_policy"] = duration_policy
        metadata["script_publication_quality"] = public_quality

        # 写入中间结果文件，供主进程轮询后提前展示给用户
        # 降级模式下也写入（标记 degraded，前端可据此提示用户）
        output_dir = self.config.get("output_dir")
        if output_dir:
            try:
                intermediate_dir = Path(output_dir) / "intermediate"
                intermediate_dir.mkdir(parents=True, exist_ok=True)
                (intermediate_dir / "script_steps_quality.json").write_text(
                    json.dumps(public_quality, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                # publishable 或 degraded 都写入中间结果
                if public_quality.get("publishable") or degraded:
                    steps_data = [
                        {
                            "id": s.id,
                            "title": s.title,
                            "narration": s.narration,
                            "spoken_formulas": getattr(s, "spoken_formulas", []) or [],
                            "on_screen_texts": getattr(s, "on_screen_texts", []) or [],
                            "visual_cues": getattr(s, "visual_cues", []) or [],
                        }
                        for s in script_steps
                    ]
                    result_payload = {
                        "steps": steps_data,
                        "total_duration": project.total_duration,
                    }
                    if degraded:
                        result_payload["degraded"] = True
                        result_payload["degrade_reason"] = public_quality.get("degrade_reason", "")
                    (intermediate_dir / "script_steps.json").write_text(
                        json.dumps(result_payload, ensure_ascii=False),
                        encoding="utf-8",
                    )
                    mode_label = "降级" if degraded else ""
                    print(f"[ScriptAgent] 已写入中间结果{mode_label}: {len(steps_data)} 个步骤")
                else:
                    print(
                        "[ScriptAgent] 中间解题步骤未发布: "
                        f"{public_quality.get('reason') or 'script is not publishable'}"
                    )
            except Exception as exc:
                print(f"[ScriptAgent] 写入中间结果失败: {exc}")

        state["project"] = project
        state["current_step"] = "script_completed"
        status_label = "（降级模式）" if degraded else ""
        state["messages"].append({
            "role": "assistant",
            "content": f"脚本生成完成{status_label}，共 {len(script_steps)} 个步骤"
        })

        return state

    def _write_script_quality_report(self, public_quality: Dict[str, Any]) -> None:
        output_dir = self.config.get("output_dir")
        if not output_dir:
            return
        try:
            intermediate_dir = Path(output_dir) / "intermediate"
            intermediate_dir.mkdir(parents=True, exist_ok=True)
            (intermediate_dir / "script_steps_quality.json").write_text(
                json.dumps(public_quality, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as exc:
            print(f"[ScriptAgent] 写入中间质量报告失败: {exc}")

    def _build_adaptive_prompt(self, adaptive_plan: Dict[str, Any], learner_profile: Dict[str, Any]) -> str:
        if not adaptive_plan:
            return ""

        mode = str(adaptive_plan.get("mode", "standard") or "standard")
        skip_basic = bool(adaptive_plan.get("skip_basic_definition", False))
        inject_challenge = bool(adaptive_plan.get("inject_challenge_variant", False))
        analogy_mode = bool(adaptive_plan.get("analogy_mode", False))
        analogy_domain = str(adaptive_plan.get("analogy_domain", "") or "").strip()

        weak_points: List[str] = []
        for item in adaptive_plan.get("review_points", []) or []:
            if not isinstance(item, dict):
                continue
            kp = str(item.get("knowledge", "")).strip()
            if kp:
                weak_points.append(kp)

        learner_grade = learner_profile.get("grade", "unknown")
        required_mastery_avg = self._safe_float(adaptive_plan.get("required_mastery_avg", 0.5), 0.5)
        prerequisite_mastery_avg = self._safe_float(adaptive_plan.get("prerequisite_mastery_avg", 0.5), 0.5)

        lines = [
            f"- 当前模式: {mode}",
            f"- 学生年级: {learner_grade}",
            f"- 目标知识平均掌握度: {required_mastery_avg:.2f}",
            f"- 前置知识平均掌握度: {prerequisite_mastery_avg:.2f}",
        ]

        if weak_points:
            lines.append(f"- 优先补齐薄弱点: {', '.join(weak_points)}")

        if mode == "remedial":
            lines.append("- 不要单独插入前置复习段；把薄弱点用一句话自然放进对应解题步骤")
            lines.append("- 每步旁白短句表达，关键结论只在必要处强调一次")
            lines.append("- visual_cues 中加入明确视觉支架提示，例如：高亮辅助线/关键点闪烁/步骤编号")
        elif mode == "advanced":
            lines.append("- 跳过基础定义，直接进入解题结构、变式与迁移")
            lines.append("- 至少追加一个思维拔高点或反例提醒")
        else:
            lines.append("- 保持标准讲解节奏，关键步骤保留必要解释")

        if skip_basic:
            lines.append("- 避免重复基础概念定义")
        if inject_challenge:
            lines.append("- 在结尾加入一个简短变式挑战")

        if analogy_mode and analogy_domain:
            lines.append(f"- 优先采用 {analogy_domain} 类比来解释数学关系（不改变数学严谨性）")

        step_lines = self._build_step_personalization_prompt(adaptive_plan.get("step_personalization"))
        if step_lines:
            lines.extend(step_lines)

        return "\n".join(lines)

    def _build_step_personalization_prompt(self, step_personalization: Any) -> List[str]:
        if not isinstance(step_personalization, dict):
            return []

        standard_steps = step_personalization.get("standardSteps")
        step_decisions = step_personalization.get("stepDecisions")
        if not isinstance(standard_steps, list) or not isinstance(step_decisions, list):
            return []

        decisions_by_id = {
            str(item.get("stepId", "")).strip(): item
            for item in step_decisions
            if isinstance(item, dict) and str(item.get("stepId", "")).strip()
        }
        lines = [
            "- 步骤级个性化必须执行：按下列标准解题步骤生成脚本；高风险步骤展开，低风险步骤略讲或变式引导。"
        ]

        for index, raw_step in enumerate(standard_steps[:8], start=1):
            if not isinstance(raw_step, dict):
                continue
            step_id = str(raw_step.get("id", "")).strip()
            decision = decisions_by_id.get(step_id, {})
            title = str(raw_step.get("title", "") or f"步骤{index}").strip()
            knowledge_points = raw_step.get("knowledgePointIds")
            knowledge_text = "、".join(str(point).strip() for point in knowledge_points if str(point).strip()) if isinstance(knowledge_points, list) else ""
            mastery = self._safe_float(decision.get("mastery", 0.5), 0.5) if isinstance(decision, dict) else 0.5
            risk = str(decision.get("riskLevel", "medium") if isinstance(decision, dict) else "medium").strip()
            strategy = str(decision.get("expansionStrategy", "guided_hint") if isinstance(decision, dict) else "guided_hint").strip()
            likely_stuck = bool(decision.get("likelyStuck", False)) if isinstance(decision, dict) else False
            stuck_text = "，预测卡点" if likely_stuck else ""
            lines.append(
                f"  {index}. {title}：知识点={knowledge_text or '未标注'}，掌握度={mastery:.2f}，风险={risk}，策略={strategy}{stuck_text}"
            )

        summary = step_personalization.get("summary")
        if isinstance(summary, dict) and str(summary.get("instruction", "")).strip():
            lines.append(f"- 步骤策略总指令：{str(summary.get('instruction')).strip()}")

        return lines

    def _build_problem_constraints_prompt(self, problem_constraints: Dict[str, Any]) -> str:
        if not problem_constraints:
            return ""

        problem_type = str(problem_constraints.get("problem_type", "geometry_static")).strip()
        sub_pattern = str(problem_constraints.get("sub_pattern", "")).strip()
        fold_axis = str(problem_constraints.get("fold_axis", "")).strip()

        lines = [f"- 题型分类: {problem_type}"]
        if sub_pattern:
            lines.append(f"- 子模式: {sub_pattern}")
        if fold_axis:
            lines.append(f"- 折叠轴: {fold_axis}")
            moving = problem_constraints.get("moving_part", [])
            fixed = problem_constraints.get("fixed_part", [])
            if moving:
                lines.append(f"- 运动部分（折叠后会移动的点/线）: {', '.join(moving)}")
            if fixed:
                lines.append(f"- 固定部分（不参与折叠）: {', '.join(fixed)}")
            image_pairs = problem_constraints.get("image_pairs", [])
            if image_pairs:
                pairs_str = "; ".join(
                    f"{p.get('source', '')}->{p.get('image', '')}"
                    for p in image_pairs
                    if isinstance(p, dict)
                )
                if pairs_str:
                    lines.append(f"- 像点对应关系: {pairs_str}")
            lines.append("- 折叠题动画要求：先高亮折叠轴，再执行折叠动画，像点在折叠步骤前不可见")

        return "\n".join(lines)

    def _safe_float(self, value: Any, default: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def _build_duration_policy(
        self,
        adaptive_plan: Dict[str, Any],
        problem_constraints: Dict[str, Any],
    ) -> Dict[str, Any]:
        problem_type = str(problem_constraints.get("problem_type", "") or "").strip()
        sub_pattern = str(problem_constraints.get("sub_pattern", "") or "").strip()
        mode = str(adaptive_plan.get("mode", "standard") or "standard").strip()
        standard_steps = (
            adaptive_plan.get("step_personalization", {}).get("standardSteps", [])
            if isinstance(adaptive_plan.get("step_personalization"), dict)
            else []
        )
        planned_step_count = len(standard_steps) if isinstance(standard_steps, list) else 0

        complexity = "standard"
        markers = ("fold", "circle", "proof", "similar", "congruence", "dynamic", "solid")
        if any(marker in f"{problem_type} {sub_pattern}".lower() for marker in markers):
            complexity = "complex"
        if planned_step_count >= 7:
            complexity = "complex"
        if planned_step_count and planned_step_count <= 4 and complexity != "complex":
            complexity = "simple"
        if mode == "advanced" and complexity == "standard":
            complexity = "simple"

        profile = dict(self.duration_profiles.get(complexity, self.duration_profiles["standard"]))
        target = float(profile.get("target", 90.0))
        max_duration = float(profile.get("max", target + 30.0))
        if mode == "remedial":
            target = min(max_duration, target + 12.0)
        elif mode == "advanced":
            target = max(45.0, target - 12.0)
            max_duration = max(target + 15.0, max_duration - 20.0)

        return {
            "complexity": complexity,
            "mode": mode,
            "target_duration_seconds": round(target, 1),
            "max_duration_seconds": round(max_duration, 1),
            "max_steps": int(profile.get("max_steps", 6)),
            "max_narration_chars": int(profile.get("max_narration_chars", 95)),
        }

    def _build_duration_policy_prompt(self, policy: Dict[str, Any]) -> str:
        if not policy:
            return ""
        return "\n".join([
            f"- 难度档位: {policy.get('complexity', 'standard')}",
            f"- 目标成片时长: 约 {policy.get('target_duration_seconds')} 秒，硬上限 {policy.get('max_duration_seconds')} 秒",
            f"- 步骤数上限: {policy.get('max_steps')} 步；简单步骤合并，不要拆成独立镜头",
            f"- 每步 narration 控制在 {policy.get('max_narration_chars')} 个中文字符以内",
            "- 开头直接读题和标条件，学情提醒只能融入相关推理句，不能成为独立章节",
            "- 删除寒暄、铺垫、总结式废话；每句都服务于读图、推理、计算或结论",
        ])

    def _apply_duration_policy(self, steps: List[Any], policy: Dict[str, Any]) -> List[Any]:
        if not steps or not policy:
            return steps

        max_steps = max(1, int(policy.get("max_steps", len(steps)) or len(steps)))
        if len(steps) > max_steps:
            steps = steps[: max_steps - 1] + steps[-1:]

        max_chars = max(30, int(policy.get("max_narration_chars", 95) or 95))
        for step in steps:
            step.narration = self._compact_narration(
                str(getattr(step, "narration", "") or ""),
                max_chars=max_chars,
            )
            step.duration = self._clamp_step_duration(getattr(step, "duration", 0.0), step.narration)

        max_total = float(policy.get("max_duration_seconds", 0.0) or 0.0)
        current_total = sum(float(getattr(step, "duration", 0.0) or 0.0) for step in steps)
        if max_total > 0 and current_total > max_total:
            scale = max_total / current_total
            for step in steps:
                step.duration = round(max(3.5, float(getattr(step, "duration", 0.0) or 0.0) * scale), 1)

        for index, step in enumerate(steps, start=1):
            step.id = index
        return steps

    def _compact_narration(self, narration: str, *, max_chars: int) -> str:
        text = re.sub(r"\s+", "", str(narration or "").strip())
        if not text:
            return text
        for pattern in (
            r"同学们?，?",
            r"接下来(我们)?",
            r"下面(我们)?",
            r"首先(我们)?来?",
            r"先来复习[^。！？]*[。！？]?",
            r"你(可能|还)?没掌握[^。！？]*[。！？]?",
            r"学情分析[^。！？]*[。！？]?",
        ):
            text = re.sub(pattern, "", text)
        if len(text) <= max_chars:
            return text

        sentences = [item for item in re.split(r"(?<=[。！？；])", text) if item]
        compact = ""
        for sentence in sentences:
            if len(compact) + len(sentence) > max_chars:
                break
            compact += sentence
        if compact:
            return compact.rstrip("，,；;") + ("。" if not compact.endswith(("。", "！", "？")) else "")
        return text[:max_chars].rstrip("，,；;") + "。"

    def _clamp_step_duration(self, raw_duration: Any, narration: str) -> float:
        duration = self._safe_float(raw_duration, 0.0)
        estimated = max(4.0, min(18.0, len(str(narration or "")) / 5.2))
        if duration <= 0:
            duration = estimated
        duration = max(3.5, min(18.0, duration))
        return round(max(duration, min(estimated, 12.0)), 1)

    def _estimate_script_duration(self, steps: List[Any], fallback_total: Any) -> float:
        total = sum(self._safe_float(getattr(step, "duration", 0.0), 0.0) for step in steps)
        if total > 0:
            return round(total, 1)
        return round(max(0.0, self._safe_float(fallback_total, 0.0)), 1)

    def _postprocess_script_steps(self, steps: List[Any]) -> List[Any]:
        """Post-process script steps: drop leading review steps and enrich brief narrations."""
        REVIEW_RE = re.compile(r"复习|回顾|预习|review")
        result: List[Any] = []
        for step in steps:
            title = str(getattr(step, "title", "") or "")
            narration = str(getattr(step, "narration", "") or "")
            combined = f"{title} {narration}"
            if not result and REVIEW_RE.search(combined):
                continue
            result.append(step)
        if not result:
            return steps
        for step in result:
            narration = str(getattr(step, "narration", "") or "")
            if len(narration.strip()) < 20:
                step.narration = (
                    f"已知条件已标出，{narration.rstrip('。')}，"
                    f"逐步推导，最终结论得证。"
                )
        new_id = 1
        for step in result:
            step.id = new_id
            new_id += 1
        return result

    def _prepare_public_script_steps(
        self,
        script_data: Dict[str, Any],
        steps: List[ScriptStep],
    ) -> Tuple[List[ScriptStep], Dict[str, Any]]:
        """Clean and validate script text before it can be shown to students."""
        quality: Dict[str, Any] = {
            "publishable": True,
            "reason": "",
            "violations": [],
            "final_answer": self._clean_public_text(script_data.get("final_answer", "")),
            "answer_verification": self._normalize_answer_verification(
                script_data.get("answer_verification")
            ),
            "solution_committed": False,
        }

        if not steps:
            quality["publishable"] = False
            quality["reason"] = "script has no steps"
            quality["violations"].append({"field": "steps", "reason": "empty"})
            return steps, quality

        for step in steps:
            self._sanitize_step_public_fields(step, quality)

        quality["solution_committed"] = self._has_committed_solution(script_data, steps)
        if not quality["solution_committed"]:
            quality["publishable"] = False
            quality["reason"] = "script has no final answer or conclusive final step"
            quality["violations"].append({
                "field": "final_answer",
                "reason": "missing committed final answer or conclusion",
            })

        if quality["violations"]:
            quality["publishable"] = False
            if not quality["reason"]:
                quality["reason"] = "script contains non-final reasoning artifacts"

        return steps, quality

    def _sanitize_step_public_fields(self, step: ScriptStep, quality: Dict[str, Any]) -> None:
        fields = {
            "title": getattr(step, "title", ""),
            "narration": getattr(step, "narration", ""),
        }
        for field_name, value in fields.items():
            original = str(value or "")
            cleaned = self._clean_public_text(original)
            self._record_public_text_sanitation(
                quality,
                original=original,
                cleaned=cleaned,
                step_id=getattr(step, "id", None),
                field=field_name,
            )
            setattr(step, field_name, cleaned)

        clean_cues: List[str] = []
        for index, cue in enumerate(getattr(step, "visual_cues", []) or []):
            original = str(cue or "")
            cleaned = self._clean_public_text(original)
            if not self._record_public_text_sanitation(
                quality,
                original=original,
                cleaned=cleaned,
                step_id=getattr(step, "id", None),
                field=f"visual_cues[{index}]",
            ):
                continue
            if cleaned:
                clean_cues.append(cleaned)
        step.visual_cues = clean_cues

        clean_texts: List[Dict[str, Any]] = []
        for index, item in enumerate(getattr(step, "on_screen_texts", []) or []):
            if not isinstance(item, dict):
                continue
            original = str(item.get("text", "") or "")
            cleaned = self._clean_public_text(original)
            if not self._record_public_text_sanitation(
                quality,
                original=original,
                cleaned=cleaned,
                step_id=getattr(step, "id", None),
                field=f"on_screen_texts[{index}].text",
            ):
                continue
            if cleaned:
                clean_item = dict(item)
                clean_item["text"] = cleaned
                clean_texts.append(clean_item)
        step.on_screen_texts = clean_texts

        if not str(getattr(step, "title", "") or "").strip():
            quality["violations"].append({
                "step_id": getattr(step, "id", None),
                "field": "title",
                "reason": "empty after sanitation",
            })
        if not str(getattr(step, "narration", "") or "").strip():
            quality["violations"].append({
                "step_id": getattr(step, "id", None),
                "field": "narration",
                "reason": "empty after sanitation",
            })

    def _clean_public_text(self, value: Any) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        text = re.sub(r"<\s*think\s*>[\s\S]*?<\s*/\s*think\s*>", "", text, flags=re.IGNORECASE)
        text = re.sub(r"```(?:json|text|markdown)?\s*", "", text, flags=re.IGNORECASE)
        text = text.replace("```", "")
        if self._contains_public_thinking(text):
            text = self._remove_public_thinking_sentences(text)
        text = re.sub(r"\s+", " ", text).strip()
        return text

    def _contains_public_thinking(self, value: Any) -> bool:
        text = str(value or "")
        if not text:
            return False
        return bool(self.PUBLIC_THINKING_RE.search(text))

    def _public_thinking_match(self, value: Any) -> Optional[re.Match]:
        text = str(value or "")
        if not text:
            return None
        return self.PUBLIC_THINKING_RE.search(text)

    def _remove_public_thinking_sentences(self, text: str) -> str:
        parts = re.split(r"(?<=[。！？；;.!?])\s*", str(text or ""))
        if len(parts) <= 1:
            return "" if self._contains_public_thinking(text) else text
        kept = [part for part in parts if part and not self._contains_public_thinking(part)]
        return "".join(kept).strip()

    def _record_public_text_sanitation(
        self,
        quality: Dict[str, Any],
        *,
        original: str,
        cleaned: str,
        step_id: Any,
        field: str,
    ) -> bool:
        match = self._public_thinking_match(original)
        if not match:
            return True
        event = {
            "step_id": step_id,
            "field": field,
            "reason": "contains thinking/self-correction marker",
            "marker": match.group(0),
            "context": self._context_around_match(original, match),
            "cleaned_sample": cleaned[:120],
        }
        # 清理后文本必须：非空、不含 thinking、且长度足够（至少保留 30% 原始内容）
        min_len = max(10, len(original.strip()) * 0.3)
        if (cleaned
                and not self._contains_public_thinking(cleaned)
                and len(cleaned.strip()) >= min_len):
            quality.setdefault("sanitized", []).append(event)
            return True
        quality["violations"].append(event)
        return False

    def _context_around_match(self, text: str, match: re.Match, radius: int = 48) -> str:
        start = max(0, match.start() - radius)
        end = min(len(text), match.end() + radius)
        prefix = "..." if start > 0 else ""
        suffix = "..." if end < len(text) else ""
        return f"{prefix}{text[start:end]}{suffix}"

    def _normalize_answer_verification(self, value: Any) -> Dict[str, Any]:
        if not isinstance(value, dict):
            return {"status": "", "method": "", "checks": []}
        checks = value.get("checks")
        if not isinstance(checks, list):
            checks = []
        return {
            "status": self._clean_public_text(value.get("status", "")),
            "method": self._clean_public_text(value.get("method", "")),
            "checks": [
                self._clean_public_text(item)
                for item in checks
                if self._clean_public_text(item)
            ][:5],
        }

    def _has_committed_solution(self, script_data: Dict[str, Any], steps: List[ScriptStep]) -> bool:
        final_answer = self._clean_public_text(script_data.get("final_answer", ""))
        if final_answer and not self._contains_public_thinking(final_answer):
            verification = self._normalize_answer_verification(script_data.get("answer_verification"))
            status = verification.get("status", "").lower()
            if not status or status in {"verified", "checked", "复核通过", "已验证", "已校验"}:
                return True

        final_text = " ".join(
            [
                str(getattr(steps[-1], "title", "") or ""),
                str(getattr(steps[-1], "narration", "") or ""),
                " ".join(
                    str(item.get("text", ""))
                    for item in (getattr(steps[-1], "on_screen_texts", []) or [])
                    if isinstance(item, dict)
                ),
            ]
        )
        return bool(final_text.strip() and self.CONCLUSIVE_SOLUTION_RE.search(final_text))

    def _parse_json_response(self, response: str) -> Dict[str, Any]:
        """解析 LLM 返回的 JSON 响应，支持截断修复"""
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        json_pattern = r'\{[\s\S]*\}'
        match = re.search(json_pattern, response)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass

        # 尝试修复被 max_tokens 截断的 JSON
        repaired = self._try_repair_truncated_json(response)
        if repaired is not None:
            print("[ScriptAgent] 检测到截断 JSON，已自动修复")
            return repaired

        print(f"[ScriptAgent] 无法解析 LLM 响应为 JSON，返回空步骤。响应前200字: {response[:200]}")
        return {"steps": [], "total_duration": 0.0}

    def _try_repair_truncated_json(self, response: str) -> Optional[Dict[str, Any]]:
        """尝试修复被 max_tokens 截断的 JSON 响应。

        策略：从第一个 '{' 开始，逐字符跟踪括号深度，
        在截断处补齐缺失的闭合括号。
        """
        # 提取 JSON 部分
        start = response.find('{')
        if start < 0:
            return None
        text = response[start:]

        # 跟踪括号深度，处理字符串内的括号
        depth = 0
        in_string = False
        escape_next = False
        last_valid_end = -1

        for i, ch in enumerate(text):
            if escape_next:
                escape_next = False
                continue
            if ch == '\\' and in_string:
                escape_next = True
                continue
            if ch == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    last_valid_end = i
                    break

        # 如果 JSON 已经完整但解析失败，不修复
        if last_valid_end >= 0:
            return None

        # 截断了：尝试补齐闭合括号
        # 先移除末尾可能的不完整字符串值
        trimmed = text.rstrip()
        # 如果末尾在引号内的不完整字符串，截断到上一个完整值
        if trimmed.endswith('"'):
            pass  # 完整字符串结尾
        elif in_string:
            # 在字符串中间截断，回退到上一个完整值
            last_quote = trimmed.rfind('"')
            if last_quote > 0:
                # 找到引号前的冒号或逗号，确定截断位置
                trimmed = trimmed[:last_quote + 1]
                # 如果引号后缺少值的闭合，可能需要移除这个不完整的键值对
                # 简单策略：直接在最后一个完整值后闭合

        # 补齐闭合括号
        # 重新计算 depth
        depth = 0
        in_str = False
        esc = False
        for ch in trimmed:
            if esc:
                esc = False
                continue
            if ch == '\\' and in_str:
                esc = True
                continue
            if ch == '"':
                in_str = not in_str
                continue
            if in_str:
                continue
            if ch == '{' or ch == '[':
                depth += 1
            elif ch == '}' or ch == ']':
                depth -= 1

        # 移除末尾的不完整内容（如悬空的逗号、冒号）
        trimmed = trimmed.rstrip()
        while trimmed and trimmed[-1] in (',', ':', ' '):
            trimmed = trimmed[:-1].rstrip()

        # 补齐闭合
        closing = ''
        # 需要跟踪 { 和 [ 的嵌套
        stack = []
        in_str = False
        esc = False
        for ch in trimmed:
            if esc:
                esc = False
                continue
            if ch == '\\' and in_str:
                esc = True
                continue
            if ch == '"':
                in_str = not in_str
                continue
            if in_str:
                continue
            if ch == '{':
                stack.append('}')
            elif ch == '[':
                stack.append(']')
            elif ch in ('}', ']'):
                if stack and stack[-1] == ch:
                    stack.pop()

        closing = ''.join(reversed(stack))

        candidate = trimmed + closing
        try:
            result = json.loads(candidate)
            # 确保有 steps 字段，否则不算成功修复
            if isinstance(result, dict) and "steps" in result:
                return result
        except json.JSONDecodeError:
            pass

        return None

    def _format_structured_geometry_for_prompt(self, data: Optional[Dict[str, Any]]) -> str:
        """将结构化几何数据转为可读文本。"""
        if not data:
            return ""
        try:
            return json.dumps(data, ensure_ascii=False, indent=2)
        except Exception:
            return str(data)

    def _build_geometry_prompt_context(
        self,
        metadata: Dict[str, Any],
        *,
        problem_text: str,
    ) -> Dict[str, Any]:
        context = GeometryContext.from_metadata(metadata, problem_text=problem_text)
        stable_geometry_ir = (
            context.stable_geometry_ir
            if isinstance(context.stable_geometry_ir, dict)
            else {}
        )
        scene_draft = (
            stable_geometry_ir.get("scene_draft")
            if isinstance(stable_geometry_ir.get("scene_draft"), dict)
            else {}
        )
        stable_geometry_summary = self._build_stable_geometry_prompt_summary(context)
        known_entities = self._collect_known_entities_from_geometry_context(context)
        has_stable_visual_context = bool(
            scene_draft
            or stable_geometry_summary.get("points")
            or stable_geometry_summary.get("segments")
            or stable_geometry_summary.get("shapes")
            or stable_geometry_summary.get("relations")
        )
        fallback_geometry_summary = (
            {}
            if has_stable_visual_context
            else self._build_fallback_geometry_prompt_summary(context)
        )

        return {
            "scene_draft_text": self._format_structured_geometry_for_prompt(scene_draft),
            "stable_geometry_text": self._format_structured_geometry_for_prompt(
                stable_geometry_summary
            ),
            "fallback_geometry_text": self._format_structured_geometry_for_prompt(
                fallback_geometry_summary
            ),
            "known_entities": known_entities,
            "has_stable_visual_context": has_stable_visual_context,
        }

    def _build_stable_geometry_prompt_summary(
        self,
        context: GeometryContext,
    ) -> Dict[str, Any]:
        stable_geometry_ir = (
            context.stable_geometry_ir
            if isinstance(context.stable_geometry_ir, dict)
            else {}
        )
        transform = (
            stable_geometry_ir.get("transform")
            if isinstance(stable_geometry_ir.get("transform"), dict)
            else {}
        )
        return {
            "version": str(stable_geometry_ir.get("version", "")).strip(),
            "problem_type": str(stable_geometry_ir.get("problem_type", "")).strip(),
            "problem_pattern": str(stable_geometry_ir.get("problem_pattern", "")).strip(),
            "sub_pattern": str(stable_geometry_ir.get("sub_pattern", "")).strip(),
            "points": list(context.points),
            "segments": [
                str(item.get("label") or item.get("id") or "").strip()
                for item in context.segments
                if isinstance(item, dict) and str(item.get("label") or item.get("id") or "").strip()
            ],
            "shapes": [
                {
                    "id": str(item.get("id", "")).strip(),
                    "type": str(item.get("type", "")).strip(),
                    "points": [
                        str(point).strip()
                        for point in (item.get("points") or [])
                        if str(point).strip()
                    ],
                    "center": str(item.get("center", "")).strip(),
                }
                for item in context.shapes
                if isinstance(item, dict)
            ],
            "relations": list(context.relations),
            "templates": list(context.templates),
            "fold_axis": str(transform.get("fold_axis", "")).strip(),
            "image_pairs": list(context.image_pairs),
        }

    def _build_fallback_geometry_prompt_summary(
        self,
        context: GeometryContext,
    ) -> Dict[str, Any]:
        return {
            "points": list(context.points),
            "segments": [
                str(item.get("label") or item.get("id") or "").strip()
                for item in context.segments
                if isinstance(item, dict)
                and str(item.get("label") or item.get("id") or "").strip()
            ],
            "shapes": [
                {
                    "id": str(item.get("id", "")).strip(),
                    "type": str(item.get("type", "")).strip(),
                }
                for item in context.shapes
                if isinstance(item, dict)
            ],
            "relations": list(context.relations),
        }

    def _normalize_on_screen_texts(self, items: Any) -> List[Dict[str, str]]:
        """标准化 on_screen_texts，兼容字符串列表与对象列表。"""
        normalized: List[Dict[str, str]] = []
        if not isinstance(items, list):
            return normalized

        for item in items:
            if isinstance(item, str):
                text = item.strip()
                if not text:
                    continue
                normalized.append({
                    "text": text,
                    "kind": "description",
                    "target_area": "formula_area",
                })
                continue

            if not isinstance(item, dict):
                continue

            text = str(item.get("text", "")).strip()
            if not text:
                continue

            kind = str(item.get("kind", "description")).strip() or "description"
            target_area = str(item.get("target_area", "formula_area")).strip() or "formula_area"
            if target_area not in {"formula_area", "geometry_area"}:
                target_area = "formula_area"

            normalized.append({
                "text": text,
                "kind": kind,
                "target_area": target_area,
            })

        return normalized

    def _collect_known_entities(
        self,
        semantic_graph: Optional[Dict[str, Any]],
        drawable_scene: Optional[Dict[str, Any]],
    ) -> List[str]:
        entity_ids = set()
        for source in (semantic_graph or {}, drawable_scene or {}):
            points = source.get("points") or {}
            if isinstance(points, dict):
                entity_ids.update(str(item) for item in points.keys())
            elif isinstance(points, list):
                entity_ids.update(
                    str(item.get("id"))
                    for item in points
                    if isinstance(item, dict) and item.get("id")
                )

            for bucket in ("lines", "objects", "angles", "primitives"):
                for item in source.get(bucket, []) or []:
                    if isinstance(item, dict) and item.get("id"):
                        entity_ids.add(str(item.get("id")))

        return sorted(item for item in entity_ids if item)

    def _collect_known_entities_from_geometry_context(
        self,
        context: GeometryContext,
    ) -> List[str]:
        entity_ids = set(context.points)
        for segment in context.segments:
            if not isinstance(segment, dict):
                continue
            label = str(segment.get("label", "")).strip()
            segment_id = str(segment.get("id", "")).strip()
            if label:
                entity_ids.add(label)
            if segment_id:
                entity_ids.add(segment_id)
        for shape in context.shapes:
            if not isinstance(shape, dict):
                continue
            shape_id = str(shape.get("id", "")).strip()
            if shape_id:
                entity_ids.add(shape_id)
            center = str(shape.get("center", "")).strip()
            if center:
                entity_ids.add(center)
        if not entity_ids:
            return self._collect_known_entities(context.semantic_graph, context.drawable_scene)
        return sorted(item for item in entity_ids if item)

    def _normalize_spoken_formulas(
        self,
        value: Any,
        *,
        on_screen_texts: List[Dict[str, str]],
        narration: Any,
        visual_cues: Any,
        title: Any,
    ) -> List[str]:
        candidates: List[str] = []

        if isinstance(value, str):
            token = value.strip()
            if token:
                candidates.append(token)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    token = str(item.get("latex") or item.get("text") or "").strip()
                else:
                    token = str(item).strip()
                if token:
                    candidates.append(token)

        for item in on_screen_texts:
            if not isinstance(item, dict):
                continue
            if str(item.get("target_area", "formula_area")).strip() != "formula_area":
                continue
            token = str(item.get("text", "")).strip()
            if token and self._looks_like_formula(token):
                candidates.append(token)

        texts = [str(title or ""), str(narration or "")]
        texts.extend(str(cue or "") for cue in (visual_cues or []))
        for text in texts:
            candidates.extend(self._extract_formula_candidates_from_text(text))

        return self._dedupe_preserve_order(candidates)[:6]

    def _normalize_visible_segments(
        self,
        value: Any,
        *,
        narration: Any,
        visual_cues: Any,
        title: Any,
    ) -> List[str]:
        tokens: List[str] = []

        if isinstance(value, str):
            tokens.extend(re.split(r"[\s,，;；|/]+", value))
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    token = str(item.get("segment") or item.get("target") or "").strip()
                    if token:
                        tokens.append(token)
                else:
                    token = str(item).strip()
                    if token:
                        tokens.append(token)

        text_blob = " ".join(
            [str(title or ""), str(narration or ""), " ".join(str(cue or "") for cue in (visual_cues or []))]
        )
        # 避免把“3 cm”中的单位误识别成线段（如 CM）。
        for match in re.findall(
            r"(?<!\d\s)(?<![A-Za-z0-9_'])([A-Za-z]\d*['′]?\s*[A-Za-z]\d*['′]?)(?![A-Za-z0-9_'])",
            text_blob,
        ):
            tokens.append(match)

        normalized: List[str] = []
        for token in tokens:
            segment = self._normalize_segment_token(token)
            if segment:
                normalized.append(segment)
        return self._dedupe_preserve_order(normalized)[:10]

    def _normalize_required_actions(self, value: Any) -> List[Dict[str, Any]]:
        if not isinstance(value, list):
            return []

        normalized: List[Dict[str, Any]] = []
        for item in value:
            if not isinstance(item, dict):
                continue
            action_type = str(item.get("type") or item.get("action") or "").strip()
            if not action_type:
                continue
            payload: Dict[str, Any] = {"type": action_type}
            target = item.get("target")
            targets = item.get("targets")
            if target is not None:
                payload["target"] = target
            if isinstance(targets, list):
                payload["targets"] = targets
            for key in ("axis", "from", "to", "to_line", "params", "at"):
                if key in item:
                    payload[key] = item[key]
            normalized.append(payload)
        return normalized[:8]

    def _normalize_auxiliary_line_actions(self, value: Any) -> List[Dict[str, Any]]:
        if not isinstance(value, list):
            return []

        VALID_ACTIONS = {
            "draw_perpendicular_auxiliary",
            "draw_connection_auxiliary",
            "connect_center_tangent",
            "draw_parallel_auxiliary",
            "extend_segment",
        }

        normalized: List[Dict[str, Any]] = []
        for item in value:
            if not isinstance(item, dict):
                continue
            action = str(item.get("action") or item.get("type") or "").strip()
            if not action or action not in VALID_ACTIONS:
                continue

            payload: Dict[str, Any] = {
                "action": action,
                "id": str(item.get("id") or f"aux_{len(normalized) + 1}").strip(),
            }

            from_point = str(item.get("from") or "").strip()
            to_point = str(item.get("to") or "").strip()
            to_line = str(item.get("to_line") or "").strip()
            foot = str(item.get("foot") or "").strip()
            reason = str(item.get("reason") or "").strip()
            persist = str(item.get("persist") or "until_step_end").strip()

            if from_point:
                payload["from"] = from_point
            if to_point:
                payload["to"] = to_point
            if to_line:
                payload["to_line"] = to_line
            if foot:
                payload["foot"] = foot
            if reason:
                payload["reason"] = reason
            if persist in {"until_step_end", "until_video_end"}:
                payload["persist"] = persist
            else:
                payload["persist"] = "until_step_end"

            style_payload: Dict[str, Any] = {}
            if isinstance(item.get("style"), dict):
                style = item.get("style")
                if str(style.get("dashed")).lower() in {"true", "1", "yes"}:
                    style_payload["dashed"] = True
                if style.get("color"):
                    style_payload["color"] = str(style.get("color")).strip()
                if style.get("stroke_width"):
                    try:
                        style_payload["stroke_width"] = float(style.get("stroke_width"))
                    except (TypeError, ValueError):
                        pass
            if style_payload:
                payload["style"] = style_payload

            normalized.append(payload)
        return normalized[:5]

    def _normalize_animation_policy(self, value: Any) -> str:
        token = str(value or "auto").strip().lower()
        if token in {"auto", "required", "none"}:
            return token
        return "auto"

    def _extract_formula_candidates_from_text(self, text: str) -> List[str]:
        if not text:
            return []
        patterns = [
            re.compile(r"[A-Za-z0-9'()\^²√+\-=/×·<>]{2,}\s*=\s*[A-Za-z0-9'()\^²√+\-=/×·<>]{1,}"),
            re.compile(r"\\?[A-Za-z]+\s*=\s*\\?[A-Za-z0-9]+"),
        ]
        results: List[str] = []
        for pattern in patterns:
            results.extend(match.strip(" ，。；：,. ") for match in pattern.findall(text))
        return [item for item in results if self._looks_like_formula(item)]

    def _looks_like_formula(self, text: str) -> bool:
        token = str(text or "").strip()
        if not token:
            return False
        return any(symbol in token for symbol in ["=", "+", "-", "√", "²", "×", "/", "^", "∠", "∥", "⊥"])

    def _normalize_segment_token(self, token: Any) -> str:
        raw = str(token or "").strip()
        if not raw:
            return ""
        if raw.lower().startswith("seg_"):
            raw = raw[4:]
        raw = raw.replace("′", "1").replace("'", "1").replace(" ", "")
        refs = re.findall(r"[A-Za-z]\d*", raw)
        if len(refs) == 2:
            a, b = refs[0].upper(), refs[1].upper()
            return "".join(sorted([a, b]))
        return ""

    def _dedupe_preserve_order(self, values: List[str]) -> List[str]:
        seen = set()
        result: List[str] = []
        for item in values:
            token = str(item or "").strip()
            if not token or token in seen:
                continue
            seen.add(token)
            result.append(token)
        return result
