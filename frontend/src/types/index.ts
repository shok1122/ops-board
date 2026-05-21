export interface Server {
  id: string
  name: string
  host: string
  worker_token?: string
  created_at: string
  updated_at: string
}

export interface ServerCreate {
  name: string
  host?: string
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
  agent_version?: string
  go_version?: string
  arch?: string
  hostname?: string
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
  parsed_result?: JobResultOutput
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
  parsed_result?: JobResultOutput
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

// ── Job Templates ────────────────────────────────────────────────────────────

export type TemplateLanguage = 'bash'

export interface JobTemplateConfigOption {
  value: string
  label: string
}

export interface JobTemplateConfigField {
  key: string
  label: string
  default: string
  type?: 'text' | 'select'
  options?: JobTemplateConfigOption[]
}

export interface JobTemplate {
  id: string
  name: string
  description: string
  category: string
  language: TemplateLanguage
  script: string
  command: string
  default_cron: string
  default_timeout: number
  config_fields: JobTemplateConfigField[]
}

// ── Builtin Metrics ──────────────────────────────────────────────────────────

export type BuiltinMetricKey =
  | 'cpu_load'
  | 'mem_used'
  | 'cpu_load_1m'
  | 'cpu_load_5m'
  | 'cpu_load_15m'
  | 'mem_used_pct'
  | 'mem_used_mb'
  | 'disk_used_pct'
  | 'disk_used_gb'
  | 'process_count'
  | 'ssl_cert_expiry_days'

export interface BuiltinMetricConfigOption {
  value: string
  label: string
  unit?: string
  resolved_command?: string
}

export interface BuiltinMetricConfigField {
  key: string
  label: string
  default: string
  type?: 'text' | 'select'
  options?: BuiltinMetricConfigOption[]
}

export interface BuiltinMetricDef {
  key: BuiltinMetricKey
  label: string
  unit: string
  configurable: boolean
  config_fields?: BuiltinMetricConfigField[]
  command_template?: string | null
}

// ── Worker Checks ────────────────────────────────────────────────────────────

export interface WorkerMetric {
  name: string
  value: number
  unit: string
}

export interface WorkerCheck {
  id: string
  server_id: string
  server_name?: string
  check_name: string
  check_type: string
  status: string
  message?: string
  metrics: WorkerMetric[]
  labels: Record<string, string>
  error?: string
  reported_at: string
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

// ── Scripts ──────────────────────────────────────────────────────────────────

export type ScriptLanguage = 'bash'

export interface Script {
  id: string
  name: string
  description?: string
  language: ScriptLanguage
  content: string
  created_at: string
  updated_at: string
}

export interface ScriptCreate {
  name: string
  description?: string
  language: ScriptLanguage
  content: string
}

export type ScriptSource = 'user' | 'builtin_metric' | 'job_template'

export interface UnifiedScript {
  id: string
  name: string
  description?: string
  language: ScriptLanguage
  content: string
  source: ScriptSource
  readonly: boolean
  // builtin_metric 専用
  builtinKey?: BuiltinMetricKey
  unit?: string
  configFields?: BuiltinMetricConfigField[]
  // job_template 専用
  category?: string
  defaultCron?: string
  defaultTimeout?: number
  templateConfigFields?: JobTemplateConfigField[]
}
