export interface Server {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth_type: 'password' | 'key'
  created_at: string
  updated_at: string
}

export interface ServerCreate {
  name: string
  host: string
  port: number
  username: string
  auth_type: 'password' | 'key'
  password?: string
  private_key?: string
  passphrase?: string
}

export interface TestResult {
  ok: boolean
  latency_ms?: number
  error?: string
}

export interface ServerStatus {
  id: string
  server_id: string
  checked_at: string
  cpu_load_1m?: number
  mem_used_mb?: number
  mem_total_mb?: number
  disk_used_gb?: number
  disk_total_gb?: number
  uptime_seconds?: number
  os_info?: string
  error?: string
}

export interface Job {
  id: string
  name: string
  description?: string
  server_id: string
  server_name?: string
  type: 'command' | 'log_fetch'
  command?: string
  log_path?: string
  cron_expr: string
  enabled: boolean
  timeout_sec: number
  last_run_at?: string
  last_status?: string
  created_at: string
  updated_at: string
}

export interface JobCreate {
  name: string
  description?: string
  server_id: string
  type: 'command' | 'log_fetch'
  command?: string
  log_path?: string
  cron_expr: string
  enabled: boolean
  timeout_sec: number
}

export type ExecutionStatus = 'running' | 'success' | 'failure' | 'timeout'

export interface ExecutionSummary {
  id: string
  job_id: string
  job_name?: string
  triggered_by: string
  started_at: string
  finished_at?: string
  status: ExecutionStatus
  exit_code?: number
  created_at: string
}

export interface LogEntry {
  ts?: string
  level?: string
  msg?: string
  task?: string
  meta?: Record<string, unknown>
  raw?: boolean
}

export interface Execution extends ExecutionSummary {
  stdout?: string
  stderr?: string
  parsed_result?: LogEntry[]
}

export interface PagedResponse<T> {
  items: T[]
  total: number
}

export interface AppSettings {
  status_check_interval_minutes: number
}

export interface JobResultItem {
  label: string
  value: string | number
  unit?: string
  status?: 'ok' | 'warn' | 'error'
}

export interface JobResultOutput {
  title?: string
  status?: 'ok' | 'warn' | 'error'
  value?: string | number
  unit?: string
  message?: string
  items?: JobResultItem[]
}

export interface ServerJobResult {
  job_id: string
  job_name: string
  execution_id: string
  execution_status: string
  finished_at?: string
  output?: JobResultOutput
  raw_stdout?: string
}
