"""メトリクスベースのアラート判定。

ops-worker から送られてくるチェック結果（worker_checks）の最新メトリクスに対して
サーバごとに設定された alert_rules を評価し、Error / Warning のアラートを算出する。

判定式は「グループ内は AND、グループ同士は OR」の 2 階層で表現する。
    groups = [ {conditions: [A, B]}, {conditions: [C]} ]  →  (A AND B) OR C
"""
from __future__ import annotations

import json
import logging
import math
from typing import Any, NamedTuple, Optional

from app.database import now_iso
from app.models import (
    AlertCondition, AlertConditionGroup, AlertMatch, AlertOut, AlertRuleOut,
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


def _match_condition(cond: AlertCondition, samples: list[MetricSample]) -> Optional[AlertMatch]:
    """条件を満たすメトリクスを返す。該当メトリクスが無い / 満たさない場合は None。"""
    for s in samples:
        if s.metric_name != cond.metric_name:
            continue
        if cond.check_name and s.check_name != cond.check_name:
            continue
        if _compare(s.value, cond.operator, cond.threshold):
            return AlertMatch(
                check_name=s.check_name,
                metric_name=s.metric_name,
                value=s.value,
                unit=s.unit,
                operator=cond.operator,
                threshold=cond.threshold,
                reported_at=s.reported_at,
            )
    return None


def evaluate_rule(
    groups: list[AlertConditionGroup], samples: list[MetricSample]
) -> Optional[list[AlertMatch]]:
    """発火していれば最初に成立した条件グループの実測値を、していなければ None を返す。"""
    for group in groups:
        matches: list[AlertMatch] = []
        for cond in group.conditions:
            match = _match_condition(cond, samples)
            if match is None:
                matches = []
                break
            matches.append(match)
        if matches:
            return matches
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
        severity=row["severity"],
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

    cur = await db.execute("SELECT rule_id, firing, since FROM alert_states")
    states = {r["rule_id"]: r for r in await cur.fetchall()}

    now = now_iso()
    alerts: list[AlertOut] = []
    for rule in rules:
        if not rule.enabled:
            continue
        matches = evaluate_rule(rule.groups, samples_by_server.get(rule.server_id, []))
        if matches is None:
            continue
        state = states.get(rule.id)
        alerts.append(AlertOut(
            rule_id=rule.id,
            rule_name=rule.name,
            server_id=rule.server_id,
            server_name=rule.server_name,
            severity=rule.severity,
            message=rule.message,
            matches=matches,
            since=state["since"] if state and state["firing"] else None,
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
        "SELECT rule_id, firing, since FROM alert_states WHERE server_id = ?", (server_id,)
    )
    states = {r["rule_id"]: r for r in await cur.fetchall()}

    now = now_iso()
    for rule in rules:
        firing = rule.enabled and evaluate_rule(rule.groups, samples) is not None
        prev = states.get(rule.id)
        if firing:
            since = prev["since"] if prev and prev["firing"] and prev["since"] else now
        else:
            since = None
        await db.execute(
            "INSERT INTO alert_states (rule_id, server_id, firing, since, updated_at) "
            "VALUES (?,?,?,?,?) "
            "ON CONFLICT(rule_id) DO UPDATE SET "
            "  server_id=excluded.server_id, firing=excluded.firing, "
            "  since=excluded.since, updated_at=excluded.updated_at",
            (rule.id, server_id, int(firing), since, now),
        )
