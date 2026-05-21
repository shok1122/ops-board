import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, XCircle, AlertTriangle, Activity, Clock } from 'lucide-react'
import { getServers, getWorkerChecks } from '../api/client'
import type { Server, WorkerCheck, WorkerMetric } from '../types'
import { formatDistanceToNow } from 'date-fns'
import { ja } from 'date-fns/locale'

function statusColor(status: string) {
  if (status === 'ok') return 'text-emerald-600'
  if (status === 'error') return 'text-red-600'
  return 'text-amber-600'
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'ok') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
  if (status === 'error') return <XCircle className="h-4 w-4 text-red-500" />
  return <AlertTriangle className="h-4 w-4 text-amber-500" />
}

function MetricBadge({ metric }: { metric: WorkerMetric }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
      <span className="font-medium">{metric.name}</span>
      <span className="tabular-nums">
        {typeof metric.value === 'number'
          ? Number.isInteger(metric.value) ? metric.value : metric.value.toFixed(2)
          : metric.value}
        {metric.unit && <span className="ml-0.5 text-gray-500">{metric.unit}</span>}
      </span>
    </span>
  )
}

function CheckCard({ check }: { check: WorkerCheck }) {
  const ago = (() => {
    try {
      return formatDistanceToNow(new Date(check.reported_at), { addSuffix: true, locale: ja })
    } catch {
      return check.reported_at
    }
  })()

  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm flex flex-col gap-2 ${
      check.status === 'error' ? 'border-red-200' :
      check.status === 'ok' ? 'border-gray-200' : 'border-amber-200'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusIcon status={check.status} />
          <span className="text-sm font-medium text-gray-800 truncate">{check.check_name}</span>
        </div>
        <span className={`text-xs font-semibold shrink-0 ${statusColor(check.status)}`}>
          {check.status.toUpperCase()}
        </span>
      </div>

      {check.message && (
        <p className="text-xs text-gray-500 leading-relaxed">{check.message}</p>
      )}

      {check.error && (
        <p className="text-xs text-red-500 font-mono break-all">{check.error}</p>
      )}

      {check.metrics.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {check.metrics.map((m, i) => <MetricBadge key={i} metric={m} />)}
        </div>
      )}

      <div className="flex items-center gap-1 text-xs text-gray-400 mt-auto pt-1">
        <Clock className="h-3 w-3" />
        {ago}
      </div>
    </div>
  )
}

export default function WorkerStatus() {
  const [selectedServerId, setSelectedServerId] = useState<string>('')

  const { data: serversData } = useQuery({ queryKey: ['servers'], queryFn: getServers })
  const servers: Server[] = serversData?.items ?? []

  const { data: checks = [], isLoading } = useQuery<WorkerCheck[]>({
    queryKey: ['worker-checks', selectedServerId],
    queryFn: () => getWorkerChecks(selectedServerId || undefined),
    refetchInterval: 30_000,
  })

  const workerServers = servers.filter(s =>
    checks.some(c => c.server_id === s.id) ||
    (selectedServerId && s.id === selectedServerId)
  )

  const grouped = (selectedServerId
    ? servers.filter(s => s.id === selectedServerId)
    : workerServers
  ).map(s => ({
    server: s,
    checks: checks.filter(c => c.server_id === s.id),
  })).filter(g => g.checks.length > 0)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">ワーカー状態</h1>
          <p className="text-sm text-gray-500 mt-0.5">ops-worker から送信された最新のチェック結果</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-600">サーバ:</label>
        <select
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={selectedServerId}
          onChange={e => setSelectedServerId(e.target.value)}
        >
          <option value="">すべて</option>
          {servers.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <span className="text-sm text-gray-400">{checks.length} 件</span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        </div>
      ) : checks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Activity className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-sm">チェック結果がありません</p>
          <p className="text-xs mt-1">ops-worker が接続されると自動的に表示されます</p>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ server, checks: sChecks }) => (
            <section key={server.id}>
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-indigo-500" />
                {server.name}
                <span className="text-gray-400 font-normal">({server.host})</span>
                <span className="text-xs font-normal text-gray-400">{sChecks.length} チェック</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {sChecks.map(c => (
                  <CheckCard key={c.id} check={c} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
