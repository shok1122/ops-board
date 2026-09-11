from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.alerts import dump_groups, evaluate_alerts, load_rules, row_to_rule
from app.database import get_db, new_id, now_iso
from app.models import AlertOut, AlertRuleCreate, AlertRuleOut, AlertRuleUpdate

router = APIRouter(tags=["alerts"])


# ── アラートルール ─────────────────────────────────────────────────────────────

@router.get("/alert-rules", response_model=list[AlertRuleOut])
async def list_alert_rules(server_id: Optional[str] = Query(default=None)):
    async with get_db() as db:
        return await load_rules(db, server_id)


@router.post("/alert-rules", response_model=AlertRuleOut, status_code=201)
async def create_alert_rule(body: AlertRuleCreate):
    now = now_iso()
    rule_id = new_id()
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM servers WHERE id = ?", (body.server_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Server not found")
        await db.execute(
            "INSERT INTO alert_rules "
            "(id, server_id, name, severity, message, enabled, groups_json, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (
                rule_id, body.server_id, body.name, body.severity, body.message,
                int(body.enabled), dump_groups(body.groups), now, now,
            ),
        )
        await db.commit()
        return await _fetch_rule(db, rule_id)


@router.get("/alert-rules/{rule_id}", response_model=AlertRuleOut)
async def get_alert_rule(rule_id: str):
    async with get_db() as db:
        return await _fetch_rule(db, rule_id)


@router.put("/alert-rules/{rule_id}", response_model=AlertRuleOut)
async def update_alert_rule(rule_id: str, body: AlertRuleUpdate):
    async with get_db() as db:
        await _fetch_rule(db, rule_id)

        updates: dict = {}
        if body.name is not None:
            updates["name"] = body.name
        if body.severity is not None:
            updates["severity"] = body.severity
        # message は空文字/None を送ることで消去できるよう、送信有無で判定する
        if "message" in body.model_fields_set:
            updates["message"] = (body.message or "").strip() or None
        if body.enabled is not None:
            updates["enabled"] = int(body.enabled)
        if body.groups is not None:
            if not body.groups:
                raise HTTPException(400, "At least one condition group is required")
            updates["groups_json"] = dump_groups(body.groups)
        updates["updated_at"] = now_iso()

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        await db.execute(
            f"UPDATE alert_rules SET {set_clause} WHERE id = ?",
            (*updates.values(), rule_id),
        )
        # 判定式が変わったら発火状態はリセットする
        if "groups_json" in updates or "enabled" in updates:
            await db.execute("DELETE FROM alert_states WHERE rule_id = ?", (rule_id,))
        await db.commit()
        return await _fetch_rule(db, rule_id)


@router.delete("/alert-rules/{rule_id}", status_code=204)
async def delete_alert_rule(rule_id: str):
    async with get_db() as db:
        cur = await db.execute("DELETE FROM alert_rules WHERE id = ?", (rule_id,))
        await db.commit()
    if cur.rowcount == 0:
        raise HTTPException(404, "Alert rule not found")


# ── 発火中のアラート ───────────────────────────────────────────────────────────

@router.get("/alerts", response_model=list[AlertOut])
async def list_alerts(server_id: Optional[str] = Query(default=None)):
    """最新のメトリクスに対してルールを評価し、発火中のアラートを返す。"""
    async with get_db() as db:
        return await evaluate_alerts(db, server_id)


async def _fetch_rule(db, rule_id: str) -> AlertRuleOut:
    cur = await db.execute(
        "SELECT ar.*, s.name AS server_name FROM alert_rules ar "
        "JOIN servers s ON ar.server_id = s.id WHERE ar.id = ?",
        (rule_id,),
    )
    row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Alert rule not found")
    return row_to_rule(row)
