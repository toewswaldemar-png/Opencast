import { useEffect, useRef, useCallback } from 'react'
import { WSPayload } from '../types'

type MessageHandler = (msg: WSPayload) => void

export function useWebSocket(onMessage: MessageHandler) {
  const wsRef = useRef<WebSocket | null>(null)
  const handlerRef = useRef(onMessage)
  handlerRef.current = onMessage

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws`)
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
      // Reconnect after 2s if not intentionally closed
      setTimeout(() => {
        if (wsRef.current === null) connect()
      }, 2000)
    }

    ws.onerror = () => {
      if (ws.readyState !== WebSocket.CONNECTING) ws.close()
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      const ws = wsRef.current
      if (ws) {
        wsRef.current = null
        ws.close()
      }
    }
  }, [connect])
}
