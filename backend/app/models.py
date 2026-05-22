from __future__ import annotations
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


# ── Servers ──────────────────────────────────────────────────────────────────

class ServerCreate(BaseModel):
    name: str
    host: str
    generate_worker_token: bool = True


class ServerUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    regenerate_token: bool = False


class ServerOut(BaseModel):
    id: str
    name: str
    host: str
    has_worker_token: bool = False
    worker_token: Optional[str] = None
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
