import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { sitePages, type SitePage } from '../lib/pages.ts'
import { basePath, readSettings } from '../lib/settings.ts'

/*
  The last step of `npm run build`, on the pages as they were built: every link and every heading a
  link names goes somewhere, nothing loads from another host, the page body holds no tag that came
  through as raw HTML, and every page is there and in llms.txt. It reads only the built files, so an
  upgrade of the framework cannot change what it checks.
*/

const htmlFiles = (folder: string): string[] =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return htmlFiles(path)
    return entry.name.endsWith('.html') ? [path] : []
  })

const isExternal = (url: string) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)

/** The file an address opens, or undefined when nothing is there. */
function fileOf(dist: string, path: string): string | undefined {
  const file = join(dist, path)
  if (existsSync(file) && statSync(file).isFile()) return file
  const index = join(file, 'index.html')
  return existsSync(index) ? index : undefined
}

export function checkSite(dist: string, base: string, pages: readonly SitePage[]): string[] {
  const problems: string[] = []
  const ids = new Map<string, Set<string>>()
  const idsOf = (file: string) => {
    if (!ids.has(file)) {
      const html = readFileSync(file, 'utf8')
      ids.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!)))
    }
    return ids.get(file)!
  }

  for (const file of htmlFiles(dist)) {
    const page = relative(dist, file)
    const html = readFileSync(file, 'utf8')
    const links = [...html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)].map((match) => match[1]!)
    for (const link of links) {
      if (isExternal(link)) continue
      const [address = '', hash] = link.split('#')
      let target: string | undefined = file
      if (address) {
        if (address !== base && !address.startsWith(`${base}/`)) {
          problems.push(`${page}: "${link}" is outside the site's path, ${base || '/'}`)
          continue
        }
        target = fileOf(dist, decodeURI(address.slice(base.length).split('?')[0]!))
      }
      if (!target) problems.push(`${page}: "${link}" opens nothing`)
      else if (hash && !idsOf(target).has(decodeURIComponent(hash)))
        problems.push(`${page}: "${link}" names no heading there`)
    }
    const loads = html.matchAll(
      /<(?:script|img|iframe)\b[^>]*?\ssrc="([^"]+)"|<link\b(?=[^>]*\srel="(?:stylesheet|preload|icon)")[^>]*?\shref="([^"]+)"/g,
    )
    for (const load of loads) {
      const url = load[1] ?? load[2]!
      if (isExternal(url) && !url.startsWith('data:'))
        problems.push(`${page}: loads ${url} from another host`)
    }
    const body = html.indexOf('sl-markdown-content')
    if (body !== -1 && /<title\b/.test(html.slice(body)))
      problems.push(
        `${page}: a <title> tag reached the page's body: a line of the page starts with it`,
      )
  }

  const index = join(dist, 'llms.txt')
  const listed = existsSync(index) ? readFileSync(index, 'utf8') : ''
  if (!listed) problems.push('no llms.txt')
  if (!existsSync(join(dist, 'llms-full.txt'))) problems.push('no llms-full.txt')
  if (!existsSync(join(dist, 'pagefind/pagefind.js'))) problems.push('no search index')
  for (const { slug, title } of pages) {
    if (!fileOf(dist, slug)) problems.push(`${slug}: the page was not built`)
    if (!listed.includes(`/${slug}/`)) problems.push(`${slug}: llms.txt does not list ${title}`)
  }
  return problems
}

if (import.meta.main) {
  const pages = sitePages()
  const problems = checkSite('dist', basePath(readSettings(process.env)), pages)
  for (const problem of problems) console.error(problem)
  if (problems.length) {
    console.error(`The docs site has ${problems.length} problems.`)
    process.exit(1)
  }
  console.log(`The docs site: ${pages.length} pages, every link goes somewhere.`)
}
