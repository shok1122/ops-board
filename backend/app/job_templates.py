"""
Auto-discovery loader for builtin job-template scripts.

Every script file under ``scripts/jobs/`` whose leading comment block
contains a ``# @name ...`` line is automatically registered as a job
template.  No changes to this file are needed when adding new scripts.

Metadata comment format (``# @key value``)
-------------------------------------------
``@name``            (required) Display name shown in the UI.
``@description``     Human-readable description.
``@category``        Category string (default ``"custom"``).
``@default_cron``    5-field cron expression (default ``"0 * * * *"``).
``@default_timeout`` Timeout in seconds (default ``60``).
``@tags``            Comma-separated tag list.
``@config_field``    Config-field descriptor (repeatable) – see below.
``@config_option``   Option descriptor for ``type=select`` fields (repeatable).

``@config_field`` format::

    # @config_field key=scheme label="プロトコル" type=select default=http
    # @config_option scheme http HTTP
    # @config_option scheme https HTTPS

``@config_option`` format::

    fieldkey  optionvalue  ["label with spaces" | label]

Supported languages
-------------------
``.sh``  → bash
``.py``  → python3
``.rb``  → ruby

The template ID is derived from the filename without its extension.
"""

from __future__ import annotations

import logging
from pathlib import Path

from app.script_meta import parse_meta, parse_config_fields

logger = logging.getLogger(__name__)

BUILTIN_SCRIPTS_DIR = Path(__file__).parent / "scripts" / "jobs"

_EXT_TO_LANGUAGE: dict[str, str] = {
    ".sh": "bash",
    ".py": "python",
    ".rb": "ruby",
}

_RUNNERS: dict[str, str] = {
    "bash":   "bash",
    "python": "python3",
    "ruby":   "ruby",
}


def _make_command(language: str, script: str) -> str:
    """Wrap a script body in a heredoc suitable for SSH execution."""
    runner = _RUNNERS[language]
    return f"{runner} <<'__OPSBOARD__'\n{script}\n__OPSBOARD__"


def _load_templates() -> list[dict]:
    templates: list[dict] = []
    for path in sorted(BUILTIN_SCRIPTS_DIR.iterdir()):
        if path.suffix not in _EXT_TO_LANGUAGE:
            continue
        language = _EXT_TO_LANGUAGE[path.suffix]
        template_id = path.stem

        try:
            script = path.read_text(encoding="utf-8")
        except OSError as e:
            logger.warning("Could not read job script %s: %s", path, e)
            continue

        meta = parse_meta(path)
        name = meta.get("name", "")
        if not name:
            logger.debug("Skipping %s: no @name metadata", path.name)
            continue

        config_fields = parse_config_fields(meta)

        raw_tags = meta.get("tags", "")
        tags = [t.strip() for t in raw_tags.split(",") if t.strip()] if raw_tags else []

        try:
            default_timeout = int(meta.get("default_timeout", "60"))
        except ValueError:
            default_timeout = 60

        templates.append(
            {
                "id":              template_id,
                "name":            name,
                "description":     meta.get("description", ""),
                "category":        meta.get("category", "custom"),
                "language":        language,
                "script":          script,
                "command":         _make_command(language, script),
                "default_cron":    meta.get("default_cron", "0 * * * *"),
                "default_timeout": default_timeout,
                "tags":            tags,
                "config_fields":   [
                    {
                        "key":     cf["key"],
                        "label":   cf["label"],
                        "type":    cf["type"],
                        "default": cf["default"],
                        **({"options": [
                            {"value": o["value"], "label": o["label"]}
                            for o in cf["options"]
                        ]} if cf["options"] else {}),
                    }
                    for cf in config_fields
                ],
            }
        )
        logger.debug("Registered job template: %s (%s)", template_id, language)

    return templates


# Loaded once at import time.
_TEMPLATES: list[dict] = _load_templates()


def get_all() -> list[dict]:
    return list(_TEMPLATES)


def get_by_id(template_id: str) -> dict | None:
    for t in _TEMPLATES:
        if t["id"] == template_id:
            return t
    return None
