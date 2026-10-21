import type { HelpLibrary } from './library.ts'
import { productName } from '../../brand.ts'

/**
 * search_help (FR-348, FR-715): the sections of Heed's help pages that best match a question's
 * words, for the assistant and for agents over MCP, so "what is an MCP?" gets the same page, and
 * the same link, as in the Docs area. Each result names its page, its heading, its words and
 * where it opens, and the day the page was last checked against the app. The words are Heed's
 * own help, which the reader answers from and links; like every tool result, they are data, never
 * instructions. Nothing here calls a model or keeps the question.
 */

/** The most characters of one section a result gives; the page has the rest. */
export const HELP_TEXT_MAX = 1500
/** How many sections a result gives, and how many of them may come from one page. */
export const HELP_RESULTS = 3
const PER_PAGE = 2

/** A section's words, cut at a line before the limit when they are longer. */
function cut(text: string): string {
  if (text.length <= HELP_TEXT_MAX) return text
  const end = text.lastIndexOf('\n', HELP_TEXT_MAX)
  return `${text.slice(0, end > HELP_TEXT_MAX / 2 ? end : HELP_TEXT_MAX).trimEnd()}\n\nThe rest is on the page.`
}

const list = (names: readonly string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/**
 * What search_help returns for a question's words. `web` is the web app's address, for an agent
 * outside it: each link is then the whole address. Without it, links are the app's paths.
 */
export function helpAnswer(
  help: HelpLibrary,
  query: string,
  web: string | null = null,
): Record<string, unknown> {
  const at = (path: string) => (web ? `${web}${path}` : path)
  // A link in the words to a page of the app opens on the web app too.
  const linked = (text: string) => (web ? text.replace(/\]\(\//g, `](${web}/`) : text)
  const hits = help.index.search(query, { limit: HELP_RESULTS, perPage: PER_PAGE })
  if (!hits.length)
    return {
      say: `No help page matched these words. ${productName}'s help pages say how ${productName} works, not what is in company data: for that, call get_facts.`,
      status: 'no_match',
      pages: help.pages.map((page) => ({
        page: page.title,
        summary: page.summary,
        url: at(page.path),
      })),
    }
  const titles = [...new Set(hits.map((hit) => hit.page.title))]
  return {
    say: `From ${productName}'s help pages: ${list(titles)}. Answer from these sections and link the page you use.`,
    status: 'matched',
    results: hits.map(({ page, section }) => ({
      page: page.title,
      section: section.heading || null,
      text: linked(cut(section.text)),
      url: at(section.id ? `${page.path}#${section.id}` : page.path),
      checked: page.reviewed,
    })),
  }
}
