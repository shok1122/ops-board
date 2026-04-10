from __future__ import annotations
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


# ── Servers ──────────────────────────────────────────────────────────────────

class ServerCreate(BaseModel):
    name: str
    host: str
    port: int = 22
    username: str
    auth_type: Literal["password", "key"] = "password"
    password: Optional[str] = None
    private_key: Optional[str] = None
    passphrase: Optional[str] = None


class ServerUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    auth_type: Optional[Literal["password", "key"]] = None
    password: Optional[str] = None
    private_key: Optional[str] = None
    passphrase: Optional[str] = None


class ServerOut(BaseModel):
    id: str
    name: str
    host: str
    port: int
    username: str
    auth_type: str
    created_at: str
    updated_at: str


class TestResult(BaseModel):
    ok: bool
    latency_ms: Optional[float] = None
    error: Optional[str] = None


class ServerStatusOut(BaseModel):
    id: str
    server_id: str
    checked_at: str
    cpu_load_1m: Optional[float] = None
    mem_used_mb: Optional[int] = None
    mem_total_mb: Optional[int] = None
    disk_used_gb: Optional[float] = None
    disk_total_gb: Optional[float] = None
    uptime_seconds: Optional[int] = None
    os_info: Optional[str] = None
    error: Optional[str] = None


# ── Settings ─────────────────────────────────────────────────────────────────

class AppSettings(BaseModel):
    status_check_interval_minutes: int = Field(default=10, ge=0, le=1440)


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
    parsed_result: Optional[list[dict[str, Any]]]
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
    created_at: str


# ── Pagination ────────────────────────────────────────────────────────────────

class PagedResponse(BaseModel):
    items: list[Any]
    total: int
