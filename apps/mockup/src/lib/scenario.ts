import * as React from "react"
import { sendTime, useSlowNetwork } from "@/lib/loading"
import { useRoute } from "@/lib/router"

// What can go wrong, made reviewable: ?state=loading keeps a page loading, ?state=failed makes its
// load (and an editor's Save or Publish) fail once, ?state=offline takes the app offline. The real
// browser going offline counts too. Integrations keep their own ?state for a sync.

export type Scenario = "loading" | "failed" | "offline" | null

export function useScenario(): Scenario {
  const { query, parts } = useRoute()
  const s = query.get("state")
  if (parts[0] === "settings" && parts[1] === "integrations") return s === "offline" ? "offline" : null
  return s === "loading" || s === "failed" || s === "offline" ? s : null
}

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange)
  window.addEventListener("offline", onChange)
  return () => {
    window.removeEventListener("online", onChange)
    window.removeEventListener("offline", onChange)
  }
}

/** Whether the app can reach the server: the browser's own signal, or the offline scenario. */
export function useOnline() {
  const browser = React.useSyncExternalStore(subscribe, () => navigator.onLine)
  const scenario = useScenario()
  return browser && scenario !== "offline"
}

export type SendState = "idle" | "sending" | "failed"

/**
 * Save or Publish with its states: sending, then done, or failed with a retry that keeps everything
 * the person wrote. Offline, nothing is sent. With ?state=failed the first try fails.
 */
export function useSend() {
  const scenario = useScenario()
  const slow = useSlowNetwork()
  const online = useOnline()
  const [state, setState] = React.useState<SendState>("idle")
  const tries = React.useRef(0)
  const timer = React.useRef(0)
  React.useEffect(() => () => window.clearTimeout(timer.current), [])
  const send = (commit: () => void) => {
    if (!online || state === "sending") return
    setState("sending")
    tries.current += 1
    const fails = scenario === "failed" && tries.current === 1
    timer.current = window.setTimeout(() => {
      if (fails) return setState("failed")
      setState("idle")
      commit()
    }, sendTime(slow))
  }
  /** Back to idle, for the next item on a page that moves between items. */
  const reset = () => setState("idle")
  return { state, send, online, reset }
}

export type Sender = ReturnType<typeof useSend>
