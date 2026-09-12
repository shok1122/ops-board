"""ジョブ実行結果（構造化出力）の共通処理。

ジョブのコマンドは標準出力の最終行に JSON を出す（job_result_schema.json）。
その解釈はダッシュボード表示・Teams 通知・アラート判定で共通なので、ここにまとめる。
"""
from __future__ import annotations

import json
from typing import Any, NamedTuple, Optional

from app.models import JobResultOutput

# 構造化出力のトップレベル value を指す予約名（items のラベルと同じ名前空間で扱う）
MAIN_VALUE_NAME = "value"


def parse_result_json(stdout: Optional[str]) -> Optional[dict]:
    """標準出力の最後の非空行を JSON オブジェクトとして読む。"""
    if not stdout:
        return None
    lines = [line for line in stdout.splitlines() if line.strip()]
    if not lines:
        return None
    try:
        obj: Any = json.loads(lines[-1])
    except (json.JSONDecodeError, ValueError):
        return None
    return obj if isinstance(obj, dict) else None


def to_output(obj: Optional[dict]) -> Optional[JobResultOutput]:
    """JSON オブジェクトを JobResultOutput として解釈する（未知のキーは捨てる）。"""
    if obj is None:
        return None
    try:
        return JobResultOutput(**{
            k: v for k, v in obj.items() if k in JobResultOutput.model_fields
        })
    except Exception:
        return None


def parse_job_output(stdout: Optional[str]) -> Optional[JobResultOutput]:
    return to_output(parse_result_json(stdout))


def output_from_row(row) -> Optional[JobResultOutput]:
    """executions の行から構造化出力を取り出す。

    保存済みの parsed_result を優先し、無ければ stdout を読み直す
    （parsed_result を持たない古い実行のため）。
    """
    keys = row.keys()
    raw = row["parsed_result"] if "parsed_result" in keys else None
    if raw:
        try:
            obj = json.loads(raw)
        except (TypeError, ValueError):
            obj = None
        if isinstance(obj, dict):
            return to_output(obj)
    return parse_job_output(row["stdout"] if "stdout" in keys else None)


def as_number(value: Any) -> Optional[float]:
    """数値、または数値として読める文字列を float にする。それ以外は None。"""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


class NumericField(NamedTuple):
    """アラートの閾値判定に使える、ジョブ出力の数値1件。"""
    name: str
    value: float
    unit: Optional[str]


def numeric_fields(output: Optional[JobResultOutput]) -> list[NumericField]:
    """閾値判定に使える数値を列挙する。

    トップレベルの value は "value"、items はそれぞれの label を名前にする。
    値が数値として読めない項目（"running" など）は対象外。
    """
    if output is None:
        return []
    fields: list[NumericField] = []
    main = as_number(output.value)
    if main is not None:
        fields.append(NumericField(MAIN_VALUE_NAME, main, output.unit or None))
    for item in output.items or []:
        num = as_number(item.value)
        if num is not None:
            fields.append(NumericField(item.label, num, item.unit or None))
    return fields


async def load_latest_results(db, server_id: Optional[str] = None):
    """ジョブごとの最新実行を返す（サーバ名・ジョブ名つき）。"""
    sql = (
        "SELECT e.id AS execution_id, e.job_id, j.name AS job_name, j.server_id, "
        "s.name AS server_name, e.status AS execution_status, e.started_at, e.finished_at, "
        "e.stdout, e.stderr, e.parsed_result "
        "FROM executions e "
        "INNER JOIN jobs j ON e.job_id = j.id "
        "INNER JOIN servers s ON j.server_id = s.id "
        "INNER JOIN ("
        "  SELECT job_id, MAX(started_at) AS latest FROM executions GROUP BY job_id"
        ") latest ON e.job_id = latest.job_id AND e.started_at = latest.latest "
    )
    if server_id:
        cur = await db.execute(sql + "WHERE j.server_id = ? ORDER BY j.name", (server_id,))
    else:
        cur = await db.execute(sql + "ORDER BY s.name, j.name")
    return await cur.fetchall()
