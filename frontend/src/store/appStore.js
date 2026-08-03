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

  uploadLog: async (file, source, environment) => {
    set({ isUploading: true })
    const form = new FormData()
    form.append('logfile', file)
    form.append('source', source)
    form.append('environment', environment)
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

  ingestLogs: async (logs, source, environment) => {
    set({ isUploading: true })
    try {
      const { data } = await api.post('/logs/ingest', { logs, source, environment })
      set((s) => ({ analyses: [data, ...s.analyses], isUploading: false }))
      return data
    } catch (err) {
      set({ isUploading: false })
      throw err
    }
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
}))