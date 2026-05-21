import { useQuery, useQueries } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CheckCircle2, XCircle, Loader2, Calendar, TrendingUp, Plug, Copy, Check } from 'lucide-react'
import { useState } from 'react'
import { getDashboardStats, getServers, getServerJobResults } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import { JobResultCard } from '../components/JobResultView'
import { formatDistanceToNow } from 'date-fns'
import { ja } from 'date-fns/locale'

function AlertJobResults() {
  const { data: servers, isLoading: serversLoading } = useQuery({
    queryKey: ['servers'],
    queryFn: getServers,
  })

  const jobResultQueries = useQueries({
    queries: (servers?.items ?? []).map(s => ({
      queryKey: ['server-job-results', s.id],
      queryFn: () => getServerJobResults(s.id),
      refetchInterval: 60_000,
    })),
  })

  const isLoading = serversLoading || jobResultQueries.some(q => q.isLoading)

  const serverAlerts = (servers?.items ?? [])
    .map((s, i) => {
      const results = jobResultQueries[i]?.data ?? []
      const alerts = results.filter(r =>
        r.output?.status === 'error' || r.output?.status === 'warn' ||
        (r.output == null && (r.execution_status === 'failure' || r.execution_status === 'timeout'))
      )
      return { server: s, alerts }
    })
    .filter(x => x.alerts.length > 0)

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">アラート</h2>
      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
        </div>
      ) : serverAlerts.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm px-6 py-8 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400 mb-2" />
          <p className="text-sm text-gray-500">現在アラートはありません</p>
        </div>
      ) : (
        <div className="space-y-4">
          {serverAlerts.map(({ server, alerts }) => (
            <div key={server.id} className="rounded-xl border border-gray-200 bg-white shadow-sm p-4">
              <p className="text-sm font-medium text-gray-700 mb-3">{server.name}</p>
              <div className="columns-1 sm:columns-2 lg:columns-3 gap-2">
                {alerts.map(r => (
                  <div key={r.job_id} className="break-inside-avoid mb-2">
                    <JobResultCard result={r} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const WORKER_ENDPOINTS = [
  { method: 'POST', path: '/health', desc: 'エージェント起動・稼働状況の定期送信' },
  { method: 'POST', path: '/report', desc: '監視チェック結果の送信' },
]

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

function WorkerEndpoints() {
  const base = `${window.location.origin}/api/v1`
  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">ワーカー接続先</h2>
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3">
          <Plug className="h-4 w-4 text-indigo-400" />
          <span className="text-xs text-gray-500">Base URL</span>
          <code className="text-xs font-mono text-gray-800 flex-1">{base}</code>
          <CopyBtn text={base} />
        </div>
        <div className="divide-y divide-gray-50">
          {WORKER_ENDPOINTS.map(ep => (
            <div key={ep.path} className="flex items-center gap-3 px-5 py-3">
              <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 w-10 text-center">
                {ep.method}
              </span>
              <code className="text-xs font-mono text-gray-700 shrink-0">{ep.path}</code>
              <span className="text-xs text-gray-400 flex-1">{ep.desc}</span>
              <CopyBtn text={`${base}${ep.path}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboardStats,
    refetchInterval: 15_000,
  })

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    )
  }

  const stats = [
    {
      label: 'ジョブ総数',
      value: data?.totalJobs ?? 0,
      sub: `有効: ${data?.enabledJobs ?? 0}`,
      icon: Calendar,
      color: 'text-indigo-600',
      bg: 'bg-indigo-50',
    },
    {
      label: '成功',
      value: data?.successCount ?? 0,
      sub: '直近100件',
      icon: CheckCircle2,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      label: '失敗',
      value: data?.failureCount ?? 0,
      sub: '直近100件',
      icon: XCircle,
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
    {
      label: '成功率',
      value: data?.successRate != null ? `${data.successRate}%` : '—',
      sub: '直近100件',
      icon: TrendingUp,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
  ]

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">ダッシュボード</h1>

      <WorkerEndpoints />

      <AlertJobResults />

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 mb-8">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className={`rounded-lg p-2.5 ${s.bg}`}>
                <s.icon className={`h-5 w-5 ${s.color}`} />
              </div>
              <div>
                <p className="text-xs text-gray-500">{s.label}</p>
                <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                <p className="text-xs text-gray-400">{s.sub}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent executions */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="font-semibold text-gray-900">最近の実行</h2>
          <Link to="/executions" className="text-sm text-indigo-600 hover:underline">
            すべて見る
          </Link>
        </div>
        <div className="divide-y divide-gray-50">
          {data?.recentExecutions?.length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-gray-400">
              実行履歴はありません
            </div>
          )}
          {data?.recentExecutions?.map((exec) => (
            <Link
              key={exec.id}
              to={`/executions/${exec.id}`}
              className="flex items-center gap-4 px-6 py-3.5 hover:bg-gray-50 transition-colors"
            >
              <StatusBadge status={exec.status} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {exec.job_name ?? exec.job_id}
                </p>
                <p className="text-xs text-gray-400">
                  {exec.triggered_by === 'manual' ? '手動' : 'スケジュール'}
                </p>
              </div>
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {formatDistanceToNow(new Date(exec.started_at), { addSuffix: true, locale: ja })}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
