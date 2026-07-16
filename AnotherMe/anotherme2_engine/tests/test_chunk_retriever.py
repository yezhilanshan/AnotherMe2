"""
test_chunk_retriever.py
=======================

测试关键词检索：中文分词、相关性排序、引用元数据。
"""

from __future__ import annotations

import pytest
from api_gateway.chunk_retriever import (
    ScoredChunk,
    _tokenize,
    format_retrieved_chunks,
    retrieve_relevant_chunks,
)

from tests.fixtures import (
    EMPTY_CHUNKS,
    SAMPLE_CHUNK_META,
    SAMPLE_CHUNKS,
    XLSX_CHUNK_META,
    XLSX_CHUNKS,
)

# ─── 分词 ───────────────────────────────────────────────────────────


def test_tokenize_chinese_bigram():
    """中文 bigram 分词"""
    tokens = _tokenize("深度学习方法")
    assert "深度" in tokens
    assert "学习" in tokens
    assert "习方" in tokens or "方法" in tokens


def test_tokenize_mixed_cn_en():
    """中英混合分词"""
    tokens = _tokenize("Transformer架构")
    assert "transformer" in tokens
    assert "架构" in tokens


# ─── 检索质量 ───────────────────────────────────────────────────────


def test_retrieve_returns_top_k():
    """检索返回不超过 top_k 个结果"""
    results = retrieve_relevant_chunks(
        "第二章的方法",
        SAMPLE_CHUNKS,
        SAMPLE_CHUNK_META,
        top_k=2,
    )
    assert len(results) <= 2


def test_retrieve_chinese_query_hits_correct():
    """中文查询命中正确的 chunk"""
    results = retrieve_relevant_chunks(
        "Transformer",
        SAMPLE_CHUNKS,
        SAMPLE_CHUNK_META,
        top_k=2,
    )
    assert len(results) > 0
    # 应该命中第 2 个 chunk（含 "Transformer"）
    assert any("Transformer" in r.text for r in results)


def test_retrieve_scores_are_descending():
    """检索结果按得分降序"""
    results = retrieve_relevant_chunks(
        "深度学习",
        SAMPLE_CHUNKS,
        SAMPLE_CHUNK_META,
        top_k=4,
    )
    scores = [r.score for r in results]
    assert scores == sorted(scores, reverse=True)


def test_empty_query_returns_empty():
    """空查询返回空列表"""
    results = retrieve_relevant_chunks("", SAMPLE_CHUNKS, SAMPLE_CHUNK_META)
    assert results == []


def test_empty_chunks_returns_empty():
    """空 chunks 返回空列表"""
    results = retrieve_relevant_chunks("测试", EMPTY_CHUNKS, [])
    assert results == []


def test_retrieve_without_meta():
    """chunk_metadata 为 None 时也能正常工作"""
    results = retrieve_relevant_chunks("Transformer", SAMPLE_CHUNKS, None, top_k=2)
    assert len(results) > 0


# ─── 引用元数据 ─────────────────────────────────────────────────────


def test_scored_chunk_has_filename():
    """检索结果包含文件名"""
    results = retrieve_relevant_chunks(
        "Transformer",
        SAMPLE_CHUNKS,
        SAMPLE_CHUNK_META,
        filename="homework.pdf",
        document_id="doc_abc",
    )
    for r in results:
        assert r.filename == "homework.pdf"


def test_scored_chunk_has_chunk_id():
    """检索结果包含 chunk_id"""
    results = retrieve_relevant_chunks(
        "Transformer",
        SAMPLE_CHUNKS,
        SAMPLE_CHUNK_META,
        document_id="doc_abc",
    )
    for r in results:
        assert r.chunk_id
        assert r.chunk_id.startswith("doc_abc_c")


def test_scored_chunk_has_page():
    """检索结果包含页码"""
    results = retrieve_relevant_chunks(
        "Transformer",
        SAMPLE_CHUNKS,
        SAMPLE_CHUNK_META,
    )
    for r in results:
        assert r.page is not None


def test_xlsx_chunk_has_sheet_name():
    """XLSX chunk 包含 sheet_name"""
    results = retrieve_relevant_chunks(
        "张三",
        XLSX_CHUNKS,
        XLSX_CHUNK_META,
    )
    assert len(results) > 0
    # XLSX chunk 应有 sheet_name
    for r in results:
        assert r.sheet_name


# ─── prompt 格式化 ──────────────────────────────────────────────────


def test_format_retrieved_chunks_includes_citation():
    """格式化结果包含引用标记"""
    results = retrieve_relevant_chunks(
        "Transformer BERT",
        SAMPLE_CHUNKS,
        SAMPLE_CHUNK_META,
        filename="paper.pdf",
        document_id="doc_abc",
    )
    formatted = format_retrieved_chunks(results)

    assert "file: paper.pdf" in formatted
    if any(r.page for r in results):
        assert "page:" in formatted
    assert "chunk_id:" in formatted


def test_format_retrieved_chunks_has_citation_instruction():
    """格式化结果包含引用指引"""
    formatted = format_retrieved_chunks([])
    assert formatted == ""  # 空列表返回空

    results = retrieve_relevant_chunks(
        "Transformer BERT 深度学习", SAMPLE_CHUNKS, SAMPLE_CHUNK_META
    )
    formatted = format_retrieved_chunks(results)
    # 应该包含引用指引
    assert "文件名" in formatted or "页码" in formatted or "file:" in formatted


def test_format_empty_chunks():
    """空 chunks 格式化返回空字符串"""
    assert format_retrieved_chunks([]) == ""


def test_retrieve_top_1():
    """top_k=1 只返回一个结果"""
    results = retrieve_relevant_chunks(
        "BERT",
        SAMPLE_CHUNKS,
        SAMPLE_CHUNK_META,
        top_k=1,
    )
    assert len(results) == 1


def test_max_chars_truncation():
    """chunk 超过 max_chars 时被截断"""
    results = retrieve_relevant_chunks(
        "Transformer",
        SAMPLE_CHUNKS,
        SAMPLE_CHUNK_META,
        max_chars_per_chunk=10,
    )
    for r in results:
        # 截断后的文本应包含截断提示，且实际内容不超过 max_chars
        assert "截断" in r.text or "…" in r.text or len(r.text) < 50  # 大幅小于原 chunk
