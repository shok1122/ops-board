export type ServerType = 'ssh' | 'no_ssh'

export interface Server {
  id: string
  name: string
  host: string
  port: number
  server_type: ServerType
  username: string
  auth_type: 'password' | 'key'
  created_at: string
  updated_at: string
}

export interface ServerCreate {
  name: string
  host: string
  port: number
  server_type: ServerType
  username?: string
  auth_type: 'password' | 'key'
  password?: string
  private_key?: string
  passphrase?: string
}

export interface TestResult {
  ok: boolean
  latency_ms?: number
  cert_expiry_days?: number
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

// ── Job Templates ────────────────────────────────────────────────────────────

export type TemplateLanguage = 'bash' | 'ruby' | 'python'

export interface JobTemplate {
  id: string
  name: string
  description: string
  category: string
  language: TemplateLanguage
  script: string
  command: string        // heredoc-wrapped, ready for SSH execution
  default_cron: string
  default_timeout: number
  tags: string[]
}

// ── Monitors ─────────────────────────────────────────────────────────────────

export type MonitorMetricType = 'builtin' | 'custom'

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
  /** この選択肢を選んだときに自動セットされる unit */
  unit?: string
  /** この選択肢を選んだときに実行されるコマンド（プレビュー用） */
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

export interface MonitorCreate {
  name: string
  description?: string
  server_id: string
  interval_minutes: number
  enabled: boolean
  metric_type: MonitorMetricType
  builtin_key?: BuiltinMetricKey
  builtin_config?: Record<string, string>
  custom_script?: string
  unit?: string
  warning_threshold?: number
  critical_threshold?: number
}

export interface Monitor extends MonitorCreate {
  id: string
  server_name?: string
  created_at: string
  updated_at: string
}

export interface MonitorDataPoint {
  id: string
  monitor_id: string
  collected_at: string
  value?: number
  error?: string
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

export type ScriptLanguage = 'bash' | 'python' | 'ruby'

export interface Script {
  id: string
  name: string
  description?: string
  language: ScriptLanguage
  content: string
  tags: string[]
  created_at: string
  updated_at: string
}

export interface ScriptCreate {
  name: string
  description?: string
  language: ScriptLanguage
  content: string
  tags?: string[]
}

/**
 * Scripts / BuiltinMetrics / JobTemplates を統合した表示用型。
 * source によって読み取り専用かどうか、選択時の挙動が変わる。
 */
export type ScriptSource = 'user' | 'builtin_metric' | 'job_template'

export interface UnifiedScript {
  id: string
  name: string
  description?: string
  language: ScriptLanguage
  content: string          // コマンドテンプレート or スクリプト本体
  tags: string[]
  source: ScriptSource
  readonly: boolean        // true = 編集・削除不可
  // builtin_metric 専用
  builtinKey?: BuiltinMetricKey
  unit?: string
  configFields?: BuiltinMetricConfigField[]
  // job_template 専用
  category?: string
  defaultCron?: string
  defaultTimeout?: number
}
