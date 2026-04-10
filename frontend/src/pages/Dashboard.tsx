import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CheckCircle2, XCircle, Loader2, Calendar, Server, TrendingUp } from 'lucide-react'
import { getDashboardStats } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import { formatDistanceToNow } from 'date-fns'
import { ja } from 'date-fns/locale'

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
