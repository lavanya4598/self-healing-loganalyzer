import { useEffect, useRef, useCallback, useState } from 'react'
import { useAuthStore } from '../store/authStore'
import toast from 'react-hot-toast'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws'

// A single burst of events (e.g. the service monitor healing 8 down services
// at once) used to spam one toast per event. Instead, count same-type
// events arriving within a short window and show a single, updating toast
// (via a stable id, which react-hot-toast replaces in place rather than
// stacking) once the burst settles.
const TOAST_MESSAGES = {
  analysis_complete: { one: 'New log analysis completed!', many: (n) => `${n} new log analyses completed!`, kind: 'success' },
  action_approved: { one: 'Healing action approved — plan ready!', many: (n) => `${n} healing actions approved — plans ready!`, kind: 'success' },
  healing_completed: { one: 'Healing action completed successfully!', many: (n) => `${n} healing actions completed successfully!`, kind: 'success' },
  healing_failed: { one: 'Healing action failed.', many: (n) => `${n} healing actions failed.`, kind: 'error' },
}
const BURST_WINDOW_MS = 1200
const burstState = {}

function notifyBurst(type) {
  const spec = TOAST_MESSAGES[type]
  if (!spec) return

  const state = burstState[type] || (burstState[type] = { count: 0, timer: null })
  state.count += 1
  clearTimeout(state.timer)
  state.timer = setTimeout(() => {
    const message = state.count === 1 ? spec.one : spec.many(state.count)
    toast[spec.kind](message, { id: `ws-${type}` })
    state.count = 0
  }, BURST_WINDOW_MS)
}

export function useWebSocket(onEvent) {
  const ws = useRef(null)
  const { token } = useAuthStore()
  const closedByUs = useRef(false)
  const [status, setStatus] = useState('connecting')

  // Keep the latest callback in a ref so `connect` doesn't need to change
  // identity every render (which previously caused a reconnect storm).
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  const connect = useCallback(() => {
    if (!token) return

    setStatus('connecting')
    ws.current = new WebSocket(`${WS_URL}?token=${token}`)

    ws.current.onopen = () => {
      console.log('[WS] Connected')
      setStatus('connected')
    }

    ws.current.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        notifyBurst(msg.type)
        if (onEventRef.current) onEventRef.current(msg)
      } catch (e) {
        console.error('[WS] Parse error', e)
      }
    }

    ws.current.onclose = () => {
      setStatus('disconnected')
      if (closedByUs.current) return
      console.log('[WS] Disconnected — retrying in 5s')
      setTimeout(connect, 5000)
    }

    ws.current.onerror = (err) => {
      console.error('[WS] Error', err)
    }
  }, [token])

  useEffect(() => {
    closedByUs.current = false
    connect()
    return () => {
      closedByUs.current = true
      ws.current?.close()
    }
  }, [connect])

  return status
}
