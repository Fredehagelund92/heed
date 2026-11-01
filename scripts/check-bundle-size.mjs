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
// Each budget sits about 3 percent above what CI itself measured on main, so that two pull
// requests that each grow the first load a little do not together turn main red. Every run prints
// the exact bytes, the budget and the margin, pass or fail.
// Script: reset on 1 Nov 2026 from CI's run on main (commit 62e11f05, 437298 bytes, 427.0 KB):
// 427.0 KB x 1.03 = 439.8 KB, rounded down to 439 KB (2.8 percent of room).
// CSS: reset on 1 Nov 2026 from the same run (32683 bytes, 31.9 KB, one stylesheet for the whole
// app): 31.9 KB x 1.03 = 32.9 KB, rounded to 33 KB (3.4 percent of room). The old 32 KB left 85
// bytes.
// CI counts more than a Mac does for the same build: the files are byte for byte the same (the
// same names and hashes), but Node's gzip on CI's x86 runners gives 1.3 to 1.8 KB more than on
// Apple silicon. So read the margin CI prints, not a local one.
// How and when the budget goes down: when a change makes the first load smaller, CI prints a
// margin well above 3 percent. In that same pull request (or a follow-up on its own), set the
// budget to about 3 percent above the new CI-measured size, using the bytes in the CI log or job
// summary, never a local build. Never lower it so far that CI's own margin is under 2 percent.
// Raising it is the opposite case: only on purpose, in a pull request that says why. The pipeline's
// automatic repairs may not edit this file (protected_paths in .no-mistakes.yaml).
const budgetKb = { js: 439, css: 33 }

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
