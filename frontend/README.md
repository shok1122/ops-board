# OpsBoard フロントエンド

OpsBoard のフロントエンドアプリケーションです。  
React + TypeScript + Vite で構築された SPA で、バックエンド API と通信してリモートサーバーのタスク実行結果を表示します。

## 技術スタック

| ライブラリ | バージョン | 用途 |
|-----------|-----------|------|
| React | 18 | UIフレームワーク |
| TypeScript | 5 | 型安全 |
| Vite | 5 | ビルドツール・開発サーバー |
| Tailwind CSS | 3 | スタイリング |
| TanStack Query | 5 | サーバー状態管理・自動ポーリング |
| React Router | 6 | SPA ルーティング |
| axios | 1 | HTTP クライアント |
| date-fns | 3 | 日付フォーマット |
| lucide-react | - | アイコン |

## ディレクトリ構成

```
frontend/
├── src/
│   ├── main.tsx            # エントリポイント (QueryClient 初期化)
│   ├── App.tsx             # ルーター定義
│   ├── index.css           # グローバルスタイル・Tailwind utilities
│   │
│   ├── api/
│   │   └── client.ts       # axios インスタンス + API 関数一覧
│   │
│   ├── types/
│   │   └── index.ts        # TypeScript 型定義 (バックエンド Pydantic モデルと対応)
│   │
│   ├── components/         # 再利用コンポーネント
│   │   ├── Layout.tsx      # サイドバーナビゲーション + Outlet
│   │   ├── StatusBadge.tsx # 実行ステータスのバッジ (success / failure / running / timeout)
│   │   └── LogViewer.tsx   # ログ表示 (NDJSON テーブル / RAW テキスト)
│   │
│   └── pages/              # ページコンポーネント
│       ├── Dashboard.tsx       # サマリーカード + 最近の実行一覧
│       ├── Servers.tsx         # サーバー管理 (CRUD + 接続テスト)
│       ├── Jobs.tsx            # ジョブ管理 (CRUD + 即時実行 + 有効/無効)
│       ├── JobDetail.tsx       # ジョブ詳細 + 実行履歴一覧
│       ├── Executions.tsx      # 全実行履歴 (フィルタ + ページネーション)
│       └── ExecutionDetail.tsx # 実行詳細 + ログビューア
│
├── index.html
├── vite.config.ts          # Vite 設定 + API プロキシ
├── tailwind.config.js
├── tsconfig.json
├── postcss.config.js
├── package.json
└── Dockerfile              # nginx による本番ビルドイメージ
```

## ローカル開発

本番環境では `docker compose up` でまとめて起動しますが、フロントエンドのコードを変更しながら開発する際は Vite の開発サーバーを直接起動することでホットリロードが使えて効率的です。

バックエンドが `http://localhost:8000` で起動している状態で以下を実行します。

```bash
cd frontend

# 依存関係のインストール
npm install

# 開発サーバー起動
npm run dev
```

`http://localhost:5173` でアクセスできます。  
`/api/*` へのリクエストは自動的に `http://localhost:8000` へプロキシされます（`vite.config.ts` で設定）。

### バックエンドの起動方法

```bash
# プロジェクトルートで
cd ../backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## ビルド

```bash
npm run build
```

`dist/` に静的ファイルが出力されます。本番では Docker イメージ内の nginx で配信します。

## コンポーネント解説

### `Layout.tsx`

サイドバーナビゲーションと `<Outlet>` を持つシェルコンポーネントです。  
全ページはこの Layout の子として描画されます。

```
┌─────────┬──────────────────────────────┐
│ sidebar │                              │
│         │   <Outlet> (各ページ)        │
│ nav     │                              │
└─────────┴──────────────────────────────┘
```

### `StatusBadge.tsx`

実行ステータスを色付きバッジで表示します。

| ステータス | 表示 | 色 |
|-----------|------|-----|
| `success` | 成功 | 緑 |
| `failure` | 失敗 | 赤 |
| `running` | 実行中 | 青（点滅） |
| `timeout` | タイムアウト | オレンジ |

### `LogViewer.tsx`

ログ出力の表示コンポーネントです。

- **NDJSON形式**のログは時刻・レベル・メッセージの構造化テーブルで表示
- **プレーンテキスト**はそのまま `<pre>` で表示
- `maxHeight` プロパティでスクロール領域の高さを制御

## API クライアント (`api/client.ts`)

axios インスタンスのベース URL は `/api/v1` です。  
Docker 環境では nginx が `/api/*` をバックエンドにプロキシします。

### 主な関数

```typescript
// サーバー
getServers()
createServer(data)
updateServer(id, data)
deleteServer(id)
testServer(id)            // SSH接続テスト

// ジョブ
getJobs(serverId?)
getJob(id)
createJob(data)
updateJob(id, data)
deleteJob(id)
triggerJob(id)            // 即時実行
toggleJob(id, enabled)   // 有効/無効切替

// 実行履歴
getExecutions({ job_id?, status?, limit?, offset? })
getExecution(id)

// ダッシュボード集計
getDashboardStats()       // jobs + executions を並列取得して集計
```

## 型定義 (`types/index.ts`)

バックエンドの Pydantic モデルと対応する TypeScript 型です。

| 型 | 対応モデル | 説明 |
|----|-----------|------|
| `Server` | `ServerOut` | サーバー情報（資格情報を除く） |
| `ServerCreate` | `ServerCreate` | サーバー作成リクエスト |
| `Job` | `JobOut` | ジョブ情報 |
| `JobCreate` | `JobCreate` | ジョブ作成リクエスト |
| `ExecutionSummary` | `ExecutionSummary` | 実行履歴（ログなし） |
| `Execution` | `ExecutionOut` | 実行詳細（stdout / parsed_result 含む） |
| `LogEntry` | — | NDJSON 1行分のパース結果 |
| `PagedResponse<T>` | `PagedResponse` | `{ items: T[], total: number }` |

## ポーリング設定

TanStack Query によるデータの自動更新間隔です。

| ページ | 間隔 | 条件 |
|--------|------|------|
| ダッシュボード | 15秒 | 常時 |
| 実行履歴一覧 | 10秒 | 常時 |
| ジョブ詳細 | 10秒 | 常時 |
| 実行詳細 | 3秒 | `status === 'running'` の間のみ |

## カスタム CSS クラス

`index.css` に Tailwind コンポーネントとして定義しています。

| クラス | 説明 |
|--------|------|
| `.input` | フォーム入力フィールド共通スタイル |
| `.btn-primary` | 主アクションボタン（インディゴ） |
| `.btn-secondary` | 副アクションボタン（ボーダー） |
