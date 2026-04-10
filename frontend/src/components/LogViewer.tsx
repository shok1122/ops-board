import type { LogEntry } from '../types'

const levelColors: Record<string, string> = {
  DEBUG: 'text-gray-500',
  INFO: 'text-blue-600',
  WARN: 'text-yellow-600',
  WARNING: 'text-yellow-600',
  ERROR: 'text-red-600',
  CRITICAL: 'text-red-700 font-bold',
  RAW: 'text-gray-700',
}

const levelBg: Record<string, string> = {
  ERROR: 'bg-red-50',
  CRITICAL: 'bg-red-100',
  WARN: 'bg-yellow-50',
  WARNING: 'bg-yellow-50',
}

interface Props {
  entries?: LogEntry[]
  rawOutput?: string
  maxHeight?: string
}

export default function LogViewer({ entries, rawOutput, maxHeight = '400px' }: Props) {
  if (entries && entries.length > 0) {
    return (
      <div
        className="overflow-auto rounded-lg border border-gray-200 bg-gray-950 font-mono text-xs"
        style={{ maxHeight }}
      >
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-gray-900 text-gray-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium w-44">時刻</th>
              <th className="px-3 py-2 text-left font-medium w-20">レベル</th>
              <th className="px-3 py-2 text-left font-medium">メッセージ</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => {
              const level = entry.level?.toUpperCase() ?? 'RAW'
              const color = levelColors[level] ?? 'text-gray-300'
              const bg = levelBg[level] ? '' : ''
              return (
                <tr
                  key={i}
                  className={`border-t border-gray-800 hover:bg-gray-900 ${levelBg[level] ? 'bg-opacity-20' : ''}`}
                >
                  <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">
                    {entry.ts ? formatTs(entry.ts) : '—'}
                  </td>
                  <td className={`px-3 py-1.5 whitespace-nowrap ${color}`}>
                    {entry.level ?? 'RAW'}
                  </td>
                  <td className="px-3 py-1.5 text-gray-200 break-all">
                    {entry.msg ?? ''}
                    {entry.meta && (
                      <span className="ml-2 text-gray-500">
                        {JSON.stringify(entry.meta)}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  if (rawOutput) {
    return (
      <pre
        className="overflow-auto rounded-lg border border-gray-200 bg-gray-950 p-4 font-mono text-xs text-gray-200 whitespace-pre-wrap"
        style={{ maxHeight }}
      >
        {rawOutput}
      </pre>
    )
  }

  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-300 p-8 text-gray-400 text-sm">
      出力なし
    </div>
  )
}

function formatTs(ts: string) {
  try {
    const d = new Date(ts)
    return d.toLocaleString('ja-JP', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch {
    return ts
  }
}
