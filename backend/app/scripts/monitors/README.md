# Monitors スクリプト

Monitorsスクリプトは、サーバの特定メトリクスを**数値1つ**だけ標準出力に書き出す軽量なスクリプトです。
ops-boardがこの値を定期収集し、時系列グラフとして可視化します。

## 出力フォーマット

標準出力に**数値のみ**を書き出してください。テキストや複数行を出力すると最後の行が数値として解釈されます。

```
80.5
```

小数点を含む値も使用できます。単位は後述のメタデータで指定します。

## メタデータ（コメントヘッダ）

スクリプト冒頭のコメントにメタデータを記述します。

```bash
# @label       グラフ上の表示ラベル
# @unit        単位（% / GB / MB など。不要なら空）
# @configurable true   # 設定フィールドがある場合は true
```

### `@config_field` / `@config_option` — 設定フィールド

ユーザが値を選択・入力できるフィールドを定義できます。
スクリプト内では `{key}` の形式でプレースホルダとして使用します。

```bash
# @config_field key=path label="Mount path" default=/
df {path} | awk 'NR==2{print $5}' | tr -d '%'
```

セレクト形式の場合:

```bash
# @config_field key=interval label="計測間隔" type=select default=1m
# @config_option interval 1m  1分  awk_field=$1
# @config_option interval 5m  5分  awk_field=$2
# @config_option interval 15m 15分 awk_field=$3
awk '{print {awk_field}}' /proc/loadavg
```

`@config_option` の形式: `@config_option <key> <value> <ラベル> [追加変数=値 ...]`

### `@execution_type local` — ローカル実行フラグ

サーバではなくops-board自身のホストで実行するモニターには `@execution_type local` を付けます。

```bash
# @execution_type local
```

### 環境変数

実行時に以下の環境変数が自動的に設定されます。

| 変数 | 説明 |
|------|------|
| `SERVER_HOST` | 監視対象サーバのホスト名またはIPアドレス |

## 新しいスクリプトの追加手順

1. このディレクトリにスクリプトファイルを作成します（例: `my_metric.sh`）。
   - ファイル名はスネークケース推奨（例: `disk_used_pct.sh`）。
2. コメントヘッダにメタデータを記述します（`@label` と `@unit` は必須）。
3. 最終行に数値のみ出力するよう処理を実装します。
4. シェルスクリプトの場合は実行権限を付与します。
   ```bash
   chmod +x my_metric.sh
   ```
5. ops-boardのモニター管理画面から新しいモニターを追加し、作成したスクリプトを選択します。

## サンプルテンプレート

### シンプルな1行スクリプト（Bash）

```bash
# @label My Metric
# @unit %
コマンド | 数値を取り出す加工
```

### 設定フィールドあり（Bash）

```bash
#!/bin/bash
# @label My Metric
# @unit GB
# @configurable true
# @config_field key=path label="対象パス" type=text default=/

df -BG {path} | awk 'NR==2{gsub(/G/,""); print $3}'
```

### SSL証明書など外部通信が必要な場合

```bash
#!/bin/bash
# @label My Remote Metric
# @unit days
# @execution_type local

# SERVER_HOST 環境変数で接続先ホストが渡される
result=$(curl -s "https://$SERVER_HOST/metrics" | awk '{print $1}')
echo "$result"
```

## 既存スクリプト一覧

| ファイル | ラベル | 単位 | 説明 |
|---------|--------|------|------|
| `cpu_load.sh` | CPU Load | – | CPUロードアベレージ（間隔を設定で選択） |
| `cpu_load_1m.sh` | CPU Load (1m) | – | CPUロードアベレージ（1分） |
| `cpu_load_5m.sh` | CPU Load (5m) | – | CPUロードアベレージ（5分） |
| `cpu_load_15m.sh` | CPU Load (15m) | – | CPUロードアベレージ（15分） |
| `mem_used_pct.sh` | Memory Used (%) | % | メモリ使用率 |
| `mem_used_gb.sh` | Memory Used (GB) | GB | メモリ使用量 |
| `disk_used_pct.sh` | Disk Usage | % | ディスク使用率（パスを設定で指定） |
| `disk_used_gb.sh` | Disk Used (GB) | GB | ディスク使用量 |
| `process_count.sh` | Process Count | – | 実行中プロセス数 |
| `ssl_cert_expiry_days.sh` | SSL Cert Expiry | % | SSL証明書の有効期限（進捗率） |

## JobsスクリプトとMonitorsスクリプトの違い

| | Jobs | Monitors |
|-|------|---------|
| 出力形式 | JSONオブジェクト（status・message含む） | 数値1つのみ |
| 主な用途 | アラート・死活確認・複合チェック | メトリクス収集・グラフ表示 |
| ステータス判定 | スクリプト内で判定（ok/warn/error） | ops-boardのしきい値設定で判定 |
| 詳細メッセージ | 記述できる | 記述しない |
