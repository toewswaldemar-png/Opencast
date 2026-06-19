import { Play, Square, Trash2, Plus, Loader2 } from 'lucide-react'
import { ServerEntry, AllStreamStatus } from '../types'
import { cn } from '@/lib/utils'

interface Props {
  servers: ServerEntry[]
  selectedId: string
  allStatuses: AllStreamStatus
  loadingIds: Set<string>
  onSelect: (id: string) => void
  onStart: (id: string) => void
  onStop: (id: string) => void
  onAdd: () => void
  onRemove: (id: string) => void
}

function fmtUptime(ns: number): string {
  const s = Math.floor(ns / 1e9)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h > 0
    ? `${h}:${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`
    : `${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3)  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export default function ServerList({ servers, selectedId, allStatuses, loadingIds, onSelect, onStart, onStop, onAdd, onRemove }: Props) {
  return (
    <div className="flex flex-col gap-0.5">
      {servers.map((server) => {
        const st            = allStatuses[server.id]
        const isRunning     = !!st
        const isConnected   = isRunning && st.connected
        const isReconnecting = isRunning && st.reconnecting
        const isSelected    = server.id === selectedId
        const isLoading     = loadingIds.has(server.id)

        return (
          <div key={server.id}>
            <div
              onClick={() => onSelect(server.id)}
              className={cn(
                'flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all border',
                isSelected && isConnected   ? 'bg-green-500/10 border-green-500/20'
                : isSelected && isRunning   ? 'bg-orange-500/10 border-orange-500/20'
                : isSelected                ? 'bg-blue-500/10 border-blue-500/20'
                : 'border-transparent hover:bg-white/[0.04]'
              )}
            >
              <div className={cn(
                'w-1.5 h-1.5 rounded-full flex-shrink-0',
                isConnected     ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]'
                : isReconnecting ? 'bg-orange-500'
                : isRunning     ? 'bg-orange-400'
                : 'bg-slate-600'
              )} />

              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-slate-100 truncate leading-tight">{server.label}</div>
                <div className="text-[10px] font-mono text-slate-500 truncate leading-tight">
                  {server.config.host}:{server.config.port}{server.config.mountPoint}
                </div>
              </div>

              {isRunning && (
                <span className={cn('text-[10px] font-mono font-semibold flex-shrink-0', isConnected ? 'text-green-400' : 'text-orange-400')}>
                  {fmtUptime(st.uptime)}
                </span>
              )}

              <button
                onClick={(e) => { e.stopPropagation(); isRunning ? onStop(server.id) : onStart(server.id) }}
                disabled={isLoading}
                className={cn(
                  'flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md transition-all border',
                  isRunning
                    ? 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
                    : 'bg-green-500/10 border-green-500/20 text-green-400 hover:bg-green-500/20',
                  isLoading && 'opacity-50 cursor-not-allowed'
                )}
              >
                {isLoading
                  ? <Loader2 size={9} className="animate-spin" />
                  : isRunning ? <Square size={8} fill="currentColor" /> : <Play size={8} fill="currentColor" />}
              </button>

              {servers.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(server.id) }}
                  disabled={isRunning}
                  className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-slate-600 hover:text-red-400 transition-colors disabled:opacity-0 disabled:cursor-not-allowed"
                >
                  <Trash2 size={9} />
                </button>
              )}
            </div>

            {isRunning && (
              <div className={cn(
                'flex gap-4 py-1.5 px-2.5 ml-2 border-l mb-1',
                isConnected ? 'border-green-500/20' : 'border-orange-500/20'
              )}>
                {[
                  { label: 'Format', value: st.format.toUpperCase() },
                  { label: 'Status', value: isConnected ? 'Online' : isReconnecting ? 'Verbinde…' : 'Offline' },
                  { label: 'KB/s',   value: `${(st.bitrate / 8).toFixed(0)}` },
                  { label: 'Total',  value: fmtBytes(st.bytesSent) },
                ].map(({ label, value }) => (
                  <div key={label} className="flex flex-col">
                    <span className="text-[8px] font-bold uppercase tracking-wider text-slate-600">{label}</span>
                    <span className={cn(
                      'text-[10px] font-mono font-semibold',
                      label === 'Status'
                        ? isConnected ? 'text-green-400' : 'text-orange-400'
                        : 'text-slate-300'
                    )}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <button
        onClick={onAdd}
        className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs text-slate-600 border border-dashed border-slate-700 hover:border-blue-500/40 hover:text-blue-400 hover:bg-blue-500/5 transition-all w-full mt-1"
      >
        <Plus size={10} />
        <span>Server hinzufügen</span>
      </button>
    </div>
  )
}
