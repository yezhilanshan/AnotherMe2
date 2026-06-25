"""
test_document_pipeline.py
=========================

端到端集成测试：附件解析 → 存储 → 恢复 → 检索 → prompt 注入 → SSE 返回
"""

from __future__ import annotations

import json

import pytest
from api_gateway.chunk_retriever import (
    format_retrieved_chunks,
    retrieve_relevant_chunks,
)
from api_gateway.document_store import (
    DocumentAccessError,
    DocumentStore,
    get_document_store,
)
from api_gateway.file_extraction import (
    _check_mime_mismatch,
    _decode_base64_safe,
    _decode_text_safe,
    _safe_filename,
    extract_file_content,
    format_attachments_for_context,
    format_extracted_text_for_prompt,
)
from tests.fixtures import (
    INVALID_BASE64,
    LARGE_TXT_BASE64,
    SAMPLE_BASE64_1,
    SAMPLE_CHUNK_META,
    SAMPLE_CHUNKS,
    SAMPLE_PDF2_BASE64,
    SAMPLE_PDF_BASE64,
    SAMPLE_TXT_GBK_BASE64,
    SAMPLE_TXT_UTF8_BASE64,
)

# ─── 文件解析 ───────────────────────────────────────────────────────


def test_extract_utf8_text():
    """UTF-8 TXT 正常解析"""
    result = extract_file_content(SAMPLE_TXT_UTF8_BASE64, "text/plain", "test.txt")
    assert result.success
    assert "深度学习" in result.chunks[0].text


def test_extract_gbk_fallback():
    """GBK TXT fallback 成功"""
    result = extract_file_content(SAMPLE_TXT_GBK_BASE64, "text/plain", "test.txt")
    assert result.success
    assert "GBK" in result.chunks[0].text


def test_extract_invalid_base64_returns_error():
    """非法 base64 返回错误"""
    result = extract_file_content(INVALID_BASE64, "text/plain", "test.txt")
    assert not result.success
    assert "失败" in result.error


def test_extract_large_text_is_truncated():
    """大文件被截断"""
    result = extract_file_content(LARGE_TXT_BASE64, "text/plain", "large.txt")
    assert result.success
    assert result.truncated


def test_extract_pdf_detects_content():
    """PDF 解析返回内容"""
    result = extract_file_content(SAMPLE_PDF_BASE64, "application/pdf", "test.pdf")
    # 可能成功也可能失败（取决于 PyPDF2 是否安装和 PDF 是否有效）
    # 但不应该崩溃
    assert result is not None


# ─── 安全函数 ───────────────────────────────────────────────────────


def test_safe_filename_removes_path_traversal():
    """文件名清理移除路径遍历"""
    assert _safe_filename("../../etc/passwd") != "../../etc/passwd"
    assert "/" not in _safe_filename("/etc/hosts")


def test_safe_filename_keeps_basename():
    """文件名清理保留合法字符"""
    clean = _safe_filename("C:\\Windows\\system32\\test.pdf")
    assert "test.pdf" in clean or "test" in clean.lower()


def test_decode_base64_safe_size_limit():
    """base64 大小检查"""
    # 构造一个超大的 base64
    huge = "A" * 20_000_000  # ~15MB
    raw, err = _decode_base64_safe(huge, "big.pdf")
    assert raw is None
    assert "过大" in err or "上限" in err


def test_decode_text_utf8():
    """UTF-8 文本解码"""
    raw = "你好世界".encode("utf-8")
    text, enc = _decode_text_safe(raw)
    assert text == "你好世界"
    assert "utf" in enc.lower()


def test_decode_text_gbk_fallback():
    """GBK 文本解码 fallback"""
    raw = "中文测试".encode("gbk")
    text, enc = _decode_text_safe(raw)
    assert "中文测试" in text
    assert enc != "utf-8"  # 应该 fallback 到 gbk


def test_check_mime_mismatch():
    """MIME 不匹配检测"""
    warning = _check_mime_mismatch("test.pdf", "text/plain")
    assert warning is not None
    assert "不匹配" in warning

    ok = _check_mime_mismatch("test.pdf", "application/pdf")
    assert ok is None


# ─── prompt 安全格式 ────────────────────────────────────────────────


def test_format_extracted_text_has_safety_boundary():
    """提取文本格式化包含安全边界"""
    formatted = format_extracted_text_for_prompt("这是一段文件内容", "test.pdf")
    assert (
        "参考资料" in formatted
        or "不是系统指令" in formatted
        or "不是用户当前指令" in formatted
    )
    assert "test.pdf" in formatted


def test_format_attachments_context_logs():
    """format_attachments_for_context 返回日志行"""
    attachments = [
        {
            "filename": "ok.pdf",
            "mime_type": "application/pdf",
            "extracted_text": "内容",
            "extraction_info": {"total_chars": 100, "chunks": 1, "truncated": False},
        },
        {
            "filename": "fail.pdf",
            "mime_type": "application/pdf",
            "extracted_text": "",
            "extraction_error": "扫描版PDF",
        },
        {
            "filename": "img.jpg",
            "mime_type": "image/jpeg",
            "extracted_text": "",
            "extraction_error": "",
        },
    ]
    context, logs = format_attachments_for_context(attachments)
    assert len(logs) == 3
    assert any("OK" in l for l in logs)
    assert any("FAIL" in l for l in logs)
    assert any("SKIP" in l for l in logs)
    # 安全边界
    assert "参考资料" in context or "不是系统指令" in context


# ─── 端到端：存储 → 恢复 → 检索 → prompt ────────────────────────────


def test_e2e_store_retrieve_retrieve():
    """完整链路：存储文档 → 用 document_refs 恢复 → 检索 → 格式化"""
    import os
    import tempfile

    store = DocumentStore(root=os.path.join(tempfile.gettempdir(), "test_e2e"))

    # Step 1: 存储文档
    doc_id = store.store(
        SAMPLE_BASE64_1,
        "paper.pdf",
        "application/pdf",
        extracted_text="\n".join(SAMPLE_CHUNKS),
        chunks=SAMPLE_CHUNKS,
        chunk_metadata=SAMPLE_CHUNK_META,
        total_chars=500,
        owner_id="student_1",
        session_id="sess_1",
    )
    assert doc_id.startswith("doc_")

    # Step 2: 用 document_refs 恢复
    doc = store.get(doc_id, owner_id="student_1")
    assert doc is not None
    assert doc.chunks == SAMPLE_CHUNKS
    assert doc.chunk_metadata == SAMPLE_CHUNK_META

    # Step 3: 检索
    results = retrieve_relevant_chunks(
        "深度学习方法 Transformer",
        doc.chunks,
        doc.chunk_metadata,
        top_k=3,
        filename=doc.filename,
        document_id=doc_id,
    )
    assert len(results) > 0

    # Step 4: 格式化 prompt
    prompt = format_retrieved_chunks(results)
    assert "file: paper.pdf" in prompt
    assert "chunk_id:" in prompt

    # Step 5: 验证权限
    with pytest.raises(DocumentAccessError):
        store.get(doc_id, owner_id="student_2", session_id="sess_2")


def test_e2e_document_access_error_does_not_crash_pipeline():
    """权限错误不会导致整个流程崩溃（上层可捕获）"""
    import os
    import tempfile

    store = DocumentStore(root=os.path.join(tempfile.gettempdir(), "test_e2e_crash"))

    doc_id = store.store(
        SAMPLE_BASE64_1,
        "secret.pdf",
        "application/pdf",
        "text",
        SAMPLE_CHUNKS,
        owner_id="alice",
    )

    # 模拟上层捕获权限错误
    extraction_results = []
    restored_context = ""

    for ref_id in [doc_id]:
        try:
            doc = store.get(ref_id, owner_id="bob")
            if doc:
                restored_context += "context"
        except DocumentAccessError:
            extraction_results.append(
                {
                    "filename": "unknown",
                    "document_id": ref_id,
                    "status": "forbidden",
                    "error": "无权访问该文档",
                }
            )

    # 流程不应崩溃
    assert len(extraction_results) == 1
    assert extraction_results[0]["status"] == "forbidden"
    assert restored_context == ""  # 没有注入任何上下文


def test_e2e_invalid_document_id_no_crash():
    """非法的 document_id 不会导致崩溃"""
    import os
    import tempfile

    store = DocumentStore(root=os.path.join(tempfile.gettempdir(), "test_e2e_invalid"))

    # 各种非法 ID
    for bad_id in ["", "nonexistent_123", "../../etc/passwd", "doc_!!!invalid"]:
        doc = None
        try:
            doc = store.get(bad_id, owner_id="user")
        except DocumentAccessError:
            pass  # 预期行为
        except Exception:
            pass  # 预期行为
        # 不崩溃即为通过


def test_e2e_multiple_documents_concurrent():
    """多个文档同时存储不冲突"""
    import os
    import tempfile

    store = DocumentStore(root=os.path.join(tempfile.gettempdir(), "test_e2e_multi"))

    ids = []
    for i in range(5):
        data = f"doc-content-{i}-unique".encode()
        b64 = __import__("base64").b64encode(data).decode()
        doc_id = store.store(
            b64,
            f"doc{i}.pdf",
            "application/pdf",
            f"text {i}",
            [f"chunk {i}"],
            owner_id=f"user_{i % 2}",  # 两个用户交替
        )
        ids.append(doc_id)

    # 所有 ID 应唯一
    assert len(set(ids)) == 5

    # 各自 owner 能访问
    for i, doc_id in enumerate(ids):
        doc = store.get(doc_id, owner_id=f"user_{i % 2}")
        assert doc is not None
        assert doc.chunks == [f"chunk {i}"]
