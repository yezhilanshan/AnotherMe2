"""
test_document_store.py
=====================

测试 document_id 哈希、权限隔离、过期机制。
"""

from __future__ import annotations

import time

import pytest
from api_gateway.document_store import (
    DocumentAccessError,
    DocumentStore,
    get_document_store,
)
from tests.fixtures import SAMPLE_BASE64_1, SAMPLE_BASE64_2, SAMPLE_CHUNKS

# 每个测试用独立的存储根目录，避免互相污染
_counter = 0


def _new_store() -> DocumentStore:
    global _counter
    _counter += 1
    import os
    import tempfile

    root = os.path.join(tempfile.gettempdir(), f"test_docstore_{_counter}")
    return DocumentStore(root=root)


# ─── 哈希与 ID 生成 ────────────────────────────────────────────────


def test_same_content_returns_same_id():
    """同一 base64 内容多次存储，返回相同 document_id"""
    store = _new_store()

    id1 = store.store(
        SAMPLE_BASE64_1,
        "test.pdf",
        "application/pdf",
        "extracted text",
        ["chunk1"],
        total_chars=100,
    )
    id2 = store.store(
        SAMPLE_BASE64_1,
        "test.pdf",
        "application/pdf",
        "extracted text",
        ["chunk1"],
        total_chars=100,
    )

    assert id1 == id2
    assert id1.startswith("doc_")


def test_different_content_returns_different_id():
    """不同内容返回不同的 document_id"""
    store = _new_store()

    id1 = store.store(SAMPLE_BASE64_1, "a.pdf", "application/pdf", "text", ["c1"])
    id2 = store.store(SAMPLE_BASE64_2, "b.pdf", "application/pdf", "text", ["c1"])

    assert id1 != id2


def test_content_hash_is_deterministic():
    """同一 base64 的哈希值稳定"""
    h1 = DocumentStore.compute_content_hash(SAMPLE_BASE64_1)
    h2 = DocumentStore.compute_content_hash(SAMPLE_BASE64_1)
    assert h1 == h2
    assert len(h1) == 64  # SHA-256


def test_different_filename_same_content_same_id():
    """相同内容不同文件名，仍返回相同 ID"""
    store = _new_store()

    id1 = store.store(
        SAMPLE_BASE64_1, "homework.pdf", "application/pdf", "text", ["c1"]
    )
    id2 = store.store(SAMPLE_BASE64_1, "renamed.pdf", "application/pdf", "text", ["c1"])

    assert id1 == id2


# ─── 权限隔离 ──────────────────────────────────────────────────────


def test_owner_match_allows_access():
    """owner 匹配时允许访问"""
    store = _new_store()
    doc_id = store.store(
        SAMPLE_BASE64_1,
        "test.pdf",
        "application/pdf",
        "text",
        SAMPLE_CHUNKS,
        owner_id="user_A",
    )
    doc = store.get(doc_id, owner_id="user_A")
    assert doc is not None
    assert doc.filename == "test.pdf"


def test_wrong_owner_denies_access():
    """owner 不匹配且 session 也不匹配时抛出 DocumentAccessError"""
    store = _new_store()
    doc_id = store.store(
        SAMPLE_BASE64_1,
        "test.pdf",
        "application/pdf",
        "text",
        SAMPLE_CHUNKS,
        owner_id="user_A",
    )

    with pytest.raises(DocumentAccessError):
        store.get(doc_id, owner_id="user_B")


def test_same_session_allows_access():
    """同一 session 内的不同 owner 也允许访问"""
    store = _new_store()
    doc_id = store.store(
        SAMPLE_BASE64_1,
        "test.pdf",
        "application/pdf",
        "text",
        SAMPLE_CHUNKS,
        owner_id="user_A",
        session_id="sess_shared",
    )

    # user_B 在同 session 中访问
    doc = store.get(doc_id, owner_id="user_B", session_id="sess_shared")
    assert doc is not None


def test_no_owner_legacy_compat():
    """旧数据无 owner 时允许任何人访问（向后兼容）"""
    store = _new_store()
    doc_id = store.store(
        SAMPLE_BASE64_1, "test.pdf", "application/pdf", "text", SAMPLE_CHUNKS
    )  # 不设 owner

    doc = store.get(doc_id, owner_id="anyone")
    assert doc is not None


def test_document_access_error_does_not_crash():
    """DocumentAccessError 被正常抛出，可被上层捕获"""
    store = _new_store()
    doc_id = store.store(
        SAMPLE_BASE64_1,
        "test.pdf",
        "application/pdf",
        "text",
        SAMPLE_CHUNKS,
        owner_id="user_A",
    )

    caught = False
    try:
        store.get(doc_id, owner_id="user_B")
    except DocumentAccessError:
        caught = True
    assert caught, "Expected DocumentAccessError was not raised"


# ─── 过期机制 ──────────────────────────────────────────────────────


def test_expired_document_returns_none():
    """过期文档返回 None"""
    store = _new_store()
    doc_id = store.store(
        SAMPLE_BASE64_1, "test.pdf", "application/pdf", "text", SAMPLE_CHUNKS
    )

    # 手动修改过期时间为过去
    doc = store.get(doc_id)
    assert doc is not None
    doc._expires_at = time.time() - 100  # 直接改属性绕过检查
    import json

    path = store._doc_path(doc_id)
    data = json.loads(path.read_text(encoding="utf-8"))
    data["expires_at"] = time.time() - 100
    path.write_text(json.dumps(data), encoding="utf-8")

    doc2 = store.get(doc_id)
    assert doc2 is None  # 过期应返回 None


def test_touch_updates_access_time():
    """touch 更新最后访问时间"""
    store = _new_store()
    doc_id = store.store(
        SAMPLE_BASE64_1, "test.pdf", "application/pdf", "text", SAMPLE_CHUNKS
    )

    doc_before = store.get(doc_id)
    assert doc_before is not None
    old_time = doc_before.last_accessed_at

    time.sleep(0.01)  # 确保时间差
    store.touch(doc_id)

    doc_after = store.get(doc_id)
    assert doc_after is not None
    assert doc_after.last_accessed_at > old_time


# ─── 边界情况 ──────────────────────────────────────────────────────


def test_nonexistent_document():
    """不存在的文档返回 None"""
    store = _new_store()
    doc = store.get("doc_nonexistent")
    assert doc is None


def test_illegal_document_id_path_traversal():
    """路径遍历攻击被防御"""
    store = _new_store()
    doc = store.get("../../../etc/passwd")
    assert doc is None  # 不应崩溃


def test_store_and_retrieve_metadata():
    """存储和恢复元数据完整性"""
    store = _new_store()
    meta = {"page_count": 10, "scanned": False}
    doc_id = store.store(
        SAMPLE_BASE64_1,
        "test.pdf",
        "application/pdf",
        "extracted text",
        ["chunk1", "chunk2"],
        chunk_metadata=[{"page": 1}, {"page": 2}],
        total_chars=500,
        truncated=False,
        metadata=meta,
        owner_id="user_X",
        session_id="sess_1",
    )

    doc = store.get(doc_id, owner_id="user_X")
    assert doc is not None
    assert doc.filename == "test.pdf"
    assert doc.owner_id == "user_X"
    assert doc.session_id == "sess_1"
    assert doc.total_chars == 500
    assert doc.truncated is False
    assert doc.chunks == ["chunk1", "chunk2"]
    assert doc.chunk_metadata == [{"page": 1}, {"page": 2}]
    assert doc.metadata == meta
