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
