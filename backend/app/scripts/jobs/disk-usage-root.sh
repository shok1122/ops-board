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

printf '{"title":"ディスク使用率 (%s)","status":"%s","value":%d,"unit":"%%","message":"%sGB 使用 / %sGB 合計"}\n' \
  "$TARGET_PATH" "$st" "$pct" "$used" "$total"
