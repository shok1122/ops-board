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
    worker_token TEXT,
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
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    checked_at TEXT NOT NULL,
    uptime_seconds INTEGER,
    os_info TEXT,
    error TEXT,
    agent_version TEXT,
    go_version TEXT,
    arch TEXT,
    hostname TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (server_id, checked_at)
);

CREATE TABLE IF NOT EXISTS worker_checks (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    check_name TEXT NOT NULL,
    check_type TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    metrics_json TEXT,
    labels_json TEXT,
    error TEXT,
    reported_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(server_id, check_name)
);

"""


async def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(_SCHEMA)
        await db.commit()
        # マイグレーション: servers を新スキーマ（SSH列削除）に再作成
        cur = await db.execute("PRAGMA table_info(servers)")
        server_cols = [row[1] for row in await cur.fetchall()]
        if "port" in server_cols:
            await db.executescript("""
                CREATE TABLE IF NOT EXISTS servers_new (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    host TEXT NOT NULL,
                    worker_token TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO servers_new (id, name, host, worker_token, created_at, updated_at)
                SELECT id, name, host, worker_token, created_at, updated_at FROM servers;
                DROP TABLE servers;
                ALTER TABLE servers_new RENAME TO servers;
            """)
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

        # マイグレーション: server_status を新スキーマ（id列削除）に再作成
        cur = await db.execute("PRAGMA table_info(server_status)")
        ss_cols = [row[1] for row in await cur.fetchall()]
        if "id" in ss_cols:
            await db.executescript("""
                CREATE TABLE IF NOT EXISTS server_status_new (
                    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
                    checked_at TEXT NOT NULL,
                    uptime_seconds INTEGER,
                    os_info TEXT,
                    error TEXT,
                    agent_version TEXT,
                    go_version TEXT,
                    arch TEXT,
                    hostname TEXT,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (server_id, checked_at)
                );
                INSERT OR IGNORE INTO server_status_new
                    (server_id, checked_at, uptime_seconds, os_info, error,
                     agent_version, go_version, arch, hostname, created_at)
                SELECT server_id, checked_at, uptime_seconds, os_info, error,
                       agent_version, go_version, arch, hostname, created_at
                FROM server_status;
                DROP TABLE server_status;
                ALTER TABLE server_status_new RENAME TO server_status;
            """)
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
