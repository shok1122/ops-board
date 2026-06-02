import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.database import get_db

router = APIRouter(prefix="/worker-checks", tags=["worker-checks"])


@router.delete("/{server_id}/{check_name}", status_code=204)
async def delete_worker_check(server_id: str, check_name: str):
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM worker_checks WHERE server_id = ? AND check_name = ?",
            (server_id, check_name),
        )
        await db.commit()
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Worker check not found")


@router.get("")
async def list_worker_checks(server_id: Optional[str] = Query(default=None)):
    async with get_db() as db:
        if server_id:
            cur = await db.execute(
                "SELECT wc.*, s.name AS server_name FROM worker_checks wc "
                "JOIN servers s ON wc.server_id = s.id "
                "WHERE wc.server_id = ? ORDER BY wc.check_name",
                (server_id,),
            )
        else:
            cur = await db.execute(
                "SELECT wc.*, s.name AS server_name FROM worker_checks wc "
                "JOIN servers s ON wc.server_id = s.id ORDER BY s.name, wc.check_name"
            )
        rows = await cur.fetchall()

    return [
        {
            "server_id": r["server_id"],
            "server_name": r["server_name"],
            "check_name": r["check_name"],
            "check_type": r["check_type"],
            "status": r["status"],
            "message": r["message"],
            "metrics": json.loads(r["metrics_json"]) if r["metrics_json"] else [],
            "labels": json.loads(r["labels_json"]) if r["labels_json"] else {},
            "error": r["error"],
            "reported_at": r["reported_at"],
        }
        for r in rows
    ]
