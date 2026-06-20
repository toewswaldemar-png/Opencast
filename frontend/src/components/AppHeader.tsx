import { Radio, Plus, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'

interface Props {
  streamCount:     number
  liveCount:       number
  onAdd:           () => void
  onOpenSettings:  () => void
}

export default function AppHeader({ streamCount, liveCount, onAdd, onOpenSettings }: Props) {
  return (
    <header className="flex items-center px-4 py-3 border-b border-border bg-card flex-shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/40 flex-shrink-0">
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

      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
              <Settings2 size={15} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Streams</DropdownMenuLabel>
            <DropdownMenuItem onClick={onAdd}>
              <Plus size={13} />
              Stream hinzufügen
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Einstellungen</DropdownMenuLabel>
            <DropdownMenuItem onClick={onOpenSettings}>
              <Settings2 size={13} />
              Globale Einstellungen
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
