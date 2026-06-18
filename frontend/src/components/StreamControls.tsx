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

export default function StreamControls({ status, error, loading, onStart, onStop }: Props) {
  const isLive = status.running && status.connected

  return (
    <div className="flex flex-col gap-4">
      {/* Main button */}
      <button
        onClick={status.running ? onStop : onStart}
        disabled={loading}
        className={`relative w-full py-4 rounded-xl font-bold text-base tracking-wide transition-all duration-200 flex items-center justify-center gap-3 ${
          isLive
            ? 'bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-900/40'
            : status.running
            ? 'bg-orange-600 hover:bg-orange-700 text-white shadow-lg shadow-orange-900/30'
            : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-900/40'
        } disabled:opacity-60 disabled:cursor-not-allowed`}
      >
        {loading ? (
          <>
            <Loader2 size={20} className="animate-spin" />
            <span>Verbinde...</span>
          </>
        ) : status.running ? (
          <>
            <Square size={18} fill="currentColor" />
            <span>Stream stoppen</span>
            {isLive && (
              <span className="absolute right-4 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                <span className="text-sm font-normal">LIVE</span>
              </span>
            )}
          </>
        ) : (
          <>
            <Radio size={20} />
            <span>Stream starten</span>
          </>
        )}
      </button>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <AlertCircle size={15} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-300 leading-relaxed">{error}</p>
        </div>
      )}

      {/* Stats */}
      {status.running && (
        <div className="grid grid-cols-3 gap-2">
          {[
            {
              label: 'Uptime',
              value: formatUptime(status.uptime / 1e9),
              color: isLive ? 'text-green-400' : 'text-orange-400',
            },
            {
              label: 'Gesendet',
              value: formatBytes(status.bytesSent),
              color: 'text-slate-300',
            },
            {
              label: 'Bitrate',
              value: `${status.bitrate} kbps`,
              color: 'text-blue-400',
            },
          ].map((stat) => (
            <div key={stat.label} className="bg-slate-800/60 rounded-lg p-3 text-center">
              <div className={`font-mono text-sm font-semibold ${stat.color}`}>{stat.value}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
