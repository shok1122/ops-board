from contextlib import asynccontextmanager
import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.scheduler import scheduler, reload_all_jobs, get_scheduler_status
from app.routers import servers, jobs, executions, settings, config, job_templates, scripts
from app.routers.ingest import router as ingest_router
from app.routers.worker_checks import router as worker_checks_router
from app.routers.auth import router as auth_router, require_auth

logging.basicConfig(level=logging.INFO)


async def _migrate_scripts_to_files():
    """DB に content があり file_path が未設定のスクリプトをファイルへ移行する。"""
    import logging
    from pathlib import Path
    from app.config import settings
    from app.database import get_db, now_iso

    _EXT = {"bash": "sh", "python": "py", "ruby": "rb"}
    log = logging.getLogger(__name__)

    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, language, content FROM scripts WHERE (file_path IS NULL OR file_path = '') AND content != ''"
        )
        rows = await cur.fetchall()

    for row in rows:
        ext = _EXT.get(row["language"], "sh")
        d = Path(settings.scripts_dir) / "user"
        d.mkdir(parents=True, exist_ok=True)
        file_path = d / f"{row['id']}.{ext}"
        try:
            file_path.write_text(row["content"], encoding="utf-8")
            async with get_db() as db:
                await db.execute(
                    "UPDATE scripts SET file_path = ?, content = '', updated_at = ? WHERE id = ?",
                    (str(file_path), now_iso(), row["id"]),
                )
                await db.commit()
            log.info("Migrated script %s to %s", row["id"], file_path)
        except Exception as exc:
            log.error("Failed to migrate script %s: %s", row["id"], exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await _migrate_scripts_to_files()
    scheduler.start()
    await reload_all_jobs()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="OpsBoard API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 認証ルーター（認証不要の公開エンドポイント）
app.include_router(auth_router, prefix="/api/v1")

# ops-worker ingest（認証はBearer tokenで自己処理）
app.include_router(ingest_router, prefix="/api/v1")

# 保護されたルーター（全エンドポイントに require_auth を適用）
_auth = [Depends(require_auth)]
app.include_router(servers.router, prefix="/api/v1", dependencies=_auth)
app.include_router(jobs.router, prefix="/api/v1", dependencies=_auth)
app.include_router(executions.router, prefix="/api/v1", dependencies=_auth)
app.include_router(settings.router, prefix="/api/v1", dependencies=_auth)
app.include_router(config.router, prefix="/api/v1", dependencies=_auth)
app.include_router(job_templates.router, prefix="/api/v1", dependencies=_auth)
app.include_router(scripts.router, prefix="/api/v1", dependencies=_auth)
app.include_router(worker_checks_router, prefix="/api/v1", dependencies=_auth)


@app.get("/api/v1/health")
async def health():
    return {"status": "ok"}


@app.get("/api/v1/scheduler/status", dependencies=_auth)
async def scheduler_status():
    return get_scheduler_status()


@app.post("/api/v1/scheduler/reload", dependencies=_auth)
async def scheduler_reload():
    await reload_all_jobs()
    return {"message": "Scheduler reloaded"}
