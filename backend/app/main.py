from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.scheduler import scheduler, reload_all_jobs, get_scheduler_status
from app.routers import servers, jobs, executions, settings

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
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

app.include_router(servers.router, prefix="/api/v1")
app.include_router(jobs.router, prefix="/api/v1")
app.include_router(executions.router, prefix="/api/v1")
app.include_router(settings.router, prefix="/api/v1")


@app.get("/api/v1/health")
async def health():
    return {"status": "ok"}


@app.get("/api/v1/scheduler/status")
async def scheduler_status():
    return get_scheduler_status()


@app.post("/api/v1/scheduler/reload")
async def scheduler_reload():
    await reload_all_jobs()
    return {"message": "Scheduler reloaded"}
