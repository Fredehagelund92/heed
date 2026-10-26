import * as React from "react"
import { useRoute } from "@/lib/router"

// The switch "Let agents follow links" in Settings, Tools and access keys: on in the demo. The
// review flag ?links=on|off sets it from the address, so both states have a link.

let on = true
const listeners = new Set<() => void>()

export function setLinksEnabled(v: boolean) {
  on = v
  listeners.forEach((l) => l())
}

/** Whether agents may follow links: the switch in Settings, or ?links=on|off from the address. */
export function useLinksEnabled() {
  const stored = React.useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => on
  )
  const flag = useRoute().query.get("links")
  return flag === "on" ? true : flag === "off" ? false : stored
}
