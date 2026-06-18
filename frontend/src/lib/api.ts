let _onUnauthorized: (() => void) | null = null

export function onUnauthorized(cb: () => void): void {
  _onUnauthorized = cb
}

export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = localStorage.getItem('opencast_token') ?? ''
  const res = await fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (res.status === 401) {
    localStorage.removeItem('opencast_token')
    _onUnauthorized?.()
  }
  return res
}

export function wsUrl(path: string): string {
  const token = localStorage.getItem('opencast_token') ?? ''
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const query = token ? `?token=${encodeURIComponent(token)}` : ''
  return `${protocol}://${window.location.host}${path}${query}`
}
