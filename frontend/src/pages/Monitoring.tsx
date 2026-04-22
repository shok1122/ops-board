import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { Plus, Pencil, Trash2, Play, Power, AlertTriangle, TrendingUp, ScrollText, X } from 'lucide-react'
import {
  getServers,
  getMonitors,
  getBuiltinMetrics,
  createMonitor,
  updateMonitor,
  deleteMonitor,
  toggleMonitor,
  triggerMonitor,
  getMonitorData,
  getMonitorLastLog,
} from '../api/client'
import type {
  Server,
  Monitor,
  MonitorCreate,
  MonitorDataPoint,
  MonitorLastLog,
  BuiltinMetricDef,
  BuiltinMetricKey,
  UnifiedScript,
} from '../types'
import { ScriptPickerButton } from '../components/ScriptPicker'

// ── Chart card ────────────────────────────────────────────────────────────────

function MonitorChart({ monitor }: { monitor: Monitor }) {
  const { data: points = [] } = useQuery<MonitorDataPoint[]>({
    queryKey: ['monitor-data', monitor.id],
    queryFn: () => getMonitorData(monitor.id, 24, 500),
    refetchInterval: monitor.interval_minutes * 60 * 1000,
  })

  const chartData = points.map(p => ({
    time: new Date(p.collected_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
    value: p.value ?? null,
    error: p.error,
  }))

  const latest = points.length > 0 ? points[points.length - 1] : null
  const latestValue = latest?.value
  const hasError = latest?.error
  const unit = monitor.unit ?? ''

  const warn = monitor.warning_threshold
  const crit = monitor.critical_threshold

  let statusColor = 'text-gray-700'
  let areaColor = '#6366f1'
  if (latestValue != null) {
    if (crit != null && latestValue >= crit) {
      statusColor = 'text-red-600'
      areaColor = '#ef4444'
    } else if (warn != null && latestValue >= warn) {
      statusColor = 'text-amber-600'
      areaColor = '#f59e0b'
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{monitor.name}</p>
          {monitor.description && (
            <p className="text-xs text-gray-400 truncate">{monitor.description}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          {hasError ? (
            <span className="text-xs text-red-500 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> エラー
            </span>
          ) : latestValue != null ? (
            <span className={`text-lg font-bold tabular-nums ${statusColor}`}>
              {latestValue}<span className="text-xs font-normal ml-0.5">{unit}</span>
            </span>
          ) : (
            <span className="text-xs text-gray-400">データなし</span>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="h-24">
        {chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400">
            まだデータがありません
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 2, right: 0, left: -30, bottom: 0 }}>
              <defs>
                <linearGradient id={`grad-${monitor.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={areaColor} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={areaColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ fontSize: 11, padding: '4px 8px' }}
                formatter={(v: number) => [`${v.toFixed(2)} ${unit}`, monitor.name]}
                labelStyle={{ fontSize: 10 }}
              />
              {warn != null && (
                <ReferenceLine y={warn} stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1} />
              )}
              {crit != null && (
                <ReferenceLine y={crit} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1} />
              )}
              <Area
                type="monotone"
                dataKey="value"
                stroke={areaColor}
                strokeWidth={1.5}
                fill={`url(#grad-${monitor.id})`}
                dot={false}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Footer */}
      <div className="text-xs text-gray-400 flex items-center gap-2">
        <span>毎 {formatInterval(monitor.interval_minutes)}</span>
        {latest && (
          <span>最終: {new Date(latest.collected_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span>
        )}
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type IntervalUnit = 'min' | 'hour' | 'day'

function toMinutes(value: number, unit: IntervalUnit): number {
  if (unit === 'hour') return value * 60
  if (unit === 'day')  return value * 1440
  return value
}

function fromMinutes(minutes: number): { value: number; unit: IntervalUnit } {
  if (minutes >= 1440 && minutes % 1440 === 0) return { value: minutes / 1440, unit: 'day' }
  if (minutes >= 60   && minutes % 60   === 0) return { value: minutes / 60,   unit: 'hour' }
  return { value: minutes, unit: 'min' }
}

function formatInterval(minutes: number): string {
  const { value, unit } = fromMinutes(minutes)
  if (unit === 'day')  return `${value}日`
  if (unit === 'hour') return `${value}時間`
  return `${value}分`
}

// ── Log modal ─────────────────────────────────────────────────────────────────

function MonitorLogModal({ monitor, onClose }: { monitor: Monitor; onClose: () => void }) {
  const { data, isLoading } = useQuery<MonitorLastLog>({
    queryKey: ['monitor-last-log', monitor.id],
    queryFn: () => getMonitorLastLog(monitor.id),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl flex flex-col max-h-[80vh]">
        <div className="border-b border-gray-100 px-6 py-4 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900">実行ログ（直近1回）</h2>
            <p className="text-xs text-gray-400 mt-0.5">{monitor.name}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6 flex flex-col gap-3 overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
            </div>
          ) : (
            <>
              {data?.last_log_at ? (
                <p className="text-xs text-gray-400 shrink-0">
                  収集時刻: {new Date(data.last_log_at).toLocaleString('ja-JP')}
                </p>
              ) : (
                <p className="text-xs text-gray-400 shrink-0">まだ収集されていません</p>
              )}
              <pre className="bg-gray-950 text-gray-100 text-xs font-mono rounded-xl p-4 overflow-auto whitespace-pre-wrap break-words flex-1 min-h-[4rem]">
                {data?.log || '(出力なし)'}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────

const EMPTY_FORM: MonitorCreate = {
  name: '',
  description: '',
  server_id: '',
  interval_minutes: 5,
  enabled: true,
  metric_type: 'custom',
  builtin_key: undefined,
  builtin_config: {},
  custom_script: '',
  unit: '',
  warning_threshold: undefined,
  critical_threshold: undefined,
}

/** 編集時にビルトインの表示名を引く */
function resolveInitialScriptName(initial: MonitorCreate | null, builtins: BuiltinMetricDef[]): string {
  if (!initial) return ''
  if (initial.metric_type === 'builtin') {
    return builtins.find(b => b.key === initial.builtin_key)?.label ?? initial.builtin_key ?? ''
  }
  return initial.custom_script ? 'カスタムスクリプト' : ''
}

function MonitorModal({
  servers,
  builtins,
  initial,
  onSave,
  onClose,
}: {
  servers: Server[]
  builtins: BuiltinMetricDef[]
  initial: MonitorCreate | null
  onSave: (data: MonitorCreate) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<MonitorCreate>(initial ?? EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [intervalState, setIntervalState] = useState(() =>
    fromMinutes((initial ?? EMPTY_FORM).interval_minutes)
  )
  const [selectedScriptName, setSelectedScriptName] = useState(() =>
    resolveInitialScriptName(initial, builtins)
  )

  const selectedBuiltin = form.metric_type === 'builtin'
    ? builtins.find(b => b.key === form.builtin_key)
    : undefined

  const handleIntervalChange = (value: number, unit: IntervalUnit) => {
    setIntervalState({ value, unit })
    setField('interval_minutes', toMinutes(value, unit))
  }

  const setField = <K extends keyof MonitorCreate>(k: K, v: MonitorCreate[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  /** スクリプトピッカーで選択されたとき */
  const handleScriptSelect = (s: UnifiedScript) => {
    setSelectedScriptName(s.name)
    if (s.source === 'builtin_metric' && s.builtinKey) {
      setForm(f => ({
        ...f,
        metric_type: 'builtin',
        builtin_key: s.builtinKey as BuiltinMetricKey,
        builtin_config: {},
        custom_script: '',
        unit: f.unit || s.unit || '',
      }))
    } else {
      setForm(f => ({
        ...f,
        metric_type: 'custom',
        builtin_key: undefined,
        builtin_config: {},
        custom_script: s.content,
      }))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload: MonitorCreate = {
        ...form,
        unit: form.unit || (selectedBuiltin?.unit ?? ''),
        builtin_config: form.metric_type === 'builtin' ? (form.builtin_config || {}) : undefined,
        custom_script: form.metric_type === 'custom' ? form.custom_script : undefined,
        builtin_key: form.metric_type === 'builtin' ? form.builtin_key : undefined,
        warning_threshold: form.warning_threshold || undefined,
        critical_threshold: form.critical_threshold || undefined,
      }
      await onSave(payload)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const hasScript = form.metric_type === 'builtin' ? !!form.builtin_key : !!form.custom_script

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="font-semibold text-gray-900">
            {initial ? 'モニターを編集' : 'モニターを追加'}
          </h2>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-5 space-y-4 text-sm max-h-[75vh] overflow-y-auto">

            {/* Script selector */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">スクリプト *</label>
              <div className="flex items-center gap-2">
                <div className={`flex-1 rounded-lg border px-3 py-2 text-sm truncate ${hasScript ? 'border-gray-200 text-gray-800' : 'border-dashed border-gray-300 text-gray-400'}`}>
                  {selectedScriptName || (hasScript ? (form.metric_type === 'builtin' ? form.builtin_key : 'カスタムスクリプト') : '未選択')}
                </div>
                <ScriptPickerButton
                  context="monitor"
                  onSelect={handleScriptSelect}
                  label="選択"
                />
              </div>

              {/* Builtin config fields */}
              {selectedBuiltin?.configurable && selectedBuiltin.config_fields?.map(cf => (
                <div key={cf.key} className="mt-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1">{cf.label}</label>
                  {cf.type === 'select' && cf.options ? (
                    <select
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      value={(form.builtin_config ?? {})[cf.key] ?? cf.default}
                      onChange={e => {
                        const val = e.target.value
                        const cfg = { ...(form.builtin_config ?? {}), [cf.key]: val }
                        setField('builtin_config', cfg)
                        // select オプションに unit が定義されていれば form.unit を自動更新
                        const opt = cf.options!.find(o => o.value === val)
                        if (opt?.unit !== undefined) {
                          setField('unit', opt.unit)
                        }
                      }}
                    >
                      {cf.options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder={cf.default}
                      value={(form.builtin_config ?? {})[cf.key] ?? ''}
                      onChange={e => {
                        const cfg = { ...(form.builtin_config ?? {}), [cf.key]: e.target.value || cf.default }
                        setField('builtin_config', cfg)
                      }}
                    />
                  )}
                </div>
              ))}

              {/* Custom script editor */}
              {form.metric_type === 'custom' && (
                <div className="mt-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    スクリプト内容
                    <span className="ml-1 font-normal text-gray-400">(標準出力に数値1つを出力)</span>
                  </label>
                  <textarea
                    required
                    rows={5}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder={"#!/bin/bash\nps -o rss= -p $(pgrep nginx | head -1) | awk '{printf \"%.1f\", $1/1024}'"}
                    value={form.custom_script ?? ''}
                    onChange={e => setField('custom_script', e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">名前 *</label>
              <input required
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.name} onChange={e => setField('name', e.target.value)} />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">説明</label>
              <input
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.description ?? ''} onChange={e => setField('description', e.target.value)} />
            </div>

            {/* Server */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">サーバー *</label>
              <select required
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.server_id} onChange={e => setField('server_id', e.target.value)}>
                <option value="">選択してください</option>
                {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            {/* Unit */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">単位</label>
              <input
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder={selectedBuiltin?.unit ?? '例: %, MB, GB'}
                value={form.unit ?? ''} onChange={e => setField('unit', e.target.value)} />
            </div>

            {/* Interval */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">収集間隔</label>
              <div className="flex gap-2">
                <input type="number" min={1}
                  max={intervalState.unit === 'day' ? 31 : intervalState.unit === 'hour' ? 744 : 44640}
                  className="w-28 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={intervalState.value}
                  onChange={e => handleIntervalChange(Math.max(1, Number(e.target.value)), intervalState.unit)} />
                <select className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={intervalState.unit} onChange={e => handleIntervalChange(intervalState.value, e.target.value as IntervalUnit)}>
                  <option value="min">分</option>
                  <option value="hour">時間</option>
                  <option value="day">日</option>
                </select>
                <span className="self-center text-xs text-gray-400">= {form.interval_minutes}分</span>
              </div>
            </div>

            {/* Thresholds */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">警告閾値</label>
                <input type="number" step="any"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="なし" value={form.warning_threshold ?? ''}
                  onChange={e => setField('warning_threshold', e.target.value ? Number(e.target.value) : undefined)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">危険閾値</label>
                <input type="number" step="any"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="なし" value={form.critical_threshold ?? ''}
                  onChange={e => setField('critical_threshold', e.target.value ? Number(e.target.value) : undefined)} />
              </div>
            </div>

            {/* Enabled */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.enabled} onChange={e => setField('enabled', e.target.checked)} />
              <span className="text-sm">有効にする</span>
            </label>
          </div>

          <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
              キャンセル
            </button>
            <button type="submit" disabled={saving}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Monitoring() {
  const qc = useQueryClient()
  const [selectedServerId, setSelectedServerId] = useState<string>('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Monitor | null>(null)
  const [logMonitor, setLogMonitor] = useState<Monitor | null>(null)

  const { data: serversData } = useQuery({ queryKey: ['servers'], queryFn: getServers })
  const servers = serversData?.items ?? []

  const { data: monitors = [], isLoading } = useQuery<Monitor[]>({
    queryKey: ['monitors', selectedServerId],
    queryFn: () => getMonitors(selectedServerId || undefined),
    refetchInterval: 30_000,
  })

  const { data: builtins = [] } = useQuery<BuiltinMetricDef[]>({
    queryKey: ['builtin-metrics'],
    queryFn: getBuiltinMetrics,
  })

  const createMut = useMutation({
    mutationFn: createMonitor,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitors'] }),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<MonitorCreate> }) =>
      updateMonitor(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitors'] }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteMonitor,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitors'] }),
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => toggleMonitor(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitors'] }),
  })

  const triggerMut = useMutation({
    mutationFn: triggerMonitor,
    onSuccess: (_d, id) => {
      setTimeout(() => qc.invalidateQueries({ queryKey: ['monitor-data', id] }), 3000)
    },
  })

  const handleSave = async (data: MonitorCreate) => {
    if (editTarget) {
      await updateMut.mutateAsync({ id: editTarget.id, data })
    } else {
      await createMut.mutateAsync(data)
    }
  }

  const handleDelete = (m: Monitor) => {
    if (!confirm(`モニター「${m.name}」を削除しますか？`)) return
    deleteMut.mutate(m.id)
  }

  // Group monitors by server
  const grouped = servers
    .filter(s => !selectedServerId || s.id === selectedServerId)
    .map(s => ({
      server: s,
      monitors: monitors.filter(m => m.server_id === s.id),
    }))
    .filter(g => g.monitors.length > 0 || !selectedServerId)

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">モニタリング</h1>
          <p className="text-sm text-gray-500 mt-0.5">定期的なメトリクス収集とグラフ表示</p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setModalOpen(true) }}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" />
          モニターを追加
        </button>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-600">サーバー:</label>
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
        <span className="text-sm text-gray-400">{monitors.length} 件</span>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        </div>
      ) : monitors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <TrendingUp className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-sm">モニターがありません</p>
          <p className="text-xs mt-1">「モニターを追加」から作成してください</p>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ server, monitors: sMonitors }) => (
            <section key={server.id}>
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-indigo-500" />
                {server.name}
                <span className="text-gray-400 font-normal">({server.host})</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {sMonitors.map(m => (
                  <div key={m.id} className="relative group">
                    <MonitorChart monitor={m} />
                    {/* Overlay actions */}
                    <div className="absolute top-2 right-2 hidden group-hover:flex items-center gap-1 bg-white/90 rounded-lg shadow border border-gray-100 px-1 py-0.5">
                      <button
                        title="今すぐ収集"
                        onClick={() => triggerMut.mutate(m.id)}
                        className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-indigo-600"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                      <button
                        title="実行ログ"
                        onClick={() => setLogMonitor(m)}
                        className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-indigo-600"
                      >
                        <ScrollText className="h-3.5 w-3.5" />
                      </button>
                      <button
                        title={m.enabled ? '無効にする' : '有効にする'}
                        onClick={() => toggleMut.mutate({ id: m.id, enabled: !m.enabled })}
                        className={`p-1 rounded hover:bg-gray-100 ${m.enabled ? 'text-green-500 hover:text-gray-500' : 'text-gray-400 hover:text-green-500'}`}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                      <button
                        title="編集"
                        onClick={() => { setEditTarget(m); setModalOpen(true) }}
                        className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-indigo-600"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        title="削除"
                        onClick={() => handleDelete(m)}
                        className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {/* Disabled badge */}
                    {!m.enabled && (
                      <div className="absolute inset-0 rounded-xl bg-gray-100/60 flex items-center justify-center pointer-events-none">
                        <span className="text-xs font-medium text-gray-500 bg-white px-2 py-0.5 rounded-full border border-gray-200">無効</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Edit modal */}
      {modalOpen && (
        <MonitorModal
          servers={servers}
          builtins={builtins}
          initial={editTarget}
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
        />
      )}

      {/* Log modal */}
      {logMonitor && (
        <MonitorLogModal
          monitor={logMonitor}
          onClose={() => setLogMonitor(null)}
        />
      )}
    </div>
  )
}
