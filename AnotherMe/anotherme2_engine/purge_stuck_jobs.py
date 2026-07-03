"""强制清除所有排队中/运行中的拍题任务。

用法（在 anotherme2_engine 目录内运行）：
    python purge_stuck_jobs.py

也可从外层：
    python AnotherMe/anotherme2_engine/purge_stuck_jobs.py

安全：只影响排队中 (queued) 和运行中 (running) 的 Job，已完成/已失败的不会动。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# 确保项目根在 sys.path 中
_script_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(_script_dir))

from api_gateway.config import Settings
from api_gateway.db import init_db, reconfigure_db, session_scope
from api_gateway.models import Job
from api_gateway.queueing import build_queue_client
from api_gateway.schemas import JobStatus


def purge() -> None:
    settings = Settings()
    reconfigure_db(settings.database_url)
    init_db()

    queue_client = build_queue_client(settings)

    with session_scope() as session:
        # 找出所有非终态的 Job
        target_statuses = [JobStatus.QUEUED.value, JobStatus.RUNNING.value]
        stuck_jobs = (
            session.query(Job)
            .filter(Job.status.in_(target_statuses))
            .order_by(Job.created_at.asc())
            .all()
        )

        if not stuck_jobs:
            print("✅ 没有发现排队中或运行中的任务，无需清除。")
            return

        print(f"🔍 发现 {len(stuck_jobs)} 个非终态任务：")
        for job in stuck_jobs:
            print(
                f"   - {job.id[:12]}... 类型={job.job_type}  状态={job.status}  "
                f"步骤={job.step}  创建={job.created_at.strftime('%H:%M:%S')}"
            )

        # 全部标记为失败
        from datetime import datetime

        now = datetime.utcnow()
        for job in stuck_jobs:
            job.status = JobStatus.FAILED.value
            job.error_code = "JOB_PURGED_MANUALLY"
            job.error_message = "管理员手动清除"
            job.step = "purged"
            job.completed_at = now
            job.updated_at = now

        session.commit()
        print(f"\n🗑️  已将 {len(stuck_jobs)} 个任务标记为 failed (JOB_PURGED_MANUALLY)")

    # 同时清除 Redis 队列中的消息
    try:
        queue_names = [
            settings.queue_problem_video,
            settings.queue_photo_manim,
            settings.queue_course,
            settings.queue_package,
            settings.queue_learning_record,
        ]
        purged_msgs = queue_client.purge_queues(queue_names)
        if purged_msgs:
            print(f"📭 同时清除了 {purged_msgs} 条 Redis 队列消息")
        else:
            print("📭 队列中无待消费消息（或使用 polling 模式，无需清队列）")
    except Exception:
        print("⚠️  清除队列消息失败（可能使用 polling 模式，数据库已清理即可）")

    print("\n✅ 清除完成。重启 Gateway Worker 后新任务将正常处理。")


if __name__ == "__main__":
    purge()
