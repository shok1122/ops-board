"""Teams 通知の設定 API。

Webhook URL などの接続情報は docker-compose（環境変数）側で持つため、
この API で扱うのは「いつ通知の要否をチェックするか」などの運用設定だけ。
"""
from fastapi import APIRouter, HTTPException

from app.config import settings
from app.database import get_db, now_iso
from app.models import (
    NotificationCheckResult, NotificationPreview, NotificationSettingsOut,
    NotificationSettingsUpdate,
)
from app.notifications import (
    dump_severities, load_settings, preview_message, run_check,
    send_teams_message, teams_configured,
)
from app.scheduler import notification_next_run_at, parse_cron, reload_notification_job

router = APIRouter(prefix="/notifications", tags=["notifications"])


async def _settings_out() -> NotificationSettingsOut:
    async with get_db() as db:
        stored = await load_settings(db)
    return NotificationSettingsOut(
        **stored.base.model_dump(),
        configured=teams_configured(),
        dashboard_url=settings.teams_dashboard_url.strip() or None,
        last_checked_at=stored.last_checked_at,
        last_notified_at=stored.last_notified_at,
        last_error=stored.last_error,
        next_run_at=notification_next_run_at(),
        updated_at=stored.updated_at,
    )


@router.get("/teams", response_model=NotificationSettingsOut)
async def get_teams_settings():
    return await _settings_out()


@router.put("/teams", response_model=NotificationSettingsOut)
async def update_teams_settings(body: NotificationSettingsUpdate):
    updates: dict = {}
    if body.enabled is not None:
        updates["enabled"] = int(body.enabled)
    if body.cron_expr is not None:
        expr = body.cron_expr.strip()
        if parse_cron(expr) is None:
            raise HTTPException(400, "cron 式が不正です（5フィールドで指定してください）")
        updates["cron_expr"] = expr
    if body.severities is not None:
        if not body.severities:
            raise HTTPException(400, "通知対象の重大度を1つ以上選択してください")
        updates["severities"] = dump_severities(body.severities)
    if body.mode is not None:
        updates["mode"] = body.mode
    if body.notify_resolved is not None:
        updates["notify_resolved"] = int(body.notify_resolved)
    updates["updated_at"] = now_iso()

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    async with get_db() as db:
        await db.execute(
            f"UPDATE notification_settings SET {set_clause} WHERE id = 1",
            tuple(updates.values()),
        )
        await db.commit()

    # cron や有効・無効が変わったらスケジュールを貼り替える
    await reload_notification_job()
    return await _settings_out()


@router.post("/teams/check", response_model=NotificationCheckResult)
async def check_now():
    """通知の要否チェックを今すぐ実行する（設定が無効でも動作確認できる）。"""
    if not teams_configured():
        raise HTTPException(400, "Teams の Webhook URL が設定されていません")
    return await run_check(force=True)


@router.post("/teams/test", response_model=NotificationCheckResult)
async def send_test():
    """疎通確認用のテスト通知を送る。"""
    if not teams_configured():
        raise HTTPException(400, "Teams の Webhook URL が設定されていません")

    lines = [
        "🔔 OpsBoard テスト通知",
        "この通知が届いていれば Teams への連携は正常です。",
    ]
    dashboard_url = settings.teams_dashboard_url.strip()
    if dashboard_url:
        lines.append(f"🔗 ダッシュボード: {dashboard_url}")
    message = "\n\n".join(lines)

    try:
        await send_teams_message(message)
    except Exception as exc:
        return NotificationCheckResult(
            sent=False, reason="error", message=message, error=str(exc)
        )
    return NotificationCheckResult(sent=True, reason="test", message=message)


@router.get("/teams/preview", response_model=NotificationPreview)
async def preview():
    """いま通知するとしたらどんな本文になるかを返す（送信はしない）。"""
    async with get_db() as db:
        firing, message = await preview_message(db)
    return NotificationPreview(firing=firing, message=message)
