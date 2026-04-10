import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Pencil, Wifi, WifiOff, Loader2, Server, Activity, AlertCircle, Settings } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import {
  getServers, createServer, updateServer, deleteServer, testServer,
  checkServerStatus, getAllLatestStatuses, getServerStatusHistory,
  getServerJobResults, getAppSettings, updateAppSettings,
} from '../api/client'
import type { Server as ServerType, ServerCreate, ServerStatus, ServerJobResult } from '../types'
import { ResultBadge, JobResultView } from '../components/JobResultView'

const emptyForm: ServerCreate = {
  name: '', host: '', port: 22, username: '',
  auth_type: 'password', password: '', private_key: '', passphrase: '',
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}日 ${h}時間`
  if (h > 0) return `${h}時間 ${m}分`
  return `${m}分`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function ServerHistoryCharts({ serverId }: { serverId: string }) {
  const { data: history } = useQuery({
    queryKey: ['server-status-history', serverId],
    queryFn: () => getServerStatusHistory(serverId, 48),
    refetchInterval: 60_000,
  })

  if (!history || history.length < 2) return null

  const chartData = history.map(h => ({
    time: formatTime(h.checked_at),
    cpu: h.cpu_load_1m != null ? Number(h.cpu_load_1m.toFixed(2)) : null,
    memPct: h.mem_total_mb && h.mem_used_mb
      ? Math.round((h.mem_used_mb / h.mem_total_mb) * 100)
      : null,
    diskPct: h.disk_total_gb && h.disk_used_gb
      ? Math.round((h.disk_used_gb / h.disk_total_gb) * 100)
      : null,
  }))

  return (
    <div className="grid grid-cols-3 gap-4 mt-3">
      <MiniChart data={chartData} dataKey="cpu" label="CPU負荷 (1分)" color="#6366f1" unit="" />
      <MiniChart data={chartData} dataKey="memPct" label="メモリ使用率" color="#10b981" unit="%" warnAt={80} />
      <MiniChart data={chartData} dataKey="diskPct" label="ディスク使用率" color="#f59e0b" unit="%" warnAt={80} />
    </div>
  )
}

function MiniChart({
  data, dataKey, label, color, unit, warnAt,
}: {
  data: Record<string, unknown>[]
  dataKey: string
  label: string
  color: string
  unit: string
  warnAt?: number
}) {
  const values = data.map(d => d[dataKey] as number | null).filter(v => v != null) as number[]
  const latest = values[values.length - 1]
  const isWarn = warnAt != null && latest != null && latest > warnAt

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-500">{label}</span>
        {latest != null && (
          <span className={`text-sm font-semibold ${isWarn ? 'text-amber-600' : 'text-gray-800'}`}>
            {latest}{unit}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={60}>
        <AreaChart data={data} margin={{ top: 2, right: 0, left: -30, bottom: 0 }}>
          <defs>
            <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={isWarn ? '#f59e0b' : color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={isWarn ? '#f59e0b' : color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 9 }} domain={[0, 'auto']} />
          <Tooltip
            contentStyle={{ fontSize: 11, padding: '4px 8px' }}
            formatter={(v: number) => [`${v}${unit}`, label]}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={isWarn ? '#f59e0b' : color}
            fill={`url(#grad-${dataKey})`}
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function StatusSummary({ status }: { status: ServerStatus }) {
  if (status.error) {
    return (
      <div className="flex items-center gap-2 text-red-600 text-xs py-2 px-3 bg-red-50 rounded-lg">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        <span>{status.error}</span>
      </div>
    )
  }

  const memPct = status.mem_total_mb && status.mem_used_mb
    ? Math.round((status.mem_used_mb / status.mem_total_mb) * 100) : null
  const diskPct = status.disk_total_gb && status.disk_used_gb
    ? Math.round((status.disk_used_gb / status.disk_total_gb) * 100) : null

  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
      {status.os_info && <span className="text-gray-400 w-full">{status.os_info}</span>}
      {status.cpu_load_1m != null && <Chip label="CPU" value={`${status.cpu_load_1m.toFixed(2)}`} />}
      {memPct != null && <Chip label="メモリ" value={`${status.mem_used_mb}/${status.mem_total_mb}MB (${memPct}%)`} warn={memPct > 80} />}
      {diskPct != null && <Chip label="ディスク" value={`${status.disk_used_gb}/${status.disk_total_gb}GB (${diskPct}%)`} warn={diskPct > 80} />}
      {status.uptime_seconds != null && <Chip label="稼働" value={formatUptime(status.uptime_seconds)} />}
      <span className="text-gray-400 ml-auto">{new Date(status.checked_at).toLocaleString('ja-JP')} 時点</span>
    </div>
  )
}

const STATUS_COLORS = {
  ok:    { text: 'text-emerald-700', dot: 'bg-emerald-400' },
  warn:  { text: 'text-amber-700',   dot: 'bg-amber-400'   },
  error: { text: 'text-red-700',     dot: 'bg-red-400'     },
}

function JobResultCard({ result }: { result: ServerJobResult }) {
  const execStatus = result.execution_status
  const borderColor = result.output?.status === 'error' ? 'border-red-200'
    : result.output?.status === 'warn' ? 'border-amber-200'
    : execStatus === 'failure' || execStatus === 'timeout' ? 'border-red-200'
    : 'border-gray-200'

  return (
    <div className={`rounded-lg border ${borderColor} bg-white p-3 flex flex-col gap-2`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-700 truncate">
          {result.job_name ?? '-'}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {result.output?.status
            ? <ResultBadge status={result.output.status} />
            : execStatus === 'success'
              ? <ResultBadge status="ok" />
              : execStatus === 'failure' || execStatus === 'timeout'
                ? <ResultBadge status="error" />
                : null}
          {result.finished_at && (
            <span className="text-[10px] text-gray-400">
              {new Date(result.finished_at).toLocaleString('ja-JP')}
            </span>
          )}
        </div>
      </div>

      {result.output ? (
        <JobResultView output={result.output} />
      ) : result.raw_stdout ? (
        <pre className="text-[10px] text-gray-500 bg-gray-50 rounded p-2 max-h-20 overflow-auto whitespace-pre-wrap">
          {result.raw_stdout.trim()}
        </pre>
      ) : null}
    </div>
  )
}


function ServerJobResults({ serverId }: { serverId: string }) {
  const { data } = useQuery({
    queryKey: ['server-job-results', serverId],
    queryFn: () => getServerJobResults(serverId),
    refetchInterval: 60_000,
  })
  if (!data || data.length === 0) return null
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-gray-500 mb-2">ジョブ実行結果</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {data.map(r => <JobResultCard key={r.job_id} result={r} />)}
      </div>
    </div>
  )
}

function Chip({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <span>
      <span className="text-gray-400">{label}: </span>
      <span className={warn ? 'text-amber-600 font-medium' : 'text-gray-700'}>{value}</span>
    </span>
  )
}

export default function Servers() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['servers'], queryFn: getServers })
  const [modal, setModal] = useState<{ open: boolean; editing?: ServerType }>({ open: false })
  const [form, setForm] = useState<ServerCreate>(emptyForm)
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; latency_ms?: number; error?: string; testing: boolean }>>({})
  const [statusData, setStatusData] = useState<Record<string, { loading: boolean; data?: ServerStatus }>>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [intervalInput, setIntervalInput] = useState<number>(10)

  const { data: appSettings } = useQuery({ queryKey: ['app-settings'], queryFn: getAppSettings })

  const { data: latestStatuses } = useQuery({
    queryKey: ['server-statuses'],
    queryFn: getAllLatestStatuses,
    refetchInterval: (appSettings?.status_check_interval_minutes ?? 10) * 60 * 1000 || false,
  })

  useEffect(() => {
    if (!latestStatuses) return
    setStatusData(prev => {
      const next = { ...prev }
      for (const s of latestStatuses) {
        next[s.server_id] = { loading: false, data: s }
      }
      return next
    })
  }, [latestStatuses])

  const createMut = useMutation({
    mutationFn: createServer,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['servers'] }); closeModal() },
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ServerCreate> }) => updateServer(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['servers'] }); closeModal() },
  })
  const deleteMut = useMutation({
    mutationFn: deleteServer,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['servers'] }),
  })
  const settingsMut = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['app-settings'] }); setSettingsOpen(false) },
  })

  const openCreate = () => { setForm(emptyForm); setModal({ open: true }) }
  const openEdit = (s: ServerType) => {
    setForm({ name: s.name, host: s.host, port: s.port, username: s.username, auth_type: s.auth_type })
    setModal({ open: true, editing: s })
  }
  const closeModal = () => setModal({ open: false })

  const handleTest = async (id: string) => {
    setTestResults(r => ({ ...r, [id]: { ok: false, testing: true } }))
    try {
      const res = await testServer(id)
      setTestResults(r => ({ ...r, [id]: { ...res, testing: false } }))
    } catch {
      setTestResults(r => ({ ...r, [id]: { ok: false, error: 'リクエスト失敗', testing: false } }))
    }
  }

  const handleCheckNow = async (id: string) => {
    setStatusData(s => ({ ...s, [id]: { ...s[id], loading: true } }))
    try {
      const res = await checkServerStatus(id)
      setStatusData(s => ({ ...s, [id]: { loading: false, data: res } }))
      qc.invalidateQueries({ queryKey: ['server-status-history', id] })
    } catch {
      setStatusData(s => ({ ...s, [id]: { loading: false, data: { id: '', server_id: id, checked_at: '', error: '取得失敗' } } }))
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (modal.editing) {
      updateMut.mutate({ id: modal.editing.id, data: form })
    } else {
      createMut.mutate(form)
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">サーバー管理</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setIntervalInput(appSettings?.status_check_interval_minutes ?? 10); setSettingsOpen(true) }}
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            <Settings className="h-4 w-4" />
            {appSettings
              ? appSettings.status_check_interval_minutes === 0
                ? '自動確認: 無効'
                : `自動確認: ${appSettings.status_check_interval_minutes}分ごと`
              : '設定'}
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" /> サーバー追加
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>
      ) : (
        <div className="space-y-4">
          {data?.items.length === 0 && (
            <div className="rounded-xl border border-gray-200 bg-white py-12 text-center text-gray-400">
              サーバーが登録されていません
            </div>
          )}
          {data?.items.map((s) => {
            const tr = testResults[s.id]
            const ss = statusData[s.id]
            return (
              <div key={s.id} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                {/* Card header */}
                <div className="flex items-center gap-4 px-5 py-4 border-b border-gray-100">
                  <Server className="h-5 w-5 text-indigo-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-gray-900">{s.name}</div>
                    <div className="text-xs text-gray-400">{s.host}:{s.port} · {s.username} ·{' '}
                      <span className="rounded px-1.5 py-0.5 bg-gray-100">{s.auth_type === 'key' ? '秘密鍵' : 'パスワード'}</span>
                    </div>
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleTest(s.id)}
                      disabled={tr?.testing}
                      className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {tr?.testing ? <Loader2 className="h-3 w-3 animate-spin" />
                        : tr?.ok ? <Wifi className="h-3 w-3 text-emerald-500" />
                        : tr && !tr.ok ? <WifiOff className="h-3 w-3 text-red-500" />
                        : <Wifi className="h-3 w-3 text-gray-400" />}
                      {tr?.ok ? `${tr.latency_ms}ms` : tr?.error ? 'エラー' : '接続テスト'}
                    </button>
                    <button
                      onClick={() => handleCheckNow(s.id)}
                      disabled={ss?.loading}
                      className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {ss?.loading
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Activity className="h-3 w-3 text-gray-400" />}
                      今すぐ確認
                    </button>
                    <div className="w-px h-5 bg-gray-200" />
                    <button onClick={() => openEdit(s)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => { if (confirm(`「${s.name}」を削除しますか？`)) deleteMut.mutate(s.id) }}
                      className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Status body — always visible */}
                <div className="px-5 py-4 bg-gray-50/50">
                  {ss?.loading && !ss?.data ? (
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> 取得中…
                    </div>
                  ) : ss?.data ? (
                    <>
                      <StatusSummary status={ss.data} />
                      <ServerHistoryCharts serverId={s.id} />
                    </>
                  ) : (
                    <p className="text-xs text-gray-400">「今すぐ確認」を押すか、自動確認を有効にすると状態が表示されます。</p>
                  )}
                  <ServerJobResults serverId={s.id} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="font-semibold text-gray-900">状態確認の設定</h2>
            </div>
            <div className="p-6 space-y-4">
              <Field label="自動確認の間隔（分）">
                <input
                  type="number" min={0} max={1440}
                  value={intervalInput}
                  onChange={e => setIntervalInput(Number(e.target.value))}
                  className="input"
                />
                <p className="mt-1 text-xs text-gray-400">0 を設定すると自動確認を無効にします</p>
              </Field>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setSettingsOpen(false)} className="btn-secondary">キャンセル</button>
                <button
                  onClick={() => settingsMut.mutate({ status_check_interval_minutes: intervalInput })}
                  disabled={settingsMut.isPending}
                  className="btn-primary"
                >
                  {settingsMut.isPending ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Server add/edit Modal */}
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="font-semibold text-gray-900">
                {modal.editing ? 'サーバー編集' : 'サーバー追加'}
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="表示名 *">
                  <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="input" placeholder="本番サーバー" />
                </Field>
                <Field label="ホスト *">
                  <input required value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                    className="input" placeholder="192.168.1.1" />
                </Field>
                <Field label="ポート">
                  <input type="number" value={form.port} onChange={e => setForm(f => ({ ...f, port: +e.target.value }))}
                    className="input" />
                </Field>
                <Field label="ユーザー名 *">
                  <input required value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                    className="input" placeholder="ubuntu" />
                </Field>
              </div>
              <Field label="認証方式">
                <select value={form.auth_type} onChange={e => setForm(f => ({ ...f, auth_type: e.target.value as 'password' | 'key' }))}
                  className="input">
                  <option value="password">パスワード</option>
                  <option value="key">秘密鍵</option>
                </select>
              </Field>
              {form.auth_type === 'password' ? (
                <Field label="パスワード">
                  <input type="password" value={form.password ?? ''} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    className="input" placeholder="••••••••" />
                </Field>
              ) : (
                <>
                  <Field label="秘密鍵 (PEM形式)">
                    <textarea rows={5} value={form.private_key ?? ''} onChange={e => setForm(f => ({ ...f, private_key: e.target.value }))}
                      className="input font-mono text-xs" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
                  </Field>
                  <Field label="パスフレーズ (任意)">
                    <input type="password" value={form.passphrase ?? ''} onChange={e => setForm(f => ({ ...f, passphrase: e.target.value }))}
                      className="input" />
                  </Field>
                </>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeModal} className="btn-secondary">キャンセル</button>
                <button type="submit" disabled={createMut.isPending || updateMut.isPending} className="btn-primary">
                  {(createMut.isPending || updateMut.isPending) ? '保存中…' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  )
}
