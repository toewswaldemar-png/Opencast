import { useState, useCallback, useRef, useEffect } from 'react'
import { Radio } from 'lucide-react'

import ServerPanel from './components/ServerPanel'
import DevicePanel from './components/DevicePanel'
import EncoderSettings from './components/EncoderSettings'
import StreamControls from './components/StreamControls'
import VUMeter from './components/VUMeter'
import StatusBar from './components/StatusBar'

import { useWebSocket } from './hooks/useWebSocket'

import {
  ServerConfig,
  EncoderConfig,
  StreamStatus,
  LevelUpdate,
  WSPayload,
  DEFAULT_SERVER,
  DEFAULT_ENCODER,
} from './types'

const EMPTY_LEVELS: LevelUpdate = { left: -120, right: -120 }
const EMPTY_STATUS: StreamStatus = {
  running: false,
  connected: false,
  uptime: 0,
  bytesSent: 0,
  bitrate: 0,
  format: 'mp3',
}

export default function App() {
  const [serverConfig, setServerConfig] = useState<ServerConfig>(DEFAULT_SERVER)
  const [encoderConfig, setEncoderConfig] = useState<EncoderConfig>(DEFAULT_ENCODER)
  const [selectedDevice, setSelectedDevice] = useState('')
  const [status, setStatus] = useState<StreamStatus>(EMPTY_STATUS)
  const [levels, setLevels] = useState<LevelUpdate>(EMPTY_LEVELS)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)
  const [monitoring, setMonitoring] = useState(false)

  const levelsDecayRef = useRef<number | null>(null)

  const handleWSMessage = useCallback((msg: WSPayload) => {
    setWsConnected(true)
    if (msg.type === 'status') {
      setStatus(msg.payload)
    } else if (msg.type === 'level') {
      setLevels(msg.payload)
      // Decay levels to silence if no update comes for 200ms
      if (levelsDecayRef.current) clearTimeout(levelsDecayRef.current)
      levelsDecayRef.current = setTimeout(() => {
        setLevels(EMPTY_LEVELS)
      }, 200) as unknown as number
    } else if (msg.type === 'error') {
      setError(msg.payload.message)
    }
  }, [])

  useWebSocket(handleWSMessage)

  useEffect(() => {
    if (!selectedDevice || status.running) {
      setMonitoring(false)
      return
    }
    fetch('/api/monitor/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: selectedDevice,
        sampleRate: encoderConfig.sampleRate,
        channels: encoderConfig.channels,
      }),
    })
      .then((res) => res.json())
      .then((data) => setMonitoring(data.status === 'ok'))
      .catch(() => setMonitoring(false))
  }, [selectedDevice, status.running, encoderConfig.sampleRate, encoderConfig.channels])

  const handleStart = async () => {
    setError(null)
    setLoading(true)
    setMonitoring(false)
    try {
      const res = await fetch('/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: selectedDevice,
          sampleRate: encoderConfig.sampleRate,
          channels: encoderConfig.channels,
          format: encoderConfig.format,
          bitrate: encoderConfig.bitrate,
          server: serverConfig,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Stream konnte nicht gestartet werden')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleStop = async () => {
    setError(null)
    setLoading(true)
    try {
      await fetch('/api/stream/stop', { method: 'POST' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-4 border-b border-slate-800 bg-slate-900/70 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/50">
            <Radio size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-100 leading-none">Opencast</h1>
            <p className="text-[10px] text-slate-500 leading-none mt-0.5">Icecast Source Client</p>
          </div>
        </div>

        <div className="ml-auto">
          {status.running ? (
            <div className="flex items-center gap-2 bg-red-600/20 border border-red-500/30 rounded-full px-3 py-1">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs font-semibold text-red-300">ON AIR</span>
            </div>
          ) : monitoring ? (
            <div className="flex items-center gap-2 bg-blue-600/20 border border-blue-500/30 rounded-full px-3 py-1">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-xs font-semibold text-blue-300">MONITOR</span>
            </div>
          ) : null}
        </div>
      </header>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — settings */}
        <aside className="w-80 border-r border-slate-800 bg-slate-900/40 overflow-y-auto flex flex-col gap-4 p-4">
          <ServerPanel
            config={serverConfig}
            disabled={status.running}
            onChange={(partial) => setServerConfig((c) => ({ ...c, ...partial }))}
          />
          <DevicePanel
            selectedDevice={selectedDevice}
            encoderConfig={encoderConfig}
            disabled={status.running}
            onDeviceChange={setSelectedDevice}
            onEncoderChange={(partial) => setEncoderConfig((c) => ({ ...c, ...partial }))}
          />
          <EncoderSettings
            config={encoderConfig}
            disabled={status.running}
            onChange={(partial) => setEncoderConfig((c) => ({ ...c, ...partial }))}
          />
        </aside>

        {/* Main content */}
        <main className="flex-1 flex flex-col gap-6 p-6 overflow-y-auto">
          {/* Stream controls */}
          <StreamControls
            status={status}
            error={error}
            loading={loading}
            onStart={handleStart}
            onStop={handleStop}
          />

          {/* VU Meters */}
          <VUMeter levels={levels} />

          {/* Connection summary */}
          {status.running && (
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
              <div className="text-[11px] text-slate-500 uppercase tracking-widest mb-3 font-medium">
                Verbindungsdetails
              </div>
              <div className="space-y-2 text-sm">
                {[
                  ['Server', `${serverConfig.useSSL ? 'https' : 'http'}://${serverConfig.host}:${serverConfig.port}`],
                  ['Mountpoint', serverConfig.mountPoint],
                  ['Format', `${encoderConfig.format.toUpperCase()} · ${encoderConfig.bitrate} kbps`],
                  ['Audio', `${encoderConfig.sampleRate / 1000} kHz · ${encoderConfig.channels === 2 ? 'Stereo' : 'Mono'}`],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className="text-slate-500 w-24 text-xs">{k}</span>
                    <span className="font-mono text-slate-300 text-xs">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Status bar */}
      <StatusBar status={status} wsConnected={wsConnected} />
    </div>
  )
}
