from typing import Optional

from fastapi import APIRouter, Query

from app.database import get_db

router = APIRouter(prefix="/worker-logs", tags=["worker-logs"])


@router.get("")
async def list_worker_logs(
    server_id: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
):
    async with get_db() as db:
        if server_id:
            cur = await db.execute(
                "SELECT wl.*, s.name AS server_name FROM worker_ingest_logs wl "
                "JOIN servers s ON wl.server_id = s.id "
                "WHERE wl.server_id = ? ORDER BY wl.id DESC LIMIT ?",
                (server_id, limit),
            )
        else:
            cur = await db.execute(
                "SELECT wl.*, s.name AS server_name FROM worker_ingest_logs wl "
                "JOIN servers s ON wl.server_id = s.id ORDER BY wl.id DESC LIMIT ?",
                (limit,),
            )
        rows = await cur.fetchall()

    return [
        {
            "id": r["id"],
            "server_id": r["server_id"],
            "server_name": r["server_name"],
            "log_type": r["log_type"],
            "check_name": r["check_name"],
            "status": r["status"],
            "message": r["message"],
            "received_at": r["received_at"],
        }
        for r in rows
    ]
