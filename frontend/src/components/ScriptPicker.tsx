import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, X, BookOpen, Lock } from 'lucide-react'
import { getScripts, getBuiltinMetrics, getJobTemplates } from '../api/client'
import type {
  Script, BuiltinMetricDef, JobTemplate,
  UnifiedScript, ScriptLanguage,
} from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

const LANG_COLORS: Record<ScriptLanguage, string> = {
  bash:   'bg-green-100 text-green-700 border-green-200',
  python: 'bg-blue-100 text-blue-700 border-blue-200',
  ruby:   'bg-red-100 text-red-700 border-red-200',
}
const LANG_LABELS: Record<ScriptLanguage, string> = {
  bash: 'Bash', python: 'Python', ruby: 'Ruby',
}
const CATEGORY_LABELS: Record<string, string> = {
  system: 'システム', network: 'ネットワーク', process: 'プロセス', log: 'ログ', example: 'サンプル',
}

function builtinToUnified(b: BuiltinMetricDef): UnifiedScript {
  return {
    id: `builtin:${b.key}`,
    name: b.label,
    description: b.unit ? `単位: ${b.unit}` : undefined,
    language: 'bash',
    content: b.command_template ?? '# TLS直接接続（コマンドなし）',
    tags: ['ビルトイン', 'メトリクス'],
    source: 'builtin_metric',
    readonly: true,
    builtinKey: b.key,
    unit: b.unit,
    configFields: b.config_fields,
  }
}

function templateToUnified(t: JobTemplate): UnifiedScript {
  return {
    id: `template:${t.id}`,
    name: t.name,
    description: t.description,
    language: t.language as ScriptLanguage,
    content: t.script,
    tags: [t.category, ...t.tags],
    source: 'job_template',
    readonly: true,
    category: t.category,
    defaultCron: t.default_cron,
    defaultTimeout: t.default_timeout,
  }
}

function userToUnified(s: Script): UnifiedScript {
  return {
    id: s.id, name: s.name, description: s.description,
    language: s.language, content: s.content, tags: s.tags,
    source: 'user', readonly: false,
  }
}

// ── Source badge ──────────────────────────────────────────────────────────────

const SOURCE_BADGE: Record<UnifiedScript['source'], { label: string; cls: string }> = {
  builtin_metric: { label: 'ビルトイン', cls: 'bg-violet-100 text-violet-700 border-violet-200' },
  job_template:   { label: 'テンプレート', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  user:           { label: 'ユーザー', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
}

// ── Modal ─────────────────────────────────────────────────────────────────────

/**
 * context:
 *   'monitor' — builtin metrics + user scripts（モニター追加用）
 *   'job'     — job templates + user scripts（ジョブ追加用）
 *   'all'     — 全種類
 */
export type ScriptPickerContext = 'monitor' | 'job' | 'all'

export function ScriptPickerModal({
  context = 'all',
  onSelect,
  onClose,
}: {
  context?: ScriptPickerContext
  onSelect: (script: UnifiedScript) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [filterLang, setFilterLang] = useState<ScriptLanguage | ''>('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data: userScripts = [] } = useQuery<Script[]>({
    queryKey: ['scripts'],
    queryFn: () => getScripts(),
  })
  const { data: builtins = [] } = useQuery<BuiltinMetricDef[]>({
    queryKey: ['builtin-metrics'],
    queryFn: getBuiltinMetrics,
    staleTime: Infinity,
    enabled: context === 'monitor' || context === 'all',
  })
  const { data: templates = [] } = useQuery<JobTemplate[]>({
    queryKey: ['job-templates'],
    queryFn: getJobTemplates,
    staleTime: Infinity,
    enabled: context === 'job' || context === 'all',
  })

  // Merge and sort
  const all: UnifiedScript[] = [
    ...builtins.map(builtinToUnified),
    ...templates.map(templateToUnified),
    ...userScripts.map(userToUnified),
  ]

  const filtered = all.filter(s => {
    const matchLang = !filterLang || s.language === filterLang
    const q = search.toLowerCase()
    const matchSearch = !q
      || s.name.toLowerCase().includes(q)
      || (s.description ?? '').toLowerCase().includes(q)
      || s.tags.some(t => t.toLowerCase().includes(q))
    return matchLang && matchSearch
  })

  const selected = selectedId ? all.find(s => s.id === selectedId) : null

  // Group for display
  const groups: { key: string; label: string; items: UnifiedScript[] }[] = []

  if (context === 'monitor' || context === 'all') {
    const builtinItems = filtered.filter(s => s.source === 'builtin_metric')
    if (builtinItems.length > 0) groups.push({ key: 'builtin', label: 'ビルトインメトリクス', items: builtinItems })
  }
  if (context === 'job' || context === 'all') {
    const tplItems = filtered.filter(s => s.source === 'job_template')
    if (tplItems.length > 0) {
      // group by category
      const cats = Array.from(new Set(tplItems.map(s => s.category ?? '')))
      cats.forEach(cat => {
        const items = tplItems.filter(s => s.category === cat)
        if (items.length > 0) {
          groups.push({ key: `tpl:${cat}`, label: `テンプレート — ${CATEGORY_LABELS[cat] ?? cat}`, items })
        }
      })
    }
  }
  const userItems = filtered.filter(s => s.source === 'user')
  if (userItems.length > 0) groups.push({ key: 'user', label: 'ユーザー定義スクリプト', items: userItems })

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-indigo-500" />
            <h3 className="font-semibold text-gray-900 text-sm">スクリプトを選択</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search + filter */}
        <div className="px-5 py-3 border-b border-gray-100 space-y-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              autoFocus
              className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="名前・説明・タグで検索..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            {(['', 'bash', 'python', 'ruby'] as const).map(lang => (
              <button type="button" key={lang} onClick={() => setFilterLang(lang)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
                  filterLang === lang
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : lang
                      ? `${LANG_COLORS[lang]} hover:opacity-80`
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}>
                {lang ? LANG_LABELS[lang] : 'すべて'}
              </button>
            ))}
          </div>
        </div>

        {/* List + Preview */}
        <div className="flex flex-1 min-h-0">
          {/* Script list */}
          <div className="w-1/2 border-r border-gray-100 overflow-y-auto">
            {groups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                <BookOpen className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-xs">スクリプトが見つかりません</p>
              </div>
            ) : (
              groups.map(g => (
                <div key={g.key}>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                    {g.label}
                  </p>
                  <ul className="divide-y divide-gray-50">
                    {g.items.map(s => {
                      const badge = SOURCE_BADGE[s.source]
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            className={`w-full text-left px-4 py-2.5 hover:bg-indigo-50 transition-colors ${selectedId === s.id ? 'bg-indigo-50' : ''}`}
                            onClick={() => setSelectedId(s.id)}
                          >
                            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                              <span className={`text-[10px] font-medium px-1.5 py-0 rounded border ${LANG_COLORS[s.language as ScriptLanguage]}`}>
                                {LANG_LABELS[s.language as ScriptLanguage] ?? s.language}
                              </span>
                              <span className={`text-[10px] font-medium px-1.5 py-0 rounded border ${badge.cls}`}>
                                {badge.label}
                              </span>
                              {s.readonly && <Lock className="h-2.5 w-2.5 text-gray-400" />}
                              <span className="text-sm font-medium text-gray-800 truncate">{s.name}</span>
                            </div>
                            {s.description && (
                              <p className="text-xs text-gray-400 truncate">{s.description}</p>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>

          {/* Preview */}
          <div className="w-1/2 flex flex-col">
            {selected ? (
              <>
                <div className="px-4 py-3 border-b border-gray-100 shrink-0 space-y-1">
                  <p className="text-sm font-medium text-gray-800">{selected.name}</p>
                  {selected.description && <p className="text-xs text-gray-400">{selected.description}</p>}
                  {selected.unit && (
                    <p className="text-xs text-gray-500">単位: <span className="font-medium">{selected.unit}</span></p>
                  )}
                  {selected.configFields && selected.configFields.length > 0 && (
                    <p className="text-xs text-indigo-600">
                      設定可能: {selected.configFields.map(f => f.label).join(', ')}
                    </p>
                  )}
                  {selected.defaultCron && (
                    <p className="text-xs text-gray-500">デフォルト cron: <code className="font-mono">{selected.defaultCron}</code></p>
                  )}
                </div>
                <pre className="flex-1 overflow-y-auto px-4 py-3 text-[11px] font-mono text-gray-700 whitespace-pre-wrap leading-relaxed bg-gray-50">
                  {selected.content}
                </pre>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-xs">
                左のリストからスクリプトを選択してください
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-gray-100 px-5 py-3 shrink-0">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            キャンセル
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => { if (selected) { onSelect(selected); onClose() } }}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            このスクリプトを使用
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Button ────────────────────────────────────────────────────────────────────

export function ScriptPickerButton({
  context,
  onSelect,
  label = 'ライブラリから選択',
}: {
  context?: ScriptPickerContext
  onSelect: (script: UnifiedScript) => void
  label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
      >
        <BookOpen className="h-3.5 w-3.5" />
        {label}
      </button>
      {open && (
        <ScriptPickerModal context={context} onSelect={onSelect} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
