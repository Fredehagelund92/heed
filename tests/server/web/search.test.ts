import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { MockLanguageModelV4 } from 'ai/test'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createModelPort,
  ModelConfigError,
  modelProviders,
  type CallMeter,
  type ProviderEntry,
} from '../../../src/server/modules/models/index.ts'
import { isOfficial, searchWeb, searchWordsProblem } from '../../../src/server/modules/web/index.ts'

/*
  search_web's search: one search through the model provider's own search tool, which Heed reads
  back as titles and links, official sources first. The route was checked on 2026-10-15 against
  Vercel's gateway (its Messages API, the pilot's key): Anthropic's web search runs there and its
  results come back to Heed. Here the real Anthropic adapter talks to a fake Messages endpoint,
  so the tests prove what Heed sends (one search, served by the vendor only) and reads.
*/

/** A meter that meters nothing: these tests read no ledger. */
const unmetered = { wrap: (choice: unknown) => choice } as unknown as CallMeter

describe('the words a search may send', () => {
  it('lets public names, law numbers and dates through', () => {
    expect(searchWordsProblem('Directive 2011/83/EU direito de livre resolução')).toBeNull()
    expect(searchWordsProblem('EU right of withdrawal 14 days 25 September 2026')).toBeNull()
  })

  it('keeps internal figures, ids and personal data in the company', () => {
    expect(searchWordsProblem('our net sales in Norway fell 40 percent')).toMatch(/figure/)
    expect(searchWordsProblem('our net sales in Norway fell 40%')).toMatch(/figure/)
    expect(searchWordsProblem('revenue $2.5m Norway')).toMatch(/figure/)
    expect(searchWordsProblem('orders 1200 EUR')).toMatch(/figure/)
    expect(searchWordsProblem('itm_abcdef123456 Norway')).toMatch(/id/)
    expect(searchWordsProblem('contact jane.doe@example.com')).toMatch(/personal data/)
  })
})

describe('official sources', () => {
  it('are a government, a parliament or a court', () => {
    for (const address of [
      'https://www.example.gov.br/acts/x.htm',
      'https://www.example.leg.br/materias/x',
      'https://portal.example.jus.br/x',
      'https://www.example.gov.uk/x',
      'https://www.example.es/x',
      'https://www.example.gob.mx/x',
      'https://www.example.gouv.fr/x',
      'https://eur-lex.europa.eu/x',
      'https://www.example.gov/x',
    ])
      expect(isOfficial(address), address).toBe(address !== 'https://www.example.es/x')
    for (const address of ['https://news.example.com/x', 'https://gov.example.com/x', 'not a link'])
      expect(isOfficial(address), address).toBe(false)
  })
})

describe('a search on the scripted model', () => {
  it('returns titles and links, official sources first', async () => {
    const route = createModelPort({ mode: 'mock' }).webSearch('vercel-gateway', 1)!
    const found = await searchWeb('EU right of withdrawal 14 days', { route, meter: unmetered })
    expect(found.results.map((r) => [r.url, r.official])).toEqual([
      ['https://www.example.gov/acts/eu-right-of-withdrawal-14-days', true],
      ['https://news.example.com/eu-right-of-withdrawal-14-days', false],
      ['https://blog.example.org/eu-right-of-withdrawal-14-days', false],
    ])
    expect(found.searches).toBe(1)
  })

  it('stops when its signal fires, so a stalled provider does not hold the turn', async () => {
    const mock = createModelPort({ mode: 'mock' }).webSearch('vercel-gateway', 1)!
    const stalled = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) =>
        new Promise((_, reject) => {
          abortSignal?.addEventListener('abort', () =>
            reject(
              abortSignal.reason instanceof Error
                ? abortSignal.reason
                : new Error(String(abortSignal.reason)),
            ),
          )
        }),
    })
    const route = { ...mock, model: stalled }
    const found = searchWeb('EU right of withdrawal 14 days', {
      route,
      meter: unmetered,
      signal: AbortSignal.timeout(50),
    })
    await expect(found).rejects.toThrow()
  })
})

describe('the search route in the provider registry', () => {
  it('is Anthropic web search through the gateway, on Haiku 5.5, at USD 10 per 1,000', () => {
    const port = createModelPort({ mode: 'live', env: { VERCEL_AI_GATEWAY_API_KEY: 'test' } })
    const route = port.webSearch('vercel-gateway', 1)!
    expect(route).toMatchObject({
      id: 'vercel-gateway/anthropic/claude-haiku-5.5',
      provider: 'vercel-gateway',
      vendor: 'anthropic',
      toolName: 'web_search',
      searchMicros: 10_000,
    })
    expect(port.webSearch('nowhere', 1)).toBeNull()
  })

  it('refuses an entry whose search adapter cannot search or whose model it does not list', () => {
    const gateway = modelProviders.find((p) => p.name === 'vercel-gateway')!
    const entry = (webSearch: ProviderEntry['webSearch']): ProviderEntry => ({
      ...gateway,
      name: 'second',
      webSearch,
    })
    expect(() =>
      createModelPort({
        mode: 'live',
        providers: [
          entry({
            adapter: 'openai-compatible',
            searchModel: 'anthropic/claude-haiku-5.5',
            perThousand: 10,
          }),
        ],
      }),
    ).toThrow(ModelConfigError)
    expect(() =>
      createModelPort({
        mode: 'live',
        providers: [
          entry({ adapter: 'anthropic', searchModel: 'anthropic/unlisted', perThousand: 10 }),
        ],
      }),
    ).toThrow(/does not list/)
  })
})

describe('a search through the Anthropic adapter', () => {
  /** The model the gateway names in its answer, and Heed in its request. */
  const served = 'anthropic/claude-haiku-5.5'
  let server: Server
  let base = ''
  const bodies: Record<string, unknown>[] = []

  beforeAll(async () => {
    server = createServer((request, response) => {
      let raw = ''
      request.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')))
      request.on('end', () => {
        bodies.push(JSON.parse(raw) as Record<string, unknown>)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: served,
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: {
              input_tokens: 21_000,
              output_tokens: 5,
              server_tool_use: { web_search_requests: 1 },
            },
            content: [
              {
                type: 'server_tool_use',
                id: 'srvtoolu_1',
                name: 'web_search',
                input: { query: 'EU right of withdrawal 14 days' },
              },
              {
                type: 'web_search_tool_result',
                tool_use_id: 'srvtoolu_1',
                content: [
                  {
                    type: 'web_search_result',
                    url: 'https://news.example.com/eu-returns-rules/',
                    title: 'What the 14-day return rule means for online shops',
                    page_age: '17 days ago',
                    encrypted_content: 'opaque',
                  },
                  {
                    type: 'web_search_result',
                    url: 'https://www.example.gov/acts/right-of-withdrawal',
                    title: 'Right of withdrawal for online purchases - Official text',
                    page_age: '13 days ago',
                    encrypted_content: 'opaque',
                  },
                  {
                    type: 'web_search_result',
                    url: 'https://news.example.com/eu-returns-rules/',
                    title: 'The same page twice',
                    page_age: null,
                    encrypted_content: 'opaque',
                  },
                ],
              },
              { type: 'text', text: 'done' },
            ],
          }),
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  })
  afterAll(() => new Promise((resolve) => server.close(resolve)))

  it('sends one forced search, served by the vendor only, and reads back the links', async () => {
    const port = createModelPort({
      mode: 'live',
      env: { VERCEL_AI_GATEWAY_API_KEY: 'test-key', VERCEL_AI_GATEWAY_BASE_URL: base },
    })
    const route = port.webSearch('vercel-gateway', 1)!
    const found = await searchWeb('EU right of withdrawal 14 days', { route, meter: unmetered })
    expect(found).toEqual({
      results: [
        {
          url: 'https://www.example.gov/acts/right-of-withdrawal',
          title: 'Right of withdrawal for online purchases - Official text',
          pageAge: '13 days ago',
          official: true,
        },
        {
          url: 'https://news.example.com/eu-returns-rules/',
          title: 'What the 14-day return rule means for online shops',
          pageAge: '17 days ago',
          official: false,
        },
      ],
      searches: 1,
    })
    const [body] = bodies
    expect(body).toMatchObject({
      model: served,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
      tool_choice: { type: 'tool', name: 'web_search' },
      providerOptions: { gateway: { only: ['anthropic'] } },
    })
    // The search words, and nothing else of the conversation.
    expect(JSON.stringify(body!.messages)).toBe(
      JSON.stringify([
        { role: 'user', content: [{ type: 'text', text: 'EU right of withdrawal 14 days' }] },
      ]),
    )
  })
})
