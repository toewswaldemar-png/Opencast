import { useEffect, useRef, useCallback } from 'react'
import { WSPayload } from '../types'
import { wsUrl } from '../lib/api'

type MessageHandler = (msg: WSPayload) => void

export function useWebSocket(onMessage: MessageHandler, onDisconnect?: () => void) {
  const wsRef = useRef<WebSocket | null>(null)
  const handlerRef = useRef(onMessage)
  handlerRef.current = onMessage
  const disconnectRef = useRef(onDisconnect)
  disconnectRef.current = onDisconnect

  const mountedRef = useRef(true)

  const connect = useCallback(() => {
    const ws = new WebSocket(wsUrl('/ws'))
    wsRef.current = ws

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WSPayload
        handlerRef.current(msg)
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      wsRef.current = null
      if (!mountedRef.current) return
      disconnectRef.current?.()
      setTimeout(() => {
        if (mountedRef.current && wsRef.current === null) connect()
      }, 2000)
    }

    ws.onerror = () => {
      if (ws.readyState !== WebSocket.CONNECTING) ws.close()
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      const ws = wsRef.current
      if (ws) {
        wsRef.current = null
        ws.close()
      }
    }
  }, [connect])
}
