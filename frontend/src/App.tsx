import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Radio, AlertCircle,
  Mic, Video, BarChart2, FileText,
  Clock, Users, Activity, Wifi, WifiOff, Plus, Trash2,
} from 'lucide-react'

import ServerPanel     from './components/ServerPanel'
import DevicePanel     from './components/DevicePanel'
import EncoderSettings from './components/EncoderSettings'
import VUMeter         from './components/VUMeter'
import StatusBar       from './components/StatusBar'
import TokenGate       from './components/TokenGate'

import { Button }  from '@/components/ui/button'
import { Badge }   from '@/components/ui/badge'
import { Card }    from '@/components/ui/card'
import { cn }      from '@/lib/utils'
import { useWebSocket }             from './hooks/useWebSocket'
import { apiFetch, onUnauthorized } from './lib/api'
import {
  ServerEntry, StreamStatus, ServerConfig, EncoderConfig, AllStreamStatus, LevelUpdate, WSPayload,
  makeServerEntry, DEFAULT_ENCODER,
} from './types'

// ─── Secondary nav (placeholder pages inside inspector) ───────────────────────
type SecondaryPage = 'quellen' | 'aufnahmen' | 'statistiken' | 'protokolle' | null

const SECONDARY_NAV: { id: SecondaryPage; Icon: typeof Mic; label: string }[] = [
  { id: 'quellen',     Icon: Mic,      label: 'Quellen'     },
  { id: 'aufnahmen',   Icon: Video,    label: 'Aufnahmen'   },
  { id: 'statistiken', Icon: BarChart2, label: 'Statistiken' },
  { id: 'protokolle',  Icon: FileText, label: 'Protokolle'  },
]

const EMPTY_LEVELS: LevelUpdate = { left: -120, right: -120 }

function fmtUptime(ns: number): string {
  const s = Math.floor(ns / 1e9)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
    : `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
}

// ─── StreamCard ───────────────────────────────────────────────────────────────
function StreamCard({
  server, status, isLoading, levels, selected, onSelect, onStart, onStop,
}: {
  server:    ServerEntry
  status:    StreamStatus | null
  isLoading: boolean
  levels:    LevelUpdate
  selected:  boolean
  onSelect:  () => void
  onStart:   () => void
  onStop:    () => void
}) {
  const isRunning   = !!status
  const isConnected = status?.connected ?? false
  const url         = `${server.config.host}:${server.config.port}${server.config.mountPoint}`

  return (
    <Card
      onClick={(e) => { e.stopPropagation(); onSelect() }}
      className={cn(
        'overflow-hidden flex flex-col cursor-pointer transition-all select-none',
        selected
          ? 'ring-2 ring-blue-500 ring-offset-2 shadow-sm'
          : 'hover:shadow-md hover:border-slate-300'
      )}
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <div className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors',
          isConnected ? 'bg-teal-500' : 'bg-slate-100'
        )}>
          <Mic size={14} className={isConnected ? 'text-white' : 'text-slate-400'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-foreground leading-tight">{server.label}</div>
          <div className="text-[10px] text-muted-foreground font-mono truncate">{url}</div>
        </div>
        <Badge variant={isConnected ? 'green' : isRunning ? 'orange' : 'slate'}>
          {isConnected ? 'Live' : isRunning ? 'Reconnect' : 'Offline'}
        </Badge>
      </div>

      {/* ── Track / Meta ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-slate-50/50">
        <Radio size={12} className={cn(
          'flex-shrink-0 transition-colors',
          isRunning ? 'text-teal-500 animate-pulse' : 'text-slate-300'
        )} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-foreground truncate leading-tight">
            {server.config.name || server.label}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {server.config.genre || 'Icecast Source Client'}
          </div>
        </div>
        {status && (
          <Badge variant="blue" className="flex-shrink-0 font-mono">
            {status.format.toUpperCase()} · {status.bitrate}K
          </Badge>
        )}
      </div>

      {/* ── VU Meter ── */}
      <div className="px-4 py-3 border-b border-border">
        <VUMeter levels={levels} />
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
        <div className="flex flex-col items-center gap-1 py-3">
          <Clock size={13} className="text-muted-foreground" />
          <div className="text-sm font-bold font-mono text-foreground">
            {status ? fmtUptime(status.uptime) : '00:00:00'}
          </div>
          <div className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground">UPTIME</div>
        </div>
        <div className="flex flex-col items-center gap-1 py-3">
          <Users size={13} className="text-muted-foreground" />
          <div className="text-sm font-bold font-mono text-foreground">–</div>
          <div className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground">HÖRER</div>
        </div>
        <div className="flex flex-col items-center gap-1 py-3">
          <Activity size={13} className="text-muted-foreground" />
          <div className="text-sm font-bold font-mono text-foreground">
            {status ? `${status.bitrate} k` : '–'}
          </div>
          <div className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground">BITRATE</div>
        </div>
      </div>

      {/* ── Connect button ── */}
      <div className="p-3">
        <Button
          onClick={(e) => { e.stopPropagation(); onSelect(); isRunning ? onStop() : onStart() }}
          disabled={isLoading}
          className={cn(
            'w-full h-11 text-sm font-bold tracking-wider gap-2 border-0',
            isConnected
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : isRunning
              ? 'bg-orange-500 hover:bg-orange-600 text-white'
              : 'bg-teal-600 hover:bg-teal-700 text-white'
          )}
        >
          {isRunning ? <WifiOff size={15} /> : <Wifi size={15} />}
          {isConnected ? 'Trennen' : isRunning ? 'Verbinde…' : 'Verbinden'}
        </Button>
      </div>
    </Card>
  )
}

// ─── App ─────────────────────────────────────────────────────────────────────
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

  const [servers, setServers]                   = useState<ServerEntry[]>(() => [makeServerEntry('Hauptstream')])
  const [selectedServerId, setSelectedServerId] = useState<string>('')
  const [encoderConfig, setEncoderConfig]       = useState<EncoderConfig>(DEFAULT_ENCODER)
  const [selectedDevice, setSelectedDevice]     = useState('')
  const [secondaryPage, setSecondaryPage]       = useState<SecondaryPage>(null)
  const [allStatuses, setAllStatuses]           = useState<AllStreamStatus>({})
  const [levels, setLevels]                     = useState<LevelUpdate>(EMPTY_LEVELS)
  const [error, setError]                       = useState<string | null>(null)
  const [loadingIds, setLoadingIds]             = useState<Set<string>>(new Set())
  const [wsConnected, setWsConnected]           = useState(false)
  const [monitoring, setMonitoring]             = useState(false)

  const levelsDecayRef = useRef<number | null>(null)
  const configReady    = useRef(false)

  const handleToken = useCallback((tok: string) => {
    localStorage.setItem('opencast_token', tok)
    setTokenState(tok)
  }, [])

  useEffect(() => {
    onUnauthorized(() => { setTokenState(''); localStorage.removeItem('opencast_token') })
  }, [])

  useEffect(() => {
    if (!token) return
    configReady.current = false
    apiFetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        configReady.current = true
        if (cfg.encoder)  setEncoderConfig((c) => ({ ...c, ...cfg.encoder }))
        if (cfg.deviceId) setSelectedDevice(cfg.deviceId)
        if (cfg.servers?.length) {
          setServers(cfg.servers)
          setSelectedServerId((cur) => {
            const stillValid = cfg.servers.some((s: { id: string }) => s.id === cur)
            return stillValid ? cur : cfg.servers[0].id
          })
        } else if (cfg.server) {
          const e = makeServerEntry('Hauptstream')
          e.config = { ...e.config, ...cfg.server }
          setServers([e]); setSelectedServerId(e.id)
        }
      })
      .catch(() => { configReady.current = true })
  }, [token])

  useEffect(() => {
    if (!token || !configReady.current) return
    const t = setTimeout(() => {
      apiFetch('/api/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers, encoder: encoderConfig, deviceId: selectedDevice }),
      }).catch(() => {})
    }, 500)
    return () => clearTimeout(t)
  }, [servers, encoderConfig, selectedDevice, token])

  const handleWSMessage = useCallback((msg: WSPayload) => {
    setWsConnected(true)
    if (msg.type === 'status') {
      setAllStatuses(msg.payload)
    } else if (msg.type === 'level') {
      setLevels(msg.payload)
      if (levelsDecayRef.current) clearTimeout(levelsDecayRef.current)
      levelsDecayRef.current = setTimeout(() => setLevels(EMPTY_LEVELS), 200) as unknown as number
    } else if (msg.type === 'error') {
      setError(msg.payload.message)
    }
  }, [])

  useWebSocket(handleWSMessage, token)

  useEffect(() => {
    if (!token || !selectedDevice) { setMonitoring(false); return }
    if (Object.keys(allStatuses).length > 0) { setMonitoring(false); return }
    apiFetch('/api/monitor/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: selectedDevice, sampleRate: encoderConfig.sampleRate, channels: encoderConfig.channels }),
    }).then((r) => r.json()).then((d) => setMonitoring(d.status === 'ok')).catch(() => setMonitoring(false))
  }, [selectedDevice, encoderConfig.sampleRate, encoderConfig.channels, token, Object.keys(allStatuses).join(',')]) // eslint-disable-line

  const setLoading = (id: string, on: boolean) =>
    setLoadingIds((s) => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n })

  const handleStart = async (serverId: string) => {
    const entry = servers.find((s) => s.id === serverId)
    if (!entry) return
    setError(null); setLoading(serverId, true)
    try {
      const res = await apiFetch('/api/stream/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streamId: serverId, deviceId: selectedDevice,
          sampleRate: encoderConfig.sampleRate, channels: encoderConfig.channels,
          format: encoderConfig.format, bitrate: encoderConfig.bitrate, server: entry.config,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Fehler')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setLoading(serverId, false) }
  }

  const handleStop = async (serverId: string) => {
    setError(null); setLoading(serverId, true)
    try {
      await apiFetch('/api/stream/stop', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamId: serverId }),
      })
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setLoading(serverId, false) }
  }

  const updateServer = (id: string, patch: Partial<ServerEntry>) =>
    setServers((ss) => ss.map((s) => s.id === id ? { ...s, ...patch } : s))
  const updateServerConfig = (id: string, patch: Partial<ServerConfig>) =>
    setServers((ss) => ss.map((s) => s.id === id ? { ...s, config: { ...s.config, ...patch } } : s))
  const addServer = () => {
    const e = makeServerEntry(`Server ${servers.length + 1}`)
    setServers((ss) => [...ss, e]); setSelectedServerId(e.id)
  }
  const removeServer = (id: string) => {
    if (allStatuses[id]) return
    setServers((ss) => {
      const next = ss.filter((s) => s.id !== id)
      setSelectedServerId((cur) => cur === id ? (next[0]?.id ?? '') : cur)
      return next
    })
  }

  if (!token) return <TokenGate onToken={handleToken} />

  // ─── Derived ────────────────────────────────────────────────────────────────
  const selectedServer = servers.find((s) => s.id === selectedServerId)
  const anyRunning     = Object.keys(allStatuses).length > 0

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex bg-slate-100 overflow-hidden p-3 gap-3" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── Inspector / Sidebar ── */}
      <aside className="w-72 bg-white rounded-2xl shadow-sm border border-border flex-shrink-0 flex flex-col overflow-hidden">

        {/* App header */}
        <div className="px-4 py-3.5 border-b border-border flex items-center gap-2.5 flex-shrink-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-700 to-blue-500 flex items-center justify-center shadow-lg shadow-blue-200 flex-shrink-0">
            <Radio size={13} className="text-white" />
          </div>
          <div>
            <div className="text-[13px] font-bold text-slate-900 leading-none">Opencast</div>
            <div className="text-[9px] text-slate-400 leading-none mt-0.5">Source Client</div>
          </div>
        </div>

        {/* Secondary nav tabs */}
        <div className="flex border-b border-border flex-shrink-0">
          {SECONDARY_NAV.map(({ id, Icon, label }) => (
            <button
              key={id}
              title={label}
              onClick={() => setSecondaryPage(secondaryPage === id ? null : id)}
              className={cn(
                'flex-1 flex flex-col items-center gap-0.5 py-2 text-[9px] font-semibold tracking-wide transition-colors border-b-2',
                secondaryPage === id
                  ? 'border-blue-500 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'
              )}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>

        {/* Quellen tab: device + encoder */}
        {secondaryPage === 'quellen' && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex flex-col gap-6">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
                  Audiogerät
                </div>
                <DevicePanel
                  selectedDevice={selectedDevice}
                  encoderConfig={encoderConfig}
                  disabled={anyRunning}
                  onDeviceChange={setSelectedDevice}
                  onEncoderChange={(p) => setEncoderConfig((c) => ({ ...c, ...p }))}
                />
              </div>
              <div className="border-t border-border pt-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
                  Encoder
                </div>
                <EncoderSettings
                  config={encoderConfig}
                  disabled={anyRunning}
                  onChange={(p) => setEncoderConfig((c) => ({ ...c, ...p }))}
                />
              </div>
            </div>
          </div>
        )}

        {/* Other placeholder tabs */}
        {secondaryPage && secondaryPage !== 'quellen' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground p-4">
            <div className="text-xs font-semibold">
              {SECONDARY_NAV.find((n) => n.id === secondaryPage)?.label}
            </div>
            <div className="text-[10px] opacity-50 text-center">Noch nicht implementiert</div>
          </div>
        )}

        {/* Inspector content (shown when no tab is open) */}
        {!secondaryPage && (
          <>
            {/* Inspector header */}
            <div className="px-4 py-3 border-b border-border flex-shrink-0">
              {selectedServer ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-foreground truncate">{selectedServer.label}</div>
                    <div className="text-[10px] text-muted-foreground">Stream-Einstellungen</div>
                  </div>
                  {!allStatuses[selectedServer.id] && (
                    <Button
                      variant="ghost" size="icon"
                      onClick={() => removeServer(selectedServer.id)}
                      className="h-6 w-6 text-slate-300 hover:text-red-500 flex-shrink-0"
                    >
                      <Trash2 size={11} />
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <div className="text-xs font-bold text-foreground">Inspector</div>
                  <div className="text-[10px] text-muted-foreground">Karte auswählen</div>
                </>
              )}
            </div>

            {/* Inspector body */}
            <div className="flex-1 overflow-y-auto p-4">
              {selectedServer ? (
                <ServerPanel
                  label={selectedServer.label}
                  config={selectedServer.config}
                  disabled={!!allStatuses[selectedServer.id]}
                  onChange={(p) => updateServerConfig(selectedServer.id, p)}
                  onLabelChange={(l) => updateServer(selectedServer.id, { label: l })}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 py-16 text-center">
                  <Radio size={20} className="text-slate-200" />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Stream-Karte anklicken<br />um Einstellungen zu bearbeiten
                  </p>
                </div>
              )}
            </div>
          </>
        )}

      </aside>

      {/* ── Content ── */}
      <main className="flex-1 overflow-hidden flex flex-col bg-white rounded-2xl shadow-sm border border-border">
        <div
          className="flex-1 overflow-y-auto p-5"
          onClick={() => setSelectedServerId('')}
        >
          {/* Monitoring indicator */}
          {!anyRunning && monitoring && (
            <div className="mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              <span className="text-[10px] text-violet-500 font-semibold tracking-wider">MONITORING</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <AlertCircle size={13} className="text-red-500 mt-0.5 flex-shrink-0" />
              <span className="text-xs text-red-600 leading-relaxed">{error}</span>
            </div>
          )}

          {/* Stream cards */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
            {servers.map((server) => (
              <StreamCard
                key={server.id}
                server={server}
                status={allStatuses[server.id] ?? null}
                isLoading={loadingIds.has(server.id)}
                levels={levels}
                selected={selectedServerId === server.id}
                onSelect={() => {
                  setSecondaryPage(null)
                  setSelectedServerId(selectedServerId === server.id ? '' : server.id)
                }}
                onStart={() => handleStart(server.id)}
                onStop={() => handleStop(server.id)}
              />
            ))}

            {/* Add server tile */}
            <button
              onClick={(e) => { e.stopPropagation(); addServer() }}
              className="min-h-48 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-teal-300 hover:text-teal-500 hover:bg-teal-50/30 transition-all flex flex-col items-center justify-center gap-2.5"
            >
              <Plus size={20} />
              <span className="text-xs font-semibold">Server hinzufügen</span>
            </button>
          </div>
        </div>

        <StatusBar allStatuses={allStatuses} wsConnected={wsConnected} />
      </main>

    </div>
  )
}
