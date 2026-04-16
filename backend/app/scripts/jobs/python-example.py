#!/usr/bin/env python3
# @name Python スクリプト例
# @description Python スクリプトのサンプルです。カスタムスクリプト作成の出発点として使用してください
# @category example
# @default_cron 0 9 * * *
# @default_timeout 30
# @tags example,python

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
