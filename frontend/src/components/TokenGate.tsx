import { useState, type FormEvent } from 'react'
import { Radio, Lock } from 'lucide-react'
import { Input }  from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn }     from '@/lib/utils'

interface Props { onToken: (token: string) => void }

export default function TokenGate({ onToken }: Props) {
  const [value, setValue]     = useState('')
  const [error, setError]     = useState(false)
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
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-80 bg-card border border-border rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/30">
            <Radio size={17} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-foreground leading-none">Opencast</h1>
            <p className="text-[10px] text-muted-foreground leading-none mt-0.5">Icecast Source Client</p>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <Lock size={13} className="text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Zugangscode erforderlich</span>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            type="password"
            placeholder="Token eingeben..."
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(false) }}
            className={cn('font-mono', error && 'border-destructive focus-visible:ring-destructive')}
            autoFocus
            autoComplete="off"
          />
          {error && <p className="text-xs text-destructive">Ungültiger Token</p>}
          <Button type="submit" disabled={loading || !value.trim()} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
            {loading ? 'Prüfe...' : 'Verbinden'}
          </Button>
        </form>

        <p className="text-[10px] text-muted-foreground text-center mt-4">
          Token im Backend-Terminal beim Start angezeigt
        </p>
      </div>
    </div>
  )
}
