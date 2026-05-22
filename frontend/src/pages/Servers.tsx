import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Pencil, Loader2, Server, AlertCircle, Copy, Check, KeyRound, Activity, PlayCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import {
  getServers, createServer, updateServer, deleteServer,
  getAllLatestStatuses,
  getServerJobResults,
  getWorkerChecks,
} from '../api/client'
import type { Server as ServerType, ServerCreate, ServerStatus, WorkerCheck } from '../types'
import { JobResultCard } from '../components/JobResultView'
import { formatDistanceToNow } from 'date-fns'
import { ja } from 'date-fns/locale'

const emptyForm: ServerCreate = { name: '', host: '', generate_worker_token: true }

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}日 ${h}時間`
  if (h > 0) return `${h}時間 ${m}分`
  return `${m}分`
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
      <div className="flex items-center gap-2 text-red-600 text-sm py-2 px-3 bg-red-50 rounded-lg">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{status.error}</span>
      </div>
    )
  }

  const agentLabel = [
    status.agent_version,
    status.go_version && `Go ${status.go_version}`,
    status.arch,
  ].filter(Boolean).join(' / ')

  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {status.hostname && <span className="text-gray-500 w-full font-medium">{status.hostname}</span>}
      {status.os_info && <span className="text-gray-400 w-full">{status.os_info}</span>}
      {agentLabel && <Chip label="Agent" value={agentLabel} />}
      {status.uptime_seconds != null && <Chip label="稼働" value={formatUptime(status.uptime_seconds)} />}
      <span className="text-gray-400 ml-auto">{new Date(status.checked_at).toLocaleString('ja-JP')} 時点</span>
    </div>
  )
}

function WorkerCheckCard({ c }: { c: WorkerCheck }) {
  const accentBar =
    c.status === 'ok' ? 'bg-emerald-400' :
    c.status === 'error' ? 'bg-red-400' :
    'bg-amber-400'
  const statusBadge =
    c.status === 'ok'
      ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' :
    c.status === 'error'
      ? 'bg-red-100 text-red-700 ring-1 ring-red-200' :
      'bg-amber-100 text-amber-700 ring-1 ring-amber-200'
  const messageBorder =
    c.status === 'ok' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' :
    c.status === 'error' ? 'border-red-300 bg-red-50 text-red-800' :
    'border-amber-300 bg-amber-50 text-amber-800'

  const labelEntries = Object.entries(c.labels ?? {})

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Status accent bar */}
      <div className={`h-1 ${accentBar}`} />

      {/* Header */}
      <div className="px-3 pt-2.5 pb-2">
        <div className="text-sm text-gray-400 mb-1.5" title={new Date(c.reported_at).toLocaleString('ja-JP')}>
          {formatDistanceToNow(new Date(c.reported_at), { addSuffix: true, locale: ja })}
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="font-semibold text-gray-900 text-base leading-snug">{c.check_name}</span>
            {c.check_type && (
              <span className="ml-1.5 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-sm text-gray-500 align-middle">
                {c.check_type}
              </span>
            )}
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-sm font-medium ${statusBadge}`}>
            {c.status}
          </span>
        </div>
      </div>

      {/* Message */}
      {c.message && (
        <div className={`mx-3 mb-2 border-l-2 pl-2 pr-2 py-1 rounded-r-md text-base ${messageBorder}`}>
          {c.message}
        </div>
      )}

      {/* Metrics */}
      {c.metrics.length > 0 && (
        <div className="px-3 pb-2 grid grid-cols-2 gap-1.5">
          {c.metrics.map((m, i) => (
            <div key={i} className="rounded-lg bg-gray-50 px-2.5 py-1.5">
              <div className="text-sm text-gray-400 truncate mb-0.5">{m.name}</div>
              <div className="text-lg font-semibold text-gray-800 tabular-nums leading-none">
                {Number.isInteger(m.value) ? m.value : m.value.toFixed(2)}
                <span className="text-base font-normal text-gray-400 ml-0.5">{m.unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Labels */}
      {labelEntries.length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          {labelEntries.map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-sm text-gray-600 ring-1 ring-gray-200">
              <span className="text-gray-400">{k}</span>
              <span className="text-gray-300">·</span>
              <span>{v}</span>
            </span>
          ))}
        </div>
      )}

      {/* Error */}
      {c.error && (
        <div className="mx-3 mb-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-base text-red-700 ring-1 ring-red-200">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <span>{c.error}</span>
        </div>
      )}
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
      <div className="flex items-center gap-1.5 text-sm font-medium text-gray-500 mb-2">
        <PlayCircle className="h-4 w-4" />
        ジョブ実行結果
      </div>
      <div className="columns-1 sm:columns-2 lg:columns-3 gap-2">
        {data.map(r => (
          <div key={r.job_id} className="break-inside-avoid mb-2">
            <JobResultCard result={r} />
          </div>
        ))}
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700"
    >
      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
    </button>
  )
}

function WorkerCredentials({ server }: { server: ServerType }) {
  return (
    <div className="mt-3">
      <div className="flex items-center gap-1.5 text-sm font-medium text-gray-500 mb-1.5">
        <KeyRound className="h-4 w-4" />
        ワーカー接続情報
      </div>
      {server.has_worker_token ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-gray-500 w-14 shrink-0">Worker ID</span>
            <code className="flex-1 font-mono text-gray-800 truncate">{server.id}</code>
            <CopyButton text={server.id} />
          </div>
          <p className="text-gray-400 text-xs pt-1">トークンを再生成するにはサーバ編集から行えます。</p>
        </div>
      ) : (
        <p className="text-sm text-gray-400">ワーカートークンが未設定です。サーバ編集からトークンを生成できます。</p>
      )}
    </div>
  )
}

function WorkerReports({ serverId }: { serverId: string }) {
  const { data: checks = [] } = useQuery<WorkerCheck[]>({
    queryKey: ['worker-checks', serverId],
    queryFn: () => getWorkerChecks(serverId),
    refetchInterval: 30_000,
  })

  if (checks.length === 0) return null

  return (
    <div className="mt-3">
      <div className="flex items-center gap-1.5 text-sm font-medium text-gray-500 mb-2">
        <Activity className="h-4 w-4" />
        ワーカーレポート
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {checks.map(c => <WorkerCheckCard key={c.check_name} c={c} />)}
      </div>
    </div>
  )
}

export default function Servers() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({ queryKey: ['servers'], queryFn: getServers })
  const [modal, setModal] = useState<{ open: boolean; editing?: ServerType }>({ open: false })
  const [form, setForm] = useState<ServerCreate>(emptyForm)
  const [regenOnEdit, setRegenOnEdit] = useState(false)
  const [newServerToken, setNewServerToken] = useState<{ id: string; name: string; token: string } | null>(null)
  const [statusData, setStatusData] = useState<Record<string, { data?: ServerStatus }>>({})
  const { data: latestStatuses } = useQuery({
    queryKey: ['server-statuses'],
    queryFn: getAllLatestStatuses,
    refetchInterval: 60_000,
  })

  useEffect(() => {
    if (!latestStatuses) return
    setStatusData(prev => {
      const next = { ...prev }
      for (const s of latestStatuses) {
        next[s.server_id] = { data: s }
      }
      return next
    })
  }, [latestStatuses])

  const createMut = useMutation({
    mutationFn: createServer,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      closeModal()
      if (created.worker_token) {
        setNewServerToken({ id: created.id, name: created.name, token: created.worker_token })
      }
    },
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ServerCreate> & { regenerate_token?: boolean } }) => updateServer(id, data),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      closeModal()
      if (updated.worker_token) {
        setNewServerToken({ id: updated.id, name: updated.name, token: updated.worker_token })
      }
    },
  })
  const deleteMut = useMutation({
    mutationFn: deleteServer,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['servers'] }),
  })

  const openCreate = () => { setForm(emptyForm); setModal({ open: true }) }
  const openEdit = (s: ServerType) => {
    setForm({ name: s.name, host: s.host })
    setRegenOnEdit(false)
    setModal({ open: true, editing: s })
  }
  const closeModal = () => setModal({ open: false })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (modal.editing) {
      updateMut.mutate({ id: modal.editing.id, data: { ...form, regenerate_token: regenOnEdit } })
    } else {
      createMut.mutate(form)
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">サーバ管理</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" /> サーバ追加
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-amber-500" /></div>
      ) : (
        <div className="space-y-4">
          {data?.items.length === 0 && (
            <div className="rounded-xl border border-gray-200 bg-white py-12 text-center text-gray-400">
              サーバが登録されていません
            </div>
          )}
          {data?.items.map((s) => {
            const ss = statusData[s.id]
            return (
              <div key={s.id} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center gap-4 px-5 py-4 border-b border-gray-100">
                  <Server className="h-5 w-5 text-indigo-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold text-gray-900">{s.name}</span>
                    {s.host && (
                      <div className="text-xs text-gray-400">{s.host}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => navigate(`/jobs?create=true&server_id=${s.id}`)}
                      className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100"
                    >
                      <Plus className="h-3.5 w-3.5" /> ジョブ追加
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

                <div className="px-5 py-4 bg-gray-50/50">
                  <WorkerCredentials server={s} />
                  <WorkerReports serverId={s.id} />
                  <ServerJobResults serverId={s.id} />
                  {ss?.data && <StatusSummary status={ss.data} />}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Server add/edit Modal */}
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="font-semibold text-gray-900">
                {modal.editing ? 'サーバ編集' : 'サーバ追加'}
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <Field label="表示名 *">
                <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="input" placeholder="本番サーバ" />
              </Field>
              <Field label="ホスト名 *">
                <input required value={form.host ?? ''} onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                  className="input" placeholder="example.com" />
              </Field>
              {!modal.editing ? (
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.generate_worker_token ?? true}
                    onChange={e => setForm(f => ({ ...f, generate_worker_token: e.target.checked }))}
                    className="rounded border-gray-300 text-indigo-600"
                  />
                  ワーカートークンを生成する
                </label>
              ) : (
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={regenOnEdit}
                    onChange={e => setRegenOnEdit(e.target.checked)}
                    className="rounded border-gray-300 text-indigo-600"
                  />
                  ワーカートークンを再生成する
                </label>
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

      {/* Worker token reveal Modal */}
      {newServerToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-6 py-4 flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-indigo-500" />
              <h2 className="font-semibold text-gray-900">ワーカー接続情報</h2>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                <span className="font-medium text-gray-800">{newServerToken.name}</span> のワーカートークンです。
                ops-worker の設定ファイルに記入してください。
              </p>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                このトークンは今後表示されません。必ずコピーして保管してください。
              </div>

              <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
                <CredentialRow label="Worker ID" value={newServerToken.id} />
                <CredentialRow label="Token" value={newServerToken.token} secret />
                <CredentialRow label="Endpoint" value={`${window.location.origin}/api/v1`} />
              </div>
            </div>
            <div className="flex justify-end border-t border-gray-100 px-6 py-4">
              <button onClick={() => setNewServerToken(null)} className="btn-primary">
                確認しました
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CredentialRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState(!secret)
  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-500 text-xs w-20 shrink-0">{label}</span>
      <code className={`flex-1 font-mono text-xs text-gray-800 break-all ${!revealed ? 'blur-sm select-none' : ''}`}>
        {value}
      </code>
      {secret && (
        <button onClick={() => setRevealed(r => !r)} className="text-xs text-indigo-600 hover:underline shrink-0">
          {revealed ? '隠す' : '表示'}
        </button>
      )}
      <button
        onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
        className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 shrink-0"
      >
        {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
      </button>
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
