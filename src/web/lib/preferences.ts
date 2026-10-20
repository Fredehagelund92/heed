import { useSyncExternalStore } from 'react'

/**
 * Personal display preferences kept in this browser (contract 9.10): density and columns. They
 * are conveniences, so a blocked or empty storage falls back to the default.
 */
const listeners = new Set<() => void>()

function read<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed: unknown = JSON.parse(raw)
    return valid(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

const cache = new Map<string, { raw: string | null; value: unknown }>()
const unsaved = new Map<string, unknown>()

/** Reads a preference, returning the same object until it changes (useSyncExternalStore needs that). */
function snapshot<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  if (unsaved.has(key)) return unsaved.get(key) as T
  let raw: string | null
  try {
    raw = window.localStorage.getItem(key)
  } catch {
    raw = null
  }
  const cached = cache.get(key)
  if (cached && cached.raw === raw) return cached.value as T
  const value = read(key, fallback, valid)
  cache.set(key, { raw, value })
  return value
}

export function setPreference(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    unsaved.delete(key)
  } catch {
    // Storage can be blocked. The choice still applies until the page reloads.
    unsaved.set(key, value)
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

export function usePreference<T>(
  key: string,
  fallback: T,
  valid: (value: unknown) => value is T,
): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => snapshot(key, fallback, valid),
    () => fallback,
  )
  return [value, (next: T) => setPreference(key, next)]
}

/**
 * Row densities of the library grid (contract 4.5): compact 40 (the default), comfortable 48 and
 * "with scope" 64, which adds the metrics and markets under each title.
 */
export const densities = ['compact', 'comfortable', 'scope'] as const
export type Density = (typeof densities)[number]
export const isDensity = (value: unknown): value is Density =>
  (densities as readonly unknown[]).includes(value)

export const defaultDensity: Density = 'compact'
