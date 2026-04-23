import json
from fastapi import APIRouter, HTTPException
from app.database import get_db, new_id, now_iso
from app.crypto import encrypt, decrypt
from app.models import (
    ServerCreate, ServerUpdate, ServerOut, TestResult,
    ServerStatusOut, ServerJobResult, JobResultOutput, PagedResponse,
)
from app.ssh import test_connection, get_system_status

router = APIRouter(prefix="/servers", tags=["servers"])


def _row_to_out(row) -> ServerOut:
    return ServerOut(
        id=row["id"],
        name=row["name"],
        host=row["host"],
        port=row["port"],
        server_type=row["server_type"] if "server_type" in row.keys() else "remote_execution",
        username=row["username"] or "",
        auth_type=row["auth_type"],
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
    if body.server_type == "remote_execution" and not body.username:
        raise HTTPException(status_code=422, detail="リモート実行サーバにはユーザー名が必要です (ローカル実行サーバは SSH 認証情報不要)")

    now = now_iso()
    sid = new_id()
    username = body.username or ""
    async with get_db() as db:
        await db.execute(
            "INSERT INTO servers (id, name, host, port, username, auth_type, "
            "password_enc, private_key_enc, passphrase_enc, server_type, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                sid, body.name, body.host, body.port, username, body.auth_type,
                encrypt(body.password) if body.password else None,
                encrypt(body.private_key) if body.private_key else None,
                encrypt(body.passphrase) if body.passphrase else None,
                body.server_type,
                now, now,
            ),
        )
        await db.commit()
        cur = await db.execute("SELECT * FROM servers WHERE id = ?", (sid,))
        row = await cur.fetchone()
    return _row_to_out(row)


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
        existing = await cur.fetchone()
        if not existing:
            raise HTTPException(404, "Server not found")

        updates = {}
        if body.name is not None:
            updates["name"] = body.name
        if body.host is not None:
            updates["host"] = body.host
        if body.port is not None:
            updates["port"] = body.port
        if body.server_type is not None:
            updates["server_type"] = body.server_type
        if body.username is not None:
            updates["username"] = body.username
        if body.auth_type is not None:
            updates["auth_type"] = body.auth_type
        if body.password is not None:
            updates["password_enc"] = encrypt(body.password)
        if body.private_key is not None:
            updates["private_key_enc"] = encrypt(body.private_key)
        if body.passphrase is not None:
            updates["passphrase_enc"] = encrypt(body.passphrase)
        updates["updated_at"] = now_iso()

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        await db.execute(
            f"UPDATE servers SET {set_clause} WHERE id = ?",
            (*updates.values(), server_id),
        )
        await db.commit()
        cur = await db.execute("SELECT * FROM servers WHERE id = ?", (server_id,))
        row = await cur.fetchone()
    return _row_to_out(row)


@router.delete("/{server_id}", status_code=204)
async def delete_server(server_id: str):
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM servers WHERE id = ?", (server_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Server not found")
        await db.execute("DELETE FROM servers WHERE id = ?", (server_id,))
        await db.commit()


@router.post("/{server_id}/test", response_model=TestResult)
async def test_server(server_id: str):
    async with get_db() as db:
        cur = await db.execute("SELECT * FROM servers WHERE id = ?", (server_id,))
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Server not found")

    server_type = row["server_type"] if "server_type" in row.keys() else "remote_execution"

    if server_type == "local_execution":
        import asyncio
        port = row["port"] or 443
        try:
            _, writer = await asyncio.wait_for(
                asyncio.open_connection(row["host"], port), timeout=10.0
            )
            writer.close()
            await writer.wait_closed()
            return TestResult(ok=True)
        except asyncio.TimeoutError:
            return TestResult(ok=False, error=f"接続タイムアウト (10秒)")
        except Exception as e:
            return TestResult(ok=False, error=str(e))

    password = decrypt(row["password_enc"]) if row["password_enc"] else None
    private_key = decrypt(row["private_key_enc"]) if row["private_key_enc"] else None
    passphrase = decrypt(row["passphrase_enc"]) if row["passphrase_enc"] else None

    ok, latency, error = await test_connection(
        row["host"], row["port"], row["username"],
        password=password, private_key=private_key, passphrase=passphrase,
    )
    return TestResult(ok=ok, latency_ms=latency, error=error)


@router.post("/{server_id}/status", response_model=ServerStatusOut)
async def check_server_status(server_id: str):
    async with get_db() as db:
        cur = await db.execute("SELECT * FROM servers WHERE id = ?", (server_id,))
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Server not found")

    server_type = row["server_type"] if "server_type" in row.keys() else "remote_execution"
    if server_type == "local_execution":
        raise HTTPException(400, "ローカル実行サーバはシステムステータスチェックに対応していません")

    password = decrypt(row["password_enc"]) if row["password_enc"] else None
    private_key = decrypt(row["private_key_enc"]) if row["private_key_enc"] else None
    passphrase = decrypt(row["passphrase_enc"]) if row["passphrase_enc"] else None

    try:
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
    status_id = new_id()
    async with get_db() as db:
        await db.execute(
            "INSERT INTO server_status "
            "(id, server_id, checked_at, cpu_load_1m, mem_used_mb, mem_total_mb, "
            "disk_used_gb, disk_total_gb, uptime_seconds, os_info, error, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                status_id, server_id, now,
                metrics["cpu_load_1m"], metrics["mem_used_mb"], metrics["mem_total_mb"],
                metrics["disk_used_gb"], metrics["disk_total_gb"],
                metrics["uptime_seconds"], metrics["os_info"], metrics["error"],
                now,
            ),
        )
        await db.commit()

    return ServerStatusOut(id=status_id, server_id=server_id, checked_at=now, **metrics)


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
            id=r["id"], server_id=r["server_id"], checked_at=r["checked_at"],
            cpu_load_1m=r["cpu_load_1m"], mem_used_mb=r["mem_used_mb"],
            mem_total_mb=r["mem_total_mb"], disk_used_gb=r["disk_used_gb"],
            disk_total_gb=r["disk_total_gb"], uptime_seconds=r["uptime_seconds"],
            os_info=r["os_info"], error=r["error"],
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
            id=r["id"], server_id=r["server_id"], checked_at=r["checked_at"],
            cpu_load_1m=r["cpu_load_1m"], mem_used_mb=r["mem_used_mb"],
            mem_total_mb=r["mem_total_mb"], disk_used_gb=r["disk_used_gb"],
            disk_total_gb=r["disk_total_gb"], uptime_seconds=r["uptime_seconds"],
            os_info=r["os_info"], error=r["error"],
        )
        for r in reversed(rows)  # oldest first for charts
    ]


@router.get("/{server_id}/job-results", response_model=list[ServerJobResult])
async def get_server_job_results(server_id: str):
    """Return the latest execution result for each job associated with this server."""
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM servers WHERE id = ?", (server_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Server not found")

        # Latest execution per job for this server
        cur = await db.execute(
            "SELECT e.id, e.job_id, j.name AS job_name, e.status AS execution_status, "
            "e.finished_at, e.stdout, e.parsed_result "
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

        # stdout is expected to be a single JSON object (job_result_schema.json format).
        # This applies to both command (stdout of the command) and
        # log_fetch (contents of the JSON file).
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
        id=row["id"], server_id=row["server_id"], checked_at=row["checked_at"],
        cpu_load_1m=row["cpu_load_1m"], mem_used_mb=row["mem_used_mb"],
        mem_total_mb=row["mem_total_mb"], disk_used_gb=row["disk_used_gb"],
        disk_total_gb=row["disk_total_gb"], uptime_seconds=row["uptime_seconds"],
        os_info=row["os_info"], error=row["error"],
    )
