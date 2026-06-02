import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Radio, CheckCircle2, XCircle, AlertTriangle, Heart } from 'lucide-react'
import { getServers, getWorkerLogs } from '../api/client'
import type { Server, WorkerIngestLog } from '../types'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'

const LIMIT_OPTIONS = [50, 100, 200, 500]

function StatusBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-gray-300">—</span>
  if (status === 'ok') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
      <CheckCircle2 className="h-3.5 w-3.5" /> ok
    </span>
  )
  if (status === 'error') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
      <XCircle className="h-3.5 w-3.5" /> error
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
      <AlertTriangle className="h-3.5 w-3.5" /> {status}
    </span>
  )
}

function LogTypeBadge({ type }: { type: string }) {
  if (type === 'health') return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
      <Heart className="h-3 w-3" /> health
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
      <Radio className="h-3 w-3" /> report
    </span>
  )
}

function formatReceived(iso: string) {
  try {
    return format(new Date(iso), 'MM/dd HH:mm:ss', { locale: ja })
  } catch {
    return iso
  }
}

export default function WorkerLogs() {
  const [selectedServerId, setSelectedServerId] = useState<string>('')
  const [limit, setLimit] = useState(50)

  const { data: serversData } = useQuery({ queryKey: ['servers'], queryFn: getServers })
  const servers: Server[] = serversData?.items ?? []

  const { data: logs = [], isLoading } = useQuery<WorkerIngestLog[]>({
    queryKey: ['worker-logs', selectedServerId, limit],
    queryFn: () => getWorkerLogs(selectedServerId || undefined, limit),
    refetchInterval: 30_000,
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">ワーカー送信ログ</h1>
        <p className="text-sm text-gray-500 mt-0.5">ops-worker からの送信を受信した履歴（直近 {limit} 件）</p>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
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
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">表示件数:</label>
          <select
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
          >
            {LIMIT_OPTIONS.map(n => (
              <option key={n} value={n}>{n} 件</option>
            ))}
          </select>
        </div>
        <span className="text-sm text-gray-400">{logs.length} 件表示</span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        </div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Radio className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-sm">送信ログがありません</p>
          <p className="text-xs mt-1">ops-worker が接続されると自動的に表示されます</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">受信日時</th>
                <th className="px-4 py-3 text-left">サーバ</th>
                <th className="px-4 py-3 text-left">種別</th>
                <th className="px-4 py-3 text-left">チェック名</th>
                <th className="px-4 py-3 text-left">ステータス</th>
                <th className="px-4 py-3 text-left">メッセージ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 tabular-nums text-gray-500 whitespace-nowrap">
                    {formatReceived(log.received_at)}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-gray-800 whitespace-nowrap">
                    {log.server_name ?? log.server_id}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <LogTypeBadge type={log.log_type} />
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                    {log.check_name ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <StatusBadge status={log.status ?? undefined} />
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 max-w-xs truncate">
                    {log.message ?? <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
