export interface Server {
  id: string
  name: string
  host: string
  has_worker_credential: boolean
  worker_id?: string
  worker_secret?: string
  created_at: string
  updated_at: string
}

export interface ServerCreate {
  name: string
  host: string
  generate_worker_credential?: boolean
}

export interface ServerStatus {
  server_id: string
  checked_at: string
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

// ── Worker Checks ────────────────────────────────────────────────────────────

export interface WorkerMetric {
  name: string
  value: number
  unit: string
}

export interface WorkerCheck {
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
  stderr?: string
}

// ── Worker Ingest Logs ───────────────────────────────────────────────────────

export interface WorkerIngestLog {
  id: number
  server_id: string
  server_name?: string
  log_type: 'report' | 'health'
  check_name?: string
  status?: string
  message?: string
  received_at: string
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

export type ScriptSource = 'user' | 'job_template'

export interface UnifiedScript {
  id: string
  name: string
  description?: string
  language: ScriptLanguage
  content: string
  source: ScriptSource
  readonly: boolean
  // job_template 専用
  category?: string
  defaultCron?: string
  defaultTimeout?: number
  templateConfigFields?: JobTemplateConfigField[]
}

// ── Alerts ───────────────────────────────────────────────────────────────────

export type AlertSeverity = 'error' | 'warning'
export type AlertOperator = '>' | '>=' | '<' | '<=' | '==' | '!='

export interface AlertCondition {
  /** メトリクスの name（任意の文字列） */
  metric_name: string
  operator: AlertOperator
  threshold: number
  /** 特定のチェック（レポートの name）に限定する場合に指定 */
  check_name?: string | null
}

/** グループ内の条件は AND、グループ同士は OR で結合される */
export interface AlertConditionGroup {
  conditions: AlertCondition[]
}

export interface AlertRule {
  id: string
  server_id: string
  server_name?: string
  name: string
  severity: AlertSeverity
  message?: string | null
  enabled: boolean
  groups: AlertConditionGroup[]
  created_at: string
  updated_at: string
}

export interface AlertRuleCreate {
  server_id: string
  name: string
  severity: AlertSeverity
  message?: string | null
  enabled: boolean
  groups: AlertConditionGroup[]
}

export interface AlertMatch {
  check_name: string
  metric_name: string
  value: number
  unit?: string | null
  operator: AlertOperator
  threshold: number
  reported_at: string
}

export interface Alert {
  rule_id: string
  rule_name: string
  server_id: string
  server_name?: string
  severity: AlertSeverity
  message?: string | null
  matches: AlertMatch[]
  since?: string | null
  evaluated_at: string
}

// ── Teams 通知 ───────────────────────────────────────────────────────────────

/** on_change: 発生／解消に変化があったときだけ通知 / always: 発生中は毎回通知 */
export type NotifyMode = 'on_change' | 'always'

export interface NotificationSettings {
  enabled: boolean
  /** 通知の要否をチェックするタイミング（cron 5フィールド） */
  cron_expr: string
  severities: AlertSeverity[]
  mode: NotifyMode
  notify_resolved: boolean
  /** docker-compose で Webhook URL が設定されているか。false なら通知機能は使えない */
  configured: boolean
  dashboard_url?: string | null
  last_checked_at?: string | null
  last_notified_at?: string | null
  last_error?: string | null
  next_run_at?: string | null
  updated_at: string
}

export interface NotificationSettingsUpdate {
  enabled?: boolean
  cron_expr?: string
  severities?: AlertSeverity[]
  mode?: NotifyMode
  notify_resolved?: boolean
}

export interface NotificationCheckResult {
  sent: boolean
  reason: string
  firing: number
  new: number
  resolved: number
  message?: string | null
  error?: string | null
}

export interface NotificationPreview {
  firing: number
  message?: string | null
}
