import pytest

book_engine = pytest.importorskip("tutor_engine.book.engine")
book_models = pytest.importorskip("tutor_engine.book.models")

BookEngine = book_engine.BookEngine
BookProposal = book_models.BookProposal


def test_fallback_spine_uses_proposal_chapter_count():
    engine = BookEngine()
    proposal = BookProposal(
        title="勾股定理",
        description="从直观理解到实际应用",
        scope="初中数学",
        target_level="初学者",
        estimated_chapters=4,
        rationale="用户需要可编辑的基础目录",
    )

    spine = engine._fallback_spine(book_id="book-test", proposal=proposal)

    assert spine.book_id == "book-test"
    assert len(spine.chapters) == 4
    assert len(spine.concept_graph.nodes) == 4
    assert len(spine.concept_graph.edges) == 3
    assert all(chapter.title.startswith("勾股定理") for chapter in spine.chapters)
    assert spine.chapters[0].order == 0
    assert spine.chapters[-1].order == 3


def test_fallback_spine_bounds_invalid_chapter_count():
    engine = BookEngine()
    proposal = BookProposal(title="Transformer", estimated_chapters=0)

    spine = engine._fallback_spine(book_id="book-test", proposal=proposal)

    assert len(spine.chapters) == 5
    assert spine.chapters[0].title == "Transformer: Foundations"
