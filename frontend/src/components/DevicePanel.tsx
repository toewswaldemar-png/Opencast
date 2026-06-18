import { useEffect, useState } from 'react'
import { Mic, RefreshCw, ChevronDown, AlertCircle, Settings2 } from 'lucide-react'
import { AudioDevice, DeviceState, EncoderConfig, SAMPLE_RATES } from '../types'

interface Props {
  selectedDevice: string
  encoderConfig: EncoderConfig
  disabled: boolean
  onDeviceChange: (id: string) => void
  onEncoderChange: (cfg: Partial<EncoderConfig>) => void
}

function stateBadge(state: DeviceState) {
  switch (state) {
    case 'active':
      return null
    case 'disabled':
      return <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">deaktiviert</span>
    case 'unplugged':
      return <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400">getrennt</span>
    case 'notpresent':
      return <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-600/40 text-slate-500">nicht vorhanden</span>
  }
}

function apiBadge(api: string) {
  if (api === 'WASAPI') return { cls: 'bg-blue-500/20 text-blue-400', label: 'WASAPI' }
  if (api === 'ASIO')   return { cls: 'bg-purple-500/20 text-purple-400', label: 'ASIO ★' }
  return { cls: 'bg-slate-600/40 text-slate-400', label: api }
}

export default function DevicePanel({
  selectedDevice,
  encoderConfig,
  disabled,
  onDeviceChange,
  onEncoderChange,
}: Props) {
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [panelOpening, setPanelOpening] = useState(false)

  const openAsioPanel = async () => {
    if (!selected || selected.api !== 'ASIO') return
    setPanelOpening(true)
    try {
      await fetch('/api/asio/panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: selected.id }),
      })
    } finally {
      setPanelOpening(false)
    }
  }

  const fetchDevices = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/devices')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const data: AudioDevice[] = await res.json()
      setDevices(data)
      // Auto-select first active device, falling back to first overall
      if (!selectedDevice) {
        const first = data.find((d) => d.state === 'active') ?? data[0]
        if (first) onDeviceChange(first.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchDevices() }, [])

  const selected = devices.find((d) => d.id === selectedDevice)
  const isSelectedDisabled = selected && selected.state !== 'active'

  return (
    <div className="bg-slate-800/60 rounded-xl p-5 flex flex-col gap-4 border border-slate-700/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mic size={16} className="text-blue-400" />
          <span className="text-sm font-semibold text-slate-200">Audiogerät</span>
        </div>
        <button
          onClick={fetchDevices}
          disabled={loading || disabled}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-40"
          title="Geräte neu laden"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Device select */}
      <div className="relative">
        <select
          value={selectedDevice}
          onChange={(e) => onDeviceChange(e.target.value)}
          disabled={disabled || loading || devices.length === 0}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 appearance-none pr-8 focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {devices.length === 0 && (
            <option value="">— Keine Geräte gefunden —</option>
          )}
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}{d.state !== 'active' ? ` (${stateLabel(d.state)})` : ''}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
      </div>

      {/* Device info badges */}
      {selected && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${apiBadge(selected.api).cls}`}>
            {apiBadge(selected.api).label}
          </span>
          <span className="text-[10px] text-slate-500">
            {selected.maxInputChannels}ch · {selected.defaultSampleRate / 1000}kHz
          </span>
          {stateBadge(selected.state)}
          {selected.api === 'ASIO' && (
            <button
              onClick={openAsioPanel}
              disabled={panelOpening || disabled}
              title="ASIO Einstellungen öffnen"
              className="ml-auto flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition-colors disabled:opacity-40"
            >
              <Settings2 size={10} className={panelOpening ? 'animate-spin' : ''} />
              {panelOpening ? 'Öffne…' : 'Einstellungen'}
            </button>
          )}
        </div>
      )}

      {/* Warning when a non-active device is selected */}
      {isSelectedDisabled && (
        <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/25 rounded-lg px-3 py-2.5">
          <AlertCircle size={13} className="text-yellow-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-yellow-300 leading-relaxed">
            {selected!.state === 'disabled'
              ? 'Dieses Gerät ist in Windows deaktiviert. Aktiviere es unter Systemsteuerung → Sound → Aufnahme.'
              : 'Dieses Gerät ist momentan nicht verbunden.'}
          </p>
        </div>
      )}

      <div className="border-t border-slate-700/50 pt-4 grid grid-cols-2 gap-3">
        {/* Sample Rate */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">
            Samplerate
          </label>
          <div className="relative">
            <select
              value={encoderConfig.sampleRate}
              onChange={(e) => onEncoderChange({ sampleRate: Number(e.target.value) as typeof SAMPLE_RATES[number] })}
              disabled={disabled}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 appearance-none pr-7 focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
            >
              {SAMPLE_RATES.map((r) => (
                <option key={r} value={r}>{(r / 1000).toFixed(r % 1000 === 0 ? 0 : 1)} kHz</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          </div>
        </div>

        {/* Channels */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">
            Kanäle
          </label>
          <div className="relative">
            <select
              value={encoderConfig.channels}
              onChange={(e) => onEncoderChange({ channels: Number(e.target.value) as 1 | 2 })}
              disabled={disabled}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 appearance-none pr-7 focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
            >
              <option value={1}>Mono</option>
              <option value={2}>Stereo</option>
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          </div>
        </div>
      </div>
    </div>
  )
}

function stateLabel(state: DeviceState): string {
  switch (state) {
    case 'disabled': return 'deaktiviert'
    case 'unplugged': return 'getrennt'
    case 'notpresent': return 'nicht vorhanden'
    default: return ''
  }
}
