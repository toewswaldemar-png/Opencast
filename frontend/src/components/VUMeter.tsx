import { useRef } from 'react'
import { LevelUpdate } from '../types'

const DB_MIN = -60
const DB_MAX = 0
const GRADIENT = 'linear-gradient(to right, #22c55e 0%, #86efac 50%, #facc15 70%, #f97316 85%, #ef4444 100%)'

function dbToPct(db: number) {
  return Math.max(0, Math.min(100, ((db - DB_MIN) / (DB_MAX - DB_MIN)) * 100))
}

function MeterRow({ label, db, peak }: { label: string; db: number; peak: number }) {
  const pct = dbToPct(db)
  const peakPct = dbToPct(peak)
  const isHot = db >= -6
  const isClip = db >= -1

  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[10px] font-mono font-bold text-slate-400 w-3 shrink-0 select-none">{label}</span>
      <div className="relative flex-1 h-2.5 rounded-full overflow-hidden bg-slate-100">
        <div className="absolute inset-0 opacity-20 rounded-full" style={{ background: GRADIENT }} />
        <div
          className="absolute left-0 top-0 h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: GRADIENT,
            boxShadow: isClip ? '0 0 8px #ef4444aa' : isHot ? '0 0 6px #f9731666' : 'none',
            transition: 'width 30ms linear',
          }}
        />
        {peak > DB_MIN + 2 && (
          <div className="absolute top-0 bottom-0 w-px bg-slate-400/60"
            style={{ left: `${peakPct}%` }} />
        )}
      </div>
      <span className={`text-[10px] font-mono w-[46px] text-right shrink-0 tabular-nums ${
        isClip ? 'text-red-500' : isHot ? 'text-amber-500' : 'text-slate-400'
      }`}>
        {db <= DB_MIN ? '−∞' : db.toFixed(1)}
      </span>
    </div>
  )
}

export default function VUMeter({ levels, bare }: { levels: LevelUpdate; bare?: boolean }) {
  const peakL = useRef(-120); const peakR = useRef(-120)
  const holdL = useRef(0);   const holdR = useRef(0)
  const now = Date.now()

  if (levels.left > peakL.current) { peakL.current = levels.left; holdL.current = now }
  else if (now - holdL.current > 1500) peakL.current = Math.max(peakL.current - 1.5, levels.left)

  if (levels.right > peakR.current) { peakR.current = levels.right; holdR.current = now }
  else if (now - holdR.current > 1500) peakR.current = Math.max(peakR.current - 1.5, levels.right)

  const inner = (
    <>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest select-none">Pegel · dBFS</span>
        {!bare && (
          <div className="flex gap-2.5 text-[8px] font-mono text-slate-300 select-none">
            {[-54, -40, -24, -12, -6, -3, 0].map(db => <span key={db}>{db}</span>)}
          </div>
        )}
      </div>
      <MeterRow label="L" db={levels.left} peak={peakL.current} />
      <MeterRow label="R" db={levels.right} peak={peakR.current} />
    </>
  )

  if (bare) return <div className="flex flex-col gap-2">{inner}</div>
  return (
    <div className="rounded-xl px-4 py-3 flex flex-col gap-2 border border-slate-200 bg-white shadow-sm">
      {inner}
    </div>
  )
}
