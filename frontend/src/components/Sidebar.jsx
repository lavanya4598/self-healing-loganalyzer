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
    <aside className="w-64 min-h-screen bg-gray-900 border-r border-gray-800 flex flex-col">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Activity className="text-indigo-400" size={24} />
          <div>
            <p className="text-sm font-bold text-white leading-tight">Self-Healing</p>
            <p className="text-xs text-gray-400">Log Analyser</p>
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
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white',
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
          <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-bold">
            {user?.name?.[0] ?? '?'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{user?.name}</p>
            <p className="text-xs text-gray-400">{ROLE_LABELS[user?.role] || user?.role}</p>
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
