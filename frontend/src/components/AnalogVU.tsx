import { useRef } from 'react'

const DB_MIN = -40
const DB_MAX = 0
const CX = 50, CY = 65, R = 48

function mapAngle(db: number): number {
  return Math.PI * (1 - Math.max(0, Math.min(1, (db - DB_MIN) / (DB_MAX - DB_MIN))))
}

function pt(angle: number, radius: number): [number, number] {
  return [CX + radius * Math.cos(angle), CY - radius * Math.sin(angle)]
}

function arc(fromAngle: number, toAngle: number, r: number): string {
  const [x1, y1] = pt(fromAngle, r)
  const [x2, y2] = pt(toAngle, r)
  const large = (fromAngle - toAngle) > Math.PI ? 1 : 0
  return `M ${x1.toFixed(2)},${y1.toFixed(2)} A ${r},${r} 0 ${large},0 ${x2.toFixed(2)},${y2.toFixed(2)}`
}

const TICKS = [-40, -30, -20, -10, -5, -3, 0]

export default function AnalogVU({ db, label }: { db: number; label: string }) {
  const peakRef = useRef(-120)
  const holdRef = useRef(0)
  const now = Date.now()

  if (db > peakRef.current) { peakRef.current = db; holdRef.current = now }
  else if (now - holdRef.current > 2000) peakRef.current = Math.max(peakRef.current - 0.8, db)

  const peak = peakRef.current
  const clamped = Math.max(DB_MIN, Math.min(DB_MAX, peak))
  const needleAngle = mapAngle(clamped)
  const [nx, ny] = pt(needleAngle, R - 9)
  const color = peak >= -6 ? '#ef4444' : peak >= -18 ? '#f59e0b' : '#22c55e'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg viewBox="0 0 100 70" style={{ width: 112, height: 79 }}>
        {/* Track */}
        <path d={arc(Math.PI, 0, R)} fill="none" stroke="#e2e8f0" strokeWidth="9" strokeLinecap="round" />

        {/* Zone colors */}
        <path d={arc(mapAngle(-40), mapAngle(-18), R)} fill="none" stroke="#bbf7d0" strokeWidth="5" />
        <path d={arc(mapAngle(-18), mapAngle(-6), R)} fill="none" stroke="#fde68a" strokeWidth="5" />
        <path d={arc(mapAngle(-6), mapAngle(0), R)} fill="none" stroke="#fecaca" strokeWidth="5" />

        {/* Active fill */}
        {peak > DB_MIN && (
          <path d={arc(mapAngle(DB_MIN), needleAngle, R)} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
        )}

        {/* Tick marks */}
        {TICKS.map(d => {
          const a = mapAngle(d)
          const [ix, iy] = pt(a, R - 11)
          const [ox, oy] = pt(a, R + 1)
          return <line key={d} x1={ox.toFixed(2)} y1={oy.toFixed(2)} x2={ix.toFixed(2)} y2={iy.toFixed(2)} stroke="#cbd5e1" strokeWidth="1.5" />
        })}

        {/* Needle */}
        <line x1={CX} y1={CY} x2={nx.toFixed(2)} y2={ny.toFixed(2)} stroke="#334155" strokeWidth="1.5" strokeLinecap="round" />

        {/* Hub */}
        <circle cx={CX} cy={CY} r={4.5} fill="#f1f5f9" stroke="#e2e8f0" strokeWidth="1" />
        <circle cx={CX} cy={CY} r={2} fill="#475569" />
      </svg>

      <div style={{ marginTop: -10, textAlign: 'center' }}>
        <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'monospace' }}>
          {label}
        </div>
        <div style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, marginTop: 2, color: db <= -120 ? '#cbd5e1' : color }}>
          {db <= -120 ? '−∞' : `${peak.toFixed(1)} dB`}
        </div>
      </div>
    </div>
  )
}
