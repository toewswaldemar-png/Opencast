import { AllStreamStatus } from '../types'
import { cn } from '@/lib/utils'

interface Props {
  allStatuses: AllStreamStatus
  wsConnected: boolean
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100)
  return (
    <div className="w-16 h-1 rounded-full bg-muted overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

export default function StatusBar({ allStatuses, wsConnected }: Props) {
  const liveCount    = Object.values(allStatuses).filter((s) => s.connected).length
  const totalBitrate = Object.values(allStatuses).reduce((sum, s) => sum + (s.bitrate ?? 0), 0)
  const allOk        = wsConnected && Object.values(allStatuses).every((s) => s.connected || !s.running)

  return (
    <div className="flex items-center gap-6 px-4 py-1.5 bg-card border-t border-border text-[10px] font-mono text-muted-foreground flex-shrink-0">

      <div className="flex items-center gap-2">
        <span>CPU</span>
        <MiniBar value={2} max={100} color="#1D9E75" />
        <span>2%</span>
      </div>

      <div className="flex items-center gap-2">
        <span>RAM</span>
        <MiniBar value={128} max={512} color="#185FA5" />
        <span>128 MB</span>
      </div>

      <div className="flex items-center gap-2">
        <span>Netzwerk</span>
        <MiniBar value={totalBitrate} max={2000} color="#534AB7" />
        <span>{totalBitrate > 0 ? `${(totalBitrate / 8).toFixed(0)} KB/s` : '—'}</span>
      </div>

      <div className="ml-auto flex items-center gap-4">
        {liveCount > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-red-600 font-bold tracking-widest">{liveCount}× LIVE</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className={cn('w-1.5 h-1.5 rounded-full', allOk ? 'bg-teal-500' : 'bg-amber-400')} />
          <span className={cn(allOk ? 'text-teal-600' : 'text-amber-600')}>
            {allOk ? 'Alle Systeme bereit' : wsConnected ? 'Stream-Fehler' : 'Verbindungsfehler'}
          </span>
        </div>
        <span>Opencast v1.0.0</span>
      </div>
    </div>
  )
}
