import { Circle, Wifi, WifiOff } from 'lucide-react'
import { StreamStatus } from '../types'

interface Props {
  status: StreamStatus
  wsConnected: boolean
}

export default function StatusBar({ status, wsConnected }: Props) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/80 border-t border-slate-800 text-[11px] font-mono text-slate-500">
      <div className="flex items-center gap-4">
        {/* App WS connection */}
        <div className="flex items-center gap-1.5">
          {wsConnected ? (
            <Wifi size={11} className="text-green-500" />
          ) : (
            <WifiOff size={11} className="text-red-500 animate-pulse" />
          )}
          <span>{wsConnected ? 'Verbunden' : 'Getrennt'}</span>
        </div>

        {/* Stream state */}
        {status.running && (
          <div className="flex items-center gap-1.5">
            <Circle
              size={8}
              className={status.connected ? 'fill-red-500 text-red-500 animate-pulse' : 'fill-orange-500 text-orange-500'}
            />
            <span>{status.connected ? 'LIVE' : 'Verbinde...'}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 text-slate-600">
        <span>Opencast</span>
        <span>·</span>
        <span>localhost:8765</span>
      </div>
    </div>
  )
}
