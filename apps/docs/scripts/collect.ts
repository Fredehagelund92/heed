import { cpSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/*
  Puts one built version into the folder that holds them all (the gh-pages branch, in
  .github/scripts/publish-docs.sh), and writes what sits above the versions. Only the version's own
  folder changes, so an older version is never built again: a patch release overwrites its minor,
  and an upgrade of the framework cannot break what was published.

  node scripts/collect.ts <the folder of all versions> <the built site> <vMAJOR.MINOR or next>
*/

const release = /^v(\d+)\.(\d+)$/

/** Newest first, by number: v0.10 is newer than v0.9. */
function newestFirst(a: string, b: string) {
  const [, aMajor, aMinor] = release.exec(a)!
  const [, bMajor, bMinor] = release.exec(b)!
  return Number(bMajor) - Number(aMajor) || Number(bMinor) - Number(aMinor)
}

const redirect = (to: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Documentation</title>
    <meta http-equiv="refresh" content="0; url=${to}/" />
    <link rel="canonical" href="${to}/" />
    <script>
      location.replace('${to}/' + location.search + location.hash)
    </script>
  </head>
  <body>
    <a href="${to}/">Open the documentation</a>
  </body>
</html>
`

export function collect(pages: string, built: string, folder: string) {
  if (folder !== 'next' && !release.test(folder))
    throw new Error(`"${folder}" is no version folder: write vMAJOR.MINOR or next.`)
  const target = join(pages, folder)
  rmSync(target, { recursive: true, force: true })
  cpSync(built, target, { recursive: true })

  const folders = readdirSync(pages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  const releases = folders.filter((name) => release.test(name)).sort(newestFirst)
  const latest = releases[0] ?? 'next'
  const versions = [...releases, ...(folders.includes('next') ? ['next'] : [])]
  writeFileSync(join(pages, 'versions.json'), `${JSON.stringify({ latest, versions }, null, 2)}\n`)
  writeFileSync(join(pages, 'index.html'), redirect(latest))
  // A wrong address anywhere on the host opens the newest version's own page for it.
  if (existsSync(join(pages, latest, '404.html')))
    cpSync(join(pages, latest, '404.html'), join(pages, '404.html'))
  // Without this GitHub Pages runs Jekyll, which leaves out folders that start with _.
  writeFileSync(join(pages, '.nojekyll'), '')
}

if (import.meta.main) {
  const [pages, built, folder] = process.argv.slice(2)
  if (!pages || !built || !folder) throw new Error('collect <pages> <built> <folder>')
  collect(pages, built, folder)
}
