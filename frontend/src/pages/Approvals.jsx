import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApprovalsStore } from '../store/appStore'
import { useAuthStore } from '../store/authStore'
import { SeverityBadge, StatusBadge, ApprovalLevelBadge } from '../components/Badges'
import { CheckCircle, XCircle, ChevronDown, ChevronRight, Terminal, X, Zap } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import api from '../services/api'

// Roles required per approval level (mirrors backend/src/config.js). L2
// needs any one of the listed roles; L3 needs ALL of them to sign off.
const REQUIRED_ROLES = { L2: ['sdm'], L3: ['sdm', 'sm', 'im'] }
const ROLE_LABELS = { sdm: 'SDM', sm: 'SM', im: 'IM' }

export default function Approvals() {
  const { user } = useAuthStore()
  const { pendingActions, allActions, targets, fetchPending, fetchAll, fetchTargets, approve, reject, complete, execute, executeManual, isLoading } = useApprovalsStore()
  const [expanded, setExpanded] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const urlStatus = searchParams.get('status')
  const urlLevel = searchParams.get('level')
  const [tab, setTab] = useState(urlStatus || urlLevel ? 'all' : 'pending')
  const [rejectModal, setRejectModal] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [plan, setPlan] = useState({})
  const [justApproved, setJustApproved] = useState(null)
  const [manualCommandFor, setManualCommandFor] = useState(null)
  const [manualCommand, setManualCommand] = useState('')
  const [manualTarget, setManualTarget] = useState('')

  useEffect(() => {
    if (urlStatus || urlLevel) setTab('all')
  }, [urlStatus, urlLevel])

  const clearDeepLinkFilter = () => setSearchParams({})

  useEffect(() => {
    fetchPending()
    fetchTargets()
    fetchAll()
  }, [user, fetchPending, fetchAll, fetchTargets])

  const handleApprove = async (action) => {
    try {
      const result = await approve(action.id)
      setPlan(p => ({ ...p, [action.id]: result.plan }))
      setExpanded(action.id)
      // The action's status changes away from 'pending_approval', so it may
      // immediately disappear from the currently viewed tab/list once we
      // refetch below - show the plan here too so it's never missed.
      if (result.plan) {
        setJustApproved({ action, plan: result.plan })
        toast.success('Action approved — healing plan generated!')
      } else {
        toast.success(`Sign-off recorded. Still waiting on: ${result.pending_roles?.join(', ')}`)
      }
      fetchPending()
      fetchAll()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Approval failed')
    }
  }

  const handleReject = async () => {
    try {
      await reject(rejectModal.id, rejectReason)
      toast.success('Action rejected')
      setRejectModal(null)
      setRejectReason('')
      fetchPending()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Rejection failed')
    }
  }

  const handleComplete = async (action, success) => {
    try {
      await complete(action.id, success, '')
      toast.success(success ? 'Marked as completed!' : 'Marked as failed')
      fetchPending()
      fetchAll()
    } catch (err) {
      toast.error('Failed to update status')
    }
  }

  const handleExecute = async (action) => {
    try {
      const updated = await execute(action.id)
      toast[updated.status === 'completed' ? 'success' : 'error'](
        updated.status === 'completed' ? 'Executed remotely — completed!' : 'Executed remotely — command failed.'
      )
      fetchPending()
      fetchAll()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Remote execution failed')
    }
  }

  const openManualCommand = (action) => {
    setManualCommandFor(action.id)
    // Pre-fill with the LLM-suggested command (if any) - still editable, and
    // still requires the human to review and click "Run on VM" themselves.
    setManualCommand(action.commands?.[0] || '')
    setManualTarget(action.target_host || '')
  }

  const handleExecuteManual = async (action) => {
    if (!manualCommand.trim()) return toast.error('Enter a command to run')
    try {
      const updated = await executeManual(action.id, manualCommand.trim(), manualTarget || undefined)
      toast[updated.status === 'completed' ? 'success' : 'error'](
        updated.status === 'completed' ? 'Manual command executed — completed!' : 'Manual command executed — failed.'
      )
      setManualCommandFor(null)
      setManualCommand('')
      fetchPending()
      fetchAll()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Manual execution failed')
    }
  }

  const displayActions = (tab === 'pending' ? pendingActions : allActions).filter(a => {
    if (urlStatus && a.status !== urlStatus) return false
    if (urlLevel && a.approval_level !== urlLevel) return false
    return true
  })

  const toggleExpand = async (action) => {
    if (expanded === action.id) {
      setExpanded(null)
      return
    }
    setExpanded(action.id)
    if (action.plan_id && !plan[action.id]) {
      try {
        const { data } = await api.get(`/approvals/${action.id}/plan`)
        setPlan(p => ({ ...p, [action.id]: data }))
      } catch (err) {
        // No plan yet or not found - fine, section just won't render
      }
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Approval Workflow</h1>
        {(urlStatus || urlLevel) && (
          <button onClick={clearDeepLinkFilter} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white bg-gray-800 px-3 py-1.5 rounded-lg">
            <X size={14} />
            Filtered by {urlStatus && `status: ${urlStatus.replace('_', ' ')}`}{urlLevel && `level: ${urlLevel}`} — clear
          </button>
        )}
      </div>

      {/* Level legend */}
      <div className="card grid grid-cols-3 gap-4 text-center text-sm">
        <div>
          <ApprovalLevelBadge level="L1" />
          <p className="text-gray-400 mt-1 text-xs">Auto-approved. Low severity, safe operations (clear cache, alert only).</p>
        </div>
        <div>
          <ApprovalLevelBadge level="L2" />
          <p className="text-gray-400 mt-1 text-xs">Requires Service Delivery Manager. Medium severity actions (restarts, config changes).</p>
        </div>
        <div>
          <ApprovalLevelBadge level="L3" />
          <p className="text-gray-400 mt-1 text-xs">Requires SDM, Service Manager & Incident Manager (all three). High severity (scale, rollback, credentials).</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-800">
        {['pending', 'all'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-indigo-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            {t === 'pending' ? `Pending (${pendingActions.length})` : 'All Actions'}
          </button>
        ))}
      </div>

      {justApproved && (
        <div className="card border border-indigo-800/50 relative">
          <button
            onClick={() => setJustApproved(null)}
            className="absolute top-3 right-3 text-gray-500 hover:text-white"
          >
            <X size={16} />
          </button>
          <p className="text-xs text-indigo-400 uppercase font-semibold mb-1">Just Approved — Healing Plan</p>
          <p className="text-sm font-semibold text-white mb-3">{justApproved.action.title}</p>
          <div className="space-y-2">
            {justApproved.plan?.execution_steps?.map(step => (
              <div key={step.step} className="bg-gray-950 rounded-lg p-3">
                <p className="text-xs text-indigo-400 font-semibold mb-1">Step {step.step}: {step.description}</p>
                <p className="text-xs font-mono text-green-300">$ {step.command}</p>
                <p className="text-xs text-gray-500 mt-1">Expected: {step.expected_output}</p>
              </div>
            ))}
          </div>
          {justApproved.plan?.health_check && (
            <div className="mt-2 bg-gray-950 rounded-lg p-3">
              <p className="text-xs text-gray-400 font-semibold mb-1">Health Check</p>
              <p className="text-xs font-mono text-cyan-300">$ {justApproved.plan.health_check.command}</p>
            </div>
          )}
        </div>
      )}

      {isLoading && <p className="text-gray-400 animate-pulse">Loading...</p>}

      {!isLoading && displayActions.length === 0 && (
        <div className="card text-center py-12">
          <CheckCircle className="mx-auto text-gray-600 mb-3" size={40} />
          <p className="text-gray-400">No actions requiring your approval.</p>
        </div>
      )}

      <div className="space-y-3">
        {displayActions.map(action => (
          <div key={action.id} className="card">
            <div className="flex items-start gap-4">
              <button
                onClick={() => toggleExpand(action)}
                className="mt-1"
              >
                {expanded === action.id
                  ? <ChevronDown className="text-gray-400" size={18} />
                  : <ChevronRight className="text-gray-400" size={18} />
                }
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <ApprovalLevelBadge level={action.approval_level} />
                  <StatusBadge status={action.status} />
                  {action.auto_executed && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-900/40 text-cyan-300 border border-cyan-800/50">
                      Auto-healed via SSH
                    </span>
                  )}
                  {action.remotely_executed && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-900/40 text-indigo-300 border border-indigo-800/50">
                      Executed remotely via SSH
                    </span>
                  )}
                  {action.manually_executed && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-300 border border-amber-800/50">
                      Manual command executed
                    </span>
                  )}
                  <span className="text-sm font-semibold text-white">{action.title}</span>
                </div>
                <p className="text-xs text-gray-400">{action.description}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {formatDistanceToNow(new Date(action.created_at), { addSuffix: true })}
                  {action.approved_by && ` · Approved by ${action.approved_by}`}
                  {action.rejected_by && ` · Rejected by ${action.rejected_by}`}
                </p>
                {action.approval_level === 'L3' && action.status === 'pending_approval' && (
                  <p className="text-xs text-gray-500 mt-1">
                    Sign-off: {REQUIRED_ROLES.L3.map(r => (
                      `${ROLE_LABELS[r]} ${(action.approvals || []).some(a => a.role === r) ? '✓' : '…'}`
                    )).join('   ')}
                  </p>
                )}
              </div>

              {/* Action buttons */}
              {action.status === 'pending_approval' && REQUIRED_ROLES[action.approval_level]?.includes(user?.role)
                && !(action.approvals || []).some(a => a.role === user?.role) && (
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleApprove(action)}
                    className="flex items-center gap-1 text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <CheckCircle size={14} /> Approve
                  </button>
                  <button
                    onClick={() => setRejectModal(action)}
                    className="flex items-center gap-1 text-xs bg-red-800 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <XCircle size={14} /> Reject
                  </button>
                </div>
              )}

              {(action.status === 'approved' || action.status === 'auto_approved') && (
                <div className="flex gap-2 shrink-0">
                  {action.remote_executable && (
                    <button
                      onClick={() => handleExecute(action)}
                      className="flex items-center gap-1 text-xs bg-indigo-700 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-lg transition-colors"
                      title="Runs the fixed operator-configured command for this action type over SSH (never the AI-suggested commands)"
                    >
                      <Zap size={14} /> Execute Now
                    </button>
                  )}
                  {action.manual_execution_available && action.action_type !== 'rotate_credentials' && (
                    <button
                      onClick={() => openManualCommand(action)}
                      className="flex items-center gap-1 text-xs bg-amber-800 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg transition-colors"
                      title="Addon: type an exact command to run on the target VM yourself"
                    >
                      <Terminal size={14} /> Manual Command
                    </button>
                  )}
                  <button
                    onClick={() => handleComplete(action, true)}
                    className="text-xs bg-green-800 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Mark Done
                  </button>
                  <button
                    onClick={() => handleComplete(action, false)}
                    className="text-xs bg-red-900 hover:bg-red-800 text-white px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Mark Failed
                  </button>
                </div>
              )}
            </div>

            {/* Manual command entry (addon) */}
            {manualCommandFor === action.id && (
              <div className="mt-4 pt-4 border-t border-gray-800 space-y-2">
                <p className="text-xs text-amber-400 uppercase font-semibold">Manual Command (addon) — you are responsible for what you run</p>
                <div className="flex gap-2 flex-wrap">
                  <select
                    value={manualTarget}
                    onChange={e => setManualTarget(e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white"
                  >
                    <option value="">{action.target_host || 'default'} (this action's target)</option>
                    {targets.filter(t => t !== action.target_host).map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <input
                    value={manualCommand}
                    onChange={e => setManualCommand(e.target.value)}
                    placeholder="e.g. sudo systemctl restart myapp"
                    className="flex-1 min-w-[220px] bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs font-mono text-white"
                  />
                  <button
                    onClick={() => handleExecuteManual(action)}
                    className="text-xs bg-amber-700 hover:bg-amber-600 text-white px-3 py-2 rounded-lg transition-colors"
                  >
                    Run on VM
                  </button>
                  <button
                    onClick={() => setManualCommandFor(null)}
                    className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-2 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Expanded: show plan */}
            {expanded === action.id && (
              <div className="mt-4 pt-4 border-t border-gray-800 space-y-4">
                {/* Action detail */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-gray-400 uppercase mb-1">Action Type</p>
                    <p className="font-mono text-indigo-300">{action.action_type}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 uppercase mb-1">Risk Level</p>
                    <p className="font-medium text-amber-300">{action.risk_level}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-gray-400 uppercase mb-1">Approval Reason</p>
                    <p className="text-gray-300 text-sm">{action.approval_reason}</p>
                  </div>
                </div>

                {/* Auto-execution result (fully automatic, no human trigger) */}
                {action.auto_executed && (
                  <div>
                    <p className="text-xs text-gray-400 uppercase mb-1 flex items-center gap-1">
                      <Terminal size={12} /> Auto-executed Command
                    </p>
                    <div className="bg-gray-950 rounded-lg p-3 space-y-1">
                      <p className="text-xs font-mono text-cyan-300">$ {action.executed_command}</p>
                      {action.execution_result?.stdout && (
                        <p className="text-xs font-mono text-green-400 whitespace-pre-wrap">{action.execution_result.stdout}</p>
                      )}
                      {action.execution_result?.stderr && (
                        <p className="text-xs font-mono text-red-400 whitespace-pre-wrap">{action.execution_result.stderr}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Remote execution result (human clicked "Execute Now" after approval) */}
                {action.remotely_executed && (
                  <div>
                    <p className="text-xs text-gray-400 uppercase mb-1 flex items-center gap-1">
                      <Zap size={12} /> Remotely Executed Command
                    </p>
                    <div className="bg-gray-950 rounded-lg p-3 space-y-1">
                      <p className="text-xs font-mono text-indigo-300">$ {action.executed_command}</p>
                      {action.execution_result?.stdout && (
                        <p className="text-xs font-mono text-green-400 whitespace-pre-wrap">{action.execution_result.stdout}</p>
                      )}
                      {action.execution_result?.stderr && (
                        <p className="text-xs font-mono text-red-400 whitespace-pre-wrap">{action.execution_result.stderr}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Manual command result (human typed an exact command - addon) */}
                {action.manually_executed && (
                  <div>
                    <p className="text-xs text-gray-400 uppercase mb-1 flex items-center gap-1">
                      <Terminal size={12} /> Manually Executed Command
                    </p>
                    <div className="bg-gray-950 rounded-lg p-3 space-y-1">
                      <p className="text-xs font-mono text-amber-300">$ {action.executed_command}</p>
                      {action.execution_result?.stdout && (
                        <p className="text-xs font-mono text-green-400 whitespace-pre-wrap">{action.execution_result.stdout}</p>
                      )}
                      {action.execution_result?.stderr && (
                        <p className="text-xs font-mono text-red-400 whitespace-pre-wrap">{action.execution_result.stderr}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Commands */}
                {action.commands?.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 uppercase mb-1 flex items-center gap-1">
                      <Terminal size={12} /> Suggested Commands
                    </p>
                    <div className="bg-gray-950 rounded-lg p-3 space-y-1">
                      {action.commands.map((cmd, i) => (
                        <p key={i} className="text-xs font-mono text-green-300">$ {cmd}</p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Healing plan (after approval) */}
                {plan[action.id] && (
                  <div>
                    <p className="text-xs text-gray-400 uppercase mb-2">Healing Plan</p>
                    <div className="space-y-2">
                      {plan[action.id].execution_steps?.map(step => (
                        <div key={step.step} className="bg-gray-950 rounded-lg p-3">
                          <p className="text-xs text-indigo-400 font-semibold mb-1">Step {step.step}: {step.description}</p>
                          <p className="text-xs font-mono text-green-300">$ {step.command}</p>
                          <p className="text-xs text-gray-500 mt-1">Expected: {step.expected_output}</p>
                        </div>
                      ))}
                    </div>

                    {plan[action.id].health_check && (
                      <div className="mt-2 bg-gray-950 rounded-lg p-3">
                        <p className="text-xs text-gray-400 font-semibold mb-1">Health Check</p>
                        <p className="text-xs font-mono text-cyan-300">$ {plan[action.id].health_check.command}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* No plan yet - explain why, so it's clear this isn't a bug */}
                {!plan[action.id] && !action.auto_executed && action.status === 'pending_approval' && (
                  <p className="text-xs text-gray-500 italic">
                    A healing plan is generated once this action is approved.
                  </p>
                )}
                {!plan[action.id] && action.auto_executed && (
                  <p className="text-xs text-gray-500 italic">
                    No healing plan was generated — the self-healing engine ran the fixed command above directly, skipping the manual plan/approval step.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Reject Modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="card max-w-md w-full space-y-4">
            <h2 className="text-lg font-bold text-white">Reject Action</h2>
            <p className="text-sm text-gray-400">Rejecting: <span className="text-white">{rejectModal.title}</span></p>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Reason for rejection (optional)"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white resize-none"
            />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setRejectModal(null)} className="btn-ghost text-sm">Cancel</button>
              <button onClick={handleReject} className="btn-danger text-sm">Confirm Reject</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
