import { useState, useCallback, useRef, useEffect } from 'react'

import AppHeader            from './components/AppHeader'
import StreamCard            from './components/StreamCard'
import StatusBar             from './components/StatusBar'
import TokenGate             from './components/TokenGate'
import GlobalSettingsDialog  from './components/GlobalSettingsDialog'

import { useWebSocket }             from './hooks/useWebSocket'
import { apiFetch, onUnauthorized } from './lib/api'
import {
  ServerEntry, ServerConfig, EncoderConfig,
  AllStreamStatus, LevelUpdate, WSPayload,
  makeServerEntry, DEFAULT_ENCODER,
} from './types'

const EMPTY_LEVELS: LevelUpdate = { left: -120, right: -120 }

export default function App() {
  const [token, setTokenState] = useState(() => {
    const params  = new URLSearchParams(window.location.search)
    const fromUrl = params.get('auth')
    if (fromUrl) {
      localStorage.setItem('opencast_token', fromUrl)
      history.replaceState(null, '', window.location.pathname)
      return fromUrl
    }
    return localStorage.getItem('opencast_token') ?? ''
  })

  const [servers, setServers]               = useState<ServerEntry[]>(() => [makeServerEntry('Hauptstream')])
  const [encoderConfig, setEncoderConfig]   = useState<EncoderConfig>(DEFAULT_ENCODER)
  const [selectedDevice, setSelectedDevice] = useState('')
  const [allStatuses, setAllStatuses]       = useState<AllStreamStatus>({})
  const [levels, setLevels]                 = useState<LevelUpdate>(EMPTY_LEVELS)
  const [loadingIds, setLoadingIds]         = useState<Set<string>>(new Set())
  const [wsConnected, setWsConnected]       = useState(false)
  const [autoReconnect, setAutoReconnect]   = useState(true)
  const [settingsOpen, setSettingsOpen]     = useState(false)

  const levelsDecayRef = useRef<number | null>(null)
  const configReady    = useRef(false)
  const serversRef     = useRef(servers)
  serversRef.current   = servers

  const handleToken = useCallback((tok: string) => {
    localStorage.setItem('opencast_token', tok)
    setTokenState(tok)
  }, [])

  useEffect(() => {
    onUnauthorized(() => { setTokenState(''); localStorage.removeItem('opencast_token') })
  }, [])

  // Load config on start
  useEffect(() => {
    if (!token) return
    configReady.current = false
    apiFetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        configReady.current = true
        if (cfg.encoder)  setEncoderConfig((c) => ({ ...c, ...cfg.encoder }))
        if (cfg.deviceId) setSelectedDevice(cfg.deviceId)
        if (cfg.autoReconnect !== undefined) setAutoReconnect(cfg.autoReconnect)
        if (cfg.servers?.length) {
          setServers(cfg.servers)
        } else if (cfg.server) {
          const e = makeServerEntry('Hauptstream')
          e.config = { ...e.config, ...cfg.server }
          setServers([e])
        }
      })
      .catch(() => { configReady.current = true })
  }, [token]) // eslint-disable-line

  const saveConfig = useCallback(() => {
    if (!token || !configReady.current) return
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
  }, [token, encoderConfig, selectedDevice, autoReconnect])

  useEffect(() => {
    if (!token || !configReady.current) return
    const t = setTimeout(saveConfig, 500)
    return () => clearTimeout(t)
  }, [servers, encoderConfig, selectedDevice, autoReconnect, token]) // eslint-disable-line

  // WebSocket
  const handleWSMessage = useCallback((msg: WSPayload) => {
    setWsConnected(true)
    if (msg.type === 'status') {
      setAllStatuses(msg.payload)
    } else if (msg.type === 'level') {
      setLevels(msg.payload)
      if (levelsDecayRef.current) clearTimeout(levelsDecayRef.current)
      levelsDecayRef.current = setTimeout(() => setLevels(EMPTY_LEVELS), 200) as unknown as number
    }
  }, [])
  useWebSocket(handleWSMessage, token)

  // Auto-monitor when idle
  useEffect(() => {
    if (!token || !selectedDevice) return
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
  }, [selectedDevice, encoderConfig.sampleRate, encoderConfig.channels, token, Object.keys(allStatuses).join(',')]) // eslint-disable-line

  // Stream controls
  const setLoading = (id: string, on: boolean) =>
    setLoadingIds((s) => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n })

  const handleStart = async (serverId: string) => {
    const entry = serversRef.current.find((s) => s.id === serverId)
    if (!entry) return
    setLoading(serverId, true)
    try {
      await apiFetch('/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streamId:   serverId,
          deviceId:   selectedDevice,
          sampleRate: encoderConfig.sampleRate,
          channels:   encoderConfig.channels,
          format:     encoderConfig.format,
          bitrate:    encoderConfig.bitrate,
          server:     entry.config,
        }),
      })
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

  const addServer = () => {
    const e = makeServerEntry(`Stream ${servers.length + 1}`)
    setServers((ss) => [...ss, e])
  }

  const removeServer = (id: string) => {
    if (allStatuses[id]) return
    setServers((ss) => ss.filter((s) => s.id !== id))
  }

  // ── Render ──────────────────────────────────────────────────────────

  if (!token) return <TokenGate onToken={handleToken} />

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
            encoderConfig={encoderConfig}
            selectedDevice={selectedDevice}
            anyRunning={Object.keys(allStatuses).length > 0}
            isLoading={loadingIds.has(entry.id)}
            onStart={() => handleStart(entry.id)}
            onStop={() => handleStop(entry.id)}
            onChange={(p) => updateServerConfig(entry.id, p)}
            onLabelChange={(l) => updateServer(entry.id, { label: l })}
            onDeviceChange={setSelectedDevice}
            onEncoderChange={(p) => setEncoderConfig((c) => ({ ...c, ...p }))}
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
