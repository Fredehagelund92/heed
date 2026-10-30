import { describe, expect, it } from 'vitest'
import { facts as seed } from '@/api/mock/data/world'
import { ownersOf } from '@/model/people'
import { servedToAgents, type Fact } from '@/model/items'
import { historyOf } from '@/api/mock/data/history'
import { createMockApi } from '@/api/mock'
import { createDefinitions } from '@/api/mock/definitions'
import { createWorkspace } from '@/api/mock/workspace'
import { findDefinition, goesWith } from '@/lib/definitions'
import {
  canChange,
  doneLine,
  movableTo,
  needsTyping,
  planFacts,
  planTerms,
  skippedLine,
  toCsv,
  toMarkdown,
  TYPE_ABOVE,
} from '@/lib/bulk'
import { reduce, start } from '@/api/mock/store'
import type { LogEntry } from '@/model/items'

// A change to many items, before it happens: what it acts on, what it leaves alone and why. Owners
// of an item's domain and admins change it; drafts are deleted, published items archived.

const fact = (id: string) => seed.find((f) => f.id === id)!
const domains = createWorkspace().domainMap()
const jon = { name: 'Jon Abara', admin: true }
const tomas = { name: 'Tomas Eriksen', admin: false }
const sofia = { name: 'Sofia Brandt', admin: false }
const salesLive = seed.filter((f) => f.domain === 'sales' && f.status === 'Live').slice(0, 2)
const marketingLive = seed
  .filter((f) => f.domain === 'marketing' && f.status === 'Live')
  .slice(0, 2)
const drafts = seed.filter((f) => f.status === 'Draft')

describe('who changes what', () => {
  it("lets owners of the item's domain and admins change it", () => {
    expect(canChange(salesLive[0]!, sofia, domains)).toBe(true)
    expect(canChange(salesLive[0]!, tomas, domains)).toBe(false)
    expect(canChange(salesLive[0]!, jon, domains)).toBe(true)
  })

  it("skips the items someone can't change, and says whose they are", () => {
    const plan = planFacts('archive', [...salesLive, ...marketingLive], sofia, domains)
    expect(plan.act).toEqual(salesLive)
    expect(plan.skipped.map((s) => s.why)).toEqual(['owned by Marketing', 'owned by Marketing'])
    expect(skippedLine(plan.skipped)).toBe('2 skipped: owned by Marketing')
    expect(plan.skipped[0]!.reason).toBe('Only owners of Marketing and admins can change it.')
  })

  it('moves items only into domains the person owns, unless they are an admin', () => {
    expect(movableTo(tomas, domains)).toEqual(['marketing'])
    expect(movableTo(jon, domains)).toHaveLength(5)
  })
})

describe('archive and delete', () => {
  it('deletes drafts only: published items are archived, not deleted', () => {
    const plan = planFacts('delete', [...drafts, salesLive[0]!], jon, domains)
    expect(plan.act).toEqual(drafts)
    expect(plan.skipped).toEqual([
      expect.objectContaining({
        id: salesLive[0]!.id,
        why: 'published',
        reason: 'Published items are archived, not deleted.',
      }),
    ])
  })

  it('archives published items, and leaves drafts and archived ones alone', () => {
    const archived = seed.find((f) => f.status === 'Archived')!
    const plan = planFacts('archive', [salesLive[0]!, drafts[0]!, archived], jon, domains)
    expect(plan.act).toEqual([salesLive[0]!])
    expect(skippedLine(plan.skipped)).toBe('2 skipped: 1 a draft, 1 already archived')
  })

  it('never serves a draft to agents', () => {
    expect(drafts.length).toBeGreaterThan(0)
    expect(drafts.some(servedToAgents)).toBe(false)
    expect(servedToAgents(salesLive[0]!)).toBe(true)
  })

  it('asks for the number to be typed only above ten', () => {
    expect(TYPE_ABOVE).toBe(10)
    expect(needsTyping(10)).toBe(false)
    expect(needsTyping(11)).toBe(true)
  })
})

describe('the other changes', () => {
  it('marks as checked only what the person opened, as publishing together does', () => {
    const [a, b] = salesLive as [Fact, Fact]
    const plan = planFacts('check', [a, b, drafts[0]!], jon, domains, { viewed: { [a.id]: true } })
    expect(plan.act).toEqual([a])
    expect(skippedLine(plan.skipped)).toBe('2 skipped: 1 not opened yet, 1 a draft')
  })

  it('skips what is already so', () => {
    const f = salesLive[0]!
    expect(planFacts('domain', [f], jon, domains, { domain: 'sales' }).skipped[0]!.why).toBe(
      'already in Sales',
    )
    expect(planFacts('kind', [f], jon, domains, { kind: f.kind }).act).toEqual([])
  })

  it('gives an item owners only who can change it', () => {
    const plan = planFacts('owner-add', [salesLive[0]!, marketingLive[0]!], jon, domains, {
      person: sofia,
    })
    expect(plan.act).toEqual([])
    expect(plan.skipped.map((s) => s.why)).toEqual([
      'already an owner',
      "Sofia Brandt doesn't own Marketing",
    ])
    // An admin can answer for any item.
    expect(planFacts('owner-add', [marketingLive[0]!], jon, domains, { person: jon }).act).toEqual([
      marketingLive[0]!,
    ])
    expect(
      ownersOf({ ...marketingLive[0]!, owners: ['Tomas Eriksen', 'Jon Abara'] }, domains),
    ).toEqual(['Tomas Eriksen', 'Jon Abara'])
    expect(ownersOf(marketingLive[0]!, domains)).toEqual(['Tomas Eriksen'])
  })
})

describe('what the bar says', () => {
  it('counts what was done, and what failed', () => {
    expect(doneLine('archived', 4, 0)).toBe('4 archived')
    expect(doneLine('archived', 3, 1)).toBe('3 of 4 archived, 1 failed')
  })

  it('fails a first try on its last row only when the address asks, so a retry goes through', async () => {
    const { api, controls } = createMockApi()
    controls.setAddress({ path: '/context', query: { bulk: 'fail' } })
    const entry: LogEntry = {
      id: 'log-x',
      on: '2026-10-23',
      who: 'Jon Abara',
      what: 'archived',
      summary: 'Archived.',
      items: salesLive.map((f) => ({ id: f.id, title: f.title })),
    }
    const patches = Object.fromEntries(
      salesLive.map((f) => [f.id, { status: 'Archived' as const }]),
    )
    const first = await api.applyBulk({ action: 'archive', patches, remove: [], entry })
    expect(first.done).toEqual([salesLive[0]!.id])
    expect(first.failed).toEqual([salesLive[1]!.id])
    const retry = await api.applyBulk({
      action: 'archive',
      patches: { [salesLive[1]!.id]: { status: 'Archived' } },
      remove: [],
      entry: { ...entry, id: 'log-y' },
    })
    expect(retry).toEqual(expect.objectContaining({ done: [salesLive[1]!.id], failed: [] }))
  })
})

describe('terms', () => {
  it('changes terms only: synced metrics and dimensions are left alone with their tool', () => {
    const all = createDefinitions().list()
    const webshop = findDefinition(all, 'Webshop')!
    const orders = findDefinition(all, 'Orders')!
    const plan = planTerms('delete', [webshop, orders], jon, domains, { tool: 'Cube' })
    expect(plan.act).toEqual([webshop])
    expect(plan.skipped[0]!).toEqual(expect.objectContaining({ why: 'synced from Cube' }))
    expect(planTerms('delete', [webshop], tomas, domains, { tool: 'Cube' }).skipped[0]!.why).toBe(
      'owned by Sales',
    )
  })

  it("takes a term's synonyms with it, and Undo brings all of them back", () => {
    const definitions = createDefinitions()
    const before = definitions.list()
    const target = before.find((d) => !d.synced && !d.sameAs && goesWith(before, [d.name]).length)
    if (!target) return
    const synonyms = goesWith(before, [target.name]).map((d) => d.name)
    const undo = definitions.deleteTerms([target.name])
    expect(findDefinition(definitions.list(), target.name)).toBeUndefined()
    for (const s of synonyms) expect(findDefinition(definitions.list(), s)).toBeUndefined()
    undo()
    expect(definitions.list()).toBe(before)
  })
})

describe('export', () => {
  it('writes Markdown a person or an agent can read', () => {
    const md = toMarkdown([salesLive[0]!], domains)
    expect(md).toContain(`## ${salesLive[0]!.title}`)
    expect(md).toContain('- Domain: Sales')
  })

  it('writes a spreadsheet with one row each, quoting commas', () => {
    const csv = toCsv([salesLive[0]!, salesLive[1]!], domains).trim().split('\n')
    expect(csv).toHaveLength(3)
    expect(csv[0]!).toBe(
      'Title,Domain,Kind,Status,Applies to,When,Owners,Checked by,Checked on,Source,What agents should know',
    )
    expect(toCsv([{ ...salesLive[0]!, title: 'A "quoted", title' }], domains)).toContain(
      '"A ""quoted"", title"',
    )
  })
})

describe('the store', () => {
  const entry: LogEntry = {
    id: 'log-1',
    on: '2026-10-23',
    who: 'Jon Abara',
    what: 'archived',
    summary: 'Archived: agents stop getting it.',
    items: [{ id: salesLive[0]!.id, title: salesLive[0]!.title, domain: 'sales' }],
  }

  it('applies a change to many items at once, deletes drafts, and writes History', () => {
    const s = reduce(start, {
      type: 'bulk',
      patches: { [salesLive[0]!.id]: { status: 'Archived' } },
      remove: [drafts[0]!.id],
      entry,
    })
    expect(s.edits[salesLive[0]!.id]).toEqual({ status: 'Archived' })
    expect(s.deleted[drafts[0]!.id]).toBe(true)
    expect(s.log).toEqual([entry])
    expect(historyOf(fact(salesLive[0]!.id), s.log)[0]!).toEqual(
      expect.objectContaining({ kind: 'archived', who: 'Jon Abara', summary: entry.summary }),
    )
  })

  it('undoes exactly that change, and takes its line out of History', () => {
    const s = reduce(start, {
      type: 'bulk',
      patches: { [salesLive[0]!.id]: { status: 'Archived' } },
      remove: [drafts[0]!.id],
      entry,
    })
    const back = reduce(s, {
      type: 'revert',
      before: start,
      cards: [],
      facts: [salesLive[0]!.id, drafts[0]!.id],
      entry: entry.id,
    })
    expect(back.edits).toEqual({})
    expect(back.deleted).toEqual({})
    expect(back.log).toEqual([])
    expect(reduce(s, { type: 'unlog', entry: entry.id }).log).toEqual([])
  })

  it('remembers what was opened, once', () => {
    const s = reduce(start, { type: 'viewedFact', id: 'x' })
    expect(s.viewed).toEqual({ x: true })
    expect(reduce(s, { type: 'viewedFact', id: 'x' })).toBe(s)
  })
})
