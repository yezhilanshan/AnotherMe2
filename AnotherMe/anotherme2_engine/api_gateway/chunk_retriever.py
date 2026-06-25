"""
Chunk Retriever
===============

基于关键词倒排索引的轻量 chunk 检索。
不依赖向量数据库，适合 MVP 阶段。

后续可升级为 embedding 检索（FAISS / Chroma）。
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

# 中文分词正则：按标点、空格切分
_WORD_SPLIT_RE = re.compile(r"[\s，,。.!！?？；;：:、\n]+")
# 最少关键词长度
_MIN_WORD_LEN = 1


@dataclass
class ScoredChunk:
    """带相关性评分和来源元数据的 chunk"""

    text: str
    score: float
    chunk_index: int
    metadata: dict[str, Any] | None = None
    # 引用信息
    chunk_id: str = ""
    filename: str = ""
    page: int | None = None
    sheet_name: str | None = None
    row_start: int | None = None
    section_title: str | None = None


def _tokenize(text: str) -> list[str]:
    """简单分词：按标点和空格切分。"""
    # 中文：字符级 bigram 作为伪分词
    cleaned = text.strip().lower()
    # 提取中文和英文单词
    zh_chars = re.findall(r"[\u4e00-\u9fff]", cleaned)
    en_words = re.findall(r"[a-zA-Z0-9]+", cleaned)

    tokens: list[str] = []
    # 中文 bigram
    for i in range(len(zh_chars) - 1):
        tokens.append(zh_chars[i] + zh_chars[i + 1])
    # 中文 unigram
    tokens.extend(zh_chars)
    # 英文单词
    tokens.extend(en_words)

    return tokens


def _compute_tf(corpus: list[str]) -> Counter[str]:
    """计算词频。"""
    freq: Counter[str] = Counter()
    for c in corpus:
        freq.update(_tokenize(c))
    return freq


def retrieve_relevant_chunks(
    query: str,
    chunks: list[str],
    chunk_metadata: list[dict[str, Any]] | None = None,
    top_k: int = 4,
    max_chars_per_chunk: int = 3000,
    filename: str = "",
    document_id: str = "",
) -> list[ScoredChunk]:
    """
    基于 TF 加权的关键词检索，返回 top-k 相关 chunk。

    参数:
      query: 用户问题
      chunks: 文档分块列表
      chunk_metadata: 每个 chunk 的元数据 (page, source, sheet_name 等)
      top_k: 返回最多几个 chunk
      max_chars_per_chunk: 单个 chunk 截断长度
      filename: 文档名（用于引用）
      document_id: 文档 ID（用于生成 chunk_id）
    """
    if not chunks or not query.strip():
        return []

    query_tokens = _tokenize(query)
    if not query_tokens:
        return []

    # 查询词权重：所有词权重相同
    query_weight = Counter(query_tokens)

    scored: list[ScoredChunk] = []
    meta_list = chunk_metadata or [{}] * len(chunks)

    for idx, chunk in enumerate(chunks):
        chunk_tokens = _tokenize(chunk)
        if not chunk_tokens:
            continue

        chunk_counter = Counter(chunk_tokens)

        # TF 得分
        score = 0.0
        chunk_len = max(len(chunk_tokens), 1)

        for token, q_weight in query_weight.items():
            if token in chunk_counter:
                tf = chunk_counter[token] / chunk_len
                score += tf * q_weight

        # BM25 式长度归一化（简化版）
        avg_len = max(sum(len(_tokenize(c)) for c in chunks) / max(len(chunks), 1), 1)
        k1 = 1.5
        b = 0.75
        len_ratio = len(chunk_tokens) / avg_len
        score = score * (k1 + 1) / (score + k1 * (1 - b + b * len_ratio))

        if score > 0:
            truncated = chunk[:max_chars_per_chunk]
            if len(chunk) > max_chars_per_chunk:
                truncated += f"\n…[chunk 过长，截断至 {max_chars_per_chunk} 字符]"

            meta = meta_list[idx] if idx < len(meta_list) else {}
            scored.append(
                ScoredChunk(
                    text=truncated,
                    score=score,
                    chunk_index=idx,
                    metadata=meta,
                    chunk_id=f"{document_id}_c{idx:03d}" if document_id else "",
                    filename=filename,
                    page=meta.get("page")
                    if isinstance(meta.get("page"), int)
                    else None,
                    sheet_name=meta.get("sheet_name")
                    if isinstance(meta.get("sheet_name"), str)
                    else None,
                    row_start=meta.get("row_start")
                    if isinstance(meta.get("row_start"), int)
                    else None,
                    section_title=meta.get("section_title")
                    if isinstance(meta.get("section_title"), str)
                    else None,
                )
            )

    # 按得分降序
    scored.sort(key=lambda x: x.score, reverse=True)

    if scored:
        logger.info(
            "[ChunkRetriever] query='%s' → top-%d chunks (scores: %s)",
            query[:80],
            min(top_k, len(scored)),
            [f"{c.score:.3f}" for c in scored[:top_k]],
        )

    return scored[:top_k]


def format_retrieved_chunks(scored_chunks: list[ScoredChunk]) -> str:
    """
    将检索结果格式化为 LLM prompt 上下文，含引用标记。
    要求 LLM 在回答中引用来源。
    """
    if not scored_chunks:
        return ""

    parts: list[str] = []
    parts.append(
        "*以下为文档中与问题相关的片段。"
        "如果你的回答依据了这些内容，请尽量指出文件名、页码或表格位置。"
        "引用格式示例：「根据 homework.pdf 第 3 页」「如 Sheet1 表格所示」*"
    )

    for i, sc in enumerate(scored_chunks):
        # 构建引用标签
        cite_parts: list[str] = []
        if sc.filename:
            cite_parts.append(f"file: {sc.filename}")
        if sc.page is not None:
            cite_parts.append(f"page: {sc.page}")
        if sc.sheet_name:
            cite_parts.append(f"sheet: {sc.sheet_name}")
        if sc.chunk_id:
            cite_parts.insert(0, f"chunk_id: {sc.chunk_id}")

        cite_label = " | ".join(cite_parts) if cite_parts else f"片段 {i + 1}"

        header = f"[{cite_label}]（相关度: {sc.score:.2f}）"
        parts.append(f"{header}\n{sc.text}")

    return "\n\n---\n\n".join(parts)
