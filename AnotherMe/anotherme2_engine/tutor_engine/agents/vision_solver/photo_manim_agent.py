"""
Photo → Manim Direct Agent

Simplified pipeline:
1. Download problem image
2. Call vision LLM with image + prompt → get Manim code
3. Render Manim code to MP4 using ManimRenderService
4. Return video path

Bypasses all complex geometry recognition, OCR, coordinate extraction, etc.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from pathlib import Path
from typing import Any

from tutor_engine.agents.math_animator.renderer import ManimRenderService
from tutor_engine.agents.vision_solver.prompts.photo_manim_direct import (
    PHOTO_MANIM_SYSTEM_PROMPT,
    PHOTO_MANIM_USER_MESSAGE_TEMPLATE,
)

logger = logging.getLogger(__name__)

# Patterns to extract JSON from LLM response (may be wrapped in markdown fences)
_JSON_BLOCK_PATTERN = re.compile(
    r"```(?:json)?\s*\n?(.*?)\n?```", re.DOTALL | re.IGNORECASE
)

# Pattern to extract complete Manim code from the LLM response JSON
_CODE_FIELD_KEY = "complete_manim_code"


class PhotoManimDirectError(RuntimeError):
    """Raised when the photo-manim-direct pipeline fails."""


class PhotoManimDirectAgent:
    """Simple agent: call vision LLM → render Manim."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str = "qwen3.7-plus",
        timeout_seconds: int = 600,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/") if base_url else ""
        self.model = model
        self.timeout_seconds = timeout_seconds

    async def process(self, *, image_path: str, output_dir: str) -> str:
        """
        Run the full pipeline and return the path to the rendered MP4 video.
        """
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        # Step 1: Read image as base64
        image_b64 = self._encode_image(image_path)

        # Step 2: Call vision LLM
        logger.info("Calling vision LLM (%s) for photo-manim-direct...", self.model)
        response = await self._call_vision_llm(image_b64)

        # Step 3: Parse the JSON response
        parsed = self._parse_response(response)
        manim_code = parsed.get(_CODE_FIELD_KEY, "")
        if not manim_code or not manim_code.strip():
            raise PhotoManimDirectError("Vision LLM 返回的 Manim 代码为空")

        # Save the generated code for debugging
        code_path = output_path / "generated_scene.py"
        code_path.write_text(manim_code, encoding="utf-8")
        logger.info("Saved generated Manim code to %s", code_path)

        # Step 4: Save solution steps for poll-based preview
        steps = parsed.get("solution_steps", [])
        problem_summary = parsed.get("problem_summary", "")
        final_answer = parsed.get("final_answer", "")
        script_steps_path = output_path / "intermediate"
        script_steps_path.mkdir(parents=True, exist_ok=True)
        steps_file = script_steps_path / "script_steps.json"
        steps_file.write_text(
            json.dumps(
                {
                    "problem_summary": problem_summary,
                    "final_answer": final_answer,
                    "steps": [
                        {
                            "id": s.get("step", i + 1),
                            "title": s.get("title", f"Step {i + 1}"),
                            "narration": s.get("explanation", ""),
                            "description": s.get("key_formula", ""),
                        }
                        for i, s in enumerate(steps)
                    ],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        # Step 5: Render with Manim
        logger.info("Rendering Manim code to video...")
        turn_id = output_path.name
        renderer = ManimRenderService(turn_id, progress_callback=None)

        # Write the code to the renderer's source dir
        renderer.source_dir.mkdir(parents=True, exist_ok=True)
        source_path = renderer.source_dir / "scene.py"
        source_path.write_text(manim_code, encoding="utf-8")

        render_result = await renderer.render(
            code=manim_code, output_mode="video", quality="medium"
        )

        if not render_result.artifacts:
            raise PhotoManimDirectError("Manim 渲染未生成任何产物")

        # Step 6: Copy the rendered video to the output directory
        artifact = render_result.artifacts[0]
        artifact_path = renderer.artifacts_dir / artifact.filename
        if not artifact_path.exists():
            raise PhotoManimDirectError(f"渲染产物未找到: {artifact_path}")

        final_video_path = output_path / "final_video.mp4"
        final_video_path.write_bytes(artifact_path.read_bytes())
        logger.info("Final video saved to %s", final_video_path)

        return str(final_video_path)

    def _encode_image(self, image_path: str) -> str:
        """Encode an image file as a base64 data URL."""
        import base64

        img_path = Path(image_path)
        if not img_path.exists():
            raise PhotoManimDirectError(f"图片文件不存在: {image_path}")

        suffix = img_path.suffix.lower()
        mime_map = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
        }
        mime = mime_map.get(suffix, "image/png")
        data = img_path.read_bytes()
        b64 = base64.b64encode(data).decode("ascii")
        return f"data:{mime};base64,{b64}"

    async def _call_vision_llm(self, image_b64: str) -> str:
        """Call the vision LLM with the image and prompt."""
        import aiohttp

        url = f"{self.base_url}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

        messages = [
            {"role": "system", "content": PHOTO_MANIM_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": image_b64},
                    },
                    {
                        "type": "text",
                        "text": PHOTO_MANIM_USER_MESSAGE_TEMPLATE,
                    },
                ],
            },
        ]

        payload = {
            "model": self.model,
            "messages": messages,
            "max_tokens": 16384,
            "temperature": 0.3,
        }

        timeout = aiohttp.ClientTimeout(total=self.timeout_seconds)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload, headers=headers) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    raise PhotoManimDirectError(
                        f"Vision LLM API 调用失败 (HTTP {resp.status}): {error_text[:500]}"
                    )
                result = await resp.json()

        choices = result.get("choices", [])
        if not choices:
            raise PhotoManimDirectError("Vision LLM 返回结果为空")

        content = choices[0].get("message", {}).get("content", "")
        if not content:
            raise PhotoManimDirectError("Vision LLM 返回内容为空")

        return str(content)

    def _parse_response(self, response: str) -> dict[str, Any]:
        """Extract JSON from the LLM response (may be wrapped in markdown fences)."""
        text = response.strip()

        # Try direct JSON parse first
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Try to extract from markdown code blocks
        matches = _JSON_BLOCK_PATTERN.findall(text)
        for match in matches:
            candidate = match.strip()
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                continue

        # Try to find JSON object boundaries
        obj_start = text.find("{")
        obj_end = text.rfind("}")
        if obj_start >= 0 and obj_end > obj_start:
            candidate = text[obj_start : obj_end + 1]
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                pass

        raise PhotoManimDirectError(
            f"无法从 Vision LLM 响应中解析 JSON。原始响应前 500 字符: {text[:500]}"
        )


def run_photo_manim_sync(
    *,
    image_path: str,
    output_dir: str,
    api_key: str,
    base_url: str,
    model: str = "qwen3.7-plus",
) -> str:
    """Synchronous wrapper for the photo-manim-direct pipeline."""
    agent = PhotoManimDirectAgent(
        api_key=api_key,
        base_url=base_url,
        model=model,
    )
    return asyncio.run(agent.process(image_path=image_path, output_dir=output_dir))
