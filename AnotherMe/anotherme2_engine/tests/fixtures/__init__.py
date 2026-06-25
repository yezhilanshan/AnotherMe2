"""
测试 Fixtures
============

小的 base64 编码文件片段，用于模拟上传场景。
所有 fixture 都足够小（<1KB），适合单元测试。
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

FIXTURES_DIR = Path(__file__).parent

# ─── base64 编码的测试文件 ─────────────────────────────────────────

# 一个极简 PDF（%PDF-1.4 header + 纯文本内容）
SAMPLE_PDF_BASE64 = (
    "JVBERi0xLjQKMSAwIG9iago8PC9UeXBlIC9DYXRhbG9nIC9QYWdlcyAyIDAgUj4+CmVuZG9iagoy"
    "IDAgb2JqCjw8L1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDE+PgplbmRvYmoKMyAw"
    "IG9iago8PC9UeXBlIC9QYWdlIC9QYXJlbnQgMiAwIFIgL01lZGlhQm94IFswIDAgNjEyIDc5Ml0g"
    "L0NvbnRlbnRzIDQgMCBSIC9SZXNvdXJjZXMgPDwvRm9udCA8PC9GMSA1IDAgUj4+Pj4+CmVuZG9i"
    "ago0IDAgb2JqCjw8L0xlbmd0aCA0Nj4+CnN0cmVhbQpCVAovRjEgMTIgVGYKMCAwIFRkCigAIENo"
    "YXB0ZXIgMS4gSW50cm9kdWN0aW9uIikgVGoKMCAtMTIgVGQKKCAAVGhpcyBpcyBhIHNhbXBsZSBk"
    "b2N1bWVudCBmb3IgdGVzdGluZy4pIFRqCjAgLTEyIFRkCiggIENoYXB0ZXIgMi4gTWV0aG9kcyAp"
    "IFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9U"
    "eXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYT4+CmVuZG9iagp4cmVmCjAgNgoKMDAwMDAwMDAwMCA2"
    "NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDEx"
    "NSAwMDAwMCBuIAowMDAwMDAwMTk1IDAwMDAwIG4gCjAwMDAwMDAyOTMgMDAwMDAgbiAKdHJhaWxl"
    "cgo8PC9TaXplIDYgL1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMzY5CiUlRU9GCg=="
)

# 另一个不同的 PDF
SAMPLE_PDF2_BASE64 = (
    "JVBERi0xLjQKMSAwIG9iago8PC9UeXBlIC9DYXRhbG9nIC9QYWdlcyAyIDAgUj4+CmVuZG9iagoy"
    "IDAgb2JqCjw8L1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDE+PgplbmRvYmoKMyAw"
    "IG9iago8PC9UeXBlIC9QYWdlIC9QYXJlbnQgMiAwIFIgL01lZGlhQm94IFswIDAgNjEyIDc5Ml0g"
    "L0NvbnRlbnRzIDQgMCBSIC9SZXNvdXJjZXMgPDwvRm9udCA8PC9GMSA1IDAgUj4+Pj4+CmVuZG9i"
    "ago0IDAgb2JqCjw8L0xlbmd0aCA0MD4+CnN0cmVhbQpCVAovRjEgMTIgVGYKMCAwIFRkCiggIENo"
    "YXB0ZXIgMy4gUmVzdWx0cyApIFRqCjAgLTEyIFRkCiggIERpZmZlcmVudCBjb250ZW50ICkgVGoK"
    "MCAtMTIgVGQgRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8L1R5cGUgL0ZvbnQgL1N1YnR5"
    "cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhPj4KZW5kb2JqCnhyZWYKMCA2CgowMDAwMDAw"
    "MDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAw"
    "MDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAxOTUgMDAwMDAgbiAKMDAwMDAwMDI4NiAwMDAwMCBuIAp0"
    "cmFpbGVyCjw8L1NpemUgNiAvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgozNjIKJSVFT0YK"
)

# 中文 TXT（UTF-8）
SAMPLE_TXT_UTF8_BASE64 = base64.b64encode(
    "第一章 引言\n\n这是一份测试文档。\n\n第二章 方法\n\n我们采用了基于深度学习的分析方法。\n\n"
    "第三章 结果\n\n实验表明该方法在准确率上提升了15%。\n\n关键词：深度学习、自然语言处理、测试".encode(
        "utf-8"
    )
).decode()

# 中文 TXT（GBK 编码）
SAMPLE_TXT_GBK_BASE64 = base64.b64encode(
    "第一章 引言\n\n这是一份GBK编码的测试文档。\n\n第二章 方法\n\n使用传统机器学习方法。".encode(
        "gbk"
    )
).decode()

# 模拟 base64（非法）
INVALID_BASE64 = "!!!not-valid-base64!!!"

# 大文件模拟（3000+ 字符）
LARGE_TEXT = "测试内容。" * 600  # ~3600 chars — not large enough (MAX_FILE_CHARS=30000)
VERY_LARGE_TEXT = "测试内容。" * 10000  # ~60000 chars, exceeds MAX_FILE_CHARS
LARGE_TXT_BASE64 = base64.b64encode(VERY_LARGE_TEXT.encode("utf-8")).decode()


# ─── chunk 测试数据 ─────────────────────────────────────────────────

# 模拟一份文档的 chunks
SAMPLE_CHUNKS = [
    "第一章 引言。本文研究深度学习在自然语言处理中的应用。",
    "第二章 方法。我们采用了Transformer架构进行文本分类。使用预训练模型BERT作为基础。",
    "第三章 实验结果。在SST-2数据集上准确率达到94.2%，超过基准模型3个百分点。",
    "第四章 讨论。实验表明注意力机制对长文本理解有显著帮助。未来工作将探索更大规模预训练。",
    "参考文献。Vaswani et al., Attention Is All You Need, 2017.",
]

SAMPLE_CHUNK_META = [
    {"page": 1, "source": "pdf_page_1"},
    {"page": 3, "source": "pdf_page_3"},
    {"page": 5, "source": "pdf_page_5", "section_title": "实验结果"},
    {"page": 7, "source": "pdf_page_7", "section_title": "讨论"},
    {"page": 10, "source": "pdf_page_10"},
]

# XLSX chunks
XLSX_CHUNKS = [
    "姓名 | 成绩 | 班级\n张三 | 95 | 1班\n李四 | 87 | 2班\n王五 | 92 | 1班",
    "姓名 | 成绩 | 班级\n赵六 | 78 | 3班\n孙七 | 88 | 2班",
]

XLSX_CHUNK_META = [
    {"sheet_name": "Sheet1", "row_count": 200},
    {"sheet_name": "Sheet1", "row_count": 200},
]

# 空内容
EMPTY_CHUNKS: list[str] = []

# ─── document_store 测试数据 ────────────────────────────────────────

SAMPLE_BASE64_1 = base64.b64encode(
    b"unique-document-content-1-with-more-bytes-to-be-unique"
).decode()
SAMPLE_BASE64_2 = base64.b64encode(
    b"unique-document-content-2-completely-different-data"
).decode()


# ─── 辅助函数 ───────────────────────────────────────────────────────


def make_extraction_info(
    total_chars: int = 1000,
    truncated: bool = False,
    chunks: list | None = None,
    metadata: dict | None = None,
) -> dict:
    """构建标准的 extraction_info dict，模拟 _process_file_attachments 的输出。"""
    info: dict = {
        "total_chars": total_chars,
        "chunks": len(chunks) if chunks else 0,
        "truncated": truncated,
        "metadata": metadata or {},
    }
    if chunks:
        info["chunks_list"] = [{"text": c, "page": 0, "source": "test"} for c in chunks]
    return info
