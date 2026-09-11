import { AlertOctagon, AlertTriangle, Clock } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ja } from 'date-fns/locale'
import type { Alert, AlertMatch, AlertSeverity } from '../types'

/** Error は赤系、Warning は黄系で表現する */
export const SEVERITY_STYLES: Record<AlertSeverity, {
  label: string
  card: string
  accent: string
  badge: string
  title: string
  body: string
  chip: string
  icon: string
  dot: string
}> = {
  error: {
    label: '異常',
    card: 'border-red-200 bg-red-50',
    accent: 'bg-red-500',
    badge: 'bg-red-100 text-red-700 ring-1 ring-red-200',
    title: 'text-red-900',
    body: 'text-red-700',
    chip: 'bg-white/80 text-red-800 ring-1 ring-red-200',
    icon: 'text-red-500',
    dot: 'bg-red-500',
  },
  warning: {
    label: '警告',
    card: 'border-amber-200 bg-amber-50',
    accent: 'bg-amber-400',
    badge: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200',
    title: 'text-amber-900',
    body: 'text-amber-800',
    chip: 'bg-white/80 text-amber-900 ring-1 ring-amber-200',
    icon: 'text-amber-500',
    dot: 'bg-amber-400',
  },
}

const numberFormat = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 })

export function formatMetricValue(value: number): string {
  return numberFormat.format(value)
}

export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const s = SEVERITY_STYLES[severity]
  const Icon = severity === 'error' ? AlertOctagon : AlertTriangle
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.badge}`}>
      <Icon className="h-3 w-3" />
      {s.label}
    </span>
  )
}

/** 発火根拠となったメトリクスの実測値 */
function MatchChip({ match, severity }: { match: AlertMatch; severity: AlertSeverity }) {
  const s = SEVERITY_STYLES[severity]
  return (
    <span className={`inline-flex items-baseline gap-1.5 rounded-lg px-2 py-1 text-xs ${s.chip}`}>
      <span className="opacity-60">{match.check_name}.</span>
      <span className="font-medium">{match.metric_name}</span>
      <span className="font-semibold tabular-nums">{formatMetricValue(match.value)}</span>
      {match.unit && <span className="opacity-60">{match.unit}</span>}
      <span className="opacity-60">({match.operator} {formatMetricValue(match.threshold)})</span>
    </span>
  )
}

export function AlertCard({ alert, showServer = true }: { alert: Alert; showServer?: boolean }) {
  const s = SEVERITY_STYLES[alert.severity]
  const latestReport = alert.matches.reduce<string | null>(
    (acc, m) => (acc == null || new Date(m.reported_at) > new Date(acc) ? m.reported_at : acc),
    null,
  )

  return (
    <div className={`flex overflow-hidden rounded-lg border ${s.card}`}>
      <div className={`w-1 shrink-0 ${s.accent}`} />
      <div className="min-w-0 flex-1 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <SeverityBadge severity={alert.severity} />
            <span className={`truncate font-medium ${s.title}`}>{alert.rule_name}</span>
          </div>
          {alert.since && (
            <span className={`flex shrink-0 items-center gap-1 text-xs ${s.body} opacity-70`}
              title={new Date(alert.since).toLocaleString('ja-JP')}>
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(new Date(alert.since), { locale: ja })}継続
            </span>
          )}
        </div>

        {(showServer || alert.message) && (
          <div className={`mt-1 flex flex-wrap items-center gap-x-2 text-xs ${s.body}`}>
            {showServer && alert.server_name && (
              <span className="opacity-70">{alert.server_name}</span>
            )}
            {showServer && alert.server_name && alert.message && <span className="opacity-40">·</span>}
            {alert.message && <span>{alert.message}</span>}
          </div>
        )}

        <div className="mt-2 flex flex-wrap gap-1">
          {alert.matches.map((m, i) => (
            <MatchChip key={`${m.check_name}-${m.metric_name}-${i}`} match={m} severity={alert.severity} />
          ))}
        </div>

        {latestReport && (
          <div className={`mt-1.5 text-[11px] ${s.body} opacity-60`}
            title={new Date(latestReport).toLocaleString('ja-JP')}>
            最終レポート: {formatDistanceToNow(new Date(latestReport), { addSuffix: true, locale: ja })}
          </div>
        )}
      </div>
    </div>
  )
}
