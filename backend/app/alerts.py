"""メトリクスベースのアラート判定。

ops-worker から送られてくるチェック結果（worker_checks）の最新メトリクスに対して
サーバごとに設定された alert_rules を評価し、Error / Warning のアラートを算出する。

判定式は「グループ内は AND、グループ同士は OR」の 2 階層で表現する。
    groups = [ {conditions: [A, B]}, {conditions: [C]} ]  →  (A AND B) OR C

各条件は Error / Warning の閾値をセットで持ち（例: 使用率 >= の Error 90 / Warning 80）、
1つのルールを Error → Warning の順に評価して、先に成立したレベルで発火させる。
"""
from __future__ import annotations

import json
import logging
import math
from typing import Any, NamedTuple, Optional

from app.database import now_iso
from app.models import (
    SEVERITIES, AlertCondition, AlertConditionGroup, AlertMatch, AlertOut,
    AlertRuleOut, AlertSeverity,
)

logger = logging.getLogger(__name__)

_EPSILON = 1e-9


class MetricSample(NamedTuple):
    """あるサーバの最新レポートに含まれるメトリクス1件。"""
    check_name: str
    metric_name: str
    value: float
    unit: Optional[str]
    reported_at: str


def _compare(value: float, operator: str, threshold: float) -> bool:
    if operator == ">":
        return value > threshold
    if operator == ">=":
        return value >= threshold
    if operator == "<":
        return value < threshold
    if operator == "<=":
        return value <= threshold
    equal = math.isclose(value, threshold, rel_tol=_EPSILON, abs_tol=_EPSILON)
    if operator == "==":
        return equal
    if operator == "!=":
        return not equal
    return False


def parse_groups(groups_json: str) -> list[AlertConditionGroup]:
    """DB に保存された判定式 JSON を復元する。壊れていれば空リストを返す。"""
    try:
        raw = json.loads(groups_json)
    except (TypeError, ValueError):
        logger.warning("Failed to parse alert rule groups: %r", groups_json)
        return []
    if not isinstance(raw, list):
        return []
    groups: list[AlertConditionGroup] = []
    for item in raw:
        try:
            groups.append(AlertConditionGroup.model_validate(item))
        except Exception:
            logger.warning("Skipping invalid alert condition group: %r", item)
    return groups


def dump_groups(groups: list[AlertConditionGroup]) -> str:
    return json.dumps([g.model_dump() for g in groups], ensure_ascii=False)


def upgrade_legacy_groups(raw: Any, severity: str) -> Any:
    """旧形式の判定式を現行形式に変換する。

    以前はルール単位で severity を持ち、条件の閾値は threshold の1つだけだった。
    その閾値を、ルールの severity に対応する error_threshold / warning_threshold に移す。
    """
    key = "error_threshold" if severity == "error" else "warning_threshold"
    if not isinstance(raw, list):
        return raw
    groups = []
    for group in raw:
        if not isinstance(group, dict):
            groups.append(group)
            continue
        conditions = []
        for cond in group.get("conditions") or []:
            if (
                isinstance(cond, dict)
                and cond.get("threshold") is not None
                and cond.get("error_threshold") is None
                and cond.get("warning_threshold") is None
            ):
                threshold = cond["threshold"]
                cond = {k: v for k, v in cond.items() if k != "threshold"}
                cond[key] = threshold
            conditions.append(cond)
        groups.append({**group, "conditions": conditions})
    return groups


def samples_from_check_row(row: Any) -> list[MetricSample]:
    """worker_checks の 1 行から MetricSample を取り出す。"""
    try:
        metrics = json.loads(row["metrics_json"]) if row["metrics_json"] else []
    except (TypeError, ValueError):
        return []
    samples = []
    for m in metrics:
        if not isinstance(m, dict):
            continue
        name = m.get("name")
        value = m.get("value")
        if not name or not isinstance(value, (int, float)) or isinstance(value, bool):
            continue
        samples.append(MetricSample(
            check_name=row["check_name"],
            metric_name=str(name),
            value=float(value),
            unit=m.get("unit") or None,
            reported_at=row["reported_at"],
        ))
    return samples


def _match_condition(
    cond: AlertCondition, samples: list[MetricSample], severity: AlertSeverity
) -> Optional[AlertMatch]:
    """指定レベルの閾値を満たすメトリクスを返す。

    そのレベルの閾値が無い / 該当メトリクスが無い / 満たさない場合は None。
    """
    threshold = cond.threshold_for(severity)
    if threshold is None:
        return None
    for s in samples:
        if s.metric_name != cond.metric_name:
            continue
        if cond.check_name and s.check_name != cond.check_name:
            continue
        if _compare(s.value, cond.operator, threshold):
            return AlertMatch(
                check_name=s.check_name,
                metric_name=s.metric_name,
                value=s.value,
                unit=s.unit,
                operator=cond.operator,
                threshold=threshold,
                reported_at=s.reported_at,
            )
    return None


def evaluate_rule_at(
    groups: list[AlertConditionGroup], samples: list[MetricSample], severity: AlertSeverity
) -> Optional[list[AlertMatch]]:
    """指定レベルで発火していれば、最初に成立した条件グループの実測値を返す。"""
    for group in groups:
        matches: list[AlertMatch] = []
        for cond in group.conditions:
            match = _match_condition(cond, samples, severity)
            if match is None:
                matches = []
                break
            matches.append(match)
        if matches:
            return matches
    return None


def evaluate_rule(
    groups: list[AlertConditionGroup], samples: list[MetricSample]
) -> Optional[tuple[AlertSeverity, list[AlertMatch]]]:
    """発火していれば (重大度, 実測値) を返す。Error の閾値から先に判定する。"""
    for severity in SEVERITIES:
        matches = evaluate_rule_at(groups, samples, severity)
        if matches is not None:
            return severity, matches
    return None


# ── DB アクセス ───────────────────────────────────────────────────────────────

async def load_metric_samples(db, server_id: Optional[str] = None) -> dict[str, list[MetricSample]]:
    """サーバごとの最新メトリクス一覧を返す。"""
    if server_id:
        cur = await db.execute(
            "SELECT server_id, check_name, metrics_json, reported_at FROM worker_checks "
            "WHERE server_id = ? ORDER BY check_name",
            (server_id,),
        )
    else:
        cur = await db.execute(
            "SELECT server_id, check_name, metrics_json, reported_at FROM worker_checks "
            "ORDER BY server_id, check_name"
        )
    by_server: dict[str, list[MetricSample]] = {}
    for row in await cur.fetchall():
        by_server.setdefault(row["server_id"], []).extend(samples_from_check_row(row))
    return by_server


def row_to_rule(row) -> AlertRuleOut:
    return AlertRuleOut(
        id=row["id"],
        server_id=row["server_id"],
        server_name=row["server_name"] if "server_name" in row.keys() else None,
        name=row["name"],
        message=row["message"],
        enabled=bool(row["enabled"]),
        groups=parse_groups(row["groups_json"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def load_rules(db, server_id: Optional[str] = None) -> list[AlertRuleOut]:
    sql = (
        "SELECT ar.*, s.name AS server_name FROM alert_rules ar "
        "JOIN servers s ON ar.server_id = s.id "
    )
    if server_id:
        cur = await db.execute(sql + "WHERE ar.server_id = ? ORDER BY ar.created_at", (server_id,))
    else:
        cur = await db.execute(sql + "ORDER BY s.name, ar.created_at")
    return [row_to_rule(r) for r in await cur.fetchall()]


async def evaluate_alerts(db, server_id: Optional[str] = None) -> list[AlertOut]:
    """有効なルールを評価し、発火中のアラートのみを返す（Error を先頭に並べる）。"""
    rules = await load_rules(db, server_id)
    if not rules:
        return []
    samples_by_server = await load_metric_samples(db, server_id)

    cur = await db.execute("SELECT rule_id, firing, severity, since FROM alert_states")
    states = {r["rule_id"]: r for r in await cur.fetchall()}

    now = now_iso()
    alerts: list[AlertOut] = []
    for rule in rules:
        if not rule.enabled:
            continue
        fired = evaluate_rule(rule.groups, samples_by_server.get(rule.server_id, []))
        if fired is None:
            continue
        severity, matches = fired
        state = states.get(rule.id)
        # 重大度が変わった場合は継続時間を引き継がない（Warning → Error はその時点が起点）
        continuing = bool(state and state["firing"] and state["severity"] == severity)
        alerts.append(AlertOut(
            rule_id=rule.id,
            rule_name=rule.name,
            server_id=rule.server_id,
            server_name=rule.server_name,
            severity=severity,
            message=rule.message,
            matches=matches,
            since=state["since"] if continuing else None,
            evaluated_at=now,
        ))

    alerts.sort(key=lambda a: (0 if a.severity == "error" else 1, a.server_name or "", a.rule_name))
    return alerts


async def refresh_alert_states(db, server_id: str) -> None:
    """レポート受信時に発火状態を更新する（継続開始時刻 since の記録用）。

    呼び出し側のトランザクションに参加するため、commit は行わない。
    """
    rules = await load_rules(db, server_id)
    if not rules:
        return
    samples_by_server = await load_metric_samples(db, server_id)
    samples = samples_by_server.get(server_id, [])

    cur = await db.execute(
        "SELECT rule_id, firing, severity, since FROM alert_states WHERE server_id = ?",
        (server_id,),
    )
    states = {r["rule_id"]: r for r in await cur.fetchall()}

    now = now_iso()
    for rule in rules:
        fired = evaluate_rule(rule.groups, samples) if rule.enabled else None
        severity = fired[0] if fired else None
        prev = states.get(rule.id)
        if severity:
            # 同じ重大度で発火し続けている間だけ、継続開始時刻を引き継ぐ
            continuing = prev and prev["firing"] and prev["severity"] == severity and prev["since"]
            since = prev["since"] if continuing else now
        else:
            since = None
        await db.execute(
            "INSERT INTO alert_states (rule_id, server_id, firing, severity, since, updated_at) "
            "VALUES (?,?,?,?,?,?) "
            "ON CONFLICT(rule_id) DO UPDATE SET "
            "  server_id=excluded.server_id, firing=excluded.firing, "
            "  severity=excluded.severity, since=excluded.since, "
            "  updated_at=excluded.updated_at",
            (rule.id, server_id, int(severity is not None), severity, since, now),
        )
