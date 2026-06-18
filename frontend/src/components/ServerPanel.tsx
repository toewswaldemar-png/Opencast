import { Globe, Lock } from 'lucide-react'
import { ServerConfig, IcecastProtocol } from '../types'

interface Props {
  config: ServerConfig
  disabled: boolean
  onChange: (cfg: Partial<ServerConfig>) => void
  label: string
  onLabelChange: (label: string) => void
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'w-full rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none transition-colors placeholder:text-slate-300 disabled:opacity-50 border focus:border-indigo-400 bg-slate-50 border-slate-200'

function Toggle({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled: boolean }) {
  return (
    <div onClick={() => !disabled && onToggle()}
      className={`relative w-8 h-4 rounded-full transition-all shrink-0 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      style={{ background: on ? 'linear-gradient(135deg,#7c3aed,#4f46e5)' : '#e2e8f0' }}>
      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </div>
  )
}

export default function ServerPanel({ config, disabled, onChange, label, onLabelChange }: Props) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-3.5 border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2">
        <Globe size={15} className="text-indigo-500" />
        <span className="text-sm font-semibold text-slate-700">Server</span>
      </div>

      <Field label="Bezeichnung">
        <input type="text" value={label} onChange={(e) => onLabelChange(e.target.value)}
          placeholder="Hauptstream" className={inputCls} />
      </Field>

      <div className="flex gap-1.5">
        {(['icecast2', 'shoutcast'] as IcecastProtocol[]).map((p) => (
          <button key={p} onClick={() => onChange({ protocol: p })} disabled={disabled}
            className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
            style={config.protocol === p ? {
              background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: '#fff',
              boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
            } : { background: '#f1f5f9', color: '#64748b' }}>
            {p === 'icecast2' ? 'Icecast 2' : 'Shoutcast'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_80px] gap-2">
        <Field label="Host">
          <input type="text" value={config.host} onChange={(e) => onChange({ host: e.target.value })}
            disabled={disabled} placeholder="localhost" className={inputCls} />
        </Field>
        <Field label="Port">
          <input type="number" value={config.port} onChange={(e) => onChange({ port: Number(e.target.value) })}
            disabled={disabled} min={1} max={65535} className={inputCls} />
        </Field>
      </div>

      <Field label="Passwort">
        <div className="relative">
          <input type="password" value={config.password} onChange={(e) => onChange({ password: e.target.value })}
            disabled={disabled} placeholder="Quellpasswort" className={`${inputCls} pr-8`} />
          <Lock size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-300" />
        </div>
      </Field>

      <Field label="Mountpoint">
        <input type="text" value={config.mountPoint} onChange={(e) => onChange({ mountPoint: e.target.value })}
          disabled={disabled} placeholder="/stream" className={inputCls} />
      </Field>

      <label className="flex items-center gap-3 cursor-pointer select-none">
        <Toggle on={config.useSSL} onToggle={() => onChange({ useSSL: !config.useSSL })} disabled={disabled} />
        <span className="text-xs text-slate-500">SSL / HTTPS</span>
      </label>

      <div className="border-t border-slate-100 pt-3 flex flex-col gap-3">
        <span className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">Stream-Metadaten</span>
        <Field label="Name">
          <input type="text" value={config.name} onChange={(e) => onChange({ name: e.target.value })}
            disabled={disabled} placeholder="Mein Radiostream" className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Genre">
            <input type="text" value={config.genre} onChange={(e) => onChange({ genre: e.target.value })}
              disabled={disabled} placeholder="Various" className={inputCls} />
          </Field>
          <Field label="URL">
            <input type="text" value={config.url} onChange={(e) => onChange({ url: e.target.value })}
              disabled={disabled} placeholder="https://…" className={inputCls} />
          </Field>
        </div>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <Toggle on={config.public} onToggle={() => onChange({ public: !config.public })} disabled={disabled} />
          <span className="text-xs text-slate-500">Öffentlich sichtbar</span>
        </label>
      </div>
    </div>
  )
}
