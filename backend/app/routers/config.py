from typing import Any, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.alerts import dump_groups, parse_groups
from app.database import get_db, new_id, now_iso
from app.models import AlertConditionGroup, AlertSeverity
from app.scheduler import reload_all_jobs, unschedule_job

router = APIRouter(prefix="/config", tags=["config"])


class ServerExport(BaseModel):
    id: str
    name: str
    host: str


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


class AlertRuleExport(BaseModel):
    id: str
    server_id: str
    name: str
    severity: AlertSeverity = "warning"
    message: Optional[str] = None
    enabled: bool = True
    groups: list[AlertConditionGroup]


class ConfigExport(BaseModel):
    version: int = 1
    servers: list[ServerExport]
    jobs: list[JobExport]
    alert_rules: list[AlertRuleExport] = []


@router.get("/export", response_model=ConfigExport)
async def export_config():
    async with get_db() as db:
        cur = await db.execute("SELECT * FROM servers ORDER BY created_at ASC")
        server_rows = await cur.fetchall()
        cur = await db.execute("SELECT * FROM jobs ORDER BY created_at ASC")
        job_rows = await cur.fetchall()
        cur = await db.execute("SELECT * FROM alert_rules ORDER BY created_at ASC")
        alert_rule_rows = await cur.fetchall()

    servers = [
        ServerExport(id=r["id"], name=r["name"], host=r["host"])
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

    alert_rules = [
        AlertRuleExport(
            id=r["id"],
            server_id=r["server_id"],
            name=r["name"],
            severity=r["severity"],
            message=r["message"],
            enabled=bool(r["enabled"]),
            groups=parse_groups(r["groups_json"]),
        )
        for r in alert_rule_rows
    ]

    return ConfigExport(servers=servers, jobs=jobs, alert_rules=alert_rules)


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
    for rule in body.alert_rules:
        if rule.server_id not in server_ids:
            raise HTTPException(
                400,
                f"Alert rule '{rule.name}' references unknown server_id '{rule.server_id}'"
            )

    now = now_iso()

    async with get_db() as db:
        # 全ジョブ・サーバを削除（jobs / alert_rules は CASCADE で連鎖削除）
        await db.execute("DELETE FROM jobs")
        await db.execute("DELETE FROM alert_rules")
        await db.execute("DELETE FROM servers")

        # サーバを再作成
        for s in body.servers:
            await db.execute(
                "INSERT INTO servers (id, name, host, created_at, updated_at) "
                "VALUES (?,?,?,?,?)",
                (s.id, s.name, s.host, now, now),
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

        # アラートルールを再作成
        for r in body.alert_rules:
            await db.execute(
                "INSERT INTO alert_rules "
                "(id, server_id, name, severity, message, enabled, groups_json, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    r.id, r.server_id, r.name, r.severity, r.message,
                    int(r.enabled), dump_groups(r.groups), now, now,
                ),
            )

        await db.commit()

    # スケジューラを再ロード
    await reload_all_jobs()

    return {
        "message": "Import successful",
        "servers": len(body.servers),
        "jobs": len(body.jobs),
        "alert_rules": len(body.alert_rules),
    }
