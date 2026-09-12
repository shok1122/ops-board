"""ダッシュボードのアラートを Teams に通知する。

Teams の接続情報（Webhook URL）は docker-compose で与える環境変数から読む。
TEAMS_WEBHOOK_URL が設定されていない場合、通知機能は使えない状態になる。

通知の要否をチェックするタイミングは Web 画面で cron 形式で指定し、
スケジューラが各タイミングで run_check() を呼ぶ。通知は Adaptive Card（JSON）を
組み立て、Incoming Webhook に添付ファイル1件のメッセージとして POST する。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, NamedTuple, Optional

import httpx

from app.alerts import evaluate_alerts
from app.config import settings
from app.database import now_iso
from app.models import (
    JobResultOutput, NotificationCheckResult, NotificationSettingsBase,
)

logger = logging.getLogger(__name__)

SEVERITY_EMOJI = {"error": "🔴", "warning": "🟡"}
SEVERITY_LABEL = {"error": "異常", "warning": "警告"}

# 1通の通知に載せるアラートの上限（超過分は件数だけ伝える）
MAX_ITEMS_PER_MESSAGE = 20


# ── 通知対象アラート ──────────────────────────────────────────────────────────

class NotifyItem(NamedTuple):
    """通知1件分のアラート。メトリクス判定とジョブ実行結果の両方を同じ形で扱う。"""
    key: str            # 状態管理用の一意キー
    source: str         # 'metric' | 'job'
    severity: str       # 'error' | 'warning'
    server_name: str
    title: str
    details: list[str]


class ResolvedItem(NamedTuple):
    """前回通知時には出ていて、今は出ていないアラート。"""
    key: str
    severity: str
    server_name: str
    title: str


def teams_configured() -> bool:
    """docker-compose で Teams の Webhook URL が設定されているか。"""
    return bool(settings.teams_webhook_url.strip())


def _fmt_num(value: float) -> str:
    if value == int(value):
        return str(int(value))
    return f"{value:.2f}".rstrip("0").rstrip(".")


def _humanize_since(iso: str) -> Optional[str]:
    """継続時間を「3時間12分」のような表記にする。"""
    try:
        started = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    total = int((datetime.now(timezone.utc) - started).total_seconds())
    if total < 60:
        return "1分未満"
    days, rem = divmod(total, 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    parts = []
    if days:
        parts.append(f"{days}日")
    if hours:
        parts.append(f"{hours}時間")
    if minutes and not days:
        parts.append(f"{minutes}分")
    return "".join(parts) or "1分未満"


async def _collect_metric_items(db, severities: list[str]) -> list[NotifyItem]:
    """メトリクス判定によるアラート（alert_rules）を集める。"""
    items: list[NotifyItem] = []
    for alert in await evaluate_alerts(db):
        if alert.severity not in severities:
            continue
        details: list[str] = []
        if alert.message:
            details.append(alert.message)
        for m in alert.matches:
            unit = f" {m.unit}" if m.unit else ""
            details.append(
                f"{m.check_name}.{m.metric_name} {_fmt_num(m.value)}{unit} "
                f"({m.operator} {_fmt_num(m.threshold)})"
            )
        if alert.since:
            elapsed = _humanize_since(alert.since)
            if elapsed:
                details.append(f"継続: {elapsed}")
        items.append(NotifyItem(
            key=f"rule:{alert.rule_id}",
            source="metric",
            severity=alert.severity,
            server_name=alert.server_name or "",
            title=alert.rule_name,
            details=details,
        ))
    return items


def _parse_job_output(stdout: Optional[str]) -> Optional[JobResultOutput]:
    """ジョブ標準出力の最後の非空行を JobResultOutput として解釈する。"""
    if not stdout:
        return None
    lines = [line for line in stdout.splitlines() if line.strip()]
    if not lines:
        return None
    try:
        obj: Any = json.loads(lines[-1])
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(obj, dict):
        return None
    try:
        return JobResultOutput(**{
            k: v for k, v in obj.items() if k in JobResultOutput.model_fields
        })
    except Exception:
        return None


async def _collect_job_items(db, severities: list[str]) -> list[NotifyItem]:
    """ジョブ実行結果によるアラート（ダッシュボードと同じ判定）を集める。

    出力の status が error / warn、または構造化出力が無く実行が失敗・タイムアウト
    した場合をアラートとして扱う。
    """
    cur = await db.execute(
        "SELECT j.id AS job_id, j.name AS job_name, s.name AS server_name, "
        "e.status AS execution_status, e.stdout, e.stderr "
        "FROM executions e "
        "INNER JOIN jobs j ON e.job_id = j.id "
        "INNER JOIN servers s ON j.server_id = s.id "
        "INNER JOIN ("
        "  SELECT job_id, MAX(started_at) AS latest FROM executions GROUP BY job_id"
        ") latest ON e.job_id = latest.job_id AND e.started_at = latest.latest "
        "ORDER BY s.name, j.name"
    )
    items: list[NotifyItem] = []
    for row in await cur.fetchall():
        output = _parse_job_output(row["stdout"])
        details: list[str] = []
        if output and output.status in ("error", "warn"):
            severity = "error" if output.status == "error" else "warning"
            if output.value is not None:
                unit = f" {output.unit}" if output.unit else ""
                details.append(f"{output.title or '値'}: {output.value}{unit}")
            if output.message:
                details.append(output.message)
            for item in output.items or []:
                if item.status in ("error", "warn"):
                    unit = f" {item.unit}" if item.unit else ""
                    details.append(f"{item.label}: {item.value}{unit}")
        elif output is None and row["execution_status"] in ("failure", "timeout"):
            severity = "error"
            details.append(f"実行結果: {row['execution_status']}")
            stderr = (row["stderr"] or "").strip()
            if stderr:
                details.append(stderr.splitlines()[0][:200])
        else:
            continue

        if severity not in severities:
            continue
        items.append(NotifyItem(
            key=f"job:{row['job_id']}",
            source="job",
            severity=severity,
            server_name=row["server_name"] or "",
            title=row["job_name"],
            details=details,
        ))
    return items


async def collect_items(db, severities: list[str]) -> list[NotifyItem]:
    """ダッシュボードに出ているアラートを通知単位で集める（Error を先頭に）。"""
    items = await _collect_metric_items(db, severities)
    items += await _collect_job_items(db, severities)
    items.sort(key=lambda i: (0 if i.severity == "error" else 1, i.server_name, i.title))
    return items


# ── 通知内容の組み立て ────────────────────────────────────────────────────────

class Section(NamedTuple):
    """通知1ブロック。Adaptive Card と画面表示用テキストの共通の材料にする。"""
    heading: str
    lines: list[str]
    color: Optional[str] = None   # Adaptive Card の TextBlock color


class Notification(NamedTuple):
    """Teams に送る Adaptive Card と、画面表示・確認用のテキスト表現。"""
    card: dict
    text: str


# 重大度 → Adaptive Card の色
CARD_COLOR = {"error": "attention", "warning": "warning"}


def _label(item: NotifyItem | ResolvedItem) -> str:
    server = f"[{item.server_name}] " if item.server_name else ""
    return f"{server}{item.title}"


def _build_card(
    title: str,
    subtitle: str,
    color: Optional[str],
    sections: list[Section],
) -> dict:
    """Teams に送る Adaptive Card 本体（attachment の content 部分）を組み立てる。"""
    body: list[dict] = [{
        "type": "TextBlock",
        "text": title,
        "wrap": True,
        "weight": "Bolder",
        "size": "Large",
        **({"color": color} if color else {}),
    }]
    if subtitle:
        body.append({
            "type": "TextBlock", "text": subtitle, "wrap": True,
            "spacing": "Small", "isSubtle": True,
        })

    for section in sections:
        items: list[dict] = [{
            "type": "TextBlock",
            "text": section.heading,
            "wrap": True,
            "weight": "Bolder",
            **({"color": section.color} if section.color else {}),
        }]
        items += [
            {
                "type": "TextBlock", "text": f"・{line}", "wrap": True,
                "spacing": "None", "isSubtle": True,
            }
            for line in section.lines
        ]
        body.append({"type": "Container", "separator": True, "items": items})

    card: dict = {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.4",
        "msteams": {"width": "Full"},
        "body": body,
    }
    dashboard_url = settings.teams_dashboard_url.strip()
    if dashboard_url:
        card["actions"] = [{
            "type": "Action.OpenUrl",
            "title": "ダッシュボードを開く",
            "url": dashboard_url,
        }]
    return card


def _build_text(title: str, subtitle: str, sections: list[Section]) -> str:
    """同じ内容を画面表示・ログ向けのテキストにする（送信には使わない）。"""
    blocks = ["\n".join(filter(None, (title, subtitle)))]
    for section in sections:
        blocks.append("\n".join([
            section.heading, *(f"　・{line}" for line in section.lines),
        ]))
    dashboard_url = settings.teams_dashboard_url.strip()
    if dashboard_url:
        blocks.append(f"🔗 ダッシュボード: {dashboard_url}")
    return "\n\n".join(blocks)


def build_notification(
    firing: list[NotifyItem],
    new_keys: set[str],
    resolved: list[ResolvedItem],
) -> Notification:
    """アラートの状況から Adaptive Card と表示用テキストを作る。"""
    if firing:
        error_count = sum(1 for i in firing if i.severity == "error")
        warning_count = len(firing) - error_count
        counts = []
        if error_count:
            counts.append(f"{SEVERITY_EMOJI['error']} 異常 {error_count}件")
        if warning_count:
            counts.append(f"{SEVERITY_EMOJI['warning']} 警告 {warning_count}件")
        title = "🚨 OpsBoard アラート通知"
        subtitle = "発生中: " + " / ".join(counts)
        color = "attention" if error_count else "warning"
    else:
        title = "✅ OpsBoard アラート解消"
        subtitle = "発生中のアラートはありません。"
        color = "good"

    sections: list[Section] = []
    for item in firing[:MAX_ITEMS_PER_MESSAGE]:
        prefix = "🆕 " if item.key in new_keys else ""
        sections.append(Section(
            heading=(
                f"{prefix}{SEVERITY_EMOJI[item.severity]} "
                f"{SEVERITY_LABEL[item.severity]}: {_label(item)}"
            ),
            lines=list(item.details),
            color=CARD_COLOR[item.severity],
        ))

    hidden = len(firing) - MAX_ITEMS_PER_MESSAGE
    if hidden > 0:
        sections.append(Section(heading=f"…ほか {hidden}件", lines=[]))

    if resolved:
        sections.append(Section(
            heading="✅ 解消したアラート",
            lines=[f"{SEVERITY_LABEL[r.severity]}: {_label(r)}" for r in resolved],
            color="good",
        ))

    return Notification(
        card=_build_card(title, subtitle, color, sections),
        text=_build_text(title, subtitle, sections),
    )


def build_test_notification() -> Notification:
    """疎通確認用のテスト通知を作る。"""
    title = "🔔 OpsBoard テスト通知"
    subtitle = "この通知が届いていれば Teams への連携は正常です。"
    return Notification(
        card=_build_card(title, subtitle, "good", []),
        text=_build_text(title, subtitle, []),
    )


async def send_teams_card(card: dict) -> None:
    """Incoming Webhook に Adaptive Card を送る。失敗時は例外を投げる。

    Teams は Adaptive Card を「添付ファイル1件のメッセージ」として受け取るので、
    カード本体を attachments でくるんで POST する。この形式は従来の Office 365
    コネクタでも Power Automate のワークフローでも受け付けられる。
    """
    url = settings.teams_webhook_url.strip()
    if not url:
        raise RuntimeError("TEAMS_WEBHOOK_URL が設定されていません")
    payload = {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "contentUrl": None,
            "content": card,
        }],
    }
    async with httpx.AsyncClient(timeout=settings.teams_timeout_sec) as client:
        resp = await client.post(url, json=payload)
    if resp.status_code >= 400:
        raise RuntimeError(
            f"Teams Webhook がエラーを返しました: {resp.status_code} {resp.text[:200]}"
        )


# ── 設定と通知状態の読み書き ──────────────────────────────────────────────────

class StoredSettings(NamedTuple):
    base: NotificationSettingsBase
    last_checked_at: Optional[str]
    last_notified_at: Optional[str]
    last_error: Optional[str]
    updated_at: str


def _parse_severities(raw: Optional[str]) -> list[str]:
    values = [s.strip() for s in (raw or "").split(",")]
    return [s for s in values if s in SEVERITY_EMOJI]


async def load_settings(db) -> StoredSettings:
    cur = await db.execute("SELECT * FROM notification_settings WHERE id = 1")
    row = await cur.fetchone()
    if not row:
        # init_db で必ず作られるが、念のためデフォルトを返す
        return StoredSettings(NotificationSettingsBase(), None, None, None, now_iso())
    return StoredSettings(
        base=NotificationSettingsBase(
            enabled=bool(row["enabled"]),
            cron_expr=row["cron_expr"],
            severities=_parse_severities(row["severities"]),
            mode=row["mode"] if row["mode"] in ("on_change", "always") else "on_change",
            notify_resolved=bool(row["notify_resolved"]),
        ),
        last_checked_at=row["last_checked_at"],
        last_notified_at=row["last_notified_at"],
        last_error=row["last_error"],
        updated_at=row["updated_at"],
    )


def dump_severities(severities: list[str]) -> str:
    # 重複を除き error → warning の順に正規化する
    return ",".join(s for s in ("error", "warning") if s in severities)


async def _load_notified(db) -> dict[str, ResolvedItem]:
    cur = await db.execute(
        "SELECT alert_key, severity, server_name, title FROM notified_alerts"
    )
    return {
        row["alert_key"]: ResolvedItem(
            key=row["alert_key"],
            severity=row["severity"] if row["severity"] in SEVERITY_EMOJI else "error",
            server_name=row["server_name"] or "",
            title=row["title"],
        )
        for row in await cur.fetchall()
    }


async def _replace_notified(db, items: list[NotifyItem], now: str) -> None:
    await db.execute("DELETE FROM notified_alerts")
    for item in items:
        await db.execute(
            "INSERT INTO notified_alerts "
            "(alert_key, source, severity, server_name, title, notified_at) "
            "VALUES (?,?,?,?,?,?)",
            (item.key, item.source, item.severity, item.server_name, item.title, now),
        )


# ── 通知の要否チェック ────────────────────────────────────────────────────────

async def run_check(force: bool = False) -> NotificationCheckResult:
    """通知が必要かを判定し、必要なら Teams に送る。

    force=True のときは設定が無効でもチェックを実行する（画面からの手動実行用）。
    """
    from app.database import get_db

    if not teams_configured():
        return NotificationCheckResult(sent=False, reason="not_configured")

    async with get_db() as db:
        stored = await load_settings(db)
        conf = stored.base
        if not conf.enabled and not force:
            return NotificationCheckResult(sent=False, reason="disabled")
        if not conf.severities:
            return NotificationCheckResult(sent=False, reason="no_severities")

        now = now_iso()
        firing = await collect_items(db, conf.severities)
        previous = await _load_notified(db)
        current_keys = {i.key for i in firing}

        new_keys = {
            i.key for i in firing
            if i.key not in previous or previous[i.key].severity != i.severity
        }
        # 通知対象から外した重大度の残骸は「解消」として扱わない
        resolved = [
            p for key, p in previous.items()
            if key not in current_keys and p.severity in conf.severities
        ]
        report_resolved = resolved if conf.notify_resolved else []

        should_send = bool(
            (firing and (conf.mode == "always" or new_keys or report_resolved))
            or (not firing and report_resolved)
        )

        result = NotificationCheckResult(
            sent=False,
            reason="no_change" if firing else "no_alerts",
            firing=len(firing),
            new=len(new_keys),
            resolved=len(report_resolved),
        )

        if not should_send:
            # 通知しないと決めた解消分は、次に再発したとき新規として扱えるよう消す
            for item in resolved:
                await db.execute(
                    "DELETE FROM notified_alerts WHERE alert_key = ?", (item.key,)
                )
            await db.execute(
                "UPDATE notification_settings SET last_checked_at = ? WHERE id = 1",
                (now,),
            )
            await db.commit()
            return result

        notification = build_notification(firing, new_keys, report_resolved)
        try:
            await send_teams_card(notification.card)
        except Exception as exc:
            logger.error("Teams notification failed: %s", exc)
            await db.execute(
                "UPDATE notification_settings SET last_checked_at = ?, last_error = ? "
                "WHERE id = 1",
                (now, str(exc)[:500]),
            )
            await db.commit()
            return result.model_copy(update={
                "reason": "error", "error": str(exc), "message": notification.text,
            })

        await _replace_notified(db, firing, now)
        await db.execute(
            "UPDATE notification_settings SET last_checked_at = ?, last_notified_at = ?, "
            "last_error = NULL WHERE id = 1",
            (now, now),
        )
        await db.commit()

    logger.info(
        "Sent Teams notification (firing=%d new=%d resolved=%d)",
        len(firing), len(new_keys), len(report_resolved),
    )
    return result.model_copy(update={
        "sent": True, "reason": "sent", "message": notification.text,
    })


async def preview_message(db) -> tuple[int, Optional[str]]:
    """現在のアラート内容で通知文を組み立てて返す（送信はしない）。"""
    stored = await load_settings(db)
    severities = stored.base.severities or ["error", "warning"]
    firing = await collect_items(db, severities)
    if not firing:
        return 0, None
    return len(firing), build_notification(firing, set(), []).text
