import { type ReactNode } from 'react'
import { ServerConfig, IcecastProtocol } from '../types'
import { Input }  from '@/components/ui/input'
import { Label }  from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn }     from '@/lib/utils'

interface Props {
  config: ServerConfig
  disabled: boolean
  onChange: (cfg: Partial<ServerConfig>) => void
  label: string
  onLabelChange: (label: string) => void
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

export default function ServerPanel({ config, disabled, onChange, label, onLabelChange }: Props) {
  return (
    <div className="flex flex-col gap-4 max-w-lg">

      <Field label="Bezeichnung">
        <Input value={label} onChange={(e) => onLabelChange(e.target.value)} placeholder="Hauptstream" disabled={disabled} />
      </Field>

      <div className="flex flex-col gap-2">
        <Label>Protokoll</Label>
        <div className="flex gap-2">
          {(['icecast2', 'shoutcast'] as IcecastProtocol[]).map((p) => (
            <button
              key={p}
              onClick={() => onChange({ protocol: p })}
              disabled={disabled}
              className={cn(
                'flex-1 py-2 rounded-lg text-xs font-semibold transition-all border',
                config.protocol === p
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {p === 'icecast2' ? 'Icecast 2' : 'Shoutcast'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_80px] gap-3">
        <Field label="Host">
          <Input value={config.host} onChange={(e) => onChange({ host: e.target.value })} disabled={disabled} placeholder="localhost" />
        </Field>
        <Field label="Port">
          <Input type="number" value={config.port} onChange={(e) => onChange({ port: Number(e.target.value) })} disabled={disabled} min={1} max={65535} />
        </Field>
      </div>

      <Field label="Passwort">
        <Input type="password" value={config.password} onChange={(e) => onChange({ password: e.target.value })} disabled={disabled} placeholder="Quellpasswort" />
      </Field>

      <Field label="Mountpoint">
        <Input value={config.mountPoint} onChange={(e) => onChange({ mountPoint: e.target.value })} disabled={disabled} placeholder="/stream" />
      </Field>

      <div className="flex items-center gap-3">
        <Switch checked={config.useSSL} onCheckedChange={(v) => onChange({ useSSL: v })} disabled={disabled} />
        <Label className="normal-case tracking-normal text-xs font-medium cursor-pointer">SSL / HTTPS</Label>
      </div>

      <div className="border-t border-border pt-4 flex flex-col gap-4">
        <Label className="text-[11px]">Stream-Metadaten</Label>

        <Field label="Name">
          <Input value={config.name} onChange={(e) => onChange({ name: e.target.value })} disabled={disabled} placeholder="Mein Radiostream" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Genre">
            <Input value={config.genre} onChange={(e) => onChange({ genre: e.target.value })} disabled={disabled} placeholder="Various" />
          </Field>
          <Field label="URL">
            <Input value={config.url} onChange={(e) => onChange({ url: e.target.value })} disabled={disabled} placeholder="https://…" />
          </Field>
        </div>

        <div className="flex items-center gap-3">
          <Switch checked={config.public} onCheckedChange={(v) => onChange({ public: v })} disabled={disabled} />
          <Label className="normal-case tracking-normal text-xs font-medium cursor-pointer">Öffentlich sichtbar</Label>
        </div>
      </div>

    </div>
  )
}
