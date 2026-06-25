"""
Document Store
==============

本地文件缓存层：上传文件解析后持久化到 .storage/，后续请求通过 document_id 引用。
避免每轮对话都重新传 base64。

关键安全设计：
- document_id = sha256(完整 base64) 的前 16 位，确保内容唯一性
- 每个文档关联 owner_id 和 session_id，读取时校验权限
- 7 天自动过期

存储结构：
  .storage/
    documents/
      {doc_id}.json    # StoredDocument
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

STORAGE_ROOT = os.environ.get("ANOTHERME_STORAGE_ROOT", ".storage")

# 缓存过期时间（7 天）
CACHE_TTL_SECONDS = 7 * 24 * 3600


@dataclass
class StoredDocument:
    """持久化到磁盘的文档记录"""

    document_id: str
    # 权限隔离
    owner_id: str = ""
    session_id: str = ""
    # 文件信息
    filename: str = ""
    mime_type: str = ""
    content_hash: str = ""
    # 提取结果
    extracted_text: str = ""
    chunks: list[str] = field(default_factory=list)
    chunk_metadata: list[dict[str, Any]] = field(default_factory=list)
    # 提取元数据
    total_chars: int = 0
    truncated: bool = False
    error: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    # 时间戳
    created_at: float = 0.0
    last_accessed_at: float = 0.0
    expires_at: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> StoredDocument:
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


class DocumentAccessError(Exception):
    """文档访问被拒绝（无权限或不存在）"""

    pass


class DocumentStore:
    """本地文件缓存，支持 document_id 存取与权限校验。"""

    def __init__(self, root: str = STORAGE_ROOT):
        self._root = Path(root)
        self._docs_dir = self._root / "documents"
        self._docs_dir.mkdir(parents=True, exist_ok=True)

    def _doc_path(self, doc_id: str) -> Path:
        # 防御路径遍历
        safe_id = os.path.basename(doc_id)
        return self._docs_dir / f"{safe_id}.json"

    @staticmethod
    def compute_content_hash(base64_data: str) -> str:
        """基于完整 base64 内容计算 SHA-256。"""
        return hashlib.sha256(base64_data.encode()).hexdigest()

    @staticmethod
    def generate_id_from_hash(content_hash: str) -> str:
        """从内容哈希生成 document_id。"""
        return f"doc_{content_hash[:16]}"

    def store(
        self,
        base64_data: str,
        filename: str,
        mime_type: str,
        extracted_text: str,
        chunks: list[str],
        chunk_metadata: list[dict[str, Any]] | None = None,
        total_chars: int = 0,
        truncated: bool = False,
        error: str = "",
        metadata: dict[str, Any] | None = None,
        owner_id: str = "",
        session_id: str = "",
    ) -> str:
        """
        存储文档并返回 document_id。
        基于完整内容哈希，相同内容复用已有记录。
        关联 owner_id 和 session_id 用于后续权限校验。
        """
        content_hash = self.compute_content_hash(base64_data)
        doc_id = self.generate_id_from_hash(content_hash)
        now = time.time()

        # 检查是否已存在
        existing = self.get(doc_id, owner_id=owner_id, session_id=session_id)
        if existing and existing.content_hash == content_hash:
            existing.last_accessed_at = now
            self._save(existing)
            logger.info("[DocumentStore] 复用已有文档 %s (%s)", doc_id, filename)
            return doc_id

        doc = StoredDocument(
            document_id=doc_id,
            owner_id=owner_id,
            session_id=session_id,
            filename=filename,
            mime_type=mime_type,
            content_hash=content_hash,
            extracted_text=extracted_text,
            chunks=chunks,
            chunk_metadata=chunk_metadata or [],
            total_chars=total_chars,
            truncated=truncated,
            error=error,
            metadata=metadata or {},
            created_at=now,
            last_accessed_at=now,
            expires_at=now + CACHE_TTL_SECONDS,
        )
        self._save(doc)
        logger.info(
            "[DocumentStore] 存储文档 %s (%s) owner=%s chars=%d chunks=%d",
            doc_id,
            filename,
            owner_id,
            total_chars,
            len(chunks),
        )
        return doc_id

    def get(
        self,
        doc_id: str,
        *,
        owner_id: str = "",
        session_id: str = "",
    ) -> StoredDocument | None:
        """
        根据 document_id 获取文档，校验权限。

        权限规则：
        - owner_id 匹配 → 允许
        - session_id 匹配 → 允许
        - 文档无 owner → 允许（向后兼容旧数据）

        Raises:
            DocumentAccessError: 权限不足
        """
        path = self._doc_path(doc_id)
        if not path.exists():
            return None

        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            doc = StoredDocument.from_dict(data)

            # 过期检查
            if time.time() > doc.expires_at:
                logger.info("[DocumentStore] 文档 %s 已过期，删除", doc_id)
                path.unlink(missing_ok=True)
                return None

            # 权限校验
            if doc.owner_id and owner_id and doc.owner_id != owner_id:
                # 不同 owner — 除非同一 session 否则拒绝
                same_session = bool(
                    doc.session_id and session_id and doc.session_id == session_id
                )
                if not same_session:
                    logger.warning(
                        "[DocumentStore] 文档 %s 访问被拒绝: owner=%s session=%s (请求 owner=%s session=%s)",
                        doc_id,
                        doc.owner_id,
                        doc.session_id,
                        owner_id,
                        session_id,
                    )
                    raise DocumentAccessError(f"无权访问文档 {doc_id}")

            # 接受同一 session 内的访问（即使 owner 不同）
            if doc.session_id and session_id and doc.session_id == session_id:
                pass  # 同 session 放行

            return doc
        except DocumentAccessError:
            raise
        except Exception as exc:
            logger.warning("[DocumentStore] 读取文档 %s 失败: %s", doc_id, exc)
            return None

    def touch(self, doc_id: str) -> None:
        """更新文档最后访问时间。"""
        try:
            doc = self.get(doc_id)
            if doc:
                doc.last_accessed_at = time.time()
                self._save(doc)
        except DocumentAccessError:
            pass

    def _save(self, doc: StoredDocument) -> None:
        path = self._doc_path(doc.document_id)
        path.write_text(
            json.dumps(doc.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def cleanup_expired(self) -> int:
        """清理过期文档，返回清理数量。"""
        count = 0
        for path in self._docs_dir.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                expires = data.get("expires_at", 0)
                if time.time() > expires:
                    path.unlink()
                    count += 1
            except Exception:
                pass
        if count:
            logger.info("[DocumentStore] 清理了 %d 个过期文档", count)
        return count


# 全局单例
_doc_store: DocumentStore | None = None


def get_document_store() -> DocumentStore:
    global _doc_store
    if _doc_store is None:
        _doc_store = DocumentStore()
    return _doc_store
