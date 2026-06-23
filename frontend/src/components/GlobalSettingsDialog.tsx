import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const VU_DECAY_OPTIONS = [
  { value: 200,  label: '200 ms — sehr schnell' },
  { value: 500,  label: '500 ms — schnell' },
  { value: 1000, label: '1 s — normal' },
  { value: 2000, label: '2 s — langsam' },
  { value: 3000, label: '3 s — sehr langsam' },
]

interface Props {
  open:              boolean
  autoReconnect:     boolean
  vuDecayMs:         number
  onClose:           () => void
  onReconnectChange: (v: boolean) => void
  onVuDecayChange:   (ms: number) => void
}

export default function GlobalSettingsDialog({ open, autoReconnect, vuDecayMs, onClose, onReconnectChange, onVuDecayChange }: Props) {
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
        <div className="p-4 flex flex-col gap-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">VU-Meter</p>
          <div className="flex items-center justify-between py-2 gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">Decay-Zeit</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Wie lange der Ausschlag sichtbar bleibt</p>
            </div>
            <Select value={String(vuDecayMs)} onValueChange={(v) => onVuDecayChange(Number(v))}>
              <SelectTrigger className="h-7 text-xs w-44 flex-shrink-0">
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

        <Separator />
        <div className="px-4 py-3 flex justify-end">
          <Button size="sm" onClick={onClose} className="h-7 text-xs">Schließen</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
