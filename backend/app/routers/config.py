from typing import Any, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.database import get_db, new_id, now_iso
from app.crypto import encrypt, decrypt
from app.scheduler import reload_all_jobs, unschedule_job

router = APIRouter(prefix="/config", tags=["config"])


class ServerExport(BaseModel):
    id: str
    name: str
    host: str
    port: int
    username: str
    auth_type: str
    password: Optional[str] = None
    private_key: Optional[str] = None
    passphrase: Optional[str] = None


class JobExport(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    server_id: str
    type: str
    command: Optional[str] = None
    log_path: Optional[str] = None
    cron_expr: str
    enabled: bool
    timeout_sec: int


class ConfigExport(BaseModel):
    version: int = 1
    servers: list[ServerExport]
    jobs: list[JobExport]


@router.get("/export", response_model=ConfigExport)
async def export_config():
    async with get_db() as db:
        cur = await db.execute("SELECT * FROM servers ORDER BY created_at ASC")
        server_rows = await cur.fetchall()
        cur = await db.execute("SELECT * FROM jobs ORDER BY created_at ASC")
        job_rows = await cur.fetchall()

    servers = [
        ServerExport(
            id=r["id"],
            name=r["name"],
            host=r["host"],
            port=r["port"],
            username=r["username"],
            auth_type=r["auth_type"],
            password=decrypt(r["password_enc"]) if r["password_enc"] else None,
            private_key=decrypt(r["private_key_enc"]) if r["private_key_enc"] else None,
            passphrase=decrypt(r["passphrase_enc"]) if r["passphrase_enc"] else None,
        )
        for r in server_rows
    ]

    jobs = [
        JobExport(
            id=r["id"],
            name=r["name"],
            description=r["description"],
            server_id=r["server_id"],
            type=r["type"],
            command=r["command"],
            log_path=r["log_path"],
            cron_expr=r["cron_expr"],
            enabled=bool(r["enabled"]),
            timeout_sec=r["timeout_sec"],
        )
        for r in job_rows
    ]

    return ConfigExport(servers=servers, jobs=jobs)


@router.post("/import", status_code=200)
async def import_config(body: ConfigExport):
    if body.version != 1:
        raise HTTPException(400, f"Unsupported config version: {body.version}")

    # server_id の整合性チェック
    server_ids = {s.id for s in body.servers}
    for job in body.jobs:
        if job.server_id not in server_ids:
            raise HTTPException(
                400,
                f"Job '{job.name}' references unknown server_id '{job.server_id}'"
            )

    now = now_iso()

    async with get_db() as db:
        # 全ジョブ・サーバを削除（jobs は CASCADE で連鎖削除）
        await db.execute("DELETE FROM jobs")
        await db.execute("DELETE FROM servers")

        # サーバを再作成
        for s in body.servers:
            await db.execute(
                "INSERT INTO servers (id, name, host, port, username, auth_type, "
                "password_enc, private_key_enc, passphrase_enc, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    s.id, s.name, s.host, s.port, s.username, s.auth_type,
                    encrypt(s.password) if s.password else None,
                    encrypt(s.private_key) if s.private_key else None,
                    encrypt(s.passphrase) if s.passphrase else None,
                    now, now,
                ),
            )

        # ジョブを再作成
        for j in body.jobs:
            await db.execute(
                "INSERT INTO jobs (id, name, description, server_id, type, command, log_path, "
                "cron_expr, enabled, timeout_sec, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    j.id, j.name, j.description, j.server_id,
                    j.type, j.command, j.log_path,
                    j.cron_expr, int(j.enabled), j.timeout_sec,
                    now, now,
                ),
            )

        await db.commit()

    # スケジューラを再ロード
    await reload_all_jobs()

    return {"message": "Import successful", "servers": len(body.servers), "jobs": len(body.jobs)}
