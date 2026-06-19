import { useRef } from 'react'
import { LevelUpdate } from '../types'
import { cn } from '@/lib/utils'

const DB_MIN = -60
const DB_MAX = 0
const SCALE  = [-54, -42, -30, -18, -9, -6, -3, 0]
const GRADIENT = 'linear-gradient(to right, #22c55e 0%, #86efac 55%, #facc15 70%, #f97316 85%, #ef4444 100%)'

function pct(db: number): number {
  return Math.max(0, Math.min(100, ((db - DB_MIN) / (DB_MAX - DB_MIN)) * 100))
}

function MeterRow({ label, db, peak }: { label: string; db: number; peak: number }) {
  const lvl    = pct(db)
  const pk     = pct(peak)
  const isHot  = db >= -6
  const isClip = db >= -1

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono font-bold text-muted-foreground w-2.5 flex-shrink-0 select-none">
        {label}
      </span>
      <div className="flex-1 relative h-2.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${lvl}%`,
            background: GRADIENT,
            transition: 'width 22ms linear',
            boxShadow: isClip ? '0 0 10px rgba(239,68,68,0.5)' : isHot ? '0 0 6px rgba(249,115,22,0.4)' : 'none',
          }}
        />
        {peak > DB_MIN + 3 && (
          <div className="absolute top-0 bottom-0 w-0.5 bg-slate-400/50" style={{ left: `${pk}%` }} />
        )}
      </div>
      <span className={cn(
        'text-[10px] font-mono w-10 text-right flex-shrink-0',
        isClip ? 'text-red-500' : isHot ? 'text-amber-500' : 'text-muted-foreground'
      )}>
        {db <= DB_MIN ? '−∞' : db.toFixed(1)}
      </span>
    </div>
  )
}

export default function VUMeter({ levels }: { levels: LevelUpdate }) {
  const peakL = useRef(-120); const peakR = useRef(-120)
  const holdL = useRef(0);    const holdR = useRef(0)
  const now = Date.now()

  if (levels.left > peakL.current)       { peakL.current = levels.left;  holdL.current = now }
  else if (now - holdL.current > 1500)   peakL.current = Math.max(peakL.current - 1.5, levels.left)
  if (levels.right > peakR.current)      { peakR.current = levels.right; holdR.current = now }
  else if (now - holdR.current > 1500)   peakR.current = Math.max(peakR.current - 1.5, levels.right)

  return (
    <div className="flex flex-col gap-1.5">
      <MeterRow label="L" db={levels.left}  peak={peakL.current} />
      <MeterRow label="R" db={levels.right} peak={peakR.current} />
      <div className="relative h-3 ml-5 mr-12">
        {SCALE.map((db) => (
          <span
            key={db}
            className="absolute text-[8px] font-mono text-slate-300 select-none -translate-x-1/2"
            style={{ left: `${pct(db)}%` }}
          >
            {db}
          </span>
        ))}
      </div>
    </div>
  )
}
