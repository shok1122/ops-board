"""
Auto-discovery registry for builtin monitor metric scripts.

Every ``*.sh`` file found under ``scripts/monitors/`` is registered as a
builtin metric.  Metadata is read from ``# @key value`` comments at the top
of each file (see ``script_meta.py`` for the full format spec).

Supported metadata keys
-----------------------
@label         Display label shown in the UI (defaults to the script key).
@unit          Metric unit string, e.g. ``%``, ``MB``, ``GB`` (default "").
@configurable  ``true`` if the metric has user-configurable parameters.
@hidden        ``true`` to exclude from the ``/builtin-metrics/list`` API
               response.  The script is still available for ``collect_metric``
               (used for backward-compatibility aliases).
@config_field  Field descriptor line – see ``script_meta.parse_config_fields``.
@config_option Option descriptor line for ``type=select`` fields.

Registry structure
------------------
``BUILTIN_MONITOR_REGISTRY[key]`` is a dict::

    {
        "command":      "<raw command template string>",
        "label":        "Disk Usage",
        "unit":         "%",
        "configurable": True,
        "hidden":       False,
        "config_fields": [
            {
                "key": "path",
                "label": "Mount path",
                "type": "text",
                "default": "/",
                "options": [],
            },
        ],
    }

``BUILTIN_METRIC_COMMANDS[key]`` is a convenience alias that contains only
the raw command strings (mirrors the old hard-coded dict in ``ssh.py``).

"""

from __future__ import annotations

import logging
from pathlib import Path

from app.script_meta import parse_meta, parse_config_fields

logger = logging.getLogger(__name__)

_MONITOR_SCRIPTS_DIR = Path(__file__).parent / "scripts" / "monitors"


def _load_registry() -> dict[str, dict]:
    registry: dict[str, dict] = {}
    for path in sorted(_MONITOR_SCRIPTS_DIR.glob("*.sh")):
        key = path.stem
        try:
            command = path.read_text(encoding="utf-8").strip()
        except OSError as e:
            logger.warning("Could not read monitor script %s: %s", path, e)
            continue
        meta = parse_meta(path)
        config_fields = parse_config_fields(meta)
        registry[key] = {
            "command": command,
            "label": meta.get("label", key),
            "unit": meta.get("unit", ""),
            "configurable": meta.get("configurable", "false").lower() == "true",
            "hidden": meta.get("hidden", "false").lower() == "true",
            "config_fields": config_fields,
        }
        logger.debug("Registered builtin monitor: %s", key)

    return registry


# Loaded once at import time.
BUILTIN_MONITOR_REGISTRY: dict[str, dict] = _load_registry()

# Convenience alias: key → raw command template.
BUILTIN_METRIC_COMMANDS: dict[str, str] = {
    k: v["command"] for k, v in BUILTIN_MONITOR_REGISTRY.items()
}
