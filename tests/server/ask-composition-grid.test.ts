import { describe, expect, it } from 'vitest'
import type { Planner } from '../../src/domain/ask-route.ts'
import { askPlanCase, type PlanOutcome } from '../../src/server/modules/answer/plan-cases.ts'

/*
  The composition grid (docs/evaluations.md): each read, by each part a question can add to it, by
  who asks. The invariant needs no expected answer: every named part is honoured, or said to be
  left out, never silently dropped. A true answer to a smaller question with no word that it is
  smaller is the failure this catches. The cells still silent are listed: a new one fails here,
  and so does one that is listed and no longer silent, so the list only shrinks. Step 3 of the
  plan (one typed query with a capability table) is what takes it to none.

  "Honoured" means the line that says how the question was read names the part: it does not prove
  the rows are right. That is the differential tests' job.
*/

type Raw = Record<string, unknown>
type Read = { name: string; question: string; plan: (part: Part) => Raw }
type Part = {
  name: string
  words: string
  /** What the read's line says when the part is honoured. */
  named: RegExp
  /** The plan's field for it, where the shape has one. */
  domain?: string
  metric?: string
  of?: string
  period?: string
  kinds?: string[]
  values?: string[]
  metrics?: string[]
}

const parts: Part[] = [
  { name: 'domain', words: 'in Marketing', named: /Marketing/, domain: 'area_marketing' },
  {
    name: 'market',
    words: 'about Norway',
    named: /Norway/,
    values: ['val:market/norway'],
  },
  {
    name: 'metric',
    words: 'about Returns',
    named: /Returns/,
    metric: 'metric:returns',
    metrics: ['metric:returns'],
  },
  {
    name: 'kind',
    words: 'among the guides',
    named: /[Gg]uides?/,
    of: 'guide',
    kinds: ['guide'],
  },
  { name: 'period', words: 'in August 2026', named: /August|Aug 2026/, period: 'in August 2026' },
  {
    name: 'two domains',
    words: 'in Sales and Marketing',
    named: /Sales.*Marketing|Marketing.*Sales/,
  },
]

const records =
  (intent: string) =>
  (p: Part): Raw => ({
    records: {
      intent,
      ...(p.domain ? { domain: p.domain } : {}),
      ...(p.metric ? { metric: p.metric } : {}),
      ...(p.of ? { of: p.of } : {}),
      ...(p.period ? { period: p.period } : {}),
    },
  })
const audit =
  (facet: string) =>
  (p: Part): Raw => ({
    audit: {
      facets: [facet],
      ...(p.domain ? { domain: p.domain } : {}),
      ...(p.of ? { of: p.of } : {}),
      ...(p.values ? { value: p.values[0] } : {}),
    },
  })
const explore =
  () =>
  (p: Part): Raw => ({
    reads: [
      {
        kind: 'explore',
        kinds: p.kinds ?? [],
        values: p.values ?? [],
        metrics: p.metrics ?? [],
        dates: p.period ?? null,
      },
    ],
  })
const lookup =
  () =>
  (p: Part): Raw => ({
    reads: [
      {
        kind: 'lookup',
        metrics: p.metrics ?? ['metric:orders'],
        values: p.values ?? [],
        dates: p.period ?? null,
      },
    ],
  })

const reads: Read[] = [
  { name: 'records created', question: 'what was added', plan: records('created') },
  { name: 'records changed', question: 'what was changed', plan: records('changed') },
  { name: 'records archived', question: 'what was archived', plan: records('archived') },
  { name: 'records due', question: 'what is due for a check', plan: records('due') },
  { name: 'records owner', question: 'who owns this', plan: records('owner') },
  { name: 'records count', question: 'how many items are there', plan: records('count') },
  { name: 'records conflicts', question: 'which items conflict', plan: records('conflicts') },
  { name: 'audit no_context', question: 'what has no context', plan: audit('no_context') },
  { name: 'audit no_words', question: 'what has no words', plan: audit('no_words') },
  { name: 'audit no_domain', question: 'what has no domain', plan: audit('no_domain') },
  {
    name: 'audit source_changed',
    question: 'what moved at the source',
    plan: audit('source_changed'),
  },
  {
    name: 'audit asked_nothing',
    question: 'what found nothing',
    plan: audit('asked_nothing'),
  },
  { name: 'audit asked_most', question: 'what was asked most', plan: audit('asked_most') },
  { name: 'audit due', question: 'what needs a check first', plan: audit('due') },
  { name: 'audit conflicts', question: 'what disagrees', plan: audit('conflicts') },
  { name: 'audit duplicates', question: 'what is written twice', plan: audit('duplicates') },
  { name: 'audit review', question: 'how healthy is the context', plan: audit('review') },
  { name: 'reads explore', question: 'what is written', plan: explore() },
  { name: 'reads lookup', question: 'what do we know', plan: lookup() },
]

const people = ['Jon Abara', 'Tomas Eriksen', 'Maria Lindqvist']

/** What says a part was left out: said in words, under the answer or in its reading. */
const SAID =
  /Not answered here|stands today|keep no count by date|does not narrow|every domain|whole workspace/i

/** The line that says how the question was read, or the sentence that leads the answer. */
function readLine(got: PlanOutcome): string {
  const { routed } = got
  if (routed.kind === 'reads') return routed.planned.reading.words
  if (routed.kind === 'records') return got.rendered.split('\n').slice(0, 3).join(' ')
  return got.rendered
}

const askCell = async (read: Read, part: Part, person: string) => {
  const planner: Planner = (_input, check) => {
    const checked = check(read.plan(part))
    return Promise.resolve(checked.ok ? checked.plan : 'missed')
  }
  const got = await askPlanCase(
    { question: `follow that: ${read.question} ${part.words}?`, as: person },
    planner,
    [],
  )
  const line = readLine(got)
  return part.named.test(line) ? 'honoured' : SAID.test(got.rendered) ? 'said' : 'silent'
}

/** Silent today, by read and part: the same for every person, so listed once. */
const silentToday: readonly string[] = [
  'audit asked_most | kind',
  'audit asked_nothing | kind',
  'audit asked_nothing | market',
  'audit conflicts | kind',
  'audit due | kind',
  'audit due | market',
  'audit duplicates | kind',
  'audit duplicates | market',
  'audit no_context | market',
  'audit no_domain | kind',
  'audit no_domain | market',
  'audit no_words | kind',
  'audit no_words | market',
  'audit review | kind',
  'audit review | market',
  'audit source_changed | kind',
  'audit source_changed | market',
  'reads lookup | kind',
  'records conflicts | kind',
]

describe('the composition grid', async () => {
  const cells = await Promise.all(
    reads.flatMap((read) =>
      parts.flatMap((part) =>
        people.map(async (person) => ({
          cell: `${read.name} | ${part.name}`,
          person,
          got: await askCell(read, part, person),
        })),
      ),
    ),
  )
  const silent = [...new Set(cells.filter((c) => c.got === 'silent').map((c) => c.cell))].sort()

  it('covers every read by every part by every person', () => {
    expect(cells).toHaveLength(reads.length * parts.length * people.length)
  })

  it('drops no named part silently, past the cells still listed', () => {
    expect(silent).toEqual([...silentToday].sort())
  })

  it('reads the same for every person: who asks changes the counts, not what a part does', () => {
    for (const cell of new Set(cells.map((c) => c.cell)))
      expect(new Set(cells.filter((c) => c.cell === cell).map((c) => c.got)).size, cell).toBe(1)
  })
})
