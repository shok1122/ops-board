# Jobs スクリプト

Jobsスクリプトは、サーバ上で定期実行され、システムの状態をチェックするスクリプトです。
実行結果はJSON形式で標準出力に書き出し、ops-boardがその結果を収集・表示します。

## 出力フォーマット

スクリプトは最終行に以下のJSON構造を出力してください。

```json
{
  "title":   "チェック名",
  "status":  "ok",
  "value":   80,
  "unit":    "%",
  "message": "詳細メッセージ"
}
```

| フィールド | 必須 | 説明 |
|-----------|------|------|
| `title`   | 必須 | ダッシュボードに表示されるチェック名 |
| `status`  | 必須 | `ok` / `warn` / `error` のいずれか |
| `value`   | 必須 | 数値（グラフ等に使用） |
| `unit`    | 必須 | 単位文字列（不要なら空文字 `""`） |
| `message` | 任意 | 詳細情報（省略可） |

追加でカード内に詳細行を表示したい場合は `items` 配列を付けられます。

```json
{
  "title": "CPU負荷",
  "status": "ok",
  "value": 0.5,
  "unit": "",
  "message": "1分:0.5  5分:0.3  15分:0.2",
  "items": [
    {"label": "1分",  "value": "0.5", "unit": "", "status": "ok"},
    {"label": "5分",  "value": "0.3", "unit": "", "status": "ok"},
    {"label": "15分", "value": "0.2", "unit": "", "status": "ok"}
  ]
}
```

## メタデータ（コメントヘッダ）

スクリプト冒頭のコメントにメタデータを記述します。ops-boardはこれを読み取り、ジョブ登録画面でのデフォルト値として使用します。

```bash
#!/bin/bash
# @name         表示名（日本語可）
# @description  ジョブの説明文
# @category     カテゴリ（system / network / process / log / example など）
# @default_cron */5 * * * *   # デフォルトのcron式
# @default_timeout 30         # デフォルトのタイムアウト秒数
```

### `@run_locally` — ローカル実行フラグ

サーバではなくops-board自身のホストで実行するジョブには `@run_locally` を付けます。
外部URLへのHTTPチェックなど、監視対象サーバではなく管理ホスト側で実行すべきチェックで使用します。

```bash
# @run_locally
```

### `@config_field` / `@config_option` — 設定フィールド

ジョブ登録画面でユーザが値を入力できるフィールドを定義できます。
スクリプト内では `{key}` の形式でプレースホルダとして使用します。

```bash
# @config_field key=scheme label="プロトコル" type=select default=http
# @config_option scheme http  HTTP
# @config_option scheme https HTTPS
# @config_field key=path label="パス" type=text default=
```

| type     | 説明 |
|----------|------|
| `text`   | テキスト入力 |
| `select` | ドロップダウン（`@config_option` と組み合わせる） |

プレースホルダの使用例:

```bash
URL="{scheme}://$SERVER_HOST/{path}"
```

## 対応言語

シバン行で指定した任意のインタプリタが使用できます。

| シバン行 | 言語 |
|---------|------|
| `#!/bin/bash` | Bash |
| `#!/usr/bin/env python3` | Python 3 |
| `#!/usr/bin/env ruby` | Ruby |

## 新しいスクリプトの追加手順

1. このディレクトリにスクリプトファイルを作成します。ファイル名に制限はありませんが、内容が分かる名前にしてください（例: `my-check.sh`）。
2. コメントヘッダにメタデータを記述します。
3. 処理を実装し、最後にJSONを `printf` または `print` で標準出力に書き出します。
4. スクリプトに実行権限を付与します（Bashの場合）。
   ```bash
   chmod +x my-check.sh
   ```
5. ops-boardのジョブ管理画面から新しいジョブを追加し、作成したスクリプトを選択します。

## サンプルテンプレート

### Bash

```bash
#!/bin/bash
# @name チェック名
# @description このチェックの説明
# @category system
# @default_cron */5 * * * *
# @default_timeout 30

# ── ここに処理を記述 ──────────────────────────────────

value=0
status="ok"
message="正常"

# ────────────────────────────────────────────────────

printf '{"title":"チェック名","status":"%s","value":%d,"unit":"","message":"%s"}\n' \
  "$status" "$value" "$message"
```

### Python

```python
#!/usr/bin/env python3
# @name チェック名
# @description このチェックの説明
# @category system
# @default_cron */5 * * * *
# @default_timeout 30

import json

# ── ここに処理を記述 ──────────────────────────────────

value = 0
status = "ok"
message = "正常"

# ────────────────────────────────────────────────────

print(json.dumps({
    "title":   "チェック名",
    "status":  status,
    "value":   value,
    "unit":    "",
    "message": message,
}, ensure_ascii=False))
```

## 既存スクリプト一覧

| ファイル | 説明 |
|---------|------|
| `cpu-load.sh` | CPU ロードアベレージ（1分・5分・15分）の確認 |
| `disk-usage-root.sh` | ルートパーティション (/) のディスク使用率確認 |
| `memory-usage.sh` | メモリ（RAM）使用率の確認 |
| `process-check.sh` | 指定プロセスの死活確認 |
| `log-error-count.sh` | ログファイルのエラー件数カウント |
| `http-health-check.sh` | HTTPヘルスチェック（ローカル実行） |
| `python-example.py` | Python スクリプトのサンプル |
| `ruby-example.rb` | Ruby スクリプトのサンプル |
