import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertOctagon, AlertTriangle, Bell, CheckCircle2, Clock, Loader2,
  MessageSquare, RefreshCw, Send, XCircle,
} from 'lucide-react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import {
  getNotificationPreview, getNotificationSettings, runNotificationCheck,
  sendNotificationTest, updateNotificationSettings,
} from '../api/client'
import type {
  AlertSeverity, NotificationCheckResult, NotificationSettings, NotifyMode,
} from '../types'

const CRON_PRESETS = [
  { label: '毎5分', value: '*/5 * * * *' },
  { label: '毎15分', value: '*/15 * * * *' },
  { label: '毎30分', value: '*/30 * * * *' },
  { label: '毎時', value: '0 * * * *' },
  { label: '毎日9時', value: '0 9 * * *' },
  { label: '平日9時', value: '0 9 * * 1-5' },
]

const MODES: { value: NotifyMode; label: string; desc: string }[] = [
  {
    value: 'on_change',
    label: '変化があったときだけ',
    desc: 'アラートが新しく出たとき／解消したときにだけ通知します',
  },
  {
    value: 'always',
    label: 'チェックごとに毎回',
    desc: 'アラートが出ている間は、チェックのたびに通知します',
  },
]

const SEVERITY_OPTIONS: {
  value: AlertSeverity; label: string; icon: typeof AlertOctagon; style: string
}[] = [
  {
    value: 'error', label: 'Error（異常）', icon: AlertOctagon,
    style: 'border-red-200 bg-red-50 text-red-800',
  },
  {
    value: 'warning', label: 'Warning（警告）', icon: AlertTriangle,
    style: 'border-amber-200 bg-amber-50 text-amber-800',
  },
]

type Form = {
  enabled: boolean
  cron_expr: string
  severities: AlertSeverity[]
  mode: NotifyMode
  notify_resolved: boolean
}

const toForm = (s: NotificationSettings): Form => ({
  enabled: s.enabled,
  cron_expr: s.cron_expr,
  severities: s.severities,
  mode: s.mode,
  notify_resolved: s.notify_resolved,
})

function formatTime(iso?: string | null) {
  if (!iso) return '—'
  try {
    return format(new Date(iso), 'yyyy/MM/dd HH:mm:ss', { locale: ja })
  } catch {
    return iso
  }
}

function Card({ title, icon: Icon, children, action }: {
  title: string
  icon: typeof Bell
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-gray-100 px-6 py-4">
        <Icon className="h-4 w-4 text-indigo-400" />
        <h2 className="font-semibold text-gray-900">{title}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  )
}

function Field({ label, hint, children }: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <label className="text-xs font-medium text-gray-600">{label}</label>
        {hint && <span className="text-xs text-gray-400">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

/** テスト送信・即時チェックの結果表示 */
function ResultBanner({ result }: { result: NotificationCheckResult }) {
  if (result.error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">送信に失敗しました</p>
          <p className="mt-0.5 text-xs break-all">{result.error}</p>
        </div>
      </div>
    )
  }
  if (result.sent) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium">
            Teams に通知しました
            {result.reason !== 'test' && (
              <span className="ml-1 font-normal text-xs">
                （発生中 {result.firing}件 / 新規 {result.new}件 / 解消 {result.resolved}件）
              </span>
            )}
          </p>
          {result.message && (
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-white/70 p-2 font-mono text-xs text-gray-700">
              {result.message}
            </pre>
          )}
        </div>
      </div>
    )
  }
  const reasons: Record<string, string> = {
    no_alerts: 'アラートが出ていないため通知は不要でした',
    no_change: '前回の通知から変化がないため通知は不要でした',
    disabled: '通知が無効になっています',
    not_configured: 'Teams の Webhook URL が設定されていません',
    no_severities: '通知対象の重大度が選択されていません',
  }
  return (
    <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
      <div>
        <p>{reasons[result.reason] ?? `通知しませんでした（${result.reason}）`}</p>
        <p className="mt-0.5 text-xs text-gray-500">発生中のアラート: {result.firing}件</p>
      </div>
    </div>
  )
}

export default function Notifications() {
  const qc = useQueryClient()
  const [form, setForm] = useState<Form | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [result, setResult] = useState<NotificationCheckResult | null>(null)

  const { data: settings, isLoading } = useQuery({
    queryKey: ['notification-settings'],
    queryFn: getNotificationSettings,
    refetchInterval: 60_000,
  })

  // 取得できたらフォームの初期値にする（未編集のときだけ同期する）
  useEffect(() => {
    if (settings && form === null) setForm(toForm(settings))
  }, [settings, form])

  const { data: preview } = useQuery({
    queryKey: ['notification-preview'],
    queryFn: getNotificationPreview,
    refetchInterval: 60_000,
  })

  const apiError = (err: unknown, fallback: string) => {
    const detail = (err as { response?: { data?: { detail?: unknown } } })
      ?.response?.data?.detail
    return typeof detail === 'string' ? detail : fallback
  }

  const saveMut = useMutation({
    mutationFn: updateNotificationSettings,
    onSuccess: data => {
      qc.setQueryData(['notification-settings'], data)
      setForm(toForm(data))
      setError(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
    onError: err => setError(apiError(err, '保存に失敗しました')),
  })

  const testMut = useMutation({
    mutationFn: sendNotificationTest,
    onSuccess: r => { setResult(r); setError(null) },
    onError: err => setError(apiError(err, 'テスト通知に失敗しました')),
  })

  const checkMut = useMutation({
    mutationFn: runNotificationCheck,
    onSuccess: r => {
      setResult(r)
      setError(null)
      qc.invalidateQueries({ queryKey: ['notification-settings'] })
    },
    onError: err => setError(apiError(err, 'チェックの実行に失敗しました')),
  })

  if (isLoading || !settings || !form) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    )
  }

  const toggleSeverity = (sev: AlertSeverity) => {
    setForm(f => f && ({
      ...f,
      severities: f.severities.includes(sev)
        ? f.severities.filter(s => s !== sev)
        : [...f.severities, sev],
    }))
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (form.severities.length === 0) {
      setError('通知対象の重大度を1つ以上選択してください')
      return
    }
    saveMut.mutate(form)
  }

  const busy = testMut.isPending || checkMut.isPending

  return (
    <div className="p-8">
      <h1 className="mb-2 text-2xl font-bold text-gray-900">Teams 通知</h1>
      <p className="mb-6 text-sm text-gray-500">
        ダッシュボードに Error / Warning のアラートが出ているとき、その内容を Teams に通知します。
      </p>

      {!settings.configured && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="space-y-1 text-sm">
            <p className="font-medium">Teams の接続先が設定されていないため、通知機能は使えません</p>
            <p className="text-xs">
              docker-compose.yml の backend サービスに <code className="font-mono">TEAMS_WEBHOOK_URL</code> を設定し、
              コンテナを再作成してください（<code className="font-mono">.env</code> に書くのが簡単です）。
              以下の設定は保存できますが、URL が設定されるまで通知は送られません。
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 設定 */}
        <Card title="通知設定" icon={Bell}>
          <form onSubmit={handleSave} className="space-y-5">
            <label className="flex cursor-pointer select-none items-center gap-2">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={e => setForm(f => f && ({ ...f, enabled: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600"
              />
              <span className="text-sm font-medium text-gray-800">通知を有効にする</span>
            </label>

            <Field label="チェックするタイミング (cron 5フィールド)">
              <div className="mb-2 flex flex-wrap gap-2">
                {CRON_PRESETS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setForm(f => f && ({ ...f, cron_expr: p.value }))}
                    className={`rounded border px-2.5 py-1 text-xs transition-colors ${
                      form.cron_expr === p.value
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <input
                required
                value={form.cron_expr}
                onChange={e => setForm(f => f && ({ ...f, cron_expr: e.target.value }))}
                className="input font-mono text-sm"
                placeholder="*/30 * * * *"
              />
              <p className="mt-1 text-xs text-gray-400">
                このタイミングごとに通知の要否を判定します。例: <code>*/30 * * * *</code> = 30分おき、
                <code>0 9 * * *</code> = 毎日9時
              </p>
            </Field>

            <Field label="通知する重大度">
              <div className="flex gap-2">
                {SEVERITY_OPTIONS.map(({ value, label, icon: Icon, style }) => {
                  const active = form.severities.includes(value)
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggleSeverity(value)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        active ? style : 'border-gray-200 bg-white text-gray-400 hover:bg-gray-50'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  )
                })}
              </div>
            </Field>

            <Field label="通知の頻度">
              <div className="space-y-1.5">
                {MODES.map(m => (
                  <label
                    key={m.value}
                    className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${
                      form.mode === m.value
                        ? 'border-indigo-300 bg-indigo-50/60'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="mode"
                      checked={form.mode === m.value}
                      onChange={() => setForm(f => f && ({ ...f, mode: m.value }))}
                      className="mt-0.5 h-4 w-4 border-gray-300 text-indigo-600"
                    />
                    <span className="text-sm text-gray-800">
                      {m.label}
                      <span className="block text-xs text-gray-500">{m.desc}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>

            <label className="flex cursor-pointer select-none items-center gap-2">
              <input
                type="checkbox"
                checked={form.notify_resolved}
                onChange={e => setForm(f => f && ({ ...f, notify_resolved: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600"
              />
              <span className="text-sm text-gray-700">アラートが解消したことも通知する</span>
            </label>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center gap-3 border-t border-gray-100 pt-4">
              <button type="submit" disabled={saveMut.isPending} className="btn-primary">
                {saveMut.isPending ? '保存中…' : '保存'}
              </button>
              {saved && (
                <span className="flex items-center gap-1 text-xs text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" /> 保存しました
                </span>
              )}
            </div>
          </form>
        </Card>

        <div className="space-y-6">
          {/* 状態 */}
          <Card title="実行状態" icon={Clock}>
            <dl className="space-y-2.5 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-gray-500">状態</dt>
                <dd className="font-medium">
                  {!settings.configured ? (
                    <span className="text-gray-400">未設定（使用不可）</span>
                  ) : settings.enabled ? (
                    <span className="text-emerald-600">有効</span>
                  ) : (
                    <span className="text-gray-400">無効</span>
                  )}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-gray-500">次回チェック</dt>
                <dd className="font-mono text-xs text-gray-700">
                  {formatTime(settings.next_run_at)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-gray-500">最終チェック</dt>
                <dd className="font-mono text-xs text-gray-700">
                  {formatTime(settings.last_checked_at)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-gray-500">最終通知</dt>
                <dd className="font-mono text-xs text-gray-700">
                  {formatTime(settings.last_notified_at)}
                </dd>
              </div>
              {settings.dashboard_url && (
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-gray-500">通知に載せる URL</dt>
                  <dd className="truncate font-mono text-xs text-gray-700">
                    {settings.dashboard_url}
                  </dd>
                </div>
              )}
            </dl>

            {settings.last_error && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="break-all">直近のエラー: {settings.last_error}</span>
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-3 border-t border-gray-100 pt-4">
              <button
                type="button"
                disabled={!settings.configured || busy}
                onClick={() => testMut.mutate()}
                className="btn-secondary gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="h-3.5 w-3.5" />
                {testMut.isPending ? '送信中…' : 'テスト通知を送る'}
              </button>
              <button
                type="button"
                disabled={!settings.configured || busy}
                onClick={() => checkMut.mutate()}
                className="btn-secondary gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${checkMut.isPending ? 'animate-spin' : ''}`} />
                {checkMut.isPending ? 'チェック中…' : '今すぐチェック'}
              </button>
            </div>

            {result && (
              <div className="mt-3">
                <ResultBanner result={result} />
              </div>
            )}
          </Card>

          {/* プレビュー */}
          <Card
            title="通知文プレビュー"
            icon={MessageSquare}
            action={
              <span className="text-xs text-gray-400">
                発生中 {preview?.firing ?? 0}件
              </span>
            }
          >
            {preview?.message ? (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 font-mono text-xs text-gray-700">
                {preview.message}
              </pre>
            ) : (
              <p className="py-2 text-center text-sm text-gray-400">
                現在アラートは出ていないため、通知する内容はありません
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
