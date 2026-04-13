import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.database import get_db, new_id, now_iso
from app.models import MonitorCreate, MonitorUpdate, MonitorOut, MonitorDataPoint, BUILTIN_METRIC_KEYS

router = APIRouter(prefix="/monitors", tags=["monitors"])


def _row_to_out(row) -> MonitorOut:
    config = json.loads(row["builtin_config"]) if row["builtin_config"] else None
    return MonitorOut(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        server_id=row["server_id"],
        server_name=row["server_name"] if "server_name" in row.keys() else None,
        interval_minutes=row["interval_minutes"],
        enabled=bool(row["enabled"]),
        metric_type=row["metric_type"],
        builtin_key=row["builtin_key"],
        builtin_config=config,
        custom_script=row["custom_script"],
        unit=row["unit"],
        warning_threshold=row["warning_threshold"],
        critical_threshold=row["critical_threshold"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("", response_model=list[MonitorOut])
async def list_monitors(server_id: Optional[str] = Query(default=None)):
    async with get_db() as db:
        if server_id:
            cur = await db.execute(
                "SELECT m.*, s.name AS server_name FROM monitors m "
                "JOIN servers s ON m.server_id = s.id WHERE m.server_id = ? ORDER BY m.created_at",
                (server_id,),
            )
        else:
            cur = await db.execute(
                "SELECT m.*, s.name AS server_name FROM monitors m "
                "JOIN servers s ON m.server_id = s.id ORDER BY m.created_at"
            )
        rows = await cur.fetchall()
    return [_row_to_out(r) for r in rows]


@router.post("", response_model=MonitorOut, status_code=201)
async def create_monitor(body: MonitorCreate):
    if body.metric_type == "builtin" and body.builtin_key not in BUILTIN_METRIC_KEYS:
        raise HTTPException(status_code=422, detail=f"Unknown builtin_key: {body.builtin_key}")
    if body.metric_type == "custom" and not body.custom_script:
        raise HTTPException(status_code=422, detail="custom_script is required for custom metric_type")

    mid = new_id()
    now = now_iso()
    config_json = json.dumps(body.builtin_config) if body.builtin_config else None

    async with get_db() as db:
        await db.execute(
            "INSERT INTO monitors (id, name, description, server_id, interval_minutes, enabled, "
            "metric_type, builtin_key, builtin_config, custom_script, unit, "
            "warning_threshold, critical_threshold, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                mid, body.name, body.description, body.server_id,
                body.interval_minutes, int(body.enabled),
                body.metric_type, body.builtin_key, config_json, body.custom_script,
                body.unit, body.warning_threshold, body.critical_threshold,
                now, now,
            ),
        )
        await db.commit()
        cur = await db.execute(
            "SELECT m.*, s.name AS server_name FROM monitors m "
            "JOIN servers s ON m.server_id = s.id WHERE m.id = ?",
            (mid,),
        )
        row = await cur.fetchone()

    if body.enabled:
        from app.scheduler import schedule_monitor
        schedule_monitor(mid, body.interval_minutes)

    return _row_to_out(row)


@router.get("/{monitor_id}", response_model=MonitorOut)
async def get_monitor(monitor_id: str):
    async with get_db() as db:
        cur = await db.execute(
            "SELECT m.*, s.name AS server_name FROM monitors m "
            "JOIN servers s ON m.server_id = s.id WHERE m.id = ?",
            (monitor_id,),
        )
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Monitor not found")
    return _row_to_out(row)


@router.put("/{monitor_id}", response_model=MonitorOut)
async def update_monitor(monitor_id: str, body: MonitorUpdate):
    async with get_db() as db:
        cur = await db.execute("SELECT * FROM monitors WHERE id = ?", (monitor_id,))
        existing = await cur.fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Monitor not found")

    fields: dict = {}
    if body.name is not None:
        fields["name"] = body.name
    if body.description is not None:
        fields["description"] = body.description
    if body.server_id is not None:
        fields["server_id"] = body.server_id
    if body.interval_minutes is not None:
        fields["interval_minutes"] = body.interval_minutes
    if body.enabled is not None:
        fields["enabled"] = int(body.enabled)
    if body.metric_type is not None:
        fields["metric_type"] = body.metric_type
    if body.builtin_key is not None:
        fields["builtin_key"] = body.builtin_key
    if body.builtin_config is not None:
        fields["builtin_config"] = json.dumps(body.builtin_config)
    if body.custom_script is not None:
        fields["custom_script"] = body.custom_script
    if body.unit is not None:
        fields["unit"] = body.unit
    if body.warning_threshold is not None:
        fields["warning_threshold"] = body.warning_threshold
    if body.critical_threshold is not None:
        fields["critical_threshold"] = body.critical_threshold

    if not fields:
        raise HTTPException(status_code=422, detail="No fields to update")

    now = now_iso()
    fields["updated_at"] = now
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [monitor_id]

    async with get_db() as db:
        await db.execute(f"UPDATE monitors SET {set_clause} WHERE id = ?", values)
        await db.commit()
        cur = await db.execute(
            "SELECT m.*, s.name AS server_name FROM monitors m "
            "JOIN servers s ON m.server_id = s.id WHERE m.id = ?",
            (monitor_id,),
        )
        row = await cur.fetchone()

    # Re-schedule with updated settings
    from app.scheduler import schedule_monitor, unschedule_monitor
    new_enabled = fields.get("enabled", existing["enabled"])
    new_interval = fields.get("interval_minutes", existing["interval_minutes"])
    if new_enabled:
        schedule_monitor(monitor_id, new_interval)
    else:
        unschedule_monitor(monitor_id)

    return _row_to_out(row)


@router.delete("/{monitor_id}", status_code=204)
async def delete_monitor(monitor_id: str):
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM monitors WHERE id = ?", (monitor_id,))
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Monitor not found")

    from app.scheduler import unschedule_monitor
    unschedule_monitor(monitor_id)

    async with get_db() as db:
        await db.execute("DELETE FROM monitors WHERE id = ?", (monitor_id,))
        await db.commit()


@router.patch("/{monitor_id}/enable", response_model=MonitorOut)
async def toggle_monitor(monitor_id: str, enabled: bool = Query(...)):
    async with get_db() as db:
        cur = await db.execute("SELECT * FROM monitors WHERE id = ?", (monitor_id,))
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Monitor not found")

    now = now_iso()
    async with get_db() as db:
        await db.execute(
            "UPDATE monitors SET enabled = ?, updated_at = ? WHERE id = ?",
            (int(enabled), now, monitor_id),
        )
        await db.commit()
        cur = await db.execute(
            "SELECT m.*, s.name AS server_name FROM monitors m "
            "JOIN servers s ON m.server_id = s.id WHERE m.id = ?",
            (monitor_id,),
        )
        updated = await cur.fetchone()

    from app.scheduler import schedule_monitor, unschedule_monitor
    if enabled:
        schedule_monitor(monitor_id, row["interval_minutes"])
    else:
        unschedule_monitor(monitor_id)

    return _row_to_out(updated)


@router.post("/{monitor_id}/trigger", status_code=202)
async def trigger_monitor(monitor_id: str):
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM monitors WHERE id = ?", (monitor_id,))
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Monitor not found")

    import asyncio
    from app.scheduler import _collect_monitor
    asyncio.create_task(_collect_monitor(monitor_id))
    return {"message": "Collection triggered"}


@router.get("/{monitor_id}/data", response_model=list[MonitorDataPoint])
async def get_monitor_data(
    monitor_id: str,
    hours: int = Query(default=24, ge=1, le=720),
    limit: int = Query(default=500, ge=1, le=5000),
):
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM monitors WHERE id = ?", (monitor_id,))
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Monitor not found")

    from datetime import datetime, timezone, timedelta
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()

    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM monitor_data WHERE monitor_id = ? AND collected_at >= ? "
            "ORDER BY collected_at DESC LIMIT ?",
            (monitor_id, since, limit),
        )
        rows = await cur.fetchall()

    return [
        MonitorDataPoint(
            id=r["id"],
            monitor_id=r["monitor_id"],
            collected_at=r["collected_at"],
            value=r["value"],
            error=r["error"],
        )
        for r in reversed(rows)
    ]


@router.get("/builtin-metrics/list")
async def list_builtin_metrics():
    from app.ssh import BUILTIN_METRIC_COMMANDS
    defaults = {
        "cpu_load_1m":   {"label": "CPU Load (1m)",   "unit": "",   "configurable": False},
        "cpu_load_5m":   {"label": "CPU Load (5m)",   "unit": "",   "configurable": False},
        "cpu_load_15m":  {"label": "CPU Load (15m)",  "unit": "",   "configurable": False},
        "mem_used_pct":  {"label": "Memory Usage",    "unit": "%",  "configurable": False},
        "mem_used_mb":   {"label": "Memory Used",     "unit": "MB", "configurable": False},
        "disk_used_pct": {"label": "Disk Usage",      "unit": "%",  "configurable": True,
                          "config_fields": [{"key": "path", "label": "Mount path", "default": "/"}]},
        "disk_used_gb":  {"label": "Disk Used",       "unit": "GB", "configurable": True,
                          "config_fields": [{"key": "path", "label": "Mount path", "default": "/"}]},
        "process_count": {"label": "Process Count",   "unit": "",   "configurable": False},
    }
    return [{"key": k, **v} for k, v in defaults.items() if k in BUILTIN_METRIC_COMMANDS]
