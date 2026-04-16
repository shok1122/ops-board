#!/bin/bash
# @name HTTP ヘルスチェック
# @description 対象サーバ（REMOTE_HOST）に HTTP リクエストを送り、ステータスコードを確認します
# @category network
# @default_cron */5 * * * *
# @default_timeout 30
# @tags http,web,health
# @config_field key=scheme label="プロトコル" type=select default=http
# @config_option scheme http HTTP
# @config_option scheme https HTTPS
# @config_field key=path label="パス" type=text default=
# 対象サーバは REMOTE_HOST 環境変数から自動取得します（未設定時は localhost）
TARGET_HOST="${REMOTE_HOST:-localhost}"
URL="{scheme}://$TARGET_HOST/{path}"
TIMEOUT=10

http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "$URL" 2>/dev/null)
exit_code=$?

if [ $exit_code -ne 0 ]; then
  printf '{"title":"HTTP ヘルスチェック","status":"error","value":0,"unit":"","message":"接続失敗 (curl exit=%d): %s"}\n' "$exit_code" "$URL"
  exit 0
fi

if   [ "$http_code" -lt 400 ]; then st="ok"
elif [ "$http_code" -lt 500 ]; then st="warn"
else                                 st="error"
fi

printf '{"title":"HTTP ヘルスチェック","status":"%s","value":%d,"unit":"","message":"HTTP %d: %s"}\n' \
  "$st" "$http_code" "$http_code" "$URL"
