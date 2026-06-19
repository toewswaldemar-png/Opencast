import { EncoderConfig, StreamFormat } from '../types'
import { cn } from '@/lib/utils'

interface Props { config: EncoderConfig; disabled: boolean; onChange: (cfg: Partial<EncoderConfig>) => void }

const FORMATS: { id: StreamFormat; label: string; sub: string }[] = [
  { id: 'mp3', label: 'MP3', sub: 'lame'   },
  { id: 'aac', label: 'AAC', sub: 'native' },
  { id: 'ogg', label: 'OGG', sub: 'vorbis' },
]

const BITRATES: Record<StreamFormat, number[]> = {
  mp3: [64, 96, 128, 192, 256, 320],
  aac: [64, 96, 128, 192, 256],
  ogg: [64, 96, 128, 192, 256],
}

export default function EncoderSettings({ config, disabled, onChange }: Props) {
  const bitrates = BITRATES[config.format]

  const handleFormatChange = (fmt: StreamFormat) => {
    const rates   = BITRATES[fmt]
    const bitrate = rates.includes(config.bitrate) ? config.bitrate : rates[3] ?? rates[rates.length - 1]
    onChange({ format: fmt, bitrate })
  }

  return (
    <div className="flex flex-col gap-5">

      {/* Format */}
      <div className="flex flex-col gap-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Format</div>
        <div className="grid grid-cols-3 gap-2">
          {FORMATS.map((f) => {
            const active = config.format === f.id
            return (
              <button
                key={f.id}
                onClick={() => handleFormatChange(f.id)}
                disabled={disabled}
                className={cn(
                  'flex flex-col items-center gap-1 py-3 rounded-lg border transition-all',
                  active
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                <span className="text-sm font-bold font-mono">{f.label}</span>
                <span className="text-[9px] opacity-60">{f.sub}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Bitrate */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Bitrate</div>
          <span className="text-sm font-bold font-mono text-blue-600">{config.bitrate} kbps</span>
        </div>
        <div className="flex gap-1.5">
          {bitrates.map((br) => {
            const active = config.bitrate === br
            return (
              <button
                key={br}
                onClick={() => onChange({ bitrate: br })}
                disabled={disabled}
                className={cn(
                  'flex-1 py-1.5 rounded-md text-[11px] font-mono font-semibold border transition-all',
                  active
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-200'
                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {br}
              </button>
            )
          })}
        </div>
      </div>

      {/* Stream info */}
      <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-[10px] font-mono">
        <span className="text-muted-foreground">Datenstrom</span>
        <span className="text-slate-600">
          ≈ {(config.bitrate / 8).toFixed(1)} KB/s · {((config.bitrate / 8 * 3600) / 1024).toFixed(0)} MB/h
        </span>
      </div>

    </div>
  )
}
