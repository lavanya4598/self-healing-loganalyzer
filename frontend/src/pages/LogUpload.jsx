import { useState, useCallback, useEffect } from 'react'
import { useLogsStore, useApprovalsStore } from '../store/appStore'
import { Upload, Play, FileText, CheckCircle, XCircle } from 'lucide-react'
import { SeverityBadge, StatusBadge } from '../components/Badges'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'

const DEMO_LOGS = [
  '[2024-03-15 09:01:12] ERROR DatabaseService: Connection timeout after 30s - host=db-primary:5432',
  '[2024-03-15 09:01:13] ERROR DatabaseService: Retry 1/3 failed - ECONNREFUSED',
  '[2024-03-15 09:01:14] ERROR DatabaseService: Retry 2/3 failed - ECONNREFUSED',
  '[2024-03-15 09:01:15] WARN  AppServer: Falling back to read-replica',
  '[2024-03-15 09:01:20] ERROR PaymentService: Transaction rollback - DB unavailable',
  '[2024-03-15 09:01:25] CRITICAL AlertManager: Payment processing DOWN - 0% success rate',
  '[2024-03-15 09:02:00] ERROR DiskMonitor: /var/log partition 95% full',
  '[2024-03-15 09:02:10] WARN  CacheService: Redis memory usage 89% - eviction starting',
  '[2024-03-15 09:02:15] INFO  HealthCheck: web-1 OK, web-2 OK, web-3 DEGRADED',
  '[2024-03-15 09:02:30] ERROR AuthService: JWT secret rotation failed - permission denied',
]

export default function LogUpload() {
  const { analyses, fetchAnalyses, uploadLog, ingestLogs, isUploading, isLoading } = useLogsStore()
  const { targets, fetchTargets } = useApprovalsStore()
  const [dragOver, setDragOver] = useState(false)
  const [source, setSource] = useState('manual-upload')
  const [environment, setEnvironment] = useState('production')
  const [targetHost, setTargetHost] = useState('')
  const [tab, setTab] = useState('upload')
  const [pasteText, setPasteText] = useState('')

  useState(() => { fetchAnalyses() }, [])
  useEffect(() => { fetchTargets() }, [fetchTargets])

  const handleFile = useCallback(async (file) => {
    try {
      const result = await uploadLog(file, source, environment, targetHost)
      toast.success(`Analysis complete: ${result.analysis.anomalies?.length ?? 0} anomalies found`)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed')
    }
  }, [uploadLog, source, environment, targetHost])

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handlePaste = async () => {
    const lines = pasteText.split('\n').filter(l => l.trim())
    if (!lines.length) return toast.error('No log lines to analyse')
    try {
      const result = await ingestLogs(lines, source, environment, targetHost)
      toast.success(`Analysis complete: ${result.analysis.anomalies?.length ?? 0} anomalies found`)
      setPasteText('')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ingest failed')
    }
  }

  const handleDemo = async () => {
    try {
      const result = await ingestLogs(DEMO_LOGS, 'demo', environment, targetHost)
      toast.success(`Demo analysis: ${result.analysis.anomalies?.length ?? 0} anomalies found`)
    } catch (err) {
      toast.error('Demo failed — is the AI service running?')
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Log Analysis</h1>
        <button onClick={handleDemo} className="btn-ghost flex items-center gap-2 text-sm">
          <Play size={16} />
          Run Demo
        </button>
      </div>

      {/* Config */}
      <div className="card grid grid-cols-3 gap-4">
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Source</label>
          <input
            value={source}
            onChange={e => setSource(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
            placeholder="e.g. payment-service"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Environment</label>
          <select
            value={environment}
            onChange={e => setEnvironment(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="production">Production</option>
            <option value="staging">Staging</option>
            <option value="development">Development</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Target Host (self-healing VM)</label>
          <select
            value={targetHost}
            onChange={e => setTargetHost(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="">Default</option>
            {targets.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <p className="text-[11px] text-gray-500 mt-1">Which VM approved healing actions for this batch run on.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-800">
        {['upload', 'paste'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-indigo-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            {t === 'upload' ? 'File Upload' : 'Paste Logs'}
          </button>
        ))}
      </div>

      {tab === 'upload' ? (
        <div
          className={`card border-2 border-dashed text-center cursor-pointer transition-colors ${
            dragOver ? 'border-indigo-500 bg-indigo-950/20' : 'border-gray-700'
          }`}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById('file-input').click()}
        >
          <input
            id="file-input"
            type="file"
            accept=".log,.txt,.json,.csv"
            className="hidden"
            onChange={e => e.target.files[0] && handleFile(e.target.files[0])}
          />
          <Upload className="mx-auto text-gray-500 mb-3" size={40} />
          <p className="text-gray-300 font-medium">Drop log file here or click to browse</p>
          <p className="text-gray-500 text-sm mt-1">Supports .log, .txt, .json, .csv (max 10MB)</p>
          {isUploading && <p className="text-indigo-400 mt-3 animate-pulse">Analysing... this may take a moment</p>}
        </div>
      ) : (
        <div className="card space-y-3">
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            rows={12}
            placeholder="Paste log lines here, one per line..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono resize-none"
          />
          <button
            onClick={handlePaste}
            disabled={isUploading || !pasteText.trim()}
            className="btn-primary disabled:opacity-50"
          >
            {isUploading ? 'Analysing...' : 'Analyse Logs'}
          </button>
        </div>
      )}

      {/* History */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-400 mb-4">Analysis History</h2>
        {analyses.length === 0 && <p className="text-gray-500 text-sm">No analyses yet. Upload or paste logs above.</p>}
        <div className="space-y-2">
          {analyses.map(a => (
            <Link
              key={a.id}
              to={`/anomalies?batch_id=${a.id}`}
              className="flex items-center gap-4 p-3 rounded-lg bg-gray-800 hover:bg-gray-750 transition-colors"
            >
              <FileText className="text-indigo-400 shrink-0" size={18} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{a.filename || a.source}</p>
                <p className="text-xs text-gray-400">{a.lineCount} lines · {a.environment}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-gray-400">
                  {formatDistanceToNow(new Date(a.uploadedAt || a.ingestedAt), { addSuffix: true })}
                </p>
                <p className="text-xs text-amber-400">
                  {a.analysis?.anomalies?.length ?? 0} anomalies
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
