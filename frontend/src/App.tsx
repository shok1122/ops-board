import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Servers from './pages/Servers'
import Jobs from './pages/Jobs'
import Executions from './pages/Executions'
import JobDetail from './pages/JobDetail'
import ExecutionDetail from './pages/ExecutionDetail'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/servers" element={<Servers />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/jobs/:jobId" element={<JobDetail />} />
          <Route path="/executions" element={<Executions />} />
          <Route path="/executions/:executionId" element={<ExecutionDetail />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
