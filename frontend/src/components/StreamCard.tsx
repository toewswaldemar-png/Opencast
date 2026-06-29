import { useState, useEffect, useRef, memo } from 'react'
import { Mic, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ServerEntry, StreamStatus, EncoderConfig } from '../types'
import { apiFetch } from '../lib/api'
import { subscribeRAF } from '../lib/rafScheduler'
import { Button }    from '@/components/ui/button'

// ── Helpers ───────────────────────────────────────────────────────────────────

const DB_MIN = -60
const DB_MAX = 0
function pct(db: number) {
  return Math.max(0, Math.min(100, ((db - DB_MIN) / (DB_MAX - DB_MIN)) * 100))
}
function formatUptime(ns: number): string {
  const s   = Math.floor(ns / 1e9)
  const h   = Math.floor(s / 3600)
  const m   = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000)     return `${Math.round(bytes / 1_000)} KB`
  return `${bytes} B`
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ isLive, isReconnecting, isConnecting }: { isLive: boolean; isReconnecting: boolean; isConnecting: boolean }) {
  if (isLive) return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 flex-shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Live
    </span>
  )
  if (isReconnecting) return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 flex-shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />Reconnect
    </span>
  )
  if (isConnecting) return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-500 flex-shrink-0">
      <RefreshCw size={10} className="animate-spin" />Verbindet…
    </span>
  )
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-medium text-red-500 flex-shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />Offline
    </span>
  )
}

function StatIcon({ name, accent }: { name: string; accent: boolean }) {
  const cls = cn('flex-shrink-0', accent ? 'text-blue-600' : 'text-muted-foreground')
  if (name === 'clock') return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cls}>
      <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
    </svg>
  )
  if (name === 'users') return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cls}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cls}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  )
}

// ── VU Meter ──────────────────────────────────────────────────────────────────

interface VUMeterProps {
  vuTargetRef:  React.MutableRefObject<{ left: number; right: number }>
  vuDecayMsRef: React.MutableRefObject<number>
}

function VUMeter({ vuTargetRef, vuDecayMsRef }: VUMeterProps) {
  const barLRef    = useRef<HTMLDivElement>(null)
  const barRRef    = useRef<HTMLDivElement>(null)
  const labelLRef  = useRef<HTMLSpanElement>(null)
  const labelRRef  = useRef<HTMLSpanElement>(null)
  const displayRef = useRef({ left: -120, right: -120 })
  const prevTsRef  = useRef(0)

  useEffect(() => {
    return subscribeRAF((ts) => {
      const dt   = prevTsRef.current ? ts - prevTsRef.current : 16
      prevTsRef.current = ts
      const tgt  = vuTargetRef.current
      const cur  = displayRef.current
      const fall = (60 / Math.max(100, vuDecayMsRef.current)) * dt
      const newL = tgt.left  >= cur.left  ? tgt.left  : Math.max(tgt.left,  cur.left  - fall)
      const newR = tgt.right >= cur.right ? tgt.right : Math.max(tgt.right, cur.right - fall)
      if (Math.abs(newL - cur.left) > 0.05 || Math.abs(newR - cur.right) > 0.05) {
        displayRef.current = { left: newL, right: newR }
        if (barLRef.current)   barLRef.current.style.width   = `${pct(newL)}%`
        if (barRRef.current)   barRRef.current.style.width   = `${pct(newR)}%`
        if (labelLRef.current) labelLRef.current.textContent = newL <= DB_MIN ? '−60' : newL.toFixed(0)
        if (labelRRef.current) labelRRef.current.textContent = newR <= DB_MIN ? '−60' : newR.toFixed(0)
      }
    })
  }, []) // eslint-disable-line

  return (
    <div className="px-3 pb-2 flex flex-col gap-1">
      {(['L', 'R'] as const).map((ch) => (
        <div key={ch} className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-muted-foreground/80 w-3 select-none">{ch}</span>
          <div className="flex-1 h-[5px] rounded-full bg-muted overflow-hidden">
            <div
              ref={ch === 'L' ? barLRef : barRRef}
              className="h-full rounded-full"
              style={{
                width: '0%',
                background: 'linear-gradient(to right, #22c55e 0%, #86efac 55%, #facc15 70%, #f97316 85%, #ef4444 100%)',
                transition: 'width 16ms linear',
              }}
            />
          </div>
          <span
            ref={ch === 'L' ? labelLRef : labelRRef}
            className="text-[10px] font-mono text-muted-foreground w-8 text-right select-none"
          >
            −60
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  entry:        ServerEntry
  status:       StreamStatus | null
  vuTargetRef:  React.MutableRefObject<{ left: number; right: number }>
  vuDecayMsRef: React.MutableRefObject<number>
  encoderConfig: EncoderConfig
  isLoading:    boolean
  error?:       string | null
  isSelected:   boolean
  onStart:      () => void
  onStop:       () => void
  onSelect:     () => void
}

// ── Main Card ─────────────────────────────────────────────────────────────────

function StreamCard({
  entry, status, vuTargetRef, vuDecayMsRef, encoderConfig,
  isLoading, error, isSelected, onStart, onStop, onSelect,
}: Props) {
  const [nowPlaying, setNowPlaying] = useState('')
  const metaTimerRef                = useRef<number | null>(null)

  useEffect(() => () => { if (metaTimerRef.current) clearTimeout(metaTimerRef.current) }, [])

  const handleNowPlayingChange = (val: string) => {
    setNowPlaying(val)
    if (metaTimerRef.current) clearTimeout(metaTimerRef.current)
    if (!isLive) return
    metaTimerRef.current = setTimeout(() => {
      apiFetch('/api/stream/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamId: entry.id, title: val }),
      }).catch(() => {})
    }, 800) as unknown as number
  }

  const prevLiveRef = useRef(false)
  useEffect(() => {
    const wasLive = prevLiveRef.current
    const live    = !!(status?.running && status?.connected)
    if (live && !wasLive && nowPlaying) {
      apiFetch('/api/stream/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamId: entry.id, title: nowPlaying }),
      }).catch(() => {})
    }
    prevLiveRef.current = live
  }, [status?.running, status?.connected]) // eslint-disable-line

  const isLive         = !!(status?.running && status?.connected)
  const isReconnecting = !!(status?.running && !status?.connected && status?.reconnecting)
  const isConnecting   = !!(status?.running && !status?.connected && !status?.reconnecting)

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl overflow-hidden transition-all duration-200 cursor-pointer isolate',
        isSelected ? 'z-10' : 'z-0',
      )}
      style={{
        background: '#ffffff',
        border: 'none',
        boxShadow: isSelected && (isLive || isConnecting)
          ? '0 0 0 3px rgba(52,211,153,0.7), 0 4px 12px rgba(0,0,0,0.10)'
          : isSelected
          ? '0 0 0 3px rgba(37,99,235,0.7), 0 4px 12px rgba(0,0,0,0.10)'
          : (isLive || isConnecting)
          ? '0 2px 8px rgba(52,211,153,0.2), 0 1px 3px rgba(0,0,0,0.06)'
          : '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
      }}
      onClick={onSelect}
    >

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-3 pt-3 pb-2" style={{borderBottom: '1px solid rgba(0,0,0,0.06)'}}>
        <div className={cn(
          'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0',
          isLive           ? 'text-emerald-600'
          : isReconnecting ? 'text-amber-500'
          : isConnecting   ? 'text-blue-500'
          :                  'text-slate-400',
        )} style={{background: 'rgba(255,255,255,0.5)'}}>
          <Mic size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate leading-tight">{entry.label}</p>
          <p className="text-[11px] text-muted-foreground font-mono truncate leading-tight mt-0.5">
            {entry.config.host}:{entry.config.port}{entry.config.mountPoint}
          </p>
        </div>
        <StatusBadge isLive={isLive} isReconnecting={isReconnecting} isConnecting={isConnecting} />
      </div>

      {/* ── Body: always status view ── */}
      <div className="flex-1 flex flex-col">
        {/* Now Playing / Metadata */}
        <div className="flex items-center gap-2 px-3 py-2">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-muted-foreground/50 flex-shrink-0">
            <circle cx="12" cy="12" r="2"/>
            <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>
          </svg>
          {isLive ? (
            <input
              className="flex-1 text-[11px] font-mono bg-transparent border-b border-border/50
                         focus:border-blue-400 outline-none text-foreground placeholder:text-muted-foreground/50
                         transition-colors"
              placeholder="Titel · Interpret"
              value={nowPlaying}
              onChange={(e) => handleNowPlayingChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="flex-1 text-[11px] text-muted-foreground truncate">
              {nowPlaying || 'Kein Titel · Unbekannt'}
            </span>
          )}
          <span className="text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-700 flex-shrink-0">
            {encoderConfig.format.toUpperCase()} · {encoderConfig.bitrate}K
          </span>
        </div>

        {/* VU Meters */}
        <VUMeter vuTargetRef={vuTargetRef} vuDecayMsRef={vuDecayMsRef} />

        {/* Stats */}
        <div className="grid grid-cols-3 flex-1" style={{borderTop: '1px solid rgba(0,0,0,0.06)'}}>
          {([
            {
              icon:   'clock',
              label:  'UPTIME',
              value:  status?.uptime ? formatUptime(status.uptime) : '00:00:00',
              mono:   true,
              accent: isLive,
            },
            {
              icon:   'users',
              label:  'HÖRER',
              value:  isLive && status?.listeners != null ? String(status.listeners) : '—',
              mono:   false,
              accent: false,
            },
            {
              icon:   'activity',
              label:  'GESENDET',
              value:  isLive && status?.bytesSent ? formatBytes(status.bytesSent) : '—',
              mono:   true,
              accent: false,
            },
          ]).map(({ icon, label, value, mono, accent }, i) => (
            <div key={label} className={cn(
              'flex flex-col items-center py-2 gap-0.5 transition-colors',
            )} style={i > 0 ? {borderLeft: '1px solid rgba(0,0,0,0.06)'} : {}}>
              <StatIcon name={icon} accent={accent} />
              <span className={cn('text-sm font-bold', mono && 'font-mono', accent ? 'text-blue-600' : 'text-foreground')}>
                {value}
              </span>
              <span className="text-[9px] font-bold tracking-widest text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>

      </div>

      {/* ── Footer ── */}
      <div className="p-2 flex items-center gap-2" style={{borderTop: '1px solid rgba(0,0,0,0.06)'}} onClick={(e) => e.stopPropagation()}>
        {!status?.running ? (
          <Button variant="default" className="flex-1" onClick={onStart} disabled={isLoading}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
            {isLoading ? 'Verbinde…' : error ? 'Erneut verbinden' : 'Verbinden'}
          </Button>
        ) : isConnecting ? (
          <Button variant="secondary" className="flex-1 opacity-70 cursor-not-allowed" disabled>
            <RefreshCw size={11} className="animate-spin" />
            Verbindet…
          </Button>
        ) : (
          <Button variant="outline" className="flex-1 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
            onClick={onStop} disabled={isLoading}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
            Trennen
          </Button>
        )}
      </div>
    </div>
  )
}

export default memo(StreamCard, (prev, next) =>
  prev.entry        === next.entry        &&
  prev.status       === next.status       &&
  prev.isLoading    === next.isLoading    &&
  prev.error        === next.error        &&
  prev.isSelected   === next.isSelected   &&
  prev.encoderConfig === next.encoderConfig
)
