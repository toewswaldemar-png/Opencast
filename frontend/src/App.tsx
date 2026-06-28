import { useState, useCallback, useRef, useEffect } from 'react'

import AppHeader   from './components/AppHeader'
import StreamCard  from './components/StreamCard'
import InfoSidebar from './components/InfoSidebar'

import { useWebSocket } from './hooks/useWebSocket'
import { apiFetch }     from './lib/api'
import {
  ServerEntry, ServerConfig, EncoderConfig, StreamStatus,
  AllStreamStatus, LevelUpdate, WSPayload, GlobalLogEntry,
  makeServerEntry, DEFAULT_ENCODER,
} from './types'

const EMPTY_LEVELS: LevelUpdate = { left: -120, right: -120 }

export default function App() {
  const [servers, setServers]             = useState<ServerEntry[]>(() => [makeServerEntry('Hauptstream')])
  const [encoderConfig, setEncoderConfig] = useState<EncoderConfig>(DEFAULT_ENCODER)
  const [selectedDevice, setSelectedDevice] = useState('')
  const [allStatuses, setAllStatuses]     = useState<AllStreamStatus>({})
  const [loadingIds, setLoadingIds]       = useState<Set<string>>(new Set())
  const [streamErrors, setStreamErrors]   = useState<Record<string, string>>({})
  const [wsConnected, setWsConnected]         = useState(false)
  const [clientConnected, setClientConnected] = useState(false)
  const [autoReconnect, setAutoReconnect]   = useState(true)
  const [monitorEnabled, setMonitorEnabled] = useState(true)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
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

  const cardLevelRefsRef  = useRef<Record<string, React.MutableRefObject<LevelUpdate>>>({})
  const monitorDecayRef    = useRef<number | null>(null)
  const sidebarVuDecayRef  = useRef<number | null>(null)
  const activeMonitorsRef  = useRef<Set<string>>(new Set())
  const sidebarVuTargetRef = useRef<LevelUpdate>({ left: -120, right: -120 })

  const globalLogIdRef = useRef(0)
  const [globalLog, setGlobalLog] = useState<GlobalLogEntry[]>([])
  const addGlobalLog = useCallback((text: string, type: GlobalLogEntry['type']) => {
    setGlobalLog(prev => [...prev.slice(-29), { id: globalLogIdRef.current++, time: new Date(), text, type }])
  }, [])

  const configReady      = useRef(false)
  const configJustLoaded = useRef(false)
  const serversRef     = useRef(servers)
  serversRef.current   = servers
  const allStatusesRef = useRef(allStatuses)
  allStatusesRef.current = allStatuses

  // Load config
  useEffect(() => {
    configReady.current = false
    apiFetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        configReady.current = true
        configJustLoaded.current = true
        const globalEncoder: EncoderConfig = cfg.encoder
          ? { ...DEFAULT_ENCODER, ...cfg.encoder }
          : DEFAULT_ENCODER
        const globalDevice: string = cfg.deviceId ?? ''

        if (cfg.encoder)  setEncoderConfig(globalEncoder)
        if (cfg.deviceId) setSelectedDevice(globalDevice)
        if (cfg.autoReconnect !== undefined) setAutoReconnect(cfg.autoReconnect)

        if (cfg.servers?.length) {
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
    if (configJustLoaded.current) { configJustLoaded.current = false; return }
    const t = setTimeout(saveConfig, 500)
    return () => clearTimeout(t)
  }, [servers, encoderConfig, selectedDevice, autoReconnect]) // eslint-disable-line

  const selectedDeviceRef = useRef(selectedDevice)
  selectedDeviceRef.current = selectedDevice

  const labelFor = useCallback((id: string) =>
    serversRef.current.find(s => s.id === id)?.label ?? id.slice(0, 8), [])

  const handleWSMessage = useCallback((msg: WSPayload) => {
    setWsConnected(true)
    if (msg.type === 'clientOnline') {
      setClientConnected(msg.payload)
    } else if (msg.type === 'devices') {
      if (!selectedDeviceRef.current && msg.payload.length > 0) {
        const first = msg.payload.find((d) => d.state === 'active') ?? msg.payload[0]
        if (first) setSelectedDevice(first.id)
      }
    } else if (msg.type === 'status') {
      const s = msg.payload as unknown as Record<string, unknown>
      const id = s['streamId'] as string | undefined
      if (id) {
        const prev = allStatusesRef.current[id]
        const next = s as unknown as StreamStatus
        if (next.running) {
          if (!prev)                                   addGlobalLog(`${labelFor(id)} gestartet`, 'info')
          else if (!prev.connected && next.connected)  addGlobalLog(`${labelFor(id)} verbunden`, 'ok')
          else if (prev.connected && !next.connected)  addGlobalLog(`${labelFor(id)} unterbrochen`, 'warn')
          else if (!prev.reconnecting && next.reconnecting) addGlobalLog(`${labelFor(id)} reconnect…`, 'info')
          setAllStatuses(prev => ({ ...prev, [id]: next }))
        } else {
          if (prev?.running) addGlobalLog(`${labelFor(id)} gestoppt`, 'info')
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
        const ref = cardLevelRefsRef.current[streamId]
        if (ref) ref.current = { left, right }
      } else if (monitorId) {
        const ref = cardLevelRefsRef.current[monitorId]
        if (ref) ref.current = { left, right }
      } else {
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
      sidebarVuTargetRef.current = { left, right }
      if (sidebarVuDecayRef.current) clearTimeout(sidebarVuDecayRef.current)
      sidebarVuDecayRef.current = setTimeout(() => {
        sidebarVuTargetRef.current = EMPTY_LEVELS
      }, 200) as unknown as number
    } else if (msg.type === 'error') {
      const { streamId, message } = msg.payload
      if (streamId) {
        addGlobalLog(`${labelFor(streamId)}: ${message}`, 'warn')
        setStreamErrors((prev) => ({ ...prev, [streamId]: message }))
        setTimeout(() => setStreamErrors((prev) => { const n = { ...prev }; delete n[streamId]; return n }), 8000)
      }
    }
  }, [addGlobalLog, labelFor])
  useWebSocket(handleWSMessage)

  // Clear monitor tracking on (re)connect so monitors are re-established
  useEffect(() => {
    if (clientConnected) activeMonitorsRef.current.clear()
  }, [clientConnected])

  // Per-card auto-monitor — only start/stop delta to avoid duplicate API calls
  useEffect(() => {
    if (!clientConnected || !monitorEnabled) {
      apiFetch('/api/monitor/stop', { method: 'POST' }).catch(() => {})
      activeMonitorsRef.current.clear()
      return
    }
    const runningIds = new Set(Object.keys(allStatuses))
    for (const entry of servers) {
      const isRunning  = runningIds.has(entry.id)
      const isMonitored = activeMonitorsRef.current.has(entry.id)
      if (!isRunning && !isMonitored) {
        const device = entry.deviceId || selectedDevice
        if (!device) continue
        activeMonitorsRef.current.add(entry.id)
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
      } else if (isRunning && isMonitored) {
        activeMonitorsRef.current.delete(entry.id)
        apiFetch('/api/monitor/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monitorId: entry.id }),
        }).catch(() => {})
      }
    }
  }, [ // eslint-disable-line
    clientConnected, monitorEnabled, selectedDevice,
    servers.map(s => `${s.id}:${s.deviceId}:${s.encoderConfig.sampleRate}:${s.encoderConfig.channelLeft}:${s.encoderConfig.channelRight}`).join(','),
    Object.keys(allStatuses).sort().join(','),
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

  const handleStartAll = () => {
    serversRef.current
      .filter((s) => !allStatuses[s.id]?.running)
      .forEach((s) => handleStart(s.id))
  }

  const handleStopAll = () => {
    Object.keys(allStatuses)
      .filter((id) => allStatuses[id]?.running)
      .forEach((id) => handleStop(id))
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
    const e = makeServerEntry(`Stream ${servers.length + 1}`, selectedDevice, encoderConfig)
    setServers((ss) => [...ss, e])
  }

  const removeServer = (id: string) => {
    if (allStatuses[id]) return
    if (selectedCardId === id) setSelectedCardId(null)
    apiFetch('/api/monitor/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monitorId: id }),
    }).catch(() => {})
    setServers((ss) => ss.filter((s) => s.id !== id))
  }

  const handleSelectCard = (id: string) =>
    setSelectedCardId(prev => prev === id ? null : id)

  // Derived for sidebar
  const selectedEntry  = selectedCardId ? (servers.find(s => s.id === selectedCardId) ?? null) : null
  const selectedStatus = selectedEntry ? (allStatuses[selectedEntry.id] ?? null) : null

  const liveCount = Object.values(allStatuses).filter((s) => s.connected).length

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden select-none">
      <AppHeader streamCount={servers.length} liveCount={liveCount} />

      <div className="flex-1 flex overflow-hidden">
        <InfoSidebar
          clientConnected={clientConnected}
          monitorEnabled={monitorEnabled}
          onToggleMonitor={() => setMonitorEnabled((v) => !v)}
          onAdd={addServer}
          onStartAll={handleStartAll}
          onStopAll={handleStopAll}
          wsConnected={wsConnected}
          allStatuses={allStatuses}
          selectedEntry={selectedEntry}
          selectedStatus={selectedStatus}
          onChange={(p) => selectedCardId && updateServerConfig(selectedCardId, p)}
          onLabelChange={(l) => selectedCardId && updateServer(selectedCardId, { label: l })}
          onDeviceChange={(id) => selectedCardId && updateServer(selectedCardId, { deviceId: id })}
          onEncoderChange={(p) => selectedCardId && updateServerEncoder(selectedCardId, p)}
          onRemove={selectedEntry && !allStatuses[selectedEntry.id]
            ? () => removeServer(selectedEntry.id)
            : undefined}
          onDeselect={() => setSelectedCardId(null)}
          servers={servers}
          onStop={handleStop}
          globalLog={globalLog}
          sidebarVuTargetRef={sidebarVuTargetRef}
          vuDecayMsRef={vuDecayMsRef}
          autoReconnect={autoReconnect}
          vuDecayMs={vuDecayMs}
          onReconnectChange={setAutoReconnect}
          onVuDecayChange={handleVuDecayChange}
        />
        <main className="flex-1 overflow-y-auto min-h-0">
          <div
            className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 content-start"
            onClick={(e) => { if (e.target === e.currentTarget) setSelectedCardId(null) }}
          >
            {servers.map((entry) => {
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
                  isLoading={loadingIds.has(entry.id)}
                  error={streamErrors[entry.id] ?? null}
                  isSelected={entry.id === selectedCardId}
                  onStart={() => handleStart(entry.id)}
                  onStop={() => handleStop(entry.id)}
                  onSelect={() => handleSelectCard(entry.id)}
                />
              )
            })}
            {servers.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
                <p className="text-sm">Noch keine Streams konfiguriert</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
