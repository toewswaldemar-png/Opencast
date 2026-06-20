import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'

interface Props {
  open:            boolean
  autoReconnect:   boolean
  onClose:         () => void
  onReconnectChange: (v: boolean) => void
}

export default function GlobalSettingsDialog({ open, autoReconnect, onClose, onReconnectChange }: Props) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-xl shadow-xl w-72">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
          <Settings2 size={13} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground flex-1">Globale Einstellungen</h2>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={onClose}>
            <X size={13} />
          </Button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Verbindung</p>
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-xs font-medium text-foreground">Auto Reconnect</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Bei Verbindungsabbruch automatisch neu verbinden</p>
            </div>
            <Switch checked={autoReconnect} onCheckedChange={onReconnectChange} />
          </div>
        </div>

        <Separator />
        <div className="px-4 py-3 flex justify-end">
          <Button size="sm" onClick={onClose} className="h-7 text-xs">Schließen</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
