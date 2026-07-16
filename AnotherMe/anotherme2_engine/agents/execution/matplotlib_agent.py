"""
Matplotlib 可视化智能体 - 根据题目信息生成 Matplotlib 图表

自动流程：
1. 用 LLM 根据题目文本 + 脚本步骤生成 Matplotlib Python 代码
2. 在子进程中执行代码，产出 PNG 图片
3. 如果执行失败，把 traceback 反馈给 LLM 重试（最多 3 次）
"""

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..foundation.base_agent import BaseAgent
from ..foundation.state import ScriptStep, VideoProject

try:
    from output_paths import DEFAULT_OUTPUT_DIR
except ModuleNotFoundError:
    from anotherme2_engine.output_paths import DEFAULT_OUTPUT_DIR


class MatplotlibAgent(BaseAgent):
    """Matplotlib 可视化智能体"""

    SYSTEM_PROMPT = """你是一个专业的数学可视化工程师。根据题目信息，生成 Matplotlib Python 代码来可视化数学问题的解法。

核心流程：理解题目 → 计算精确的代数坐标和方程 → 输出 Matplotlib 绘图代码

绘图风格要求（PlotKityCat 审美体系）：
- 色彩：使用马卡龙莫兰迪浅色系。背景暖白色，文字中性深灰。主色使用柔和色相（H 在 4°/24°/83°/159°/228°附近），高明度（L≈0.80-0.90），低到中饱和度（S≈0.35-0.60）。辅助线用低饱和灰蓝。
- 美观：塔夫特风格，少文字、重图形。虚线透骨 0.8，实线落锚 2，圆点驻形 6。默认使用 SimHei 与 cm 字体。
- 几何：正交投影，无透视畸变，经典的立体几何考卷视角。
- 比例：真实比例，适合打印。细线条，无非必要刻度、网格和边框。
- 标记：只标注最基本的点 A/B/C/D 或需要的边长 r/h。其余用颜色和透明度渐变代替文字标注。
- 布局：使用 bbox_inches='tight'，单图或多子图。

数学推理要求：
- 先对题目做数学空间推理，确定精确的代数坐标和方程。
- 固定问题（自由度为 0）：保证坐标和方程的唯一性。
- 欠定问题（有动点或动线）：如果问题核心在于研究此对象，输出多种赋值作为并列子图；如果核心不在此对象，忽略并赋最美的值。
- 任何图形不能凭直觉写代码，必须按推理的代数结果确定。

技术约束：
1. 使用 matplotlib.pyplot 和 numpy，不要使用其他需要额外安装的库（mpl_toolkits.mplot3d 可以使用）
2. 图表尺寸使用 plt.figure(figsize=(10, 8), dpi=150)
3. 中文字体：plt.rcParams['font.sans-serif'] = ['SimHei']，如果 SimHei 不可用则用系统默认，使用 try/except 兜底
4. 代码最后必须调用 plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor='white')
5. 禁止使用 plt.show() —— 会导致脚本挂起
6. 禁止使用 matplotlib.widgets（Slider/Button/CheckButtons 等交互控件）—— 服务端无 GUI
7. 必须使用非交互式后端（默认 Agg），不要设置任何交互式后端
8. 代码必须是完整可执行的 Python 脚本
9. output_path 通过 sys.argv[1] 获取
10. 如果题目涉及几何图形，用 matplotlib 的 patches（Circle, Polygon, FancyArrowPatch 等）精确绘制
11. 如果题目涉及函数图像，用 plt.plot 绘制，标注关键点（交点、极值点等）

输出格式（只输出代码块，不要任何解释）：
```python
# 完整的 Matplotlib 代码
```
"""

    MAX_REPAIR_ATTEMPTS = 3
    EXECUTION_TIMEOUT = 60  # 秒

    def __init__(self, config: Dict[str, Any], llm: Optional[Any] = None):
        super().__init__(config, llm)
        self.output_dir = Path(config.get("output_dir", str(DEFAULT_OUTPUT_DIR)))

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """生成并执行 Matplotlib 代码，产出 PNG 图片。"""
        project: VideoProject = state["project"]
        if getattr(project, "status", "") == "failed":
            return state

        metadata = state.setdefault("metadata", {})
        problem_text = str(getattr(project, "problem_text", "") or "")
        script_steps: List[ScriptStep] = getattr(project, "script_steps", []) or []
        problem_constraints = (
            metadata.get("problem_constraints")
            if isinstance(metadata.get("problem_constraints"), dict)
            else {}
        )

        if not problem_text.strip() and not script_steps:
            return self._fail(state, "缺少题目文本或脚本步骤，无法生成可视化。")

        # 构建 prompt
        user_prompt = self._build_user_prompt(
            problem_text, script_steps, problem_constraints
        )

        # 生成 -> 执行 -> 修复 循环
        last_error = ""
        for attempt in range(self.MAX_REPAIR_ATTEMPTS):
            try:
                # 第一次用 system prompt，后续附加错误信息
                if attempt == 0:
                    messages = self._format_messages(
                        system_prompt=self.SYSTEM_PROMPT,
                        user_prompt=user_prompt,
                    )
                else:
                    repair_prompt = (
                        f"{user_prompt}\n\n"
                        f"【第 {attempt} 次修复】上一次代码执行失败，错误信息如下：\n"
                        f"```\n{last_error}\n```\n"
                        f"请修复代码中的问题，重新输出完整的可执行代码。"
                    )
                    messages = self._format_messages(
                        system_prompt=self.SYSTEM_PROMPT,
                        user_prompt=repair_prompt,
                    )

                # LLM 生成代码
                response = self._invoke_llm(messages)
                code = self._extract_code_block(response or "")
                if not code.strip():
                    last_error = "LLM 返回了空代码"
                    continue

                # 执行代码
                image_path = self._execute_matplotlib(code)
                if image_path and Path(image_path).exists():
                    # 成功
                    project.matplotlib_image_path = str(image_path)
                    metadata["matplotlib_code"] = code
                    state["project"] = project
                    state["current_step"] = "matplotlib_completed"
                    state["messages"].append(
                        {
                            "role": "assistant",
                            "content": f"Matplotlib 可视化生成完成（第 {attempt + 1} 次尝试）",
                        }
                    )
                    print(f"[MatplotlibAgent] 可视化生成成功: {image_path}")
                    return state
                else:
                    last_error = "代码执行后未产出图片文件"

            except Exception as exc:
                last_error = str(exc)
                print(f"[MatplotlibAgent] 第 {attempt + 1} 次尝试失败: {last_error}")

        # 所有重试都失败
        return self._fail(
            state,
            f"Matplotlib 可视化生成失败（已重试 {self.MAX_REPAIR_ATTEMPTS} 次）: {last_error}",
        )

    def _build_user_prompt(
        self,
        problem_text: str,
        script_steps: List[ScriptStep],
        problem_constraints: Dict[str, Any],
    ) -> str:
        """构建用户 prompt。"""
        parts = []

        parts.append(f"[题目]\n{problem_text}")

        if script_steps:
            parts.append("\n[解题步骤]")
            for step in script_steps:
                parts.append(f"步骤 {step.id}: {step.title}")
                if step.narration:
                    parts.append(f"  说明: {step.narration}")
                if step.visual_cues:
                    parts.append(f"  视觉提示: {', '.join(step.visual_cues)}")

        if problem_constraints:
            parts.append(
                f"\n[题型信息]\n{json.dumps(problem_constraints, ensure_ascii=False, indent=2)}"
            )

        parts.append(
            "\n[输出要求]\n"
            "请生成一个 Matplotlib 图表来可视化这道题的解法。\n"
            "图表应清晰展示题目中的几何/代数关系和解题关键步骤。\n"
            "output_path 通过 sys.argv[1] 获取。"
        )

        return "\n".join(parts)

    def _extract_code_block(self, text: str) -> str:
        """从 LLM 响应中提取 Python 代码块。"""
        text = text.strip()

        # 方法 1: 提取 ```python 块
        match = re.search(r"```python\s*([\s\S]*?)\s*```", text)
        if match:
            code = match.group(1).strip()
            if code.startswith("```"):
                return self._extract_code_block(code)
            return code

        # 方法 2: 提取 ``` 块（不带语言标记）
        match = re.search(r"```\s*([\s\S]*?)\s*```", text)
        if match:
            code = match.group(1).strip()
            if code.startswith("```"):
                return self._extract_code_block(code)
            return code

        # 方法 3: 暴力清理
        lines = text.split("\n")
        cleaned_lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(cleaned_lines).strip()

        if "import matplotlib" in cleaned or "import numpy" in cleaned:
            return cleaned

        return cleaned

    def _execute_matplotlib(self, code: str) -> Optional[str]:
        """在子进程中执行 Matplotlib 代码，返回产出的图片路径。"""
        self.output_dir.mkdir(parents=True, exist_ok=True)
        output_path = self.output_dir / "matplotlib_output.png"

        # 写入临时脚本
        script_path = self.output_dir / "matplotlib_script.py"
        script_path.write_text(code, encoding="utf-8")

        try:
            result = subprocess.run(
                [sys.executable, str(script_path), str(output_path)],
                capture_output=True,
                text=True,
                timeout=self.EXECUTION_TIMEOUT,
                cwd=str(self.output_dir),
            )

            if result.returncode != 0:
                error_msg = result.stderr or result.stdout or "Unknown error"
                # 清理 traceback，只保留关键信息
                error_lines = error_msg.strip().split("\n")
                # 取最后几行（通常是实际错误）
                short_error = (
                    "\n".join(error_lines[-8:])
                    if len(error_lines) > 8
                    else error_msg.strip()
                )
                raise RuntimeError(
                    f"Matplotlib 执行失败 (exit {result.returncode}):\n{short_error}"
                )

            if output_path.exists() and output_path.stat().st_size > 0:
                return str(output_path)

            return None

        except subprocess.TimeoutExpired:
            raise RuntimeError(f"Matplotlib 执行超时（{self.EXECUTION_TIMEOUT}秒）")
        finally:
            # 清理临时脚本
            try:
                script_path.unlink(missing_ok=True)
            except Exception:
                pass

    def _fail(self, state: Dict[str, Any], message: str) -> Dict[str, Any]:
        """设置失败状态。"""
        project: VideoProject = state["project"]
        project.status = "failed"
        project.error_message = message
        state["project"] = project
        state["current_step"] = "matplotlib_failed"
        state["messages"].append({"role": "assistant", "content": message})
        return state
