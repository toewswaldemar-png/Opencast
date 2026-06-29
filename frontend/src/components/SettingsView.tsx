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
  autoReconnect:     boolean
  vuDecayMs:         number
  onReconnectChange: (v: boolean) => void
  onVuDecayChange:   (ms: number) => void
}

export default function SettingsView({ autoReconnect, vuDecayMs, onReconnectChange, onVuDecayChange }: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-sm mx-auto flex flex-col gap-6">
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-4">Einstellungen</h2>

          {/* Verbindung */}
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Verbindung</p>
          <div className="flex items-center justify-between py-3 border-b border-border">
            <div>
              <p className="text-xs font-medium text-foreground">Auto Reconnect</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Bei Verbindungsabbruch automatisch neu verbinden</p>
            </div>
            <Switch checked={autoReconnect} onCheckedChange={onReconnectChange} />
          </div>
        </div>

        <Separator />

        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">VU-Meter</p>
          <div className="flex items-center justify-between py-3 gap-4">
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

        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Fallbacks</p>
          <p className="text-xs text-muted-foreground">In Entwicklung</p>
        </div>
      </div>
    </div>
  )
}
