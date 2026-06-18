import { Globe, Lock } from 'lucide-react'
import { ServerConfig, IcecastProtocol } from '../types'

interface Props {
  config: ServerConfig
  disabled: boolean
  onChange: (cfg: Partial<ServerConfig>) => void
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  )
}

const inputCls =
  'bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 transition-colors placeholder:text-slate-600 disabled:opacity-50'

export default function ServerPanel({ config, disabled, onChange }: Props) {
  return (
    <div className="bg-slate-800/60 rounded-xl p-5 flex flex-col gap-4 border border-slate-700/50">
      <div className="flex items-center gap-2">
        <Globe size={16} className="text-blue-400" />
        <span className="text-sm font-semibold text-slate-200">Server</span>
      </div>

      {/* Protocol */}
      <div className="flex gap-2">
        {(['icecast2', 'shoutcast'] as IcecastProtocol[]).map((p) => (
          <button
            key={p}
            onClick={() => onChange({ protocol: p })}
            disabled={disabled}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
              config.protocol === p
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700/60 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {p === 'icecast2' ? 'Icecast 2' : 'Shoutcast'}
          </button>
        ))}
      </div>

      {/* Host + Port */}
      <div className="grid grid-cols-[1fr_90px] gap-2">
        <Field label="Host">
          <input
            type="text"
            value={config.host}
            onChange={(e) => onChange({ host: e.target.value })}
            disabled={disabled}
            placeholder="localhost"
            className={inputCls}
          />
        </Field>
        <Field label="Port">
          <input
            type="number"
            value={config.port}
            onChange={(e) => onChange({ port: Number(e.target.value) })}
            disabled={disabled}
            min={1}
            max={65535}
            className={inputCls}
          />
        </Field>
      </div>

      {/* Password */}
      <Field label="Passwort">
        <div className="relative">
          <input
            type="password"
            value={config.password}
            onChange={(e) => onChange({ password: e.target.value })}
            disabled={disabled}
            placeholder="Quellpasswort"
            className={`${inputCls} pr-8 w-full`}
          />
          <Lock size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
        </div>
      </Field>

      {/* Mount */}
      <Field label="Mountpoint">
        <input
          type="text"
          value={config.mountPoint}
          onChange={(e) => onChange({ mountPoint: e.target.value })}
          disabled={disabled}
          placeholder="/stream"
          className={inputCls}
        />
      </Field>

      {/* SSL Toggle */}
      <label className="flex items-center gap-3 cursor-pointer select-none">
        <div
          onClick={() => !disabled && onChange({ useSSL: !config.useSSL })}
          className={`relative w-9 h-5 rounded-full transition-colors ${
            config.useSSL ? 'bg-blue-600' : 'bg-slate-700'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <div
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              config.useSSL ? 'translate-x-4' : ''
            }`}
          />
        </div>
        <span className="text-xs text-slate-400">SSL / HTTPS</span>
      </label>

      {/* Metadata section */}
      <div className="border-t border-slate-700/50 pt-4 flex flex-col gap-3">
        <span className="text-[11px] text-slate-500 uppercase tracking-wide font-medium">Stream-Metadaten</span>

        <Field label="Name">
          <input
            type="text"
            value={config.name}
            onChange={(e) => onChange({ name: e.target.value })}
            disabled={disabled}
            placeholder="Mein Radiostream"
            className={inputCls}
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Genre">
            <input
              type="text"
              value={config.genre}
              onChange={(e) => onChange({ genre: e.target.value })}
              disabled={disabled}
              placeholder="Various"
              className={inputCls}
            />
          </Field>
          <Field label="URL">
            <input
              type="text"
              value={config.url}
              onChange={(e) => onChange({ url: e.target.value })}
              disabled={disabled}
              placeholder="https://..."
              className={inputCls}
            />
          </Field>
        </div>

        <label className="flex items-center gap-3 cursor-pointer select-none">
          <div
            onClick={() => !disabled && onChange({ public: !config.public })}
            className={`relative w-9 h-5 rounded-full transition-colors ${
              config.public ? 'bg-blue-600' : 'bg-slate-700'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <div
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                config.public ? 'translate-x-4' : ''
              }`}
            />
          </div>
          <span className="text-xs text-slate-400">Öffentlich sichtbar</span>
        </label>
      </div>
    </div>
  )
}
