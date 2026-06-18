import { useState } from 'react'
import { Radio, Lock } from 'lucide-react'

interface Props {
  onToken: (token: string) => void
}

export default function TokenGate({ onToken }: Props) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const token = value.trim()
    if (!token) return
    setLoading(true)
    setError(false)
    try {
      const res = await fetch('/api/status', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        onToken(token)
      } else {
        setError(true)
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-80 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/50">
            <Radio size={17} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-100 leading-none">Opencast</h1>
            <p className="text-[10px] text-slate-500 leading-none mt-0.5">Icecast Source Client</p>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <Lock size={13} className="text-slate-500" />
          <span className="text-xs text-slate-400">Zugangscode erforderlich</span>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            placeholder="Token eingeben..."
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(false) }}
            className={`w-full bg-slate-800 border rounded-lg px-3 py-2.5 text-sm text-slate-100 font-mono outline-none transition-colors placeholder:text-slate-600 focus:border-blue-500 ${
              error ? 'border-red-500' : 'border-slate-700'
            }`}
            autoFocus
            autoComplete="off"
          />
          {error && (
            <p className="text-xs text-red-400">Ungültiger Token</p>
          )}
          <button
            type="submit"
            disabled={loading || !value.trim()}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {loading ? 'Prüfe...' : 'Verbinden'}
          </button>
        </form>

        <p className="text-[10px] text-slate-600 text-center mt-4">
          Token im Backend-Terminal beim Start angezeigt
        </p>
      </div>
    </div>
  )
}
