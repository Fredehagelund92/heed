import * as React from "react"
import { connectorById, figureConnections, type ConnectorId } from "@/data/integrations"
import { useRoute } from "@/lib/router"

// Whether Ask shows figures, per integration: off by default (Ask then links into the source),
// switched on by an admin on the integration's page. Kept until the page reloads. The review flag
// ?figures=on | off | <integration id> sets it from the address, so every state has a link.

export const FIGURE_SOURCES: ConnectorId[] = ["cube", "warehouse"]

const on: Record<string, boolean> = { cube: false, warehouse: false }
const contacts: Record<string, string> = Object.fromEntries(Object.entries(figureConnections).map(([k, v]) => [k, v.contact]))
let version = 0
const listeners = new Set<() => void>()
const changed = () => {
  version += 1
  for (const l of listeners) l()
}

export function setFigures(id: ConnectorId, value: boolean) {
  on[id] = value
  changed()
}

export function setDataContact(id: ConnectorId, name: string) {
  contacts[id] = name
  changed()
}

export type FigureSettings = { enabled: (id: ConnectorId) => boolean; contact: (id: ConnectorId) => string }

/** The figure settings as they stand, the address flag first. */
export function useFigures(): FigureSettings {
  React.useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version
  )
  const flag = useRoute().query.get("figures")
  const only = flag?.replace(/^source[:=]/, "")
  return {
    enabled: (id) => (flag === "on" ? true : flag === "off" ? false : only && connectorById(only) ? id === only : (on[id] ?? false)),
    contact: (id) => contacts[id] ?? "the data team",
  }
}
