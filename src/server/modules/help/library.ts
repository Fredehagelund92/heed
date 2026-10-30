import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { withProductNameIn } from '../../../domain/brand.ts'
import {
  helpIndex,
  helpSectionIds,
  helpSlugOf,
  readHelpPage,
  splitHelpPage,
  type HelpIndex,
  type HelpPage,
} from '../../../domain/help-pages.ts'
import { productName } from '../../brand.ts'

/**
 * Heed's help pages as the service reads them: the same files the Docs area draws
 * (docs/old-help/*.md), read from the repository once, when the service starts, through the page
 * model the app uses (domain/help-pages.ts). A page that cannot be read is left out and named in
 * `problems`, which the service logs. A page writes {{product}} where it names the product; the service's name
 * (src/server/brand.ts) goes in after parsing, as in the app.
 */
export type HelpLibrary = {
  pages: readonly HelpPage[]
  index: HelpIndex
  /** The pages left out, each with why. */
  problems: string[]
}

/** The folder of the pages in this checkout, worked out when the pages are read. */
export const helpFolderPath = () =>
  fileURLToPath(new URL('../../../../docs/old-help/', import.meta.url))

/** Reads every page of a folder of help pages (README.md is the folder's own page, not help). */
export function readHelpLibrary(folder = helpFolderPath()): HelpLibrary {
  const files = readdirSync(folder)
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .sort()
  const slugs = new Set(files.map(helpSlugOf))
  const problems: string[] = []
  const pages = files.flatMap((file) => {
    const split = splitHelpPage(readFileSync(join(folder, file), 'utf8'), parseYaml)
    const read = split.ok
      ? readHelpPage(
          helpSlugOf(file),
          withProductNameIn(split.data, productName),
          withProductNameIn(split.body, productName),
          slugs,
        )
      : split
    if (read.ok) return [read.page]
    problems.push(`${file}: ${read.reason}`)
    return []
  })
  // In the order of the docs' tree: by section, then by each page's order.
  const section = (page: HelpPage) => helpSectionIds.indexOf(page.section)
  pages.sort(
    (a, b) => section(a) - section(b) || a.order - b.order || a.title.localeCompare(b.title),
  )
  return { pages, index: helpIndex(pages, productName), problems }
}

let repository: HelpLibrary | null = null
/** The pages of this checkout, read on the first call and kept: they change only with a release. */
export function repositoryHelp(): HelpLibrary {
  repository ??= readHelpLibrary()
  return repository
}
