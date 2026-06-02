import json
import secrets
from fastapi import APIRouter, HTTPException
from app.database import get_db, new_id, now_iso
from app.models import (
    ServerCreate, ServerUpdate, ServerOut,
    ServerStatusOut, ServerJobResult, JobResultOutput, PagedResponse,
)

def _new_worker_id() -> str:
    return "wkr_" + secrets.token_urlsafe(16)

def _new_worker_secret() -> str:
    return secrets.token_urlsafe(32)

router = APIRouter(prefix="/servers", tags=["servers"])


def _row_to_out(row, show_secret: bool = False) -> ServerOut:
    return ServerOut(
        id=row["id"],
        name=row["name"],
        host=row["host"] or "",
        has_worker_credential=bool(row["worker_id"]),
        worker_id=row["worker_id"] if show_secret else None,
        worker_secret=row["worker_secret"] if show_secret else None,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("", response_model=PagedResponse)
async def list_servers():
    async with get_db() as db:
        cur = await db.execute("SELECT * FROM servers ORDER BY created_at DESC")
        rows = await cur.fetchall()
    items = [_row_to_out(r) for r in rows]
    return PagedResponse(items=items, total=len(items))


@router.post("", response_model=ServerOut, status_code=201)
async def create_server(body: ServerCreate):
    now = now_iso()
    sid = new_id()
    wid = _new_worker_id() if body.generate_worker_credential else None
    wsecret = _new_worker_secret() if body.generate_worker_credential else None
    async with get_db() as db:
        await db.execute(
            "INSERT INTO servers (id, name, host, worker_id, worker_secret, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (sid, body.name, body.host, wid, wsecret, now, now),
        )
        await db.commit()
        cur = await db.execute("SELECT * FROM servers WHERE id = ?", (sid,))
        row = await cur.fetchone()
    return _row_to_out(row, show_secret=bool(body.generate_worker_credential))


@router.get("/{server_id}", response_model=ServerOut)
async def get_server(server_id: str):
    async with get_db() as db:
        cur = await db.execute("SELECT * FROM servers WHERE id = ?", (server_id,))
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Server not found")
    return _row_to_out(row)


@router.put("/{server_id}", response_model=ServerOut)
async def update_server(server_id: str, body: ServerUpdate):
    async with get_db() as db:
        cur = await db.execute("SELECT * FROM servers WHERE id = ?", (server_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Server not found")

        updates: dict = {}
        if body.name is not None:
            updates["name"] = body.name
        if body.host is not None:
            updates["host"] = body.host
        if body.regenerate_id:
            updates["worker_id"] = _new_worker_id()
            updates["worker_secret"] = _new_worker_secret()
        elif body.regenerate_secret:
            updates["worker_secret"] = _new_worker_secret()
        updates["updated_at"] = now_iso()

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        await db.execute(
            f"UPDATE servers SET {set_clause} WHERE id = ?",
            (*updates.values(), server_id),
        )
        await db.commit()
        cur = await db.execute("SELECT * FROM servers WHERE id = ?", (server_id,))
        row = await cur.fetchone()
    show = body.regenerate_id or body.regenerate_secret
    return _row_to_out(row, show_secret=show)


@router.delete("/{server_id}/worker-token", status_code=204)
async def revoke_worker_token(server_id: str):
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM servers WHERE id = ?", (server_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Server not found")
        await db.execute(
            "UPDATE servers SET worker_id = NULL, worker_secret = NULL, updated_at = ? WHERE id = ?",
            (now_iso(), server_id),
        )
        await db.commit()


@router.delete("/{server_id}", status_code=204)
async def delete_server(server_id: str):
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM servers WHERE id = ?", (server_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Server not found")
        await db.execute("DELETE FROM servers WHERE id = ?", (server_id,))
        await db.commit()


@router.get("/statuses/latest", response_model=list[ServerStatusOut])
async def get_all_latest_statuses():
    """Return the most recent status check for every server."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT ss.* FROM server_status ss "
            "INNER JOIN ("
            "  SELECT server_id, MAX(checked_at) AS latest "
            "  FROM server_status GROUP BY server_id"
            ") latest ON ss.server_id = latest.server_id AND ss.checked_at = latest.latest"
        )
        rows = await cur.fetchall()
    return [
        ServerStatusOut(
            server_id=r["server_id"], checked_at=r["checked_at"],
            uptime_seconds=r["uptime_seconds"], os_info=r["os_info"], error=r["error"],
            agent_version=r["agent_version"], go_version=r["go_version"],
            arch=r["arch"], hostname=r["hostname"],
        )
        for r in rows
    ]


@router.get("/{server_id}/status/history", response_model=list[ServerStatusOut])
async def get_server_status_history(server_id: str, limit: int = 48):
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM servers WHERE id = ?", (server_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Server not found")
        cur = await db.execute(
            "SELECT * FROM server_status WHERE server_id = ? ORDER BY checked_at DESC LIMIT ?",
            (server_id, limit),
        )
        rows = await cur.fetchall()
    return [
        ServerStatusOut(
            server_id=r["server_id"], checked_at=r["checked_at"],
            uptime_seconds=r["uptime_seconds"], os_info=r["os_info"], error=r["error"],
            agent_version=r["agent_version"], go_version=r["go_version"],
            arch=r["arch"], hostname=r["hostname"],
        )
        for r in reversed(rows)
    ]


@router.get("/{server_id}/job-results", response_model=list[ServerJobResult])
async def get_server_job_results(server_id: str):
    """Return the latest execution result for each job associated with this server."""
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM servers WHERE id = ?", (server_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Server not found")

        cur = await db.execute(
            "SELECT e.id, e.job_id, j.name AS job_name, e.status AS execution_status, "
            "e.finished_at, e.stdout, e.stderr, e.parsed_result "
            "FROM executions e "
            "INNER JOIN jobs j ON e.job_id = j.id "
            "INNER JOIN ("
            "  SELECT job_id, MAX(started_at) AS latest "
            "  FROM executions GROUP BY job_id"
            ") latest ON e.job_id = latest.job_id AND e.started_at = latest.latest "
            "WHERE j.server_id = ? "
            "ORDER BY j.name",
            (server_id,),
        )
        rows = await cur.fetchall()

    results = []
    for row in rows:
        output = None
        raw_stdout = row["stdout"]

        if row["stdout"]:
            lines = [line for line in row["stdout"].splitlines() if line.strip()]
            if lines:
                try:
                    obj = json.loads(lines[-1])
                    if isinstance(obj, dict):
                        output = JobResultOutput(**{
                            k: v for k, v in obj.items()
                            if k in JobResultOutput.model_fields
                        })
                        raw_stdout = None
                except (json.JSONDecodeError, Exception):
                    pass

        results.append(ServerJobResult(
            job_id=row["job_id"],
            job_name=row["job_name"],
            execution_id=row["id"],
            execution_status=row["execution_status"],
            finished_at=row["finished_at"],
            output=output,
            raw_stdout=raw_stdout,
            stderr=row["stderr"] or None,
        ))

    return results


@router.get("/{server_id}/status", response_model=ServerStatusOut)
async def get_server_status(server_id: str):
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM servers WHERE id = ?", (server_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Server not found")
        cur = await db.execute(
            "SELECT * FROM server_status WHERE server_id = ? ORDER BY checked_at DESC LIMIT 1",
            (server_id,),
        )
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "No status check found")
    return ServerStatusOut(
        server_id=row["server_id"], checked_at=row["checked_at"],
        uptime_seconds=row["uptime_seconds"], os_info=row["os_info"], error=row["error"],
        agent_version=row["agent_version"], go_version=row["go_version"],
        arch=row["arch"], hostname=row["hostname"],
    )
