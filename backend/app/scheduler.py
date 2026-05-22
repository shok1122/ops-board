import asyncio
import json
import logging
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.database import get_db, new_id, now_iso


def _parse_job_output(stdout: str) -> dict | None:
    """出力の最後の非空行を JSON としてパースする。"""
    if not stdout:
        return None
    lines = [line for line in stdout.splitlines() if line.strip()]
    if not lines:
        return None
    try:
        obj = json.loads(lines[-1])
        if isinstance(obj, dict):
            return obj
    except (json.JSONDecodeError, ValueError):
        pass
    return None

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


def _parse_cron(expr: str) -> Optional[CronTrigger]:
    """Parse a 5-field cron expression into a CronTrigger."""
    try:
        parts = expr.strip().split()
        if len(parts) != 5:
            return None
        minute, hour, day, month, dow = parts
        return CronTrigger(
            minute=minute, hour=hour, day=day, month=month, day_of_week=dow
        )
    except Exception:
        return None


async def _execute_job(job_id: str):
    """Run a job locally and record the execution in the DB."""
    from app.ssh import run_local_command

    async with get_db() as db:
        row = await db.execute(
            "SELECT j.*, s.host FROM jobs j JOIN servers s ON j.server_id = s.id WHERE j.id = ?",
            (job_id,),
        )
        job = await row.fetchone()

    if not job:
        logger.warning("Job %s not found; skipping execution", job_id)
        return

    exec_id = new_id()
    started = now_iso()

    async with get_db() as db:
        await db.execute(
            "INSERT INTO executions (id, job_id, triggered_by, started_at, status, created_at) "
            "VALUES (?, ?, 'scheduler', ?, 'running', ?)",
            (exec_id, job_id, started, started),
        )
        await db.execute(
            "UPDATE jobs SET last_run_at = ?, last_status = 'running', updated_at = ? WHERE id = ?",
            (started, started, job_id),
        )
        await db.commit()

    try:
        timeout = float(job["timeout_sec"])
        result = await run_local_command(
            job["command"] or "echo 'No command set'",
            remote_host=job["host"] or "",
            timeout=timeout,
        )

        status = "success" if result.exit_code == 0 else "failure"
        parsed = _parse_job_output(result.stdout)
        finished = now_iso()

        async with get_db() as db:
            await db.execute(
                "UPDATE executions SET finished_at=?, status=?, exit_code=?, "
                "stdout=?, stderr=?, parsed_result=? WHERE id=?",
                (
                    finished, status, result.exit_code,
                    result.stdout, result.stderr,
                    json.dumps(parsed, ensure_ascii=False) if parsed is not None else None,
                    exec_id,
                ),
            )
            await db.execute(
                "UPDATE jobs SET last_status=?, updated_at=? WHERE id=?",
                (status, finished, job_id),
            )
            await db.commit()

    except asyncio.TimeoutError:
        finished = now_iso()
        logger.warning("Job %s timed out after %s seconds", job_id, job["timeout_sec"])
        async with get_db() as db:
            await db.execute(
                "UPDATE executions SET finished_at=?, status='timeout', "
                "stderr='Job timed out' WHERE id=?",
                (finished, exec_id),
            )
            await db.execute(
                "UPDATE jobs SET last_status='timeout', updated_at=? WHERE id=?",
                (finished, job_id),
            )
            await db.commit()
    except Exception as exc:
        finished = now_iso()
        logger.error("Job %s execution failed: %s", job_id, exc)
        async with get_db() as db:
            await db.execute(
                "UPDATE executions SET finished_at=?, status='failure', stderr=? WHERE id=?",
                (finished, str(exc), exec_id),
            )
            await db.execute(
                "UPDATE jobs SET last_status='failure', updated_at=? WHERE id=?",
                (finished, job_id),
            )
            await db.commit()


async def _trigger_job_manual(job_id: str) -> str:
    """Same as _execute_job but marks triggered_by = 'manual'."""
    from app.ssh import run_local_command

    async with get_db() as db:
        row = await db.execute(
            "SELECT j.*, s.host FROM jobs j JOIN servers s ON j.server_id = s.id WHERE j.id = ?",
            (job_id,),
        )
        job = await row.fetchone()

    if not job:
        return ""

    exec_id = new_id()
    started = now_iso()

    async with get_db() as db:
        await db.execute(
            "INSERT INTO executions (id, job_id, triggered_by, started_at, status, created_at) "
            "VALUES (?, ?, 'manual', ?, 'running', ?)",
            (exec_id, job_id, started, started),
        )
        await db.execute(
            "UPDATE jobs SET last_run_at=?, last_status='running', updated_at=? WHERE id=?",
            (started, started, job_id),
        )
        await db.commit()

    try:
        timeout = float(job["timeout_sec"])
        result = await run_local_command(
            job["command"] or "echo 'No command set'",
            remote_host=job["host"] or "",
            timeout=timeout,
        )

        status = "success" if result.exit_code == 0 else "failure"
        parsed = _parse_job_output(result.stdout)
        finished = now_iso()

        async with get_db() as db:
            await db.execute(
                "UPDATE executions SET finished_at=?, status=?, exit_code=?, "
                "stdout=?, stderr=?, parsed_result=? WHERE id=?",
                (
                    finished, status, result.exit_code,
                    result.stdout, result.stderr,
                    json.dumps(parsed, ensure_ascii=False) if parsed is not None else None,
                    exec_id,
                ),
            )
            await db.execute(
                "UPDATE jobs SET last_status=?, updated_at=? WHERE id=?",
                (status, finished, job_id),
            )
            await db.commit()

    except asyncio.TimeoutError:
        finished = now_iso()
        logger.warning("Job %s timed out after %s seconds", job_id, job["timeout_sec"])
        async with get_db() as db:
            await db.execute(
                "UPDATE executions SET finished_at=?, status='timeout', "
                "stderr='Job timed out' WHERE id=?",
                (finished, exec_id),
            )
            await db.execute(
                "UPDATE jobs SET last_status='timeout', updated_at=? WHERE id=?",
                (finished, job_id),
            )
            await db.commit()
    except Exception as exc:
        finished = now_iso()
        async with get_db() as db:
            await db.execute(
                "UPDATE executions SET finished_at=?, status='failure', stderr=? WHERE id=?",
                (finished, str(exc), exec_id),
            )
            await db.execute(
                "UPDATE jobs SET last_status='failure', updated_at=? WHERE id=?",
                (finished, job_id),
            )
            await db.commit()

    return exec_id


async def trigger_job_now(job_id: str) -> str:
    """Trigger a job immediately and return the execution id."""
    exec_id = new_id()
    asyncio.create_task(_trigger_job_manual(job_id))
    return exec_id


def schedule_job(job_id: str, cron_expr: str):
    trigger = _parse_cron(cron_expr)
    if not trigger:
        logger.warning("Invalid cron expr for job %s: %s", job_id, cron_expr)
        return
    job_func_id = f"job_{job_id}"
    if scheduler.get_job(job_func_id):
        scheduler.remove_job(job_func_id)
    scheduler.add_job(
        _execute_job,
        trigger=trigger,
        id=job_func_id,
        args=[job_id],
        replace_existing=True,
        misfire_grace_time=60,
    )
    logger.info("Scheduled job %s with cron %s", job_id, cron_expr)


def unschedule_job(job_id: str):
    job_func_id = f"job_{job_id}"
    if scheduler.get_job(job_func_id):
        scheduler.remove_job(job_func_id)


async def _cleanup_stale_executions():
    """Mark executions that have been 'running' longer than their job's timeout as 'timeout'."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT e.id, e.job_id, e.started_at, j.timeout_sec "
            "FROM executions e JOIN jobs j ON e.job_id = j.id "
            "WHERE e.status = 'running' AND e.started_at IS NOT NULL"
        )
        rows = await cur.fetchall()

    now = now_iso()
    for row in rows:
        try:
            from datetime import datetime, timezone
            started = datetime.fromisoformat(row["started_at"].replace("Z", "+00:00"))
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            now_dt = datetime.now(timezone.utc)
            elapsed = (now_dt - started).total_seconds()
            if elapsed > row["timeout_sec"] + 10:
                logger.warning(
                    "Cleaning up stale execution %s for job %s (elapsed %.0fs, timeout %ds)",
                    row["id"], row["job_id"], elapsed, row["timeout_sec"],
                )
                async with get_db() as db:
                    await db.execute(
                        "UPDATE executions SET finished_at=?, status='timeout', "
                        "stderr='Job timed out (cleaned up by monitor)' WHERE id=?",
                        (now, row["id"]),
                    )
                    await db.execute(
                        "UPDATE jobs SET last_status='timeout', updated_at=? "
                        "WHERE id=? AND last_status='running'",
                        (now, row["job_id"]),
                    )
                    await db.commit()
        except Exception as exc:
            logger.error("Error cleaning up stale execution %s: %s", row["id"], exc)


async def _cleanup_old_server_status():
    from app.config import settings
    from datetime import datetime, timezone, timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(days=settings.server_status_retention_days)).isoformat()
    async with get_db() as db:
        cur = await db.execute("DELETE FROM server_status WHERE checked_at < ?", (cutoff,))
        await db.commit()
        if cur.rowcount:
            logger.info("Deleted %d old server_status rows (older than %d days)", cur.rowcount, settings.server_status_retention_days)


async def reload_all_jobs():
    """Remove all scheduled jobs and re-register from DB."""
    for job in scheduler.get_jobs():
        job.remove()

    async with get_db() as db:
        cur = await db.execute("SELECT id, cron_expr FROM jobs WHERE enabled = 1")
        rows = await cur.fetchall()

    for row in rows:
        schedule_job(row["id"], row["cron_expr"])

    from apscheduler.triggers.interval import IntervalTrigger
    from apscheduler.triggers.cron import CronTrigger
    scheduler.add_job(
        _cleanup_stale_executions,
        trigger=IntervalTrigger(seconds=30),
        id="_cleanup_stale_executions",
        replace_existing=True,
        misfire_grace_time=10,
    )
    scheduler.add_job(
        _cleanup_old_server_status,
        trigger=CronTrigger(hour=3, minute=0),
        id="_cleanup_old_server_status",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    logger.info("Reloaded %d jobs from DB", len(rows))


def get_scheduler_status() -> dict:
    jobs = scheduler.get_jobs()
    return {
        "running": scheduler.running,
        "job_count": len(jobs),
        "jobs": [
            {
                "id": j.id,
                "next_run_time": j.next_run_time.isoformat() if j.next_run_time else None,
            }
            for j in jobs
        ],
    }
