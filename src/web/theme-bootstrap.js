// Applies the saved appearance before first paint. Inlined into <head> by vite.config.ts.
// Keep this file dependency free and plain JavaScript: it runs before any bundle loads.
// The storage key and class names are mirrored by src/web/lib/appearance.ts and covered by a unit test.
;(function () {
  var mode = 'system'
  try {
    var saved = window.localStorage.getItem('cl.appearance')
    if (saved === 'light' || saved === 'dark' || saved === 'system') mode = saved
  } catch {
    // Storage can be blocked. The system preference is the safe default.
  }
  var dark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  var root = document.documentElement
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  root.dataset.appearance = mode
})()
