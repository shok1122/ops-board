import axios from 'axios'
import type {
  Server, ServerCreate, TestResult, ServerStatus, ServerJobResult,
  Job, JobCreate,
  Execution, ExecutionSummary,
  PagedResponse, AppSettings,
  Monitor, MonitorCreate, MonitorDataPoint, BuiltinMetricDef,
} from '../types'

const TOKEN_KEY = 'opsboard_token'

const api = axios.create({ baseURL: '/api/v1' })

// リクエストに Bearer トークンを付与
api.interceptors.request.use(config => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 401 レスポンスでトークンを破棄してログインページへリダイレクト
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

// Servers
export const getServers = () =>
  api.get<PagedResponse<Server>>('/servers').then(r => r.data)

export const createServer = (data: ServerCreate) =>
  api.post<Server>('/servers', data).then(r => r.data)

export const updateServer = (id: string, data: Partial<ServerCreate>) =>
  api.put<Server>(`/servers/${id}`, data).then(r => r.data)

export const deleteServer = (id: string) =>
  api.delete(`/servers/${id}`)

export const testServer = (id: string) =>
  api.post<TestResult>(`/servers/${id}/test`).then(r => r.data)

export const checkServerStatus = (id: string) =>
  api.post<ServerStatus>(`/servers/${id}/status`).then(r => r.data)

export const getServerStatus = (id: string) =>
  api.get<ServerStatus>(`/servers/${id}/status`).then(r => r.data)

export const getAllLatestStatuses = () =>
  api.get<ServerStatus[]>('/servers/statuses/latest').then(r => r.data)

export const getServerStatusHistory = (id: string, limit = 48) =>
  api.get<ServerStatus[]>(`/servers/${id}/status/history`, { params: { limit } }).then(r => r.data)

export const getServerJobResults = (id: string) =>
  api.get<ServerJobResult[]>(`/servers/${id}/job-results`).then(r => r.data)

// Jobs
export const getJob = (id: string) =>
  api.get<Job>(`/jobs/${id}`).then(r => r.data)

export const getJobs = (serverId?: string) =>
  api.get<PagedResponse<Job>>('/jobs', {
    params: serverId ? { server_id: serverId } : undefined,
  }).then(r => r.data)

export const createJob = (data: JobCreate) =>
  api.post<Job>('/jobs', data).then(r => r.data)

export const updateJob = (id: string, data: Partial<JobCreate>) =>
  api.put<Job>(`/jobs/${id}`, data).then(r => r.data)

export const deleteJob = (id: string) =>
  api.delete(`/jobs/${id}`)

export const triggerJob = (id: string) =>
  api.post(`/jobs/${id}/trigger`).then(r => r.data)

export const toggleJob = (id: string, enabled: boolean) =>
  api.patch<Job>(`/jobs/${id}/enable`, null, { params: { enabled } }).then(r => r.data)

// Executions
export const getExecutions = (params?: {
  job_id?: string
  status?: string
  limit?: number
  offset?: number
}) =>
  api.get<PagedResponse<ExecutionSummary>>('/executions', { params }).then(r => r.data)

export const getExecution = (id: string) =>
  api.get<Execution>(`/executions/${id}`).then(r => r.data)

export const deleteExecution = (id: string) =>
  api.delete(`/executions/${id}`)

// Config export/import
export const exportConfig = () =>
  api.get('/config/export').then(r => r.data)

export const importConfig = (data: unknown) =>
  api.post('/config/import', data).then(r => r.data)

// Settings
export const getAppSettings = () =>
  api.get<AppSettings>('/settings').then(r => r.data)

export const updateAppSettings = (data: AppSettings) =>
  api.put<AppSettings>('/settings', data).then(r => r.data)

// Monitors
export const getMonitors = (serverId?: string) =>
  api.get<Monitor[]>('/monitors', {
    params: serverId ? { server_id: serverId } : undefined,
  }).then(r => r.data)

export const createMonitor = (data: MonitorCreate) =>
  api.post<Monitor>('/monitors', data).then(r => r.data)

export const updateMonitor = (id: string, data: Partial<MonitorCreate>) =>
  api.put<Monitor>(`/monitors/${id}`, data).then(r => r.data)

export const deleteMonitor = (id: string) =>
  api.delete(`/monitors/${id}`)

export const toggleMonitor = (id: string, enabled: boolean) =>
  api.patch<Monitor>(`/monitors/${id}/enable`, null, { params: { enabled } }).then(r => r.data)

export const triggerMonitor = (id: string) =>
  api.post(`/monitors/${id}/trigger`).then(r => r.data)

export const getMonitorData = (id: string, hours = 24, limit = 500) =>
  api.get<MonitorDataPoint[]>(`/monitors/${id}/data`, { params: { hours, limit } }).then(r => r.data)

export const getBuiltinMetrics = () =>
  api.get<BuiltinMetricDef[]>('/monitors/builtin-metrics/list').then(r => r.data)

// Dashboard stats (derived from existing endpoints)
export const getDashboardStats = async () => {
  const [jobs, executions] = await Promise.all([
    getJobs(),
    getExecutions({ limit: 100 }),
  ])
  const recentExecs = executions.items.slice(0, 10)
  const successCount = executions.items.filter(e => e.status === 'success').length
  const failureCount = executions.items.filter(e => e.status === 'failure').length
  const runningCount = executions.items.filter(e => e.status === 'running').length
  return {
    totalJobs: jobs.total,
    enabledJobs: jobs.items.filter(j => j.enabled).length,
    recentExecutions: recentExecs,
    successCount,
    failureCount,
    runningCount,
    successRate: executions.total > 0
      ? Math.round((successCount / executions.items.length) * 100)
      : null,
  }
}
