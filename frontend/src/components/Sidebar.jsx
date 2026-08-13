import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, FileText, AlertTriangle, CheckSquare, Activity, LogOut } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { clsx } from 'clsx'

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/logs', icon: FileText, label: 'Log Upload' },
  { to: '/anomalies', icon: AlertTriangle, label: 'Anomalies' },
  { to: '/approvals', icon: CheckSquare, label: 'Approvals' },
  { to: '/audit', icon: Activity, label: 'Audit Trail' },
]

const ROLE_LABELS = {
  app_support: 'Application Support',
  sdm: 'Service Delivery Manager',
  sm: 'Service Manager',
  im: 'Incident Manager',
}

export default function Sidebar() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside className="w-64 min-h-screen bg-gray-900/80 backdrop-blur-sm border-r border-gray-800 flex flex-col sticky top-0">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center shadow-card">
            <Activity className="text-white" size={18} />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-tight tracking-tight">Self-Healing</p>
            <p className="text-xs text-gray-500">Log Analyser</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              clsx(
                'relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-indigo-600/15 text-white before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-1 before:rounded-full before:bg-indigo-500'
                  : 'text-gray-400 hover:bg-gray-800/70 hover:text-white',
              )
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User */}
      <div className="px-4 py-4 border-t border-gray-800">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-sm font-bold text-white shadow-card">
            {user?.name?.[0] ?? '?'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{user?.name}</p>
            <p className="text-xs text-gray-500">{ROLE_LABELS[user?.role] || user?.role}</p>
          </div>
        </div>
        <button onClick={handleLogout} className="w-full flex items-center gap-2 text-sm text-gray-400 hover:text-red-400 transition-colors">
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  )
}
