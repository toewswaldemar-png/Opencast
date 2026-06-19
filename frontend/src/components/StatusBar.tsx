import { Wifi, WifiOff, Radio } from 'lucide-react'
import { AllStreamStatus } from '../types'
import { cn } from '@/lib/utils'

interface Props { allStatuses: AllStreamStatus; wsConnected: boolean }

export default function StatusBar({ allStatuses, wsConnected }: Props) {
  const liveCount = Object.values(allStatuses).filter((s) => s.connected).length

  return (
    <div className="flex items-center justify-between px-4 py-1 border-t border-black/[0.06] bg-white/80 text-[10px] font-mono text-slate-400 flex-shrink-0">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          {wsConnected
            ? <Wifi size={10} className="text-green-500" />
            : <WifiOff size={10} className="text-red-500" />}
          <span className={cn(wsConnected ? 'text-green-600' : 'text-red-500')}>
            {wsConnected ? 'Verbunden' : 'Getrennt'}
          </span>
        </div>
        {liveCount > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
            <span className="text-red-500 font-bold tracking-widest">{liveCount}× LIVE</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-slate-400">
        <Radio size={9} />
        <span>Source Client</span><span>·</span><span>v1.0</span>
      </div>
    </div>
  )
}
