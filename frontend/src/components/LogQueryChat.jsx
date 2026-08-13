import { useRef, useState } from 'react'
import { Sparkles, Send, Loader2, Paperclip, X } from 'lucide-react'
import { useLogsStore } from '../store/appStore'

const ACCEPTED_EXTENSIONS = '.log,.txt,.json,.csv'
const MAX_FILE_BYTES = 10 * 1024 * 1024
// If the typed/pasted message has more non-empty lines than this, treat it
// as raw log content to analyse instead of a question - a real question is
// almost always a single line, while a log paste is usually many.
const LOG_PASTE_LINE_THRESHOLD = 2

// ChatGPT-style single input: type a question, paste raw log lines, or
// attach a log file - all through the same box. Retrieval + LLM answering
// happens server-side (see POST /api/logs/query); pasted/attached logs
// reuse the same upload/ingest pipeline as the Log Upload page (see
// POST /api/logs/upload, /api/logs/ingest), tagged with the given
// source/environment/targetHost (e.g. from the Log Upload page's config).
export default function LogQueryChat({ source = 'chat', environment = 'production', targetHost } = {}) {
  const { queryLogs, uploadLog, ingestLogs } = useLogsStore()
  const [text, setText] = useState('')
  const [messages, setMessages] = useState([])
  const [isAsking, setIsAsking] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const fileInputRef = useRef(null)

  const recentHistory = () => messages.slice(-6).map((m) => ({ role: m.role === 'question' ? 'user' : 'assistant', text: m.text }))

  // Builds a detailed, per-anomaly breakdown (what happened, when, root
  // cause, suggested next steps) straight from the structured analysis
  // result - works the same whether it came from the real LLM or the mock
  // fallback, since both return the same anomalies/healing_actions shape.
  const summarizeAnalysis = (label, result) => {
    const anomalies = result.analysis?.anomalies || []
    const actions = result.analysis?.healing_actions || []
    const healthScore = result.analysis?.health_score

    if (!anomalies.length) {
      setMessages((m) => [...m, {
        role: 'answer',
        text: `Analyzed ${label}: no anomalies found.${healthScore != null ? ` Health score: ${healthScore}/100.` : ''}`,
      }])
      return
    }

    const lines = [`Analyzed ${label}: ${anomalies.length} anomal${anomalies.length === 1 ? 'y' : 'ies'} found${healthScore != null ? ` (health score: ${healthScore}/100)` : ''}.`, '']
    anomalies.forEach((a, i) => {
      const action = actions.find((ac) => ac.anomaly_id === a.id)
      const timeMatch = (a.log_references?.[0] || '').match(/\[([^\]]+)\]/)
      lines.push(`${i + 1}. [${(a.severity || 'unknown').toUpperCase()}] ${a.title}`)
      if (timeMatch) lines.push(`   When: ${timeMatch[1]}`)
      if (a.root_cause) lines.push(`   Root cause: ${a.root_cause}`)
      if (action) {
        const cmds = (action.commands || []).length ? ` → ${action.commands.join(' && ')}` : ''
        lines.push(`   Next steps: ${action.title}${cmds} (approval: ${action.approval_level})`)
      }
      lines.push('')
    })
    lines.push('Ask me anything about it.')

    setMessages((m) => [...m, { role: 'answer', text: lines.join('\n') }])
  }

  const askQuestion = async (q) => {
    const history = recentHistory()
    setMessages((m) => [...m, { role: 'question', text: q }])
    setIsAsking(true)
    try {
      const result = await queryLogs(q, undefined, history)
      setMessages((m) => [...m, { role: 'answer', text: result.answer, mock: result.mock }])
    } catch (err) {
      const detail = err.response?.data?.error || err.message || 'Query failed'
      setMessages((m) => [...m, { role: 'answer', text: detail, error: true }])
    } finally {
      setIsAsking(false)
    }
  }

  const analyzePastedLogs = async (lines) => {
    setMessages((m) => [...m, { role: 'question', text: `📋 Pasted ${lines.length} log line(s)` }])
    setIsAnalyzing(true)
    try {
      const result = await ingestLogs(lines, source, environment, targetHost || undefined)
      summarizeAnalysis('pasted logs', result)
    } catch (err) {
      const detail = err.response?.data?.error || err.message || 'Analysis failed'
      setMessages((m) => [...m, { role: 'answer', text: detail, error: true }])
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const raw = text.trim()
    if (!raw || isAsking || isAnalyzing) return
    setText('')

    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length > LOG_PASTE_LINE_THRESHOLD) {
      analyzePastedLogs(lines)
    } else {
      askQuestion(raw)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file || isAnalyzing) return

    if (file.size > MAX_FILE_BYTES) {
      setMessages((m) => [...m, { role: 'answer', text: `"${file.name}" is too large (max 10MB).`, error: true }])
      return
    }

    setMessages((m) => [...m, { role: 'question', text: `📎 Attached ${file.name}` }])
    setIsAnalyzing(true)
    try {
      const result = await uploadLog(file, source, environment, targetHost || undefined)
      summarizeAnalysis(file.name, result)
    } catch (err) {
      const detail = err.response?.data?.error || err.message || 'Upload failed'
      setMessages((m) => [...m, { role: 'answer', text: detail, error: true }])
    } finally {
      setIsAnalyzing(false)
    }
  }

  const busy = isAsking || isAnalyzing

  return (
    <div className="card flex flex-col">
      <h2 className="text-sm font-semibold text-gray-400 mb-4 flex items-center gap-2">
        <Sparkles size={16} className="text-indigo-400" />
        Ask AI About Your Logs
      </h2>

      <div className="space-y-3 max-h-64 overflow-y-auto mb-4">
        {messages.length === 0 && (
          <p className="text-gray-500 text-sm">
            Ask a question, paste raw log lines, or attach a file below - all in one box.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-sm rounded-lg px-3 py-2 whitespace-pre-wrap ${
              m.role === 'question'
                ? 'bg-indigo-950/40 text-indigo-200 ml-auto max-w-[85%]'
                : `bg-gray-800/60 text-gray-200 max-w-[85%] ${m.error ? 'border border-red-800/50 text-red-300' : ''}`
            }`}
          >
            {m.text}
            {m.mock && <span className="block mt-1 text-xs text-gray-500">(keyword match - AI service unavailable)</span>}
          </div>
        ))}
        {isAsking && (
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Loader2 size={14} className="animate-spin" /> Thinking…
          </div>
        )}
        {isAnalyzing && (
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Loader2 size={14} className="animate-spin" /> Analysing logs…
          </div>
        )}
      </div>

      <input ref={fileInputRef} type="file" accept={ACCEPTED_EXTENSIONS} className="hidden" onChange={handleFileChange} />

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Attach a log file"
          className="btn-ghost px-3 py-2.5 disabled:opacity-50 shrink-0"
          disabled={busy}
        >
          <Paperclip size={16} />
        </button>
        <div className="relative flex-1">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question, or paste log lines to analyse them..."
            rows={1}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-gray-500 resize-none max-h-40 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            disabled={busy}
            style={{ height: 'auto' }}
            onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px` }}
          />
          {text && !busy && (
            <button
              type="button"
              onClick={() => setText('')}
              title="Clear"
              className="absolute right-2 top-2.5 text-gray-500 hover:text-gray-300"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button type="submit" className="btn-primary flex items-center gap-1 px-3 py-2.5 disabled:opacity-50 shrink-0" disabled={busy || !text.trim()}>
          <Send size={14} />
        </button>
      </form>
    </div>
  )
}
