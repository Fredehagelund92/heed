// Fails when the first load of the web app grows past its budget. Run after `npm run build`.
// What counts: the scripts and styles that index.html loads or preloads (not lazy route chunks).
// The build that ships is the http one (VITE_API_MODE=http, as the Docker image builds it), so CI
// measures that build.
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'web')
// The budget is a ratchet, not a target: each change that lowers the first load lowers the budget
// with it. Set on 30 Oct 2026 once the pages other than the Inbox and Ask became lazy routes
// (routes/**/*.lazy.tsx, https://github.com/Fredehagelund92/heed/issues/63): 428.6 KB of script
// measured locally, which CI's gzip counts about 2 KB higher, and 31.7 KB of CSS. The CSS is one
// stylesheet for the whole app. Raised to 432 KB of script on 31 Oct 2026: the Mark component and
// anchored line comments landed on main at 431.0 KB, 28 bytes over.
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
const rows = []
for (const kind of ['js', 'css']) {
  const kb = totals[kind] / 1024
  const margin = budgetKb[kind] - kb
  const ok = margin >= 0
  failed ||= !ok
  rows.push({ kind, kb, margin, ok })
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} initial ${kind}: ${kb.toFixed(1)} KB gzip (${totals[kind]} bytes), budget ${budgetKb[kind]} KB, ${ok ? `${margin.toFixed(1)} KB to spare` : `${(-margin).toFixed(1)} KB over`}`,
  )
}
// In CI the numbers go to the job's summary page too, so a pull request shows how close it is.
if (process.env.GITHUB_STEP_SUMMARY) {
  const table = rows.map(
    ({ kind, kb, margin, ok }) =>
      `| ${kind === 'js' ? 'Script' : 'CSS'} | ${kb.toFixed(1)} KB (${totals[kind]} bytes) | ${budgetKb[kind]} KB | ${ok ? `${margin.toFixed(1)} KB to spare` : `**${(-margin).toFixed(1)} KB over**`} |`,
  )
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '### First load (gzip)',
      '',
      '| | Measured | Budget | Margin |',
      '| --- | --- | --- | --- |',
      ...table,
      '',
      '',
    ].join('\n'),
  )
}
if (failed) {
  console.error(
    'The first load is over budget. Lazy load the new code, or raise the budget on purpose in scripts/check-bundle-size.mjs.',
  )
  process.exit(1)
}
