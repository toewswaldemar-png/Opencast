import { useState, useCallback } from 'react'
import { StreamConfig, StreamStatus, FormatInfo } from '../types'

interface UseStreamReturn {
  status: StreamStatus
  formats: FormatInfo[]
  error: string | null
  loading: boolean
  start: (cfg: StreamConfig) => Promise<void>
  stop: () => Promise<void>
  fetchFormats: () => Promise<void>
  updateStatus: (s: StreamStatus) => void
}

const DEFAULT_STATUS: StreamStatus = {
  running: false,
  connected: false,
  uptime: 0,
  bytesSent: 0,
  bitrate: 0,
  format: 'mp3',
}

export function useStream(): UseStreamReturn {
  const [status, setStatus] = useState<StreamStatus>(DEFAULT_STATUS)
  const [formats, setFormats] = useState<FormatInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const start = useCallback(async (cfg: StreamConfig) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Stream konnte nicht gestartet werden')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const stop = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/stream/stop', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Stream konnte nicht gestoppt werden')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchFormats = useCallback(async () => {
    try {
      const res = await fetch('/api/formats')
      if (res.ok) setFormats(await res.json())
    } catch {
      // ignore
    }
  }, [])

  const updateStatus = useCallback((s: StreamStatus) => setStatus(s), [])

  return { status, formats, error, loading, start, stop, fetchFormats, updateStatus }
}
