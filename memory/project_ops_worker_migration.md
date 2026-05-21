---
name: project-ops-worker-migration
description: ops-boardのSSH監視からops-worker push型監視への移行作業。完了済み。
metadata:
  type: project
---

ops-boardをSSHリモート実行からops-worker push型に移行した。

**完了した変更 (2026-05-21):**
- SSH関連機能を全て削除（ssh.py の SSHコード、routers/servers.py の /test・POST /status エンドポイント）
- サーバ登録時に worker_token（secrets.token_urlsafe(32)）を自動生成し、一度だけUIに表示
- ingest.py: 未登録トークンの自動サーバ作成を廃止 → 401を返すように変更
- scheduler.py / jobs.py: execution_type を削除し、全ジョブをローカル実行のみに統一
- WorkerStatus ページを削除 → ワーカー情報はサーバ管理画面に統合
- ナビゲーションから「ワーカー」リンクを削除
- Scripts/ScriptPicker から execution_type バッジ表示を削除

**ワーカー認証フロー:**
- ops-boardでサーバを追加 → server_id（Worker ID）と worker_token が発行される
- ops-workerは `Authorization: Bearer <worker_token>` でHTTP POST /report, /health に送信
- ingest.py が token でサーバを照合して記録

**Why:** SSHリモート実行をやめてワーカーのpush型に一本化するため。

**How to apply:** 新機能追加時、SSH関連コードは書かない。jobs は全て execution_type='local' で動く。
