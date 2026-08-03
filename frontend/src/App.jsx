import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import LogUpload from './pages/LogUpload'
import Anomalies from './pages/Anomalies'
import Approvals from './pages/Approvals'
import AuditTrail from './pages/AuditTrail'
import Login from './pages/Login'

function RequireAuth({ children }) {
  const { token } = useAuthStore()
  const location = useLocation()
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />
  return children
}

export default function App() {
  const { token, fetchMe } = useAuthStore()

  useEffect(() => {
    if (token) fetchMe()
  }, [token, fetchMe])

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <div className="flex min-h-screen">
              <Sidebar />
              <main className="flex-1 overflow-auto">
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/logs" element={<LogUpload />} />
                  <Route path="/anomalies" element={<Anomalies />} />
                  <Route path="/approvals" element={<Approvals />} />
                  <Route path="/audit" element={<AuditTrail />} />
                </Routes>
              </main>
            </div>
          </RequireAuth>
        }
      />
    </Routes>
  )
}
