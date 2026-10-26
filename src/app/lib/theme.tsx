import * as React from 'react'

// The theme provider from shadcn's Vite guide, plus ?theme=dark|light in the address for screenshots.

import { ThemeContext, type Theme } from './theme-context'
import { storageKey } from '@/lib/brand'
import { useRoute } from '@/lib/router'

const KEY = storageKey('theme')

function fromUrl(): Theme | null {
  const t = new URLSearchParams(window.location.search).get('theme')
  return t === 'dark' || t === 'light' ? t : null
}

function initial(): Theme {
  const t = fromUrl()
  if (t) return t
  try {
    return (localStorage.getItem(KEY) as Theme) || 'system'
  } catch {
    return 'system'
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(initial)

  // A new ?theme= in the address switches to it, as it does on load.
  const asked = useRoute().query.get('theme')
  const [seen, setSeen] = React.useState(asked)
  if (asked !== seen) {
    setSeen(asked)
    if (asked === 'dark' || asked === 'light') setThemeState(asked)
  }

  React.useEffect(() => {
    const root = window.document.documentElement
    const apply = () => {
      const dark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      root.classList.toggle('dark', dark)
    }
    apply()
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [theme])

  const setTheme = React.useCallback((t: Theme) => {
    try {
      localStorage.setItem(KEY, t)
    } catch {
      // Private windows can refuse storage; the choice then lasts for this visit.
    }
    // Colours ease across for a moment when someone switches (index.css, .theme-switching), and never on load.
    const root = document.documentElement
    root.classList.add('theme-switching')
    window.setTimeout(() => root.classList.remove('theme-switching'), 260)
    setThemeState(t)
  }, [])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}
