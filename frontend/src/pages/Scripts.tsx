import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Copy, Check, Code2, Lock, ChevronDown, ChevronRight } from 'lucide-react'
import { getScripts, createScript, updateScript, deleteScript, getBuiltinMetrics, getJobTemplates } from '../api/client'
import type { Script, ScriptCreate, ScriptLanguage, UnifiedScript, BuiltinMetricDef, JobTemplate } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

const LANG_COLORS: Record<ScriptLanguage, string> = {
  bash:   'bg-green-100 text-green-700 border-green-200',
  python: 'bg-blue-100 text-blue-700 border-blue-200',
  ruby:   'bg-red-100 text-red-700 border-red-200',
}
const LANG_LABELS: Record<ScriptLanguage, string> = {
  bash: 'Bash', python: 'Python', ruby: 'Ruby',
}
const PLACEHOLDERS: Record<ScriptLanguage, string> = {
  bash: '#!/bin/bash\n# スクリプトの内容を入力してください\necho "Hello"',
  python: '#!/usr/bin/env python3\n# スクリプトの内容を入力してください\nprint("Hello")',
  ruby: '#!/usr/bin/env ruby\n# スクリプトの内容を入力してください\nputs "Hello"',
}
const EMPTY_FORM: ScriptCreate = { name: '', description: '', language: 'bash', content: '' }

function contentExecutionType(content: string): 'remote' | 'local' {
  return content.includes('# @run_locally') ? 'local' : 'remote'
}

/** ビルトインメトリクスを UnifiedScript に変換 */
function builtinToUnified(b: BuiltinMetricDef): UnifiedScript {
  return {
    id: `builtin:${b.key}`,
    name: b.label,
    description: b.unit ? `単位: ${b.unit}` : undefined,
    language: 'bash',
    content: b.command_template ?? '# TLS直接接続（コマンドなし）',
    source: 'builtin_metric',
    readonly: true,
    execution_type: b.execution_type ?? 'remote',
    builtinKey: b.key,
    unit: b.unit,
    configFields: b.config_fields,
  }
}

/** ジョブテンプレートを UnifiedScript に変換 */
function templateToUnified(t: JobTemplate): UnifiedScript {
  return {
    id: `template:${t.id}`,
    name: t.name,
    description: t.description,
    language: t.language as ScriptLanguage,
    content: t.script,
    source: 'job_template',
    readonly: true,
    execution_type: contentExecutionType(t.script),
    category: t.category,
    defaultCron: t.default_cron,
    defaultTimeout: t.default_timeout,
  }
}

/** ユーザースクリプトを UnifiedScript に変換 */
function userToUnified(s: Script): UnifiedScript {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    language: s.language,
    content: s.content,
    source: 'user',
    readonly: false,
    execution_type: contentExecutionType(s.content),
  }
}

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      title="コピー"
      className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
    >
      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
    </button>
  )
}

// ── ScriptCard ────────────────────────────────────────────────────────────────

function ScriptCard({
  script,
  onEdit,
  onDelete,
}: {
  script: UnifiedScript
  onEdit?: () => void
  onDelete?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const lang = LANG_LABELS[script.language as ScriptLanguage] ?? script.language

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex-1 flex items-center gap-3 text-left min-w-0"
        >
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            : <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />}
          <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded border ${LANG_COLORS[script.language as ScriptLanguage] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
            {lang}
          </span>
          <div className="min-w-0 flex-1">
            <span className="font-medium text-gray-900 text-sm">{script.name}</span>
            {script.description && (
              <span className="ml-2 text-xs text-gray-400">{script.description}</span>
            )}
          </div>
          {script.readonly && (
            <span className="shrink-0 flex items-center gap-1 text-[10px] text-gray-400">
              <Lock className="h-3 w-3" /> 読み取り専用
            </span>
          )}
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <CopyButton text={script.content} />
          {!script.readonly && onEdit && (
            <button onClick={onEdit} title="編集"
              className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {!script.readonly && onDelete && (
            <button onClick={onDelete} title="削除"
              className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
          <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap break-all max-h-64 overflow-y-auto leading-relaxed">
            {script.content}
          </pre>
          {script.configFields && script.configFields.length > 0 && (
            <div className="mt-2 text-[11px] text-gray-500">
              設定可能フィールド: {script.configFields.map(f => `${f.label} (デフォルト: ${f.default})`).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── ScriptModal ───────────────────────────────────────────────────────────────

function ScriptModal({
  initial,
  onSave,
  onClose,
}: {
  initial: Script | null
  onSave: (data: ScriptCreate) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<ScriptCreate>(
    initial
      ? { name: initial.name, description: initial.description ?? '', language: initial.language, content: initial.content }
      : EMPTY_FORM
  )
  const [saving, setSaving] = useState(false)

  const setField = <K extends keyof ScriptCreate>(k: K, v: ScriptCreate[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try { await onSave(form); onClose() }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl flex flex-col max-h-[90vh]">
        <div className="border-b border-gray-100 px-6 py-4 shrink-0">
          <h2 className="font-semibold text-gray-900">{initial ? 'スクリプトを編集' : 'スクリプトを追加'}</h2>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">名前 *</label>
              <input required className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.name} onChange={e => setField('name', e.target.value)} placeholder="ディスク使用量チェック" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">説明</label>
              <input className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.description ?? ''} onChange={e => setField('description', e.target.value)} placeholder="スクリプトの用途" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">言語</label>
              <div className="flex gap-3">
                {(['bash', 'python', 'ruby'] as ScriptLanguage[]).map(lang => (
                  <label key={lang} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="language" value={lang} checked={form.language === lang}
                      onChange={() => setField('language', lang)} />
                    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${LANG_COLORS[lang]}`}>{LANG_LABELS[lang]}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">スクリプト内容 *</label>
              <textarea required rows={14}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                placeholder={PLACEHOLDERS[form.language]}
                value={form.content} onChange={e => setField('content', e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4 shrink-0">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">キャンセル</button>
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

// ── Section ───────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  system: 'システム', network: 'ネットワーク', process: 'プロセス', log: 'ログ', example: 'サンプル',
}

function Section({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 mb-3 w-full text-left group">
        {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
        <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
        {badge && <span className="text-xs text-gray-400">{badge}</span>}
      </button>
      {open && <div className="space-y-2">{children}</div>}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Scripts() {
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Script | null>(null)

  const { data: userScripts = [] } = useQuery<Script[]>({
    queryKey: ['scripts'],
    queryFn: () => getScripts(),
  })
  const { data: builtins = [] } = useQuery<BuiltinMetricDef[]>({
    queryKey: ['builtin-metrics'],
    queryFn: getBuiltinMetrics,
    staleTime: Infinity,
  })
  const { data: templates = [] } = useQuery<JobTemplate[]>({
    queryKey: ['job-templates'],
    queryFn: getJobTemplates,
    staleTime: Infinity,
  })

  const createMut = useMutation({
    mutationFn: createScript,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scripts'] }),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ScriptCreate> }) => updateScript(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scripts'] }),
  })
  const deleteMut = useMutation({
    mutationFn: deleteScript,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scripts'] }),
  })

  const handleSave = async (data: ScriptCreate) => {
    if (editTarget) await updateMut.mutateAsync({ id: editTarget.id, data })
    else await createMut.mutateAsync(data)
  }

  const handleDelete = (s: Script) => {
    if (!confirm(`スクリプト「${s.name}」を削除しますか？`)) return
    deleteMut.mutate(s.id)
  }

  // Job templates grouped by category
  const templateCategories = Array.from(new Set(templates.map(t => t.category)))

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">スクリプト管理</h1>
          <p className="text-sm text-gray-500 mt-0.5">ジョブ・モニタリングで使用するスクリプトを管理します</p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setModalOpen(true) }}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" /> スクリプト追加
        </button>
      </div>

      {/* User scripts */}
      <Section title="ユーザー定義スクリプト" badge={`${userScripts.length} 件`}>
        {userScripts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 rounded-xl border border-dashed border-gray-200 text-gray-400">
            <Code2 className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">スクリプトがありません</p>
            <p className="text-xs mt-1">「スクリプト追加」から作成してください</p>
          </div>
        ) : (
          userScripts.map(s => {
            const u = userToUnified(s)
            return (
              <ScriptCard key={s.id} script={u}
                onEdit={() => { setEditTarget(s); setModalOpen(true) }}
                onDelete={() => handleDelete(s)} />
            )
          })
        )}
      </Section>

      {/* Builtin metrics */}
      <Section title="ビルトインメトリクス" badge={`${builtins.length} 件 · 読み取り専用`}>
        {builtins.map(b => (
          <ScriptCard key={b.key} script={builtinToUnified(b)} />
        ))}
      </Section>

      {/* Job templates by category */}
      <Section title="ジョブテンプレート" badge={`${templates.length} 件 · 読み取り専用`}>
        {templateCategories.map(cat => (
          <div key={cat}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 mt-3">
              {CATEGORY_LABELS[cat] ?? cat}
            </p>
            {templates.filter(t => t.category === cat).map(t => (
              <ScriptCard key={t.id} script={templateToUnified(t)} />
            ))}
          </div>
        ))}
      </Section>

      {/* Modal */}
      {modalOpen && (
        <ScriptModal
          initial={editTarget}
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  )
}
