# OpsBoard バックエンド

OpsBoard のバックエンドアプリケーションです。  
Python / FastAPI で構築された REST API サーバーで、SSH 経由のリモートコマンド実行・ログ取得・cron スケジューリングを担います。

## 技術スタック

| ライブラリ | バージョン | 用途 |
|-----------|-----------|------|
| FastAPI | 0.110+ | Web フレームワーク |
| Python | 3.12 | 実行環境 |
| uvicorn | 0.27+ | ASGI サーバー |
| asyncssh | 2.14+ | 非同期 SSH クライアント |
| APScheduler | 3.x | cron スケジューラー |
| aiosqlite | 0.20+ | 非同期 SQLite ドライバー |
| cryptography | 42+ | SSH 資格情報の Fernet 暗号化 |
| pydantic / pydantic-settings | 2.x | リクエスト/レスポンスの型定義・環境変数管理 |

## ディレクトリ構成

```
backend/
├── app/
│   ├── main.py         # FastAPI アプリ初期化・lifespan・ルーター登録
│   ├── config.py       # 環境変数の定義 (pydantic-settings)
│   ├── database.py     # SQLite 初期化・スキーマ定義・セッションユーティリティ
│   ├── models.py       # Pydantic リクエスト/レスポンスモデル
│   ├── scheduler.py    # APScheduler 管理・ジョブ実行ロジック
│   ├── ssh.py          # asyncssh ラッパー (コマンド実行・ファイル取得・接続テスト)
│   ├── crypto.py       # Fernet による暗号化・復号
│   ├── log_parser.py   # NDJSON ログパーサー（プレーンテキストフォールバックあり）
│   └── routers/
│       ├── auth.py         # /auth エンドポイント・require_auth 依存関数・ロックアウト管理
│       ├── servers.py      # /servers エンドポイント
│       ├── jobs.py         # /jobs エンドポイント
│       ├── executions.py   # /executions エンドポイント
│       ├── settings.py     # /settings エンドポイント
│       └── config.py       # /config エンドポイント（エクスポート/インポート）
├── pyproject.toml
└── Dockerfile
```

## ローカル開発

本番環境では `docker compose up` でまとめて起動しますが、バックエンドのコードを変更しながら開発する際はホットリロードが使える `--reload` オプション付きで直接起動すると効率的です。

```bash
cd backend

# 依存関係のインストール
pip install -r requirements.txt

# 開発サーバー起動 (ホットリロード有効)
uvicorn app.main:app --reload --port 8000
```

`http://localhost:8000` でアクセスできます。  
Swagger UI は `http://localhost:8000/docs` で確認できます。

データベースファイルはデフォルトで `/data/opsboard.db` に作成されます。  
ローカル開発時は環境変数で変更できます。

```bash
DB_PATH=./dev.db uvicorn app.main:app --reload
```

## 設定 (`config.py`)

環境変数または `.env` ファイルで設定します。

| 環境変数 | デフォルト | 説明 |
|---------|-----------|------|
| `DB_PATH` | `/data/opsboard.db` | SQLite データベースファイルのパス |
| `SECRET_KEY` | `change-me-...` | SSH 資格情報の暗号化キー兼トークン署名キー。**本番では必ず変更すること** |
| `AUTH_PASSWORD` | _(空)_ | Web UI のパスワード。設定すると認証が有効になる。空の場合は認証無効 |
| `AUTH_MAX_ATTEMPTS` | `5` | 連続失敗でロックアウトされるまでの回数 |
| `AUTH_LOCKOUT_MINUTES` | `15` | ロックアウト継続時間（分） |
| `AUTH_TOKEN_EXPIRE_HOURS` | `24` | ログイントークンの有効期限（時間） |

## 認証

`AUTH_PASSWORD` 環境変数を設定すると全 API エンドポイント（`/health` と `/auth/*` を除く）に Bearer トークン認証が適用されます。

### ロックアウト

パスワードを連続で間違えると、送信元 IP アドレスに対して一時的にアクセスが拒否されます（HTTP 429）。  
ロック中は残り秒数がレスポンスの `detail` に含まれます。  
ロック状態はメモリ上で管理されるため、サーバー再起動でリセットされます。

### トークン形式

外部ライブラリなしで実装した HMAC-SHA256 署名付きトークンです。  
ペイロードに有効期限（`exp`）を含み、`SECRET_KEY` で署名します。  
`SECRET_KEY` を変更すると既存トークンはすべて無効になります。

## モジュール解説

### `database.py`

SQLite の初期化・スキーマ定義・セッション管理を行います。

**テーブル構成:**

| テーブル | 説明 |
|---------|------|
| `servers` | SSH 接続先情報（資格情報は暗号化して保存） |
| `jobs` | スケジュール設定・実行対象コマンドまたはログパス |
| `executions` | ジョブの実行履歴（stdout / stderr / パース結果を保持） |

外部キー制約（`ON DELETE CASCADE`）により、サーバーを削除すると関連するジョブ・実行履歴も連鎖削除されます。  
`get_db()` はコンテキストマネージャとして提供され、例外発生時には自動ロールバックします。

### `scheduler.py`

APScheduler の `AsyncIOScheduler` を使い、ジョブの cron スケジューリングを管理します。

アプリ起動時（`lifespan`）に DB から有効なジョブを全件読み込み、スケジュールを再構築します。  
ジョブの実行フローは以下の通りです。

```
スケジューラー発火
  → executions レコードを status='running' で INSERT
  → SSH でコマンド実行 / ログファイル取得
  → stdout を log_parser でパース
  → executions レコードを status='success'/'failure' で UPDATE
```

手動実行（`POST /jobs/{id}/trigger`）は `asyncio.create_task` でバックグラウンド実行され、レスポンスをブロックしません。

### `ssh.py`

asyncssh を薄くラップした SSH ユーティリティです。

| 関数 | 説明 |
|------|------|
| `run_command()` | リモートでコマンドを実行し stdout / stderr / exit_code を返す |
| `fetch_file()` | `tail -n 500` でログファイルの末尾を取得する（`run_command` のラッパー） |
| `test_connection()` | `echo ok` を実行してレイテンシを計測する接続テスト |

パスワード認証と秘密鍵認証の両方に対応しています。  
接続時のホスト鍵検証は省略しています（内部ネットワーク利用を前提）。

### `crypto.py`

SSH パスワード・秘密鍵・パスフレーズを DB に保存する前に Fernet で暗号化します。

暗号化キーは `SECRET_KEY` 環境変数から PBKDF2 (SHA-256, 100,000 iterations) で導出されます。  
`SECRET_KEY` を変更すると既存の暗号化データが復号できなくなるため、**一度設定したら変更しないこと**。

### `log_parser.py`

ジョブの stdout を解析し、構造化データに変換します。

- 各行が JSON オブジェクトであれば NDJSON として処理
- フィールド名のエイリアスを正規化（例: `timestamp` → `ts`、`message` → `msg`）
- JSON 行が全体の半分未満の場合はプレーンテキストとして扱い、行ごとに `{"level": "RAW", "msg": "..."}` に変換

### `models.py`

Pydantic による API リクエスト・レスポンスのモデル定義です。

| モデル | 用途 |
|--------|------|
| `ServerCreate` / `ServerUpdate` | サーバー登録・更新リクエスト |
| `ServerOut` | サーバー情報レスポンス（資格情報を除外） |
| `JobCreate` / `JobUpdate` | ジョブ登録・更新リクエスト |
| `JobOut` | ジョブ情報レスポンス（サーバー名を JOIN して付加） |
| `ExecutionOut` | 実行詳細レスポンス（stdout / parsed_result 含む） |
| `ExecutionSummary` | 実行一覧用レスポンス（ログなし・軽量） |
| `PagedResponse` | `{ items: [...], total: N }` の汎用ページネーション型 |

## API エンドポイント

全ルートのプレフィックスは `/api/v1` です。

```
# 認証（認証不要）
POST   /auth/login               ログイン・トークン取得 (429: ロックアウト中)
GET    /auth/status              認証要否の確認 {"auth_required": bool}

# サーバー管理
GET    /servers                  一覧取得
POST   /servers                  作成
GET    /servers/{id}             取得
PUT    /servers/{id}             更新
DELETE /servers/{id}             削除
POST   /servers/{id}/test        SSH 接続テスト

# ジョブ管理
GET    /jobs                     一覧取得 (?server_id= でフィルタ可)
POST   /jobs                     作成
GET    /jobs/{id}                取得
PUT    /jobs/{id}                更新
DELETE /jobs/{id}                削除
POST   /jobs/{id}/trigger        手動実行 (202 Accepted / バックグラウンド実行)
PATCH  /jobs/{id}/enable         有効/無効切替 (?enabled=true|false)

# 実行履歴
GET    /executions               一覧取得 (?job_id= / ?status= / ?limit= / ?offset=)
GET    /executions/{id}          詳細取得 (stdout / parsed_result 含む)
DELETE /executions/{id}          削除

# 設定
GET    /settings                 アプリ設定取得
PUT    /settings                 アプリ設定更新

# 設定エクスポート/インポート
GET    /config/export            全設定を JSON でエクスポート
POST   /config/import            JSON から全設定をインポート（既存データは置換）

# スケジューラー
GET    /scheduler/status         実行中ジョブ数・次回実行時刻の一覧
POST   /scheduler/reload         DB から全ジョブを再読み込み

# システム
GET    /health                   ヘルスチェック
```

## アプリ起動フロー

```
uvicorn 起動
  → lifespan 開始
      → init_db()        スキーマ作成 (CREATE TABLE IF NOT EXISTS)
      → scheduler.start() APScheduler 開始
      → reload_all_jobs() DB から enabled=1 のジョブを全件スケジュール登録
  → リクエスト受付
  → lifespan 終了
      → scheduler.shutdown()
```
