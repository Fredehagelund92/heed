// Applies the theme before first paint, so dark never flashes light: ?theme= in the address, else
// the saved choice, else the system's. Inlined into <head> by vite.app.config.ts, which puts the
// storage key from lib/brand.ts in place of THEME_KEY. Keep this file dependency free and plain
// JavaScript: it runs before any bundle loads. lib/theme.tsx keeps the choice under the same key,
// and tests/app/theme-bootstrap.test.ts covers both.
;(function () {
  var theme = 'system'
  try {
    var asked = new URLSearchParams(window.location.search).get('theme')
    var saved = window.localStorage.getItem(THEME_KEY)
    theme = asked === 'dark' || asked === 'light' ? asked : saved || 'system'
  } catch {
    // Storage can be blocked. The system's choice is the safe default.
  }
  var dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  if (dark) document.documentElement.classList.add('dark')
})()
