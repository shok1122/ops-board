import os
import uuid
import aiosqlite
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from app.config import settings

DB_PATH = settings.db_path

_SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 22,
    username TEXT NOT NULL DEFAULT '',
    auth_type TEXT NOT NULL DEFAULT 'password',
    password_enc TEXT,
    private_key_enc TEXT,
    passphrase_enc TEXT,
    server_type TEXT NOT NULL DEFAULT 'ssh',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'command',
    command TEXT,
    log_path TEXT,
    cron_expr TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    timeout_sec INTEGER NOT NULL DEFAULT 30,
    last_run_at TEXT,
    last_status TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    triggered_by TEXT NOT NULL DEFAULT 'scheduler',
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    exit_code INTEGER,
    stdout TEXT,
    stderr TEXT,
    parsed_result TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS server_status (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    checked_at TEXT NOT NULL,
    cpu_load_1m REAL,
    mem_used_mb INTEGER,
    mem_total_mb INTEGER,
    disk_used_gb REAL,
    disk_total_gb REAL,
    uptime_seconds INTEGER,
    os_info TEXT,
    error TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monitors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    interval_minutes INTEGER NOT NULL DEFAULT 5,
    enabled INTEGER NOT NULL DEFAULT 1,
    metric_type TEXT NOT NULL DEFAULT 'builtin',
    builtin_key TEXT,
    builtin_config TEXT,
    custom_script TEXT,
    unit TEXT,
    warning_threshold REAL,
    critical_threshold REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monitor_data (
    id TEXT PRIMARY KEY,
    monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    collected_at TEXT NOT NULL,
    value REAL,
    error TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('status_check_interval_minutes', '10');

CREATE TABLE IF NOT EXISTS scripts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    language TEXT NOT NULL DEFAULT 'bash',
    content TEXT NOT NULL,
    tags TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


async def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(_SCHEMA)
        await db.commit()
        # マイグレーション: server_type カラムが存在しない場合は追加
        cur = await db.execute("PRAGMA table_info(servers)")
        cols = [row[1] for row in await cur.fetchall()]
        if "server_type" not in cols:
            await db.execute(
                "ALTER TABLE servers ADD COLUMN server_type TEXT NOT NULL DEFAULT 'ssh'"
            )
            await db.commit()
        # マイグレーション: scripts テーブルに file_path カラムが存在しない場合は追加
        cur = await db.execute("PRAGMA table_info(scripts)")
        script_cols = [row[1] for row in await cur.fetchall()]
        if "file_path" not in script_cols:
            await db.execute("ALTER TABLE scripts ADD COLUMN file_path TEXT")
            await db.commit()
        # マイグレーション: monitors テーブルに last_log カラムが存在しない場合は追加
        cur = await db.execute("PRAGMA table_info(monitors)")
        monitor_cols = [row[1] for row in await cur.fetchall()]
        if "last_log" not in monitor_cols:
            await db.execute("ALTER TABLE monitors ADD COLUMN last_log TEXT")
            await db.execute("ALTER TABLE monitors ADD COLUMN last_log_at TEXT")
            await db.commit()

        # マイグレーション: jobs に execution_type カラム追加
        cur = await db.execute("PRAGMA table_info(jobs)")
        job_cols = [row[1] for row in await cur.fetchall()]
        if "execution_type" not in job_cols:
            await db.execute(
                "ALTER TABLE jobs ADD COLUMN execution_type TEXT NOT NULL DEFAULT 'remote'"
            )
            await db.execute(
                "UPDATE jobs SET execution_type = 'local' "
                "WHERE server_id IN (SELECT id FROM servers WHERE server_type = 'local_execution')"
            )
            await db.commit()

        # マイグレーション: monitors に execution_type カラム追加
        cur = await db.execute("PRAGMA table_info(monitors)")
        monitor_cols2 = [row[1] for row in await cur.fetchall()]
        if "execution_type" not in monitor_cols2:
            await db.execute(
                "ALTER TABLE monitors ADD COLUMN execution_type TEXT NOT NULL DEFAULT 'remote'"
            )
            await db.execute(
                "UPDATE monitors SET execution_type = 'local' "
                "WHERE server_id IN (SELECT id FROM servers WHERE server_type = 'local_execution')"
            )
            await db.commit()


@asynccontextmanager
async def get_db():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys=ON")
        try:
            yield db
        except Exception:
            await db.rollback()
            raise


def new_id() -> str:
    return str(uuid.uuid4())


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
