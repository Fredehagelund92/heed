import * as React from 'react'

export type Theme = 'dark' | 'light' | 'system'

export type ThemeState = { theme: Theme; setTheme: (theme: Theme) => void }

export const ThemeContext = React.createContext<ThemeState>({
  theme: 'system',
  setTheme: () => null,
})

export const useTheme = () => React.useContext(ThemeContext)
