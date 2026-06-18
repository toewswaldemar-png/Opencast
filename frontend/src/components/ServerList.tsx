import { CSSProperties } from 'react'
import { Play, Square, Trash2, Plus } from 'lucide-react'
import { ServerEntry, StreamStatus } from '../types'

interface Props {
  servers: ServerEntry[]
  selectedId: string
  runningId: string | null
  status: StreamStatus
  loading: boolean
  onSelect: (id: string) => void
  onStart: (id: string) => void
  onStop: () => void
  onAdd: () => void
  onRemove: (id: string) => void
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function ServerList({
  servers, selectedId, runningId, status, loading,
  onSelect, onStart, onStop, onAdd, onRemove,
}: Props) {
  return (
    <div className="flex flex-col gap-1">
      {servers.map((server) => {
        const isRunning = server.id === runningId && status.running
        const isSelected = server.id === selectedId
        const isConnected = isRunning && status.connected
        const isReconnecting = isRunning && status.reconnecting
        const dotColor = isConnected ? '#e11d48' : isReconnecting ? '#f97316' : isRunning ? '#fb923c' : '#cbd5e1'

        let rowStyle: CSSProperties = { border: '1px solid transparent' }
        if (isSelected && isConnected)  rowStyle = { border: '1px solid #fca5a5', background: '#fff9f9' }
        else if (isSelected && isRunning) rowStyle = { border: '1px solid #fed7aa', background: '#fff7ed' }
        else if (isSelected)             rowStyle = { border: '1px solid #c7d2fe', background: '#f5f3ff' }

        return (
          <div
            key={server.id}
            onClick={() => onSelect(server.id)}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all hover:bg-slate-50"
            style={rowStyle}
          >
            <div
              className="w-1.5 h-1.5 rounded-full shrink-0 transition-colors"
              style={{ background: dotColor }}
            />

            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-slate-700 truncate leading-tight">{server.label}</div>
              <div className="text-[10px] font-mono text-slate-400 truncate leading-tight">
                {server.config.host}:{server.config.port}{server.config.mountPoint}
              </div>
            </div>

            {isRunning && (
              <span className="text-[10px] font-mono text-green-600 shrink-0 tabular-nums">
                {formatUptime(status.uptime / 1e9)}
              </span>
            )}

            <button
              onClick={(e) => { e.stopPropagation(); isRunning ? onStop() : onStart(server.id) }}
              disabled={loading || (status.running && !isRunning)}
              title={isRunning ? 'Stream stoppen' : 'Stream starten'}
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded transition-all disabled:opacity-30"
              style={isRunning
                ? { background: '#fee2e2', color: '#b91c1c' }
                : { background: '#f0fdf4', color: '#166534' }
              }
            >
              {isRunning
                ? <Square size={9} fill="currentColor" />
                : <Play size={9} fill="currentColor" />
              }
            </button>

            {servers.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(server.id) }}
                disabled={isRunning}
                title="Server entfernen"
                className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors disabled:opacity-30"
              >
                <Trash2 size={9} />
              </button>
            )}
          </div>
        )
      })}

      <button
        onClick={onAdd}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 transition-all text-xs mt-0.5"
        style={{ border: '1px dashed #e2e8f0' }}
      >
        <Plus size={11} />
        <span>Server hinzufügen</span>
      </button>
    </div>
  )
}
