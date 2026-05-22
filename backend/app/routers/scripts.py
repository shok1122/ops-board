import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException

from app.config import settings
from app.models import ScriptCreate, ScriptUpdate, ScriptOut

router = APIRouter(prefix="/scripts", tags=["scripts"])
logger = logging.getLogger(__name__)


def _scripts_dir() -> Path:
    d = Path(settings.scripts_dir) / "user"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _sanitize_name(name: str) -> str:
    s = re.sub(r'[^\w\-]', '_', name.strip())
    return s.strip('_') or 'script'


def _parse_description(content: str) -> Optional[str]:
    m = re.search(r'^#\s*@description\s+(.+)$', content, re.MULTILINE)
    return m.group(1).strip() if m else None


def _stat_to_iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _file_to_out(path: Path) -> ScriptOut:
    content = path.read_text(encoding="utf-8")
    stat = path.stat()
    return ScriptOut(
        id=path.stem,
        name=path.stem,
        description=_parse_description(content),
        language="bash",
        content=content,
        created_at=_stat_to_iso(stat.st_ctime),
        updated_at=_stat_to_iso(stat.st_mtime),
    )


@router.get("", response_model=list[ScriptOut])
async def list_scripts():
    return [_file_to_out(p) for p in sorted(_scripts_dir().glob("*.sh"), key=lambda p: p.name)]


@router.post("", response_model=ScriptOut, status_code=201)
async def create_script(body: ScriptCreate):
    filename = _sanitize_name(body.name)
    path = _scripts_dir() / f"{filename}.sh"
    if path.exists():
        raise HTTPException(status_code=409, detail="Script with this name already exists")
    path.write_text(body.content, encoding="utf-8")
    return _file_to_out(path)


@router.get("/{script_id}", response_model=ScriptOut)
async def get_script(script_id: str):
    path = _scripts_dir() / f"{script_id}.sh"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Script not found")
    return _file_to_out(path)


@router.put("/{script_id}", response_model=ScriptOut)
async def update_script(script_id: str, body: ScriptUpdate):
    path = _scripts_dir() / f"{script_id}.sh"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Script not found")

    if body.content is not None:
        path.write_text(body.content, encoding="utf-8")

    if body.name is not None:
        new_filename = _sanitize_name(body.name)
        new_path = _scripts_dir() / f"{new_filename}.sh"
        if new_path != path:
            if new_path.exists():
                raise HTTPException(status_code=409, detail="Script with this name already exists")
            path.rename(new_path)
            path = new_path

    return _file_to_out(path)


@router.delete("/{script_id}", status_code=204)
async def delete_script(script_id: str):
    path = _scripts_dir() / f"{script_id}.sh"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Script not found")
    path.unlink()
