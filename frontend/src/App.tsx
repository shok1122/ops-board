import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Servers from './pages/Servers'
import Jobs from './pages/Jobs'
import Executions from './pages/Executions'
import JobDetail from './pages/JobDetail'
import ExecutionDetail from './pages/ExecutionDetail'
import Scripts from './pages/Scripts'
import WorkerLogs from './pages/WorkerLogs'

/** 認証が必要なルートのガード */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, authRequired } = useAuth()

  // 認証要否を確認中はスピナーを表示
  if (authRequired === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    )
  }

  // 認証不要、またはトークンがある場合は通過
  if (!authRequired || token) {
    return <>{children}</>
  }

  return <Navigate to="/login" replace />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/servers" element={<Servers />} />
            <Route path="/jobs" element={<Jobs />} />
            <Route path="/jobs/:jobId" element={<JobDetail />} />
            <Route path="/executions" element={<Executions />} />
            <Route path="/executions/:executionId" element={<ExecutionDetail />} />
            <Route path="/scripts" element={<Scripts />} />
            <Route path="/worker-logs" element={<WorkerLogs />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
