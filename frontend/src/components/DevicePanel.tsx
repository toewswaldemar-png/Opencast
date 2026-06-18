import { useEffect, useRef, useState } from 'react'
import { Mic, RefreshCw, ChevronDown, AlertCircle, Settings2 } from 'lucide-react'
import { AudioDevice, DeviceState, EncoderConfig, SAMPLE_RATES } from '../types'
import { apiFetch } from '../lib/api'

interface Props {
  selectedDevice: string
  encoderConfig: EncoderConfig
  disabled: boolean
  onDeviceChange: (id: string) => void
  onEncoderChange: (cfg: Partial<EncoderConfig>) => void
  bare?: boolean
}

function stateBadge(state: DeviceState) {
  switch (state) {
    case 'active':
      return null
    case 'disabled':
      return <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-600 border border-yellow-200">deaktiviert</span>
    case 'unplugged':
      return <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 border border-orange-200">getrennt</span>
    case 'notpresent':
      return <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 border border-slate-200">nicht vorhanden</span>
  }
}

function apiBadge(api: string) {
  if (api === 'WASAPI') return { cls: 'bg-blue-50 text-blue-600 border border-blue-200', label: 'WASAPI' }
  if (api === 'ASIO')   return { cls: 'bg-violet-50 text-violet-600 border border-violet-200', label: 'ASIO ★' }
  return { cls: 'bg-slate-100 text-slate-500 border border-slate-200', label: api }
}

export default function DevicePanel({
  selectedDevice,
  encoderConfig,
  disabled,
  onDeviceChange,
  onEncoderChange,
  bare,
}: Props) {
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [panelOpening, setPanelOpening] = useState(false)

  // Always reflects the latest prop value — avoids stale closure in fetchDevices
  const selectedDeviceRef = useRef(selectedDevice)
  selectedDeviceRef.current = selectedDevice

  const openAsioPanel = async () => {
    if (!selected || selected.api !== 'ASIO') return
    setPanelOpening(true)
    try {
      await apiFetch('/api/asio/panel', {
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
      const res = await apiFetch('/api/devices')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const data: AudioDevice[] = await res.json()
      setDevices(data)
      // Auto-select first active device only when no device has been saved yet
      if (!selectedDeviceRef.current) {
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

  const selectCls = 'w-full rounded-lg px-3 py-2 text-sm text-slate-700 appearance-none pr-7 focus:outline-none transition-colors disabled:opacity-50 cursor-pointer border border-slate-200 bg-slate-50 focus:border-indigo-400'

  return (
    <div className={bare
      ? 'flex flex-col gap-2'
      : 'rounded-xl p-4 flex flex-col gap-3.5 border border-slate-200 bg-white shadow-sm'}>
      <div className="flex items-center justify-between">
        {bare ? (
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Audiogerät</span>
        ) : (
          <div className="flex items-center gap-2">
            <Mic size={15} className="text-indigo-500" />
            <span className="text-sm font-semibold text-slate-700">Audiogerät</span>
          </div>
        )}
        <button
          onClick={fetchDevices}
          disabled={loading || disabled}
          className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-40"
          title="Geräte neu laden"
        >
          <RefreshCw size={bare ? 10 : 12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-600 rounded-lg px-3 py-2 border border-red-200 bg-red-50">
          {error}
        </div>
      )}

      <div className="relative">
        <select
          value={selectedDevice}
          onChange={(e) => onDeviceChange(e.target.value)}
          disabled={disabled || loading || devices.length === 0}
          className={selectCls}
        >
          {devices.length === 0 && <option value="">— Keine Geräte gefunden —</option>}
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}{d.state !== 'active' ? ` (${stateLabel(d.state)})` : ''}
            </option>
          ))}
        </select>
        <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
      </div>

      {selected && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${apiBadge(selected.api).cls}`}>
            {apiBadge(selected.api).label}
          </span>
          <span className="text-[10px] text-slate-400">
            {selected.maxInputChannels}ch · {selected.defaultSampleRate / 1000}kHz
          </span>
          {stateBadge(selected.state)}
          {selected.api === 'ASIO' && (
            <button
              onClick={openAsioPanel}
              disabled={panelOpening || disabled}
              title="ASIO Einstellungen öffnen"
              className="ml-auto flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded transition-colors disabled:opacity-40 bg-violet-50 text-violet-600 border border-violet-200 hover:bg-violet-100"
            >
              <Settings2 size={10} className={panelOpening ? 'animate-spin' : ''} />
              {panelOpening ? 'Öffne…' : 'Einstellungen'}
            </button>
          )}
        </div>
      )}

      {isSelectedDisabled && (
        <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 border border-amber-200 bg-amber-50">
          <AlertCircle size={12} className="text-amber-500 mt-0.5 shrink-0" />
          <p className="text-[11px] text-amber-700 leading-relaxed">
            {selected!.state === 'disabled'
              ? 'Gerät in Windows deaktiviert → Systemsteuerung › Sound › Aufnahme.'
              : 'Gerät momentan nicht verbunden.'}
          </p>
        </div>
      )}

      <div className={`grid grid-cols-2 gap-2 ${bare ? '' : 'border-t border-slate-100 pt-3'}`}>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Samplerate</label>
          <div className="relative">
            <select
              value={encoderConfig.sampleRate}
              onChange={(e) => onEncoderChange({ sampleRate: Number(e.target.value) as typeof SAMPLE_RATES[number] })}
              disabled={disabled}
              className={selectCls}
                >
              {SAMPLE_RATES.map((r) => (
                <option key={r} value={r}>{(r / 1000).toFixed(r % 1000 === 0 ? 0 : 1)} kHz</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Kanäle</label>
          <div className="relative">
            <select
              value={encoderConfig.channels}
              onChange={(e) => onEncoderChange({ channels: Number(e.target.value) })}
              disabled={disabled}
              className={selectCls}
                >
              {channelOptions(selected?.maxInputChannels ?? 2).map((n) => (
                <option key={n} value={n}>{channelLabel(n)}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
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

function channelOptions(max: number): number[] {
  const count = Math.max(1, max)
  return Array.from({ length: count }, (_, i) => i + 1)
}

function channelLabel(n: number): string {
  if (n === 1) return 'Mono'
  if (n === 2) return 'Stereo'
  return `${n} Kanäle`
}
