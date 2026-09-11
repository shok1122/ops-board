import React, { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  createAlertRule, deleteAlertRule, getAlertRules, getAlerts, getWorkerChecks, updateAlertRule,
} from '../api/client'
import type {
  Alert, AlertCondition, AlertConditionGroup, AlertOperator, AlertRule, AlertSeverity,
} from '../types'
import { SEVERITY_STYLES, SeverityBadge } from './AlertCard'

const OPERATORS: AlertOperator[] = ['>', '>=', '<', '<=', '==', '!=']

/** 判定式を「A かつ B または C」の形の日本語に整形する */
export function describeGroups(groups: AlertConditionGroup[]): string {
  const parts = groups.map(g => {
    const text = g.conditions.map(describeCondition).join(' かつ ')
    return groups.length > 1 && g.conditions.length > 1 ? `(${text})` : text
  })
  return parts.join(' または ')
}

function describeCondition(c: AlertCondition): string {
  const target = c.check_name ? `${c.check_name}.${c.metric_name}` : c.metric_name
  return `${target} ${c.operator} ${c.threshold}`
}

// ── 編集フォーム ──────────────────────────────────────────────────────────────

type ConditionForm = {
  check_name: string
  metric_name: string
  operator: AlertOperator
  threshold: string
}

type RuleForm = {
  name: string
  severity: AlertSeverity
  message: string
  enabled: boolean
  groups: { conditions: ConditionForm[] }[]
}

const emptyCondition = (): ConditionForm => ({
  check_name: '', metric_name: '', operator: '>', threshold: '',
})

const emptyForm = (): RuleForm => ({
  name: '', severity: 'warning', message: '', enabled: true,
  groups: [{ conditions: [emptyCondition()] }],
})

const toForm = (rule: AlertRule): RuleForm => ({
  name: rule.name,
  severity: rule.severity,
  message: rule.message ?? '',
  enabled: rule.enabled,
  groups: rule.groups.map(g => ({
    conditions: g.conditions.map(c => ({
      check_name: c.check_name ?? '',
      metric_name: c.metric_name,
      operator: c.operator,
      threshold: String(c.threshold),
    })),
  })),
})

function AlertRuleModal({
  serverId, rule, onClose,
}: {
  serverId: string
  rule?: AlertRule
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<RuleForm>(() => (rule ? toForm(rule) : emptyForm()))
  const [error, setError] = useState<string | null>(null)

  // 実際に受信済みのメトリクス名を入力補完の候補として提示する
  const { data: checks = [] } = useQuery({
    queryKey: ['worker-checks', serverId],
    queryFn: () => getWorkerChecks(serverId),
  })
  const checkNames = useMemo(
    () => Array.from(new Set(checks.map(c => c.check_name))).sort(),
    [checks],
  )
  const metricsByCheck = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const c of checks) {
      map[c.check_name] = Array.from(new Set(c.metrics.map(m => m.name))).sort()
    }
    return map
  }, [checks])
  const allMetricNames = useMemo(
    () => Array.from(new Set(checks.flatMap(c => c.metrics.map(m => m.name)))).sort(),
    [checks],
  )

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['alert-rules', serverId] })
    qc.invalidateQueries({ queryKey: ['alerts'] })
  }

  const saveMut = useMutation({
    mutationFn: (payload: {
      name: string; severity: AlertSeverity; message: string | null
      enabled: boolean; groups: AlertConditionGroup[]
    }) => rule
      ? updateAlertRule(rule.id, payload)
      : createAlertRule({ ...payload, server_id: serverId }),
    onSuccess: () => { invalidate(); onClose() },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : '保存に失敗しました')
    },
  })

  const updateCondition = (gi: number, ci: number, patch: Partial<ConditionForm>) => {
    setForm(f => ({
      ...f,
      groups: f.groups.map((g, i) => i !== gi ? g : {
        conditions: g.conditions.map((c, j) => j !== ci ? c : { ...c, ...patch }),
      }),
    }))
  }

  const addCondition = (gi: number) => setForm(f => ({
    ...f,
    groups: f.groups.map((g, i) => i !== gi ? g : { conditions: [...g.conditions, emptyCondition()] }),
  }))

  const removeCondition = (gi: number, ci: number) => setForm(f => {
    const groups = f.groups
      .map((g, i) => i !== gi ? g : { conditions: g.conditions.filter((_, j) => j !== ci) })
      .filter(g => g.conditions.length > 0)
    return { ...f, groups: groups.length > 0 ? groups : [{ conditions: [emptyCondition()] }] }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const groups: AlertConditionGroup[] = []
    for (const g of form.groups) {
      const conditions: AlertCondition[] = []
      for (const c of g.conditions) {
        const metricName = c.metric_name.trim()
        if (!metricName) {
          setError('メトリクス名を入力してください')
          return
        }
        const threshold = Number(c.threshold)
        if (c.threshold.trim() === '' || Number.isNaN(threshold)) {
          setError(`「${metricName}」の閾値には数値を入力してください`)
          return
        }
        conditions.push({
          metric_name: metricName,
          operator: c.operator,
          threshold,
          check_name: c.check_name.trim() || null,
        })
      }
      if (conditions.length > 0) groups.push({ conditions })
    }
    if (groups.length === 0) {
      setError('条件を1つ以上設定してください')
      return
    }

    saveMut.mutate({
      name: form.name.trim(),
      severity: form.severity,
      message: form.message.trim() || null,
      enabled: form.enabled,
      groups,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 border-b border-gray-100 bg-white px-6 py-4">
          <h2 className="font-semibold text-gray-900">
            {rule ? 'アラートルール編集' : 'アラートルール追加'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">ルール名 *</label>
              <input
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="input"
                placeholder="メモリ使用率が高い"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">重大度 *</label>
              <div className="flex gap-2">
                {(['error', 'warning'] as AlertSeverity[]).map(sev => {
                  const s = SEVERITY_STYLES[sev]
                  const active = form.severity === sev
                  return (
                    <button
                      key={sev}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, severity: sev }))}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? `${s.card} ${s.title} border-current/30 ring-2 ring-offset-1 ${sev === 'error' ? 'ring-red-300' : 'ring-amber-300'}`
                          : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                      {sev === 'error' ? 'Error（異常）' : 'Warning（警告）'}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">メッセージ</label>
            <input
              value={form.message}
              onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
              className="input"
              placeholder="アラートに表示する補足説明（任意）"
            />
          </div>

          {/* 判定条件 */}
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <label className="text-xs font-medium text-gray-600">判定条件 *</label>
              <span className="text-xs text-gray-400">
                グループ内は AND（かつ）、グループ同士は OR（または）で判定します
              </span>
            </div>

            <datalist id={`checks-${serverId}`}>
              {checkNames.map(n => <option key={n} value={n} />)}
            </datalist>
            <datalist id={`metrics-all-${serverId}`}>
              {allMetricNames.map(n => <option key={n} value={n} />)}
            </datalist>
            {checkNames.map((cn, i) => (
              <datalist key={cn} id={`metrics-${i}-${serverId}`}>
                {(metricsByCheck[cn] ?? []).map(n => <option key={n} value={n} />)}
              </datalist>
            ))}

            <div className="space-y-2">
              {form.groups.map((group, gi) => (
                <React.Fragment key={gi}>
                  {gi > 0 && (
                    <div className="flex items-center gap-2 py-0.5">
                      <div className="h-px flex-1 bg-gray-200" />
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                        または (OR)
                      </span>
                      <div className="h-px flex-1 bg-gray-200" />
                    </div>
                  )}
                  <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-500">グループ {gi + 1}</span>
                      {form.groups.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setForm(f => ({ ...f, groups: f.groups.filter((_, i) => i !== gi) }))}
                          className="text-xs text-gray-400 hover:text-red-600"
                        >
                          グループを削除
                        </button>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      {group.conditions.map((cond, ci) => {
                        const checkIdx = checkNames.indexOf(cond.check_name.trim())
                        const metricListId = checkIdx >= 0
                          ? `metrics-${checkIdx}-${serverId}`
                          : `metrics-all-${serverId}`
                        return (
                          <div key={ci}>
                            {ci > 0 && (
                              <div className="py-0.5 pl-1 text-xs font-medium text-gray-400">かつ (AND)</div>
                            )}
                            <div className="flex flex-wrap items-center gap-1.5">
                              <input
                                value={cond.check_name}
                                onChange={e => updateCondition(gi, ci, { check_name: e.target.value })}
                                list={`checks-${serverId}`}
                                className="input w-32 py-1.5 text-xs"
                                placeholder="チェック名(任意)"
                                title="レポートの name。空欄なら全チェックが対象"
                              />
                              <input
                                required
                                value={cond.metric_name}
                                onChange={e => updateCondition(gi, ci, { metric_name: e.target.value })}
                                list={metricListId}
                                className="input min-w-0 flex-1 py-1.5 text-xs"
                                placeholder="メトリクス名 (例: usage_percent)"
                              />
                              <select
                                value={cond.operator}
                                onChange={e => updateCondition(gi, ci, { operator: e.target.value as AlertOperator })}
                                className="input w-16 py-1.5 text-center text-xs"
                              >
                                {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
                              </select>
                              <input
                                required
                                type="number"
                                step="any"
                                value={cond.threshold}
                                onChange={e => updateCondition(gi, ci, { threshold: e.target.value })}
                                className="input w-28 py-1.5 text-xs"
                                placeholder="閾値"
                              />
                              <button
                                type="button"
                                onClick={() => removeCondition(gi, ci)}
                                className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500"
                                title="この条件を削除"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => addCondition(gi)}
                      className="mt-2 flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      <Plus className="h-3.5 w-3.5" /> AND条件を追加
                    </button>
                  </div>
                </React.Fragment>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, groups: [...f.groups, { conditions: [emptyCondition()] }] }))}
              className="mt-2 flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              <Plus className="h-3.5 w-3.5" /> OR条件グループを追加
            </button>
          </div>

          <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))}
              className="rounded border-gray-300 text-indigo-600"
            />
            このルールを有効にする
          </label>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button type="button" onClick={onClose} className="btn-secondary">キャンセル</button>
            <button type="submit" disabled={saveMut.isPending} className="btn-primary">
              {saveMut.isPending ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── 一覧 ──────────────────────────────────────────────────────────────────────

function AlertRuleRow({
  rule, firing, onEdit, onDelete, deleting,
}: {
  rule: AlertRule
  firing?: Alert
  onEdit: () => void
  onDelete: () => void
  deleting: boolean
}) {
  const [confirm, setConfirm] = useState(false)
  const s = SEVERITY_STYLES[rule.severity]

  return (
    <div className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
      firing ? s.card : 'border-gray-200 bg-white'
    } ${rule.enabled ? '' : 'opacity-60'}`}>
      <SeverityBadge severity={rule.severity} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-800">{rule.name}</span>
          {firing && (
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${s.badge}`}>
              <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${s.dot}`} />
              発火中
            </span>
          )}
          {!rule.enabled && (
            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">無効</span>
          )}
        </div>
        <div className="truncate font-mono text-xs text-gray-500" title={describeGroups(rule.groups)}>
          {describeGroups(rule.groups)}
        </div>
      </div>

      {confirm ? (
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-xs text-gray-500">削除しますか？</span>
          <button onClick={onDelete} disabled={deleting} className="text-xs font-medium text-red-600 hover:text-red-800">
            {deleting ? '削除中…' : '削除'}
          </button>
          <button onClick={() => setConfirm(false)} className="text-xs text-gray-400 hover:text-gray-600">
            キャンセル
          </button>
        </span>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={onEdit} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="編集">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setConfirm(true)} className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" title="削除">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

export default function AlertRules({ serverId }: { serverId: string }) {
  const qc = useQueryClient()
  const [modal, setModal] = useState<{ open: boolean; rule?: AlertRule }>({ open: false })

  const { data: rules = [] } = useQuery({
    queryKey: ['alert-rules', serverId],
    queryFn: () => getAlertRules(serverId),
  })
  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts', serverId],
    queryFn: () => getAlerts(serverId),
    refetchInterval: 30_000,
  })

  const firingByRule = useMemo(
    () => new Map(alerts.map(a => [a.rule_id, a])),
    [alerts],
  )

  const deleteMut = useMutation({
    mutationFn: deleteAlertRule,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alert-rules', serverId] })
      qc.invalidateQueries({ queryKey: ['alerts'] })
    },
  })

  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center gap-1.5">
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-500">
          <BellRing className="h-4 w-4" />
          アラートルール
        </div>
        {rules.length > 0 && (
          <span className="rounded-full bg-gray-100 px-1.5 text-xs text-gray-500">{rules.length}</span>
        )}
        <button
          onClick={() => setModal({ open: true })}
          className="ml-auto flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100"
        >
          <Plus className="h-3.5 w-3.5" /> ルール追加
        </button>
      </div>

      {rules.length === 0 ? (
        <p className="text-sm text-gray-400">
          メトリクスの閾値から Error / Warning を判定するルールを設定できます。
        </p>
      ) : (
        <div className="space-y-1.5">
          {rules.map(r => (
            <AlertRuleRow
              key={r.id}
              rule={r}
              firing={firingByRule.get(r.id)}
              onEdit={() => setModal({ open: true, rule: r })}
              onDelete={() => deleteMut.mutate(r.id)}
              deleting={deleteMut.isPending && deleteMut.variables === r.id}
            />
          ))}
        </div>
      )}

      {modal.open && (
        <AlertRuleModal
          serverId={serverId}
          rule={modal.rule}
          onClose={() => setModal({ open: false })}
        />
      )}
    </div>
  )
}
