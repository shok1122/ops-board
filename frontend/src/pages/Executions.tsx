import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Loader2, ChevronRight } from 'lucide-react'
import { getExecutions } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import { format } from 'date-fns'

const STATUS_FILTERS = [
  { value: '', label: 'すべて' },
  { value: 'success', label: '成功' },
  { value: 'failure', label: '失敗' },
  { value: 'running', label: '実行中' },
  { value: 'timeout', label: 'タイムアウト' },
]

export default function Executions() {
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(0)
  const limit = 30

  const { data, isLoading } = useQuery({
    queryKey: ['executions', { status: statusFilter, offset: page * limit }],
    queryFn: () => getExecutions({ status: statusFilter || undefined, limit, offset: page * limit }),
    refetchInterval: 10_000,
  })

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">実行履歴</h1>

      {/* Filters */}
      <div className="flex gap-2 mb-5">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => { setStatusFilter(f.value); setPage(0) }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === f.value
                ? 'bg-indigo-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">ジョブ名</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">開始時刻</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">所要時間</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">状態</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">トリガー</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data?.items.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">実行履歴はありません</td></tr>
                )}
                {data?.items.map((e) => {
                  const duration = e.finished_at
                    ? Math.round((new Date(e.finished_at).getTime() - new Date(e.started_at).getTime()) / 1000)
                    : null
                  return (
                    <tr key={e.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{e.job_name ?? e.job_id}</td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {format(new Date(e.started_at), 'MM/dd HH:mm:ss')}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {duration != null ? `${duration}秒` : '—'}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={e.status} size="sm" /></td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {e.triggered_by === 'manual' ? '手動' : 'スケジュール'}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/executions/${e.id}`}
                          className="flex items-center gap-1 text-xs text-indigo-600 hover:underline justify-end"
                        >
                          ログ <ChevronRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data && data.total > limit && (
            <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
              <span>全 {data.total} 件</span>
              <div className="flex gap-2">
                <button
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
                >
                  前へ
                </button>
                <span className="px-3 py-1.5">{page + 1} / {Math.ceil(data.total / limit)}</span>
                <button
                  disabled={(page + 1) * limit >= data.total}
                  onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
                >
                  次へ
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
