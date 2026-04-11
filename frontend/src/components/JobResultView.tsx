import type { JobResultOutput } from '../types'

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

export function JobResultView({ output }: { output: JobResultOutput }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {output.title && <span className="font-medium text-gray-800">{output.title}</span>}
        {output.status && <ResultBadge status={output.status} />}
      </div>

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
