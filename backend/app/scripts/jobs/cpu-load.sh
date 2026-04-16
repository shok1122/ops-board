#!/bin/bash
# @name CPU負荷確認
# @description CPU ロードアベレージ（1分・5分・15分）を確認します
# @category system
# @default_cron */5 * * * *
# @default_timeout 10
# @tags cpu,system
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

printf '{"title":"CPU負荷","status":"%s","value":%s,"unit":"","message":"1分:%s  5分:%s  15分:%s  CPU数:%d","items":[{"label":"1分","value":"%s","unit":"","status":"%s"},{"label":"5分","value":"%s","unit":"","status":"ok"},{"label":"15分","value":"%s","unit":"","status":"ok"}]}\n' \
  "$st" "$load1" "$load1" "$load5" "$load15" "$ncpu" "$load1" "$st" "$load5" "$load15"
