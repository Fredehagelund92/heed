import { randomUUID } from 'node:crypto'
import {
  Client,
  StreamableHTTPClientTransport,
  type ElicitRequestFormParams,
  type ElicitResult,
  type FetchLike,
} from '@modelcontextprotocol/client'
import { describe, expect, it, vi } from 'vitest'
import { people } from './fixtures.ts'
import { signInHarness } from './sign-in-harness.ts'

/*
  draft_context's second slice (FR-121) end to end on PostgreSQL: when the person's agent can
  show forms (MCP 2026-07-28, multi round-trip elicitation), the open questions are asked there
  before anything is saved, and the draft is saved once with the answers marked confirmed; the
  person still submits it in Heed. An app that cannot show forms, whatever its family, gets the
  draft link and the question list, as before. A request state that was changed, belongs to
  another person or call, was used already or came back too late saves nothing.
*/

const harness = await signInHarness()
const { admin, resource, registered, signInFlow, exchange, browser } = harness

const text =
  'Orders in every market are booked in their own currency and turned into euros at the rate of the day.'
// The agent says event; the words read as a note. No date and no source: three questions.
const call = {
  name: 'draft_context',
  arguments: { text, kind: 'event', scope: { metrics: ['Orders'] } },
}
const answers = {
  kind: 'note',
  first_day: '2026-09-01',
  source_link: 'https://wiki.example/finance/orders-currency',
  source_quote: 'Every order is converted to euros at the rate of the day.',
}

// One agent, registered once: each test signs a person in to it again.
let app: Promise<string> | undefined
async function personToken(person = 'author') {
  const clientId = await (app ??= registered())
  const flow = await signInFlow(clientId, { person, scope: 'read feedback propose' })
  const exchanged = await exchange(clientId, flow.code!, flow.verifier)
  expect(exchanged.status).toBe(200)
  return exchanged.body.access_token!
}

type Family = {
  /** `modern`: protocol 2026-07-28 through server/discover; `legacy`: the 2025 handshake. */
  era: 'modern' | 'legacy'
  elicitation?: { form?: Record<string, never>; url?: Record<string, never> }
  /** What the person does with the form, when the app shows one. */
  answer?: (params: ElicitRequestFormParams) => ElicitResult | Promise<ElicitResult>
  /** The app's own fetch: a malicious or broken app can change what it sends back. */
  fetch?: FetchLike
}
async function agent(token: string, family: Family) {
  const wire = new Client(
    { name: 'draft-questions', version: '1.0.0' },
    {
      versionNegotiation: { mode: family.era === 'modern' ? 'auto' : 'legacy' },
      capabilities: family.elicitation ? { elicitation: family.elicitation } : {},
    },
  )
  if (family.answer) {
    const answer = family.answer
    wire.setRequestHandler('elicitation/create', (request) =>
      Promise.resolve(answer(request.params as ElicitRequestFormParams)),
    )
  }
  await wire.connect(
    new StreamableHTTPClientTransport(new URL(resource), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      ...(family.fetch ? { fetch: family.fetch } : {}),
    }),
  )
  return wire
}

type Output = {
  status: string
  saved: boolean
  reason?: string
  draft_id: string
  answered?: string[]
  questions: { field: string; question: string; options?: string[] }[]
  fields: Record<string, { mark: string; value: unknown }>
}
async function draftWith(
  token: string,
  family: Family,
  args: Record<string, unknown> = call.arguments,
) {
  const wire = await agent(token, family)
  try {
    const reply = await wire.callTool({ name: call.name, arguments: args })
    return { reply, out: reply.structuredContent as Output }
  } finally {
    await wire.close()
  }
}
const agentDrafts = async () =>
  (
    await admin.query<{ id: string; state: string; answers_round: string | null }>(
      "select id,state,answers_round from proposals where channel='mcp' order by created_at",
    )
  ).rows

/** A fetch that changes the body of the retry that carries the answers, before it is sent. */
function changingRetry(change: (body: Record<string, unknown>, headers: Headers) => void) {
  const fetcher: FetchLike = async (url, init) => {
    if (typeof init?.body === 'string') {
      const body = JSON.parse(init.body) as Record<string, unknown> & {
        params?: Record<string, unknown>
      }
      if (body.method === 'tools/call' && body.params?.requestState !== undefined) {
        const headers = new Headers(init.headers)
        change(body, headers)
        return fetch(url, { ...init, headers, body: JSON.stringify(body) })
      }
    }
    return fetch(url, init)
  }
  return fetcher
}

/** The tool result in an MCP response, sent as JSON or as one server-sent event. */
async function resultOf(response: Response) {
  const raw = await response.text()
  const data = raw.includes('data: ')
    ? raw
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('')
    : raw
  return (JSON.parse(data) as { result: { isError?: boolean; structuredContent: Output } }).result
}

describe('the open questions, asked in the agent of a person who can answer them there', () => {
  it('asks once, saves once with the answers confirmed, and the person still submits in Heed', async () => {
    await admin.query("update tool_config set enabled=true where tool='draft_context'")
    const asked: ElicitRequestFormParams[] = []
    const token = await personToken()
    const { reply, out } = await draftWith(token, {
      era: 'modern',
      elicitation: { form: {} },
      answer: (params) => {
        asked.push(params)
        return { action: 'accept', content: answers }
      },
    })
    expect(reply.isError).not.toBe(true)
    // One form, its fields flat primitives, no link to click (the spec's SHOULD NOT).
    expect(asked).toHaveLength(1)
    expect(Object.keys(asked[0]!.requestedSchema.properties)).toEqual([
      'kind',
      'first_day',
      'source_link',
      'source_quote',
    ])
    expect(asked[0]!.message).toMatch(/^3 questions come before this draft is saved for you\./)
    expect(asked[0]!.message).toContain('Nothing is sent')
    expect(asked[0]!.message).not.toMatch(/https?:/)
    expect(out).toMatchObject({
      status: 'draft_saved',
      saved: true,
      submitted: false,
      answered: ['kind', 'start', 'evidence'],
      questions: [],
    })
    expect(out.fields).toMatchObject({
      kind: { mark: 'confirmed', value: 'note' },
      validity: { mark: 'confirmed', value: { start: '2026-09-01', end: null } },
      evidence: {
        mark: 'confirmed',
        value: [
          {
            url: answers.source_link,
            quote: answers.source_quote,
            date: harness.now().toISOString().slice(0, 10),
          },
        ],
      },
      summary: { mark: 'prefilled' },
      areaId: { mark: 'derived', value: 'Finance' },
      riskLevel: { mark: 'default' },
    })
    const saved = await agentDrafts()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ id: out.draft_id, state: 'draft' })
    expect(saved[0]!.answers_round).toMatch(/^[0-9a-f-]{36}$/)

    // The person opens it in Heed, sees what they confirmed, and submits it themselves.
    const author = browser()
    await author.signIn('author')
    const draft = (await (await author.api(`/proposals/${out.draft_id}`)).json()) as {
      revision: number
      proposerId: string
      provenance: { fields: Record<string, string> }
    }
    expect(draft.proposerId).toBe(people.author)
    expect(draft.provenance.fields).toMatchObject({
      kind: 'confirmed',
      validity: 'confirmed',
      evidence: 'confirmed',
      summary: 'prefilled',
    })
    const submitted = await author.api(
      `/proposals/${out.draft_id}/submit`,
      { revision: draft.revision },
      { 'idempotency-key': randomUUID() },
    )
    expect(submitted.status).toBe(200)
    const owner = browser()
    await owner.signIn('owner')
    const review = (await (await owner.api(`/proposals/${out.draft_id}/review`)).json()) as {
      provenance: { fields: Record<string, string> }
    }
    expect(review.provenance.fields).toMatchObject({ kind: 'confirmed', evidence: 'confirmed' })
  })

  it('saves the draft as before when the person declines, to finish it in Heed', async () => {
    const { out } = await draftWith(await personToken(), {
      era: 'modern',
      elicitation: {},
      answer: () => ({ action: 'decline' }),
    })
    expect(out).toMatchObject({ status: 'draft_saved', answered: [] })
    expect(out.fields.kind?.mark).toBe('prefilled')
    expect(out.questions.map((q) => q.field)).toEqual(['kind', 'validity', 'evidence'])
  })

  it('keeps a question open when its answer is not one of the choices or not a link', async () => {
    const { out } = await draftWith(await personToken(), {
      era: 'modern',
      elicitation: { form: {} },
      answer: () => ({
        action: 'accept',
        content: { ...answers, kind: 'rumour', source_link: 'javascript:alert(1)' },
      }),
    })
    expect(out.answered).toEqual(['start'])
    expect(out.fields).toMatchObject({
      kind: { mark: 'prefilled', value: 'event' },
      validity: { mark: 'confirmed' },
    })
    expect(out.fields.evidence).toBeUndefined()
    expect(out.questions.map((q) => q.field)).toEqual(['kind', 'evidence'])
  })
})

describe('an agent that cannot show forms gets the draft link and the questions, as before', () => {
  const families: [string, Family][] = [
    ['a 2026-07-28 app without elicitation (Claude.ai, ChatGPT)', { era: 'modern' }],
    [
      'a 2025 app that declares elicitation (an older VS Code or Cursor)',
      { era: 'legacy', elicitation: { form: {} }, answer: () => ({ action: 'cancel' }) },
    ],
    [
      'a 2026-07-28 app that shows only links (URL elicitation)',
      { era: 'modern', elicitation: { url: {} }, answer: () => ({ action: 'cancel' }) },
    ],
  ]
  for (const [label, family] of families)
    it(label, async () => {
      const shown = vi.fn()
      const { reply, out } = await draftWith(await personToken(), {
        ...family,
        ...(family.answer
          ? {
              answer: (params) => {
                shown(params)
                return family.answer!(params)
              },
            }
          : {}),
      })
      expect(shown).not.toHaveBeenCalled()
      expect(reply.isError).not.toBe(true)
      expect(out.status).toBe('draft_saved')
      expect(out).not.toHaveProperty('answered')
      expect(out.questions).toEqual([
        {
          field: 'kind',
          question: expect.stringMatching(/^Is this an event or a note\?/) as string,
          options: ['event', 'note'],
        },
        {
          field: 'validity',
          question: 'From which day does it apply?',
          options: [expect.any(String) as string],
        },
        {
          field: 'evidence',
          question: 'Where does this come from? A link and one sentence from it.',
        },
      ])
      expect(out.fields.kind?.mark).toBe('prefilled')
    })
})

describe('a request state that is not this round of this call, for this person, saves nothing', () => {
  const refused = async (family: Partial<Family>, reason: string) => {
    const before = (await agentDrafts()).length
    const { reply, out } = await draftWith(await personToken(), {
      era: 'modern',
      elicitation: { form: {} },
      answer: () => ({ action: 'accept', content: answers }),
      ...family,
    })
    expect(reply.isError).toBe(true)
    expect(out).toMatchObject({ status: 'refused', saved: false, reason })
    expect(await agentDrafts()).toHaveLength(before)
  }
  it('refuses a state that was changed on the way', async () => {
    await refused(
      {
        fetch: changingRetry((body) => {
          const params = body.params as { requestState: string }
          const at = Math.floor(params.requestState.length / 2)
          const swap = params.requestState[at] === 'A' ? 'B' : 'A'
          params.requestState = `${params.requestState.slice(0, at)}${swap}${params.requestState.slice(at + 1)}`
        }),
      },
      'request_state_invalid',
    )
  })
  it("refuses a state another person's app sends", async () => {
    const stranger = await personToken('stranger')
    await refused(
      {
        fetch: changingRetry((_body, headers) => {
          headers.set('authorization', `Bearer ${stranger}`)
        }),
      },
      'request_state_invalid',
    )
  })
  it('refuses a state sent with another call', async () => {
    await refused(
      {
        fetch: changingRetry((body) => {
          const params = body.params as { arguments: { text: string } }
          params.arguments.text = `${params.arguments.text} Also returns.`
        }),
      },
      'request_state_invalid',
    )
  })
  it('refuses answers sent again after they saved a draft', async () => {
    const token = await personToken()
    let sent: { url: string; headers: Headers; body: Record<string, unknown> } | undefined
    const { out } = await draftWith(token, {
      era: 'modern',
      elicitation: { form: {} },
      answer: () => ({ action: 'accept', content: answers }),
      fetch: changingRetry((body, headers) => {
        sent = { url: resource, headers, body: structuredClone(body) }
      }),
    })
    expect(out.status).toBe('draft_saved')
    const before = await agentDrafts()
    const again = await fetch(sent!.url, {
      method: 'POST',
      headers: sent!.headers,
      body: JSON.stringify({ ...sent!.body, id: 'replayed' }),
    })
    expect(again.status).toBe(200)
    const result = await resultOf(again)
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({
      status: 'refused',
      saved: false,
      reason: 'request_state_used',
    })
    expect(await agentDrafts()).toEqual(before)
  })
  it('refuses answers that come back after the questions expired', async () => {
    // The person takes eleven minutes; their app signs in again before it sends the answers.
    let fresh = ''
    await refused(
      {
        answer: async () => {
          harness.advance(11 * 60)
          fresh = await personToken()
          return { action: 'accept', content: answers }
        },
        fetch: changingRetry((_body, headers) => {
          headers.set('authorization', `Bearer ${fresh}`)
        }),
      },
      'request_state_expired',
    )
  })
})
