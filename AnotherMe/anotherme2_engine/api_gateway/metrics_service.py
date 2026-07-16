"""Learning evaluation metrics service.

Provides aggregated metrics for evaluating the effectiveness of personalized teaching.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, and_
from sqlalchemy.orm import Session

from .models import KnowledgeTraceEvent, LearningEvent, StudentKnowledgeState


def _utcnow() -> datetime:
    return datetime.utcnow()


def get_accuracy_trend(
    session: Session,
    *,
    user_id: str,
    knowledge_point_id: str | None = None,
    days: int = 30,
) -> dict[str, Any]:
    """Get per-day accuracy trend from KnowledgeTraceEvent.

    Returns: { trend: [{date, total, correct, accuracy}], summary: {...} }
    """
    cutoff = _utcnow() - timedelta(days=days)
    query = session.query(KnowledgeTraceEvent).filter(
        KnowledgeTraceEvent.user_id == user_id,
        KnowledgeTraceEvent.event_type == "quiz_answered",
        KnowledgeTraceEvent.created_at >= cutoff,
    )
    if knowledge_point_id:
        query = query.filter(KnowledgeTraceEvent.knowledge_point_id == knowledge_point_id)

    events = query.order_by(KnowledgeTraceEvent.created_at).all()

    # Group by date
    daily: dict[str, dict[str, int]] = {}
    for ev in events:
        date_key = ev.created_at.strftime("%Y-%m-%d")
        if date_key not in daily:
            daily[date_key] = {"total": 0, "correct": 0}
        daily[date_key]["total"] += 1
        if ev.is_correct:
            daily[date_key]["correct"] += 1

    trend = []
    for date_key in sorted(daily.keys()):
        d = daily[date_key]
        trend.append({
            "date": date_key,
            "total": d["total"],
            "correct": d["correct"],
            "accuracy": round(d["correct"] / d["total"], 3) if d["total"] > 0 else 0,
        })

    total_all = sum(d["total"] for d in daily.values())
    correct_all = sum(d["correct"] for d in daily.values())

    return {
        "trend": trend,
        "summary": {
            "total_answers": total_all,
            "correct_answers": correct_all,
            "overall_accuracy": round(correct_all / total_all, 3) if total_all > 0 else 0,
            "days_with_data": len(daily),
        },
    }


def get_mastery_progress(
    session: Session,
    *,
    user_id: str,
    days: int = 30,
) -> dict[str, Any]:
    """Get mastery progression over time for all knowledge points.

    Returns: { knowledge_points: [{id, current_mastery, prior_mastery, delta, attempts}], summary: {...} }
    """
    cutoff = _utcnow() - timedelta(days=days)

    # Current states
    states = session.query(StudentKnowledgeState).filter(
        StudentKnowledgeState.user_id == user_id,
    ).all()

    # Get earliest mastery in window for each KP
    results = []
    for state in states:
        first_event = (
            session.query(KnowledgeTraceEvent)
            .filter(
                KnowledgeTraceEvent.user_id == user_id,
                KnowledgeTraceEvent.knowledge_point_id == state.knowledge_point_id,
                KnowledgeTraceEvent.created_at >= cutoff,
            )
            .order_by(KnowledgeTraceEvent.created_at)
            .first()
        )

        prior = first_event.prior_mastery if first_event else state.p_mastery
        delta = state.p_mastery - prior

        results.append({
            "knowledge_point_id": state.knowledge_point_id,
            "current_mastery": round(state.p_mastery, 4),
            "prior_mastery": round(prior, 4),
            "delta": round(delta, 4),
            "attempts": state.attempts,
            "correct_attempts": state.correct_attempts,
            "last_updated": state.last_updated_at.isoformat() if state.last_updated_at else None,
        })

    # Sort by delta ascending (most improved last)
    results.sort(key=lambda x: x["delta"])

    improved = sum(1 for r in results if r["delta"] > 0.05)
    declined = sum(1 for r in results if r["delta"] < -0.05)

    return {
        "knowledge_points": results,
        "summary": {
            "total_kps": len(results),
            "improved": improved,
            "declined": declined,
            "stable": len(results) - improved - declined,
        },
    }


def get_repeat_mistake_rate(
    session: Session,
    *,
    user_id: str,
    days: int = 30,
) -> dict[str, Any]:
    """Calculate the rate of repeated mistakes on the same knowledge point.

    A "repeat mistake" = wrong on a KP that the student was previously wrong on.
    Returns: { kp_repeat_rates: [...], summary: {...} }
    """
    cutoff = _utcnow() - timedelta(days=days)
    events = (
        session.query(KnowledgeTraceEvent)
        .filter(
            KnowledgeTraceEvent.user_id == user_id,
            KnowledgeTraceEvent.event_type == "quiz_answered",
            KnowledgeTraceEvent.created_at >= cutoff,
        )
        .order_by(KnowledgeTraceEvent.created_at)
        .all()
    )

    # Track per-KP history
    kp_history: dict[str, list[bool]] = {}
    for ev in events:
        kp = ev.knowledge_point_id
        if kp not in kp_history:
            kp_history[kp] = []
        kp_history[kp].append(bool(ev.is_correct))

    results = []
    for kp, answers in kp_history.items():
        if len(answers) < 2:
            continue
        # Count consecutive wrong-after-wrong
        repeats = 0
        wrong_opportunities = 0
        for i in range(1, len(answers)):
            if not answers[i - 1]:  # previous was wrong
                wrong_opportunities += 1
                if not answers[i]:  # current is also wrong
                    repeats += 1

        rate = repeats / wrong_opportunities if wrong_opportunities > 0 else 0
        results.append({
            "knowledge_point_id": kp,
            "total_answers": len(answers),
            "repeat_mistakes": repeats,
            "repeat_rate": round(rate, 3),
        })

    results.sort(key=lambda x: x["repeat_rate"], reverse=True)

    total_repeats = sum(r["repeat_mistakes"] for r in results)
    total_opps = sum(r["total_answers"] - 1 for r in results if r["total_answers"] > 1)

    return {
        "kp_repeat_rates": results[:20],  # top 20
        "summary": {
            "knowledge_points_analyzed": len(results),
            "total_repeat_mistakes": total_repeats,
            "overall_repeat_rate": round(total_repeats / total_opps, 3) if total_opps > 0 else 0,
        },
    }


def get_hint_usage_trend(
    session: Session,
    *,
    user_id: str,
    days: int = 30,
) -> dict[str, Any]:
    """Get hint usage trend over time.

    Returns: { trend: [{date, count}], summary: {...} }
    """
    cutoff = _utcnow() - timedelta(days=days)
    events = (
        session.query(LearningEvent)
        .filter(
            LearningEvent.user_id == user_id,
            LearningEvent.event_type == "hint_used",
            LearningEvent.created_at >= cutoff,
        )
        .order_by(LearningEvent.created_at)
        .all()
    )

    daily: dict[str, int] = {}
    for ev in events:
        date_key = ev.created_at.strftime("%Y-%m-%d")
        daily[date_key] = daily.get(date_key, 0) + 1

    trend = [{"date": k, "count": v} for k, v in sorted(daily.items())]
    total = sum(daily.values())

    return {
        "trend": trend,
        "summary": {
            "total_hints": total,
            "days_with_data": len(daily),
            "avg_per_day": round(total / max(len(daily), 1), 1),
        },
    }


def get_learning_efficiency(
    session: Session,
    *,
    user_id: str,
    days: int = 30,
) -> dict[str, Any]:
    """Composite learning efficiency metric combining accuracy, mastery growth, and hint usage.

    Returns a single efficiency score and breakdown.
    """
    accuracy = get_accuracy_trend(session, user_id=user_id, days=days)
    mastery = get_mastery_progress(session, user_id=user_id, days=days)
    hints = get_hint_usage_trend(session, user_id=user_id, days=days)
    repeats = get_repeat_mistake_rate(session, user_id=user_id, days=days)

    # Efficiency score: higher is better
    # Components:
    # - Accuracy (0-100): overall_accuracy * 100
    # - Mastery growth (-100 to 100): average delta * 100, clamped
    # - Hint independence (0-100): 100 - min(avg_hints_per_day * 10, 100)
    # - Repeat reduction (0-100): 100 - overall_repeat_rate * 100

    acc_score = accuracy["summary"]["overall_accuracy"] * 100
    deltas = [kp["delta"] for kp in mastery["knowledge_points"]]
    avg_delta = sum(deltas) / len(deltas) if deltas else 0
    mastery_score = max(-100, min(100, avg_delta * 200))  # scale: 0.5 delta -> 100
    hint_score = max(0, 100 - hints["summary"]["avg_per_day"] * 10)
    repeat_score = (1 - repeats["summary"]["overall_repeat_rate"]) * 100

    efficiency = round((acc_score * 0.4 + mastery_score * 0.25 + hint_score * 0.15 + repeat_score * 0.2), 1)

    return {
        "efficiency_score": efficiency,
        "breakdown": {
            "accuracy_score": round(acc_score, 1),
            "mastery_growth_score": round(mastery_score, 1),
            "hint_independence_score": round(hint_score, 1),
            "repeat_reduction_score": round(repeat_score, 1),
        },
        "raw": {
            "accuracy": accuracy["summary"],
            "mastery": mastery["summary"],
            "hints": hints["summary"],
            "repeats": repeats["summary"],
        },
    }
