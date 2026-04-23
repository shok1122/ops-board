# OpsBoard Backend

The backend application for OpsBoard.  
A REST API server built with Python / FastAPI, responsible for remote command execution over SSH, log retrieval, and cron scheduling.

## Tech Stack

| Library | Version | Purpose |
|---------|---------|---------|
| FastAPI | 0.110+ | Web framework |
| Python | 3.12 | Runtime |
| uvicorn | 0.27+ | ASGI server |
| asyncssh | 2.14+ | Async SSH client |
| APScheduler | 3.x | Cron scheduler |
| aiosqlite | 0.20+ | Async SQLite driver |
| cryptography | 42+ | Fernet encryption for SSH credentials |
| pydantic / pydantic-settings | 2.x | Request/response type definitions and env var management |

## Directory Structure

```
backend/
├── app/
│   ├── main.py         # FastAPI app init, lifespan, router registration
│   ├── config.py       # Environment variable definitions (pydantic-settings)
│   ├── database.py     # SQLite init, schema definitions, session utilities
│   ├── models.py       # Pydantic request/response models
│   ├── scheduler.py    # APScheduler management and job execution logic
│   ├── ssh.py          # asyncssh wrapper (command execution, file retrieval, connection test)
│   ├── crypto.py       # Fernet encryption and decryption
│   ├── log_parser.py   # NDJSON log parser (with plain text fallback)
│   └── routers/
│       ├── auth.py         # /auth endpoints, require_auth dependency, lockout management
│       ├── servers.py      # /servers endpoints
│       ├── jobs.py         # /jobs endpoints
│       ├── executions.py   # /executions endpoints
│       ├── settings.py     # /settings endpoints
│       └── config.py       # /config endpoints (export / import)
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
| `SECRET_KEY` | `change-me-...` | Encryption key for SSH credentials and token signing. **Must be changed in production** |
| `AUTH_PASSWORD` | _(empty)_ | Web UI password. Enables authentication when set. Empty = auth disabled |
| `AUTH_MAX_ATTEMPTS` | `5` | Number of consecutive failures before lockout |
| `AUTH_LOCKOUT_MINUTES` | `15` | Lockout duration (minutes) |
| `AUTH_TOKEN_EXPIRE_HOURS` | `24` | Login token expiry (hours) |

## Authentication

Setting the `AUTH_PASSWORD` environment variable enables Bearer token authentication on all API endpoints except `/health` and `/auth/*`.

### Lockout

After too many consecutive wrong passwords, the source IP address is temporarily blocked (HTTP 429).  
The remaining lock time is included in the response `detail` field.  
Lockout state is held in memory and resets on server restart.

### Token Format

Tokens are HMAC-SHA256 signed with no external dependencies.  
The payload includes an expiry timestamp (`exp`) and is signed with `SECRET_KEY`.  
Changing `SECRET_KEY` invalidates all existing tokens.

## Module Reference

### `database.py`

Handles SQLite initialization, schema definitions, and session management.

**Tables:**

| Table | Description |
|-------|-------------|
| `servers` | SSH target information (credentials stored encrypted) |
| `jobs` | Schedule configuration and target command or log path |
| `executions` | Job execution history (stdout / stderr / parsed result) |
| `server_status` | Periodic system status snapshots (CPU, memory, disk) |
| `app_settings` | Key-value application settings |

Foreign key constraints (`ON DELETE CASCADE`) cascade-delete jobs and executions when a server is deleted.  
`get_db()` is provided as a context manager and rolls back automatically on exception.

### `scheduler.py`

Manages cron scheduling using APScheduler's `AsyncIOScheduler`.

On startup (`lifespan`), all enabled jobs are loaded from the DB and schedules are rebuilt.  
Job execution flow:

```
Scheduler fires
  → INSERT executions record with status='running'
  → Execute command / retrieve log file over SSH
  → Parse stdout with log_parser
  → UPDATE executions record with status='success' or 'failure'
```

Manual execution (`POST /jobs/{id}/trigger`) runs in the background via `asyncio.create_task` and does not block the response.

### `ssh.py`

A thin asyncssh wrapper for SSH utilities. Only used for `remote_execution` servers.

| Function | Description |
|----------|-------------|
| `run_command()` | Runs a command remotely and returns stdout / stderr / exit_code |
| `fetch_file()` | Retrieves the tail of a log file using `tail -n 500` (wrapper around `run_command`) |
| `test_connection()` | Runs `echo ok` to test connectivity and measure latency |

Supports both password and private key authentication.  
Host key verification is skipped (assumes internal network use).  
`local_execution` servers bypass SSH entirely — commands run directly via `asyncio.create_subprocess_shell` on the backend host.

### `crypto.py`

Encrypts SSH passwords, private keys, and passphrases with Fernet before storing them in the DB.

The encryption key is derived from the `SECRET_KEY` environment variable using PBKDF2 (SHA-256, 100,000 iterations).  
**Do not change `SECRET_KEY` after initial setup** — doing so makes all existing encrypted data unrecoverable.

### `log_parser.py`

Parses job stdout and converts it to structured data.

- Lines that are JSON objects are processed as NDJSON
- Field name aliases are normalized (e.g. `timestamp` → `ts`, `message` → `msg`)
- If fewer than half the lines are valid JSON, the output is treated as plain text and each line is converted to `{"level": "RAW", "msg": "..."}`

### `models.py`

Pydantic model definitions for API requests and responses.

| Model | Purpose |
|-------|---------|
| `ServerCreate` / `ServerUpdate` | Server registration and update requests. `server_type` is `"remote_execution"` (SSH) or `"local_execution"` (backend host) |
| `ServerOut` | Server info response (credentials excluded) |
| `JobCreate` / `JobUpdate` | Job registration and update requests |
| `JobOut` | Job info response (server name joined) |
| `ExecutionOut` | Execution detail response (includes stdout / parsed_result) |
| `ExecutionSummary` | Execution list response (no logs, lightweight) |
| `PagedResponse` | Generic pagination type `{ items: [...], total: N }` |

## API Endpoints

All routes are prefixed with `/api/v1`.

```
# Authentication (no auth required)
POST   /auth/login               Login and obtain token (429: locked out)
GET    /auth/status              Check whether auth is required {"auth_required": bool}

# Servers
GET    /servers                  List
POST   /servers                  Create
GET    /servers/{id}             Get
PUT    /servers/{id}             Update
DELETE /servers/{id}             Delete
POST   /servers/{id}/test        SSH connection test

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
GET    /executions/{id}          Get detail (includes stdout / parsed_result)
DELETE /executions/{id}          Delete

# Settings
GET    /settings                 Get app settings
PUT    /settings                 Update app settings

# Config Export / Import
GET    /config/export            Export all config as JSON
POST   /config/import            Import config from JSON (replaces existing data)

# Scheduler
GET    /scheduler/status         Running job count and next fire times
POST   /scheduler/reload         Reload all jobs from DB

# System
GET    /health                   Health check
```

## Application Startup Flow

```
uvicorn starts
  → lifespan begins
      → init_db()         Create schema (CREATE TABLE IF NOT EXISTS)
      → scheduler.start() Start APScheduler
      → reload_all_jobs() Schedule all enabled=1 jobs from DB
  → Accept requests
  → lifespan ends
      → scheduler.shutdown()
```
