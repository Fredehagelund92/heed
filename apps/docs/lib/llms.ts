import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHANGELOG, llmsFullTxt, llmsTxt } from '../../../src/domain/docs.ts'
import { linkContext, withResolvedLinks } from './links.ts'
import { repoRoot, sitePages } from './pages.ts'
import { basePath, type Settings } from './settings.ts'

/*
  llms.txt and llms-full.txt, from the functions that write the app's, over every page of the
  site. Each version has its own, so an agent reads the pages of the version it was pointed at.
*/

export function llmsFiles(settings: Settings) {
  const pages = sitePages()
  const base = `${settings.site}${basePath(settings)}`
  const context = linkContext(pages, base, settings.ref)
  const files = pages.map(({ slug, file }) => ({
    slug,
    source: withResolvedLinks(readFileSync(join(repoRoot, file), 'utf8'), file, context),
  }))
  const changelog = pages.find((page) => page.slug === CHANGELOG)!
  const index = { pages: pages.filter((page) => page.group), changelog }
  return {
    index: llmsTxt(index, base, (at, slug) => `${at}/${slug}/`),
    full: llmsFullTxt(index, files, base),
  }
}
