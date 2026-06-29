import { useEffect, useRef, useState } from 'react'
import { subscribeRAF } from '../lib/rafScheduler'
import { Mic, MicOff, Plus, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  AllStreamStatus, LevelUpdate, GlobalLogEntry,
} from '../types'

// ── VU helpers ────────────────────────────────────────────────────────────────

const DB_MIN = -60, DB_MAX = 0
function vuPct(db: number) {
  return Math.max(0, Math.min(100, ((db - DB_MIN) / (DB_MAX - DB_MIN)) * 100))
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── Sidebar VU Meter ──────────────────────────────────────────────────────────

function SidebarVUMeter({ vuTargetRef, vuDecayMsRef }: {
  vuTargetRef:  React.MutableRefObject<LevelUpdate>
  vuDecayMsRef: React.MutableRefObject<number>
}) {
  const barLRef    = useRef<HTMLDivElement>(null)
  const barRRef    = useRef<HTMLDivElement>(null)
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
        if (barLRef.current) barLRef.current.style.width = `${vuPct(newL)}%`
        if (barRRef.current) barRRef.current.style.width = `${vuPct(newR)}%`
      }
    })
  }, []) // eslint-disable-line

  return (
    <div className="flex flex-col gap-1.5 py-1">
      {(['L', 'R'] as const).map((ch) => (
        <div key={ch} className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-muted-foreground/40 w-3">{ch}</span>
          <div className="flex-1 h-[4px] rounded-full bg-muted overflow-hidden">
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
        </div>
      ))}
    </div>
  )
}



// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  monitorEnabled:     boolean
  onToggleMonitor:    () => void
  onAdd:              () => void
  onStartAll:         () => void
  onStopAll:          () => void
  allStatuses:        AllStreamStatus
  globalLog:          GlobalLogEntry[]
  sidebarVuTargetRef: React.MutableRefObject<LevelUpdate>
  vuDecayMsRef:       React.MutableRefObject<number>
  showSettings:       boolean
  onToggleSettings:   () => void
}

// ── Log Header ────────────────────────────────────────────────────────────────

function LogHeader({ globalLog }: { globalLog: GlobalLogEntry[] }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    const text = [...globalLog].reverse()
      .map(e => `${fmtTime(e.time)} ${e.text}`)
      .join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="px-3 py-1.5 bg-slate-100/80 flex-shrink-0 flex items-center justify-between">
      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Log</span>
      <button
        type="button"
        onClick={handleCopy}
        disabled={globalLog.length === 0}
        className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
        title="Log kopieren"
      >
        {copied ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-500">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        )}
      </button>
    </div>
  )
}

// ── General Info View ─────────────────────────────────────────────────────────

function GeneralInfoView({
  monitorEnabled, onToggleMonitor, onAdd, onStartAll, onStopAll,
  allStatuses, globalLog,
  sidebarVuTargetRef, vuDecayMsRef,
  showSettings, onToggleSettings,
}: Pick<Props,
  'monitorEnabled' | 'onToggleMonitor' | 'onAdd' | 'onStartAll' | 'onStopAll' |
  'allStatuses' | 'globalLog' |
  'sidebarVuTargetRef' | 'vuDecayMsRef' |
  'showSettings' | 'onToggleSettings'
>) {

  const anyRunning    = Object.values(allStatuses).some((s) => s.running)

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">

      {/* Action buttons + All-streams toggle + VU — one visual block */}
      <div>
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <Button variant="default" size="sm" className="flex-1 h-7 text-xs gap-1.5" onClick={onAdd}>
            <Plus size={11} />
            Stream
          </Button>
          <Button
            variant="ghost" size="icon"
            className={cn('h-7 w-7 flex-shrink-0',
              monitorEnabled ? 'text-teal-600 hover:text-teal-700 bg-teal-500/10' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={onToggleMonitor}
            title={monitorEnabled ? 'Monitor aktiv' : 'Monitor aus'}
          >
            {monitorEnabled ? <Mic size={13} /> : <MicOff size={13} />}
          </Button>
        </div>

        <label className="mx-3 mb-2.5 flex items-center justify-between px-3 py-2 rounded-lg bg-background cursor-pointer hover:bg-muted/40 transition-colors">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-semibold text-foreground">Alle Streams</span>
            <span className="text-[10px] text-muted-foreground">
              {anyRunning ? 'Läuft — zum Stoppen ausschalten' : 'Gestoppt — zum Starten einschalten'}
            </span>
          </div>
          <Switch
            checked={anyRunning}
            onCheckedChange={(v) => v ? onStartAll() : onStopAll()}
          />
        </label>

      </div>

      <div className="mx-3 mb-2 rounded-lg bg-background px-3 py-2">
        <SidebarVUMeter vuTargetRef={sidebarVuTargetRef} vuDecayMsRef={vuDecayMsRef} />
      </div>

      {/* Globales Log */}
      <div className="mx-3 mb-2 rounded-lg bg-background overflow-hidden flex flex-col flex-1 min-h-0">
        <LogHeader globalLog={globalLog} />
        <div className="flex-1 overflow-y-auto px-3 py-2.5 flex flex-col gap-1">
          {globalLog.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">Kein Eintrag</span>
          ) : (
            [...globalLog].reverse().map((entry) => (
              <div key={entry.id} className="flex items-center gap-2 text-[10px] font-mono">
                <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0',
                  entry.type === 'ok'   ? 'bg-emerald-500' :
                  entry.type === 'warn' ? 'bg-amber-500'   : 'bg-muted-foreground/40')} />
                <span className="text-muted-foreground flex-shrink-0">{fmtTime(entry.time)}</span>
                <span className={cn('truncate',
                  entry.type === 'ok'   ? 'text-emerald-700' :
                  entry.type === 'warn' ? 'text-amber-700'   : 'text-muted-foreground'
                )}>{entry.text}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Einstellungen-Button */}
      <div className="mt-auto flex-shrink-0">
        <button
          type="button"
          onClick={onToggleSettings}
          className={cn(
            'mx-3 mb-2 w-[calc(100%-1.5rem)] flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-left',
            showSettings
              ? 'bg-violet-50 text-violet-700'
              : 'bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground',
          )}
        >
          <Settings size={12} className="flex-shrink-0" />
          <span className="text-[11px] font-semibold">Einstellungen</span>
        </button>
      </div>


    </div>
  )
}

// ── Main Export ───────────────────────────────────────────────────────────────

export default function InfoSidebar({
  monitorEnabled, onToggleMonitor, onAdd, onStartAll, onStopAll,
  allStatuses, globalLog,
  sidebarVuTargetRef, vuDecayMsRef,
  showSettings, onToggleSettings,
}: Props) {
  return (
    <aside className="w-[240px] flex-shrink-0 flex flex-col overflow-hidden" style={{background: 'rgba(255,255,255,0.75)', borderRight: '1px solid rgba(255,255,255,0.9)'}}>
      <GeneralInfoView
        monitorEnabled={monitorEnabled}
        onToggleMonitor={onToggleMonitor}
        onAdd={onAdd}
        onStartAll={onStartAll}
        onStopAll={onStopAll}
        allStatuses={allStatuses}
        globalLog={globalLog}
        sidebarVuTargetRef={sidebarVuTargetRef}
        vuDecayMsRef={vuDecayMsRef}
        showSettings={showSettings}
        onToggleSettings={onToggleSettings}
      />
    </aside>
  )
}
