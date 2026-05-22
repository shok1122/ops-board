import { Link } from 'react-router-dom'
import type { JobResultOutput, ServerJobResult } from '../types'
import { formatDistanceToNow } from 'date-fns'
import { ja } from 'date-fns/locale'

const STATUS_COLORS = {
  ok:    { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-400' },
  warn:  { bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-400'   },
  error: { bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-400'     },
}

export function ResultBadge({ status }: { status: 'ok' | 'warn' | 'error' }) {
  const c = STATUS_COLORS[status]
  const label = { ok: '正常', warn: '警告', error: '異常' }[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {label}
    </span>
  )
}

export function JobResultCard({ result }: { result: ServerJobResult }) {
  const execStatus = result.execution_status
  const borderColor = result.output?.status === 'error' ? 'border-red-200'
    : result.output?.status === 'warn' ? 'border-amber-200'
    : execStatus === 'failure' || execStatus === 'timeout' ? 'border-red-200'
    : 'border-gray-200'

  const badge = result.output?.status
    ? <ResultBadge status={result.output.status} />
    : execStatus === 'success'
      ? <ResultBadge status="ok" />
      : execStatus === 'failure' || execStatus === 'timeout'
        ? <ResultBadge status="error" />
        : null

  return (
    <div className={`rounded-lg border ${borderColor} bg-white p-3 flex flex-col gap-2`}>
      {/* タイムスタンプ・ジョブ名リンク */}
      <div className="flex items-center justify-between gap-2">
        {result.finished_at && (
          <span className="text-[10px] text-gray-400" title={new Date(result.finished_at).toLocaleString('ja-JP')}>
            {formatDistanceToNow(new Date(result.finished_at), { addSuffix: true, locale: ja })}
          </span>
        )}
        <span className="text-[10px] text-gray-400">
          Job Name: <Link to={`/jobs/${result.job_id}`} className="text-indigo-600 hover:underline">{result.job_name}</Link>
        </span>
      </div>

      {/* title・ステータス・タイムスタンプ */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-gray-800 truncate">
          {result.output?.title ?? result.job_name ?? '-'}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {badge}
        </div>
      </div>

      {result.output ? (
        <JobResultView output={result.output} hideTitle />
      ) : result.raw_stdout ? (
        <pre className="text-[10px] text-gray-500 bg-gray-50 rounded p-2 max-h-20 overflow-auto whitespace-pre-wrap">
          {result.raw_stdout.trim()}
        </pre>
      ) : null}
      {!result.output && result.stderr && (
        <div className="flex items-start gap-1.5 rounded-md bg-red-50 border border-red-200 px-2.5 py-1.5 text-xs text-red-700">
          <span className="shrink-0 mt-0.5">⚠</span>
          <span>{result.stderr.trim()}</span>
        </div>
      )}
    </div>
  )
}

export function JobResultView({ output, hideTitle }: { output: JobResultOutput; hideTitle?: boolean }) {
  return (
    <div className="space-y-3">
      {!hideTitle && (
        <div className="flex items-center gap-3">
          {output.title && <span className="font-medium text-gray-800">{output.title}</span>}
          {output.status && <ResultBadge status={output.status} />}
        </div>
      )}

      {(output.value != null || output.unit) && (
        <div className="text-3xl font-bold text-gray-800">
          {output.value}
          <span className="text-base font-normal text-gray-400 ml-1">{output.unit}</span>
        </div>
      )}

      {output.message && (
        <p className="text-sm text-gray-500">{output.message}</p>
      )}

      {output.items && output.items.length > 0 && (
        <table className="w-full text-sm border-collapse">
          <tbody>
            {output.items.map((item, i) => {
              const c = item.status ? STATUS_COLORS[item.status] : null
              return (
                <tr key={i} className="border-t border-gray-100 first:border-0">
                  <td className="py-1.5 text-gray-500 pr-4 w-1/3">{item.label}</td>
                  <td className={`py-1.5 font-medium ${c ? c.text : 'text-gray-700'}`}>
                    {item.value}
                    {item.unit && <span className="font-normal text-gray-400 ml-1">{item.unit}</span>}
                  </td>
                  {item.status && (
                    <td className="py-1.5 text-right">
                      <span className={`inline-block h-2 w-2 rounded-full ${c!.dot}`} />
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
