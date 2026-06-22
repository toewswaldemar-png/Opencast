import { useState, useEffect, useRef } from 'react'
import { Mic, Trash2, RefreshCw, Settings2, AlertCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ServerEntry, ServerConfig, StreamStatus, LevelUpdate, EncoderConfig,
  AudioDevice, SAMPLE_RATES, StreamFormat, EncoderMode, StereoMode,
} from '../types'
import { apiFetch } from '../lib/api'
import { Button }    from '@/components/ui/button'
import { Input }     from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

// ── Helpers ───────────────────────────────────────────────────────────────────

const DB_MIN = -60
const DB_MAX = 0
function pct(db: number) {
  return Math.max(0, Math.min(100, ((db - DB_MIN) / (DB_MAX - DB_MIN)) * 100))
}
function formatUptime(ns: number): string {
  const s   = Math.floor(ns / 1e9)
  const h   = Math.floor(s / 3600)
  const m   = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

interface LogLine {
  id:   number
  time: Date
  text: string
  type: 'ok' | 'warn' | 'info'
}
function fmtLogTime(d: Date): string {
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// Label sitzt auf der Borderlinie des Inputs
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative mt-2">
      <span className="absolute left-3 top-0 -translate-y-1/2 z-10 bg-card px-1 leading-none
                       text-[9px] font-bold uppercase tracking-wider text-muted-foreground pointer-events-none select-none">
        {label}
      </span>
      {children}
    </div>
  )
}

// ── Tab: Server ───────────────────────────────────────────────────────────────

function ServerTab({
  entry, disabled, onChange, onLabelChange,
}: {
  entry:         ServerEntry
  disabled:      boolean
  onChange:      (p: Partial<ServerConfig>) => void
  onLabelChange: (l: string) => void
}) {
  return (
    <div className="p-3 flex flex-col gap-2.5 overflow-y-auto">
      {/* Protokoll */}
      <div className="flex items-center gap-2">
        {(['icecast2', 'shoutcast'] as const).map((p) => (
          <Button key={p} size="xs" variant={entry.config.protocol === p ? 'default' : 'outline'}
            disabled={disabled} onClick={() => onChange({ protocol: p })} className="flex-1 text-[10px]">
            {p === 'icecast2' ? 'Icecast 2' : 'SHOUTcast'}
          </Button>
        ))}
      </div>

      {/* Stream Name | Mount Point */}
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <Field label="Stream Name">
          <Input value={entry.label} onChange={(e) => onLabelChange(e.target.value)}
            disabled={disabled} className="h-7 text-xs font-mono" />
        </Field>
        <Field label="Mount Point">
          <Input value={entry.config.mountPoint} onChange={(e) => onChange({ mountPoint: e.target.value })}
            disabled={disabled} placeholder="/stream" className="h-7 text-xs font-mono" />
        </Field>
      </div>

      {/* Server | Port */}
      <div className="grid grid-cols-[1fr_72px] gap-2">
        <Field label="Server">
          <Input value={entry.config.host} onChange={(e) => onChange({ host: e.target.value })}
            disabled={disabled} placeholder="localhost" className="h-7 text-xs font-mono" />
        </Field>
        <Field label="Port">
          <Input type="number" value={entry.config.port}
            onChange={(e) => onChange({ port: Number(e.target.value) })}
            disabled={disabled} min={1} max={65535} className="h-7 text-xs font-mono" />
        </Field>
      </div>

      {/* Benutzername | Passwort */}
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <Field label="Benutzername">
          <Input value={entry.config.username ?? 'source'}
            onChange={(e) => onChange({ username: e.target.value })}
            disabled={disabled} placeholder="source" className="h-7 text-xs font-mono" />
        </Field>
        <Field label="Passwort">
          <Input type="password" value={entry.config.password}
            onChange={(e) => onChange({ password: e.target.value })}
            disabled={disabled} placeholder="Quellpasswort" className="h-7 text-xs" />
        </Field>
      </div>
    </div>
  )
}

// ── Tab: Audio ────────────────────────────────────────────────────────────────

function AudioTab({
  selectedDevice, encoderConfig, disabled, onDeviceChange, onEncoderChange,
}: {
  selectedDevice:  string
  encoderConfig:   EncoderConfig
  disabled:        boolean
  onDeviceChange:  (id: string) => void
  onEncoderChange: (p: Partial<EncoderConfig>) => void
}) {
  const [devices, setDevices]           = useState<AudioDevice[]>([])
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [panelOpening, setPanelOpening] = useState(false)
  const selectedDeviceRef               = useRef(selectedDevice)
  selectedDeviceRef.current             = selectedDevice
  const selected = devices.find((d) => d.id === selectedDevice)

  const fetchDevices = async () => {
    setLoading(true); setError(null)
    try {
      const res = await apiFetch('/api/devices')
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error ?? `HTTP ${res.status}`) }
      const data: AudioDevice[] = await res.json()
      setDevices(data)
      if (!selectedDeviceRef.current) {
        const first = data.find((d) => d.state === 'active') ?? data[0]
        if (first) onDeviceChange(first.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden')
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchDevices() }, []) // eslint-disable-line

  const openAsioPanel = async () => {
    if (!selected || selected.api !== 'ASIO') return
    setPanelOpening(true)
    try {
      await apiFetch('/api/asio/panel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: selected.id }),
      })
    } finally { setPanelOpening(false) }
  }

  return (
    <div className="p-3 flex flex-col gap-2.5 overflow-y-auto">
      <Field label="Audiogerät">
        <div className="flex gap-2">
          <Select value={selectedDevice} onValueChange={onDeviceChange}
            disabled={disabled || loading || devices.length === 0}>
            <SelectTrigger className="flex-1 h-7 text-xs">
              <SelectValue placeholder={loading ? 'Lade Geräte…' : '— Kein Gerät —'} />
            </SelectTrigger>
            <SelectContent>
              {devices.map((d) => (
                <SelectItem key={d.id} value={d.id} className="text-xs">
                  {d.name}{d.state !== 'active' ? ` (${d.state})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="h-7 w-7 flex-shrink-0"
            onClick={fetchDevices} disabled={loading || disabled} title="Geräte neu laden">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>
        {error && (
          <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 mt-1">
            <AlertCircle size={12} className="flex-shrink-0" />{error}
          </div>
        )}
        {selected && (
          <div className="flex items-center gap-2 mt-1">
            <span className={cn('text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border',
              selected.api === 'ASIO'
                ? 'bg-violet-500/10 border-violet-500/30 text-violet-600'
                : 'bg-blue-500/10 border-blue-500/30 text-blue-600')}>
              {selected.api === 'ASIO' ? 'ASIO ★' : selected.api}
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">
              {selected.maxInputChannels}ch · {selected.defaultSampleRate / 1000}kHz
            </span>
            {selected.api === 'ASIO' && (
              <Button variant="ghost" size="xs" onClick={openAsioPanel}
                disabled={panelOpening || disabled}
                className="ml-auto text-violet-600 hover:text-violet-700 gap-1 h-6 text-[10px]">
                <Settings2 size={9} className={panelOpening ? 'animate-spin' : ''} />
                {panelOpening ? 'Öffne…' : 'Panel'}
              </Button>
            )}
          </div>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Samplerate">
          <Select value={String(encoderConfig.sampleRate)}
            onValueChange={(v) => onEncoderChange({ sampleRate: Number(v) as typeof SAMPLE_RATES[number] })}
            disabled={disabled}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SAMPLE_RATES.map((r) => (
                <SelectItem key={r} value={String(r)} className="text-xs">
                  {(r / 1000).toFixed(r % 1000 === 0 ? 0 : 1)} kHz
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Kanäle">
          <Select value={String(encoderConfig.channels)}
            onValueChange={(v) => onEncoderChange({ channels: Number(v) })}
            disabled={disabled}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: Math.max(1, selected?.maxInputChannels ?? 2) }, (_, i) => i + 1).map((n) => (
                <SelectItem key={n} value={String(n)} className="text-xs">
                  {n === 1 ? 'Mono' : n === 2 ? 'Stereo' : `${n} Kanäle`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    </div>
  )
}

// ── Tab: Encoder ──────────────────────────────────────────────────────────────

const FORMATS: { id: StreamFormat; label: string; sub: string }[] = [
  { id: 'mp3', label: 'MP3', sub: 'lame'   },
  { id: 'aac', label: 'AAC', sub: 'native' },
  { id: 'ogg', label: 'OGG', sub: 'vorbis' },
]
const CBR_BITRATES: Record<StreamFormat, number[]> = {
  mp3: [64, 96, 128, 192, 256, 320],
  aac: [64, 96, 128, 192, 256],
  ogg: [64, 96, 128, 192, 256],
}
const VBR_QUALITIES = [0, 2, 4, 6, 8] as const
const STEREO_MODES: { id: StereoMode; label: string }[] = [
  { id: 'auto',   label: 'Auto'   },
  { id: 'joint',  label: 'Joint'  },
  { id: 'stereo', label: 'Stereo' },
  { id: 'mono',   label: 'Mono'   },
]

function EncoderTab({ encoderConfig, disabled, onEncoderChange }: {
  encoderConfig:   EncoderConfig
  disabled:        boolean
  onEncoderChange: (p: Partial<EncoderConfig>) => void
}) {
  const isVbr    = encoderConfig.mode === 'vbr'
  const bitrates = CBR_BITRATES[encoderConfig.format]

  const handleFormatChange = (fmt: StreamFormat) => {
    const rates   = CBR_BITRATES[fmt]
    const bitrate = rates.includes(encoderConfig.bitrate) ? encoderConfig.bitrate : rates[3] ?? rates[rates.length - 1]
    onEncoderChange({ format: fmt, bitrate })
  }

  return (
    <div className="p-3 flex flex-col gap-2.5 overflow-y-auto">

      {/* Format | Modus */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Format">
          <Select value={encoderConfig.format} onValueChange={(v) => handleFormatChange(v as StreamFormat)} disabled={disabled}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FORMATS.map((f) => (
                <SelectItem key={f.id} value={f.id} className="text-xs">
                  {f.label} <span className="text-muted-foreground">({f.sub})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Modus">
          <Select value={encoderConfig.mode} onValueChange={(v) => onEncoderChange({ mode: v as EncoderMode })} disabled={disabled}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cbr" className="text-xs">CBR — Konstant</SelectItem>
              <SelectItem value="vbr" className="text-xs">VBR — Variabel</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      {/* Bitrate (CBR) oder Qualität (VBR) | Stereo */}
      <div className="grid grid-cols-2 gap-2">
        {!isVbr ? (
          <Field label="Bitrate">
            <Select value={String(encoderConfig.bitrate)} onValueChange={(v) => onEncoderChange({ bitrate: Number(v) })} disabled={disabled}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {bitrates.map((br) => (
                  <SelectItem key={br} value={String(br)} className="text-xs font-mono">{br} kbps</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : (
          <Field label="VBR Qualität">
            <Select value={String(encoderConfig.quality)} onValueChange={(v) => onEncoderChange({ quality: Number(v) })} disabled={disabled}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {VBR_QUALITIES.map((q) => (
                  <SelectItem key={q} value={String(q)} className="text-xs font-mono">
                    {q} {q === 0 ? '— beste' : q === 8 ? '— niedrig' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field label="Stereo">
          <Select value={encoderConfig.stereoMode} onValueChange={(v) => onEncoderChange({ stereoMode: v as StereoMode })} disabled={disabled}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STEREO_MODES.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs">{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ isLive, isReconnecting, isConnecting }: { isLive: boolean; isReconnecting: boolean; isConnecting: boolean }) {
  if (isLive) return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 flex-shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Live
    </span>
  )
  if (isReconnecting) return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 flex-shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />Reconnect
    </span>
  )
  if (isConnecting) return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-500 flex-shrink-0">
      <RefreshCw size={10} className="animate-spin" />Verbindet…
    </span>
  )
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground flex-shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />Offline
    </span>
  )
}

function StatIcon({ name, accent }: { name: string; accent: boolean }) {
  const cls = cn('flex-shrink-0', accent ? 'text-blue-600' : 'text-muted-foreground')
  if (name === 'clock') return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cls}>
      <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
    </svg>
  )
  if (name === 'users') return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cls}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cls}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  entry:           ServerEntry
  status:          StreamStatus | null
  levels:          LevelUpdate
  encoderConfig:   EncoderConfig
  selectedDevice:  string
  anyRunning:      boolean
  isLoading:       boolean
  error?:          string | null
  onStart:         () => void
  onStop:          () => void
  onChange:        (p: Partial<ServerConfig>) => void
  onLabelChange:   (l: string) => void
  onDeviceChange:  (id: string) => void
  onEncoderChange: (p: Partial<EncoderConfig>) => void
  onRemove?:       () => void
}

// ── Main Card ─────────────────────────────────────────────────────────────────

export default function StreamCard({
  entry, status, levels, encoderConfig, selectedDevice, anyRunning,
  isLoading, error, onStart, onStop, onChange, onLabelChange, onDeviceChange, onEncoderChange, onRemove,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [log, setLog]                   = useState<LogLine[]>([])
  const [nowPlaying, setNowPlaying]     = useState('')
  const logIdRef                        = useRef(0)
  const prevStatusRef                   = useRef<StreamStatus | null>(null)
  const metaTimerRef                    = useRef<number | null>(null)

  useEffect(() => {
    if (error) {
      setLog((l) => [...l.slice(-9), { id: logIdRef.current++, time: new Date(), text: error, type: 'warn' }])
    }
  }, [error]) // eslint-disable-line

  useEffect(() => {
    const prev = prevStatusRef.current
    const curr = status
    const add = (text: string, type: LogLine['type']) =>
      setLog((l) => [...l.slice(-9), { id: logIdRef.current++, time: new Date(), text, type }])

    if      (curr?.connected  && !prev?.connected)                add('Verbunden', 'ok')
    else if (!curr?.connected && prev?.connected && curr?.running) add('Verbindung unterbrochen', 'warn')
    else if (curr?.reconnecting && !prev?.reconnecting)            add('Verbindungsversuch…', 'info')
    else if (prev?.running && !curr?.running)                      add('Getrennt', 'info')

    prevStatusRef.current = curr
  }, [status]) // eslint-disable-line

  // Send now-playing metadata with debounce
  const handleNowPlayingChange = (val: string) => {
    setNowPlaying(val)
    if (metaTimerRef.current) clearTimeout(metaTimerRef.current)
    if (!isLive) return
    metaTimerRef.current = setTimeout(() => {
      apiFetch('/api/stream/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamId: entry.id, title: val }),
      }).catch(() => {})
    }, 800) as unknown as number
  }

  // Also send when stream goes live (in case a title was already typed)
  const prevLiveRef = useRef(false)
  useEffect(() => {
    const wasLive = prevLiveRef.current
    const live    = !!(status?.running && status?.connected)
    if (live && !wasLive && nowPlaying) {
      apiFetch('/api/stream/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamId: entry.id, title: nowPlaying }),
      }).catch(() => {})
    }
    prevLiveRef.current = live
  }, [status?.running, status?.connected]) // eslint-disable-line

  const isLive         = !!(status?.running && status?.connected)
  const isReconnecting = !!(status?.running && !status?.connected && status?.reconnecting)
  const isConnecting   = !!(status?.running && !status?.connected && !status?.reconnecting)
  const displayLevels  = levels

  return (
    <div className={cn(
      'flex flex-col rounded-xl border bg-card overflow-hidden transition-all duration-200',
      isLive         && 'border-blue-400/50 shadow-lg shadow-blue-500/10',
      isReconnecting && 'border-amber-500/20',
      isConnecting   && 'border-blue-400/20',
      !status?.running && 'border-border',
    )}>

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <div className={cn(
          'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0',
          isLive           ? 'bg-blue-600/10 text-blue-600'
          : isReconnecting ? 'bg-amber-500/10 text-amber-600'
          : isConnecting   ? 'bg-blue-500/10 text-blue-500'
          :                  'bg-muted text-muted-foreground',
        )}>
          <Mic size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate leading-tight">{entry.label}</p>
          <p className="text-[11px] text-muted-foreground font-mono truncate leading-tight mt-0.5">
            {entry.config.host}:{entry.config.port}{entry.config.mountPoint}
          </p>
        </div>
        <StatusBadge isLive={isLive} isReconnecting={isReconnecting} isConnecting={isConnecting} />
        {onRemove && !status?.running && settingsOpen && (
          <Button variant="ghost" size="icon"
            className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={onRemove} title="Stream löschen">
            <Trash2 size={13} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'h-7 w-7 flex-shrink-0',
            settingsOpen
              ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setSettingsOpen((s) => !s)}
          title={settingsOpen ? 'Einstellungen schließen' : 'Einstellungen'}
        >
          {settingsOpen ? <X size={13} /> : <Settings2 size={13} />}
        </Button>
      </div>

      {/* ── Body: Status -oder- Einstellungen ── */}
      <div className="min-h-[224px]">
      {!settingsOpen ? (
        <>
          {/* Now Playing / Metadata */}
          <div className="flex items-center gap-2 px-4 pb-3">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-muted-foreground/50 flex-shrink-0">
              <circle cx="12" cy="12" r="2"/>
              <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>
            </svg>
            {isLive ? (
              <input
                className="flex-1 text-[11px] font-mono bg-transparent border-b border-border/50
                           focus:border-blue-400 outline-none text-foreground placeholder:text-muted-foreground/50
                           transition-colors"
                placeholder="Titel · Interpret"
                value={nowPlaying}
                onChange={(e) => handleNowPlayingChange(e.target.value)}
              />
            ) : (
              <span className="flex-1 text-[11px] text-muted-foreground truncate">
                {nowPlaying || 'Kein Titel · Unbekannt'}
              </span>
            )}
            <span className="text-[11px] font-mono font-semibold text-primary flex-shrink-0">
              {encoderConfig.format.toUpperCase()} · {encoderConfig.bitrate}K
            </span>
          </div>

          {/* VU Meters */}
          <div className="px-4 pb-4 flex flex-col gap-1.5">
            {(['L', 'R'] as const).map((ch) => {
              const db = ch === 'L' ? displayLevels.left : displayLevels.right
              return (
                <div key={ch} className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-muted-foreground/50 w-3 select-none">{ch}</span>
                  <div className="flex-1 h-[5px] rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full" style={{
                      width: `${pct(db)}%`,
                      background: 'linear-gradient(to right, #22c55e 0%, #86efac 55%, #facc15 70%, #f97316 85%, #ef4444 100%)',
                      transition: 'width 22ms linear',
                    }} />
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground/50 w-8 text-right select-none">
                    {db <= DB_MIN ? '−60' : db.toFixed(0)}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 border-t border-border">
            {([
              {
                icon:   'clock',
                label:  'UPTIME',
                value:  status?.uptime ? formatUptime(status.uptime) : '00:00:00',
                mono:   true,
                accent: isLive,
              },
              {
                icon:   'users',
                label:  'HÖRER',
                value:  isLive && status?.listeners != null ? String(status.listeners) : '—',
                mono:   false,
                accent: false,
              },
              {
                icon:   'activity',
                label:  'BITRATE',
                value:  status?.bitrate ? `${status.bitrate}K` : '—',
                mono:   false,
                accent: false,
              },
            ] as const).map(({ icon, label, value, mono, accent }, i) => (
              <div key={label} className={cn('flex flex-col items-center py-3 gap-1', i > 0 && 'border-l border-border')}>
                <StatIcon name={icon} accent={accent} />
                <span className={cn('text-sm font-bold', mono && 'font-mono', accent ? 'text-blue-600' : 'text-foreground')}>
                  {value}
                </span>
                <span className="text-[9px] font-bold tracking-widest text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>

          {/* Mini-Log */}
          <div className="px-4 py-2.5 border-t border-border/60 flex flex-col gap-1 h-[72px] overflow-hidden">
            {[...log].reverse().slice(0, 3).map((entry) => (
              <div key={entry.id} className="flex items-center gap-2 text-[10px] font-mono">
                <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0',
                  entry.type === 'ok'   ? 'bg-emerald-500' :
                  entry.type === 'warn' ? 'bg-amber-500'   : 'bg-muted-foreground/40'
                )} />
                <span className="text-muted-foreground/70">{fmtLogTime(entry.time)}</span>
                <span className={cn(
                  entry.type === 'ok'   ? 'text-emerald-700' :
                  entry.type === 'warn' ? 'text-amber-700'   : 'text-muted-foreground'
                )}>{entry.text}</span>
              </div>
            ))}
            {log.length === 0 && (
              <span className="text-[10px] text-muted-foreground/40 font-mono">—</span>
            )}
          </div>
        </>
      ) : (
        /* ── Einstellungen ── */
        <Tabs defaultValue="server" className="flex flex-col">
          <TabsList>
            <TabsTrigger value="server">Server</TabsTrigger>
            <TabsTrigger value="audio">Audio</TabsTrigger>
            <TabsTrigger value="encoder">Encoder</TabsTrigger>
          </TabsList>
          <TabsContent value="server">
            <ServerTab entry={entry} disabled={!!status?.running}
              onChange={onChange} onLabelChange={onLabelChange} />
          </TabsContent>
          <TabsContent value="audio">
            <AudioTab selectedDevice={selectedDevice} encoderConfig={encoderConfig}
              disabled={anyRunning} onDeviceChange={onDeviceChange} onEncoderChange={onEncoderChange} />
          </TabsContent>
          <TabsContent value="encoder">
            <EncoderTab encoderConfig={encoderConfig} disabled={anyRunning} onEncoderChange={onEncoderChange} />
          </TabsContent>
        </Tabs>
      )}
      </div>

      {/* ── Footer ── */}
      <Separator />
      <div className="p-3 flex items-center gap-2">
        {!status?.running ? (
          <Button variant="secondary" className="flex-1" onClick={onStart} disabled={isLoading}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
            {isLoading ? 'Verbinde…' : 'Verbinden'}
          </Button>
        ) : isConnecting ? (
          <Button variant="secondary" className="flex-1 opacity-70 cursor-not-allowed" disabled>
            <RefreshCw size={11} className="animate-spin" />
            Verbindet…
          </Button>
        ) : (
          <Button variant="outline" className="flex-1 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
            onClick={onStop} disabled={isLoading}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
            Trennen
          </Button>
        )}
      </div>
    </div>
  )
}
