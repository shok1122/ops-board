#!/bin/bash
# メモリ使用率チェック
read total used free <<< $(free -m | awk '/^Mem:/{print $2, $3, $4}')
pct=$(awk "BEGIN{printf \"%d\", $used/$total*100}")

if   [ "$pct" -ge 90 ]; then st="error"
elif [ "$pct" -ge 80 ]; then st="warn"
else                          st="ok"
fi

printf '{"title":"メモリ使用率","status":"%s","value":%d,"unit":"%%","message":"%dMB 使用 / %dMB 合計"}\n' \
  "$st" "$pct" "$used" "$total"
