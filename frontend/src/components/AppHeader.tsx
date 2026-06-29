import { Radio } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  wsConnected:     boolean
  clientConnected: boolean
}

export default function AppHeader({ wsConnected, clientConnected }: Props) {
  return (
    <header className="flex items-center px-4 py-3 flex-shrink-0 gap-4" style={{background: 'rgba(255,255,255,0.75)'}}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/40 flex-shrink-0">
          <Radio size={17} className="text-white" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-foreground leading-tight">Opencast</h1>
          <p className="text-[10px] text-muted-foreground leading-tight">v1.0.0</p>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-4">
        {([
          { label: 'WebSocket', ok: wsConnected },
          { label: 'Client',    ok: clientConnected },
        ] as const).map(({ label, ok }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', ok ? 'bg-teal-500' : 'bg-muted-foreground/40')} />
            <span className="text-[11px] text-muted-foreground">{label}</span>
            <span className={cn('text-[11px] font-medium', ok ? 'text-teal-600' : 'text-muted-foreground')}>
              {ok ? (label === 'WebSocket' ? 'Verbunden' : 'Online') : (label === 'WebSocket' ? 'Getrennt' : 'Offline')}
            </span>
          </div>
        ))}
      </div>
    </header>
  )
}
