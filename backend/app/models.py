from __future__ import annotations
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field, field_validator, model_validator


# ── Servers ──────────────────────────────────────────────────────────────────

class ServerCreate(BaseModel):
    name: str
    host: str
    generate_worker_credential: bool = True


class ServerUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    regenerate_id: bool = False
    regenerate_secret: bool = False


class ServerOut(BaseModel):
    id: str
    name: str
    host: str
    has_worker_credential: bool = False
    worker_id: Optional[str] = None
    worker_secret: Optional[str] = None
    created_at: str
    updated_at: str


class ServerStatusOut(BaseModel):
    server_id: str
    checked_at: str
    uptime_seconds: Optional[int] = None
    os_info: Optional[str] = None
    error: Optional[str] = None
    agent_version: Optional[str] = None
    go_version: Optional[str] = None
    arch: Optional[str] = None
    hostname: Optional[str] = None


# ── Jobs ─────────────────────────────────────────────────────────────────────

class JobCreate(BaseModel):
    name: str
    description: Optional[str] = None
    server_id: str
    type: Literal["command", "log_fetch"] = "command"
    command: Optional[str] = None
    log_path: Optional[str] = None
    cron_expr: str
    enabled: bool = True
    timeout_sec: int = Field(default=30, ge=1, le=3600)


class JobUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    server_id: Optional[str] = None
    type: Optional[Literal["command", "log_fetch"]] = None
    command: Optional[str] = None
    log_path: Optional[str] = None
    cron_expr: Optional[str] = None
    enabled: Optional[bool] = None
    timeout_sec: Optional[int] = None


class JobOut(BaseModel):
    id: str
    name: str
    description: Optional[str]
    server_id: str
    server_name: Optional[str] = None
    type: str
    command: Optional[str]
    log_path: Optional[str]
    cron_expr: str
    enabled: bool
    timeout_sec: int
    last_run_at: Optional[str]
    last_status: Optional[str]
    created_at: str
    updated_at: str


# ── Executions ───────────────────────────────────────────────────────────────

class ExecutionOut(BaseModel):
    id: str
    job_id: str
    job_name: Optional[str] = None
    triggered_by: str
    started_at: str
    finished_at: Optional[str]
    status: str
    exit_code: Optional[int]
    stdout: Optional[str]
    stderr: Optional[str]
    parsed_result: Optional[dict[str, Any]]
    created_at: str


class ExecutionSummary(BaseModel):
    id: str
    job_id: str
    job_name: Optional[str] = None
    triggered_by: str
    started_at: str
    finished_at: Optional[str]
    status: str
    exit_code: Optional[int]
    parsed_result: Optional[dict[str, Any]] = None
    created_at: str


# ── Job Result (structured stdout) ───────────────────────────────────────────

class JobResultItem(BaseModel):
    label: str
    value: Any
    unit: Optional[str] = None
    status: Optional[Literal["ok", "warn", "error"]] = None


class JobResultOutput(BaseModel):
    title: Optional[str] = None
    status: Optional[Literal["ok", "warn", "error"]] = None
    value: Optional[Any] = None
    unit: Optional[str] = None
    message: Optional[str] = None
    items: Optional[list[JobResultItem]] = None


class ServerJobResult(BaseModel):
    job_id: str
    job_name: str
    execution_id: str
    execution_status: str
    finished_at: Optional[str]
    output: Optional[JobResultOutput] = None
    raw_stdout: Optional[str] = None
    stderr: Optional[str] = None


# ── Scripts ──────────────────────────────────────────────────────────────────

class ScriptCreate(BaseModel):
    name: str
    description: Optional[str] = None
    language: Literal["bash"] = "bash"
    content: str


class ScriptUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    content: Optional[str] = None


class ScriptOut(BaseModel):
    id: str
    name: str
    description: Optional[str]
    language: str
    content: str
    created_at: str
    updated_at: str


# ── Pagination ────────────────────────────────────────────────────────────────

class PagedResponse(BaseModel):
    items: list[Any]
    total: int


# ── Alert Rules ──────────────────────────────────────────────────────────────

AlertSeverity = Literal["error", "warning"]
AlertOperator = Literal[">", ">=", "<", "<=", "==", "!="]

SEVERITIES: tuple[AlertSeverity, ...] = ("error", "warning")

# 大小を比べる演算子と、Error の閾値が Warning より大きい(1)／小さい(-1)べき向き
_ORDERED_OPERATORS: dict[str, int] = {">": 1, ">=": 1, "<": -1, "<=": -1}


class AlertCondition(BaseModel):
    """メトリクス1件に対する閾値条件。Error / Warning の閾値をセットで持つ。

    例: usage_percent >= の Error 90 / Warning 80。
    片方だけの指定も可能で、閾値の無いレベルはこの条件では判定されない。
    """
    metric_name: str = Field(min_length=1)
    operator: AlertOperator = ">"
    error_threshold: Optional[float] = None
    warning_threshold: Optional[float] = None
    # 特定チェック（レポートの name）に限定する場合に指定。None なら全チェックが対象
    check_name: Optional[str] = None

    @field_validator("metric_name")
    @classmethod
    def _strip_metric_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("metric_name must not be empty")
        return v

    @field_validator("check_name")
    @classmethod
    def _strip_check_name(cls, v: Optional[str]) -> Optional[str]:
        return (v.strip() or None) if v else None

    @model_validator(mode="after")
    def _validate_thresholds(self) -> "AlertCondition":
        if self.error_threshold is None and self.warning_threshold is None:
            raise ValueError("error_threshold or warning_threshold is required")
        direction = _ORDERED_OPERATORS.get(self.operator)
        if direction and self.error_threshold is not None and self.warning_threshold is not None:
            # Error は Warning より厳しい側でなければ、Warning が先に出る意味がなくなる
            if (self.error_threshold - self.warning_threshold) * direction < 0:
                side = "greater" if direction > 0 else "less"
                raise ValueError(
                    f"error_threshold must be {side} than or equal to warning_threshold "
                    f"for operator '{self.operator}'"
                )
        return self

    def threshold_for(self, severity: AlertSeverity) -> Optional[float]:
        return self.error_threshold if severity == "error" else self.warning_threshold


class AlertConditionGroup(BaseModel):
    """グループ内の条件は AND、グループ同士は OR で結合される。"""
    conditions: list[AlertCondition] = Field(min_length=1)

    def severities(self) -> list[AlertSeverity]:
        """このグループで判定できるレベル（全条件に閾値がそろっているもの）。"""
        return [
            sev for sev in SEVERITIES
            if all(c.threshold_for(sev) is not None for c in self.conditions)
        ]

    @model_validator(mode="after")
    def _validate_severities(self) -> "AlertConditionGroup":
        if not self.severities():
            raise ValueError(
                "all conditions in a group must share a threshold level: "
                "give every condition an Error threshold, a Warning threshold, or both"
            )
        return self


class AlertRuleBase(BaseModel):
    name: str = Field(min_length=1)
    message: Optional[str] = None
    enabled: bool = True
    groups: list[AlertConditionGroup] = Field(min_length=1)

    @field_validator("message")
    @classmethod
    def _strip_message(cls, v: Optional[str]) -> Optional[str]:
        return (v.strip() or None) if v else None


class AlertRuleCreate(AlertRuleBase):
    server_id: str


class AlertRuleUpdate(BaseModel):
    name: Optional[str] = None
    message: Optional[str] = None
    enabled: Optional[bool] = None
    groups: Optional[list[AlertConditionGroup]] = None


class AlertRuleOut(AlertRuleBase):
    id: str
    server_id: str
    server_name: Optional[str] = None
    created_at: str
    updated_at: str

    def severities(self) -> list[AlertSeverity]:
        """このルールが発火しうるレベル。"""
        found = {sev for g in self.groups for sev in g.severities()}
        return [sev for sev in SEVERITIES if sev in found]


class AlertMatch(BaseModel):
    """発火の根拠となったメトリクスの実測値。"""
    check_name: str
    metric_name: str
    value: float
    unit: Optional[str] = None
    operator: AlertOperator
    threshold: float
    reported_at: str


class AlertOut(BaseModel):
    rule_id: str
    rule_name: str
    server_id: str
    server_name: Optional[str] = None
    severity: AlertSeverity
    message: Optional[str] = None
    matches: list[AlertMatch]
    since: Optional[str] = None
    evaluated_at: str


# ── Teams Notification ───────────────────────────────────────────────────────

# on_change: 発生／解消に変化があったときだけ通知する
# always:    アラートが出ている間は毎回のチェックで通知する
NotifyMode = Literal["on_change", "always"]


class NotificationSettingsBase(BaseModel):
    enabled: bool = False
    # 通知の要否をチェックするタイミング（cron 5フィールド）
    cron_expr: str = "*/30 * * * *"
    # 通知対象の重大度
    severities: list[AlertSeverity] = ["error", "warning"]
    mode: NotifyMode = "on_change"
    # アラートが解消したときに解消通知を送るか
    notify_resolved: bool = True
    # アラートが1件も出ていないときも「異常なし」を通知するか（チェックのたびに送る）
    notify_no_alerts: bool = True


class NotificationSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    cron_expr: Optional[str] = None
    severities: Optional[list[AlertSeverity]] = None
    mode: Optional[NotifyMode] = None
    notify_resolved: Optional[bool] = None
    notify_no_alerts: Optional[bool] = None


class NotificationSettingsOut(NotificationSettingsBase):
    # docker-compose で TEAMS_WEBHOOK_URL が設定されているか。
    # False の場合は通知機能そのものが使えない
    configured: bool
    dashboard_url: Optional[str] = None
    last_checked_at: Optional[str] = None
    last_notified_at: Optional[str] = None
    last_error: Optional[str] = None
    # 次回チェック予定時刻（スケジュール登録されている場合のみ）
    next_run_at: Optional[str] = None
    updated_at: str


class NotificationCheckResult(BaseModel):
    """通知の要否チェックの結果。"""
    sent: bool
    reason: str
    firing: int = 0
    new: int = 0
    resolved: int = 0
    message: Optional[str] = None
    error: Optional[str] = None


class NotificationPreview(BaseModel):
    """いま通知するとしたら送られる本文。"""
    firing: int
    message: Optional[str] = None
