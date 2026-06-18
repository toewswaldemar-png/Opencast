import { useEffect, useRef } from 'react'
import { LevelUpdate } from '../types'

interface Props {
  levels: LevelUpdate
}

const DB_MIN = -60
const DB_MAX = 0

function dbToColor(db: number): string {
  if (db >= -3) return '#ef4444'   // red: clip warning
  if (db >= -9) return '#f97316'   // orange: hot
  if (db >= -18) return '#22c55e'  // green: optimal
  return '#3b82f6'                  // blue: low
}

interface BarProps {
  label: string
  db: number
  peak: number
}

function MeterBar({ label, db, peak }: BarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    // Background segments
    const segments = 30
    const segH = (h - segments) / segments
    const gap = 1

    for (let i = 0; i < segments; i++) {
      const segDb = DB_MIN + ((segments - 1 - i) / (segments - 1)) * (DB_MAX - DB_MIN)
      const y = i * (segH + gap)
      const active = db >= segDb
      const color = active ? dbToColor(segDb) : '#1e293b'
      ctx.fillStyle = color
      ctx.fillRect(0, y, w, segH)
    }

    // Peak hold line
    if (peak > DB_MIN) {
      const peakY = ((DB_MAX - peak) / (DB_MAX - DB_MIN)) * h
      ctx.fillStyle = dbToColor(peak)
      ctx.fillRect(0, peakY, w, 2)
    }
  }, [db, peak])

  return (
    <div className="flex flex-col items-center gap-1">
      <canvas
        ref={canvasRef}
        width={18}
        height={200}
        className="rounded-sm"
        style={{ imageRendering: 'pixelated' }}
      />
      <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">{label}</span>
    </div>
  )
}

export default function VUMeter({ levels }: Props) {
  const peakLRef = useRef(-120)
  const peakRRef = useRef(-120)
  const peakLHoldRef = useRef(0)
  const peakRHoldRef = useRef(0)

  const now = Date.now()

  if (levels.left > peakLRef.current) {
    peakLRef.current = levels.left
    peakLHoldRef.current = now
  } else if (now - peakLHoldRef.current > 2000) {
    peakLRef.current = Math.max(peakLRef.current - 0.5, levels.left)
  }

  if (levels.right > peakRRef.current) {
    peakRRef.current = levels.right
    peakRHoldRef.current = now
  } else if (now - peakRHoldRef.current > 2000) {
    peakRRef.current = Math.max(peakRRef.current - 0.5, levels.right)
  }

  const fmtDB = (v: number) =>
    v <= -60 ? '-∞' : `${v.toFixed(1)} dB`

  return (
    <div className="bg-slate-900 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Pegel</span>
        <span className="text-xs font-mono text-slate-500">dBFS</span>
      </div>

      <div className="flex justify-center gap-6">
        <MeterBar label="L" db={levels.left} peak={peakLRef.current} />
        <MeterBar label="R" db={levels.right} peak={peakRRef.current} />
      </div>

      {/* Scale */}
      <div className="flex justify-between px-1">
        {[-60, -40, -20, -12, -6, -3, 0].map((db) => (
          <span key={db} className="text-[9px] font-mono text-slate-600">
            {db === 0 ? '0' : db}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="bg-slate-800 rounded-lg p-2">
          <div className="text-[10px] text-slate-500 mb-0.5">L</div>
          <div className={`font-mono text-sm font-medium ${levels.left >= -3 ? 'text-red-400' : 'text-slate-300'}`}>
            {fmtDB(levels.left)}
          </div>
        </div>
        <div className="bg-slate-800 rounded-lg p-2">
          <div className="text-[10px] text-slate-500 mb-0.5">R</div>
          <div className={`font-mono text-sm font-medium ${levels.right >= -3 ? 'text-red-400' : 'text-slate-300'}`}>
            {fmtDB(levels.right)}
          </div>
        </div>
      </div>
    </div>
  )
}
