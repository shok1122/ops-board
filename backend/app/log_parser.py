import json
from typing import Any


def parse_log_output(output: str) -> list[dict[str, Any]]:
    """Parse log output as NDJSON with plain-text fallback.

    Expected NDJSON format per line:
      {"ts": "2026-01-01T00:00:00Z", "level": "INFO", "msg": "...", ...}

    Aliases accepted: timestamp/ts, message/msg, level
    """
    if not output or not output.strip():
        return []

    lines = [line for line in output.splitlines() if line.strip()]
    entries: list[dict[str, Any]] = []
    json_count = 0

    for line in lines:
        try:
            obj = json.loads(line)
            if isinstance(obj, dict):
                entry = _normalize_entry(obj)
                entries.append(entry)
                json_count += 1
                continue
        except (json.JSONDecodeError, ValueError):
            pass
        entries.append({"level": "RAW", "msg": line, "raw": True})

    # If fewer than half lines are JSON, treat as plain text
    if json_count < len(lines) / 2:
        return [{"level": "RAW", "msg": line, "raw": True} for line in lines]

    return entries


def _normalize_entry(obj: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}

    result["ts"] = obj.get("ts") or obj.get("timestamp") or obj.get("time") or ""
    result["level"] = (obj.get("level") or obj.get("severity") or "INFO").upper()
    result["msg"] = obj.get("msg") or obj.get("message") or obj.get("text") or ""
    result["task"] = obj.get("task") or obj.get("name") or ""

    # Pass through all other fields as meta
    skip = {"ts", "timestamp", "time", "level", "severity", "msg", "message", "text", "task", "name"}
    meta = {k: v for k, v in obj.items() if k not in skip}
    if meta:
        result["meta"] = meta

    return result
