# OpsBoard Backend

The backend application for OpsBoard.  
A REST API server built with Python / FastAPI, responsible for job scheduling, receiving push data from ops-worker agents, and serving the OpsBoard web UI API.

## Tech Stack

| Library | Version | Purpose |
|---------|---------|---------|
| FastAPI | 0.110+ | Web framework |
| Python | 3.12 | Runtime |
| uvicorn | 0.27+ | ASGI server |
| APScheduler | 3.x | Cron scheduler |
| aiosqlite | 0.20+ | Async SQLite driver |
| pydantic / pydantic-settings | 2.x | Request/response type definitions and env var management |

## Directory Structure

```
backend/
├── app/
│   ├── main.py              # FastAPI app init, lifespan, router registration
│   ├── config.py            # Environment variable definitions (pydantic-settings)
│   ├── database.py          # SQLite init, schema definitions, session utilities
│   ├── models.py            # Pydantic request/response models
│   ├── scheduler.py         # APScheduler management and job execution logic
│   ├── log_parser.py        # NDJSON log parser (with plain text fallback)
│   ├── job_templates.py     # Built-in job template definitions
│   └── routers/
│       ├── auth.py          # /auth endpoints, require_auth dependency, lockout management
│       ├── servers.py       # /servers endpoints
│       ├── jobs.py          # /jobs endpoints
│       ├── executions.py    # /executions endpoints
│       ├── worker_checks.py # /worker-checks endpoints
│       ├── scripts.py       # /scripts endpoints (filesystem-backed)
│       ├── job_templates.py # /job-templates endpoints
│       ├── ingest.py        # /ingest endpoints (ops-worker push, authenticated by worker_token)
│       └── config.py        # /config endpoints (export / import)
├── pyproject.toml
└── Dockerfile
```

## Local Development

In production you start everything with `docker compose up`, but for active backend development it's more efficient to run the server directly with `--reload` for hot reloading.

```bash
cd backend

# Install dependencies
pip install -e .

# Start dev server (hot reload enabled)
uvicorn app.main:app --reload --port 8000
```

Available at `http://localhost:8000`.  
Swagger UI is at `http://localhost:8000/docs`.

The database file is created at `/data/opsboard.db` by default.  
Override it with an environment variable during local development.

```bash
DB_PATH=./dev.db uvicorn app.main:app --reload
```

## Configuration (`config.py`)

Configure via environment variables or a `.env` file.

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PATH` | `/data/opsboard.db` | Path to the SQLite database file |
| `SECRET_KEY` | `change-me-...` | Key for token signing. **Must be changed in production** |
| `SCRIPTS_DIR` | `/data/scripts` | Directory where user scripts are stored |
| `SERVER_STATUS_RETENTION_DAYS` | `7` | Days to retain server status history |
| `AUTH_PASSWORD` | _(empty)_ | Web UI password. Enables authentication when set. Empty = auth disabled |
| `AUTH_MAX_ATTEMPTS` | `5` | Number of consecutive failures before lockout |
| `AUTH_LOCKOUT_MINUTES` | `15` | Lockout duration (minutes) |
| `AUTH_TOKEN_EXPIRE_HOURS` | `24` | Login token expiry (hours) |

## Authentication

### Web UI / API Authentication

Setting the `AUTH_PASSWORD` environment variable enables Bearer token authentication on all API endpoints except `/health` and `/auth/*`.

#### Lockout

After too many consecutive wrong passwords, the source IP address is temporarily blocked (HTTP 429).  
The remaining lock time is included in the response `detail` field.  
Lockout state is held in memory and resets on server restart.

#### Token Format

Tokens are HMAC-SHA256 signed with no external dependencies.  
The payload includes an expiry timestamp (`exp`) and is signed with `SECRET_KEY`.  
Changing `SECRET_KEY` invalidates all existing tokens.

### Worker Authentication (Ingest)

The `/api/v1/ingest/*` endpoints use a separate per-server `worker_token` (a random URL-safe token generated at server creation). ops-worker sends `Authorization: Bearer <worker_token>` on each request. This token is independent of `AUTH_PASSWORD`.

## Module Reference

### `database.py`

Handles SQLite initialization, schema definitions, and session management.

**Tables:**

| Table | Description |
|-------|-------------|
| `servers` | Worker target registrations (name, host, worker_token) |
| `jobs` | Schedule configuration and target command or log path |
| `executions` | Job execution history (stdout / stderr / parsed result) |
| `server_status` | Periodic status snapshots pushed by ops-worker (uptime, OS info, agent version, etc.) |
| `worker_checks` | Latest check results pushed by ops-worker (CPU, memory, disk, process, etc.) |

Foreign key constraints (`ON DELETE CASCADE`) cascade-delete jobs and executions when a server is deleted.  
`get_db()` is provided as a context manager and rolls back automatically on exception.

### `scheduler.py`

Manages cron scheduling using APScheduler's `AsyncIOScheduler`.

On startup (`lifespan`), all enabled jobs are loaded from the DB and schedules are rebuilt.  
Job execution flow:

```
Scheduler fires
  → INSERT executions record with status='running'
  → Run command locally via asyncio.create_subprocess_shell
  → Parse stdout with log_parser
  → UPDATE executions record with status='success' or 'failure'
```

Manual execution (`POST /jobs/{id}/trigger`) runs in the background via `asyncio.create_task` and does not block the response.

### `log_parser.py`

Parses job stdout and converts it to structured data.

- Lines that are JSON objects are processed as NDJSON
- Field name aliases are normalized (e.g. `timestamp` → `ts`, `message` → `msg`)
- If fewer than half the lines are valid JSON, the output is treated as plain text and each line is converted to `{"level": "RAW", "msg": "..."}`

### `models.py`

Pydantic model definitions for API requests and responses.

| Model | Purpose |
|-------|---------|
| `ServerCreate` / `ServerUpdate` | Server registration and update requests |
| `ServerOut` | Server info response |
| `ServerStatusOut` | Latest status snapshot from ops-worker |
| `JobCreate` / `JobUpdate` | Job registration and update requests |
| `JobOut` | Job info response (server name joined) |
| `ServerJobResult` | Recent job execution summary for a server |
| `ExecutionOut` | Execution detail response (includes stdout / parsed_result / stderr) |
| `ExecutionSummary` | Execution list response (no logs, lightweight) |
| `ScriptCreate` / `ScriptUpdate` / `ScriptOut` | Script file management |
| `PagedResponse` | Generic pagination type `{ items: [...], total: N }` |

## API Endpoints

All routes are prefixed with `/api/v1`.

```
# Authentication (no auth required)
POST   /auth/login               Login and obtain token (429: locked out)
GET    /auth/status              Check whether auth is required {"auth_required": bool}

# Servers
GET    /servers                          List (paginated)
POST   /servers                          Create (generates worker_token)
GET    /servers/{id}                     Get
PUT    /servers/{id}                     Update (regenerate_token=true to rotate token)
DELETE /servers/{id}                     Delete
DELETE /servers/{id}/worker-token        Revoke worker token (sets token to null)
GET    /servers/statuses/latest          Latest status snapshot for all servers
GET    /servers/{id}/status              Latest status snapshot for a server
GET    /servers/{id}/status/history      Status history for a server
GET    /servers/{id}/job-results         Recent job results for a server

# Jobs
GET    /jobs                     List (filterable with ?server_id=)
POST   /jobs                     Create
GET    /jobs/{id}                Get
PUT    /jobs/{id}                Update
DELETE /jobs/{id}                Delete
POST   /jobs/{id}/trigger        Manual trigger (202 Accepted, background execution)
PATCH  /jobs/{id}/enable         Enable / disable (?enabled=true|false)

# Execution History
GET    /executions               List (?job_id= / ?status= / ?limit= / ?offset=)
GET    /executions/{id}          Get detail (includes stdout / stderr / parsed_result)
DELETE /executions/{id}          Delete

# Worker Checks
GET    /worker-checks            List latest check results (?server_id= to filter)

# Scripts (filesystem-backed, stored in SCRIPTS_DIR/user/)
GET    /scripts                  List
POST   /scripts                  Create
GET    /scripts/{id}             Get
PUT    /scripts/{id}             Update
DELETE /scripts/{id}             Delete

# Job Templates
GET    /job-templates            List built-in job templates
GET    /job-templates/{id}       Get template by ID

# Config Export / Import
GET    /config/export            Export all config as JSON
POST   /config/import            Import config from JSON (replaces existing data)

# Scheduler
GET    /scheduler/status         Running job count and next fire times
POST   /scheduler/reload         Reload all jobs from DB

# System
GET    /health                   Health check (public)

# ops-worker ingest (authenticated by worker_token, not AUTH_PASSWORD)
POST   /ingest/report            Receive check results from ops-worker
POST   /ingest/health            Receive status/health from ops-worker
```

## Application Startup Flow

```
uvicorn starts
  → lifespan begins
      → init_db()         Create schema (CREATE TABLE IF NOT EXISTS) + run migrations
      → scheduler.start() Start APScheduler
      → reload_all_jobs() Schedule all enabled=1 jobs from DB
  → Accept requests
  → lifespan ends
      → scheduler.shutdown()
```
