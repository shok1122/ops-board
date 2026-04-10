import json
from fastapi import APIRouter, HTTPException, Query
from app.database import get_db
from app.models import ExecutionOut, ExecutionSummary, PagedResponse

router = APIRouter(prefix="/executions", tags=["executions"])


def _row_to_summary(row) -> ExecutionSummary:
    return ExecutionSummary(
        id=row["id"],
        job_id=row["job_id"],
        job_name=row["job_name"] if "job_name" in row.keys() else None,
        triggered_by=row["triggered_by"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        status=row["status"],
        exit_code=row["exit_code"],
        created_at=row["created_at"],
    )


def _row_to_out(row) -> ExecutionOut:
    parsed = None
    if row["parsed_result"]:
        try:
            parsed = json.loads(row["parsed_result"])
        except Exception:
            pass
    return ExecutionOut(
        id=row["id"],
        job_id=row["job_id"],
        job_name=row["job_name"] if "job_name" in row.keys() else None,
        triggered_by=row["triggered_by"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        status=row["status"],
        exit_code=row["exit_code"],
        stdout=row["stdout"],
        stderr=row["stderr"],
        parsed_result=parsed,
        created_at=row["created_at"],
    )


@router.get("", response_model=PagedResponse)
async def list_executions(
    job_id: str = Query(default=None),
    status: str = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    conditions = []
    params: list = []
    if job_id:
        conditions.append("e.job_id = ?")
        params.append(job_id)
    if status:
        conditions.append("e.status = ?")
        params.append(status)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    async with get_db() as db:
        cur = await db.execute(
            f"SELECT COUNT(*) FROM executions e {where}", params
        )
        total = (await cur.fetchone())[0]

        cur = await db.execute(
            f"SELECT e.*, j.name AS job_name FROM executions e "
            f"LEFT JOIN jobs j ON e.job_id = j.id "
            f"{where} ORDER BY e.started_at DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        )
        rows = await cur.fetchall()

    return PagedResponse(items=[_row_to_summary(r) for r in rows], total=total)


@router.get("/{execution_id}", response_model=ExecutionOut)
async def get_execution(execution_id: str):
    async with get_db() as db:
        cur = await db.execute(
            "SELECT e.*, j.name AS job_name FROM executions e "
            "LEFT JOIN jobs j ON e.job_id = j.id WHERE e.id = ?",
            (execution_id,),
        )
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Execution not found")
    return _row_to_out(row)


@router.delete("/{execution_id}", status_code=204)
async def delete_execution(execution_id: str):
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM executions WHERE id = ?", (execution_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Execution not found")
        await db.execute("DELETE FROM executions WHERE id = ?", (execution_id,))
        await db.commit()
