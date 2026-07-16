"""Document endpoints: PDF parsing, media proxy with SSRF protection."""

from __future__ import annotations

import os
from typing import Optional

import httpx
from fastapi import APIRouter, Header, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel

from ..config import Settings
from .auth import require_token


# ── SSRF Protection (same as tools.py, shared logic) ─────────────────────────

BLOCKED_HOSTNAMES = {
    "localhost", "localhost.localdomain", "ip6-localhost",
    "ip6-loopback", "ip6-localnet", "broadcasthost",
}

PRIVATE_PREFIXES = ("10.", "127.", "192.168.", "169.254.", "0.", "fe80:")


def _is_private_ip(hostname: str) -> bool:
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
    if h.startswith("172."):
        try:
            second = int(h.split(".")[1])
            if 16 <= second <= 31:
                return True
        except (IndexError, ValueError):
            pass
    return False


def _validate_url_safety(url: str) -> Optional[str]:
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


# ── Proxy Media Request ──────────────────────────────────────────────────────


class ProxyMediaRequest(BaseModel):
    url: str


# ── Router Factory ───────────────────────────────────────────────────────────


def create_documents_router(settings: Settings) -> APIRouter:
    router = APIRouter(tags=["documents"])

    @router.post("/v1/proxy-media")
    async def proxy_media(
        body: ProxyMediaRequest,
        authorization: str | None = Header(default=None),
    ) -> Response:
        """Proxy a remote media URL to bypass CORS. SSRF-protected."""
        require_token(settings, authorization)

        if not body.url or not isinstance(body.url, str):
            raise HTTPException(400, detail={"error_code": "MISSING_FIELD", "message": "Missing or invalid url"})

        ssrf_error = _validate_url_safety(body.url)
        if ssrf_error:
            raise HTTPException(403, detail={"error_code": "INVALID_URL", "message": ssrf_error})

        try:
            async with httpx.AsyncClient(timeout=60, follow_redirects=False) as client:
                resp = await client.get(body.url)
        except Exception as e:
            raise HTTPException(500, detail={"error_code": "FETCH_FAILED", "message": str(e)})

        if 300 <= resp.status_code < 400:
            raise HTTPException(403, detail={"error_code": "REDIRECT_NOT_ALLOWED", "message": "Redirects are not allowed"})
        if resp.status_code >= 400:
            raise HTTPException(502, detail={"error_code": "UPSTREAM_ERROR", "message": f"Upstream returned {resp.status_code}"})

        content_type = resp.headers.get("content-type", "application/octet-stream")
        cache_control = resp.headers.get("cache-control", "private, max-age=3600")

        return Response(
            content=resp.content,
            media_type=content_type,
            headers={
                "Cache-Control": cache_control,
                "Content-Length": str(len(resp.content)),
            },
        )

    @router.post("/v1/parse-pdf")
    async def parse_pdf(
        authorization: str | None = Header(default=None),
        file: UploadFile = File(...),
        provider_id: str = Form("unpdf"),
    ) -> dict:
        """Parse a PDF file and extract text content."""
        require_token(settings, authorization)

        if not file.filename or not file.filename.lower().endswith(".pdf"):
            raise HTTPException(400, detail={"error_code": "INVALID_FILE", "message": "File must be a PDF"})

        content = await file.read()
        if len(content) > 50 * 1024 * 1024:  # 50MB limit
            raise HTTPException(400, detail={"error_code": "FILE_TOO_LARGE", "message": "PDF file exceeds 50MB limit"})

        # Try to use unpdf (a pure JS/Python PDF parser)
        try:
            import tempfile
            import subprocess
            import json as json_mod

            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(content)
                tmp_path = tmp.name

            # Use pdftotext if available (from poppler-utils)
            try:
                result = subprocess.run(
                    ["pdftotext", "-layout", tmp_path, "-"],
                    capture_output=True, text=True, timeout=30,
                )
                if result.returncode == 0 and result.stdout.strip():
                    text = result.stdout
                    pages = text.split("\f")  # Form feed separates pages
                    page_contents = []
                    for i, page in enumerate(pages):
                        if page.strip():
                            page_contents.append({
                                "page_number": i + 1,
                                "text": page.strip(),
                            })
                    return {
                        "success": True,
                        "pages": page_contents,
                        "total_pages": len(page_contents),
                        "text": text.strip(),
                    }
            except (FileNotFoundError, subprocess.TimeoutExpired):
                pass

            # Fallback: try pypdf
            try:
                from pypdf import PdfReader
                import io

                reader = PdfReader(io.BytesIO(content))
                page_contents = []
                full_text = []
                for i, page in enumerate(reader.pages):
                    text = page.extract_text() or ""
                    if text.strip():
                        page_contents.append({
                            "page_number": i + 1,
                            "text": text.strip(),
                        })
                    full_text.append(text)

                return {
                    "success": True,
                    "pages": page_contents,
                    "total_pages": len(reader.pages),
                    "text": "\n".join(full_text).strip(),
                }
            except ImportError:
                pass

            raise HTTPException(500, detail={
                "error_code": "NO_PDF_PARSER",
                "message": "No PDF parser available. Install pdftotext (poppler-utils) or pypdf.",
            })

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, detail={"error_code": "PARSE_FAILED", "message": str(e)})
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    return router
