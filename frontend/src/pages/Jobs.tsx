import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Pencil, Play, ToggleLeft, ToggleRight, Loader2, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getJobs, createJob, updateJob, deleteJob, triggerJob, toggleJob, getServers, getJobTemplates } from '../api/client'
import type { Job, JobCreate, Server, JobTemplate } from '../types'
import StatusBadge from '../components/StatusBadge'
import { formatDistanceToNow } from 'date-fns'
import { ja } from 'date-fns/locale'

const emptyForm: JobCreate = {
  name: '', description: '', server_id: '',
  type: 'command', command: '', log_path: '',
  cron_expr: '0 * * * *', enabled: true, timeout_sec: 30,
}

const CRON_PRESETS = [
  { label: '毎時', value: '0 * * * *' },
  { label: '毎日0時', value: '0 0 * * *' },
  { label: '毎日9時', value: '0 9 * * *' },
  { label: '毎5分', value: '*/5 * * * *' },
  { label: '毎15分', value: '*/15 * * * *' },
  { label: '毎週月曜', value: '0 9 * * 1' },
]

const LANG_COLORS: Record<string, string> = {
  bash:   'bg-green-100 text-green-700',
  python: 'bg-blue-100 text-blue-700',
  ruby:   'bg-red-100 text-red-700',
}

const CATEGORY_LABELS: Record<string, string> = {
  system:  'システム',
  network: 'ネットワーク',
  process: 'プロセス',
  log:     'ログ',
  example: 'サンプル',
}

// ── Template selector ─────────────────────────────────────────────────────────

function TemplateSelector({
  templates,
  selectedId,
  onSelect,
}: {
  templates: JobTemplate[]
  selectedId: string | null
  onSelect: (t: JobTemplate) => void
}) {
  const [open, setOpen] = useState(true)

  const categories = Array.from(new Set(templates.map(t => t.category)))

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/40">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-indigo-700"
      >
        <span>システム定義テンプレート</span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="border-t border-indigo-100 px-4 pb-4 pt-3 space-y-4">
          {categories.map(cat => (
            <div key={cat}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {CATEGORY_LABELS[cat] ?? cat}
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {templates.filter(t => t.category === cat).map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onSelect(t)}
                    className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      selectedId === t.id
                        ? 'border-indigo-400 bg-indigo-100'
                        : 'border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-800">{t.name}</span>
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${LANG_COLORS[t.language] ?? 'bg-gray-100 text-gray-600'}`}>
                          {t.language}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{t.description}</p>
                    </div>
                    {selectedId === t.id && (
                      <span className="text-xs text-indigo-600 font-medium shrink-0 mt-0.5">選択中</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Jobs() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['jobs'], queryFn: () => getJobs() })
  const { data: servers } = useQuery({ queryKey: ['servers'], queryFn: getServers })
  const { data: templates = [] } = useQuery<JobTemplate[]>({
    queryKey: ['job-templates'],
    queryFn: getJobTemplates,
    staleTime: Infinity,
  })
  const [modal, setModal] = useState<{ open: boolean; editing?: Job }>({ open: false })
  const [form, setForm] = useState<JobCreate>(emptyForm)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [triggering, setTriggering] = useState<string | null>(null)

  const createMut = useMutation({
    mutationFn: createJob,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jobs'] }); closeModal() },
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<JobCreate> }) => updateJob(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jobs'] }); closeModal() },
  })
  const deleteMut = useMutation({
    mutationFn: deleteJob,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })
  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => toggleJob(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })

  const openCreate = (serverId?: string) => {
    setForm({ ...emptyForm, server_id: serverId ?? servers?.items[0]?.id ?? '' })
    setSelectedTemplateId(null)
    setModal({ open: true })
  }
  const openEdit = (j: Job) => {
    setForm({
      name: j.name, description: j.description ?? '', server_id: j.server_id,
      type: j.type, command: j.command ?? '', log_path: j.log_path ?? '',
      cron_expr: j.cron_expr, enabled: j.enabled, timeout_sec: j.timeout_sec,
    })
    setSelectedTemplateId(null)
    setModal({ open: true, editing: j })
  }
  const closeModal = () => { setModal({ open: false }); setSelectedTemplateId(null) }

  const handleSelectTemplate = (t: JobTemplate) => {
    setSelectedTemplateId(t.id)
    setForm(f => ({
      ...f,
      name: t.name,
      description: t.description,
      type: 'command',
      command: t.command,
      cron_expr: t.default_cron,
      timeout_sec: t.default_timeout,
    }))
  }

  const handleTrigger = async (id: string) => {
    setTriggering(id)
    try {
      await triggerJob(id)
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['jobs'] })
        qc.invalidateQueries({ queryKey: ['executions'] })
      }, 1000)
    } finally {
      setTriggering(null)
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
        <h1 className="text-2xl font-bold text-gray-900">ジョブ管理</h1>
        <button
          onClick={() => openCreate()}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" /> ジョブ追加
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">ジョブ名</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">サーバー</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">種別</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">スケジュール</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">最終実行</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">状態</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data?.items.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">ジョブが登録されていません</td></tr>
              )}
              {data?.items.map((j) => (
                <tr key={j.id} className={`hover:bg-gray-50 ${!j.enabled ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3">
                    <Link to={`/jobs/${j.id}`} className="font-medium text-gray-900 hover:text-indigo-600 flex items-center gap-1">
                      {j.name}
                      <ChevronRight className="h-3 w-3 text-gray-400" />
                    </Link>
                    {j.description && <p className="text-xs text-gray-400 mt-0.5">{j.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{j.server_name}</td>
                  <td className="px-4 py-3">
                    <span className="rounded px-2 py-0.5 bg-gray-100 text-gray-600 text-xs">
                      {j.type === 'command' ? 'コマンド' : 'ログ取得'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{j.cron_expr}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {j.last_run_at
                      ? formatDistanceToNow(new Date(j.last_run_at), { addSuffix: true, locale: ja })
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {j.last_status ? <StatusBadge status={j.last_status} size="sm" /> : <span className="text-xs text-gray-400">未実行</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleTrigger(j.id)}
                        disabled={triggering === j.id}
                        title="今すぐ実行"
                        className="p-1.5 rounded hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 disabled:opacity-50"
                      >
                        {triggering === j.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Play className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() => toggleMut.mutate({ id: j.id, enabled: !j.enabled })}
                        title={j.enabled ? '無効化' : '有効化'}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700"
                      >
                        {j.enabled
                          ? <ToggleRight className="h-4 w-4 text-indigo-500" />
                          : <ToggleLeft className="h-4 w-4" />}
                      </button>
                      <button onClick={() => openEdit(j)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => { if (confirm(`「${j.name}」を削除しますか？`)) deleteMut.mutate(j.id) }}
                        className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="border-b border-gray-100 px-6 py-4 sticky top-0 bg-white z-10">
              <h2 className="font-semibold text-gray-900">
                {modal.editing ? 'ジョブ編集' : 'ジョブ追加'}
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Template selector — create mode only */}
              {!modal.editing && templates.length > 0 && (
                <TemplateSelector
                  templates={templates}
                  selectedId={selectedTemplateId}
                  onSelect={handleSelectTemplate}
                />
              )}

              <Field label="ジョブ名 *">
                <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="input" placeholder="バックアップ実行" />
              </Field>
              <Field label="説明">
                <input value={form.description ?? ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="input" placeholder="任意の説明" />
              </Field>
              <Field label="対象サーバー *">
                <select required value={form.server_id} onChange={e => setForm(f => ({ ...f, server_id: e.target.value }))}
                  className="input">
                  <option value="">-- 選択してください --</option>
                  {servers?.items.map((s: Server) => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
                </select>
              </Field>
              <Field label="種別">
                <div className="flex gap-3">
                  {(['command', 'log_fetch'] as const).map(t => (
                    <label key={t} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="type" value={t} checked={form.type === t}
                        onChange={() => setForm(f => ({ ...f, type: t }))} />
                      <span className="text-sm">{t === 'command' ? 'コマンド実行' : 'ログ取得'}</span>
                    </label>
                  ))}
                </div>
              </Field>
              {form.type === 'command' ? (
                <Field label="コマンド *">
                  <textarea
                    required
                    rows={selectedTemplateId ? 8 : 2}
                    value={form.command ?? ''}
                    onChange={e => setForm(f => ({ ...f, command: e.target.value }))}
                    className="input font-mono text-xs resize-y"
                    placeholder="/opt/scripts/backup.sh"
                  />
                  {selectedTemplateId && (
                    <p className="text-xs text-indigo-600 mt-1">
                      テンプレートのスクリプトが設定されています。スクリプト内のコメントを参考に編集してください。
                    </p>
                  )}
                </Field>
              ) : (
                <Field label="JSONファイルパス *">
                  <input required value={form.log_path ?? ''} onChange={e => setForm(f => ({ ...f, log_path: e.target.value }))}
                    className="input font-mono text-sm" placeholder="/var/lib/myapp/status.json" />
                </Field>
              )}
              <Field label="スケジュール (cron 5フィールド)">
                <div className="flex gap-2 mb-2 flex-wrap">
                  {CRON_PRESETS.map(p => (
                    <button key={p.value} type="button"
                      onClick={() => setForm(f => ({ ...f, cron_expr: p.value }))}
                      className={`rounded px-2.5 py-1 text-xs border transition-colors ${form.cron_expr === p.value ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 hover:bg-gray-50'}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <input value={form.cron_expr} onChange={e => setForm(f => ({ ...f, cron_expr: e.target.value }))}
                  className="input font-mono text-sm" placeholder="0 * * * *" />
                <p className="text-xs text-gray-400 mt-1">例: <code>0 9 * * *</code> = 毎日9時、<code>*/5 * * * *</code> = 5分おき</p>
              </Field>
              <Field label="タイムアウト (秒)">
                <input type="number" min={1} max={3600} value={form.timeout_sec}
                  onChange={e => setForm(f => ({ ...f, timeout_sec: +e.target.value }))} className="input w-32" />
              </Field>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.enabled}
                  onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} className="h-4 w-4 rounded border-gray-300 text-indigo-600" />
                <span className="text-sm text-gray-700">スケジュールを有効化する</span>
              </label>
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
