import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDashboardStore } from '../store/appStore'
import { useWebSocket } from '../services/websocket'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import { AlertTriangle, CheckCircle, Clock, Activity, Wifi, WifiOff, AlertCircle, Timer, Unplug } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

const SEVERITY_COLORS = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#d97706',
  low: '#16a34a',
}

export default function Dashboard() {
  const { stats, fetchStats } = useDashboardStore()
  const navigate = useNavigate()

  const wsStatus = useWebSocket(() => fetchStats())

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [fetchStats])

  if (!stats) return <div className="p-8 text-gray-400">Loading dashboard...</div>

  const { anomalies, actions } = stats

  const severityData = Object.entries(anomalies.by_severity).map(([k, v]) => ({
    name: k.charAt(0).toUpperCase() + k.slice(1),
    value: v,
    fill: SEVERITY_COLORS[k],
  }))

  const actionStatusData = [
    { name: 'Pending', value: actions.pending_approval, fill: '#d97706', statusKey: 'pending_approval' },
    { name: 'Auto-approved', value: actions.auto_approved, fill: '#0891b2', statusKey: 'auto_approved' },
    { name: 'Approved', value: actions.approved, fill: '#4f46e5', statusKey: 'approved' },
    { name: 'Completed', value: actions.completed, fill: '#16a34a', statusKey: 'completed' },
    { name: 'Rejected', value: actions.rejected, fill: '#dc2626', statusKey: 'rejected' },
  ].filter(d => d.value > 0)

  const approvalLevelData = [
    { name: 'L1 Auto', value: actions.by_level.L1, level: 'L1' },
    { name: 'L2 Team Lead', value: actions.by_level.L2, level: 'L2' },
    { name: 'L3 Manager', value: actions.by_level.L3, level: 'L3' },
  ]

  const goToAnomalies = (severity) => navigate(`/anomalies?severity=${severity.toLowerCase()}`)
  const goToApprovalsByStatus = (status) => navigate(`/approvals?status=${status}`)
  const goToApprovalsByLevel = (level) => navigate(`/approvals?level=${level}`)
  const goToAnomaliesByKeyword = (keyword) => navigate(`/anomalies?keyword=${keyword}`)

  const logPatterns = stats.log_patterns || { errors: 0, timeouts: 0, disconnected: 0 }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <button
          onClick={() => navigate('/audit')}
          title="View connection/audit events"
          className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
            wsStatus === 'connected'
              ? 'border-green-800/50 text-green-400 hover:bg-green-950/30'
              : 'border-red-800/50 text-red-400 hover:bg-red-950/30 animate-pulse'
          }`}
        >
          {wsStatus === 'connected' ? <Wifi size={14} /> : <WifiOff size={14} />}
          {wsStatus === 'connected' ? 'Live' : wsStatus === 'connecting' ? 'Connecting…' : 'Disconnected'}
        </button>
      </div>

      {/* Functional keys: counts of anomalies whose log content mentions errors / timeouts /
          disconnects, click through to see the matching anomalies and their log lines */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => goToAnomaliesByKeyword('error')}
          title="View anomalies whose logs mention errors"
          className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-red-800/50 text-red-400 hover:bg-red-950/30 transition-colors"
        >
          <AlertCircle size={14} />
          Errors: {logPatterns.errors}
        </button>
        <button
          onClick={() => goToAnomaliesByKeyword('timeout')}
          title="View anomalies whose logs mention timeouts"
          className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-amber-800/50 text-amber-400 hover:bg-amber-950/30 transition-colors"
        >
          <Timer size={14} />
          Timeouts: {logPatterns.timeouts}
        </button>
        <button
          onClick={() => goToAnomaliesByKeyword('disconnected')}
          title="View anomalies whose logs mention disconnects"
          className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800/50 transition-colors"
        >
          <Unplug size={14} />
          Disconnected: {logPatterns.disconnected}
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={<AlertTriangle className="text-red-400" size={22} />} label="Open Anomalies" value={anomalies.open} color="red" />
        <KpiCard icon={<Clock className="text-amber-400" size={22} />} label="Pending Approvals" value={actions.pending_approval} color="amber" />
        <KpiCard icon={<CheckCircle className="text-green-400" size={22} />} label="Resolved" value={anomalies.resolved} color="green" />
        <KpiCard icon={<Activity className="text-indigo-400" size={22} />} label="Total Analyses" value={stats.analyses.total} color="indigo" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Severity breakdown */}
        <div className="card col-span-1">
          <h2 className="text-sm font-semibold text-gray-400 mb-4">Anomalies by Severity</h2>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={severityData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={70}
                onClick={(entry) => goToAnomalies(entry.name)}
                className="cursor-pointer"
              >
                {severityData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8 }} />
              <Legend onClick={(entry) => goToAnomalies(entry.value)} wrapperStyle={{ cursor: 'pointer' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Action status */}
        <div className="card col-span-1">
          <h2 className="text-sm font-semibold text-gray-400 mb-4">Action Status</h2>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={actionStatusData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={70}
                onClick={(entry) => goToApprovalsByStatus(entry.statusKey)}
                className="cursor-pointer"
              >
                {actionStatusData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8 }} />
              <Legend onClick={(entry) => goToApprovalsByStatus(entry.payload.statusKey)} wrapperStyle={{ cursor: 'pointer' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Approval levels */}
        <div className="card col-span-1">
          <h2 className="text-sm font-semibold text-gray-400 mb-4">Actions by Approval Level</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={approvalLevelData}>
              <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8 }} />
              <Bar
                dataKey="value"
                fill="#4f46e5"
                radius={[4, 4, 0, 0]}
                className="cursor-pointer"
                onClick={(entry) => goToApprovalsByLevel(entry.level)}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Audit */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-400 mb-4">Recent Activity</h2>
        <div className="space-y-2">
          {stats.recent_audit.slice(0, 8).map((entry, i) => (
            <div key={i} className="flex items-center gap-3 text-sm py-1 border-b border-gray-800 last:border-0">
              <span className="text-indigo-400 font-mono text-xs">{entry.event}</span>
              <span className="text-gray-400 flex-1">{entry.user}</span>
              <span className="text-gray-500 text-xs">{formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}</span>
            </div>
          ))}
          {stats.recent_audit.length === 0 && <p className="text-gray-500 text-sm">No activity yet.</p>}
        </div>
      </div>
    </div>
  )
}

function KpiCard({ icon, label, value, color }) {
  const bg = {
    red: 'border-red-800/50',
    amber: 'border-amber-800/50',
    green: 'border-green-800/50',
    indigo: 'border-indigo-800/50',
  }
  return (
    <div className={`card border ${bg[color] || ''}`}>
      <div className="flex items-center gap-3 mb-1">
        {icon}
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <p className="text-3xl font-bold text-white">{value ?? 0}</p>
    </div>
  )
}
