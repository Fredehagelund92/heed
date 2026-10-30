// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { storageKey } from '@/lib/brand'

// The theme before the first paint (src/web/theme-bootstrap.js). vite.config.ts inlines it with
// the storage key of lib/brand.ts in place of THEME_KEY, the key lib/theme.tsx saves under; here
// THEME_KEY is that key as a global.

async function run({
  saved,
  search = '',
  systemDark = false,
}: {
  saved?: string
  search?: string
  systemDark?: boolean
}) {
  document.documentElement.className = ''
  window.localStorage.clear()
  if (saved) window.localStorage.setItem(storageKey('theme'), saved)
  window.history.replaceState(null, '', `/inbox${search}`)
  window.matchMedia = ((query: string) => ({
    matches: query.includes('dark') && systemDark,
    media: query,
  })) as unknown as typeof window.matchMedia
  vi.stubGlobal('THEME_KEY', storageKey('theme'))
  // The bootstrap is an inline <head> script with side effects, so import a fresh copy each time.
  vi.resetModules()
  await import('@/theme-bootstrap.js')
  return document.documentElement.classList.contains('dark')
}

afterEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('the theme bootstrap', () => {
  it("applies the saved choice, or the system's", async () => {
    expect(await run({ saved: 'dark' })).toBe(true)
    expect(await run({ saved: 'light', systemDark: true })).toBe(false)
    expect(await run({ saved: 'system', systemDark: true })).toBe(true)
    expect(await run({ systemDark: true })).toBe(true)
    expect(await run({})).toBe(false)
  })

  it('lets ?theme= in the address win, for a screenshot', async () => {
    expect(await run({ saved: 'light', search: '?theme=dark' })).toBe(true)
    expect(await run({ saved: 'dark', search: '?theme=light' })).toBe(false)
    expect(await run({ saved: 'dark', search: '?theme=sepia' })).toBe(true)
  })

  it("keeps the key in the product's name, as every key the app stores", () => {
    expect(storageKey('theme')).toMatch(/^[a-z0-9 ]+-theme$/)
  })
})
