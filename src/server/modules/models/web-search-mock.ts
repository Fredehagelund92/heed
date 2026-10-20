import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'

/**
 * The scripted web search (MODELS=mock): it answers every search with the same three results for
 * the words asked, one of them on an official host, as a vendor's search tool returns them: a
 * call the provider ran itself and its result. It reaches no network and costs nothing. It exists
 * to test search_web's harness (the switch, the caps, the ledger, the order of the results).
 */

const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'search'

/** The words a search was asked for: the person's message of the search call. */
function queryOf(options: LanguageModelV4CallOptions): string {
  const user = options.prompt.findLast((message) => message.role === 'user')
  return (user?.content ?? [])
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join(' ')
    .trim()
}

function search(options: LanguageModelV4CallOptions): LanguageModelV4GenerateResult {
  const query = queryOf(options)
  const words = slug(query)
  const results = [
    {
      type: 'web_search_result',
      url: `https://news.example.com/${words}`,
      title: `News about ${query}`.slice(0, 200),
      pageAge: '2 days ago',
      encryptedContent: '',
    },
    {
      type: 'web_search_result',
      url: `https://www.example.gov/acts/${words}`,
      title: `Official text: ${query}`.slice(0, 200),
      pageAge: '3 days ago',
      encryptedContent: '',
    },
    {
      type: 'web_search_result',
      url: `https://blog.example.org/${words}`,
      title: `A commentary on ${query}`.slice(0, 200),
      pageAge: null,
      encryptedContent: '',
    },
  ]
  const toolCallId = 'srvtoolu_scripted'
  return {
    content: [
      {
        type: 'tool-call',
        toolCallId,
        toolName: 'web_search',
        input: JSON.stringify({ query }),
        providerExecuted: true,
      },
      { type: 'tool-result', toolCallId, toolName: 'web_search', result: results },
      { type: 'text', text: 'done' },
    ],
    finishReason: { unified: 'stop', raw: 'end_turn' },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  }
}

export const scriptedSearchModel = () =>
  new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'scripted-search',
    doGenerate: (options) => Promise.resolve(search(options)),
  })
