import { useState, useRef } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Server, Calendar, History, Activity, Download, Upload, AlertTriangle, LogOut,
} from 'lucide-react'
import { exportConfig, importConfig } from '../api/client'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'

const nav = [
  { to: '/', label: 'ダッシュボード', icon: LayoutDashboard },
  { to: '/servers', label: 'サーバー', icon: Server },
  { to: '/jobs', label: 'ジョブ', icon: Calendar },
  { to: '/executions', label: '実行履歴', icon: History },
]

export default function Layout() {
  const qc = useQueryClient()
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { authRequired, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const doExport = async () => {
    setExportModalOpen(false)
    const data = await exportConfig()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `opsboard-config-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const doImportConfirm = () => {
    setImportModalOpen(false)
    fileInputRef.current?.click()
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = async (ev) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(ev.target?.result as string)
      } catch {
        alert('JSONの解析に失敗しました。ファイルを確認してください。')
        return
      }
      try {
        await importConfig(parsed)
        qc.invalidateQueries({ queryKey: ['servers'] })
        qc.invalidateQueries({ queryKey: ['jobs'] })
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'インポートに失敗しました。'
        alert(`エラー: ${msg}`)
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col bg-sidebar text-white">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/10">
          <Activity className="h-5 w-5 text-indigo-400" />
          <span className="font-semibold text-lg tracking-tight">OpsBoard</span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ` +
                (isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-300 hover:bg-white/10 hover:text-white')
              }
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-white/10 space-y-1">
          <button
            onClick={() => setExportModalOpen(true)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            <Download className="h-4 w-4 flex-shrink-0" />
            エクスポート
          </button>
          <button
            onClick={() => setImportModalOpen(true)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            <Upload className="h-4 w-4 flex-shrink-0" />
            インポート
          </button>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleFileSelect} />
          {authRequired && (
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
            >
              <LogOut className="h-4 w-4 flex-shrink-0" />
              ログアウト
            </button>
          )}
          <div className="px-2 pt-2 text-xs text-gray-500">v1.0.0</div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {/* Import confirm modal */}
      {importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="font-semibold text-gray-900">設定のインポート</h2>
            </div>
            <div className="px-6 py-5 space-y-4 text-sm text-gray-700">
              <p>JSON ファイルからサーバーとジョブの設定をインポートします。</p>
              <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="font-medium">現在の設定はすべて削除されます</p>
                  <p className="text-xs">現在登録されているサーバーとジョブをすべて削除し、インポートした設定に置き換えます。この操作は元に戻せません。</p>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
              <button
                onClick={() => setImportModalOpen(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={doImportConfirm}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                <Upload className="h-4 w-4" />
                ファイルを選択してインポート
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export confirm modal */}
      {exportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="font-semibold text-gray-900">設定のエクスポート</h2>
            </div>
            <div className="px-6 py-5 space-y-4 text-sm text-gray-700">
              <p>以下の設定情報を JSON ファイルとしてダウンロードします。</p>
              <ul className="list-disc list-inside space-y-1 text-gray-600">
                <li>サーバー接続情報（ホスト・ポート・ユーザー名）</li>
                <li>ジョブ設定（スケジュール・コマンド等）</li>
              </ul>
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="font-medium">認証情報が平文で含まれます</p>
                  <p className="text-xs">パスワードや秘密鍵がそのままファイルに出力されます。ファイルの取り扱いには十分注意し、安全な場所に保管してください。</p>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
              <button
                onClick={() => setExportModalOpen(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={doExport}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                <Download className="h-4 w-4" />
                エクスポート
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
