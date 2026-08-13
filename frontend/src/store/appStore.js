import { create } from 'zustand'
import api from '../services/api'

export const useDashboardStore = create((set) => ({
  stats: null,
  isLoading: false,

  fetchStats: async () => {
    set({ isLoading: true })
    try {
      const { data } = await api.get('/dashboard/stats')
      set({ stats: data, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },
}))

export const useLogsStore = create((set) => ({
  analyses: [],
  current: null,
  isLoading: false,
  isUploading: false,
  isCollecting: false,
  isCheckingServices: false,
  isCheckingDefunct: false,

  fetchAnalyses: async () => {
    set({ isLoading: true })
    const { data } = await api.get('/logs')
    set({ analyses: data.data, isLoading: false })
  },

  fetchAnalysis: async (id) => {
    set({ isLoading: true })
    const { data } = await api.get(`/logs/${id}`)
    set({ current: data, isLoading: false })
  },

  uploadLog: async (file, source, environment, targetHost) => {
    set({ isUploading: true })
    const form = new FormData()
    form.append('logfile', file)
    form.append('source', source)
    form.append('environment', environment)
    if (targetHost) form.append('target_host', targetHost)
    try {
      const { data } = await api.post('/logs/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      set((s) => ({ analyses: [data, ...s.analyses], isUploading: false }))
      return data
    } catch (err) {
      set({ isUploading: false })
      throw err
    }
  },

  ingestLogs: async (logs, source, environment, targetHost) => {
    set({ isUploading: true })
    try {
      const { data } = await api.post('/logs/ingest', { logs, source, environment, target_host: targetHost })
      set((s) => ({ analyses: [data, ...s.analyses], isUploading: false }))
      return data
    } catch (err) {
      set({ isUploading: false })
      throw err
    }
  },

  // Triggers the automatic log-collection agent to poll all configured VMs
  // (host1, host2, ...) right now instead of waiting for its next interval.
  collectNow: async () => {
    set({ isCollecting: true })
    try {
      const { data } = await api.post('/logs/collect')
      return data.data
    } finally {
      set({ isCollecting: false })
    }
  },

  // Triggers the service monitor to check systemd service status on all
  // configured VMs right now (systemctl is-active - read-only).
  checkServicesNow: async () => {
    set({ isCheckingServices: true })
    try {
      const { data } = await api.post('/logs/check-services')
      return data.data
    } finally {
      set({ isCheckingServices: false })
    }
  },

  // Triggers the defunct-process monitor to scan all configured VMs for
  // zombie ('Z' state) processes right now (ps -eo pid,ppid,stat,comm - read-only).
  checkDefunctNow: async () => {
    set({ isCheckingDefunct: true })
    try {
      const { data } = await api.post('/logs/check-defunct')
      return data.data
    } finally {
      set({ isCheckingDefunct: false })
    }
  },

  // Asks a natural-language question about previously ingested logs/anomalies.
  // Retrieval + LLM answering happens server-side; `history` (recent Q&A
  // turns from this chat) lets follow-up questions carry context.
  queryLogs: async (question, targetHost, history) => {
    const { data } = await api.post('/logs/query', { question, target_host: targetHost || undefined, history })
    return data
  },

  // Wipes all analyses/anomalies/actions/approvals/plans/audit history
  // (demo users untouched) so the dashboard/log history starts fresh.
  clearAllData: async () => {
    await api.delete('/logs/all')
    set({ analyses: [], current: null })
  },
}))

export const useAnomaliesStore = create((set) => ({
  anomalies: [],
  current: null,
  isLoading: false,

  fetchAnomalies: async (filters = {}) => {
    set({ isLoading: true })
    const params = new URLSearchParams(filters).toString()
    const { data } = await api.get(`/anomalies?${params}`)
    set({ anomalies: data.data, isLoading: false })
  },

  fetchAnomaly: async (id) => {
    const { data } = await api.get(`/anomalies/${id}`)
    set({ current: data })
    return data
  },
}))

export const useApprovalsStore = create((set) => ({
  pendingActions: [],
  allActions: [],
  targets: [],
  isLoading: false,

  fetchPending: async () => {
    set({ isLoading: true })
    const { data } = await api.get('/approvals?status=pending_approval')
    set({ pendingActions: data.data, isLoading: false })
  },

  fetchAll: async () => {
    set({ isLoading: true })
    try {
      const { data } = await api.get('/approvals/all')
      set({ allActions: data.data, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  fetchTargets: async () => {
    try {
      const { data } = await api.get('/approvals/targets')
      set({ targets: data.data })
    } catch {
      // Non-critical - manual/remote execution UI just won't offer a dropdown
    }
  },

  approve: async (actionId) => {
    const { data } = await api.post(`/approvals/${actionId}/approve`)
    return data
  },

  reject: async (actionId, reason) => {
    const { data } = await api.post(`/approvals/${actionId}/reject`, { reason })
    return data
  },

  complete: async (actionId, success, notes) => {
    const { data } = await api.post(`/approvals/${actionId}/complete`, { success, notes })
    return data
  },

  execute: async (actionId) => {
    const { data } = await api.post(`/approvals/${actionId}/execute`)
    return data
  },

  executeManual: async (actionId, command, target) => {
    const { data } = await api.post(`/approvals/${actionId}/execute-manual`, { command, target })
    return data
  },
}))