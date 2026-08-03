import { useEffect, useRef, useCallback, useState } from 'react'
import { useAuthStore } from '../store/authStore'
import toast from 'react-hot-toast'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws'

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
        if (msg.type === 'analysis_complete') {
          toast.success('New log analysis completed!')
        } else if (msg.type === 'action_approved') {
          toast.success('Healing action approved — plan ready!')
        } else if (msg.type === 'healing_completed') {
          toast.success('Healing action completed successfully!')
        } else if (msg.type === 'healing_failed') {
          toast.error('Healing action failed.')
        }
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
