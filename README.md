# OpsBoard

A web application for visualizing the results of scheduled tasks running on remote servers.  
Executes commands and collects logs over SSH, making execution results viewable in the browser.

## Screenshots

```
Dashboard → Servers → Jobs → Execution History → Log Viewer
```

## Features

| Feature | Description |
|---------|-------------|
| Password Authentication | Protect Web UI access with a password. Includes IP-based lockout after repeated failures |
| Server Management | Register, edit, and delete SSH targets. Supports both password and private key auth. Includes connection test |
| Job Management | Set schedules with cron expressions. Two types: **command execution** and **log file retrieval** |
| Manual Execution | Trigger any job immediately with one click |
| Execution History | List all execution results. Filterable by status |
| Log Viewer | NDJSON format shown as a structured table. Plain text displayed as-is |
| Dashboard | Summary cards (success rate, failure count, etc.) and recent execution list |
| Config Export / Import | Portable server and job configuration via JSON files |

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

To stop and remove all data (DB, SSH keys):

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
| `SECRET_KEY` | `change-me-...` | Encryption key for SSH credentials. **Must be changed in production** |
| `PORT` | `3000` | Host port to expose |
| `AUTH_PASSWORD` | _(empty)_ | Web UI password. **Recommended.** Leave empty to disable authentication |
| `AUTH_MAX_ATTEMPTS` | `5` | Number of consecutive failures before lockout |
| `AUTH_LOCKOUT_MINUTES` | `15` | Lockout duration (minutes) |
| `AUTH_TOKEN_EXPIRE_HOURS` | `24` | Login token expiry (hours) |

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

### Shell Script Example

```bash
#!/bin/bash
LOG=/var/log/myapp/backup.log

log() {
  echo "{\"ts\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"level\": \"$1\", \"msg\": \"$2\"}" >> "$LOG"
}

log INFO "Backup started"
rsync -a /data/ /backup/ && log INFO "Done" || log ERROR "Failed"
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
│                  │  asyncssh (SSH execution)
│                  │  aiosqlite (SQLite)
└────────┬─────────┘
         │ SSH
         ▼
   Remote servers
```

### Data Persistence

The SQLite database (`/data/opsboard.db`) is stored in the Docker volume `backend-data`.  
A backup is as simple as copying that file.

```bash
docker run --rm -v ops-board_backend-data:/data -v $(pwd):/backup \
  alpine cp /data/opsboard.db /backup/opsboard_backup.db
```

### Security Notes

- SSH passwords and private keys are Fernet-encrypted before being stored in the DB
- The Web UI can be protected with password authentication via `AUTH_PASSWORD`
- Host key verification is skipped for SSH connections (assumes internal network use)
- Set both `SECRET_KEY` and `AUTH_PASSWORD` in production environments
- For HTTPS, place a reverse proxy in front of nginx

## API

The backend exposes a REST API.

```
POST   /api/v1/auth/login            Login (obtain token)
GET    /api/v1/auth/status           Check whether auth is required (public)

GET    /api/v1/servers              List servers
POST   /api/v1/servers              Create server
PUT    /api/v1/servers/{id}         Update server
DELETE /api/v1/servers/{id}         Delete server
POST   /api/v1/servers/{id}/test    Test SSH connection

GET    /api/v1/jobs                 List jobs
POST   /api/v1/jobs                 Create job
PUT    /api/v1/jobs/{id}            Update job
DELETE /api/v1/jobs/{id}            Delete job
POST   /api/v1/jobs/{id}/trigger    Trigger job manually
PATCH  /api/v1/jobs/{id}/enable     Enable / disable job

GET    /api/v1/executions           List execution history
GET    /api/v1/executions/{id}      Get execution detail (with logs)

GET    /api/v1/config/export        Export configuration
POST   /api/v1/config/import        Import configuration

GET    /api/v1/scheduler/status     Scheduler status
POST   /api/v1/scheduler/reload     Reload scheduler
GET    /api/v1/health               Health check
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
| SSH | asyncssh |
| Database | SQLite (aiosqlite) |
| Encryption | cryptography (Fernet) |
| Container | Docker + nginx |
