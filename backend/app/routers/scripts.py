import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.database import get_db, new_id, now_iso
from app.models import ScriptCreate, ScriptUpdate, ScriptOut

router = APIRouter(prefix="/scripts", tags=["scripts"])


def _row_to_out(row) -> ScriptOut:
    tags = json.loads(row["tags"]) if row["tags"] else []
    return ScriptOut(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        language=row["language"],
        content=row["content"],
        tags=tags,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("", response_model=list[ScriptOut])
async def list_scripts(language: Optional[str] = Query(default=None)):
    async with get_db() as db:
        if language:
            cur = await db.execute(
                "SELECT * FROM scripts WHERE language = ? ORDER BY name",
                (language,),
            )
        else:
            cur = await db.execute("SELECT * FROM scripts ORDER BY name")
        rows = await cur.fetchall()
    return [_row_to_out(r) for r in rows]


@router.post("", response_model=ScriptOut, status_code=201)
async def create_script(body: ScriptCreate):
    sid = new_id()
    now = now_iso()
    tags_json = json.dumps(body.tags or [])

    async with get_db() as db:
        await db.execute(
            "INSERT INTO scripts (id, name, description, language, content, tags, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (sid, body.name, body.description, body.language, body.content, tags_json, now, now),
        )
        await db.commit()
        cur = await db.execute("SELECT * FROM scripts WHERE id = ?", (sid,))
        row = await cur.fetchone()

    return _row_to_out(row)


@router.get("/{script_id}", response_model=ScriptOut)
async def get_script(script_id: str):
    async with get_db() as db:
        cur = await db.execute("SELECT * FROM scripts WHERE id = ?", (script_id,))
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Script not found")
    return _row_to_out(row)


@router.put("/{script_id}", response_model=ScriptOut)
async def update_script(script_id: str, body: ScriptUpdate):
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM scripts WHERE id = ?", (script_id,))
        existing = await cur.fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Script not found")

    fields: dict = {}
    if body.name is not None:
        fields["name"] = body.name
    if body.description is not None:
        fields["description"] = body.description
    if body.language is not None:
        fields["language"] = body.language
    if body.content is not None:
        fields["content"] = body.content
    if body.tags is not None:
        fields["tags"] = json.dumps(body.tags)

    if not fields:
        raise HTTPException(status_code=422, detail="No fields to update")

    now = now_iso()
    fields["updated_at"] = now
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [script_id]

    async with get_db() as db:
        await db.execute(f"UPDATE scripts SET {set_clause} WHERE id = ?", values)
        await db.commit()
        cur = await db.execute("SELECT * FROM scripts WHERE id = ?", (script_id,))
        row = await cur.fetchone()

    return _row_to_out(row)


@router.delete("/{script_id}", status_code=204)
async def delete_script(script_id: str):
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM scripts WHERE id = ?", (script_id,))
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Script not found")

    async with get_db() as db:
        await db.execute("DELETE FROM scripts WHERE id = ?", (script_id,))
        await db.commit()
