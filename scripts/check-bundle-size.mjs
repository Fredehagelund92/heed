// Fails when the first load of the web app grows past its budget. Run after `npm run build`.
// What counts: the scripts and styles that index.html loads or preloads (not lazy route chunks).
// The build that ships is the http one (VITE_API_MODE=http, as the Docker image builds it), so CI
// measures that build.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'web')
// The budget is a ratchet, not a target. Set when the web app replaced the old front end (P14b,
// 29 Oct 2026) and raised on 30 Oct 2026 just above what CI measured, 515.7 KB of script (CI's
// gzip counts about 2 KB more than some local machines) and 31.5 KB of CSS: every page loads with
// the app, as the mockup's do (vite.config.ts). Splitting the
// heavier pages (Observability, Integrations, Docs) into lazy routes lowers it
// (https://github.com/Fredehagelund92/heed/issues/63); each change that lowers the first load
// lowers the budget with it.
const budgetKb = { js: 518, css: 32 }

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
