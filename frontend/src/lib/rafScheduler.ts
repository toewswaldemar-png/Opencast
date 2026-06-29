type UpdateFn = (ts: number) => void
const subscribers = new Set<UpdateFn>()
let rafId: number | null = null

function loop(ts: number) {
  subscribers.forEach(fn => fn(ts))
  rafId = requestAnimationFrame(loop)
}

export function subscribeRAF(fn: UpdateFn): () => void {
  subscribers.add(fn)
  if (subscribers.size === 1) rafId = requestAnimationFrame(loop)
  return () => {
    subscribers.delete(fn)
    if (subscribers.size === 0 && rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }
}
