import { useEffect } from 'react'
import api from '../services/api'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

export default function AuditTrail() {
  const [events, setEvents] = useState([])
  const [total, setTotal] = useState(0)
  const [searchParams, setSearchParams] = useSearchParams()
  const eventFilter = searchParams.get('event')

  useEffect(() => {
    api.get('/dashboard/audit?limit=100').then(({ data }) => {
      setEvents(data.data)
      setTotal(data.total)
    })
  }, [])

  const EVENT_COLORS = {
    log_uploaded: 'text-blue-400',
    log_ingested: 'text-blue-400',
    anomaly_status_changed: 'text-amber-400',
    action_approved: 'text-green-400',
    action_rejected: 'text-red-400',
    healing_completed: 'text-emerald-400',
    healing_failed: 'text-red-500',
    ws_connected: 'text-cyan-400',
    ws_disconnected: 'text-gray-500',
    self_healing_executed: 'text-cyan-400',
    self_healing_failed: 'text-red-500',
    remote_execution_completed: 'text-cyan-400',
    remote_execution_failed: 'text-red-500',
  }

  const displayEvents = eventFilter ? events.filter(e => e.event === eventFilter) : events

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Audit Trail</h1>
        <div className="flex items-center gap-3">
          {eventFilter && (
            <button onClick={() => setSearchParams({})} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white bg-gray-800 px-3 py-1.5 rounded-lg">
              <X size={14} />
              Filtered by: {eventFilter} — clear
            </button>
          )}
          <span className="text-sm text-gray-400">{total} total events</span>
        </div>
      </div>

      <div className="card">
        <div className="space-y-0">
          {displayEvents.map((entry, i) => (
            <div
              key={i}
              className="flex items-start gap-4 py-3 border-b border-gray-800 last:border-0 text-sm"
            >
              <span className={`font-mono text-xs w-40 shrink-0 ${EVENT_COLORS[entry.event] || 'text-gray-400'}`}>
                {entry.event}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-gray-300">
                  <span className="text-white font-medium">{entry.user || 'system'}</span>
                  {entry.batchId && <span className="text-gray-500"> · batch {entry.batchId?.slice(0, 8)}…</span>}
                  {entry.action_id && <span className="text-gray-500"> · action {entry.action_id?.slice(0, 8)}…</span>}
                  {entry.reason && <span className="text-red-400"> · "{entry.reason}"</span>}
                  {entry.message && <span className="text-gray-500"> · {entry.message}</span>}
                  {entry.command && <span className="text-gray-500 font-mono"> · $ {entry.command}</span>}
                </p>
              </div>
              <span className="text-xs text-gray-500 shrink-0">
                {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
              </span>
            </div>
          ))}
          {displayEvents.length === 0 && <p className="text-gray-500 text-sm py-4">No audit events yet.</p>}
        </div>
      </div>
    </div>
  )
}
