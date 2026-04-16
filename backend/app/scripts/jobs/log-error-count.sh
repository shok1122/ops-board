#!/bin/bash
# @name ログエラー件数チェック
# @description 指定ログファイルの直近 1000 行から ERROR/CRITICAL 行数をカウントします
# @category log
# @default_cron 0 * * * *
# @default_timeout 20
# @tags log,error
LOG_FILE="/var/log/syslog"
# エラーとみなすパターン（grep の拡張正規表現）
ERROR_PATTERN="ERROR|CRITICAL|FATAL"
# 末尾から読む行数
TAIL_LINES=1000

if [ ! -f "$LOG_FILE" ]; then
  printf '{"title":"ログエラー件数","status":"error","value":0,"unit":"件","message":"ファイルが見つかりません: %s"}\n' "$LOG_FILE"
  exit 0
fi

count=$(tail -n "$TAIL_LINES" "$LOG_FILE" | grep -cE "$ERROR_PATTERN" 2>/dev/null || echo 0)

if   [ "$count" -ge 100 ]; then st="error"
elif [ "$count" -ge 10  ]; then st="warn"
else                             st="ok"
fi

printf '{"title":"ログエラー件数","status":"%s","value":%d,"unit":"件","message":"直近%d行中 %d件のエラー: %s"}\n' \
  "$st" "$count" "$TAIL_LINES" "$count" "$LOG_FILE"
