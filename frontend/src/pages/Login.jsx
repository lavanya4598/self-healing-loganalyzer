import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { Activity } from 'lucide-react'

export default function Login() {
  const { login, isLoading, error } = useAuthStore()
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: '', password: '' })

  const handleSubmit = async (e) => {
    e.preventDefault()
    const ok = await login(form.username, form.password)
    if (ok) navigate('/')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Activity className="text-indigo-400" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-white">Self-Healing Log Analyser</h1>
          <p className="text-gray-400 text-sm mt-1">Sign in to your account</p>
        </div>

        <div className="card space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Username</label>
              <input
                type="text"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                required
                autoComplete="username"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                placeholder="admin"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
                autoComplete="current-password"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                placeholder="••••••••"
              />
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full btn-primary disabled:opacity-50"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="border-t border-gray-800 pt-3">
            <p className="text-xs text-gray-500 text-center mb-2">Demo accounts (password: password123)</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { username: 'appsupport', role: 'Application Support' },
                { username: 'sdm', role: 'Service Delivery Manager' },
                { username: 'sm', role: 'Service Manager' },
                { username: 'im', role: 'Incident Manager' },
              ].map(u => (
                <button
                  key={u.username}
                  onClick={() => setForm({ username: u.username, password: 'password123' })}
                  className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1.5 rounded text-left transition-colors"
                >
                  <span className="font-mono">{u.username}</span>
                  <span className="text-gray-500 ml-1">· {u.role}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
