import { useState, useCallback, useRef, useEffect } from 'react'

import AppHeader           from './components/AppHeader'
import StreamCard          from './components/StreamCard'
import StatusBar           from './components/StatusBar'
import GlobalSettingsDialog from './components/GlobalSettingsDialog'

import { useWebSocket } from './hooks/useWebSocket'
import { apiFetch }     from './lib/api'
import {
  ServerEntry, ServerConfig, EncoderConfig, StreamStatus,
  AllStreamStatus, LevelUpdate, WSPayload,
  makeServerEntry, DEFAULT_ENCODER,
} from './types'

const EMPTY_LEVELS: LevelUpdate = { left: -120, right: -120 }

export default function App() {
  const [servers, setServers]             = useState<ServerEntry[]>(() => [makeServerEntry('Hauptstream')])
  // Global encoder + device are only used as defaults for the monitor and new cards.
  const [encoderConfig, setEncoderConfig] = useState<EncoderConfig>(DEFAULT_ENCODER)
  const [selectedDevice, setSelectedDevice] = useState('')
  const [allStatuses, setAllStatuses]     = useState<AllStreamStatus>({})
  const [loadingIds, setLoadingIds]       = useState<Set<string>>(new Set())
  const [streamErrors, setStreamErrors]   = useState<Record<string, string>>({})
  const [wsConnected, setWsConnected]         = useState(false)
  const [clientConnected, setClientConnected] = useState(false)
  const [autoReconnect, setAutoReconnect]     = useState(true)
  const [settingsOpen, setSettingsOpen]   = useState(false)
  const [monitorEnabled, setMonitorEnabled] = useState(true)
  const [vuDecayMs, setVuDecayMs] = useState(() => {
    const s = localStorage.getItem('vuDecayMs')
    return s ? Math.max(100, Math.min(5000, Number(s))) : 1000
  })

  const handleVuDecayChange = (ms: number) => {
    setVuDecayMs(ms)
    localStorage.setItem('vuDecayMs', String(ms))
  }

  const vuDecayMsRef = useRef(vuDecayMs)
  vuDecayMsRef.current = vuDecayMs

  // Stable per-card level refs keyed by entry.id.
  // Each StreamCard always receives the same object so the VUMeter rAF loop
  // keeps reading the right target without being remounted.
  // Monitor levels are written to all idle cards; stream:level goes to the
  // specific card whose streamId matches.
  const cardLevelRefsRef  = useRef<Record<string, React.MutableRefObject<LevelUpdate>>>({})
  const monitorDecayRef   = useRef<number | null>(null)

  const configReady    = useRef(false)
  const serversRef     = useRef(servers)
  serversRef.current   = servers
  const allStatusesRef = useRef(allStatuses)
  allStatusesRef.current = allStatuses

  // Load config on start — migrate old format (entries without deviceId/encoderConfig)
  useEffect(() => {
    configReady.current = false
    apiFetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        configReady.current = true
        const globalEncoder: EncoderConfig = cfg.encoder
          ? { ...DEFAULT_ENCODER, ...cfg.encoder }
          : DEFAULT_ENCODER
        const globalDevice: string = cfg.deviceId ?? ''

        if (cfg.encoder)  setEncoderConfig(globalEncoder)
        if (cfg.deviceId) setSelectedDevice(globalDevice)
        if (cfg.autoReconnect !== undefined) setAutoReconnect(cfg.autoReconnect)

        if (cfg.servers?.length) {
          // Migrate entries that predate per-stream settings
          setServers(cfg.servers.map((s: ServerEntry & Record<string, unknown>) => ({
            ...s,
            deviceId:      s.deviceId || globalDevice,
            encoderConfig: { ...DEFAULT_ENCODER, ...(s.encoderConfig || globalEncoder) },
          })))
        } else if (cfg.server) {
          const e = makeServerEntry('Hauptstream', globalDevice, globalEncoder)
          e.config = { ...e.config, ...cfg.server }
          setServers([e])
        }
      })
      .catch(() => { configReady.current = true })
  }, [])

  const saveConfig = useCallback(() => {
    if (!configReady.current) return
    apiFetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        servers:       serversRef.current,
        encoder:       encoderConfig,
        deviceId:      selectedDevice,
        autoReconnect,
      }),
    }).catch(() => {})
  }, [encoderConfig, selectedDevice, autoReconnect])

  useEffect(() => {
    if (!configReady.current) return
    const t = setTimeout(saveConfig, 500)
    return () => clearTimeout(t)
  }, [servers, encoderConfig, selectedDevice, autoReconnect]) // eslint-disable-line

  // WebSocket
  const selectedDeviceRef = useRef(selectedDevice)
  selectedDeviceRef.current = selectedDevice

  const handleWSMessage = useCallback((msg: WSPayload) => {
    setWsConnected(true)
    if (msg.type === 'clientOnline') {
      setClientConnected(msg.payload)
    } else if (msg.type === 'devices') {
      // Auto-select first active device into the global slot (monitor + new-card default)
      if (!selectedDeviceRef.current && msg.payload.length > 0) {
        const first = msg.payload.find((d) => d.state === 'active') ?? msg.payload[0]
        if (first) setSelectedDevice(first.id)
      }
    } else if (msg.type === 'status') {
      const s = msg.payload as unknown as Record<string, unknown>
      const id = s['streamId'] as string | undefined
      if (id) {
        if (s['running']) {
          setAllStatuses(prev => ({ ...prev, [id]: s as unknown as import('./types').StreamStatus }))
        } else {
          setAllStatuses(prev => { const n = { ...prev }; delete n[id]; return n })
          const errMsg = s['error'] as string | undefined
          if (errMsg) {
            setStreamErrors(prev => ({ ...prev, [id]: errMsg }))
            setTimeout(() => setStreamErrors(prev => { const n = { ...prev }; delete n[id]; return n }), 8000)
          }
        }
      }
    } else if (msg.type === 'level') {
      const { streamId, monitorId, left, right } = msg.payload
      if (streamId) {
        // Stream level → this card only.
        const ref = cardLevelRefsRef.current[streamId]
        if (ref) ref.current = { left, right }
      } else if (monitorId) {
        // Per-card monitor level → this card only.
        const ref = cardLevelRefsRef.current[monitorId]
        if (ref) ref.current = { left, right }
      } else {
        // Legacy / fallback: no ID — push to all idle cards with decay.
        const statuses = allStatusesRef.current
        for (const srv of serversRef.current) {
          if (!statuses[srv.id]) {
            const ref = cardLevelRefsRef.current[srv.id]
            if (ref) ref.current = { left, right }
          }
        }
        if (monitorDecayRef.current) clearTimeout(monitorDecayRef.current)
        monitorDecayRef.current = setTimeout(() => {
          for (const srv of serversRef.current) {
            if (!allStatusesRef.current[srv.id]) {
              const ref = cardLevelRefsRef.current[srv.id]
              if (ref) ref.current = EMPTY_LEVELS
            }
          }
        }, 200) as unknown as number
      }
    } else if (msg.type === 'error') {
      const { streamId, message } = msg.payload
      if (streamId) {
        setStreamErrors((prev) => ({ ...prev, [streamId]: message }))
        setTimeout(() => setStreamErrors((prev) => { const n = { ...prev }; delete n[streamId]; return n }), 8000)
      }
    }
  }, [])
  useWebSocket(handleWSMessage)

  // Per-card auto-monitor: for each idle card (not streaming), start its own monitor.
  // Fires when device/encoder/client-connection/monitorEnabled/streaming-state changes.
  useEffect(() => {
    if (!clientConnected || !monitorEnabled) {
      apiFetch('/api/monitor/stop', { method: 'POST' }).catch(() => {})
      return
    }
    for (const entry of servers) {
      if (allStatuses[entry.id]) continue  // card is currently streaming
      const device = entry.deviceId || selectedDevice
      if (!device) continue
      apiFetch('/api/monitor/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monitorId:    entry.id,
          deviceId:     device,
          sampleRate:   entry.encoderConfig.sampleRate,
          channelLeft:  entry.encoderConfig.channelLeft,
          channelRight: entry.encoderConfig.channelRight,
        }),
      }).catch(() => {})
    }
  }, [ // eslint-disable-line
    clientConnected, monitorEnabled, selectedDevice,
    servers.map(s => `${s.id}:${s.deviceId}:${s.encoderConfig.sampleRate}:${s.encoderConfig.channelLeft}:${s.encoderConfig.channelRight}`).join(','),
    Object.keys(allStatuses).join(','),
  ])

  // Stream controls
  const setLoading = (id: string, on: boolean) =>
    setLoadingIds((s) => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n })

  const showStreamError = (id: string, msg: string) => {
    setStreamErrors((prev) => ({ ...prev, [id]: msg }))
    setTimeout(() => setStreamErrors((prev) => { const n = { ...prev }; delete n[id]; return n }), 8000)
  }

  const handleStart = async (serverId: string) => {
    setStreamErrors((prev) => { const n = { ...prev }; delete n[serverId]; return n })
    const entry = serversRef.current.find((s) => s.id === serverId)
    if (!entry) return
    setLoading(serverId, true)
    // Use entry's own device/encoder; fall back to global defaults
    const deviceId = entry.deviceId || selectedDevice
    const enc      = entry.encoderConfig
    try {
      const res = await apiFetch('/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streamId:     serverId,
          deviceId,
          sampleRate:   enc.sampleRate,
          channelLeft:  enc.channelLeft,
          channelRight: enc.channelRight,
          format:       enc.format,
          bitrate:      enc.bitrate,
          server:       entry.config,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        showStreamError(serverId, data.error ?? `Fehler ${res.status}`)
      } else {
        // Optimistic: bridge HTTP-200-to-WS gap so button shows "Verbindet…" without Zucken.
        setAllStatuses(prev => ({
          ...prev,
          [serverId]: {
            running: true, connected: false, reconnecting: false,
            uptime: 0, bytesSent: 0, bitrate: enc.bitrate, listeners: 0,
          } as StreamStatus,
        }))
      }
    } catch (err) {
      showStreamError(serverId, err instanceof Error ? err.message : 'Netzwerkfehler')
    } finally { setLoading(serverId, false) }
  }

  const handleStop = async (serverId: string) => {
    setLoading(serverId, true)
    try {
      await apiFetch('/api/stream/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamId: serverId }),
      })
    } finally { setLoading(serverId, false) }
  }

  // Server management
  const updateServer       = (id: string, patch: Partial<ServerEntry>) =>
    setServers((ss) => ss.map((s) => s.id === id ? { ...s, ...patch } : s))
  const updateServerConfig = (id: string, patch: Partial<ServerConfig>) =>
    setServers((ss) => ss.map((s) => s.id === id ? { ...s, config: { ...s.config, ...patch } } : s))
  const updateServerEncoder = (id: string, patch: Partial<EncoderConfig>) =>
    setServers((ss) => ss.map((s) => s.id === id
      ? { ...s, encoderConfig: { ...s.encoderConfig, ...patch } }
      : s))

  const addServer = () => {
    // New card inherits the current global device and encoder as its defaults
    const e = makeServerEntry(`Stream ${servers.length + 1}`, selectedDevice, encoderConfig)
    setServers((ss) => [...ss, e])
  }

  const removeServer = (id: string) => {
    if (allStatuses[id]) return
    apiFetch('/api/monitor/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monitorId: id }),
    }).catch(() => {})
    setServers((ss) => ss.filter((s) => s.id !== id))
  }

  const liveCount = Object.values(allStatuses).filter((s) => s.connected).length

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <AppHeader
        streamCount={servers.length}
        liveCount={liveCount}
        monitorEnabled={monitorEnabled}
        onAdd={addServer}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleMonitor={() => setMonitorEnabled((v) => !v)}
      />
      <GlobalSettingsDialog
        open={settingsOpen}
        autoReconnect={autoReconnect}
        vuDecayMs={vuDecayMs}
        onClose={() => setSettingsOpen(false)}
        onReconnectChange={setAutoReconnect}
        onVuDecayChange={handleVuDecayChange}
      />

      <main className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 content-start items-start">
        {servers.map((entry) => {
          // Lazily create a stable ref for this card on first render.
          if (!cardLevelRefsRef.current[entry.id]) {
            cardLevelRefsRef.current[entry.id] = { current: EMPTY_LEVELS }
          }
          return (
          <StreamCard
            key={entry.id}
            entry={entry}
            status={allStatuses[entry.id] ?? null}
            vuTargetRef={cardLevelRefsRef.current[entry.id]}
            vuDecayMsRef={vuDecayMsRef}
            encoderConfig={entry.encoderConfig}
            selectedDevice={entry.deviceId || selectedDevice}
            isLoading={loadingIds.has(entry.id)}
            error={streamErrors[entry.id] ?? null}
            onStart={() => handleStart(entry.id)}
            onStop={() => handleStop(entry.id)}
            onChange={(p) => updateServerConfig(entry.id, p)}
            onLabelChange={(l) => updateServer(entry.id, { label: l })}
            onDeviceChange={(id) => updateServer(entry.id, { deviceId: id })}
            onEncoderChange={(p) => updateServerEncoder(entry.id, p)}
            onRemove={!allStatuses[entry.id] ? () => removeServer(entry.id) : undefined}
          />
        )})}


        {servers.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
            <p className="text-sm">Noch keine Streams konfiguriert</p>
          </div>
        )}
      </main>

      <StatusBar allStatuses={allStatuses} wsConnected={wsConnected} />
    </div>
  )
}
