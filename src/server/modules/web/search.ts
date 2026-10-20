import { generateText } from 'ai'
import { textFindings } from '../../../domain/draft.ts'
import type { CallMeter, WebSearchRoute } from '../models/index.ts'
import { isOfficial } from './official.ts'

/*
  One web search for the assistant (search_web), through the model provider's own search tool:
  Heed asks a small model of the provider the assistant uses to run exactly one search for the
  words, and keeps only the results' titles and addresses, official sources first. The model's
  own words are dropped and the results' text, which the vendor keeps encrypted, is never shown:
  the assistant reads a result with read_source, so every quote comes from a page Heed opened.
  Search words leave the company, so words that look like internal figures, personal data or an
  item's id are refused before anything is sent.
*/

export type SearchResult = {
  url: string
  title: string
  /** How old the page is, in the search's words ("3 days ago"), when it says. */
  pageAge: string | null
  official: boolean
}

/** Why search words may not leave the company, or null when they may. */
export function searchWordsProblem(query: string): string | null {
  if (textFindings(query).length)
    return 'The words look like personal data or a secret, which must not leave the company.'
  if (/\bitm_[a-z0-9]{8,16}\b/i.test(query))
    return "The words hold an item's id, which must not leave the company."
  // A figure with a unit, such as 40%, $2.5m or 1,200 EUR, reads like a company number.
  if (
    /\d\s*(?:%|percent\b|pct\b)|[$€£]\s*\d|\d\s*(?:k|m|bn|usd|eur|gbp|brl|dkk|sek|nok)\b/i.test(
      query,
    )
  )
    return 'The words hold a figure, which may be an internal number and must not leave the company.'
  return null
}

const SEARCH_INSTRUCTIONS =
  'Search the web exactly once for the words the person gives, as they are. Prefer official sources: a government, a parliament, a regulator or a court publishing its own text. After the search, reply with the single word done.'

/** The results of a provider's search tool, as its result part holds them. */
function resultsOf(output: unknown): { url: string; title: string; pageAge: string | null }[] {
  if (!Array.isArray(output)) return []
  return output.flatMap((entry: unknown) => {
    const { url, title, pageAge } = (entry ?? {}) as Record<string, unknown>
    if (typeof url !== 'string' || !URL.canParse(url)) return []
    return [
      {
        url,
        title: typeof title === 'string' ? title.slice(0, 300) : url,
        pageAge: typeof pageAge === 'string' ? pageAge.slice(0, 40) : null,
      },
    ]
  })
}

/**
 * Runs one search on `route`, metered: the tokens go to the ledger through the meter, as any
 * call's do. Returns the results, official first, and how many searches the provider billed.
 */
export async function searchWeb(
  query: string,
  { route, meter, signal }: { route: WebSearchRoute; meter: CallMeter; signal?: AbortSignal },
): Promise<{ results: SearchResult[]; searches: number }> {
  const result = await generateText({
    model: meter.wrap(route, { role: 'assistant' }).model,
    system: SEARCH_INSTRUCTIONS,
    prompt: query,
    tools: route.tools,
    toolChoice: { type: 'tool', toolName: route.toolName },
    maxOutputTokens: 64,
    maxRetries: 0,
    providerOptions: route.options,
    ...(signal ? { abortSignal: signal } : {}),
  })
  const parts = result.steps.flatMap((step) => step.content)
  const found = parts.flatMap((part) =>
    part.type === 'tool-result' && part.toolName === route.toolName ? resultsOf(part.output) : [],
  )
  const reported = (
    result.providerMetadata?.anthropic?.usage as
      { server_tool_use?: { web_search_requests?: unknown } } | undefined
  )?.server_tool_use?.web_search_requests
  const calls = parts.filter(
    (part) => part.type === 'tool-call' && part.toolName === route.toolName,
  ).length
  const seen = new Set<string>()
  const results = found
    .filter((entry) => !seen.has(entry.url) && seen.add(entry.url))
    .map((entry) => ({ ...entry, official: isOfficial(entry.url) }))
  // Official sources first; otherwise the search's own order.
  results.sort((a, b) => Number(b.official) - Number(a.official))
  return { results, searches: typeof reported === 'number' ? reported : calls }
}
