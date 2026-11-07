import { describe, expect, it } from 'vitest'
import { domains, people } from '@/api/mock/data/world'
import type { HeedApi } from '@/api/client'
import type { ObsData } from '@/model/observability'
import type { RecordsFound } from '../../../src/domain/records-answer.ts'
import { devPeople } from '../http/demo-week.ts'
import { askWorld } from './ask-world.ts'

/*
  Ask's differential tests (docs/evaluations.md): on the demo week, through the real service, for
  each person, every count Ask states must be the number the page it comes from shows that person:
  Definitions, Context's filters, the Inbox and Observability. A count Ask keeps by a path of its
  own fails here, whoever asks. The questions are read by the rules or the scripted planner: what
  is compared is the count, not how the question was read.
*/

const world = askWorld()

const records = async (api: HeedApi, question: string): Promise<RecordsFound> => {
  const { records: found } = await api.ask({ question })
  if (!found || found.refused) throw new Error(`"${question}" was not answered from the records`)
  return found
}
const persons = devPeople()
  .map((p) => p.name)
  .filter((name) => people.some((p) => p.name === name))

/** A subject of the page as Ask names a topic. */
const titleOf = (t: ObsData['topics'][number]) =>
  [t.metric, t.where === 'All markets' ? '' : t.where].filter(Boolean).join(' in ')

type Cell = { count: number | null; atLeast: number } | null

/** How much a cell shows, so the stricter of two can be told: exact more than a floor, and hidden least. */
const stricter = (a: Cell, b: Cell): Cell => {
  if (!a || !b) return null
  if (a.count !== null && b.count !== null) return a
  return { count: null, atLeast: Math.min(a.count ?? a.atLeast, b.count ?? b.atLeast) }
}

/** A person's own page, by what Ask names each subject, or null for someone who has no page. */
async function pageOf(name: string) {
  const api = await world.as(name)
  const page = await api.observabilityPage({ section: 'questions', range: 7 }).catch(() => null)
  if (!page) return null
  const cells = new Map<string, { domain: string | null; cell: Cell }>()
  for (const s of page.subjects) {
    const first = page.topics.find((t) => s.topics.includes(t.id))!
    cells.set(titleOf(first), {
      domain: first.domain ?? null,
      cell: { count: s.total, atLeast: s.atLeast },
    })
  }
  return cells
}

const expectedRows = async (name: string) => {
  const mine = await pageOf(name)
  const owners = await Promise.all(
    Object.entries(domains).flatMap(([id, d]) =>
      d.owners.map(async (owner) => ({ id, page: await pageOf(owner) })),
    ),
  )
  const admin = await pageOf('Ravi Kapoor')
  const rows = new Map<string, Cell>()
  for (const [title, { domain }] of admin!) {
    // A topic of the person's own view is that page's number.
    if (mine?.has(title)) {
      rows.set(title, mine.get(title)!.cell)
      continue
    }
    // Any other is the strictest view an owner of its domain has, and the administrators' with none.
    const own = owners.filter((o) => `area_${o.id}` === domain)
    const views = own.length ? own.map((o) => o.page) : [admin]
    rows.set(
      title,
      views.map((v) => v?.get(title)?.cell ?? null).reduce((a, b) => stricter(a, b)),
    )
  }
  return rows
}

describe.each(persons)('as %s', (name) => {
  it('Ask counts Definitions as the page does', async () => {
    const api = await world.as(name)
    const definitions = await api.getDefinitions()
    const of = (type: string) => definitions.filter((d) => d.type === type).length
    expect((await records(api, 'how many metrics do we have?')).total).toBe(of('metric'))
    expect((await records(api, 'how many dimensions do we have?')).total).toBe(of('dimension'))
  })

  it("Ask counts Context's filters as the page does", async () => {
    const api = await world.as(name)
    const { items } = await api.getLibrary()
    const listed = items.filter((f) => f.status !== 'Draft')
    const status = (s: string) => listed.filter((f) => f.status === s).length
    expect((await records(api, 'how many context items are there?')).total).toBe(listed.length)
    expect((await records(api, 'what is due for a check?')).total).toBe(status('Needs checking'))
    expect((await records(api, 'what is archived?')).total).toBe(status('Archived'))
    expect((await records(api, 'how many events are there?')).total).toBe(
      listed.filter((f) => f.kind === 'event').length,
    )
    const sales = listed.filter((f) => f.domain === 'area_sales' || f.domain === 'sales')
    expect((await records(api, 'what is due for a check in Sales?')).total).toBe(
      sales.filter((f) => f.status === 'Needs checking').length,
    )
    expect((await records(api, 'which items conflict?')).total).toBe(
      (await api.conflicts({ whose: 'all' })).length,
    )
  })

  it('Ask counts the Inbox as the page does', async () => {
    const api = await world.as(name)
    const inbox = await api.getInbox()
    const mine = inbox.cards.filter((c) => c.for === name && !inbox.done[c.id])
    expect((await records(api, 'what is waiting on me?')).total).toBe(
      mine.length + inbox.mentions.length,
    )
  })

  it("Ask's counts of what agents asked are the reader's Observability", async () => {
    const api = await world.as(name)
    const expected = await expectedRows(name)
    const week = await api.askedThisWeek()
    const cellOf = (c: Cell) => (!c ? null : c.count !== null ? `${c.count}` : `${c.atLeast}+`)
    const listed = [...expected].filter(([, c]) => c && (c.count ?? c.atLeast) >= 5)
    expect(new Map(week.rows.map((r) => [r.title, r.count]))).toEqual(
      new Map(listed.map(([title, c]) => [title, cellOf(c)])),
    )
    const most = await records(api, 'what are agents asking about most?')
    const shown = (most.sections ?? []).flatMap((s) => s.rows).concat(most.rows)
    for (const row of shown)
      if (row.type === 'topic')
        expect(cellOf(expected.get(row.title)!), row.title).toBe(row.cells[0])
  })
})
