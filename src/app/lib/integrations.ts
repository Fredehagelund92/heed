import * as React from 'react'
import type { ConnectorId } from '@/data/integrations'

// Which tools are connected, kept in memory until the page reloads: Cube, Google Drive and the
// warehouse in the demo world; Markdown in Git once someone goes through the connect flow.

let connected: ConnectorId[] = ['cube', 'google-drive', 'warehouse']
const listeners = new Set<() => void>()

export function useConnected() {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => connected,
  )
}

export function connect(id: ConnectorId) {
  if (connected.includes(id)) return
  connected = [...connected, id]
  listeners.forEach((l) => l())
}

export function disconnect(id: ConnectorId) {
  connected = connected.filter((c) => c !== id)
  listeners.forEach((l) => l())
}
