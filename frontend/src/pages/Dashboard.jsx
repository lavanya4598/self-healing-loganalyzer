import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDashboardStore } from '../store/appStore'
import { useWebSocket } from '../services/websocket'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import {
  AlertTriangle, CheckCircle, Clock, Activity, Wifi, WifiOff, AlertCircle, Timer, Unplug,
  PieChart as PieChartIcon, BarChart3, History, Loader2,
} from 'lucide-react'
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

  if (!stats) {
    return (
      <div className="p-8 flex items-center gap-2 text-gray-400">
        <Loader2 size={18} className="animate-spin" />
        Loading dashboard...
      </div>
    )
  }

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
    { name: 'L2 SDM', value: actions.by_level.L2, level: 'L2' },
    { name: 'L3 SDM+SM+IM', value: actions.by_level.L3, level: 'L3' },
  ]

  const goToAnomalies = (severity) => navigate(`/anomalies?severity=${severity.toLowerCase()}`)
  const goToApprovalsByStatus = (status) => navigate(`/approvals?status=${status}`)
  const goToApprovalsByLevel = (level) => navigate(`/approvals?level=${level}`)
  const goToAnomaliesByKeyword = (keyword) => navigate(`/anomalies?keyword=${keyword}`)

  const logPatterns = stats.log_patterns || { errors: 0, timeouts: 0, disconnected: 0 }

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Last updated {formatDistanceToNow(new Date(stats.generated_at), { addSuffix: true })}
          </p>
        </div>
        <button
          onClick={() => navigate('/audit')}
          title="View connection/audit events"
          className={`flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
            wsStatus === 'connected'
              ? 'border-green-800/50 bg-green-950/30 text-green-400 hover:bg-green-950/50'
              : 'border-red-800/50 bg-red-950/20 text-red-400 hover:bg-red-950/40 animate-pulse'
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
          className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg border border-red-800/50 bg-red-950/10 text-red-400 hover:bg-red-950/30 transition-colors"
        >
          <AlertCircle size={14} />
          Errors: {logPatterns.errors}
        </button>
        <button
          onClick={() => goToAnomaliesByKeyword('timeout')}
          title="View anomalies whose logs mention timeouts"
          className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-800/50 bg-amber-950/10 text-amber-400 hover:bg-amber-950/30 transition-colors"
        >
          <Timer size={14} />
          Timeouts: {logPatterns.timeouts}
        </button>
        <button
          onClick={() => goToAnomaliesByKeyword('disconnected')}
          title="View anomalies whose logs mention disconnects"
          className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800/30 text-gray-400 hover:bg-gray-800/50 transition-colors"
        >
          <Unplug size={14} />
          Disconnected: {logPatterns.disconnected}
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={<AlertTriangle size={20} />} label="Open Anomalies" value={anomalies.open} color="red" />
        <KpiCard icon={<Clock size={20} />} label="Pending Approvals" value={actions.pending_approval} color="amber" />
        <KpiCard icon={<CheckCircle size={20} />} label="Resolved" value={anomalies.resolved} color="green" />
        <KpiCard icon={<Activity size={20} />} label="Total Analyses" value={stats.analyses.total} color="indigo" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Severity breakdown */}
        <div className="card col-span-1 hover:shadow-card-hover">
          <SectionHeader icon={<PieChartIcon size={15} />} title="Anomalies by Severity" />
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
        <div className="card col-span-1 hover:shadow-card-hover">
          <SectionHeader icon={<PieChartIcon size={15} />} title="Action Status" />
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
        <div className="card col-span-1 hover:shadow-card-hover">
          <SectionHeader icon={<BarChart3 size={15} />} title="Actions by Approval Level" />
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
        <SectionHeader icon={<History size={15} />} title="Recent Activity" />
        <div className="divide-y divide-gray-800/70">
          {stats.recent_audit.slice(0, 8).map((entry, i) => (
            <div key={i} className="flex items-center gap-3 text-sm py-2.5 first:pt-0 last:pb-0">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
              <span className="text-indigo-300 font-mono text-xs">{entry.event}</span>
              <span className="text-gray-400 flex-1 truncate">{entry.user}</span>
              <span className="text-gray-500 text-xs shrink-0">{formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}</span>
            </div>
          ))}
          {stats.recent_audit.length === 0 && <p className="text-gray-500 text-sm">No activity yet.</p>}
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ icon, title }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-300 mb-4">
      <span className="text-indigo-400">{icon}</span>
      {title}
    </h2>
  )
}

function KpiCard({ icon, label, value, color }) {
  const styles = {
    red: { border: 'border-red-800/40', iconBg: 'bg-red-950/50 text-red-400' },
    amber: { border: 'border-amber-800/40', iconBg: 'bg-amber-950/50 text-amber-400' },
    green: { border: 'border-green-800/40', iconBg: 'bg-green-950/50 text-green-400' },
    indigo: { border: 'border-indigo-800/40', iconBg: 'bg-indigo-950/50 text-indigo-400' },
  }
  const s = styles[color] || styles.indigo
  return (
    <div className={`card border ${s.border} hover:shadow-card-hover`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.iconBg}`}>{icon}</div>
        <span className="text-xs font-medium text-gray-400">{label}</span>
      </div>
      <p className="text-3xl font-bold text-white tracking-tight">{value ?? 0}</p>
    </div>
  )
}
