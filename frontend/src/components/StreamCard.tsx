import { useState, useEffect, useRef } from 'react'
import { Mic, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ServerEntry, StreamStatus, EncoderConfig } from '../types'
import { apiFetch } from '../lib/api'
import { Button }    from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

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

interface LogLine {
  id:   number
  time: Date
  text: string
  type: 'ok' | 'warn' | 'info' | 'error'
}

function humanizeError(raw: string): string {
  if (raw.includes('read/write on closed pipe')) return 'Verbindung unerwartet getrennt'
  if (raw.includes('HTTP 409'))        return 'Icecast: Mount bereits belegt'
  if (raw.includes('HTTP 404'))        return 'Stream nicht registriert'
  if (raw.includes('HTTP 401'))        return 'Icecast: Falsches Passwort'
  if (raw.includes('HTTP 403'))        return 'Icecast: Zugriff verweigert'
  if (raw.includes('connection refused')) return 'Server nicht erreichbar'
  if (raw.includes('dial tcp'))        return 'Server nicht erreichbar'
  if (raw.includes('no such host'))    return 'Host nicht gefunden'
  if (raw.includes('i/o timeout') || raw.includes('timeout')) return 'Verbindungs-Timeout'
  if (raw.includes('EOF'))             return 'Verbindung unterbrochen'
  return raw
}
function fmtLogTime(d: Date): string {
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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
    <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground flex-shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60" />Offline
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
    let rafId: number
    const loop = (ts: number) => {
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
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, []) // eslint-disable-line

  return (
    <div className="px-4 pb-4 flex flex-col gap-1.5">
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

export default function StreamCard({
  entry, status, vuTargetRef, vuDecayMsRef, encoderConfig,
  isLoading, error, isSelected, onStart, onStop, onSelect,
}: Props) {
  const [log, setLog]               = useState<LogLine[]>([])
  const [nowPlaying, setNowPlaying] = useState('')
  const logIdRef                    = useRef(0)
  const prevStatusRef               = useRef<StreamStatus | null>(null)
  const metaTimerRef                = useRef<number | null>(null)

  useEffect(() => {
    if (error) {
      console.error(`[stream/${entry.id}]`, error)
      setLog((l) => [...l.slice(-9), { id: logIdRef.current++, time: new Date(), text: humanizeError(error), type: 'error' }])
    }
  }, [error]) // eslint-disable-line

  useEffect(() => {
    const prev = prevStatusRef.current
    const curr = status
    const add = (text: string, type: LogLine['type']) =>
      setLog((l) => [...l.slice(-9), { id: logIdRef.current++, time: new Date(), text, type }])

    if      (curr?.connected  && !prev?.connected)                add('Verbunden', 'ok')
    else if (!curr?.connected && prev?.connected && curr?.running) add('Verbindung unterbrochen', 'warn')
    else if (curr?.reconnecting && !prev?.reconnecting)            add('Verbindungsversuch…', 'info')
    else if (prev?.running && !curr?.running)                      add('Getrennt', 'info')

    prevStatusRef.current = curr
  }, [status]) // eslint-disable-line

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
        'flex flex-col rounded-xl border-2 bg-card overflow-hidden transition-all duration-200 cursor-pointer isolate',
        isLive           ? 'border-emerald-400 shadow-lg shadow-emerald-500/15'
        : isReconnecting ? 'border-amber-400'
        : isConnecting   ? 'border-blue-400'
        :                  'border-indigo-200',
        isSelected     ? 'ring-2 ring-blue-400/50 z-10' : 'z-0',
      )}
      onClick={onSelect}
    >

      {/* ── Header ── */}
      <div className={cn(
        'flex items-center gap-3 px-4 pt-4 pb-3 border-b',
        isLive           ? 'bg-emerald-50 border-b-emerald-200/80'
        : isReconnecting ? 'bg-amber-50 border-b-amber-200/80'
        : isConnecting   ? 'bg-blue-50 border-b-blue-200/80'
        :                  'bg-indigo-50/60 border-b-indigo-100',
      )}>
        <div className={cn(
          'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0',
          isLive           ? 'bg-emerald-500/10 text-emerald-600'
          : isReconnecting ? 'bg-amber-500/10 text-amber-600'
          : isConnecting   ? 'bg-blue-500/10 text-blue-500'
          :                  'bg-indigo-100 text-indigo-500',
        )}>
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
      <div className="min-h-[224px]">
        {/* Now Playing / Metadata */}
        <div className="flex items-center gap-2 px-4 py-3">
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
        <div className="grid grid-cols-3 border-t border-border">
          {([
            {
              icon:   'clock',
              label:  'UPTIME',
              value:  status?.uptime ? formatUptime(status.uptime) : '00:00:00',
              mono:   true,
              accent: isLive,
              bg:     isLive ? 'bg-blue-50' : 'bg-blue-50/40',
            },
            {
              icon:   'users',
              label:  'HÖRER',
              value:  isLive && status?.listeners != null ? String(status.listeners) : '—',
              mono:   false,
              accent: false,
              bg:     isLive ? 'bg-emerald-50' : 'bg-emerald-50/40',
            },
            {
              icon:   'activity',
              label:  'BITRATE',
              value:  status?.bitrate ? `${status.bitrate}K` : '—',
              mono:   false,
              accent: false,
              bg:     isLive ? 'bg-violet-50' : 'bg-violet-50/40',
            },
          ]).map(({ icon, label, value, mono, accent, bg }, i) => (
            <div key={label} className={cn(
              'flex flex-col items-center py-3 gap-1 transition-colors',
              i > 0 && 'border-l border-border',
              bg,
            )}>
              <StatIcon name={icon} accent={accent} />
              <span className={cn('text-sm font-bold', mono && 'font-mono', accent ? 'text-blue-600' : 'text-foreground')}>
                {value}
              </span>
              <span className="text-[9px] font-bold tracking-widest text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>

        {/* Mini-Log */}
        <div className="px-4 py-2.5 border-t border-border/60 flex flex-col gap-1 h-[72px] overflow-hidden">
          {[...log].reverse().slice(0, 3).map((entry) => (
            <div key={entry.id} className="flex items-center gap-2 text-[10px] font-mono">
              <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0',
                entry.type === 'ok'    ? 'bg-emerald-500' :
                entry.type === 'warn'  ? 'bg-amber-500'   :
                entry.type === 'error' ? 'bg-red-500'     : 'bg-muted-foreground/40'
              )} />
              <span className="text-muted-foreground">{fmtLogTime(entry.time)}</span>
              <span className={cn(
                entry.type === 'ok'    ? 'text-emerald-700' :
                entry.type === 'warn'  ? 'text-amber-700'   :
                entry.type === 'error' ? 'text-red-600'     : 'text-muted-foreground'
              )}>{entry.text}</span>
            </div>
          ))}
          {log.length === 0 && (
            <span className="text-[10px] text-muted-foreground/60 font-mono">—</span>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <Separator />
      <div className="p-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
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
