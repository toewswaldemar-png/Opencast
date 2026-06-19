import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Settings2, AlertCircle } from 'lucide-react'
import { AudioDevice, DeviceState, EncoderConfig, SAMPLE_RATES } from '../types'
import { apiFetch } from '../lib/api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label }  from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge }  from '@/components/ui/badge'

interface Props {
  selectedDevice: string
  encoderConfig: EncoderConfig
  disabled: boolean
  onDeviceChange: (id: string) => void
  onEncoderChange: (cfg: Partial<EncoderConfig>) => void
}

function stateLabel(state: DeviceState): string {
  switch (state) {
    case 'disabled':   return 'deaktiviert'
    case 'unplugged':  return 'getrennt'
    case 'notpresent': return 'nicht vorhanden'
    default:           return ''
  }
}

export default function DevicePanel({ selectedDevice, encoderConfig, disabled, onDeviceChange, onEncoderChange }: Props) {
  const [devices, setDevices]           = useState<AudioDevice[]>([])
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [panelOpening, setPanelOpening] = useState(false)
  const selectedDeviceRef               = useRef(selectedDevice)
  selectedDeviceRef.current             = selectedDevice

  const selected = devices.find((d) => d.id === selectedDevice)

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
      setError(err instanceof Error ? err.message : 'Fehler')
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchDevices() }, []) // eslint-disable-line

  return (
    <div className="flex flex-col gap-5">

      {/* Device selector */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Audiogerät</Label>
          <Button variant="ghost" size="icon" onClick={fetchDevices} disabled={loading || disabled}
            className="h-6 w-6 text-muted-foreground hover:text-foreground">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle size={12} className="flex-shrink-0" />{error}
          </div>
        )}

        <Select value={selectedDevice} onValueChange={onDeviceChange} disabled={disabled || loading || devices.length === 0}>
          <SelectTrigger>
            <SelectValue placeholder="— Keine Geräte —" />
          </SelectTrigger>
          <SelectContent>
            {devices.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}{d.state !== 'active' ? ` (${stateLabel(d.state)})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selected && (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={selected.api === 'ASIO' ? 'purple' : 'blue'}>
              {selected.api === 'ASIO' ? 'ASIO ★' : selected.api}
            </Badge>
            <span className="text-[10px] text-muted-foreground font-mono">
              {selected.maxInputChannels}ch · {selected.defaultSampleRate / 1000}kHz
            </span>
            {selected.api === 'ASIO' && (
              <Button variant="outline" size="sm" onClick={openAsioPanel} disabled={panelOpening || disabled}
                className="ml-auto h-6 text-[10px] font-mono gap-1 text-violet-600 border-violet-200 hover:bg-violet-50">
                <Settings2 size={9} className={panelOpening ? 'animate-spin' : ''} />
                {panelOpening ? 'Öffne…' : 'Einstellungen'}
              </Button>
            )}
          </div>
        )}

        {selected && selected.state !== 'active' && (
          <div className="flex gap-2 items-start bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertCircle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 leading-relaxed">
              {selected.state === 'disabled'
                ? 'Gerät in Windows deaktiviert → Systemsteuerung › Sound › Aufnahme.'
                : 'Gerät momentan nicht verbunden.'}
            </p>
          </div>
        )}
      </div>

      {/* Samplerate & Channels */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label>Samplerate</Label>
          <Select
            value={String(encoderConfig.sampleRate)}
            onValueChange={(v) => onEncoderChange({ sampleRate: Number(v) as typeof SAMPLE_RATES[number] })}
            disabled={disabled}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SAMPLE_RATES.map((r) => (
                <SelectItem key={r} value={String(r)}>
                  {(r / 1000).toFixed(r % 1000 === 0 ? 0 : 1)} kHz
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Kanäle</Label>
          <Select
            value={String(encoderConfig.channels)}
            onValueChange={(v) => onEncoderChange({ channels: Number(v) })}
            disabled={disabled}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: Math.max(1, selected?.maxInputChannels ?? 2) }, (_, i) => i + 1).map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n === 1 ? 'Mono' : n === 2 ? 'Stereo' : `${n} Kanäle`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

    </div>
  )
}
