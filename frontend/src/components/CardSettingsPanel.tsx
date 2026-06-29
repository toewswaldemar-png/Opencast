import { useState } from 'react'
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

// ── Password Input ────────────────────────────────────────────────────────────

function PasswordInput({ value, onChange, disabled }: {
  value:    string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  disabled: boolean
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder="Quellpasswort"
        className="h-7 text-xs pr-7"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow(v => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
      >
        {show ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        )}
      </button>
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
      <p className="text-xs font-semibold text-foreground text-center truncate">{entry.label}</p>
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
          <PasswordInput value={entry.config.password}
            onChange={(e) => onChange({ password: e.target.value })}
            disabled={disabled} />
        </Field>
      </div>
    </div>
  )
}

// ── Tab: Audio ────────────────────────────────────────────────────────────────

function AudioTab({
  selectedDevice, encoderConfig, disabled, onDeviceChange, onEncoderChange,
  devices, devicesLoading, devicesError, onRefreshDevices,
}: {
  selectedDevice:   string
  encoderConfig:    EncoderConfig
  disabled:         boolean
  onDeviceChange:   (id: string) => void
  onEncoderChange:  (p: Partial<EncoderConfig>) => void
  devices:          AudioDevice[]
  devicesLoading:   boolean
  devicesError:     string | null
  onRefreshDevices: () => void
}) {
  const [panelOpening, setPanelOpening] = useState(false)
  const selected      = devices.find((d) => d.id === selectedDevice)
  const activeDevices = devices.filter((d) => d.state === 'active')

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
        <div className="flex gap-1.5 items-center">
          <Select value={selectedDevice} onValueChange={onDeviceChange}
            disabled={disabled || devicesLoading || activeDevices.length === 0}>
            <SelectTrigger className="min-w-0 flex-1 h-7 text-xs">
              <SelectValue placeholder={devicesLoading ? 'Lade Geräte…' : '— Kein Gerät —'} />
            </SelectTrigger>
            <SelectContent>
              {activeDevices.map((d) => (
                <SelectItem key={d.id} value={d.id} className="text-xs">
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="h-7 w-7 flex-none"
            onClick={onRefreshDevices} disabled={devicesLoading || disabled} title="Geräte neu laden">
            <RefreshCw size={11} className={devicesLoading ? 'animate-spin' : ''} />
          </Button>
        </div>
        {devicesError && (
          <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 mt-1">
            <AlertCircle size={12} className="flex-shrink-0" />{devicesError}
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
  entry:            ServerEntry
  encoderConfig:    EncoderConfig
  selectedDevice:   string
  disabled:         boolean
  devices:          AudioDevice[]
  devicesLoading:   boolean
  devicesError:     string | null
  onRefreshDevices: () => void
  onChange:         (p: Partial<ServerConfig>) => void
  onLabelChange:    (l: string) => void
  onDeviceChange:   (id: string) => void
  onEncoderChange:  (p: Partial<EncoderConfig>) => void
  onRemove?:        () => void
  canRemove?:       boolean
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-3 my-2 rounded-lg bg-background overflow-hidden">
      {children}
    </div>
  )
}

function DeleteButton({ onRemove, canRemove }: { onRemove: () => void; canRemove: boolean }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="mx-3 my-2 rounded-lg bg-slate-100/80">
      {!confirm ? (
        <button
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-destructive hover:bg-destructive/10 disabled:hover:bg-transparent"
          onClick={() => setConfirm(true)}
          disabled={!canRemove}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
          Stream löschen
        </button>
      ) : (
        <div className="w-full flex items-center justify-center gap-4 px-3 py-1.5">
          <button
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setConfirm(false)}
          >Abbrechen</button>
          <button
            className="text-xs font-medium text-destructive hover:underline transition-colors"
            onClick={() => { onRemove(); setConfirm(false) }}
          >Löschen</button>
        </div>
      )}
    </div>
  )
}

export default function CardSettingsPanel({
  entry, encoderConfig, selectedDevice, disabled,
  devices, devicesLoading, devicesError, onRefreshDevices,
  onChange, onLabelChange, onDeviceChange, onEncoderChange,
  onRemove, canRemove,
}: CardSettingsPanelProps) {
  return (
    <div className="flex-1 overflow-y-auto py-1">
      <SectionCard>
        <ServerTab entry={entry} disabled={disabled} onChange={onChange} onLabelChange={onLabelChange} />
      </SectionCard>
      <SectionCard>
        <AudioTab selectedDevice={selectedDevice} encoderConfig={encoderConfig}
          disabled={disabled} onDeviceChange={onDeviceChange} onEncoderChange={onEncoderChange}
          devices={devices} devicesLoading={devicesLoading} devicesError={devicesError}
          onRefreshDevices={onRefreshDevices} />
      </SectionCard>
      <SectionCard>
        <EncoderTab encoderConfig={encoderConfig} disabled={disabled} onEncoderChange={onEncoderChange} />
      </SectionCard>
      {onRemove && !disabled && (
        <DeleteButton onRemove={onRemove} canRemove={canRemove ?? true} />
      )}
    </div>
  )
}
