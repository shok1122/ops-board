import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard, Server, Calendar, History, Activity,
} from 'lucide-react'

const nav = [
  { to: '/', label: 'ダッシュボード', icon: LayoutDashboard },
  { to: '/servers', label: 'サーバー', icon: Server },
  { to: '/jobs', label: 'ジョブ', icon: Calendar },
  { to: '/executions', label: '実行履歴', icon: History },
]

export default function Layout() {
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

        <div className="px-5 py-4 border-t border-white/10 text-xs text-gray-500">
          v1.0.0
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
