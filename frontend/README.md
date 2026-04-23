# OpsBoard Frontend

The frontend application for OpsBoard.  
A SPA built with React + TypeScript + Vite that communicates with the backend API to display remote server task execution results.

## Tech Stack

| Library | Version | Purpose |
|---------|---------|---------|
| React | 18 | UI framework |
| TypeScript | 5 | Type safety |
| Vite | 5 | Build tool and dev server |
| Tailwind CSS | 3 | Styling |
| TanStack Query | 5 | Server state management and auto-polling |
| React Router | 6 | SPA routing |
| axios | 1 | HTTP client |
| date-fns | 3 | Date formatting |
| lucide-react | — | Icons |

## Directory Structure

```
frontend/
├── src/
│   ├── main.tsx            # Entry point (QueryClient initialization)
│   ├── App.tsx             # Router definition, AuthProvider wrapper, ProtectedRoute
│   ├── index.css           # Global styles and Tailwind utilities
│   │
│   ├── api/
│   │   ├── client.ts       # axios instance + API functions + auth interceptors
│   │   └── auth.ts         # Login API function
│   │
│   ├── contexts/
│   │   └── AuthContext.tsx # Auth state management (token, login/logout)
│   │
│   ├── types/
│   │   └── index.ts        # TypeScript types (mirrors backend Pydantic models)
│   │
│   ├── components/         # Reusable components
│   │   ├── Layout.tsx      # Sidebar navigation + Outlet + logout button
│   │   ├── StatusBadge.tsx # Execution status badge (success / failure / running / timeout)
│   │   └── LogViewer.tsx   # Log display (NDJSON table / raw text)
│   │
│   └── pages/              # Page components
│       ├── Login.tsx           # Login screen
│       ├── Dashboard.tsx       # Summary cards + recent execution list
│       ├── Servers.tsx         # Server management (CRUD + connection test)
│       ├── Jobs.tsx            # Job management (CRUD + manual trigger + enable/disable)
│       ├── JobDetail.tsx       # Job detail + execution history list
│       ├── Executions.tsx      # All execution history (filter + pagination)
│       └── ExecutionDetail.tsx # Execution detail + log viewer
│
├── index.html
├── vite.config.ts          # Vite config + API proxy
├── tailwind.config.js
├── tsconfig.json
├── postcss.config.js
├── package.json
└── Dockerfile              # Production build image served by nginx
```

## Local Development

In production everything starts with `docker compose up`, but for active frontend development you can run the Vite dev server directly for hot reloading.

With the backend running at `http://localhost:8000`:

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

Available at `http://localhost:5173`.  
Requests to `/api/*` are automatically proxied to `http://localhost:8000` (configured in `vite.config.ts`).

### Starting the Backend

```bash
cd ../backend
pip install -e .
uvicorn app.main:app --reload
```

## Build

```bash
npm run build
```

Static files are output to `dist/`. In production they are served by nginx inside the Docker image.

## Authentication Flow

1. On app load, `GET /api/v1/auth/status` is called to check whether auth is required
2. If auth is required and no token is stored → redirect to `/login`
3. After a successful login, the token is saved in `localStorage`
4. All subsequent API requests automatically include `Authorization: Bearer <token>`
5. On a 401 response, the token is discarded and the user is redirected to `/login`

`AuthContext` is provided to the entire app via `AuthProvider`.  
`ProtectedRoute` handles the auth check and redirects unauthenticated users to the login page.

## API Client (`api/client.ts`)

The axios instance uses `/api/v1` as its base URL.  
In Docker, nginx proxies `/api/*` to the backend.

**Interceptors:**
- **Request**: Reads the token from `localStorage` and attaches it as an `Authorization` header
- **Response**: On 401, removes the token and redirects to `/login`

### Functions

```typescript
// Auth (api/auth.ts)
loginApi(password)        // POST /auth/login → { token, auth_required }

// Servers
getServers()
createServer(data)
updateServer(id, data)
deleteServer(id)
testServer(id)            // SSH connection test

// Jobs
getJobs(serverId?)
getJob(id)
createJob(data)
updateJob(id, data)
deleteJob(id)
triggerJob(id)            // Manual trigger
toggleJob(id, enabled)    // Enable / disable

// Execution History
getExecutions({ job_id?, status?, limit?, offset? })
getExecution(id)

// Config export / import
exportConfig()
importConfig(data)

// Dashboard aggregation
getDashboardStats()       // Fetches jobs + executions in parallel and aggregates
```

## Type Definitions (`types/index.ts`)

TypeScript types that mirror the backend Pydantic models.

| Type | Backend Model | Description |
|------|--------------|-------------|
| `ServerType` | — | `'remote_execution'` \| `'local_execution'` |
| `Server` | `ServerOut` | Server info (credentials excluded) |
| `ServerCreate` | `ServerCreate` | Server creation request |
| `Job` | `JobOut` | Job info |
| `JobCreate` | `JobCreate` | Job creation request |
| `ExecutionSummary` | `ExecutionSummary` | Execution history entry (no logs) |
| `Execution` | `ExecutionOut` | Execution detail (includes stdout / parsed_result) |
| `LogEntry` | — | Parsed result of a single NDJSON line |
| `PagedResponse<T>` | `PagedResponse` | `{ items: T[], total: number }` |

## Polling Intervals

Auto-refresh intervals configured via TanStack Query.

| Page | Interval | Condition |
|------|----------|-----------|
| Dashboard | 15 s | Always |
| Execution History | 10 s | Always |
| Job Detail | 10 s | Always |
| Execution Detail | 3 s | Only while `status === 'running'` |

## Component Reference

### `Login.tsx`

Login screen with a password input form.  
When locked out (HTTP 429), the remaining lock time is shown in the error message.  
This page is never shown when authentication is disabled.

### `Layout.tsx`

Shell component with sidebar navigation and `<Outlet>`.  
All pages render as children of this Layout.  
A logout button is shown at the bottom of the sidebar when authentication is enabled.

### `StatusBadge.tsx`

Displays execution status as a colored badge.

| Status | Label | Color |
|--------|-------|-------|
| `success` | Success | Green |
| `failure` | Failure | Red |
| `running` | Running | Blue (animated) |
| `timeout` | Timeout | Orange |

### `LogViewer.tsx`

Log output display component.

- **NDJSON** logs are shown as a structured table with timestamp, level, and message columns
- **Plain text** is rendered in a `<pre>` block as-is
- The `maxHeight` prop controls the scrollable area height

## Custom CSS Classes

Defined as Tailwind components in `index.css`.

| Class | Description |
|-------|-------------|
| `.input` | Common style for form input fields |
| `.btn-primary` | Primary action button (indigo) |
| `.btn-secondary` | Secondary action button (border) |
