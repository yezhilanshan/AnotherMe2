"""Tool endpoints: web search, quiz grading, code execution."""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import tempfile
import time
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from ..config import Settings
from .auth import require_token


# ── Request/Response Models ──────────────────────────────────────────────────


class WebSearchRequest(BaseModel):
    query: str
    pdf_text: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None


class WebSearchSource(BaseModel):
    title: str
    url: str
    content: str
    score: float = 0.0


class WebSearchResponse(BaseModel):
    answer: str
    sources: list[WebSearchSource]
    query: str
    response_time: float


class QuizGradeRequest(BaseModel):
    question: str
    user_answer: str
    points: int
    comment_prompt: Optional[str] = None
    language: str = "zh-CN"


class QuizGradeResponse(BaseModel):
    score: int
    comment: str


class CodeExecRequest(BaseModel):
    code: str
    timeout: int = 30
    language: str = "python"


class CodeExecResponse(BaseModel):
    success: bool
    stdout: str
    stderr: str
    exit_code: int
    execution_time: int
    error: Optional[str] = None


# ── SSRF Protection ──────────────────────────────────────────────────────────

BLOCKED_HOSTNAMES = {
    "localhost", "localhost.localdomain", "ip6-localhost",
    "ip6-loopback", "ip6-localnet", "broadcasthost",
}

PRIVATE_PREFIXES = ("10.", "127.", "192.168.", "169.254.", "0.", "fe80:")


def _is_private_ip(hostname: str) -> bool:
    """Check if hostname resolves to a private/reserved IP."""
    h = hostname.strip().lower().strip("[]")
    if h in BLOCKED_HOSTNAMES:
        return True
    if h.endswith((".local", ".localhost", ".internal")):
        return True
    if h == "0.0.0.0":
        return True
    for prefix in PRIVATE_PREFIXES:
        if h.startswith(prefix):
            return True
    # 172.16-31
    if h.startswith("172."):
        try:
            second = int(h.split(".")[1])
            if 16 <= second <= 31:
                return True
        except (IndexError, ValueError):
            pass
    return False


def _validate_url_safety(url: str) -> Optional[str]:
    """Return error message if URL is unsafe, None if OK."""
    if os.getenv("ALLOW_LOCAL_NETWORKS", "").lower() in ("true", "1"):
        return None
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
    except Exception:
        return "Invalid URL"
    if parsed.scheme not in ("http", "https"):
        return "Only HTTP(S) URLs are allowed"
    if _is_private_ip(parsed.hostname or ""):
        return "Local/private network URLs are not allowed"
    return None


# ── Tavily Search ────────────────────────────────────────────────────────────

TAVILY_DEFAULT_URL = "https://api.tavily.com/search"
TAVILY_MAX_QUERY = 400


async def _tavily_search(
    query: str,
    api_key: str,
    base_url: str = "",
    max_results: int = 5,
) -> dict:
    """Call Tavily search API."""
    url = base_url.strip() or TAVILY_DEFAULT_URL
    truncated = query[:TAVILY_MAX_QUERY]

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            url,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json={
                "query": truncated,
                "search_depth": "basic",
                "max_results": max_results,
                "include_answer": "basic",
            },
        )
        resp.raise_for_status()
        return resp.json()


# ── Code Execution Sandbox ───────────────────────────────────────────────────

ALLOWED_IMPORTS = {
    "math", "random", "statistics", "fractions", "decimal", "numbers",
    "json", "csv", "datetime", "time", "calendar", "itertools", "functools",
    "collections", "heapq", "bisect", "copy", "pprint", "string", "re",
    "hashlib", "base64", "binascii", "struct",
    "typing", "abc", "dataclasses", "enum", "pathlib",
    "numpy", "pandas", "matplotlib", "scipy", "sympy",
}

DISALLOWED_CALLS = {
    "open", "exec", "eval", "compile", "__import__", "input", "breakpoint",
    "exit", "quit", "help", "license", "copyright", "credits",
    "getattr", "setattr", "delattr", "hasattr",
    "globals", "locals", "vars", "dir",
}

DISALLOWED_MODULES = {
    "os", "sys", "subprocess", "socket", "urllib", "http", "ftplib",
    "smtplib", "imaplib", "poplib", "telnetlib", "shutil", "importlib",
    "builtins", "types", "inspect",
}


def _validate_code(code: str) -> Optional[str]:
    """Validate code for safety. Returns error message or None if OK."""
    if len(code) > 10000:
        return "代码长度超过限制 (10000 字符)"

    for call in DISALLOWED_CALLS:
        if re.search(rf"\b{re.escape(call)}\s*\(", code):
            return f"禁止使用函数: {call}"

    for mod in DISALLOWED_MODULES:
        if (re.search(rf"\b{re.escape(mod)}\.", code) or
                re.search(rf"\bfrom\s+{re.escape(mod)}\b", code, re.I) or
                re.search(rf"\bimport\s+{re.escape(mod)}\b", code, re.I)):
            return f"禁止访问模块: {mod}"

    # Check import allowlist
    for match in re.finditer(r"^\s*import\s+(.+)$", code, re.M):
        for mod in match.group(1).split(","):
            root = mod.strip().split(" as ")[0].strip().split(".")[0]
            if root and root not in ALLOWED_IMPORTS:
                return f"禁止导入模块: {root}"

    for match in re.finditer(r"^\s*from\s+([a-zA-Z_][\w.]*)\s+import", code, re.M):
        root = match.group(1).split(".")[0]
        if root not in ALLOWED_IMPORTS:
            return f"禁止导入模块: {root}"

    # Dangerous patterns
    dangerous = [
        (r"__\w+__", "双下划线属性"),
        (r"while\s*\(?\s*1\s*\)?", "无限循环"),
        (r"while\s+True\b", "无限循环"),
    ]
    for pattern, desc in dangerous:
        if re.search(pattern, code, re.I):
            return f"代码包含危险模式: {desc}"

    return None


async def _execute_python(code: str, timeout: int = 30) -> dict:
    """Execute Python code in a sandboxed subprocess."""
    timeout = min(max(timeout, 1), 60)

    validation_error = _validate_code(code)
    if validation_error:
        return {
            "success": False, "stdout": "", "stderr": f"安全验证失败: {validation_error}",
            "exit_code": -1, "execution_time": 0, "error": f"安全验证失败: {validation_error}",
        }

    start = time.monotonic()
    exec_id = str(uuid.uuid4())

    with tempfile.TemporaryDirectory(prefix=f"anotherme-exec-{exec_id}-") as tmpdir:
        code_file = os.path.join(tmpdir, "script.py")
        with open(code_file, "w", encoding="utf-8") as f:
            f.write(code)

        env = {
            "PYTHONIOENCODING": "utf-8",
            "PYTHONUNBUFFERED": "1",
            "PYTHONNOUSERSITE": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "PATH": os.environ.get("PATH", ""),
        }

        python_bin = os.getenv("PYTHON_BIN") or os.getenv("PYTHON") or "python3"

        try:
            proc = await asyncio.create_subprocess_exec(
                python_bin, "-I", code_file,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=tmpdir,
                env=env,
            )
            try:
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout
                )
                stdout = stdout_bytes.decode("utf-8", errors="replace")
                stderr = stderr_bytes.decode("utf-8", errors="replace")
                exit_code = proc.returncode or 0
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                stdout = ""
                stderr = f"执行超时 ({timeout} 秒)"
                exit_code = -1
        except FileNotFoundError:
            stdout = ""
            stderr = "未找到 Python 运行时"
            exit_code = -1
        except Exception as e:
            stdout = ""
            stderr = str(e)
            exit_code = -1

    MAX_OUTPUT = 10000
    if len(stdout) > MAX_OUTPUT:
        stdout = stdout[:MAX_OUTPUT] + "\n... (输出已截断)"
    if len(stderr) > MAX_OUTPUT:
        stderr = stderr[:MAX_OUTPUT] + "\n... (错误输出已截断)"

    elapsed = int((time.monotonic() - start) * 1000)

    return {
        "success": exit_code == 0,
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": exit_code,
        "execution_time": elapsed,
    }


# ── Router Factory ───────────────────────────────────────────────────────────


def create_tools_router(settings: Settings) -> APIRouter:
    router = APIRouter(tags=["tools"])

    @router.post("/v1/web-search", response_model=WebSearchResponse)
    async def web_search(
        body: WebSearchRequest,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_token(settings, authorization)

        if not body.query or not body.query.strip():
            raise HTTPException(400, detail={"error_code": "MISSING_FIELD", "message": "query is required"})

        api_key = body.api_key or os.getenv("TAVILY_API_KEY", "")
        if not api_key:
            raise HTTPException(400, detail={"error_code": "MISSING_API_KEY", "message": "Tavily API key not configured"})

        base_url = body.base_url or ""
        if base_url:
            ssrf_err = _validate_url_safety(base_url)
            if ssrf_err:
                raise HTTPException(403, detail={"error_code": "INVALID_URL", "message": ssrf_err})

        try:
            data = await _tavily_search(body.query, api_key, base_url)
        except httpx.HTTPStatusError as e:
            raise HTTPException(502, detail={"error_code": "UPSTREAM_ERROR", "message": f"Tavily API error ({e.response.status_code})"})
        except Exception as e:
            raise HTTPException(500, detail={"error_code": "SEARCH_FAILED", "message": str(e)})

        sources = [
            WebSearchSource(
                title=r.get("title", ""),
                url=r.get("url", ""),
                content=r.get("content", ""),
                score=r.get("score", 0),
            )
            for r in data.get("results", [])
        ]

        return {
            "answer": data.get("answer", ""),
            "sources": [s.model_dump() for s in sources],
            "query": data.get("query", body.query),
            "response_time": data.get("response_time", 0),
        }

    @router.post("/v1/quiz-grade", response_model=QuizGradeResponse)
    async def quiz_grade(
        body: QuizGradeRequest,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_token(settings, authorization)

        if not body.question or not body.user_answer:
            raise HTTPException(400, detail={"error_code": "MISSING_FIELD", "message": "question and user_answer are required"})
        if not body.points or body.points <= 0:
            raise HTTPException(400, detail={"error_code": "INVALID_REQUEST", "message": "points must be positive"})

        # Use the engine bridge for LLM grading
        from ..engine_bridge import stream_capability_via_orchestrator

        is_zh = body.language == "zh-CN"
        system_prompt = (
            f"你是一位专业的教育评估专家。请根据题目和学生答案进行评分并给出简短评语。\n"
            f"必须以如下 JSON 格式回复（不要包含其他内容）：\n"
            f'{{"score": <0到{body.points}的整数>, "comment": "<一两句评语>"}}'
        ) if is_zh else (
            f"You are a professional educational assessor. Grade the student's answer.\n"
            f"Reply in JSON only:\n"
            f'{{"score": <integer 0 to {body.points}>, "comment": "<feedback>"}}'
        )

        user_prompt = (
            f"题目：{body.question}\n满分：{body.points}分\n"
            f"{f'评分要点：{body.comment_prompt}\n' if body.comment_prompt else ''}"
            f"学生答案：{body.user_answer}"
        ) if is_zh else (
            f"Question: {body.question}\nFull marks: {body.points} points\n"
            f"{f'Grading guidance: {body.comment_prompt}\n' if body.comment_prompt else ''}"
            f"Student answer: {body.user_answer}"
        )

        # Collect the full response from the engine
        full_text = ""
        try:
            async for event in stream_capability_via_orchestrator(
                capability="chat",
                user_message=f"{system_prompt}\n\n{user_prompt}",
                conversation_history=[],
                session_id=f"quiz-grade-{uuid.uuid4().hex[:8]}",
                language="zh",
            ):
                if event.get("type") == "stream":
                    full_text += event.get("content", "")
                elif event.get("type") == "result":
                    full_text = event.get("content", full_text)
        except Exception:
            pass

        # Parse JSON from response
        try:
            match = re.search(r"\{[\s\S]*\}", full_text)
            if not match:
                raise ValueError("No JSON")
            parsed = json.loads(match.group())
            score = max(0, min(body.points, round(float(parsed.get("score", 0)))))
            comment = str(parsed.get("comment", ""))
        except Exception:
            score = round(body.points * 0.5)
            comment = "已作答，请参考标准答案。" if is_zh else "Answer received. Please refer to the standard answer."

        return {"score": score, "comment": comment}

    @router.post("/v1/code-exec", response_model=CodeExecResponse)
    async def code_exec(
        body: CodeExecRequest,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_token(settings, authorization)

        if not body.code:
            raise HTTPException(400, detail={"error_code": "MISSING_FIELD", "message": "code is required"})

        result = await _execute_python(body.code, body.timeout)
        return result

    return router
