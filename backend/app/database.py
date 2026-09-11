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
    worker_id TEXT UNIQUE,
    worker_secret TEXT,
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
    PRIMARY KEY (server_id, check_name)
);

CREATE TABLE IF NOT EXISTS worker_ingest_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    log_type TEXT NOT NULL,
    check_name TEXT,
    status TEXT,
    message TEXT,
    received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_worker_ingest_logs_server_id
    ON worker_ingest_logs (server_id, id DESC);

CREATE TABLE IF NOT EXISTS alert_rules (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning',
    message TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    groups_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_server_id
    ON alert_rules (server_id);

CREATE TABLE IF NOT EXISTS alert_states (
    rule_id TEXT PRIMARY KEY REFERENCES alert_rules(id) ON DELETE CASCADE,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    firing INTEGER NOT NULL DEFAULT 0,
    since TEXT,
    updated_at TEXT NOT NULL
);

-- Teams 通知の設定（Web 画面から編集する単一行）
CREATE TABLE IF NOT EXISTS notification_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 0,
    cron_expr TEXT NOT NULL DEFAULT '*/30 * * * *',
    severities TEXT NOT NULL DEFAULT 'error,warning',
    mode TEXT NOT NULL DEFAULT 'on_change',
    notify_resolved INTEGER NOT NULL DEFAULT 1,
    last_checked_at TEXT,
    last_notified_at TEXT,
    last_error TEXT,
    updated_at TEXT NOT NULL
);

-- 直前に通知済みのアラート（通知の要否を判定するための状態）
-- ルール／ジョブが消えても解消通知を出せるよう、表示名も一緒に保持する
CREATE TABLE IF NOT EXISTS notified_alerts (
    alert_key TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    severity TEXT NOT NULL,
    server_name TEXT,
    title TEXT NOT NULL,
    notified_at TEXT NOT NULL
);

"""


async def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(_SCHEMA)
        # 通知設定は常に 1 行だけ存在させる（値は列のデフォルトに任せる）
        await db.execute(
            "INSERT OR IGNORE INTO notification_settings (id, updated_at) VALUES (1, ?)",
            (now_iso(),),
        )
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
                    worker_id TEXT UNIQUE,
                    worker_secret TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO servers_new (id, name, host, worker_id, worker_secret, created_at, updated_at)
                SELECT id, name, host, NULL, NULL, created_at, updated_at FROM servers;
                DROP TABLE servers;
                ALTER TABLE servers_new RENAME TO servers;
            """)
            await db.commit()
        if "worker_token" in server_cols and "worker_id" not in server_cols:
            await db.executescript("""
                CREATE TABLE IF NOT EXISTS servers_new (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    host TEXT NOT NULL,
                    worker_id TEXT UNIQUE,
                    worker_secret TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO servers_new (id, name, host, worker_id, worker_secret, created_at, updated_at)
                SELECT id, name, host, NULL, NULL, created_at, updated_at FROM servers;
                DROP TABLE servers;
                ALTER TABLE servers_new RENAME TO servers;
            """)
            await db.commit()
        # マイグレーション: jobs に execution_type カラム追加
        cur = await db.execute("PRAGMA table_info(jobs)")
        job_cols = [row[1] for row in await cur.fetchall()]
        if "execution_type" not in job_cols:
            await db.execute(
                "ALTER TABLE jobs ADD COLUMN execution_type TEXT NOT NULL DEFAULT 'local'"
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

        # マイグレーション: worker_checks を新スキーマ（id列削除）に再作成
        cur = await db.execute("PRAGMA table_info(worker_checks)")
        wc_cols = [row[1] for row in await cur.fetchall()]
        if "id" in wc_cols:
            await db.executescript("""
                CREATE TABLE IF NOT EXISTS worker_checks_new (
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
                    PRIMARY KEY (server_id, check_name)
                );
                INSERT OR IGNORE INTO worker_checks_new
                    (server_id, check_name, check_type, status, message,
                     metrics_json, labels_json, error, reported_at, created_at)
                SELECT server_id, check_name, check_type, status, message,
                       metrics_json, labels_json, error, reported_at, created_at
                FROM worker_checks;
                DROP TABLE worker_checks;
                ALTER TABLE worker_checks_new RENAME TO worker_checks;
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
