# OpsBoard

リモートサーバーで実行する定期タスクの結果を可視化するWebアプリです。  
SSH経由でコマンドを実行・ログを収集し、実行結果をブラウザで確認できます。

## スクリーンショット

```
ダッシュボード → サーバー管理 → ジョブ管理 → 実行履歴 → ログビューア
```

## 機能

| 機能 | 詳細 |
|------|------|
| サーバー管理 | SSH接続先の登録・編集・削除。パスワード / 秘密鍵の両認証に対応。接続テストボタンあり |
| ジョブ管理 | cron式でスケジュールを設定。**コマンド実行**と**ログファイル取得**の2種類 |
| 手動実行 | ジョブをいつでもワンクリックで即時実行 |
| 実行履歴 | 全実行結果を一覧表示。ステータスでフィルタリング可能 |
| ログビューア | NDJSON形式は構造化テーブル表示。プレーンテキストはそのまま表示 |
| ダッシュボード | 成功率・失敗数などのサマリーと最近の実行一覧 |

## 起動方法

### 前提条件

- Docker / Docker Compose が使えること

### 手順

```bash
# 1. リポジトリをクローン
git clone <repository-url>
cd ops-board

# 2. 環境変数ファイルを作成
cp .env.example .env

# 3. .env の SECRET_KEY を必ず変更する（SSH資格情報の暗号化キー）
vi .env

# 4. ビルドして起動
docker compose up -d --build

# 5. ブラウザでアクセス
open http://localhost:3000
```

停止するには:

```bash
docker compose down
```

データ（DB・SSH鍵）を含めて完全に削除するには:

```bash
docker compose down -v
```

### ポート変更

デフォルトは `3000` ポートです。変更する場合は `.env` で設定します。

```env
PORT=8080
```

## 設定

`.env` ファイルで設定します。

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `SECRET_KEY` | `change-me-...` | SSH資格情報の暗号化キー。**本番では必ず変更すること** |
| `PORT` | `3000` | ホスト側に公開するポート番号 |

## ログ形式

ジョブの出力を構造化表示するには **NDJSON（1行1JSON）** 形式を使います。

### 必須フィールド

| フィールド | エイリアス | 説明 |
|-----------|-----------|------|
| `ts` | `timestamp`, `time` | ISO 8601形式のタイムスタンプ |
| `level` | `severity` | ログレベル: `DEBUG` / `INFO` / `WARN` / `ERROR` / `CRITICAL` |
| `msg` | `message`, `text` | ログメッセージ |

### オプションフィールド

| フィールド | 説明 |
|-----------|------|
| `task` | タスク名 |
| その他すべて | `meta` として表示 |

### 出力例

```jsonl
{"ts": "2026-04-08T10:00:00Z", "level": "INFO", "msg": "バックアップ開始"}
{"ts": "2026-04-08T10:00:05Z", "level": "INFO", "msg": "3ファイルをコピー完了", "task": "backup", "meta": {"files": 3, "size_mb": 12.4}}
{"ts": "2026-04-08T10:00:06Z", "level": "INFO", "msg": "バックアップ完了", "exit_code": 0}
```

### シェルスクリプトからの出力例

```bash
#!/bin/bash
LOG=/var/log/myapp/backup.log

log() {
  echo "{\"ts\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"level\": \"$1\", \"msg\": \"$2\"}" >> "$LOG"
}

log INFO "バックアップ開始"
rsync -a /data/ /backup/ && log INFO "完了" || log ERROR "失敗"
```

> **プレーンテキストへのフォールバック**  
> 出力の半分以上がJSONでない場合、自動的にプレーンテキストとして表示します。  
> 既存スクリプトをそのまま使っても出力は失われません。

## アーキテクチャ

```
ブラウザ
  │  HTTP :3000
  ▼
┌──────────────────┐
│ nginx (frontend) │  React + Vite + Tailwind CSS
│ 静的ファイル配信  │
│ /api/* → proxy   │
└────────┬─────────┘
         │ HTTP :8000
         ▼
┌──────────────────┐
│ uvicorn (backend)│  Python / FastAPI
│                  │  APScheduler (cron)
│                  │  asyncssh (SSH実行)
│                  │  aiosqlite (SQLite)
└────────┬─────────┘
         │ SSH
         ▼
   リモートサーバー群
```

### データ永続化

SQLiteデータベース (`/data/opsboard.db`) は Docker Volume `ops-board-data` に保存されます。  
バックアップはこのファイルを取得するだけで完了です。

```bash
docker run --rm -v ops-board_ops-board-data:/data -v $(pwd):/backup \
  alpine cp /data/opsboard.db /backup/opsboard_backup.db
```

### セキュリティに関する注意

- SSH パスワード・秘密鍵は Fernet 暗号化してDBに保存されます
- SSH接続はホスト鍵検証を省略しています（内部ネットワーク利用を前提）
- 本番環境では `SECRET_KEY` を十分強力な値に変更してください
- HTTPS化する場合はnginxの前段にリバースプロキシを置いてください

## API

バックエンドは REST API を提供します。

```
GET    /api/v1/servers              サーバー一覧
POST   /api/v1/servers              サーバー作成
PUT    /api/v1/servers/{id}         サーバー更新
DELETE /api/v1/servers/{id}         サーバー削除
POST   /api/v1/servers/{id}/test    接続テスト

GET    /api/v1/jobs                 ジョブ一覧
POST   /api/v1/jobs                 ジョブ作成
PUT    /api/v1/jobs/{id}            ジョブ更新
DELETE /api/v1/jobs/{id}            ジョブ削除
POST   /api/v1/jobs/{id}/trigger    手動実行
PATCH  /api/v1/jobs/{id}/enable     有効/無効切替

GET    /api/v1/executions           実行履歴一覧
GET    /api/v1/executions/{id}      実行詳細（ログ含む）

GET    /api/v1/scheduler/status     スケジューラー状態
POST   /api/v1/scheduler/reload     スケジューラー再読込
GET    /api/v1/health               ヘルスチェック
```

Swagger UIは `http://localhost:3000/api/docs` で確認できます（開発時のみ推奨）。

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | React 18 + TypeScript + Vite |
| スタイリング | Tailwind CSS |
| データフェッチ | TanStack Query (自動ポーリング) |
| バックエンド | Python 3.12 + FastAPI |
| スケジューラー | APScheduler 3 |
| SSH | asyncssh |
| データベース | SQLite (aiosqlite) |
| 暗号化 | cryptography (Fernet) |
| コンテナ | Docker + nginx |
