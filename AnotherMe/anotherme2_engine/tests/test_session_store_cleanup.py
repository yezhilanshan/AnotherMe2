import asyncio

from api_gateway.db import session_scope
from api_gateway.models import AIChatMessage, AIChatSession, AIChatTurn
from tutor_engine.services.session.sqlite_store import SQLiteSessionStore


class FakeAttachmentStore:
    def __init__(self) -> None:
        self.deleted_sessions: list[str] = []

    async def delete_session(self, session_id: str) -> None:
        self.deleted_sessions.append(session_id)


def test_delete_session_cleans_attachment_store(monkeypatch, tmp_path):
    fake_store = FakeAttachmentStore()
    monkeypatch.setattr(
        "tutor_engine.services.storage.get_attachment_store",
        lambda: fake_store,
    )

    store = SQLiteSessionStore(db_path=tmp_path / "chat_history.db")

    asyncio.run(store.create_session(session_id="sess-cleanup"))
    deleted = asyncio.run(store.delete_session("sess-cleanup"))

    assert deleted is True
    assert asyncio.run(store.get_session("sess-cleanup")) is None
    assert fake_store.deleted_sessions == ["sess-cleanup"]


def test_delete_missing_session_does_not_clean_attachment_store(monkeypatch, tmp_path):
    fake_store = FakeAttachmentStore()
    monkeypatch.setattr(
        "tutor_engine.services.storage.get_attachment_store",
        lambda: fake_store,
    )

    store = SQLiteSessionStore(db_path=tmp_path / "chat_history.db")

    deleted = asyncio.run(store.delete_session("missing-session"))

    assert deleted is False
    assert fake_store.deleted_sessions == []


def test_session_store_persists_to_gateway_ai_chat_tables(tmp_path):
    store = SQLiteSessionStore(db_path=tmp_path / "gateway-chat.db")

    session_data = asyncio.run(
        store.create_session(session_id="sess-unified", title="Unified")
    )
    message_seq = asyncio.run(
        store.add_message("sess-unified", "user", "hello unified database")
    )
    turn = asyncio.run(store.create_turn("sess-unified", capability="chat"))
    asyncio.run(store.update_turn_status(turn["turn_id"], "completed"))

    assert session_data["session_id"] == "sess-unified"
    assert message_seq == 1

    with session_scope() as db:
        chat_session = db.get(AIChatSession, "sess-unified")
        assert chat_session is not None
        assert chat_session.title == "Unified"

        message = (
            db.query(AIChatMessage)
            .filter(AIChatMessage.session_id == "sess-unified")
            .one()
        )
        assert message.runtime_seq == 1
        assert message.content == "hello unified database"

        stored_turn = db.get(AIChatTurn, turn["turn_id"])
        assert stored_turn is not None
        assert stored_turn.status == "completed"
