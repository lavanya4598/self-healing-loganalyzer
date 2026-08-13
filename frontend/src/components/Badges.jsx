import { clsx } from 'clsx'

export function SeverityBadge({ severity }) {
  return (
    <span className={`badge-${severity}`}>
      {severity?.toUpperCase()}
    </span>
  )
}

export function StatusBadge({ status }) {
  const colors = {
    open: 'bg-blue-700 text-white',
    in_progress: 'bg-purple-700 text-white',
    resolved: 'bg-green-700 text-white',
    dismissed: 'bg-gray-700 text-gray-300',
    pending_approval: 'bg-amber-600 text-white',
    auto_approved: 'bg-cyan-700 text-white',
    approved: 'bg-indigo-600 text-white',
    completed: 'bg-green-700 text-white',
    rejected: 'bg-red-700 text-white',
    failed: 'bg-red-900 text-white',
  }
  const label = status?.replace(/_/g, ' ')
  return (
    <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', colors[status] || 'bg-gray-700 text-white')}>
      {label}
    </span>
  )
}

export function ApprovalLevelBadge({ level }) {
  const colors = {
    L1: 'bg-green-800 text-green-200',
    L2: 'bg-amber-800 text-amber-200',
    L3: 'bg-red-800 text-red-200',
  }
  const labels = {
    L1: 'L1 · Auto',
    L2: 'L2 · SDM',
    L3: 'L3 · SDM+SM+IM',
  }
  return (
    <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', colors[level] || 'bg-gray-700')}>
      {labels[level] || level}
    </span>
  )
}
