import * as React from "react"
import { people } from "@/data/world"
import { reduce, start, StoreContext } from "./store"

/** `?as=Sofia Brandt` in an address signs in as that demo person, so a state seen by someone else has its own link. */
function asInAddress() {
  const name = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("as")
  return people.some((p) => p.name === name && !p.invited) ? name : null
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reduce, undefined, () => ({ ...start, user: asInAddress() ?? start.user }))
  React.useEffect(() => {
    const follow = () => {
      const name = asInAddress()
      if (name) dispatch({ type: "signIn", name, fresh: false })
    }
    window.addEventListener("hashchange", follow)
    return () => window.removeEventListener("hashchange", follow)
  }, [])
  const value = React.useMemo(() => ({ state, dispatch }), [state])
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
