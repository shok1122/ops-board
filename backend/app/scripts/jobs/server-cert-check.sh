#!/bin/bash
# @name サーバ証明書の有効期限のチェック
# @description 対象サーバ（SERVER_HOST）のサーバ証明書の残りの期限を計算します
# @run_locally
# @category network
# @default_cron 0 0 * * *
# @default_timeout 30
# 対象サーバは SERVER_HOST 環境変数から自動取得します（未設定時は localhost）
set -e

ssl_output=$(echo | openssl s_client -connect $SERVER_HOST:443 2>/dev/null | openssl x509 -noout -enddate)
end_date=$(echo "$ssl_output" | grep notAfter  | cut -d= -f2-)

end_exp=$(date -d "$end_date" +%s)
now=$(date +%s)

diff=$(( end_exp - now ))
days=$(awk "BEGIN { printf \"%.2f\", $diff / 86400 }")

printf '{"title":"サーバ証明書の残日数","status":"ok","value":%f,"unit":"days"}\n' "$days"
