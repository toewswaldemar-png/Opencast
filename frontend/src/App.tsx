import { useState, useCallback, useRef, useEffect } from 'react'
import { Radio, AlertCircle } from 'lucide-react'

import ServerPanel from './components/ServerPanel'
import ServerList from './components/ServerList'
import DevicePanel from './components/DevicePanel'
import EncoderSettings from './components/EncoderSettings'
import VUMeter from './components/VUMeter'
import StatusBar from './components/StatusBar'
import TokenGate from './components/TokenGate'

import { useWebSocket } from './hooks/useWebSocket'
import { apiFetch, onUnauthorized } from './lib/api'

import {
  ServerEntry, ServerConfig, EncoderConfig, StreamStatus, LevelUpdate, WSPayload,
  makeServerEntry, DEFAULT_ENCODER,
} from './types'

const EMPTY_LEVELS: LevelUpdate = { left: -120, right: -120 }
const EMPTY_STATUS: StreamStatus = {
  running: false, connected: false, reconnecting: false,
  uptime: 0, bytesSent: 0, bitrate: 0, format: 'mp3',
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default function App() {
  const [token, setTokenState] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('auth')
    if (fromUrl) {
      localStorage.setItem('opencast_token', fromUrl)
      history.replaceState(null, '', window.location.pathname)
      return fromUrl
    }
    return localStorage.getItem('opencast_token') ?? ''
  })

  const [servers, setServers] = useState<ServerEntry[]>(() => [makeServerEntry('Hauptstream')])
  const [selectedServerId, setSelectedServerId] = useState<string>('')
  const [runningServerId, setRunningServerId] = useState<string | null>(null)
  const [encoderConfig, setEncoderConfig] = useState<EncoderConfig>(DEFAULT_ENCODER)
  const [selectedDevice, setSelectedDevice] = useState('')
  const [activeTab, setActiveTab] = useState<'stream' | 'server'>('stream')

  const [status, setStatus] = useState<StreamStatus>(EMPTY_STATUS)
  const [levels, setLevels] = useState<LevelUpdate>(EMPTY_LEVELS)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)
  const [monitoring, setMonitoring] = useState(false)

  const levelsDecayRef = useRef<number | null>(null)
  const configReady = useRef(false)

  const handleToken = useCallback((tok: string) => {
    localStorage.setItem('opencast_token', tok)
    setTokenState(tok)
  }, [])

  useEffect(() => {
    onUnauthorized(() => {
      setTokenState('')
      localStorage.removeItem('opencast_token')
    })
  }, [])

  // Auto-select first server
  useEffect(() => {
    if (servers.length > 0 && !selectedServerId) {
      setSelectedServerId(servers[0].id)
    }
  }, [])

  // Config load — migrates old single-server format to array
  useEffect(() => {
    if (!token) return
    configReady.current = false
    apiFetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        configReady.current = true
        if (cfg.encoder) setEncoderConfig((c) => ({ ...c, ...cfg.encoder }))
        if (cfg.deviceId) setSelectedDevice(cfg.deviceId)
        if (cfg.servers && Array.isArray(cfg.servers) && cfg.servers.length > 0) {
          setServers(cfg.servers)
          setSelectedServerId((id) => id || cfg.servers[0].id)
        } else if (cfg.server) {
          const entry = makeServerEntry('Hauptstream')
          entry.config = { ...entry.config, ...cfg.server }
          setServers([entry])
          setSelectedServerId(entry.id)
        }
      })
      .catch(() => { configReady.current = true })
  }, [token])

  // Config save with debounce
  useEffect(() => {
    if (!token || !configReady.current) return
    const timer = setTimeout(() => {
      apiFetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers, encoder: encoderConfig, deviceId: selectedDevice }),
      }).catch(() => {})
    }, 500)
    return () => clearTimeout(timer)
  }, [servers, encoderConfig, selectedDevice, token])

  const handleWSMessage = useCallback((msg: WSPayload) => {
    setWsConnected(true)
    if (msg.type === 'status') {
      setStatus(msg.payload)
      if (!msg.payload.running) setRunningServerId(null)
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
    if (!token || !selectedDevice || status.running) { setMonitoring(false); return }
    apiFetch('/api/monitor/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: selectedDevice, sampleRate: encoderConfig.sampleRate, channels: encoderConfig.channels }),
    })
      .then((res) => res.json())
      .then((data) => setMonitoring(data.status === 'ok'))
      .catch(() => setMonitoring(false))
  }, [selectedDevice, status.running, encoderConfig.sampleRate, encoderConfig.channels, token])

  const handleStart = async (serverId: string) => {
    const serverEntry = servers.find((s) => s.id === serverId)
    if (!serverEntry) return
    setError(null); setLoading(true); setMonitoring(false)
    try {
      const res = await apiFetch('/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: selectedDevice,
          sampleRate: encoderConfig.sampleRate,
          channels: encoderConfig.channels,
          format: encoderConfig.format,
          bitrate: encoderConfig.bitrate,
          server: serverEntry.config,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Stream konnte nicht gestartet werden')
      setRunningServerId(serverId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setLoading(false) }
  }

  const handleStop = async () => {
    setError(null); setLoading(true)
    try { await apiFetch('/api/stream/stop', { method: 'POST' }) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setLoading(false) }
  }

  const updateServer = (id: string, patch: Partial<ServerEntry>) =>
    setServers((ss) => ss.map((s) => s.id === id ? { ...s, ...patch } : s))

  const updateServerConfig = (id: string, patch: Partial<ServerConfig>) =>
    setServers((ss) => ss.map((s) => s.id === id ? { ...s, config: { ...s.config, ...patch } } : s))

  const addServer = () => {
    const entry = makeServerEntry(`Server ${servers.length + 1}`)
    setServers((ss) => [...ss, entry])
    setSelectedServerId(entry.id)
  }

  const removeServer = (id: string) => {
    setServers((ss) => {
      const next = ss.filter((s) => s.id !== id)
      setSelectedServerId((cur) => cur === id ? (next[0]?.id ?? '') : cur)
      return next
    })
  }

  if (!token) return <TokenGate onToken={handleToken} />

  const selectedServer = servers.find((s) => s.id === selectedServerId)
  const runningServer = servers.find((s) => s.id === runningServerId)
  const isLive = status.running && status.connected

  return (
    <div
      className="text-slate-800"
      style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      {/* Header */}
      <header
        className="flex items-center gap-3 px-5 py-3 shrink-0"
        style={{ background: 'rgba(255,255,255,0.92)', borderBottom: '1px solid rgba(0,0,0,0.08)', backdropFilter: 'blur(12px)' }}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shadow-sm"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' }}>
            <Radio size={14} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-800 leading-none">Opencast</h1>
            <p className="text-[9px] leading-none mt-0.5 text-slate-400">Icecast Source Client</p>
          </div>
        </div>

        <nav className="flex items-center gap-1 ml-6">
          {(['stream', 'server'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="text-xs px-4 py-1.5 rounded-lg transition-all"
              style={activeTab === tab
                ? { background: '#f1f5f9', color: '#1e293b', fontWeight: 500, border: '1px solid #e2e8f0' }
                : { color: '#94a3b8', border: '1px solid transparent' }
              }
            >
              {tab === 'stream' ? 'Stream' : 'Server'}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {isLive && (
            <div className="flex items-center gap-2 rounded-full px-3 py-1 border border-rose-200 bg-rose-50"
              style={{ boxShadow: '0 0 12px rgba(225,29,72,0.1)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              <span className="text-[11px] font-bold text-rose-600 tracking-widest">ON AIR</span>
            </div>
          )}
          {status.reconnecting && !isLive && (
            <div className="flex items-center gap-2 rounded-full px-3 py-1 border border-orange-200 bg-orange-50">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
              <span className="text-[11px] font-bold text-orange-600 tracking-widest">RECONNECT</span>
            </div>
          )}
          {monitoring && !status.running && (
            <div className="flex items-center gap-2 rounded-full px-3 py-1 border border-indigo-200 bg-indigo-50">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              <span className="text-[11px] font-bold text-indigo-600 tracking-widest">MONITOR</span>
            </div>
          )}
        </div>
      </header>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Sidebar — audio controls + VU meter */}
        <aside
          className="flex flex-col gap-2.5 p-3 shrink-0"
          style={{
            width: '220px',
            borderRight: '1px solid rgba(0,0,0,0.07)',
            background: 'rgba(255,255,255,0.5)',
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          <DevicePanel
            bare
            selectedDevice={selectedDevice}
            encoderConfig={encoderConfig}
            disabled={status.running}
            onDeviceChange={setSelectedDevice}
            onEncoderChange={(p) => setEncoderConfig((c) => ({ ...c, ...p }))}
          />
          <div style={{ height: '1px', background: 'rgba(0,0,0,0.06)' }} />
          <EncoderSettings
            bare
            config={encoderConfig}
            disabled={status.running}
            onChange={(p) => setEncoderConfig((c) => ({ ...c, ...p }))}
          />
          <div style={{ height: '1px', background: 'rgba(0,0,0,0.06)' }} />
          <VUMeter bare levels={levels} />
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Stream tab */}
          {activeTab === 'stream' && (
            <div className="flex flex-col gap-3 p-4" style={{ flex: 1, overflow: 'hidden' }}>
              <ServerList
                servers={servers}
                selectedId={selectedServerId}
                runningId={runningServerId}
                status={status}
                loading={loading}
                onSelect={setSelectedServerId}
                onStart={handleStart}
                onStop={handleStop}
                onAdd={addServer}
                onRemove={removeServer}
              />

              {error && (
                <div className="flex items-start gap-2 rounded-xl px-4 py-3 border border-red-200 bg-red-50 shrink-0">
                  <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-red-600 leading-relaxed">{error}</p>
                </div>
              )}

              {status.running && (
                <div className="grid grid-cols-3 gap-2 shrink-0">
                  {[
                    { label: 'Uptime',   value: formatUptime(status.uptime / 1e9),  color: isLive ? '#16a34a' : '#ea580c' },
                    { label: 'Gesendet', value: formatBytes(status.bytesSent),       color: '#475569' },
                    { label: 'Bitrate',  value: `${status.bitrate} kbps`,            color: '#4f46e5' },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-xl px-3 py-2.5 text-center border border-slate-200 bg-white shadow-sm">
                      <div className="font-mono text-sm font-semibold" style={{ color: stat.color }}>{stat.value}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wide">{stat.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {status.running && runningServer && (
                <div className="rounded-xl p-3 border border-slate-200 bg-white shadow-sm shrink-0">
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-2 font-semibold">Verbindung</div>
                  <div className="flex flex-col gap-1.5">
                    {[
                      ['Server',     `${runningServer.config.useSSL ? 'https' : 'http'}://${runningServer.config.host}:${runningServer.config.port}`],
                      ['Mountpoint', runningServer.config.mountPoint],
                      ['Format',     `${encoderConfig.format.toUpperCase()} · ${encoderConfig.bitrate} kbps`],
                      ['Audio',      `${encoderConfig.sampleRate / 1000} kHz · ${encoderConfig.channels === 1 ? 'Mono' : encoderConfig.channels === 2 ? 'Stereo' : `${encoderConfig.channels}ch`}`],
                    ].map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2">
                        <span className="text-slate-400 w-20 text-[10px]">{k}</span>
                        <span className="font-mono text-slate-600 text-[10px]">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Server tab */}
          {activeTab === 'server' && (
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', gap: '0' }}>
              {/* Left: server list for selection */}
              <div
                className="flex flex-col p-4 shrink-0"
                style={{ width: '280px', borderRight: '1px solid rgba(0,0,0,0.06)', overflowY: 'auto' }}
              >
                <ServerList
                  servers={servers}
                  selectedId={selectedServerId}
                  runningId={runningServerId}
                  status={status}
                  loading={loading}
                  onSelect={setSelectedServerId}
                  onStart={handleStart}
                  onStop={handleStop}
                  onAdd={addServer}
                  onRemove={removeServer}
                />
              </div>

              {/* Right: edit form for selected server */}
              <div style={{ flex: 1, overflowY: 'auto' }} className="p-4">
                {selectedServer ? (
                  <ServerPanel
                    label={selectedServer.label}
                    config={selectedServer.config}
                    disabled={selectedServer.id === runningServerId && status.running}
                    onChange={(p) => updateServerConfig(selectedServer.id, p)}
                    onLabelChange={(l) => updateServer(selectedServer.id, { label: l })}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                    Kein Server ausgewählt
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      <StatusBar status={status} wsConnected={wsConnected} />
    </div>
  )
}
