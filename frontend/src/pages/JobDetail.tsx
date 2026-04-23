import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Play, Loader2, ChevronRight } from 'lucide-react'
import { getJob, getExecutions, triggerJob } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import { format } from 'date-fns'

function renderValue(val: unknown): React.ReactNode {
  if (val === null || val === undefined) return <span className="text-gray-300">—</span>
  if (typeof val === 'boolean') return String(val)
  if (typeof val !== 'object') return String(val)
  if (Array.isArray(val)) {
    if (val.length === 0) return <span className="text-gray-300">[]</span>
    if (val.every(v => typeof v !== 'object' || v === null)) return val.join(', ')
    const keys = Array.from(new Set(val.flatMap(item => Object.keys(item as object))))
    return (
      <table className="text-xs border border-gray-200 rounded">
        <thead className="bg-gray-50">
          <tr>{keys.map(k => <th key={k} className="px-2 py-1 text-left font-medium text-gray-500 border-b border-gray-200">{k}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {(val as Record<string, unknown>[]).map((item, i) => (
            <tr key={i}>
              {keys.map(k => <td key={k} className="px-2 py-1 text-gray-700">{renderValue(item[k])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  return <span className="font-mono text-xs">{JSON.stringify(val)}</span>
}

function JsonResultTable({ data }: { data: Record<string, unknown> }) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 border-b border-gray-200 w-32">項目</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 border-b border-gray-200">内容</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {Object.entries(data).map(([key, val]) => (
          <tr key={key}>
            <td className="px-4 py-2 font-mono text-xs text-gray-500 align-top whitespace-nowrap">{key}</td>
            <td className="px-4 py-2 text-sm text-gray-800 align-top">{renderValue(val)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>()
  const qc = useQueryClient()

  const { data: job } = useQuery({
    queryKey: ['jobs', jobId],
    queryFn: () => getJob(jobId!),
    enabled: !!jobId,
  })

  const { data: executions, isLoading } = useQuery({
    queryKey: ['executions', { job_id: jobId }],
    queryFn: () => getExecutions({ job_id: jobId!, limit: 50 }),
    enabled: !!jobId,
    refetchInterval: 10_000,
  })

  const triggerMut = useMutation({
    mutationFn: () => triggerJob(jobId!),
    onSuccess: () => {
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['executions', { job_id: jobId }] })
        qc.invalidateQueries({ queryKey: ['jobs', jobId] })
      }, 1500)
    },
  })

  return (
    <div className="p-8">
      <Link to="/jobs" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-6">
        <ArrowLeft className="h-4 w-4" /> ジョブ一覧に戻る
      </Link>

      {job && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm p-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{job.name}</h1>
              {job.description && <p className="text-sm text-gray-500 mt-1">{job.description}</p>}
              <div className="flex flex-wrap gap-4 mt-3 text-sm text-gray-500">
                <span>サーバー: <strong>{job.server_name}</strong></span>
                <span>種別: <strong>{job.type === 'command' ? 'コマンド' : 'ログ取得'}</strong></span>
                <span className="font-mono">スケジュール: <strong>{job.cron_expr}</strong></span>
                {job.last_status && (
                  <span>最終状態: <StatusBadge status={job.last_status} size="sm" /></span>
                )}
              </div>
              {(job.command || job.log_path) && (
                <p className="mt-2 font-mono text-xs bg-gray-50 rounded px-3 py-2 text-gray-600">
                  {job.command || job.log_path}
                </p>
              )}
            </div>
            <button
              onClick={() => triggerMut.mutate()}
              disabled={triggerMut.isPending}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 flex-shrink-0"
            >
              {triggerMut.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Play className="h-4 w-4" />}
              今すぐ実行
            </button>
          </div>
        </div>
      )}

      {(() => {
        const latest = executions?.items.find(e => e.parsed_result)
        if (!latest?.parsed_result) return null
        return (
          <div className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h2 className="text-base font-semibold text-gray-900">最新の実行結果</h2>
              <span className="text-xs text-gray-400 ml-auto">
                {latest.finished_at ? format(new Date(latest.finished_at), 'MM/dd HH:mm:ss') : ''}
              </span>
            </div>
            <JsonResultTable data={latest.parsed_result as Record<string, unknown>} />
          </div>
        )
      })()}

      <h2 className="text-lg font-semibold text-gray-900 mb-4">実行履歴</h2>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">開始時刻</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">終了時刻</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">所要時間</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">状態</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">トリガー</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">結果</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {executions?.items.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">実行履歴はありません</td></tr>
              )}
              {executions?.items.map((e) => {
                const duration = e.finished_at
                  ? Math.round((new Date(e.finished_at).getTime() - new Date(e.started_at).getTime()) / 1000)
                  : null
                const r = e.parsed_result
                return (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {format(new Date(e.started_at), 'MM/dd HH:mm:ss')}
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {e.finished_at ? format(new Date(e.finished_at), 'MM/dd HH:mm:ss') : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {duration != null ? `${duration}秒` : '—'}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={e.status} size="sm" /></td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {e.triggered_by === 'manual' ? '手動' : 'スケジュール'}
                    </td>
                    <td className="px-4 py-2 align-top">
                      {r
                        ? <JsonResultTable data={r as Record<string, unknown>} />
                        : <span className="text-gray-300">—</span>}
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
      )}
    </div>
  )
}
