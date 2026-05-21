from fastapi import APIRouter
from app.database import get_db
from app.models import AppSettings

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=AppSettings)
async def get_settings():
    async with get_db() as db:
        cur = await db.execute("SELECT key, value FROM app_settings")
        rows = await cur.fetchall()
    kv = {r["key"]: r["value"] for r in rows}
    return AppSettings(
        status_check_interval_minutes=int(kv.get("status_check_interval_minutes", "10")),
    )


@router.put("", response_model=AppSettings)
async def update_settings(body: AppSettings):
    async with get_db() as db:
        await db.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
            ("status_check_interval_minutes", str(body.status_check_interval_minutes)),
        )
        await db.commit()

    return body
