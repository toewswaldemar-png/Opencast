import { useState, useCallback, useRef, useEffect } from 'react'

import AppHeader        from './components/AppHeader'
import StreamCard       from './components/StreamCard'
import InfoSidebar      from './components/InfoSidebar'
import SettingsView     from './components/SettingsView'
import CardSettingsPanel from './components/CardSettingsPanel'

import { useWebSocket } from './hooks/useWebSocket'
import { apiFetch }     from './lib/api'
import {
  ServerEntry, ServerConfig, EncoderConfig, StreamStatus, AudioDevice,
  AllStreamStatus, LevelUpdate, WSPayload, GlobalLogEntry,
  makeServerEntry, DEFAULT_ENCODER,
} from './types'

const EMPTY_LEVELS: LevelUpdate = { left: -120, right: -120 }

export default function App() {
  const [servers, setServers]             = useState<ServerEntry[]>(() => [makeServerEntry('Hauptstream')])
  const [configLoaded, setConfigLoaded]   = useState(false)
  const [encoderConfig, setEncoderConfig] = useState<EncoderConfig>(DEFAULT_ENCODER)
  const [selectedDevice, setSelectedDevice] = useState('')
  const [allStatuses, setAllStatuses]     = useState<AllStreamStatus>({})
  const [loadingIds, setLoadingIds]       = useState<Set<string>>(new Set())
  const [streamErrors, setStreamErrors]   = useState<Record<string, string>>({})
  const [wsConnected, setWsConnected]         = useState(false)
  const [clientConnected, setClientConnected] = useState(false)
  const [devices, setDevices]                 = useState<AudioDevice[]>([])
  const [devicesLoading, setDevicesLoading]   = useState(false)
  const [devicesError, setDevicesError]       = useState<string | null>(null)
  const [autoReconnect, setAutoReconnect]   = useState(true)
  const [monitorEnabled, setMonitorEnabled] = useState(true)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [showSettings, setShowSettings]     = useState(false)
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

  const cardLevelRefsRef   = useRef<Record<string, React.MutableRefObject<LevelUpdate>>>({})
  const lastLevelSeenRef   = useRef<Record<string, number>>({}) // monitorKey → timestamp
  const sidebarLastSeenRef = useRef(0)
  const activeMonitorsRef  = useRef<Map<string, {device: string; sampleRate: number; channelLeft: number; channelRight: number}>>(new Map())
  const sidebarVuTargetRef = useRef<LevelUpdate>({ left: -120, right: -120 })
  const wsConnectedRef     = useRef(false)

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
        setConfigLoaded(true)
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
      .catch(() => { configReady.current = true; setConfigLoaded(true) })
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

  const fetchDevices = useCallback(async () => {
    setDevicesLoading(true); setDevicesError(null)
    try {
      const res = await apiFetch('/api/devices')
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error ?? `HTTP ${res.status}`) }
      const data: AudioDevice[] = await res.json()
      setDevices(data)
      if (!selectedDeviceRef.current) {
        const first = data.find((d) => d.state === 'active') ?? data[0]
        if (first) setSelectedDevice(first.id)
      }
    } catch (err) {
      setDevicesError(err instanceof Error ? err.message : 'Fehler beim Laden')
    } finally { setDevicesLoading(false) }
  }, [])

  useEffect(() => { fetchDevices() }, [fetchDevices])

  const labelFor = useCallback((id: string) =>
    serversRef.current.find(s => s.id === id)?.label ?? id.slice(0, 8), [])

  const handleWSMessage = useCallback((msg: WSPayload) => {
    if (!wsConnectedRef.current) { wsConnectedRef.current = true; setWsConnected(true) }
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
          if (!prev)                                        addGlobalLog(`${labelFor(id)} gestartet`, 'info')
          else if (!prev.connected && next.connected)       addGlobalLog(`${labelFor(id)} verbunden`, 'ok')
          else if (prev.connected && !next.connected)       addGlobalLog(`${labelFor(id)} unterbrochen`, 'warn')
          else if (!prev.reconnecting && next.reconnecting) addGlobalLog(`${labelFor(id)} reconnect…`, 'info')
          allStatusesRef.current = { ...allStatusesRef.current, [id]: next }
          setAllStatuses(prev => ({ ...prev, [id]: next }))
        } else {
          if (prev?.running) addGlobalLog(`${labelFor(id)} gestoppt`, 'info')
          const updated = { ...allStatusesRef.current }
          delete updated[id]
          allStatusesRef.current = updated
          setAllStatuses(() => updated)
          const errMsg = s['error'] as string | undefined
          if (errMsg) {
            setStreamErrors(prev => ({ ...prev, [id]: errMsg }))
            setTimeout(() => setStreamErrors(prev => { const n = { ...prev }; delete n[id]; return n }), 8000)
          }
        }
      }
    } else if (msg.type === 'level') {
      const { streamId, monitorId, left, right } = msg.payload
      const now = Date.now()
      if (streamId) {
        const ref = cardLevelRefsRef.current[streamId]
        if (ref) ref.current = { left, right }
      } else if (monitorId) {
        lastLevelSeenRef.current[monitorId] = now
        for (const srv of serversRef.current) {
          const device = srv.deviceId || selectedDeviceRef.current
          const key = `${device}|${srv.encoderConfig.sampleRate}|${srv.encoderConfig.channelLeft}|${srv.encoderConfig.channelRight}`
          if (key === monitorId) {
            const ref = cardLevelRefsRef.current[srv.id]
            if (ref) ref.current = { left, right }
          }
        }
      }
      sidebarVuTargetRef.current = { left, right }
      sidebarLastSeenRef.current = now
    } else if (msg.type === 'error') {
      const { streamId, message } = msg.payload
      if (streamId) {
        addGlobalLog(`${labelFor(streamId)}: ${message}`, 'warn')
        setStreamErrors((prev) => ({ ...prev, [streamId]: message }))
        setTimeout(() => setStreamErrors((prev) => { const n = { ...prev }; delete n[streamId]; return n }), 8000)
      }
    }
  }, [addGlobalLog, labelFor])
  useWebSocket(handleWSMessage, useCallback(() => {
    wsConnectedRef.current = false
    setWsConnected(false)
    setClientConnected(false)
  }, []))

  // Clear monitor tracking on (re)connect so monitors are re-established
  useEffect(() => {
    if (clientConnected) activeMonitorsRef.current.clear()
  }, [clientConnected])

  // Single interval for VU decay — replaces per-message setTimeout spam
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      if (now - sidebarLastSeenRef.current > 200) sidebarVuTargetRef.current = EMPTY_LEVELS
      for (const [key] of activeMonitorsRef.current) {
        if (now - (lastLevelSeenRef.current[key] ?? 0) > 200) {
          for (const srv of serversRef.current) {
            const device = srv.deviceId || selectedDeviceRef.current
            const k = `${device}|${srv.encoderConfig.sampleRate}|${srv.encoderConfig.channelLeft}|${srv.encoderConfig.channelRight}`
            if (k === key) {
              const ref = cardLevelRefsRef.current[srv.id]
              if (ref) ref.current = EMPTY_LEVELS
            }
          }
        }
      }
    }, 150)
    return () => clearInterval(id)
  }, [])

  // Per-unique-config monitor — one subscription shared by all cards with same device+channels

  useEffect(() => {
    if (!clientConnected || !monitorEnabled) {
      apiFetch('/api/monitor/stop', { method: 'POST' }).catch(() => {})
      activeMonitorsRef.current.clear()
      return
    }
    if (!configReady.current) return

    const runningIds = new Set(Object.keys(allStatuses))

    // Build desired monitor set: one per unique (device, sr, L, R) config
    const desired = new Map<string, {device: string; sampleRate: number; channelLeft: number; channelRight: number}>()
    for (const entry of servers) {
      if (runningIds.has(entry.id)) continue
      const device = entry.deviceId || selectedDevice
      if (!device) continue
      const key = `${device}|${entry.encoderConfig.sampleRate}|${entry.encoderConfig.channelLeft}|${entry.encoderConfig.channelRight}`
      if (!desired.has(key)) desired.set(key, {
        device,
        sampleRate:   entry.encoderConfig.sampleRate,
        channelLeft:  entry.encoderConfig.channelLeft,
        channelRight: entry.encoderConfig.channelRight,
      })
    }

    // Stop monitors no longer needed
    for (const [key] of activeMonitorsRef.current) {
      if (!desired.has(key)) {
        activeMonitorsRef.current.delete(key)
        apiFetch('/api/monitor/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monitorId: key }),
        }).catch(() => {})
      }
    }

    // Start new monitors
    for (const [key, cfg] of desired) {
      if (!activeMonitorsRef.current.has(key)) {
        activeMonitorsRef.current.set(key, cfg)
        apiFetch('/api/monitor/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            monitorId:    key,
            deviceId:     cfg.device,
            sampleRate:   cfg.sampleRate,
            channelLeft:  cfg.channelLeft,
            channelRight: cfg.channelRight,
          }),
        }).catch(() => {})
      }
    }
  }, [ // eslint-disable-line
    clientConnected, monitorEnabled, selectedDevice,
    servers.map(s => `${s.deviceId}|${s.encoderConfig.sampleRate}|${s.encoderConfig.channelLeft}|${s.encoderConfig.channelRight}`).join(','),
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
    setSelectedCardId(e.id)
    setShowSettings(false)
  }

  const removeServer = (id: string) => {
    if (allStatuses[id]) return
    if (servers.length <= 1) return
    apiFetch('/api/monitor/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monitorId: id }),
    }).catch(() => {})
    setServers((ss) => {
      const next = ss.filter((s) => s.id !== id)
      if (selectedCardId === id) setSelectedCardId(next[0]?.id ?? null)
      return next
    })
  }

  const handleSelectCard = (id: string) => {
    setShowSettings(false)
    setSelectedCardId(id)
  }

  const handleToggleSettings = () => {
    setShowSettings(v => !v)
    if (!showSettings) setSelectedCardId(null)
  }

  // Derived for sidebar
  const effectiveSelectedId = selectedCardId ?? servers[0]?.id ?? null
  const selectedEntry  = effectiveSelectedId ? (servers.find(s => s.id === effectiveSelectedId) ?? null) : null
  const selectedStatus = selectedEntry ? (allStatuses[selectedEntry.id] ?? null) : null



  return (
    <div className="h-screen flex flex-col overflow-hidden select-none bg-white">
      <AppHeader wsConnected={wsConnected} clientConnected={clientConnected} />

      <div className="flex-1 flex overflow-hidden">
        <InfoSidebar
          monitorEnabled={monitorEnabled}
          onToggleMonitor={() => setMonitorEnabled((v) => !v)}
          onAdd={addServer}
          onStartAll={handleStartAll}
          onStopAll={handleStopAll}
          allStatuses={allStatuses}
          globalLog={globalLog}
          sidebarVuTargetRef={sidebarVuTargetRef}
          vuDecayMsRef={vuDecayMsRef}
          showSettings={showSettings}
          onToggleSettings={handleToggleSettings}
        />
        <main className="flex-1 overflow-y-auto min-h-0">
          {showSettings ? (
            <SettingsView
              autoReconnect={autoReconnect}
              vuDecayMs={vuDecayMs}
              onReconnectChange={setAutoReconnect}
              onVuDecayChange={handleVuDecayChange}
            />
          ) : (
            <div
              className="m-4 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 content-start min-h-[calc(100%-2rem)]"
              style={{background: 'rgba(241,245,249,0.8)', visibility: configLoaded ? 'visible' : 'hidden'}}>

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
                    isSelected={entry.id === effectiveSelectedId}
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
          )}
        </main>

        {/* Rechte Sidebar: Stream-Einstellungen */}
        <aside className="w-[260px] flex-shrink-0 flex flex-col overflow-hidden" style={{background: 'rgba(255,255,255,0.75)', borderLeft: '1px solid rgba(255,255,255,0.9)'}}>
          {!selectedEntry && (
            <div className="flex-1 flex items-center justify-center text-[11px] text-muted-foreground/50">
              Stream auswählen
            </div>
          )}
          {selectedEntry && (<>
            <CardSettingsPanel
              key={selectedEntry.id}
              entry={selectedEntry}
              encoderConfig={selectedEntry.encoderConfig}
              selectedDevice={selectedEntry.deviceId}
              disabled={!!selectedStatus?.running}
              devices={devices}
              devicesLoading={devicesLoading}
              devicesError={devicesError}
              onRefreshDevices={fetchDevices}
              onChange={(p) => updateServerConfig(selectedEntry.id, p)}
              onLabelChange={(l) => updateServer(selectedEntry.id, { label: l })}
              onDeviceChange={(id) => updateServer(selectedEntry.id, { deviceId: id })}
              onEncoderChange={(p) => updateServerEncoder(selectedEntry.id, p)}
              onRemove={() => removeServer(selectedEntry.id)}
              canRemove={servers.length > 1}
            />
          </>)}
        </aside>
      </div>
    </div>
  )
}
