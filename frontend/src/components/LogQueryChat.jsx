import { useState } from 'react'
import { Sparkles, Send, Loader2 } from 'lucide-react'
import { useLogsStore } from '../store/appStore'

// Chat-style box for asking natural-language questions about previously
// ingested logs/anomalies. Retrieval + LLM answering happens server-side
// (see POST /api/logs/query); this component just renders the conversation.
export default function LogQueryChat() {
  const { queryLogs } = useLogsStore()
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([])
  const [isAsking, setIsAsking] = useState(false)

  const handleAsk = async (e) => {
    e.preventDefault()
    const q = question.trim()
    if (!q || isAsking) return

    // Send recent turns so follow-ups like "how can I fix that" carry context.
    const history = messages.slice(-6).map((m) => ({ role: m.role === 'question' ? 'user' : 'assistant', text: m.text }))

    setMessages((m) => [...m, { role: 'question', text: q }])
    setQuestion('')
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

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-400 mb-4 flex items-center gap-2">
        <Sparkles size={16} className="text-indigo-400" />
        Ask AI About Your Logs
      </h2>

      <div className="space-y-3 max-h-64 overflow-y-auto mb-4">
        {messages.length === 0 && (
          <p className="text-gray-500 text-sm">
            Ask things like "what happened on host1 recently?" or "why is the database failing?"
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-sm rounded-lg px-3 py-2 ${
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
      </div>

      <form onSubmit={handleAsk} className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question about your logs..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          disabled={isAsking}
        />
        <button type="submit" className="btn-primary flex items-center gap-1 px-3" disabled={isAsking || !question.trim()}>
          <Send size={14} />
        </button>
      </form>
    </div>
  )
}
