import { Radio } from 'lucide-react'

interface Props {
  streamCount: number
  liveCount:   number
}

export default function AppHeader({ streamCount, liveCount }: Props) {
  return (
    <header className="flex items-center px-4 py-3 border-b border-border bg-gradient-to-r from-blue-600/8 to-indigo-600/5 flex-shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/40 flex-shrink-0">
          <Radio size={17} className="text-white" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-foreground leading-tight">Opencast</h1>
          <p className="text-[10px] text-muted-foreground leading-tight">
            Icecast Source Client
            {' · '}
            {streamCount} Stream{streamCount !== 1 ? 's' : ''}
            {liveCount > 0 && (
              <span className="text-emerald-600 ml-1">· {liveCount} Live</span>
            )}
          </p>
        </div>
      </div>
    </header>
  )
}
