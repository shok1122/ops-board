import type { ExecutionStatus } from '../types'

const config: Record<string, { label: string; className: string }> = {
  success: { label: '成功', className: 'bg-emerald-100 text-emerald-800' },
  failure: { label: '失敗', className: 'bg-red-100 text-red-800' },
  running: { label: '実行中', className: 'bg-blue-100 text-blue-800 animate-pulse' },
  timeout: { label: 'タイムアウト', className: 'bg-orange-100 text-orange-800' },
  pending: { label: '待機中', className: 'bg-gray-100 text-gray-600' },
}

interface Props {
  status: ExecutionStatus | string
  size?: 'sm' | 'md'
}

export default function StatusBadge({ status, size = 'md' }: Props) {
  const c = config[status] ?? { label: status, className: 'bg-gray-100 text-gray-600' }
  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${sizeClass} ${c.className}`}>
      {c.label}
    </span>
  )
}
