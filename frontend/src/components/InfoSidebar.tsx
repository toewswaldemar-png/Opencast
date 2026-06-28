import { useState, useEffect, useRef } from 'react'
import { Mic, MicOff, Plus, Square, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AllStreamStatus, ServerEntry, ServerConfig, EncoderConfig, StreamStatus,
  LevelUpdate, GlobalLogEntry,
} from '../types'
import CardSettingsPanel from './CardSettingsPanel'

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
        if (barLRef.current) barLRef.current.style.width = `${vuPct(newL)}%`
        if (barRRef.current) barRRef.current.style.width = `${vuPct(newR)}%`
      }
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
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

// ── CardAccordion (card-style, collapsible) ───────────────────────────────────

function CardAccordion({ label, defaultOpen = true, children, accent = 'slate' }: {
  label: string; defaultOpen?: boolean; children: React.ReactNode; accent?: 'slate' | 'blue' | 'amber' | 'violet'
}) {
  const [open, setOpen] = useState(defaultOpen)
  const headerCls = {
    slate:  'bg-slate-100/80 hover:bg-slate-100',
    blue:   'bg-blue-50 hover:bg-blue-100/70',
    amber:  'bg-amber-50 hover:bg-amber-100/70',
    violet: 'bg-violet-50 hover:bg-violet-100/70',
  }[accent]
  const textCls = {
    slate:  'text-slate-500',
    blue:   'text-blue-600',
    amber:  'text-amber-600',
    violet: 'text-violet-600',
  }[accent]
  return (
    <div className="mx-3 my-2 rounded-lg border border-border bg-background overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={cn('w-full flex items-center justify-between px-3 py-1.5 transition-colors', headerCls)}
      >
        <span className={cn('text-[9px] font-bold uppercase tracking-wider', textCls)}>{label}</span>
        <svg
          width="11" height="11" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5"
          className={cn('text-muted-foreground transition-transform duration-200', open ? 'rotate-180' : 'rotate-0')}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="px-3 py-2.5 border-t border-border">{children}</div>}
    </div>
  )
}


// ── VU decay options ──────────────────────────────────────────────────────────

const VU_DECAY_OPTIONS = [
  { value: 200,  label: '200 ms' },
  { value: 500,  label: '500 ms' },
  { value: 1000, label: '1 s'    },
  { value: 2000, label: '2 s'    },
  { value: 3000, label: '3 s'    },
]

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  clientConnected:    boolean
  monitorEnabled:     boolean
  onToggleMonitor:    () => void
  onAdd:              () => void
  onStartAll:         () => void
  onStopAll:          () => void
  wsConnected:        boolean
  allStatuses:        AllStreamStatus
  servers:            ServerEntry[]
  onStop:             (id: string) => void
  globalLog:          GlobalLogEntry[]
  sidebarVuTargetRef: React.MutableRefObject<LevelUpdate>
  vuDecayMsRef:       React.MutableRefObject<number>
  selectedEntry:      ServerEntry | null
  selectedStatus:     StreamStatus | null
  onChange:           (p: Partial<ServerConfig>) => void
  onLabelChange:      (l: string) => void
  onDeviceChange:     (id: string) => void
  onEncoderChange:    (p: Partial<EncoderConfig>) => void
  onRemove:           (() => void) | undefined
  onDeselect:         () => void
  autoReconnect:      boolean
  vuDecayMs:          number
  onReconnectChange:  (v: boolean) => void
  onVuDecayChange:    (ms: number) => void
}

// ── General Info View ─────────────────────────────────────────────────────────

function GeneralInfoView({
  clientConnected, monitorEnabled, onToggleMonitor, onAdd, onStartAll, onStopAll,
  wsConnected, allStatuses, servers, onStop, globalLog,
  sidebarVuTargetRef, vuDecayMsRef,
  autoReconnect, vuDecayMs, onReconnectChange, onVuDecayChange,
}: Pick<Props,
  'clientConnected' | 'monitorEnabled' | 'onToggleMonitor' | 'onAdd' | 'onStartAll' | 'onStopAll' |
  'wsConnected' | 'allStatuses' | 'servers' | 'onStop' | 'globalLog' |
  'sidebarVuTargetRef' | 'vuDecayMsRef' |
  'autoReconnect' | 'vuDecayMs' | 'onReconnectChange' | 'onVuDecayChange'
>) {
  const totalBitrate  = Object.values(allStatuses).reduce((sum, s) => sum + (s.bitrate ?? 0), 0)
  const allOk         = wsConnected && Object.values(allStatuses).every((s) => s.connected || !s.running)
  const activeStreams  = Object.entries(allStatuses)
  const hasActive     = activeStreams.length > 0
  const anyRunning    = Object.values(allStatuses).some((s) => s.running)

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">

      {/* Action buttons */}
      <div className="flex items-center gap-2 p-3 border-b border-border">
        <Button variant="secondary" size="sm" className="flex-1 h-7 text-xs gap-1.5" onClick={onAdd}>
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

      {/* All-streams toggle */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-foreground">Alle Streams</span>
          <span className="text-[11px] text-muted-foreground">
            {anyRunning ? 'Läuft — zum Stoppen ausschalten' : 'Gestoppt — zum Starten einschalten'}
          </span>
        </div>
        <Switch
          checked={anyRunning}
          onCheckedChange={(v) => v ? onStartAll() : onStopAll()}
        />
      </div>

      {/* Sidebar VU */}
      <div className="px-3 pt-2 pb-1 border-b border-border">
        <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Pegel</p>
        <SidebarVUMeter vuTargetRef={sidebarVuTargetRef} vuDecayMsRef={vuDecayMsRef} />
      </div>

      {/* Aktive Streams */}
      <CardAccordion label="Aktive Streams" accent="blue">
        {hasActive ? (
          <div className="flex flex-col gap-1.5">
            {activeStreams.map(([id, st]) => {
              const label = servers.find(s => s.id === id)?.label ?? id.slice(0, 8)
              return (
                <div key={id} className="flex items-center gap-2">
                  <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0',
                    st.connected    ? 'bg-emerald-500 animate-pulse' :
                    st.reconnecting ? 'bg-amber-500 animate-pulse' : 'bg-blue-400')} />
                  <span className="text-[11px] text-foreground truncate flex-1">{label}</span>
                  <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">{st.bitrate}K</span>
                  <Button variant="ghost" size="icon"
                    className="h-5 w-5 flex-shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => onStop(id)} title="Stream stoppen">
                    <Square size={9} className="fill-current" />
                  </Button>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">Kein Stream aktiv</p>
        )}
      </CardAccordion>

      {/* Fallbacks */}
      <CardAccordion label="Fallbacks" defaultOpen={false} accent="amber">
        <p className="text-[11px] text-muted-foreground">In Entwicklung</p>
      </CardAccordion>

      {/* Einstellungen */}
      <CardAccordion label="Einstellungen" defaultOpen={false} accent="violet">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-foreground">Auto Reconnect</span>
            <Switch checked={autoReconnect} onCheckedChange={onReconnectChange} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-foreground">VU Decay</span>
            <Select value={String(vuDecayMs)} onValueChange={(v) => onVuDecayChange(Number(v))}>
              <SelectTrigger className="h-6 text-xs w-24 flex-shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VU_DECAY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardAccordion>

      {/* Globales Log */}
      {globalLog.length > 0 && (
        <CardAccordion label="Log" accent="slate">
          <div className="flex flex-col gap-1">
            {[...globalLog].reverse().slice(0, 8).map((entry) => (
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
            ))}
          </div>
        </CardAccordion>
      )}

      {/* Status + Version — pinned to bottom */}
      <div className="mt-auto border-t border-border flex-shrink-0">
        <div className="px-3 py-2.5 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0',
              wsConnected ? 'bg-teal-500' : 'bg-muted-foreground/40')} />
            <span className="text-[11px] text-muted-foreground">WebSocket</span>
            <span className={cn('ml-auto text-[10px] font-medium',
              wsConnected ? 'text-teal-600' : 'text-muted-foreground')}>
              {wsConnected ? 'Verbunden' : 'Getrennt'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0',
              clientConnected ? 'bg-teal-500' : 'bg-muted-foreground/40')} />
            <span className="text-[11px] text-muted-foreground">Client</span>
            <span className={cn('ml-auto text-[10px] font-medium',
              clientConnected ? 'text-teal-600' : 'text-muted-foreground')}>
              {clientConnected ? 'Online' : 'Offline'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', allOk ? 'bg-teal-500' : 'bg-amber-400')} />
            <span className={cn('text-[10px]', allOk ? 'text-teal-600' : 'text-amber-600')}>
              {allOk ? 'Alle Systeme bereit' : wsConnected ? 'Stream-Fehler' : 'Verbindungsfehler'}
            </span>
            <span className="ml-auto text-[10px] font-mono text-muted-foreground">
              {totalBitrate > 0 ? `${(totalBitrate / 8).toFixed(0)} KB/s` : ''}
            </span>
          </div>
        </div>
        <div className="px-3 py-1.5 border-t border-border">
          <span className="text-[10px] text-muted-foreground/50 font-mono">Opencast v1.0.0</span>
        </div>
      </div>

    </div>
  )
}

// ── Main Export ───────────────────────────────────────────────────────────────

export default function InfoSidebar({
  clientConnected, monitorEnabled, onToggleMonitor, onAdd, onStartAll, onStopAll,
  wsConnected, allStatuses, servers, onStop, globalLog,
  sidebarVuTargetRef, vuDecayMsRef,
  selectedEntry, selectedStatus,
  onChange, onLabelChange, onDeviceChange, onEncoderChange,
  onRemove, onDeselect,
  autoReconnect, vuDecayMs, onReconnectChange, onVuDecayChange,
}: Props) {
  return (
    <aside className="w-[300px] flex-shrink-0 flex flex-col border-r border-border bg-gradient-to-b from-white to-blue-50/50 overflow-hidden">
      {selectedEntry === null ? (
        <GeneralInfoView
          clientConnected={clientConnected}
          monitorEnabled={monitorEnabled}
          onToggleMonitor={onToggleMonitor}
          onAdd={onAdd}
          onStartAll={onStartAll}
          onStopAll={onStopAll}
          wsConnected={wsConnected}
          allStatuses={allStatuses}
          servers={servers}
          onStop={onStop}
          globalLog={globalLog}
          sidebarVuTargetRef={sidebarVuTargetRef}
          vuDecayMsRef={vuDecayMsRef}
          autoReconnect={autoReconnect}
          vuDecayMs={vuDecayMs}
          onReconnectChange={onReconnectChange}
          onVuDecayChange={onVuDecayChange}
        />
      ) : (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border flex-shrink-0">
            <p className="text-xs font-semibold text-foreground flex-1 truncate">{selectedEntry.label}</p>
            <Button variant="ghost" size="icon"
              className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-foreground"
              onClick={onDeselect} title="Schließen">
              <X size={12} />
            </Button>
          </div>
          <CardSettingsPanel
            key={selectedEntry.id}
            entry={selectedEntry}
            encoderConfig={selectedEntry.encoderConfig}
            selectedDevice={selectedEntry.deviceId}
            disabled={!!selectedStatus?.running}
            onChange={onChange}
            onLabelChange={onLabelChange}
            onDeviceChange={onDeviceChange}
            onEncoderChange={onEncoderChange}
          />
          {onRemove && (
            <div className="p-3 border-t border-border flex-shrink-0">
              <Button
                variant="outline"
                className="w-full gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/40"
                onClick={onRemove}
              >
                <Trash2 size={13} />
                Stream löschen
              </Button>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
