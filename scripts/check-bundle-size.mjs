// Fails when the first load of the web app grows past its budget. `npm run size` builds the web
// app as it ships and runs this; `node scripts/check-bundle-size.mjs` checks the build already in
// dist/web.
// What counts: the scripts and styles that index.html loads or preloads (not lazy route chunks).
// The build that ships is the http one (VITE_API_MODE=http, as the Docker image builds it), so
// `npm run size` builds that, the same way locally and in CI.
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'web')
// The budget is a ratchet, not a target: each change that lowers the first load may lower the
// budget with it, and only a change that means to grow it raises it.
// Script: set on 31 Oct 2026 to about 3 percent above what CI measured on main then (commit
// 492f34ea, 425.9 KB), so that two pull requests that each grow the first load a little do not
// together turn main red. 425.9 KB x 1.03 = 438.7 KB, rounded down to 438 KB.
// CI counts more than a Mac does for the same build: the files are byte for byte the same (the
// same names and hashes), but Node's gzip on CI's x86 runners gives 1.3 to 1.8 KB more than on
// Apple silicon (424.6 KB locally for that commit). So read the margin CI prints, not a local one.
// CSS: 31.9 KB, one stylesheet for the whole app.
const budgetKb = { js: 438, css: 32 }

const html = readFileSync(join(root, 'index.html'), 'utf8')
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(js|css))"/g)].map((match) => ({
  file: match[1],
  kind: match[2],
}))
if (assets.length === 0)
  throw new Error('No assets found in dist/web/index.html. Run `npm run size` to build and check.')

const kb = (bytes) => (bytes / 1024).toFixed(1)
const totals = { js: 0, css: 0 }
for (const { file, kind } of assets) {
  const bytes = gzipSync(readFileSync(join(root, file))).length
  totals[kind] += bytes
  console.log(`${String(bytes).padStart(7)} bytes ${kb(bytes).padStart(6)} KB gzip  ${file}`)
}

let failed = false
const rows = []
for (const kind of ['js', 'css']) {
  const bytes = totals[kind]
  const budget = budgetKb[kind] * 1024
  const margin = budget - bytes
  const ok = margin >= 0
  failed ||= !ok
  const room = ok
    ? `${margin} bytes (${kb(margin)} KB) to spare`
    : `${-margin} bytes (${kb(-margin)} KB) over`
  rows.push({ kind, bytes, budget, ok, room })
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} initial ${kind}: ${bytes} bytes (${kb(bytes)} KB) gzip, budget ${budget} bytes (${budgetKb[kind]} KB), ${room}`,
  )
}
// In CI the numbers go to the job's summary page too, so a pull request shows how close it is.
if (process.env.GITHUB_STEP_SUMMARY) {
  const table = rows.map(
    ({ kind, bytes, budget, ok, room }) =>
      `| ${kind === 'js' ? 'Script' : 'CSS'} | ${bytes} bytes (${kb(bytes)} KB) | ${budget} bytes (${budgetKb[kind]} KB) | ${ok ? room : `**${room}**`} |`,
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
    'The first load is over budget. Lazy load the new code, or raise the budget in scripts/check-bundle-size.mjs on purpose, in a pull request that says why.',
  )
  process.exit(1)
}
