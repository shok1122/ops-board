from fastapi import APIRouter, HTTPException, Query
from app.database import get_db, new_id, now_iso
from app.models import JobCreate, JobUpdate, JobOut, PagedResponse
from app.scheduler import schedule_job, unschedule_job, trigger_job_now

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _row_to_out(row) -> JobOut:
    return JobOut(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        server_id=row["server_id"],
        server_name=row["server_name"] if "server_name" in row.keys() else None,
        type=row["type"],
        command=row["command"],
        log_path=row["log_path"],
        cron_expr=row["cron_expr"],
        enabled=bool(row["enabled"]),
        timeout_sec=row["timeout_sec"],
        execution_type=row["execution_type"] if "execution_type" in row.keys() else "remote",
        last_run_at=row["last_run_at"],
        last_status=row["last_status"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("", response_model=PagedResponse)
async def list_jobs(server_id: str = Query(default=None)):
    async with get_db() as db:
        if server_id:
            cur = await db.execute(
                "SELECT j.*, s.name AS server_name FROM jobs j "
                "JOIN servers s ON j.server_id = s.id "
                "WHERE j.server_id = ? ORDER BY j.created_at DESC",
                (server_id,),
            )
        else:
            cur = await db.execute(
                "SELECT j.*, s.name AS server_name FROM jobs j "
                "JOIN servers s ON j.server_id = s.id ORDER BY j.created_at DESC"
            )
        rows = await cur.fetchall()
    items = [_row_to_out(r) for r in rows]
    return PagedResponse(items=items, total=len(items))


@router.post("", response_model=JobOut, status_code=201)
async def create_job(body: JobCreate):
    now = now_iso()
    jid = new_id()

    async with get_db() as db:
        cur = await db.execute("SELECT id FROM servers WHERE id = ?", (body.server_id,))
        if not await cur.fetchone():
            raise HTTPException(400, "Server not found")

        await db.execute(
            "INSERT INTO jobs (id, name, description, server_id, type, command, log_path, "
            "cron_expr, enabled, timeout_sec, execution_type, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                jid, body.name, body.description, body.server_id,
                body.type, body.command, body.log_path,
                body.cron_expr, int(body.enabled), body.timeout_sec,
                body.execution_type,
                now, now,
            ),
        )
        await db.commit()
        cur = await db.execute(
            "SELECT j.*, s.name AS server_name FROM jobs j "
            "JOIN servers s ON j.server_id = s.id WHERE j.id = ?",
            (jid,),
        )
        row = await cur.fetchone()

    if body.enabled:
        schedule_job(jid, body.cron_expr)

    return _row_to_out(row)


@router.get("/{job_id}", response_model=JobOut)
async def get_job(job_id: str):
    async with get_db() as db:
        cur = await db.execute(
            "SELECT j.*, s.name AS server_name FROM jobs j "
            "JOIN servers s ON j.server_id = s.id WHERE j.id = ?",
            (job_id,),
        )
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Job not found")
    return _row_to_out(row)


@router.put("/{job_id}", response_model=JobOut)
async def update_job(job_id: str, body: JobUpdate):
    async with get_db() as db:
        cur = await db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        existing = await cur.fetchone()
        if not existing:
            raise HTTPException(404, "Job not found")

        updates: dict = {}
        if body.name is not None:
            updates["name"] = body.name
        if body.description is not None:
            updates["description"] = body.description
        if body.server_id is not None:
            updates["server_id"] = body.server_id
        if body.type is not None:
            updates["type"] = body.type
        if body.command is not None:
            updates["command"] = body.command
        if body.log_path is not None:
            updates["log_path"] = body.log_path
        if body.cron_expr is not None:
            updates["cron_expr"] = body.cron_expr
        if body.enabled is not None:
            updates["enabled"] = int(body.enabled)
        if body.timeout_sec is not None:
            updates["timeout_sec"] = body.timeout_sec
        if body.execution_type is not None:
            updates["execution_type"] = body.execution_type
        updates["updated_at"] = now_iso()

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        await db.execute(
            f"UPDATE jobs SET {set_clause} WHERE id = ?",
            (*updates.values(), job_id),
        )
        await db.commit()

        cur = await db.execute(
            "SELECT j.*, s.name AS server_name FROM jobs j "
            "JOIN servers s ON j.server_id = s.id WHERE j.id = ?",
            (job_id,),
        )
        row = await cur.fetchone()

    # Update scheduler
    enabled = bool(row["enabled"])
    if enabled:
        schedule_job(job_id, row["cron_expr"])
    else:
        unschedule_job(job_id)

    return _row_to_out(row)


@router.delete("/{job_id}", status_code=204)
async def delete_job(job_id: str):
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM jobs WHERE id = ?", (job_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Job not found")
        await db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        await db.commit()
    unschedule_job(job_id)


@router.post("/{job_id}/trigger", status_code=202)
async def trigger_job(job_id: str):
    async with get_db() as db:
        cur = await db.execute(
            "SELECT j.*, s.host FROM jobs j JOIN servers s ON j.server_id = s.id WHERE j.id = ?",
            (job_id,),
        )
        if not await cur.fetchone():
            raise HTTPException(404, "Job not found")

    await trigger_job_now(job_id)
    return {"message": "Job triggered"}


@router.patch("/{job_id}/enable", response_model=JobOut)
async def toggle_job(job_id: str, enabled: bool):
    async with get_db() as db:
        cur = await db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Job not found")
        now = now_iso()
        await db.execute(
            "UPDATE jobs SET enabled = ?, updated_at = ? WHERE id = ?",
            (int(enabled), now, job_id),
        )
        await db.commit()
        cur = await db.execute(
            "SELECT j.*, s.name AS server_name FROM jobs j "
            "JOIN servers s ON j.server_id = s.id WHERE j.id = ?",
            (job_id,),
        )
        row = await cur.fetchone()

    if enabled:
        schedule_job(job_id, row["cron_expr"])
    else:
        unschedule_job(job_id)

    return _row_to_out(row)
