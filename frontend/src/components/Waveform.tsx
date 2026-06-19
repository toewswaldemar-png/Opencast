import { useRef, useEffect } from 'react'
import { LevelUpdate } from '../types'

const N = 160
const DB_FLOOR = -60

export default function Waveform({ levels }: { levels: LevelUpdate }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bufL = useRef(new Float32Array(N))
  const bufR = useRef(new Float32Array(N))
  const animRef = useRef(0)

  useEffect(() => {
    const l = Math.max(DB_FLOOR, levels.left)
    const r = Math.max(DB_FLOOR, levels.right)
    bufL.current.copyWithin(0, 1); bufL.current[N - 1] = l
    bufR.current.copyWithin(0, 1); bufR.current[N - 1] = r
  }, [levels])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.round(rect.width * devicePixelRatio)
      canvas.height = Math.round(rect.height * devicePixelRatio)
    })
    ro.observe(canvas)
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.round(rect.width * devicePixelRatio)
    canvas.height = Math.round(rect.height * devicePixelRatio)

    const draw = () => {
      const ctx = canvas.getContext('2d')
      if (!ctx || canvas.width === 0) { animRef.current = requestAnimationFrame(draw); return }
      const W = canvas.width, H = canvas.height, midY = H / 2, barW = W / N

      ctx.fillStyle = '#f8fafc'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#e2e8f0'
      ctx.fillRect(0, midY - devicePixelRatio, W, devicePixelRatio * 2)

      for (let i = 0; i < N; i++) {
        const dbL = bufL.current[i], dbR = bufR.current[i]
        const pctL = (dbL - DB_FLOOR) / -DB_FLOOR
        const pctR = (dbR - DB_FLOOR) / -DB_FLOOR
        const hL = pctL * (midY - 3), hR = pctR * (midY - 3)
        const alpha = 0.2 + (i / N) * 0.8
        const x = i * barW, bw = Math.max(1, barW - 1.2)

        const cL = dbL >= -6 ? `rgba(239,68,68,${alpha})` : dbL >= -18 ? `rgba(234,179,8,${alpha})` : `rgba(34,197,94,${alpha})`
        const cR = dbR >= -6 ? `rgba(239,68,68,${alpha})` : dbR >= -18 ? `rgba(234,179,8,${alpha})` : `rgba(34,197,94,${alpha})`
        ctx.fillStyle = cL; ctx.fillRect(x, midY - hL, bw, hL)
        ctx.fillStyle = cR; ctx.fillRect(x, midY, bw, hR)
      }
      animRef.current = requestAnimationFrame(draw)
    }
    animRef.current = requestAnimationFrame(draw)
    return () => { ro.disconnect(); cancelAnimationFrame(animRef.current) }
  }, [])

  return <canvas ref={canvasRef} style={{ width: '100%', height: 80, display: 'block', borderRadius: 8 }} />
}
