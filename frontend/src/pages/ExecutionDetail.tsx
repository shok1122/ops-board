import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Loader2, Terminal, LayoutList } from 'lucide-react'
import { getExecution } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import LogViewer from '../components/LogViewer'
import { JobResultView } from '../components/JobResultView'
import type { JobResultOutput } from '../types'
import { format } from 'date-fns'

export default function ExecutionDetail() {
  const { executionId } = useParams<{ executionId: string }>()
  const [view, setView] = useState<'parsed' | 'raw'>('parsed')

  const { data: exec, isLoading } = useQuery({
    queryKey: ['executions', executionId],
    queryFn: () => getExecution(executionId!),
    enabled: !!executionId,
    refetchInterval: (q) => q.state.data?.status === 'running' ? 3000 : false,
  })

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    )
  }

  if (!exec) return null

  const duration = exec.finished_at
    ? Math.round((new Date(exec.finished_at).getTime() - new Date(exec.started_at).getTime()) / 1000)
    : null

  // parsed_result is stored as a JobResultOutput JSON object
  const jobOutput: JobResultOutput | null = (() => {
    if (!exec.parsed_result || exec.parsed_result.length === 0) return null
    const first = exec.parsed_result[0] as unknown
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      return first as JobResultOutput
    }
    return null
  })()
  const hasParsed = jobOutput !== null
  const hasRaw = !!exec.stdout || !!exec.stderr

  return (
    <div className="p-8">
      <Link
        to={`/jobs/${exec.job_id}`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> ジョブ詳細に戻る
      </Link>

      {/* Header */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 mb-1">{exec.job_name ?? '実行詳細'}</h1>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-500">
              <span>開始: <strong>{format(new Date(exec.started_at), 'yyyy/MM/dd HH:mm:ss')}</strong></span>
              {exec.finished_at && (
                <span>終了: <strong>{format(new Date(exec.finished_at), 'yyyy/MM/dd HH:mm:ss')}</strong></span>
              )}
              {duration != null && <span>所要時間: <strong>{duration}秒</strong></span>}
              {exec.exit_code != null && <span>終了コード: <code className="bg-gray-100 px-1 rounded">{exec.exit_code}</code></span>}
              <span>トリガー: <strong>{exec.triggered_by === 'manual' ? '手動' : 'スケジュール'}</strong></span>
            </div>
          </div>
          <StatusBadge status={exec.status} />
        </div>
      </div>

      {/* Log output */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-3">
          <h2 className="font-medium text-gray-900">出力ログ</h2>
          {hasParsed && hasRaw && (
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              <button
                onClick={() => setView('parsed')}
                className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${view === 'parsed' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <LayoutList className="h-3.5 w-3.5" /> 結果
              </button>
              <button
                onClick={() => setView('raw')}
                className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${view === 'raw' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <Terminal className="h-3.5 w-3.5" /> RAW
              </button>
            </div>
          )}
        </div>
        <div className="p-4">
          {exec.status === 'running' && (
            <div className="flex items-center gap-2 text-sm text-blue-600 mb-4">
              <Loader2 className="h-4 w-4 animate-spin" /> 実行中…
            </div>
          )}
          {view === 'parsed' && hasParsed && jobOutput ? (
            <JobResultView output={jobOutput} />
          ) : (
            <div className="space-y-4">
              {exec.stdout && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">stdout</p>
                  <LogViewer rawOutput={exec.stdout} maxHeight="40vh" />
                </div>
              )}
              {exec.stderr && (
                <div>
                  <p className="text-xs font-medium text-red-500 mb-1">stderr</p>
                  <LogViewer rawOutput={exec.stderr} maxHeight="20vh" />
                </div>
              )}
              {!exec.stdout && !exec.stderr && (
                <LogViewer maxHeight="20vh" />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
