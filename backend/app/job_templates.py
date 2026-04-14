"""
System-defined job templates.

To add a new template, append a JobTemplate instance to TEMPLATES at the bottom
of this file.  No other changes are required.

Guidelines:
  - id: unique snake_case string
  - language: "bash" | "ruby" | "python"
  - script_file: filename under backend/app/scripts/builtin/ (without directory path)
  - The framework loads the script body from the file at runtime.
  - The framework wraps the script in a heredoc automatically before SSH execution.
  - Output JSON in the JobResultOutput format for rich display in the UI:
      {"title":"...", "status":"ok|warn|error", "value":42, "unit":"%",
       "message":"...", "items":[{"label":"...","value":"...","unit":"...","status":"..."}]}
  - If the script just prints plain text that's fine too (displays as raw output).
"""

from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

Language = Literal["bash", "ruby", "python"]

BUILTIN_SCRIPTS_DIR = Path(__file__).parent / "scripts" / "jobs"

_EXT: dict[Language, str] = {"bash": "sh", "python": "py", "ruby": "rb"}


def _load_script(template_id: str, language: Language) -> str:
    ext = _EXT[language]
    path = BUILTIN_SCRIPTS_DIR / f"{template_id}.{ext}"
    return path.read_text(encoding="utf-8")


@dataclass
class JobTemplateConfigOption:
    value: str
    label: str

    def to_dict(self) -> dict:
        return {"value": self.value, "label": self.label}


@dataclass
class JobTemplateConfigField:
    key: str
    label: str
    default: str
    type: str = "text"  # "text" | "select"
    options: list[JobTemplateConfigOption] = field(default_factory=list)

    def to_dict(self) -> dict:
        d: dict = {"key": self.key, "label": self.label, "default": self.default, "type": self.type}
        if self.options:
            d["options"] = [o.to_dict() for o in self.options]
        return d


@dataclass
class JobTemplate:
    id: str
    name: str
    description: str
    category: str
    language: Language
    default_cron: str = "0 * * * *"
    default_timeout: int = 60
    tags: list[str] = field(default_factory=list)
    config_fields: list[JobTemplateConfigField] = field(default_factory=list)

    @property
    def script(self) -> str:
        return _load_script(self.id, self.language)

    def to_dict(self) -> dict:
        script = self.script
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "language": self.language,
            "script": script,
            "command": _make_command(self.language, script),
            "default_cron": self.default_cron,
            "default_timeout": self.default_timeout,
            "tags": self.tags,
            "config_fields": [cf.to_dict() for cf in self.config_fields],
        }


def _make_command(language: Language, script: str) -> str:
    """Wrap a script in a heredoc suitable for SSH execution."""
    runners = {"bash": "bash", "ruby": "ruby", "python": "python3"}
    runner = runners[language]
    return f"{runner} <<'__OPSBOARD__'\n{script}\n__OPSBOARD__"


def get_all() -> list[dict]:
    return [t.to_dict() for t in TEMPLATES]


def get_by_id(template_id: str) -> dict | None:
    for t in TEMPLATES:
        if t.id == template_id:
            return t.to_dict()
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Templates
# ─────────────────────────────────────────────────────────────────────────────

TEMPLATES: list[JobTemplate] = [

    # ── System ────────────────────────────────────────────────────────────────

    JobTemplate(
        id="disk-usage-root",
        name="ディスク使用率チェック (/)",
        description="ルートパーティション (/) のディスク使用率を確認します",
        category="system",
        language="bash",
        default_cron="0 * * * *",
        default_timeout=15,
        tags=["disk", "system"],
    ),

    JobTemplate(
        id="memory-usage",
        name="メモリ使用率チェック",
        description="システムのメモリ（RAM）使用率を確認します",
        category="system",
        language="bash",
        default_cron="*/15 * * * *",
        default_timeout=10,
        tags=["memory", "system"],
    ),

    JobTemplate(
        id="cpu-load",
        name="CPU負荷確認",
        description="CPU ロードアベレージ（1分・5分・15分）を確認します",
        category="system",
        language="bash",
        default_cron="*/5 * * * *",
        default_timeout=10,
        tags=["cpu", "system"],
    ),

    # ── Network ───────────────────────────────────────────────────────────────

    JobTemplate(
        id="http-health-check",
        name="HTTP ヘルスチェック",
        description="対象サーバ（REMOTE_HOST）に HTTP リクエストを送り、ステータスコードを確認します",
        category="network",
        language="bash",
        default_cron="*/5 * * * *",
        default_timeout=30,
        tags=["http", "web", "health"],
        config_fields=[
            JobTemplateConfigField(
                key="scheme",
                label="プロトコル",
                default="http",
                type="select",
                options=[
                    JobTemplateConfigOption(value="http",  label="HTTP"),
                    JobTemplateConfigOption(value="https", label="HTTPS"),
                ],
            ),
            JobTemplateConfigField(
                key="path",
                label="パス",
                default="",
            ),
        ],
    ),

    # ── Process ───────────────────────────────────────────────────────────────

    JobTemplate(
        id="process-check",
        name="プロセス死活確認",
        description="指定したプロセス名が実行中かどうかを確認します",
        category="process",
        language="bash",
        default_cron="*/5 * * * *",
        default_timeout=10,
        tags=["process", "availability"],
    ),

    # ── Log ───────────────────────────────────────────────────────────────────

    JobTemplate(
        id="log-error-count",
        name="ログエラー件数チェック",
        description="指定ログファイルの直近 1000 行から ERROR/CRITICAL 行数をカウントします",
        category="log",
        language="bash",
        default_cron="0 * * * *",
        default_timeout=20,
        tags=["log", "error"],
    ),

    # ── Examples ──────────────────────────────────────────────────────────────

    JobTemplate(
        id="python-example",
        name="Python スクリプト例",
        description="Python スクリプトのサンプルです。カスタムスクリプト作成の出発点として使用してください",
        category="example",
        language="python",
        default_cron="0 9 * * *",
        default_timeout=30,
        tags=["example", "python"],
    ),

    JobTemplate(
        id="ruby-example",
        name="Ruby スクリプト例",
        description="Ruby スクリプトのサンプルです。カスタムスクリプト作成の出発点として使用してください",
        category="example",
        language="ruby",
        default_cron="0 9 * * *",
        default_timeout=30,
        tags=["example", "ruby"],
    ),

]
