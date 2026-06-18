import { Cpu } from 'lucide-react'
import { EncoderConfig, StreamFormat } from '../types'

interface Props {
  config: EncoderConfig
  disabled: boolean
  onChange: (cfg: Partial<EncoderConfig>) => void
}

const FORMATS: { id: StreamFormat; label: string; description: string }[] = [
  { id: 'mp3', label: 'MP3', description: 'libmp3lame · universell kompatibel' },
  { id: 'aac', label: 'AAC', description: 'native · kompakt & klar' },
  { id: 'ogg', label: 'OGG', description: 'libvorbis · Open-Source' },
]

const BITRATES_PER_FORMAT: Record<StreamFormat, number[]> = {
  mp3: [64, 96, 128, 192, 256, 320],
  aac: [64, 96, 128, 192, 256],
  ogg: [64, 96, 128, 192, 256],
}

export default function EncoderSettings({ config, disabled, onChange }: Props) {
  const bitrates = BITRATES_PER_FORMAT[config.format]

  const handleFormatChange = (fmt: StreamFormat) => {
    const rates = BITRATES_PER_FORMAT[fmt]
    const bitrate = rates.includes(config.bitrate) ? config.bitrate : rates[3] ?? rates[rates.length - 1]
    onChange({ format: fmt, bitrate })
  }

  return (
    <div className="bg-slate-800/60 rounded-xl p-5 flex flex-col gap-4 border border-slate-700/50">
      <div className="flex items-center gap-2">
        <Cpu size={16} className="text-blue-400" />
        <span className="text-sm font-semibold text-slate-200">Encoder</span>
        <span className="ml-auto text-[10px] font-mono text-slate-500 bg-slate-700/60 px-2 py-0.5 rounded">
          via FFmpeg
        </span>
      </div>

      {/* Format selector */}
      <div className="grid grid-cols-3 gap-1.5">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            onClick={() => handleFormatChange(f.id)}
            disabled={disabled}
            className={`group flex flex-col items-center gap-1 py-2.5 px-2 rounded-lg border transition-all disabled:opacity-50 ${
              config.format === f.id
                ? 'border-blue-500 bg-blue-600/20 text-blue-300'
                : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:border-slate-600 hover:text-slate-300'
            }`}
          >
            <span className="text-sm font-bold font-mono">{f.label}</span>
            <span className="text-[9px] text-center leading-tight opacity-70">{f.description.split(' · ')[0]}</span>
          </button>
        ))}
      </div>

      {config.format && (
        <p className="text-[10px] text-slate-500">
          {FORMATS.find((f) => f.id === config.format)?.description}
        </p>
      )}

      {/* Bitrate */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">Bitrate</label>
          <span className="font-mono text-sm font-semibold text-blue-400">{config.bitrate} kbps</span>
        </div>

        <div className="flex gap-1.5 flex-wrap">
          {bitrates.map((br) => (
            <button
              key={br}
              onClick={() => onChange({ bitrate: br })}
              disabled={disabled}
              className={`flex-1 min-w-[40px] py-1.5 rounded-lg text-xs font-mono font-medium transition-colors disabled:opacity-50 ${
                config.bitrate === br
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700/60 text-slate-400 hover:bg-slate-700 hover:text-slate-300'
              }`}
            >
              {br}
            </button>
          ))}
        </div>
      </div>

      {/* Quality estimate */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 bg-slate-900/60 rounded-lg px-3 py-2">
        <span>Datenstrom</span>
        <span className="font-mono text-slate-400">
          ≈ {(config.bitrate / 8).toFixed(1)} KB/s
          {' '}·{' '}
          {((config.bitrate / 8 / 1024) * 3600).toFixed(1)} GB/h
        </span>
      </div>
    </div>
  )
}
