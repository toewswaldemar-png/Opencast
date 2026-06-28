import { useState, useEffect, useRef } from 'react'
import { RefreshCw, Settings2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ServerEntry, ServerConfig, EncoderConfig, AudioDevice,
  SAMPLE_RATES, StreamFormat, EncoderMode, StereoMode,
} from '../types'
import { apiFetch } from '../lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    <div className="p-3 flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        {(['icecast2', 'shoutcast'] as const).map((p) => (
          <Button key={p} size="xs" variant={entry.config.protocol === p ? 'default' : 'outline'}
            disabled={disabled} onClick={() => onChange({ protocol: p })} className="flex-1 text-[10px]">
            {p === 'icecast2' ? 'Icecast 2' : 'SHOUTcast'}
          </Button>
        ))}
      </div>

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
  const selected      = devices.find((d) => d.id === selectedDevice)
  const activeDevices = devices.filter((d) => d.state === 'active')

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
    <div className="p-3 flex flex-col gap-2.5">
      <Field label="Audiogerät">
        <div className="flex gap-2">
          <Select value={selectedDevice} onValueChange={onDeviceChange}
            disabled={disabled || loading || activeDevices.length === 0}>
            <SelectTrigger className="flex-1 h-7 text-xs">
              <SelectValue placeholder={loading ? 'Lade Geräte…' : '— Kein Gerät —'} />
            </SelectTrigger>
            <SelectContent>
              {activeDevices.map((d) => (
                <SelectItem key={d.id} value={d.id} className="text-xs">
                  {d.name}
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

      <div className="grid grid-cols-2 gap-2">
        <Field label="Links">
          <Select value={String(encoderConfig.channelLeft)}
            onValueChange={(v) => onEncoderChange({ channelLeft: Number(v) })}
            disabled={disabled}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: Math.max(2, selected?.maxInputChannels ?? 2) }, (_, i) => i + 1).map((n) => (
                <SelectItem key={n} value={String(n)} className="text-xs font-mono">{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Rechts">
          <Select value={String(encoderConfig.channelRight)}
            onValueChange={(v) => onEncoderChange({ channelRight: Number(v) })}
            disabled={disabled}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: Math.max(2, selected?.maxInputChannels ?? 2) }, (_, i) => i + 1).map((n) => (
                <SelectItem key={n} value={String(n)} className="text-xs font-mono">{n}</SelectItem>
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
    <div className="p-3 flex flex-col gap-2.5">
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

// ── Main Export ───────────────────────────────────────────────────────────────

export interface CardSettingsPanelProps {
  entry:           ServerEntry
  encoderConfig:   EncoderConfig
  selectedDevice:  string
  disabled:        boolean
  onChange:        (p: Partial<ServerConfig>) => void
  onLabelChange:   (l: string) => void
  onDeviceChange:  (id: string) => void
  onEncoderChange: (p: Partial<EncoderConfig>) => void
}

function AccordionCard({ label, defaultOpen = true, children }: { label: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mx-3 my-2 rounded-lg border border-border bg-background overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-1.5 bg-muted/40 hover:bg-muted/60 transition-colors"
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5"
          className={cn('text-muted-foreground transition-transform duration-200', open ? 'rotate-180' : 'rotate-0')}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="border-t border-border">{children}</div>}
    </div>
  )
}

export default function CardSettingsPanel({
  entry, encoderConfig, selectedDevice, disabled,
  onChange, onLabelChange, onDeviceChange, onEncoderChange,
}: CardSettingsPanelProps) {
  return (
    <div className="flex-1 overflow-y-auto py-1">
      <AccordionCard label="Server">
        <ServerTab entry={entry} disabled={disabled} onChange={onChange} onLabelChange={onLabelChange} />
      </AccordionCard>
      <AccordionCard label="Audio">
        <AudioTab selectedDevice={selectedDevice} encoderConfig={encoderConfig}
          disabled={disabled} onDeviceChange={onDeviceChange} onEncoderChange={onEncoderChange} />
      </AccordionCard>
      <AccordionCard label="Encoder">
        <EncoderTab encoderConfig={encoderConfig} disabled={disabled} onEncoderChange={onEncoderChange} />
      </AccordionCard>
    </div>
  )
}
