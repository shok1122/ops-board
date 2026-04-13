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
| パスワード認証 | Web UI へのアクセスをパスワードで保護。連続失敗時のロックアウトあり |
| サーバー管理 | SSH接続先の登録・編集・削除。パスワード / 秘密鍵の両認証に対応。接続テストボタンあり |
| ジョブ管理 | cron式でスケジュールを設定。**コマンド実行**と**ログファイル取得**の2種類 |
| 手動実行 | ジョブをいつでもワンクリックで即時実行 |
| 実行履歴 | 全実行結果を一覧表示。ステータスでフィルタリング可能 |
| ログビューア | NDJSON形式は構造化テーブル表示。プレーンテキストはそのまま表示 |
| ダッシュボード | 成功率・失敗数などのサマリーと最近の実行一覧 |
| 設定エクスポート / インポート | サーバー・ジョブ設定をJSONファイルで持ち運び可能 |

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

# 3. .env を編集（SECRET_KEY と AUTH_PASSWORD を必ず設定）
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
| `AUTH_PASSWORD` | _(空)_ | Web UIのパスワード。**設定推奨**。空の場合は認証無効 |
| `AUTH_MAX_ATTEMPTS` | `5` | この回数連続で失敗するとロックアウト |
| `AUTH_LOCKOUT_MINUTES` | `15` | ロックアウト継続時間（分） |
| `AUTH_TOKEN_EXPIRE_HOURS` | `24` | ログイン後のトークン有効期限（時間） |

## 認証

`AUTH_PASSWORD` を設定すると Web UI へのアクセスにパスワードが必要になります。

```env
AUTH_PASSWORD=your-secret-password
```

### ロックアウト

パスワードを連続で間違えると、送信元 IP アドレスに対して一時的にアクセスが拒否されます。

- デフォルトは **5回失敗で15分ロック**
- `AUTH_MAX_ATTEMPTS` / `AUTH_LOCKOUT_MINUTES` で変更可能
- ロック中は残り秒数がエラーメッセージに表示されます

認証が不要な環境（開発環境など）は `AUTH_PASSWORD` を空のままにしてください。

### API アクセス

認証が有効なときは API リクエストにも Bearer トークンが必要です。

```bash
# 1. ログインしてトークンを取得
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"your-secret-password"}' | jq -r .token)

# 2. トークンを付けてリクエスト
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/servers
```

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

SQLiteデータベース (`/data/opsboard.db`) は Docker Volume `backend-data` に保存されます。  
バックアップはこのファイルを取得するだけで完了です。

```bash
docker run --rm -v ops-board_backend-data:/data -v $(pwd):/backup \
  alpine cp /data/opsboard.db /backup/opsboard_backup.db
```

### セキュリティに関する注意

- SSH パスワード・秘密鍵は Fernet 暗号化してDBに保存されます
- Web UI は `AUTH_PASSWORD` によるパスワード認証で保護できます
- SSH接続はホスト鍵検証を省略しています（内部ネットワーク利用を前提）
- 本番環境では `SECRET_KEY` と `AUTH_PASSWORD` を必ず設定してください
- HTTPS化する場合はnginxの前段にリバースプロキシを置いてください

## API

バックエンドは REST API を提供します。

```
POST   /api/v1/auth/login            ログイン（トークン取得）
GET    /api/v1/auth/status           認証要否の確認（公開）

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

GET    /api/v1/config/export        設定エクスポート
POST   /api/v1/config/import        設定インポート

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
