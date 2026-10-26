import { storageKey } from '@/lib/brand'

// Pane widths the person dragged, kept for the browser session.

export function readWidth(key: string, fallback: number) {
  try {
    const v = Number(sessionStorage.getItem(`${storageKey('pane')}:${key}`))
    return v > 0 ? v : fallback
  } catch {
    return fallback
  }
}

export function saveWidth(key: string, width: number) {
  try {
    sessionStorage.setItem(`${storageKey('pane')}:${key}`, String(Math.round(width)))
  } catch {
    // A private window can refuse storage; the width then lasts until the page reloads.
  }
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
