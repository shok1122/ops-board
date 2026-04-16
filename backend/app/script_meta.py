"""
Shared metadata parser for OpsBoard builtin scripts.

Scripts declare metadata in leading ``# @key value`` comment lines::

    #!/bin/bash
    # @name  Display Name
    # @unit  %
    # @configurable true
    # @config_field key=path label="Mount path" default=/
    # @config_field key=interval label="Interval" type=select default=1m
    # @config_option interval 1m "1分" awk_field=$1
    # @config_option interval 5m "5分" awk_field=$2

Rules
-----
- Lines are scanned from the top; scanning stops at the first line that is
  neither blank nor a comment (``#``).
- Shebang lines (``#!``) are skipped silently.
- A ``@key value`` line whose key is new sets a string value.
- Subsequent lines with the **same** key convert the value to a list and
  append.  ``@config_field`` and ``@config_option`` always produce lists.

``@config_option`` format::

    fieldkey  optionvalue  ["label with spaces" | label]  [extra=val ...]

Extra ``key=val`` pairs after the label are injected into the substitution
config at collection time when that option is selected.
"""

from __future__ import annotations

import re
from pathlib import Path

_KV_RE = re.compile(r'(\w+)=(?:"([^"]*)"|([\S]*))')


def _parse_kv(s: str) -> dict[str, str]:
    """Parse ``key=value`` (or ``key="quoted value"``) pairs from a string."""
    result: dict[str, str] = {}
    for m in _KV_RE.finditer(s):
        result[m.group(1)] = m.group(2) if m.group(2) is not None else m.group(3)
    return result


def parse_meta(path: Path) -> dict[str, str | list[str]]:
    """
    Return the ``@key value`` metadata from the leading comment block of a
    script file.  Repeated keys accumulate into lists.
    """
    result: dict[str, str | list[str]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#!"):
            continue
        if not s.startswith("#"):
            break
        m = re.match(r"^#\s*@(\w+)(?:\s+(.*))?$", s)
        if not m:
            continue
        key = m.group(1)
        value = (m.group(2) or "").strip()
        if key in result:
            existing = result[key]
            if isinstance(existing, list):
                existing.append(value)
            else:
                result[key] = [existing, value]
        else:
            result[key] = value
    return result


def parse_config_fields(meta: dict) -> list[dict]:
    """
    Convert ``@config_field`` / ``@config_option`` directives from a parsed
    metadata dict into a list of field-descriptor dicts::

        {
            "key":     "interval",
            "label":   "計測間隔",
            "type":    "select",      # "text" | "select"
            "default": "1m",
            "options": [              # only for type=select
                {"value": "1m", "label": "1分", "awk_field": "$1"},
                ...
            ],
        }

    Extra ``key=val`` pairs on ``@config_option`` lines (beyond value/label)
    are preserved in the option dict so that ``collect_metric`` can inject
    them into the substitution config when that option is selected.
    """
    fields: dict[str, dict] = {}
    order: list[str] = []

    cf_list = meta.get("config_field", [])
    if isinstance(cf_list, str):
        cf_list = [cf_list]
    for directive in cf_list:
        params = _parse_kv(directive)
        key = params.get("key", "")
        if not key:
            continue
        fields[key] = {
            "key": key,
            "label": params.get("label", key),
            "type": params.get("type", "text"),
            "default": params.get("default", ""),
            "options": [],
        }
        order.append(key)

    co_list = meta.get("config_option", [])
    if isinstance(co_list, str):
        co_list = [co_list]
    for directive in co_list:
        # fieldkey  optionvalue  ["label"]  [extra=val ...]
        parts = directive.split(None, 2)
        if len(parts) < 2:
            continue
        fieldkey, optval = parts[0], parts[1]
        rest = parts[2].strip() if len(parts) > 2 else ""

        if rest.startswith('"'):
            end = rest.find('"', 1)
            label = rest[1:end] if end >= 1 else rest[1:]
            extras_str = rest[end + 1 :].strip() if end >= 1 else ""
        else:
            kv_start = re.search(r"\s+\w+=", rest)
            if kv_start:
                label = rest[: kv_start.start()].strip()
                extras_str = rest[kv_start.start() :].strip()
            else:
                label = rest
                extras_str = ""

        extra_params = _parse_kv(extras_str) if extras_str else {}
        if fieldkey in fields:
            fields[fieldkey]["options"].append(
                {"value": optval, "label": label or optval, **extra_params}
            )

    return [fields[k] for k in order]
