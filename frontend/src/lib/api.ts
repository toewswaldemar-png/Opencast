export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init)
}

export function wsUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}${path}`
}
