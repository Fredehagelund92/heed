import { describe, expect, it, vi } from 'vitest'
import {
  APPEARANCE_STORAGE_KEY,
  followAppearance,
  readAppearance,
  setAppearance,
} from '@/lib/appearance'

async function runBootstrap() {
  // The bootstrap is an inline <head> script with side effects, so import a fresh copy each time.
  vi.resetModules()
  await import('@/theme-bootstrap.js')
}

function mockSystemDark(dark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('dark') && dark,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
}

describe('no-flash appearance bootstrap', () => {
  it.each([
    ['light', false, false],
    ['dark', false, true],
    ['system', true, true],
    ['system', false, false],
  ] as const)(
    'applies %s (system dark: %s) as dark=%s',
    async (saved, systemDark, expectedDark) => {
      mockSystemDark(systemDark)
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, saved)
      await runBootstrap()
      expect(document.documentElement.classList.contains('dark')).toBe(expectedDark)
      expect(document.documentElement.style.colorScheme).toBe(expectedDark ? 'dark' : 'light')
      expect(document.documentElement.dataset.appearance).toBe(saved)
    },
  )

  it('falls back to the system preference for a missing or invalid value', async () => {
    mockSystemDark(true)
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, 'purple')
    await runBootstrap()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.dataset.appearance).toBe('system')
  })

  it('does the same thing as the app when the appearance changes', async () => {
    mockSystemDark(false)
    setAppearance('dark')
    const afterApp = document.documentElement.className
    document.documentElement.className = ''
    await runBootstrap()
    expect(document.documentElement.className).toBe(afterApp)
    expect(readAppearance()).toBe('dark')
  })
})

describe('following the system', () => {
  it('switches light and dark with the system with nothing on screen that shows the choice', () => {
    let dark = false
    const changes = new Set<() => void>()
    window.matchMedia = ((query: string) => ({
      get matches() {
        return query.includes('dark') && dark
      },
      media: query,
      addEventListener: (_: string, listener: () => void) => changes.add(listener),
      removeEventListener: (_: string, listener: () => void) => changes.delete(listener),
    })) as unknown as typeof window.matchMedia
    setAppearance('system')
    const stop = followAppearance()
    dark = true
    changes.forEach((change) => change())
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    dark = false
    changes.forEach((change) => change())
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    // A person's own choice wins over the system.
    setAppearance('light')
    dark = true
    changes.forEach((change) => change())
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    stop()
    expect(changes.size).toBe(0)
  })
})
