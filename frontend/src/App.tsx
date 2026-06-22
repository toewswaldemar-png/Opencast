import { useState, useCallback, useRef, useEffect } from 'react'

import AppHeader           from './components/AppHeader'
import StreamCard          from './components/StreamCard'
import StatusBar           from './components/StatusBar'
import GlobalSettingsDialog from './components/GlobalSettingsDialog'

import { useWebSocket } from './hooks/useWebSocket'
import { apiFetch }     from './lib/api'
import {
  ServerEntry, ServerConfig, EncoderConfig,
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
  const [levels, setLevels]               = useState<LevelUpdate>(EMPTY_LEVELS)
  const [loadingIds, setLoadingIds]       = useState<Set<string>>(new Set())
  const [streamErrors, setStreamErrors]   = useState<Record<string, string>>({})
  const [wsConnected, setWsConnected]         = useState(false)
  const [clientConnected, setClientConnected] = useState(false)
  const [autoReconnect, setAutoReconnect]     = useState(true)
  const [settingsOpen, setSettingsOpen]   = useState(false)

  const levelsDecayRef = useRef<number | null>(null)
  const configReady    = useRef(false)
  const serversRef     = useRef(servers)
  serversRef.current   = servers

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
            deviceId:      s.deviceId      || globalDevice,
            encoderConfig: s.encoderConfig || globalEncoder,
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
        }
      }
    } else if (msg.type === 'level') {
      setLevels(msg.payload)
      if (levelsDecayRef.current) clearTimeout(levelsDecayRef.current)
      levelsDecayRef.current = setTimeout(() => setLevels(EMPTY_LEVELS), 200) as unknown as number
    } else if (msg.type === 'error') {
      const { streamId, message } = msg.payload
      if (streamId) {
        setStreamErrors((prev) => ({ ...prev, [streamId]: message }))
        setTimeout(() => setStreamErrors((prev) => { const n = { ...prev }; delete n[streamId]; return n }), 8000)
      }
    }
  }, [])
  useWebSocket(handleWSMessage)

  // Auto-monitor: fires when device, encoder, or client-connection state changes.
  useEffect(() => {
    if (!selectedDevice || !clientConnected) return
    if (Object.keys(allStatuses).length > 0) return
    apiFetch('/api/monitor/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId:   selectedDevice,
        sampleRate: encoderConfig.sampleRate,
        channels:   encoderConfig.channels,
      }),
    }).catch(() => {})
  }, [selectedDevice, encoderConfig.sampleRate, encoderConfig.channels, clientConnected, Object.keys(allStatuses).join(',')]) // eslint-disable-line

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
          streamId:   serverId,
          deviceId,
          sampleRate: enc.sampleRate,
          channels:   enc.channels,
          format:     enc.format,
          bitrate:    enc.bitrate,
          server:     entry.config,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        showStreamError(serverId, data.error ?? `Fehler ${res.status}`)
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
    setServers((ss) => ss.filter((s) => s.id !== id))
  }

  const liveCount = Object.values(allStatuses).filter((s) => s.connected).length

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <AppHeader
        streamCount={servers.length}
        liveCount={liveCount}
        onAdd={addServer}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <GlobalSettingsDialog
        open={settingsOpen}
        autoReconnect={autoReconnect}
        onClose={() => setSettingsOpen(false)}
        onReconnectChange={setAutoReconnect}
      />

      <main className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 content-start items-start">
        {servers.map((entry) => (
          <StreamCard
            key={entry.id}
            entry={entry}
            status={allStatuses[entry.id] ?? null}
            levels={levels}
            encoderConfig={entry.encoderConfig}
            selectedDevice={entry.deviceId || selectedDevice}
            anyRunning={Object.keys(allStatuses).length > 0}
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
        ))}

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
