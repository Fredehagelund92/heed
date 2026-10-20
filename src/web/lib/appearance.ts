import { useSyncExternalStore } from 'react'

/**
 * Appearance: light, dark or follow the system. The first paint is handled by
 * src/web/theme-bootstrap.js (inlined in <head>); this module keeps the same storage key and
 * class name and applies later changes. tests/unit/appearance.test.ts keeps the two in step.
 */
export const APPEARANCE_STORAGE_KEY = 'cl.appearance'
export const appearances = ['light', 'dark', 'system'] as const
export type Appearance = (typeof appearances)[number]

const listeners = new Set<() => void>()

function isAppearance(value: unknown): value is Appearance {
  return typeof value === 'string' && (appearances as readonly string[]).includes(value)
}

export function readAppearance(): Appearance {
  try {
    const saved = window.localStorage.getItem(APPEARANCE_STORAGE_KEY)
    if (isAppearance(saved)) return saved
  } catch {
    // Storage can be blocked. Fall through to the default.
  }
  return 'system'
}

export function resolveDark(mode: Appearance): boolean {
  return (
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  )
}

function apply(mode: Appearance) {
  const dark = resolveDark(mode)
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  root.dataset.appearance = mode
}

export function setAppearance(mode: Appearance) {
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, mode)
  } catch {
    // The choice still applies for this page view.
  }
  apply(mode)
  notify()
}

const notify = () => listeners.forEach((listener) => listener())

/**
 * Keeps the page in step with the system's light or dark and with a choice made in another tab,
 * for as long as the page is open, whether or not anything that shows the choice is on screen (on
 * a phone the user menu is not). The app calls it once as it starts.
 */
export function followAppearance(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const onSystemChange = () => {
    if (readAppearance() !== 'system') return
    apply('system')
    notify()
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== APPEARANCE_STORAGE_KEY) return
    apply(readAppearance())
    notify()
  }
  media.addEventListener('change', onSystemChange)
  window.addEventListener('storage', onStorage)
  return () => {
    media.removeEventListener('change', onSystemChange)
    window.removeEventListener('storage', onStorage)
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, readAppearance, () => 'system')
}
