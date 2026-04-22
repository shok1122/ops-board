import asyncio
import json
import logging
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.database import get_db, new_id, now_iso
def _parse_job_output(stdout: str) -> dict | None:
    """出力の最後の非空行を JSON としてパースする。
    有効な JSON オブジェクトであれば dict を返し、そうでなければ None を返す。"""
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
    """Run a job and record the execution in the DB."""
    from app.crypto import decrypt
    from app.ssh import run_command, fetch_file, run_local_command

    async with get_db() as db:
        row = await db.execute(
            "SELECT j.*, s.host, s.port, s.username, s.auth_type, "
            "COALESCE(s.server_type, 'ssh') AS server_type, "
            "s.password_enc, s.private_key_enc, s.passphrase_enc "
            "FROM jobs j JOIN servers s ON j.server_id = s.id WHERE j.id = ?",
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
        if job["server_type"] == "local_execution":
            result = await run_local_command(
                job["command"] or "echo 'No command set'",
                remote_host=job["host"],
                timeout=timeout,
            )
        elif job["type"] == "log_fetch" and job["log_path"]:
            password = decrypt(job["password_enc"]) if job["password_enc"] else None
            private_key = decrypt(job["private_key_enc"]) if job["private_key_enc"] else None
            passphrase = decrypt(job["passphrase_enc"]) if job["passphrase_enc"] else None
            result = await fetch_file(
                job["host"], job["port"], job["username"],
                job["log_path"],
                password=password, private_key=private_key, passphrase=passphrase,
                timeout=timeout,
            )
        else:
            password = decrypt(job["password_enc"]) if job["password_enc"] else None
            private_key = decrypt(job["private_key_enc"]) if job["private_key_enc"] else None
            passphrase = decrypt(job["passphrase_enc"]) if job["passphrase_enc"] else None
            result = await run_command(
                job["host"], job["port"], job["username"],
                job["command"] or "echo 'No command set'",
                password=password, private_key=private_key, passphrase=passphrase,
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


async def _trigger_job_manual(job_id: str):
    """Same as _execute_job but marks triggered_by = 'manual'."""
    from app.crypto import decrypt
    from app.ssh import run_command, fetch_file, run_local_command

    async with get_db() as db:
        row = await db.execute(
            "SELECT j.*, s.host, s.port, s.username, s.auth_type, "
            "COALESCE(s.server_type, 'ssh') AS server_type, "
            "s.password_enc, s.private_key_enc, s.passphrase_enc "
            "FROM jobs j JOIN servers s ON j.server_id = s.id WHERE j.id = ?",
            (job_id,),
        )
        job = await row.fetchone()

    if not job:
        return

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
        if job["server_type"] == "local_execution":
            result = await run_local_command(
                job["command"] or "echo 'No command set'",
                remote_host=job["host"],
                timeout=timeout,
            )
        elif job["type"] == "log_fetch" and job["log_path"]:
            password = decrypt(job["password_enc"]) if job["password_enc"] else None
            private_key = decrypt(job["private_key_enc"]) if job["private_key_enc"] else None
            passphrase = decrypt(job["passphrase_enc"]) if job["passphrase_enc"] else None
            result = await fetch_file(
                job["host"], job["port"], job["username"],
                job["log_path"],
                password=password, private_key=private_key, passphrase=passphrase,
                timeout=timeout,
            )
        else:
            password = decrypt(job["password_enc"]) if job["password_enc"] else None
            private_key = decrypt(job["private_key_enc"]) if job["private_key_enc"] else None
            passphrase = decrypt(job["passphrase_enc"]) if job["passphrase_enc"] else None
            result = await run_command(
                job["host"], job["port"], job["username"],
                job["command"] or "echo 'No command set'",
                password=password, private_key=private_key, passphrase=passphrase,
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
    import asyncio
    exec_id = new_id()

    # Run in background
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
            # Add a grace period of 10 seconds beyond the configured timeout
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


async def _collect_monitor(monitor_id: str):
    """Collect a metric for a monitor and store the result in monitor_data."""
    import json as _json
    from app.crypto import decrypt
    from app.ssh import collect_metric

    async with get_db() as db:
        cur = await db.execute(
            "SELECT m.*, s.host, s.port, s.username, s.auth_type, "
            "COALESCE(s.server_type, 'ssh') AS server_type, "
            "s.password_enc, s.private_key_enc, s.passphrase_enc "
            "FROM monitors m JOIN servers s ON m.server_id = s.id WHERE m.id = ?",
            (monitor_id,),
        )
        monitor = await cur.fetchone()

    if not monitor:
        logger.warning("Monitor %s not found; skipping collection", monitor_id)
        return

    builtin_config = _json.loads(monitor["builtin_config"]) if monitor["builtin_config"] else None

    raw_log = ""
    try:
        config = builtin_config or {}
        if monitor["server_type"] == "local_execution":
            from app.ssh import run_local_command, format_raw_log, resolve_command
            command, resolve_error = resolve_command(
                monitor["metric_type"], monitor["builtin_key"],
                builtin_config, monitor["custom_script"], monitor["host"],
            )
            if resolve_error:
                value = None
                error = resolve_error
            else:
                result = await run_local_command(command, remote_host=monitor["host"])
                raw_log = format_raw_log(result.stdout, result.stderr, command)
                if result.exit_code != 0:
                    value = None
                    error = result.stderr.strip() or f"Exit code {result.exit_code}"
                else:
                    try:
                        last_line = result.stdout.splitlines()[-1].strip() if result.stdout.strip() else ""
                        value = float(last_line)
                        error = None
                    except (ValueError, TypeError):
                        value = None
                        error = f"数値に変換できません: {result.stdout.strip()[:100]}"
        else:
            password = decrypt(monitor["password_enc"]) if monitor["password_enc"] else None
            private_key = decrypt(monitor["private_key_enc"]) if monitor["private_key_enc"] else None
            passphrase = decrypt(monitor["passphrase_enc"]) if monitor["passphrase_enc"] else None
            value, error, raw_log = await collect_metric(
                monitor["host"], monitor["port"], monitor["username"],
                metric_type=monitor["metric_type"],
                builtin_key=monitor["builtin_key"],
                builtin_config=builtin_config,
                custom_script=monitor["custom_script"],
                password=password, private_key=private_key, passphrase=passphrase,
            )
    except Exception as exc:
        value, error = None, str(exc)

    now = now_iso()
    async with get_db() as db:
        await db.execute(
            "INSERT INTO monitor_data (id, monitor_id, collected_at, value, error, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (new_id(), monitor_id, now, value, error, now),
        )
        await db.execute(
            "UPDATE monitors SET last_log = ?, last_log_at = ? WHERE id = ?",
            (raw_log or None, now, monitor_id),
        )
        await db.commit()
    logger.debug("Monitor %s collected value=%s error=%s", monitor_id, value, error)


def schedule_monitor(monitor_id: str, interval_minutes: int):
    from apscheduler.triggers.interval import IntervalTrigger
    job_id = f"monitor_{monitor_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
    scheduler.add_job(
        _collect_monitor,
        trigger=IntervalTrigger(minutes=interval_minutes),
        id=job_id,
        args=[monitor_id],
        replace_existing=True,
        misfire_grace_time=60,
    )
    logger.info("Scheduled monitor %s every %d minutes", monitor_id, interval_minutes)


def unschedule_monitor(monitor_id: str):
    job_id = f"monitor_{monitor_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)


async def _auto_check_all_servers():
    """Periodically collect system status for all registered SSH servers."""
    from app.crypto import decrypt
    from app.ssh import get_system_status

    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM servers WHERE COALESCE(server_type, 'remote_execution') = 'remote_execution'"
        )
        servers = await cur.fetchall()

    for row in servers:
        try:
            password = decrypt(row["password_enc"]) if row["password_enc"] else None
            private_key = decrypt(row["private_key_enc"]) if row["private_key_enc"] else None
            passphrase = decrypt(row["passphrase_enc"]) if row["passphrase_enc"] else None
            metrics = await get_system_status(
                row["host"], row["port"], row["username"],
                password=password, private_key=private_key, passphrase=passphrase,
            )
        except Exception as exc:
            metrics = {
                "cpu_load_1m": None, "mem_used_mb": None, "mem_total_mb": None,
                "disk_used_gb": None, "disk_total_gb": None,
                "uptime_seconds": None, "os_info": None,
                "error": str(exc),
            }

        now = now_iso()
        async with get_db() as db:
            await db.execute(
                "INSERT INTO server_status "
                "(id, server_id, checked_at, cpu_load_1m, mem_used_mb, mem_total_mb, "
                "disk_used_gb, disk_total_gb, uptime_seconds, os_info, error, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    new_id(), row["id"], now,
                    metrics["cpu_load_1m"], metrics["mem_used_mb"], metrics["mem_total_mb"],
                    metrics["disk_used_gb"], metrics["disk_total_gb"],
                    metrics["uptime_seconds"], metrics["os_info"], metrics["error"],
                    now,
                ),
            )
            await db.commit()
        logger.info("Auto status check done for server %s", row["id"])


def schedule_status_check(interval_minutes: int):
    """Register (or remove) the periodic server status check job."""
    from apscheduler.triggers.interval import IntervalTrigger
    if scheduler.get_job("_auto_status_check"):
        scheduler.remove_job("_auto_status_check")
    if interval_minutes > 0:
        scheduler.add_job(
            _auto_check_all_servers,
            trigger=IntervalTrigger(minutes=interval_minutes),
            id="_auto_status_check",
            replace_existing=True,
            misfire_grace_time=60,
        )
        logger.info("Scheduled auto status check every %d minutes", interval_minutes)
    else:
        logger.info("Auto status check disabled (interval=0)")


async def reload_all_jobs():
    """Remove all scheduled jobs and re-register from DB."""
    for job in scheduler.get_jobs():
        job.remove()

    async with get_db() as db:
        cur = await db.execute("SELECT id, cron_expr FROM jobs WHERE enabled = 1")
        rows = await cur.fetchall()

    for row in rows:
        schedule_job(row["id"], row["cron_expr"])

    # Stale execution cleanup (every 30 seconds)
    from apscheduler.triggers.interval import IntervalTrigger
    scheduler.add_job(
        _cleanup_stale_executions,
        trigger=IntervalTrigger(seconds=30),
        id="_cleanup_stale_executions",
        replace_existing=True,
        misfire_grace_time=10,
    )

    # Auto server status check — load interval from DB
    async with get_db() as db:
        cur = await db.execute(
            "SELECT value FROM app_settings WHERE key = 'status_check_interval_minutes'"
        )
        setting = await cur.fetchone()
    interval = int(setting["value"]) if setting else 10
    schedule_status_check(interval)

    # Load enabled monitors
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, interval_minutes FROM monitors WHERE enabled = 1"
        )
        monitor_rows = await cur.fetchall()
    for mrow in monitor_rows:
        schedule_monitor(mrow["id"], mrow["interval_minutes"])
    logger.info("Reloaded %d monitors from DB", len(monitor_rows))

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
