import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  document.documentElement.className = ''
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-appearance')
})

// jsdom has no matchMedia. Tests that need a dark system preference override this.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    }),
  })
}

// jsdom does not scroll and logs "Not implemented" for scrollTo; the router restores scroll on
// navigation, so tests that navigate would print it.
window.scrollTo = () => undefined

// jsdom has no scrollIntoView either; the assistant brings a new question into view with it.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
