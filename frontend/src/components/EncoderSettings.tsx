import { Cpu } from 'lucide-react'
import { EncoderConfig, StreamFormat } from '../types'

interface Props { config: EncoderConfig; disabled: boolean; onChange: (cfg: Partial<EncoderConfig>) => void; bare?: boolean }

const FORMATS: { id: StreamFormat; label: string; sub: string }[] = [
  { id: 'mp3', label: 'MP3', sub: 'lame' },
  { id: 'aac', label: 'AAC', sub: 'native' },
  { id: 'ogg', label: 'OGG', sub: 'vorbis' },
]

const BITRATES_PER_FORMAT: Record<StreamFormat, number[]> = {
  mp3: [64, 96, 128, 192, 256, 320],
  aac: [64, 96, 128, 192, 256],
  ogg: [64, 96, 128, 192, 256],
}

export default function EncoderSettings({ config, disabled, onChange, bare }: Props) {
  const bitrates = BITRATES_PER_FORMAT[config.format]

  const handleFormatChange = (fmt: StreamFormat) => {
    const rates = BITRATES_PER_FORMAT[fmt]
    const bitrate = rates.includes(config.bitrate) ? config.bitrate : rates[3] ?? rates[rates.length - 1]
    onChange({ format: fmt, bitrate })
  }

  return (
    <div className={bare
      ? 'flex flex-col gap-2'
      : 'rounded-xl p-4 flex flex-col gap-3.5 border border-slate-200 bg-white shadow-sm'}>
      {bare ? (
        <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Encoder</span>
      ) : (
        <div className="flex items-center gap-2">
          <Cpu size={15} className="text-indigo-500" />
          <span className="text-sm font-semibold text-slate-700">Encoder</span>
          <span className="ml-auto text-[9px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-400 border border-slate-200">
            FFmpeg
          </span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-1.5">
        {FORMATS.map((f) => (
          <button key={f.id} onClick={() => handleFormatChange(f.id)} disabled={disabled}
            className="flex flex-col items-center gap-0.5 py-2.5 rounded-lg border transition-all disabled:opacity-50"
            style={config.format === f.id ? {
              borderColor: 'rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.07)', color: '#4f46e5',
            } : { borderColor: '#e2e8f0', background: '#f8fafc', color: '#94a3b8' }}>
            <span className="text-sm font-bold font-mono">{f.label}</span>
            <span className="text-[9px] opacity-70">{f.sub}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Bitrate</label>
          <span className="font-mono text-sm font-semibold text-indigo-600">{config.bitrate} kbps</span>
        </div>
        <div className="flex gap-1.5">
          {bitrates.map((br) => (
            <button key={br} onClick={() => onChange({ bitrate: br })} disabled={disabled}
              className="flex-1 py-1.5 rounded-lg text-xs font-mono font-medium transition-all disabled:opacity-50"
              style={config.bitrate === br ? {
                background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: '#fff',
                boxShadow: '0 2px 8px rgba(99,102,241,0.25)',
              } : { background: '#f1f5f9', color: '#64748b' }}>
              {br}
            </button>
          ))}
        </div>
      </div>

      {!bare && (
        <div className="flex items-center justify-between text-[10px] rounded-lg px-3 py-2 bg-slate-50 border border-slate-100 text-slate-400">
          <span>Datenstrom</span>
          <span className="font-mono text-slate-500">
            ≈ {(config.bitrate / 8).toFixed(1)} KB/s · {((config.bitrate / 8 / 1024) * 3600).toFixed(1)} GB/h
          </span>
        </div>
      )}
    </div>
  )
}
