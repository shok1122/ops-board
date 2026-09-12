import React, { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  createAlertRule, deleteAlertRule, getAlertRules, getAlerts, getJobs, getServerJobResults,
  getWorkerChecks, updateAlertRule,
} from '../api/client'
import type {
  Alert, AlertCondition, AlertConditionGroup, AlertOperator, AlertRule, AlertSeverity, AlertSource,
  JobResultOutput,
} from '../types'
import { SEVERITY_STYLES } from './AlertCard'

const OPERATORS: AlertOperator[] = ['>', '>=', '<', '<=', '==', '!=']
const SEVERITIES: AlertSeverity[] = ['error', 'warning']
const SEVERITY_TEXT: Record<AlertSeverity, string> = { error: 'Error', warning: 'Warning' }
const SOURCES: AlertSource[] = ['metric', 'job']
const SOURCE_TEXT: Record<AlertSource, string> = { metric: 'メトリクス', job: 'ジョブ結果' }

/** ジョブ出力のトップレベルの値を指す予約名（バックエンドの MAIN_VALUE_NAME と対応） */
const JOB_MAIN_VALUE = 'value'

/** 閾値判定に使えるのは数値（数値として読める文字列を含む）だけ */
const isNumeric = (v: unknown): boolean =>
  v != null && v !== '' && typeof v !== 'boolean' && !Number.isNaN(Number(v))

/** ジョブの最新結果から、閾値判定に使える項目名を取り出す */
function jobFieldNames(output?: JobResultOutput): string[] {
  const names: string[] = []
  if (isNumeric(output?.value)) names.push(JOB_MAIN_VALUE)
  for (const item of output?.items ?? []) {
    if (isNumeric(item.value)) names.push(item.label)
  }
  return Array.from(new Set(names))
}

/** 大小を比べる演算子と、Error の閾値が Warning より大きい(1)／小さい(-1)べき向き */
const ORDERED_OPERATORS: Partial<Record<AlertOperator, 1 | -1>> = {
  '>': 1, '>=': 1, '<': -1, '<=': -1,
}

export function thresholdOf(c: AlertCondition, severity: AlertSeverity): number | null | undefined {
  return severity === 'error' ? c.error_threshold : c.warning_threshold
}

/** 条件が見ている値を「チェック名.メトリクス名」「ジョブ名.項目名」の形で表す */
export function describeTarget(c: AlertCondition, jobNames?: Map<string, string>): string {
  if (c.source === 'job') {
    return `${jobNames?.get(c.job_id ?? '') ?? 'ジョブ'}.${c.metric_name}`
  }
  return c.check_name ? `${c.check_name}.${c.metric_name}` : c.metric_name
}

/** 指定レベルの判定式を「A かつ B または C」の形に整形する。閾値が無ければ null */
export function describeGroups(
  groups: AlertConditionGroup[], severity: AlertSeverity, jobNames?: Map<string, string>,
): string | null {
  const texts: string[] = []
  for (const g of groups) {
    const parts: string[] = []
    for (const c of g.conditions) {
      const threshold = thresholdOf(c, severity)
      // 閾値が無い条件を含むグループは、このレベルでは判定されない
      if (threshold == null) { parts.length = 0; break }
      parts.push(`${describeTarget(c, jobNames)} ${c.operator} ${threshold}`)
    }
    if (parts.length > 0) texts.push(parts.join(' かつ '))
  }
  if (texts.length === 0) return null
  return texts
    .map(t => (texts.length > 1 && t.includes(' かつ ') ? `(${t})` : t))
    .join(' または ')
}

/** このルールが発火しうるレベル */
export function ruleSeverities(rule: AlertRule): AlertSeverity[] {
  return SEVERITIES.filter(sev => describeGroups(rule.groups, sev) !== null)
}

// ── 編集フォーム ──────────────────────────────────────────────────────────────

type ConditionForm = {
  source: AlertSource
  /** source='metric' 用 */
  check_name: string
  /** source='job' 用 */
  job_id: string
  metric_name: string
  operator: AlertOperator
  error_threshold: string
  warning_threshold: string
}

type RuleForm = {
  name: string
  message: string
  enabled: boolean
  groups: { conditions: ConditionForm[] }[]
}

const emptyCondition = (): ConditionForm => ({
  source: 'metric', check_name: '', job_id: '', metric_name: '',
  operator: '>', error_threshold: '', warning_threshold: '',
})

const emptyForm = (): RuleForm => ({
  name: '', message: '', enabled: true,
  groups: [{ conditions: [emptyCondition()] }],
})

const numberField = (v: number | null | undefined): string => (v == null ? '' : String(v))

const toForm = (rule: AlertRule): RuleForm => ({
  name: rule.name,
  message: rule.message ?? '',
  enabled: rule.enabled,
  groups: rule.groups.map(g => ({
    conditions: g.conditions.map(c => ({
      source: c.source,
      check_name: c.check_name ?? '',
      job_id: c.job_id ?? '',
      metric_name: c.metric_name,
      operator: c.operator,
      error_threshold: numberField(c.error_threshold),
      warning_threshold: numberField(c.warning_threshold),
    })),
  })),
})

/** Error / Warning それぞれの閾値入力 */
function ThresholdInput({
  severity, value, onChange,
}: {
  severity: AlertSeverity
  value: string
  onChange: (v: string) => void
}) {
  const tone = severity === 'error'
    ? 'border-red-200 bg-red-50 focus-within:border-red-400'
    : 'border-amber-200 bg-amber-50 focus-within:border-amber-400'
  const labelTone = severity === 'error' ? 'text-red-600' : 'text-amber-700'
  return (
    <label className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 ${tone}`}>
      <span className={`text-[10px] font-semibold ${labelTone}`}>{SEVERITY_TEXT[severity]}</span>
      <input
        type="number"
        step="any"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-20 border-0 bg-transparent p-0 text-xs tabular-nums text-gray-800 outline-none placeholder:text-gray-400"
        placeholder="—"
        title={`${SEVERITY_TEXT[severity]} の閾値（空欄ならこのレベルは判定しない）`}
      />
    </label>
  )
}

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

  // ジョブ実行結果を条件にする場合の対象ジョブと、その出力項目名の候補
  const { data: jobs } = useQuery({
    queryKey: ['jobs', serverId],
    queryFn: () => getJobs(serverId),
  })
  const jobList = jobs?.items ?? []
  const { data: jobResults = [] } = useQuery({
    queryKey: ['server-job-results', serverId],
    queryFn: () => getServerJobResults(serverId),
  })
  const fieldsByJob = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const r of jobResults) map[r.job_id] = jobFieldNames(r.output)
    return map
  }, [jobResults])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['alert-rules', serverId] })
    qc.invalidateQueries({ queryKey: ['alerts'] })
  }

  const saveMut = useMutation({
    mutationFn: (payload: {
      name: string; message: string | null
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
        const isJob = c.source === 'job'
        const metricName = c.metric_name.trim()
        if (isJob && !c.job_id) {
          setError('ジョブ結果の条件では、対象のジョブを選んでください')
          return
        }
        if (!metricName) {
          setError(isJob ? '出力の項目名を入力してください' : 'メトリクス名を入力してください')
          return
        }

        const thresholds: Record<AlertSeverity, number | null> = { error: null, warning: null }
        for (const sev of SEVERITIES) {
          const raw = (sev === 'error' ? c.error_threshold : c.warning_threshold).trim()
          if (raw === '') continue
          const value = Number(raw)
          if (Number.isNaN(value)) {
            setError(`「${metricName}」の ${SEVERITY_TEXT[sev]} 閾値には数値を入力してください`)
            return
          }
          thresholds[sev] = value
        }
        if (thresholds.error == null && thresholds.warning == null) {
          setError(`「${metricName}」に Error か Warning の閾値を入力してください`)
          return
        }

        const direction = ORDERED_OPERATORS[c.operator]
        if (direction && thresholds.error != null && thresholds.warning != null
          && (thresholds.error - thresholds.warning) * direction < 0) {
          setError(
            `「${metricName}」の Error 閾値は Warning より${direction > 0 ? '大きい' : '小さい'}値にしてください`,
          )
          return
        }

        conditions.push({
          source: c.source,
          metric_name: metricName,
          operator: c.operator,
          error_threshold: thresholds.error,
          warning_threshold: thresholds.warning,
          check_name: isJob ? null : (c.check_name.trim() || null),
          job_id: isJob ? c.job_id : null,
        })
      }
      if (conditions.length === 0) continue

      // AND でつなぐ条件は、同じレベルの閾値がそろっていないと判定できない
      if (!SEVERITIES.some(sev => conditions.every(c => thresholdOf(c, sev) != null))) {
        setError('AND でつなぐ条件には、Error か Warning のどちらかの閾値をすべてに入力してください')
        return
      }
      groups.push({ conditions })
    }
    if (groups.length === 0) {
      setError('条件を1つ以上設定してください')
      return
    }

    saveMut.mutate({
      name: form.name.trim(),
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
            <p className="mb-2 text-xs text-gray-400">
              条件ごとに Error / Warning の閾値をセットで指定します（例: 使用率 ≧ Error 90・Warning 80）。
              Error から先に判定し、空欄のレベルは判定しません。
              判定に使う値は、ワーカーの<b className="font-medium">メトリクス</b>か、
              ジョブ最新実行の<b className="font-medium">ジョブ結果</b>（出力の数値）から選べます。
            </p>

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
            {Object.entries(fieldsByJob).map(([jobId, names]) => (
              <datalist key={jobId} id={`job-fields-${jobId}`}>
                {names.map(n => <option key={n} value={n} />)}
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
                              <select
                                value={cond.source}
                                onChange={e => updateCondition(gi, ci, {
                                  // 出どころが変わると対象の指定も意味が変わるので入れ直す
                                  source: e.target.value as AlertSource,
                                  check_name: '', job_id: '', metric_name: '',
                                })}
                                className="input w-24 py-1.5 text-xs"
                                title="判定に使う値の出どころ"
                              >
                                {SOURCES.map(src => (
                                  <option key={src} value={src}>{SOURCE_TEXT[src]}</option>
                                ))}
                              </select>
                              {cond.source === 'job' ? (
                                <>
                                  <select
                                    required
                                    value={cond.job_id}
                                    onChange={e => updateCondition(gi, ci, { job_id: e.target.value })}
                                    className="input w-40 py-1.5 text-xs"
                                    title="結果を判定に使うジョブ"
                                  >
                                    <option value="">ジョブを選択</option>
                                    {jobList.map(j => (
                                      <option key={j.id} value={j.id}>{j.name}</option>
                                    ))}
                                  </select>
                                  <input
                                    required
                                    value={cond.metric_name}
                                    onChange={e => updateCondition(gi, ci, { metric_name: e.target.value })}
                                    list={cond.job_id ? `job-fields-${cond.job_id}` : undefined}
                                    className="input min-w-0 flex-1 py-1.5 text-xs"
                                    placeholder={`項目名 (例: ${JOB_MAIN_VALUE})`}
                                    title={`出力の項目名。トップレベルの値なら "${JOB_MAIN_VALUE}"、items ならそのラベル`}
                                  />
                                </>
                              ) : (
                                <>
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
                                </>
                              )}
                              <select
                                value={cond.operator}
                                onChange={e => updateCondition(gi, ci, { operator: e.target.value as AlertOperator })}
                                className="input w-16 py-1.5 text-center text-xs"
                              >
                                {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
                              </select>
                              <ThresholdInput
                                severity="error"
                                value={cond.error_threshold}
                                onChange={v => updateCondition(gi, ci, { error_threshold: v })}
                              />
                              <ThresholdInput
                                severity="warning"
                                value={cond.warning_threshold}
                                onChange={v => updateCondition(gi, ci, { warning_threshold: v })}
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
  rule, firing, jobNames, onEdit, onDelete, deleting,
}: {
  rule: AlertRule
  firing?: Alert
  jobNames: Map<string, string>
  onEdit: () => void
  onDelete: () => void
  deleting: boolean
}) {
  const [confirm, setConfirm] = useState(false)
  const severities = ruleSeverities(rule)
  const fired = firing ? SEVERITY_STYLES[firing.severity] : null

  return (
    <div className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
      fired ? fired.card : 'border-gray-200 bg-white'
    } ${rule.enabled ? '' : 'opacity-60'}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-800">{rule.name}</span>
          {firing && fired && (
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${fired.badge}`}>
              <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${fired.dot}`} />
              {SEVERITY_TEXT[firing.severity]} 発火中
            </span>
          )}
          {!rule.enabled && (
            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">無効</span>
          )}
        </div>
        {severities.map(sev => {
          const desc = describeGroups(rule.groups, sev, jobNames) ?? ''
          return (
            <div key={sev} className="flex items-baseline gap-1.5">
              <span className={`shrink-0 rounded px-1 text-[10px] font-semibold ${SEVERITY_STYLES[sev].badge}`}>
                {SEVERITY_TEXT[sev]}
              </span>
              <span className="truncate font-mono text-xs text-gray-500" title={desc}>{desc}</span>
            </div>
          )
        })}
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
  // ジョブ結果の条件を「ジョブ名.項目名」で表示するため
  const { data: jobs } = useQuery({
    queryKey: ['jobs', serverId],
    queryFn: () => getJobs(serverId),
  })

  const firingByRule = useMemo(
    () => new Map(alerts.map(a => [a.rule_id, a])),
    [alerts],
  )
  const jobNames = useMemo(
    () => new Map((jobs?.items ?? []).map(j => [j.id, j.name])),
    [jobs],
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
          メトリクスやジョブ結果の閾値を Error / Warning のセットで決めて、
          アラートを出すルールを設定できます。
        </p>
      ) : (
        <div className="space-y-1.5">
          {rules.map(r => (
            <AlertRuleRow
              key={r.id}
              rule={r}
              firing={firingByRule.get(r.id)}
              jobNames={jobNames}
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
