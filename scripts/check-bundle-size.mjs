// Fails when the first load of the web app grows past its budget. Run after `npm run build`.
// What counts: the scripts and styles that index.html loads or preloads (not lazy route chunks).
// The build that ships is the http one (VITE_API_MODE=http, as the Docker image builds it), so CI
// measures that build.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'web')
// The budget is a ratchet, not a target: each change that lowers the first load lowers the budget
// with it. Set on 30 Oct 2026 once the pages other than the Inbox and Ask became lazy routes
// (routes/**/*.lazy.tsx, https://github.com/Fredehagelund92/heed/issues/63): 428.6 KB of script
// measured locally, which CI's gzip counts about 2 KB higher, and 31.7 KB of CSS. The CSS is one
// stylesheet for the whole app. Raised to 432 KB on 31 Oct 2026: anchored comments and the Mark
// component (#86, #87) put CI's measure at 431.0 KB.
const budgetKb = { js: 432, css: 32 }

const html = readFileSync(join(root, 'index.html'), 'utf8')
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(js|css))"/g)].map((match) => ({
  file: match[1],
  kind: match[2],
}))
if (assets.length === 0)
  throw new Error('No assets found in dist/web/index.html. Run `npm run build` first.')

const totals = { js: 0, css: 0 }
for (const { file, kind } of assets) {
  const bytes = gzipSync(readFileSync(join(root, file))).length
  totals[kind] += bytes
  console.log(`${(bytes / 1024).toFixed(1).padStart(7)} KB gzip  ${file}`)
}

let failed = false
for (const kind of ['js', 'css']) {
  const kb = totals[kind] / 1024
  const ok = kb <= budgetKb[kind]
  failed ||= !ok
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} initial ${kind}: ${kb.toFixed(1)} KB gzip, budget ${budgetKb[kind]} KB`,
  )
}
if (failed) {
  console.error(
    'The first load is over budget. Lazy load the new code, or raise the budget on purpose in scripts/check-bundle-size.mjs.',
  )
  process.exit(1)
}
