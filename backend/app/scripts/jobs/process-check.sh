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

printf '{"title":"プロセス確認 (%s)","status":"%s","value":%d,"unit":"個","message":"%s"}\n' \
  "$PROCESS_NAME" "$st" "$count" "$msg"
