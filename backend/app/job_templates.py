"""
System-defined job templates.

To add a new template, append a JobTemplate instance to TEMPLATES at the bottom
of this file.  No other changes are required.

Guidelines:
  - id: unique snake_case string
  - language: "bash" | "ruby" | "python"
  - script: the raw script body (do NOT wrap in heredoc here)
  - The framework wraps the script in a heredoc automatically before SSH execution.
  - Output JSON in the JobResultOutput format for rich display in the UI:
      {"title":"...", "status":"ok|warn|error", "value":42, "unit":"%",
       "message":"...", "items":[{"label":"...","value":"...","unit":"...","status":"..."}]}
  - If the script just prints plain text that's fine too (displays as raw output).
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal

Language = Literal["bash", "ruby", "python"]


@dataclass
class JobTemplate:
    id: str
    name: str
    description: str
    category: str
    language: Language
    script: str
    default_cron: str = "0 * * * *"
    default_timeout: int = 60
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "language": self.language,
            "script": self.script,
            "command": _make_command(self),
            "default_cron": self.default_cron,
            "default_timeout": self.default_timeout,
            "tags": self.tags,
        }


def _make_command(t: JobTemplate) -> str:
    """Wrap a script in a heredoc suitable for SSH execution."""
    runners = {"bash": "bash", "ruby": "ruby", "python": "python3"}
    runner = runners[t.language]
    return f"{runner} <<'__OPSBOARD__'\n{t.script}\n__OPSBOARD__"


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
        script="""\
#!/bin/bash
# ディスク使用率チェック (/)
# 確認対象のパスを変更するには下の PATH= を編集してください
TARGET_PATH="/"

pct=$(df "$TARGET_PATH" | awk 'NR==2{gsub(/%/,""); print $5}')
used=$(df -BG "$TARGET_PATH" | awk 'NR==2{gsub(/G/,""); print $3}')
total=$(df -BG "$TARGET_PATH" | awk 'NR==2{gsub(/G/,""); print $2}')

if   [ "$pct" -ge 90 ]; then st="error"
elif [ "$pct" -ge 80 ]; then st="warn"
else                          st="ok"
fi

printf '{"title":"ディスク使用率 (%s)","status":"%s","value":%d,"unit":"%%","message":"%sGB 使用 / %sGB 合計"}\\n' \
  "$TARGET_PATH" "$st" "$pct" "$used" "$total"
""",
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
        script="""\
#!/bin/bash
# メモリ使用率チェック
read total used free <<< $(free -m | awk '/^Mem:/{print $2, $3, $4}')
pct=$(awk "BEGIN{printf \"%d\", $used/$total*100}")

if   [ "$pct" -ge 90 ]; then st="error"
elif [ "$pct" -ge 80 ]; then st="warn"
else                          st="ok"
fi

printf '{"title":"メモリ使用率","status":"%s","value":%d,"unit":"%%","message":"%dMB 使用 / %dMB 合計"}\\n' \
  "$st" "$pct" "$used" "$total"
""",
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
        script="""\
#!/bin/bash
# CPU ロードアベレージ確認
read load1 load5 load15 _ < /proc/loadavg
ncpu=$(nproc 2>/dev/null || echo 1)

# 1分負荷がCPU数を超えたら warn、2倍超で error
warn_thr=$(awk "BEGIN{printf \"%.1f\", $ncpu * 1.0}")
crit_thr=$(awk "BEGIN{printf \"%.1f\", $ncpu * 2.0}")

st="ok"
awk -v l="$load1" -v w="$warn_thr" -v c="$crit_thr" 'BEGIN{
  if (l+0 >= c+0) { print "error"; exit }
  if (l+0 >= w+0) { print "warn";  exit }
  print "ok"
}' | read st 2>/dev/null || \
  st=$(awk -v l="$load1" -v w="$warn_thr" -v c="$crit_thr" \
    'BEGIN{ if(l>=c) print "error"; else if(l>=w) print "warn"; else print "ok" }')

printf '{"title":"CPU負荷","status":"%s","value":%s,"unit":"","message":"1分:%s  5分:%s  15分:%s  CPU数:%d","items":[{"label":"1分","value":"%s","unit":"","status":"%s"},{"label":"5分","value":"%s","unit":"","status":"ok"},{"label":"15分","value":"%s","unit":"","status":"ok"}]}\\n' \
  "$st" "$load1" "$load1" "$load5" "$load15" "$ncpu" "$load1" "$st" "$load5" "$load15"
""",
    ),

    # ── Network ───────────────────────────────────────────────────────────────

    JobTemplate(
        id="http-health-check",
        name="HTTP ヘルスチェック",
        description="指定 URL に HTTP リクエストを送り、ステータスコードを確認します",
        category="network",
        language="bash",
        default_cron="*/5 * * * *",
        default_timeout=30,
        tags=["http", "web", "health"],
        script="""\
#!/bin/bash
# HTTP ヘルスチェック
# 確認対象の URL を変更してください
URL="http://localhost:80/"
TIMEOUT=10

http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "$URL" 2>/dev/null)
exit_code=$?

if [ $exit_code -ne 0 ]; then
  printf '{"title":"HTTP ヘルスチェック","status":"error","value":0,"unit":"","message":"接続失敗 (curl exit=%d): %s"}\\n' "$exit_code" "$URL"
  exit 0
fi

if   [ "$http_code" -lt 400 ]; then st="ok"
elif [ "$http_code" -lt 500 ]; then st="warn"
else                                 st="error"
fi

printf '{"title":"HTTP ヘルスチェック","status":"%s","value":%d,"unit":"","message":"HTTP %d: %s"}\\n' \
  "$st" "$http_code" "$http_code" "$URL"
""",
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
        script="""\
#!/bin/bash
# プロセス死活確認
# 確認対象のプロセス名を変更してください（部分一致）
PROCESS_NAME="nginx"

count=$(pgrep -c "$PROCESS_NAME" 2>/dev/null || echo 0)

if [ "$count" -gt 0 ]; then
  st="ok"
  msg="${count}個のプロセスが実行中"
else
  st="error"
  msg="プロセスが見つかりません"
fi

printf '{"title":"プロセス確認 (%s)","status":"%s","value":%d,"unit":"個","message":"%s"}\\n' \
  "$PROCESS_NAME" "$st" "$count" "$msg"
""",
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
        script="""\
#!/bin/bash
# ログエラー件数チェック
# 確認対象のログファイルパスを変更してください
LOG_FILE="/var/log/syslog"
# エラーとみなすパターン（grep の拡張正規表現）
ERROR_PATTERN="ERROR|CRITICAL|FATAL"
# 末尾から読む行数
TAIL_LINES=1000

if [ ! -f "$LOG_FILE" ]; then
  printf '{"title":"ログエラー件数","status":"error","value":0,"unit":"件","message":"ファイルが見つかりません: %s"}\\n' "$LOG_FILE"
  exit 0
fi

count=$(tail -n "$TAIL_LINES" "$LOG_FILE" | grep -cE "$ERROR_PATTERN" 2>/dev/null || echo 0)

if   [ "$count" -ge 100 ]; then st="error"
elif [ "$count" -ge 10  ]; then st="warn"
else                             st="ok"
fi

printf '{"title":"ログエラー件数","status":"%s","value":%d,"unit":"件","message":"直近%d行中 %d件のエラー: %s"}\\n' \
  "$st" "$count" "$TAIL_LINES" "$count" "$LOG_FILE"
""",
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
        script="""\
#!/usr/bin/env python3
# OpsBoard Python ジョブサンプル
# このスクリプトを編集してカスタムチェックを作成してください
# 出力は JSON 形式にすると結果がリッチ表示されます

import json
import subprocess

# ── ここに処理を記述 ──────────────────────────────────
# 例: アップタイムを取得
with open("/proc/uptime") as f:
    uptime_sec = int(float(f.read().split()[0]))

days    = uptime_sec // 86400
hours   = (uptime_sec % 86400) // 3600
minutes = (uptime_sec % 3600) // 60
# ────────────────────────────────────────────────────

result = {
    "title": "システム稼働時間",
    "status": "ok",
    "value": uptime_sec // 3600,  # 稼働時間（時間）
    "unit": "時間",
    "message": f"{days}日 {hours}時間 {minutes}分",
}
print(json.dumps(result, ensure_ascii=False))
""",
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
        script="""\
#!/usr/bin/env ruby
# OpsBoard Ruby ジョブサンプル
# このスクリプトを編集してカスタムチェックを作成してください
# 出力は JSON 形式にすると結果がリッチ表示されます

require 'json'

# ── ここに処理を記述 ──────────────────────────────────
# 例: ロードアベレージを取得
loadavg = File.read('/proc/loadavg').split.first(3).map(&:to_f)
load1, load5, load15 = loadavg

status = if    load1 >= 4.0 then 'error'
           elsif load1 >= 2.0 then 'warn'
           else                    'ok'
           end
# ────────────────────────────────────────────────────

result = {
  title:   'ロードアベレージ',
  status:  status,
  value:   load1,
  unit:    '',
  message: "1分: #{load1}  5分: #{load5}  15分: #{load15}",
}
puts result.to_json
""",
    ),

]
