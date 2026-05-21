import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Pencil, Play, ToggleLeft, ToggleRight, Loader2, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getJobs, createJob, updateJob, deleteJob, triggerJob, toggleJob, getServers } from '../api/client'
import type { Job, JobCreate, Server, UnifiedScript, JobTemplateConfigField } from '../types'
import StatusBadge from '../components/StatusBadge'
import { ScriptPickerButton } from '../components/ScriptPicker'
import { formatDistanceToNow } from 'date-fns'
import { ja } from 'date-fns/locale'

const emptyForm: JobCreate = {
  name: '', description: '', server_id: '',
  type: 'command', command: '', log_path: '',
  cron_expr: '0 * * * *', enabled: true, timeout_sec: 30,
}

/** {key} プレースホルダーをコンフィグ値で置換する（{{}} はリテラルブレース） */
function resolveTemplateScript(template: string, config: Record<string, string>, defaults: Record<string, string>): string {
  return template
    .replace(/\{\{/g, '\x00')
    .replace(/\}\}/g, '\x01')
    .replace(/\{(\w+)\}/g, (_, key) => config[key] ?? defaults[key] ?? `{${key}}`)
    .replace(/\x00/g, '{')
    .replace(/\x01/g, '}')
}

const CRON_PRESETS = [
  { label: '毎時', value: '0 * * * *' },
  { label: '毎日0時', value: '0 0 * * *' },
  { label: '毎日9時', value: '0 9 * * *' },
  { label: '毎5分', value: '*/5 * * * *' },
  { label: '毎15分', value: '*/15 * * * *' },
  { label: '毎週月曜', value: '0 9 * * 1' },
]

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Jobs() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['jobs'], queryFn: () => getJobs() })
  const { data: servers } = useQuery({ queryKey: ['servers'], queryFn: getServers })
  const [modal, setModal] = useState<{ open: boolean; editing?: Job }>({ open: false })
  const [form, setForm] = useState<JobCreate>(emptyForm)
  const [triggering, setTriggering] = useState<string | null>(null)
  // テンプレートのパラメータ設定用
  const [templateConfigFields, setTemplateConfigFields] = useState<JobTemplateConfigField[]>([])
  const [templateConfig, setTemplateConfig] = useState<Record<string, string>>({})
  const [templateBaseScript, setTemplateBaseScript] = useState<string>('')
  const [selectedScriptName, setSelectedScriptName] = useState<string | null>(null)

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
    setTemplateConfigFields([])
    setTemplateConfig({})
    setTemplateBaseScript('')
    setModal({ open: true })
  }
  const openEdit = (j: Job) => {
    setForm({
      name: j.name, description: j.description ?? '', server_id: j.server_id,
      type: j.type, command: j.command ?? '', log_path: j.log_path ?? '',
      cron_expr: j.cron_expr, enabled: j.enabled, timeout_sec: j.timeout_sec,
    })
    setTemplateConfigFields([])
    setTemplateConfig({})
    setTemplateBaseScript('')
    setModal({ open: true, editing: j })
  }
  const closeModal = () => { setModal({ open: false }); setSelectedScriptName(null) }

  const handleScriptSelect = (s: UnifiedScript) => {
    setSelectedScriptName(s.name)
    if (s.source === 'job_template') {
      const fields = s.templateConfigFields ?? []
      const defaults = Object.fromEntries(fields.map(f => [f.key, f.default]))
      const resolvedCommand = resolveTemplateScript(s.content, defaults, defaults)
      setTemplateConfigFields(fields)
      setTemplateConfig(defaults)
      setTemplateBaseScript(s.content)
      setForm(f => ({
        ...f,
        type: 'command',
        command: resolvedCommand,
        cron_expr: s.defaultCron ?? f.cron_expr,
        timeout_sec: s.defaultTimeout ?? f.timeout_sec,
      }))
    } else {
      setTemplateConfigFields([])
      setTemplateConfig({})
      setTemplateBaseScript('')
      setForm(f => ({ ...f, command: s.content }))
    }
  }

  const handleTemplateConfigChange = (key: string, value: string) => {
    const newConfig = { ...templateConfig, [key]: value }
    setTemplateConfig(newConfig)
    const defaults = Object.fromEntries(templateConfigFields.map(f => [f.key, f.default]))
    const resolvedCommand = resolveTemplateScript(templateBaseScript, newConfig, defaults)
    setForm(f => ({ ...f, command: resolvedCommand }))
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
                <th className="px-4 py-3 text-left font-medium text-gray-600">サーバ</th>
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
              <Field label="ジョブ名 *">
                <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="input" placeholder="バックアップ実行" />
              </Field>
              <Field label="説明">
                <input value={form.description ?? ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="input" placeholder="任意の説明" />
              </Field>
              <Field label="対象サーバ *">
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
                  <div className="flex items-center justify-between mb-1.5">
                    {selectedScriptName ? (
                      <span className="flex items-center gap-1.5 text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md px-2 py-1 truncate max-w-[60%]">
                        <span className="shrink-0 text-indigo-400">📄</span>
                        {selectedScriptName}
                      </span>
                    ) : (
                      <span />
                    )}
                    <ScriptPickerButton
                      context="job"
                      onSelect={handleScriptSelect}
                    />
                  </div>

                  {/* テンプレートのパラメータ設定 */}
                  {templateConfigFields.length > 0 && (
                    <div className="mb-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2.5 space-y-2">
                      <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide">パラメータ設定</p>
                      {templateConfigFields.map(cf => (
                        <div key={cf.key}>
                          <label className="block text-xs font-medium text-gray-700 mb-0.5">{cf.label}</label>
                          {cf.type === 'select' && cf.options ? (
                            <select
                              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                              value={templateConfig[cf.key] ?? cf.default}
                              onChange={e => handleTemplateConfigChange(cf.key, e.target.value)}
                            >
                              {cf.options.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              placeholder={cf.default || `例: ${cf.label}`}
                              value={templateConfig[cf.key] ?? cf.default}
                              onChange={e => handleTemplateConfigChange(cf.key, e.target.value)}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <textarea
                    required
                    rows={4}
                    value={form.command ?? ''}
                    onChange={e => setForm((f: JobCreate) => ({ ...f, command: e.target.value }))}
                    className="input font-mono text-xs resize-y"
                    placeholder="/opt/scripts/backup.sh"
                  />
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
