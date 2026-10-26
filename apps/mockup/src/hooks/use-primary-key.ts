import * as React from "react"

/**
 * Command (or Control) and Enter presses the page's primary button, the one marked data-primary:
 * Publish, Send or Save. A blocked button then shows what is missing, as a click would.
 */
export function usePrimaryKey() {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return
      const button = document.querySelector<HTMLButtonElement>("button[data-primary]")
      if (!button) return
      e.preventDefault()
      button.click()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}
