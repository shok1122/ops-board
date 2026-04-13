from fastapi import APIRouter, HTTPException
from app.job_templates import get_all, get_by_id

router = APIRouter(prefix="/job-templates", tags=["job-templates"])


@router.get("")
async def list_templates():
    return get_all()


@router.get("/{template_id}")
async def get_template(template_id: str):
    t = get_by_id(template_id)
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    return t
