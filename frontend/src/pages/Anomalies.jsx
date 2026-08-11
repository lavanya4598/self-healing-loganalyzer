import { useEffect, useState } from 'react'
import { useAnomaliesStore } from '../store/appStore'
import { SeverityBadge, StatusBadge, ApprovalLevelBadge } from '../components/Badges'
import { AlertTriangle, ChevronDown, ChevronRight, Download, X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useSearchParams } from 'react-router-dom'
import api from '../services/api'
import { useWebSocket } from '../services/websocket'

export default function Anomalies() {
  const { anomalies, fetchAnomalies, isLoading } = useAnomaliesStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const [expanded, setExpanded] = useState(null)
  const [filter, setFilter] = useState({
    severity: searchParams.get('severity') || '',
    status: searchParams.get('status') || '',
  })
  const [report, setReport] = useState(null)

  const batchId = searchParams.get('batch_id')
  const keyword = searchParams.get('keyword')

  useEffect(() => {
    fetchAnomalies({ ...(batchId ? { batch_id: batchId } : {}), ...(keyword ? { keyword } : {}) })
    setFilter({
      severity: searchParams.get('severity') || '',
      status: searchParams.get('status') || '',
    })
  }, [searchParams, fetchAnomalies])

  // Live-refresh when a new analysis completes (manual upload or the
  // automatic log-collection agent), so newly detected anomalies show up
  // without needing a manual page refresh.
  useWebSocket((msg) => {
    if (msg.type === 'analysis_complete') {
      fetchAnomalies({ ...(batchId ? { batch_id: batchId } : {}), ...(keyword ? { keyword } : {}) })
    }
  })

  useEffect(() => {
    if (!batchId) return setReport(null)
    api.get(`/logs/${batchId}`).then(res => setReport(res.data)).catch(() => setReport(null))
  }, [batchId])

  const filtered = anomalies.filter(a => {
    if (filter.severity && a.severity !== filter.severity) return false
    if (filter.status && a.status !== filter.status) return false
    return true
  })

  const downloadReport = () => {
    const lines = []
    lines.push(`Self-Healing Log Analyser — Report`)
    lines.push(`Generated: ${new Date().toISOString()}`)
    if (report) {
      lines.push(`Source: ${report.source || 'n/a'}`)
      lines.push(`Environment: ${report.environment || 'n/a'}`)
      lines.push(`Analyzed at: ${report.uploadedAt || report.ingestedAt || 'n/a'}`)
      lines.push(`Health score: ${report.analysis?.health_score ?? 'n/a'}/100`)
      lines.push(`Summary: ${report.analysis?.summary || 'n/a'}`)
    }
    lines.push('');
    lines.push(`Anomalies found: ${filtered.length}`)
    lines.push('='.repeat(60))
    filtered.forEach((a, i) => {
      lines.push('');
      lines.push(`${i + 1}. [${a.severity.toUpperCase()}] ${a.title} (status: ${a.status})`)
      lines.push(`   Description: ${a.description}`)
      lines.push(`   Root cause: ${a.root_cause}`)
      lines.push(`   Affected components: ${(a.affected_components || []).join(', ') || 'n/a'}`)
      lines.push(`   Confidence: ${Math.round((a.confidence || 0) * 100)}%`)
      if (a.log_references?.length) {
        lines.push(`   Log references:`)
        a.log_references.forEach(ref => lines.push(`     - ${ref}`))
      }
    })

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `anomaly-report${batchId ? `-${batchId}` : ''}.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-white">Anomalies</h1>
          {keyword && (
            <button
              onClick={() => { const p = new URLSearchParams(searchParams); p.delete('keyword'); setSearchParams(p) }}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-white bg-gray-800 px-3 py-1.5 rounded-lg"
            >
              <X size={14} />
              Matching "{keyword}" in logs — clear
            </button>
          )}
        </div>
        <div className="flex gap-3">
          <select
            value={filter.severity}
            onChange={e => setFilter(f => ({ ...f, severity: e.target.value }))}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
          >
            <option value="">All Severities</option>
            {['critical', 'high', 'medium', 'low'].map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          <select
            value={filter.status}
            onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
          >
            <option value="">All Statuses</option>
            {['open', 'in_progress', 'resolved', 'dismissed'].map(s => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>
          <button onClick={downloadReport} disabled={filtered.length === 0} className="btn-ghost flex items-center gap-2 text-sm disabled:opacity-50">
            <Download size={16} />
            Download Report
          </button>
        </div>
      </div>

      {report && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs text-gray-400 font-semibold uppercase mb-1">Batch Summary</p>
              <p className="text-sm text-gray-200">{report.analysis?.summary || 'No summary available.'}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-gray-400 uppercase">Health Score</p>
              <p className={`text-2xl font-bold ${
                (report.analysis?.health_score ?? 100) >= 80 ? 'text-green-400'
                  : (report.analysis?.health_score ?? 100) >= 50 ? 'text-amber-400'
                    : 'text-red-400'
              }`}>
                {report.analysis?.health_score ?? 'n/a'}
              </p>
            </div>
          </div>
          <div className="flex gap-4 text-xs text-gray-400 flex-wrap">
            <span>Source: <span className="text-gray-300">{report.source || 'n/a'}</span></span>
            <span>Environment: <span className="text-gray-300">{report.environment || 'n/a'}</span></span>
            <span>Lines analysed: <span className="text-gray-300">{report.lineCount ?? 'n/a'}</span></span>
            {report.analysis?.mock === false && <span className="text-indigo-400">LLM-analysed ({report.analysis?.provider}/{report.analysis?.model})</span>}
            {report.analysis?.mock !== false && <span className="text-gray-500">Rule-based (mock) analysis</span>}
          </div>
        </div>
      )}

      {isLoading && <p className="text-gray-400 animate-pulse">Loading anomalies...</p>}
      {!isLoading && filtered.length === 0 && (
        <div className="card text-center py-12">
          <AlertTriangle className="mx-auto text-gray-600 mb-3" size={40} />
          <p className="text-gray-400">No anomalies found. Upload logs to start analysis.</p>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map(anomaly => (
          <div key={anomaly.id} className="card">
            <button
              className="w-full flex items-start gap-4 text-left"
              onClick={() => setExpanded(expanded === anomaly.id ? null : anomaly.id)}
            >
              <div className="mt-0.5">
                {expanded === anomaly.id
                  ? <ChevronDown className="text-gray-400" size={18} />
                  : <ChevronRight className="text-gray-400" size={18} />
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap mb-1">
                  <SeverityBadge severity={anomaly.severity} />
                  <StatusBadge status={anomaly.status} />
                  <span className="text-sm font-semibold text-white">{anomaly.title}</span>
                </div>
                <p className="text-xs text-gray-400 truncate">{anomaly.description}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-gray-500">
                  {formatDistanceToNow(new Date(anomaly.created_at), { addSuffix: true })}
                </p>
                <p className="text-xs text-indigo-400 mt-0.5">
                  Confidence {Math.round((anomaly.confidence || 0) * 100)}%
                </p>
              </div>
            </button>

            {expanded === anomaly.id && (
              <div className="mt-4 pt-4 border-t border-gray-800 space-y-4">
                {/* Root cause */}
                <div>
                  <p className="text-xs text-gray-400 font-semibold uppercase mb-1">Root Cause</p>
                  <p className="text-sm text-gray-200">{anomaly.root_cause}</p>
                </div>

                {/* Affected components */}
                {anomaly.affected_components?.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 font-semibold uppercase mb-1">Affected Components</p>
                    <div className="flex gap-2 flex-wrap">
                      {anomaly.affected_components.map(c => (
                        <span key={c} className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded">{c}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Log references */}
                {anomaly.log_references?.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 font-semibold uppercase mb-1">Log References</p>
                    <div className="bg-gray-950 rounded-lg p-3 space-y-1">
                      {anomaly.log_references.map((ref, i) => (
                        <p key={i} className="text-xs font-mono text-red-300">{ref}</p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Healing actions */}
                {anomaly.actions?.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 font-semibold uppercase mb-2">Healing Actions</p>
                    <div className="space-y-2">
                      {anomaly.actions.map(action => (
                        <div key={action.id} className="bg-gray-800 rounded-lg p-3 flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <ApprovalLevelBadge level={action.approval_level} />
                              <StatusBadge status={action.status} />
                              {action.auto_executed && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-900/40 text-cyan-300 border border-cyan-800/50">
                                  Auto-healed via SSH
                                </span>
                              )}
                              <span className="text-sm text-white">{action.title}</span>
                            </div>
                            <p className="text-xs text-gray-400">{action.description}</p>
                            {action.auto_executed && (
                              <div className="mt-2 bg-gray-950 rounded-lg p-2 space-y-1">
                                <p className="text-xs font-mono text-gray-300">$ {action.executed_command}</p>
                                {action.execution_result?.stdout && (
                                  <p className="text-xs font-mono text-green-400 whitespace-pre-wrap">{action.execution_result.stdout}</p>
                                )}
                                {action.execution_result?.stderr && (
                                  <p className="text-xs font-mono text-red-400 whitespace-pre-wrap">{action.execution_result.stderr}</p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
