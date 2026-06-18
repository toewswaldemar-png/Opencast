import { Radio, Square, AlertCircle, Loader2 } from 'lucide-react'
import { StreamStatus } from '../types'

interface Props {
  status: StreamStatus
  error: string | null
  loading: boolean
  onStart: () => void
  onStop: () => void
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const GRAD_IDLE  = 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 50%, #2563eb 100%)'
const GRAD_LIVE  = 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)'
const GRAD_RECON = 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)'

export default function StreamControls({ status, error, loading, onStart, onStop }: Props) {
  const isLive = status.running && status.connected
  const bg     = isLive ? GRAD_LIVE : status.reconnecting ? GRAD_RECON : GRAD_IDLE
  const shadow = isLive
    ? '0 4px 20px rgba(225,29,72,0.3), 0 1px 4px rgba(0,0,0,0.1)'
    : status.reconnecting
    ? '0 4px 20px rgba(234,88,12,0.25), 0 1px 4px rgba(0,0,0,0.1)'
    : '0 4px 20px rgba(124,58,237,0.2), 0 1px 4px rgba(0,0,0,0.1)'

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={status.running ? onStop : onStart}
        disabled={loading}
        className="relative w-full py-5 rounded-2xl font-bold text-base tracking-wide flex items-center justify-center gap-3 text-white transition-transform duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
        style={{ background: bg, boxShadow: shadow }}
      >
        <div className="absolute inset-0 rounded-2xl"
          style={{ background: 'linear-gradient(180deg,rgba(255,255,255,0.12) 0%,transparent 60%)' }} />
        <span className="relative flex items-center gap-2.5">
          {loading ? (
            <><Loader2 size={20} className="animate-spin" /><span>Verbinde…</span></>
          ) : status.reconnecting ? (
            <><Loader2 size={20} className="animate-spin" /><span>Verbindet neu…</span></>
          ) : status.running ? (
            <><Square size={17} fill="currentColor" /><span>Stream stoppen</span></>
          ) : (
            <><Radio size={20} /><span>Stream starten</span></>
          )}
        </span>
        {isLive && (
          <span className="absolute right-5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            <span className="text-xs font-semibold tracking-widest">LIVE</span>
          </span>
        )}
      </button>

      {error && (
        <div className="flex items-start gap-2 rounded-xl px-4 py-3 border border-red-200 bg-red-50">
          <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
          <p className="text-xs text-red-600 leading-relaxed">{error}</p>
        </div>
      )}

      {status.running && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Uptime',   value: formatUptime(status.uptime / 1e9), color: isLive ? '#16a34a' : '#ea580c' },
            { label: 'Gesendet', value: formatBytes(status.bytesSent),     color: '#475569' },
            { label: 'Bitrate',  value: `${status.bitrate} kbps`,          color: '#4f46e5' },
          ].map(stat => (
            <div key={stat.label} className="rounded-xl px-3 py-2.5 text-center border border-slate-200 bg-white shadow-sm">
              <div className="font-mono text-sm font-semibold" style={{ color: stat.color }}>{stat.value}</div>
              <div className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wide">{stat.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
