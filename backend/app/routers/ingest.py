import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.database import get_db, now_iso

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ingest"])


class Metric(BaseModel):
    name: str
    value: float
    unit: str


class CheckResult(BaseModel):
    name: str
    type: str
    timestamp: datetime
    status: str
    message: str
    metrics: list[Metric] = []
    labels: dict[str, str] = {}
    error: str = ""


class ReportPayload(BaseModel):
    hostname: str
    sent_at: datetime
    result: CheckResult


class AgentInfo(BaseModel):
    version: str
    uptime_seconds: float
    started_at: datetime
    go_version: str
    os: str
    arch: str


class HealthPayload(BaseModel):
    type: str
    hostname: str
    sent_at: datetime
    agent: AgentInfo


def _extract_token(authorization: str) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid Authorization header")
    return authorization[len("Bearer "):]


async def _authenticate_server(token: str) -> str:
    parts = token.split(":", 1)
    if len(parts) != 2:
        raise HTTPException(401, "Invalid worker credential format")
    worker_id, worker_secret = parts
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, worker_secret FROM servers WHERE worker_id = ?", (worker_id,)
        )
        row = await cur.fetchone()
        if not row or row["worker_secret"] != worker_secret:
            raise HTTPException(401, "Invalid worker credentials")
        return row["id"]


@router.post("/report", status_code=204)
async def receive_report(
    body: ReportPayload,
    authorization: str = Header(default=""),
):
    token = _extract_token(authorization)
    server_id = await _authenticate_server(token)
    now = now_iso()

    async with get_db() as db:
        await db.execute(
            """INSERT INTO worker_checks
               (server_id, check_name, check_type, status, message,
                metrics_json, labels_json, error, reported_at, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(server_id, check_name) DO UPDATE SET
                 check_type=excluded.check_type,
                 status=excluded.status,
                 message=excluded.message,
                 metrics_json=excluded.metrics_json,
                 labels_json=excluded.labels_json,
                 error=excluded.error,
                 reported_at=excluded.reported_at""",
            (
                server_id,
                body.result.name, body.result.type,
                body.result.status, body.result.message,
                json.dumps([m.model_dump() for m in body.result.metrics]),
                json.dumps(body.result.labels),
                body.result.error or None,
                body.result.timestamp.isoformat(),
                now,
            ),
        )
        await db.execute(
            "INSERT INTO worker_ingest_logs (server_id, log_type, check_name, status, message, received_at) "
            "VALUES (?,?,?,?,?,?)",
            (server_id, "report", body.result.name, body.result.status, body.result.message or None, now),
        )
        await db.execute(
            """DELETE FROM worker_ingest_logs WHERE server_id = ? AND id NOT IN (
                SELECT id FROM worker_ingest_logs WHERE server_id = ? ORDER BY id DESC LIMIT ?
            )""",
            (server_id, server_id, settings.worker_log_retention),
        )
        await db.commit()
    logger.debug("Received report from %s: check=%s status=%s", body.hostname, body.result.name, body.result.status)


@router.post("/health", status_code=204)
async def receive_health(
    body: HealthPayload,
    authorization: str = Header(default=""),
):
    token = _extract_token(authorization)
    server_id = await _authenticate_server(token)
    now = now_iso()

    async with get_db() as db:
        await db.execute(
            "INSERT OR REPLACE INTO server_status "
            "(server_id, checked_at, uptime_seconds, os_info, "
            "agent_version, go_version, arch, hostname, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (
                server_id, now,
                int(body.agent.uptime_seconds),
                body.agent.os,
                body.agent.version,
                body.agent.go_version,
                body.agent.arch,
                body.hostname,
                now,
            ),
        )
        await db.execute(
            "INSERT INTO worker_ingest_logs (server_id, log_type, check_name, status, message, received_at) "
            "VALUES (?,?,?,?,?,?)",
            (server_id, "health", None, None, None, now),
        )
        await db.execute(
            """DELETE FROM worker_ingest_logs WHERE server_id = ? AND id NOT IN (
                SELECT id FROM worker_ingest_logs WHERE server_id = ? ORDER BY id DESC LIMIT ?
            )""",
            (server_id, server_id, settings.worker_log_retention),
        )
        await db.commit()
    logger.debug("Received healthcheck from %s (uptime=%.0fs)", body.hostname, body.agent.uptime_seconds)
