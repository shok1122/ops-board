# OpsBoard

A web application for visualizing the results of scheduled tasks running on remote servers.  
An **ops-worker** agent runs on each target server and pushes execution results to OpsBoard over HTTP.

## Screenshots

```
Dashboard → Servers → Jobs → Execution History → Log Viewer
```

## Features

| Feature | Description |
|---------|-------------|
| Password Authentication | Protect Web UI access with a password. Includes IP-based lockout after repeated failures |
| Server Management | Register and manage worker targets. Each server generates a **worker_token** used by ops-worker for authentication |
| Job Management | Set schedules with cron expressions. Two types: **command execution** and **log file retrieval** |
| Manual Execution | Trigger any job immediately with one click |
| Execution History | List all execution results. Filterable by status |
| Log Viewer | NDJSON format shown as a structured table. Plain text displayed as-is |
| Worker Monitoring | View latest check results (CPU, memory, disk, process, etc.) pushed by ops-worker |
| Metric Alerts | Per-server rules that turn pushed metrics into **Error** / **Warning** alerts using AND/OR threshold conditions, surfaced on the dashboard |
| Scripts Management | Create and edit shell scripts served to ops-worker via the API |
| Dashboard | Summary cards (success rate, failure count, etc.) and recent execution list |
| Teams Notification | Posts firing **Error** / **Warning** alerts to Microsoft Teams as plain text, on a cron schedule set from the Web UI |
| Config Export / Import | Portable server, job, alert rule and notification configuration via JSON files |

## Docker Images

Pre-built images are published to GitHub Container Registry on every push to `main` and on version tags.

```
ghcr.io/shok1122/ops-board-backend
ghcr.io/shok1122/ops-board-frontend
```

Tags: `main`, `sha-<commit>`, `<semver>` (e.g. `1.2`, `1.2.3`)

## Getting Started

### Prerequisites

- Docker / Docker Compose

### Steps

```bash
# 1. Clone the repository
git clone <repository-url>
cd ops-board

# 2. Create the environment file
cp .env.example .env

# 3. Edit .env (set SECRET_KEY and AUTH_PASSWORD)
vi .env

# 4. Build and start
docker compose up -d --build

# 5. Open in browser
open http://localhost:3000
```

To stop:

```bash
docker compose down
```

To stop and remove all data (DB, scripts):

```bash
docker compose down -v
```

### Changing the Port

The default port is `3000`. Set it in `.env` to change it.

```env
PORT=8080
```

## Configuration

Configure via the `.env` file.

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | `change-me-...` | Key for token signing. **Must be changed in production** |
| `PORT` | `3000` | Host port to expose |
| `AUTH_PASSWORD` | _(empty)_ | Web UI password. **Recommended.** Leave empty to disable authentication |
| `AUTH_MAX_ATTEMPTS` | `5` | Number of consecutive failures before lockout |
| `AUTH_LOCKOUT_MINUTES` | `15` | Lockout duration (minutes) |
| `AUTH_TOKEN_EXPIRE_HOURS` | `24` | Login token expiry (hours) |
| `SERVER_STATUS_RETENTION_DAYS` | `7` | Days to retain server status history |
| `TZ` | `UTC` | Timezone the cron expressions (jobs and notification checks) are evaluated in |
| `TEAMS_WEBHOOK_URL` | _(empty)_ | Teams Incoming Webhook / Workflow URL. Leave empty to disable Teams notification entirely |
| `TEAMS_TIMEOUT_SEC` | `10` | Webhook request timeout (seconds) |
| `TEAMS_DASHBOARD_URL` | _(empty)_ | Dashboard URL included at the end of each notification (optional) |

## Authentication

Setting `AUTH_PASSWORD` requires a password to access the Web UI.

```env
AUTH_PASSWORD=your-secret-password
```

### Lockout

After too many consecutive failed login attempts, access is temporarily denied for the source IP address.

- Default: **locked for 15 minutes after 5 failures**
- Configurable via `AUTH_MAX_ATTEMPTS` / `AUTH_LOCKOUT_MINUTES`
- The remaining lock time is shown in the error message

Leave `AUTH_PASSWORD` empty to disable authentication (e.g. for local development).

### API Access

When authentication is enabled, API requests also require a Bearer token.

```bash
# 1. Log in to obtain a token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"your-secret-password"}' | jq -r .token)

# 2. Make requests with the token
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/servers
```

## Worker Integration

Each server registered in OpsBoard has a **worker_token**. The [ops-worker](https://github.com/shok1122/ops-worker) agent running on the remote server uses this token to push data.

```bash
# ops-worker sends check results
POST /api/v1/ingest/report   Authorization: Bearer <worker_token>

# ops-worker sends periodic health/status
POST /api/v1/ingest/health   Authorization: Bearer <worker_token>
```

The worker_token is shown once when the server is created and can be regenerated from the server edit screen.

## Metric Alerts

Metrics pushed by ops-worker are evaluated against **alert rules** defined per server.
A rule that fires appears in the **Alerts** panel on the dashboard — red for `Error`, amber for `Warning`.

Rules are managed from the server card on the **Servers** screen.

### Rule Structure

| Field | Description |
|-------|-------------|
| Name | Label shown on the alert |
| Severity | `Error` (red) or `Warning` (amber) |
| Message | Optional note shown alongside the alert |
| Conditions | Threshold comparisons combined with AND / OR |
| Enabled | Disabled rules are never evaluated |

A condition targets a metric by its `name` — an arbitrary string, typed freely (names already
received from the server are offered as autocomplete suggestions). The optional **check name**
restricts a condition to one report (the top-level `name` of the payload); leave it blank to match
the metric in any check.

### Combining Conditions

Conditions live in groups: **within a group they are ANDed, and groups are ORed together**.

```
Group 1:  memory.usage_percent >= 90  AND  memory.available_bytes < 1073741824
   OR
Group 2:  cpu.load1 > 8
```

Any number of rules can be defined per server, so a metric can drive both a `Warning` rule and a
stricter `Error` rule.

### Example

Given this report from ops-worker:

```json
{
  "name": "memory",
  "type": "memory",
  "timestamp": "2026-05-21T10:00:00Z",
  "status": "ok",
  "message": "",
  "metrics": [
    { "name": "total_bytes",     "value": 17179869184, "unit": "bytes"   },
    { "name": "used_bytes",      "value": 8589934592,  "unit": "bytes"   },
    { "name": "available_bytes", "value": 8589934592,  "unit": "bytes"   },
    { "name": "usage_percent",   "value": 50.0,        "unit": "percent" }
  ],
  "labels": {}
}
```

a rule with the single condition `usage_percent >= 90` stays silent, and starts firing as soon as a
later report crosses the threshold. The alert shows the measured value that triggered it
(`memory.usage_percent 95 percent (>= 90)`) and how long it has been firing.

Supported operators: `>`, `>=`, `<`, `<=`, `==`, `!=`.
A condition whose metric is absent from the latest reports is treated as not satisfied.
Alert rules are included in the configuration export / import.

## Teams Notification

Alerts shown on the dashboard — both **metric alerts** and **job result alerts** — can be posted to a
Microsoft Teams channel as a plain text message (no cards or other Teams-specific decoration).

### Setup

The connection settings live in `docker-compose.yml` (i.e. the environment), **not** in the Web UI:

```env
# .env
TEAMS_WEBHOOK_URL=https://prod-00.japaneast.logic.azure.com:443/workflows/...
TEAMS_DASHBOARD_URL=https://opsboard.example.com/
```

```bash
docker compose up -d
```

`TEAMS_WEBHOOK_URL` is optional. **When it is not set, the notification feature is unusable** — the
scheduled check is never registered and the **Teams通知** screen says so. Everything else keeps working.

The webhook receives a POST with the body `{"text": "<message>"}`, which both the classic
Office 365 connector and a Power Automate "when a webhook request is received" workflow accept.

### Settings (Web UI)

Configured on the **Teams通知** screen.

| Setting | Description |
|---------|-------------|
| Enabled | Turns the scheduled check on / off |
| Schedule | **cron (5 fields)** — how often the need for a notification is checked. Evaluated in the `TZ` timezone |
| Severities | Notify on `Error`, `Warning`, or both |
| Frequency | `変化があったときだけ` (only when an alert appears or clears) or `チェックごとに毎回` (every check while any alert is firing) |
| Notify on resolve | Also send a message when a firing alert clears |

The screen also shows the last check / last notification time, the last error, a preview of the
message that would be sent right now, and buttons to send a test notification or run the check
immediately.

### Notification Content

```
🚨 OpsBoard アラート通知
発生中: 🔴 異常 1件 / 🟡 警告 1件

🆕 🔴 異常: [web-01] メモリ使用率が高い
　・メモリが逼迫しています
　・memory.usage_percent 95.5 percent (>= 90)
　・継続: 3時間12分

🟡 警告: [web-01] 証明書チェック
　・TLS 証明書: 12 days
　・有効期限が近づいています

✅ 解消したアラート
　・異常: [db-01] バックアップ

🔗 ダッシュボード: https://opsboard.example.com/
```

Newly fired alerts are marked 🆕. At most 20 alerts are listed per message; the rest are summarised
as a count. When every alert has cleared, the message becomes `✅ OpsBoard アラート解消`.

### How "whether to notify" is decided

At each cron tick the currently firing alerts are compared with the set that was notified last time:

- a new alert (or one whose severity changed) → notify
- an alert that cleared → notify, if *notify on resolve* is enabled
- nothing changed → **no notification** (unless frequency is `チェックごとに毎回`)
- nothing firing and nothing cleared → no notification

If sending fails, the error is shown on the screen and the same notification is retried at the next
tick.

## Log Format

Use **NDJSON (one JSON object per line)** to enable structured log display.

### Required Fields

| Field | Aliases | Description |
|-------|---------|-------------|
| `ts` | `timestamp`, `time` | ISO 8601 timestamp |
| `level` | `severity` | Log level: `DEBUG` / `INFO` / `WARN` / `ERROR` / `CRITICAL` |
| `msg` | `message`, `text` | Log message |

### Optional Fields

| Field | Description |
|-------|-------------|
| `task` | Task name |
| All others | Displayed as `meta` |

### Example Output

```jsonl
{"ts": "2026-04-08T10:00:00Z", "level": "INFO", "msg": "Backup started"}
{"ts": "2026-04-08T10:00:05Z", "level": "INFO", "msg": "3 files copied", "task": "backup", "meta": {"files": 3, "size_mb": 12.4}}
{"ts": "2026-04-08T10:00:06Z", "level": "INFO", "msg": "Backup complete", "exit_code": 0}
```

> **Plain text fallback**  
> If fewer than half the lines are valid JSON, the output is displayed as plain text automatically.  
> Existing scripts work without any changes.

## Architecture

```
Browser
  │  HTTP :3000
  ▼
┌──────────────────┐
│ nginx (frontend) │  React + Vite + Tailwind CSS
│ static files     │
│ /api/* → proxy   │
└────────┬─────────┘
         │ HTTP :8000
         ▼
┌──────────────────┐
│ uvicorn (backend)│  Python / FastAPI
│                  │  APScheduler (cron)
│                  │  aiosqlite (SQLite)
└──────────────────┘
         ▲
         │ HTTP POST /api/v1/ingest/*
         │ Authorization: Bearer <worker_token>
   ops-worker agents
   (on remote servers)
```

### Data Persistence

The SQLite database (`/data/opsboard.db`) and scripts (`/data/scripts`) are stored in the Docker volume `backend-data`.  
A backup is as simple as copying those files.

```bash
docker run --rm -v ops-board_backend-data:/data -v $(pwd):/backup \
  alpine cp /data/opsboard.db /backup/opsboard_backup.db
```

### Security Notes

- Worker tokens are stored in plain text in the DB and used as Bearer tokens for ingest authentication
- The Web UI can be protected with password authentication via `AUTH_PASSWORD`
- Set `SECRET_KEY` and `AUTH_PASSWORD` in production environments
- For HTTPS, place a reverse proxy in front of nginx

## API

The backend exposes a REST API.

```
POST   /api/v1/auth/login            Login (obtain token)
GET    /api/v1/auth/status           Check whether auth is required (public)

GET    /api/v1/servers              List servers
POST   /api/v1/servers              Create server
GET    /api/v1/servers/{id}         Get server
PUT    /api/v1/servers/{id}         Update server (optionally regenerate token)
DELETE /api/v1/servers/{id}         Delete server
DELETE /api/v1/servers/{id}/worker-token  Revoke worker token (sets token to null)
GET    /api/v1/servers/statuses/latest         Latest status for all servers
GET    /api/v1/servers/{id}/status            Latest status for a server
GET    /api/v1/servers/{id}/status/history    Status history for a server
GET    /api/v1/servers/{id}/job-results       Recent job execution results for a server

GET    /api/v1/jobs                 List jobs
POST   /api/v1/jobs                 Create job
GET    /api/v1/jobs/{id}            Get job
PUT    /api/v1/jobs/{id}            Update job
DELETE /api/v1/jobs/{id}            Delete job
POST   /api/v1/jobs/{id}/trigger    Trigger job manually
PATCH  /api/v1/jobs/{id}/enable     Enable / disable job

GET    /api/v1/executions           List execution history
GET    /api/v1/executions/{id}      Get execution detail (with logs)
DELETE /api/v1/executions/{id}      Delete execution

GET    /api/v1/worker-checks        List latest worker check results
GET    /api/v1/worker-checks?server_id={id}  Filter by server

GET    /api/v1/alert-rules         List alert rules (optional ?server_id={id})
POST   /api/v1/alert-rules         Create alert rule
GET    /api/v1/alert-rules/{id}    Get alert rule
PUT    /api/v1/alert-rules/{id}    Update alert rule
DELETE /api/v1/alert-rules/{id}    Delete alert rule
GET    /api/v1/alerts              List currently firing alerts (optional ?server_id={id})

GET    /api/v1/notifications/teams          Get Teams notification settings
PUT    /api/v1/notifications/teams          Update Teams notification settings
POST   /api/v1/notifications/teams/check    Run the notification check now
POST   /api/v1/notifications/teams/test     Send a test notification
GET    /api/v1/notifications/teams/preview  Preview the message that would be sent

GET    /api/v1/scripts              List scripts
POST   /api/v1/scripts              Create script
GET    /api/v1/scripts/{id}         Get script
PUT    /api/v1/scripts/{id}         Update script
DELETE /api/v1/scripts/{id}         Delete script

GET    /api/v1/job-templates        List job templates

GET    /api/v1/config/export        Export configuration
POST   /api/v1/config/import        Import configuration

GET    /api/v1/scheduler/status     Scheduler status
POST   /api/v1/scheduler/reload     Reload scheduler
GET    /api/v1/health               Health check

# ops-worker ingest (authenticated by worker_token, not by AUTH_PASSWORD)
POST   /api/v1/ingest/report        Receive check results from ops-worker
POST   /api/v1/ingest/health        Receive health/status from ops-worker
```

Swagger UI is available at `http://localhost:3000/api/docs` (recommended for development only).

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| Data fetching | TanStack Query (auto-polling) |
| Backend | Python 3.12 + FastAPI |
| Scheduler | APScheduler 3 |
| Database | SQLite (aiosqlite) |
| Container | Docker + nginx |
