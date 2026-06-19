import { useState, type FormEvent } from 'react'
import { Radio, Lock } from 'lucide-react'
import { Input }  from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn }     from '@/lib/utils'

interface Props { onToken: (token: string) => void }

export default function TokenGate({ onToken }: Props) {
  const [value, setValue]   = useState('')
  const [error, setError]   = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const token = value.trim()
    if (!token) return
    setLoading(true); setError(false)
    try {
      const res = await fetch('/api/status', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) { onToken(token) } else { setError(true) }
    } catch { setError(true) }
    finally { setLoading(false) }
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
          <Input
            type="password"
            placeholder="Token eingeben..."
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(false) }}
            className={cn(
              'bg-slate-800 border-slate-700 text-slate-100 font-mono placeholder:text-slate-600 focus-visible:ring-blue-500',
              error && 'border-red-500'
            )}
            autoFocus
            autoComplete="off"
          />
          {error && <p className="text-xs text-red-400">Ungültiger Token</p>}
          <Button type="submit" disabled={loading || !value.trim()} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
            {loading ? 'Prüfe...' : 'Verbinden'}
          </Button>
        </form>

        <p className="text-[10px] text-slate-600 text-center mt-4">
          Token im Backend-Terminal beim Start angezeigt
        </p>
      </div>
    </div>
  )
}
