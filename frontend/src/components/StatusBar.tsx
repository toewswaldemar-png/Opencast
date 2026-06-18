import { Circle, Wifi, WifiOff } from 'lucide-react'
import { StreamStatus } from '../types'

interface Props { status: StreamStatus; wsConnected: boolean }

export default function StatusBar({ status, wsConnected }: Props) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-t text-[10px] font-mono bg-white/70"
      style={{ borderColor: 'rgba(0,0,0,0.07)', color: '#94a3b8' }}>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          {wsConnected
            ? <Wifi size={10} className="text-green-500" />
            : <WifiOff size={10} className="text-red-400 animate-pulse" />}
          <span className={wsConnected ? 'text-green-600' : 'text-red-400'}>
            {wsConnected ? 'Verbunden' : 'Getrennt'}
          </span>
        </div>
        {status.running && (
          <div className="flex items-center gap-1.5">
            <Circle size={7} style={{ fill: status.connected ? '#e11d48' : '#f97316', color: 'transparent' }}
              className={status.connected ? 'animate-pulse' : ''} />
            <span className={status.connected ? 'text-rose-500' : 'text-orange-500'}>
              {status.connected ? 'LIVE' : 'Verbinde…'}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 text-slate-300">
        <span>Opencast</span><span>·</span><span>:8765</span>
      </div>
    </div>
  )
}
