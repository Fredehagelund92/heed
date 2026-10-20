import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError, type ContextApi, type Edition } from '@/api'
import { createMockApi } from '@/api/mock-api'
import { createMockWorkflow, type MockWorkflow } from '@/api/mock-workflow'
import { editionComparisonPagesQuery, editionFeedPagesQuery } from '@/api/edition-queries'
import { queryKeys } from '@/api/queries'
import { getFixtureItems, regression, versionDays } from '@/mocks/fixtures'
import { areas, FIXTURE_TODAY, people, roleGrants, vocabulary } from '@/mocks/reference-data'
import type { ContextItem } from '../../src/domain/item.ts'

/*
  Seeing what changed between editions in the mock (Editions design G1 to G3), by the service's
  rules (src/server/modules/editions/compare.ts, tested in tests/integration/edition-compare.test.ts
  with the same story): a contributor's change accepted, the owner's check, a retirement and
  going back, read as the feed, as the net change between two editions and as one item in depth.
  Ravi is an administrator, Jon the owner of Sales and Sandbox, Maria a contributor, Lars
  the high-risk approver of Sales and Kofi has no role.
*/

let workflow: MockWorkflow
beforeEach(() => {
  workflow = createMockWorkflow({
    today: FIXTURE_TODAY,
    areas,
    people,
    vocabulary,
    items: getFixtureItems,
    approvers: roleGrants.approvers,
    administrators: roleGrants.administrators,
    versionDays,
  })
})
const as = (personId: string): ContextApi =>
  createMockApi({ personId: () => personId, workflow: () => Promise.resolve(workflow) })

const refusal = async (call: Promise<unknown>) => {
  const error = await call.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ApiError)
  return (error as ApiError).kind
}

/** A Sales note that is not high risk and open-ended, so a check moves its review date. */
function salesNote(skip: readonly string[] = []): ContextItem {
  const found = getFixtureItems().find(
    (item) =>
      item.areaId === 'area_sales' &&
      item.status === 'accepted' &&
      item.kind === 'note' &&
      item.riskLevel !== 'high' &&
      item.claimLevel !== 'effect_stated' &&
      item.audience.kind === 'everyone' &&
      item.validity.end === null &&
      item.checkFlag === null &&
      !skip.includes(item.id),
  )
  if (!found) throw new Error('The fixture has no open-ended Sales note')
  return found
}

/** Maria proposes a new summary for an item; Jon accepts it. The edition it published. */
async function changed(item: ContextItem, summary: string): Promise<Edition> {
  const maria = as('per_maria')
  const created = await maria.createProposal({
    itemId: item.id,
    draft: { summary, summaryMarkup: summary },
  })
  expect(created.findings.filter((finding) => finding.severity === 'error')).toEqual([])
  const submitted = await maria.submitProposal({ id: created.id, revision: created.revision })
  const decided = await as('per_jon').decide({
    id: submitted.id,
    revision: submitted.revision,
    outcome: 'accept',
    reason: 'The law is final',
  })
  expect(decided.edition).not.toBeNull()
  return decided.edition!
}

describe('seeing what changed between editions in the mock', () => {
  it('reads the starting history as the seed stores it: added, changed, saved again and retired', async () => {
    const jon = as('per_jon')
    const editions = await jon.listEditions({ limit: 100 })
    const [live] = editions
    const bootstrap = editions.at(-1)!
    const all = await jon.compareEditions({ from: bootstrap.label, to: live!.label, limit: 200 })
    // Every version of a fixture item holds the same content, as the database seed stores them,
    // except the demo's regression: its second version ends the note and drops its review date.
    expect(all.facets.change).toMatchObject({ changed: 1, checked: 0, removed: 0 })
    expect(all.items.filter((item) => item.change === 'changed')).toMatchObject([
      {
        itemId: regression.item,
        from: { version: 1 },
        to: { version: 2 },
        fields: ['validity', 'reviewDate'],
      },
    ])
    expect(all.facets.change.added).toBeGreaterThan(0)
    expect(all.facets.change.resaved).toBeGreaterThan(0)
    expect(all.facets.change.retired).toBeGreaterThan(0)
    expect(all).toMatchObject({
      from: { label: bootstrap.label },
      to: { label: live!.label, live: true },
      editions: editions.length - 1,
      backwards: false,
      vocabulary: 0,
      total: all.items.length,
    })
    expect(all.sentence).toMatch(new RegExp(`Across ${editions.length - 1} editions\\.$`))
    for (const item of all.items) {
      if (item.itemId !== regression.item) expect(item.fields).toEqual([])
      expect(item.why.decisions.map((d) => d.reason)).toEqual([
        item.change === 'retired'
          ? 'Retired in the demo history.'
          : 'Accepted in the demo history.',
      ])
    }
    // Change order, then title: added, changed, saved again, retired.
    const ranks = all.items.map((item) =>
      ['added', 'changed', 'resaved', 'retired'].indexOf(item.change),
    )
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))

    const feed = await jon.editionFeed({ limit: 100 })
    expect(feed.next).toBeNull()
    expect(feed.entries.map((entry) => entry.edition.label)).toEqual(
      editions.map((edition) => edition.label),
    )
    const [newest] = feed.entries
    const owner = people.find((person) => person.id === newest!.actorId)!
    expect(newest!.sentence).toMatch(
      new RegExp(
        `^".+" was (added to|saved again, nothing different) .+\\. Proposed by .+, accepted by ${owner.name}\\. Why: Accepted in the demo history\\.$`,
      ),
    )
    // The first edition serves the library before the history: everything in it is new.
    const first = feed.entries.at(-1)!
    expect(first.edition.reason).toBe('bootstrap')
    expect(first.counts.added).toBe(first.items.length + first.more)
    expect(first.items).toHaveLength(10)
    expect(first.sentence).toMatch(/\. The first edition\.$/)
  })

  it('nets a change, a check and a retirement, with who made each and why', async () => {
    const jon = as('per_jon')
    const item = salesNote()
    const other = salesNote([item.id])
    const [start] = await jon.listEditions({ limit: 1 })

    const change = await changed(item, 'Online sales to Norway stopped for good')
    const check = await jon.recheckItem({ id: item.id, reason: 'Checked against the law again' })
    expect(check.edition).not.toBeNull()
    const retire = await jon.retireItem({ id: other.id, reason: 'Spain closed again' })

    const feed = await jon.editionFeed({ limit: 3 })
    expect(feed.entries.map((entry) => entry.edition.label)).toEqual([
      retire.label,
      check.edition!.label,
      change.label,
    ])
    expect(feed.next).toBe(change.label)
    const [retired, checked, accepted] = feed.entries
    expect(accepted).toMatchObject({
      counts: { changed: 1, added: 0, resaved: 0 },
      areas: ['area_sales'],
      highestRisk: 'low',
      actorId: 'per_jon',
      why: 'The law is final',
      items: [
        {
          itemId: item.id,
          change: 'changed',
          title: item.title,
          from: { version: item.version },
          to: { version: item.version + 1 },
          why: {
            proposal: { id: expect.any(String) as string, number: expect.any(Number) as number },
            proposerId: 'per_maria',
            channel: 'form',
            editedBy: null,
            decisions: [{ decidedBy: 'per_jon', capacity: 'owner', outcome: 'accept' }],
          },
        },
      ],
    })
    expect(accepted!.sentence).toBe(
      `"${item.title}" changed in Sales. Proposed by Maria Lindqvist, accepted by Jon Abara. Why: The law is final.`,
    )
    expect(checked).toMatchObject({
      counts: { checked: 1 },
      items: [{ itemId: item.id, change: 'checked', to: { version: item.version + 2 } }],
    })
    expect(checked!.sentence).toBe(
      `"${item.title}" in Sales was checked and is still correct. Checked by Jon Abara. Why: Checked against the law again.`,
    )
    expect(retired).toMatchObject({
      counts: { retired: 1 },
      why: 'Spain closed again',
      items: [
        {
          itemId: other.id,
          change: 'retired',
          from: { version: other.version },
          to: null,
          why: {
            proposal: null,
            decisions: [
              {
                decidedBy: 'per_jon',
                capacity: 'owner',
                outcome: 'retire',
                reason: 'Spain closed again',
              },
            ],
          },
        },
      ],
    })
    expect(retired!.sentence).toBe(
      `"${other.title}" in Sales was archived. Archived by Jon Abara. Why: Spain closed again.`,
    )

    // Net change: each item once, from how it was to how it is.
    const net = await jon.compareEditions({ from: start!.label, to: retire.label })
    expect(net).toMatchObject({
      editions: 3,
      backwards: false,
      total: 2,
      facets: { change: { changed: 1, retired: 1, checked: 0 } },
    })
    expect(net.sentence).toBe('2 facts in Sales: 1 changed, 1 archived. Across 3 editions.')
    expect(net.items.map((entry) => [entry.itemId, entry.change, entry.fields])).toEqual([
      [item.id, 'changed', ['summary', 'summaryMarkup', 'reviewDate']],
      [other.id, 'retired', []],
    ])
    // Who and why of the version served now: the owner's check.
    expect(net.items[0]!.why.decisions).toEqual([
      expect.objectContaining({ reason: 'Checked against the law again', outcome: 'accept' }),
    ])
    // The live edition against the one before it, by default.
    expect(await jon.compareEditions()).toMatchObject({
      from: { label: check.edition!.label },
      to: { label: retire.label, live: true },
      editions: 1,
      total: 1,
    })

    // One item in depth: field by field, and edition by edition.
    const deep = await jon.compareEditionItem({ id: item.id, from: start!.label, to: retire.label })
    expect(deep).toMatchObject({
      from: start!.label,
      to: retire.label,
      backwards: false,
      change: {
        change: 'changed',
        from: { version: item.version },
        to: { version: item.version + 2 },
      },
      mentions: { added: [], removed: [] },
    })
    expect(deep.fields).toContainEqual({
      field: 'summary',
      before: item.summary,
      after: 'Online sales to Norway stopped for good',
      systemFilled: false,
    })
    expect(deep.steps.map((step) => [step.edition.label, step.change])).toEqual([
      [change.label, 'changed'],
      [check.edition!.label, 'checked'],
    ])
    expect(deep.steps[0]!.why).toMatchObject({
      proposerId: 'per_maria',
      decisions: [{ reason: 'The law is final' }],
    })
    const leaving = await jon.compareEditionItem({
      id: other.id,
      from: check.edition!.label,
      to: retire.label,
    })
    expect(leaving.change).toMatchObject({ change: 'retired' })
    expect(leaving.fields).toContainEqual({
      field: 'title',
      before: other.title,
      after: null,
      systemFilled: false,
    })
    expect(
      await jon.compareEditionItem({ id: other.id, from: retire.label, to: retire.label }),
    ).toMatchObject({ change: null, fields: [], steps: [] })
  })

  it('tells going back from retiring, and compares backwards', async () => {
    const jon = as('per_jon')
    const ravi = as('per_ravi')
    const item = salesNote()
    const [before] = await jon.listEditions({ limit: 1 })
    const retire = await jon.retireItem({ id: item.id, reason: 'Ended' })
    const back = await ravi.rollbackEdition({ label: before!.label, note: 'Ended too early' })
    const again = await ravi.rollbackEdition({ label: retire.label, note: 'Ended after all' })

    const [left, returned] = (await jon.editionFeed({ limit: 2 })).entries
    expect(returned).toMatchObject({
      actorId: 'per_ravi',
      why: 'Ended too early',
      items: [{ itemId: item.id, change: 'added' }],
    })
    expect(returned!.sentence).toBe(
      `"${item.title}" was added to Sales. Ravi Kapoor went back to edition ${before!.label}. Why: Ended too early.`,
    )
    // Going back takes an item out without a decision: the edition says who and why.
    expect(left).toMatchObject({
      items: [{ itemId: item.id, change: 'removed', why: { decisions: [], proposerId: null } }],
    })
    expect(
      (await jon.compareEditions({ from: before!.label, to: again.label })).items.map(
        (entry) => entry.change,
      ),
    ).toEqual(['removed'])
    // Retired last in a range that also goes back reads as no longer served.
    expect(
      (await jon.compareEditions({ from: before!.label, to: retire.label })).items[0]!.change,
    ).toBe('retired')

    const backwards = await jon.compareEditions({ from: retire.label, to: before!.label })
    expect(backwards).toMatchObject({ backwards: true, editions: 1 })
    expect(backwards.items.map((entry) => [entry.itemId, entry.change])).toEqual([
      [item.id, 'added'],
    ])
    const undone = await jon.compareEditions({ from: back.label, to: retire.label })
    expect(undone).toMatchObject({ backwards: true })
    expect(undone.items.map((entry) => entry.change)).toEqual(['removed'])
  })

  it('pages, filters and keeps counts over every change', async () => {
    const jon = as('per_jon')
    const editions = await jon.listEditions({ limit: 100 })
    const range = { from: editions.at(-1)!.label, to: editions[0]!.label }
    const all = await jon.compareEditions({ ...range, limit: 200 })
    const page = await jon.compareEditions({ ...range, limit: 2, offset: 1 })
    expect(page).toMatchObject({ total: all.total, limit: 2, offset: 1, facets: all.facets })
    expect(page.items.map((item) => item.itemId)).toEqual(
      all.items.slice(1, 3).map((item) => item.itemId),
    )
    const retiredOnly = await jon.compareEditions({ ...range, change: 'retired' })
    expect(retiredOnly.facets).toEqual(all.facets)
    expect(retiredOnly.total).toBe(all.facets.change.retired)
    expect(new Set(retiredOnly.items.map((item) => item.change))).toEqual(new Set(['retired']))
    const sandbox = await jon.compareEditions({ ...range, areaId: 'area_sandbox', kind: 'note' })
    for (const item of sandbox.items)
      expect(item).toMatchObject({ areaId: 'area_sandbox', kind: 'note' })

    const [newest] = (await jon.editionFeed({ limit: 1 })).entries
    const pageTwo = await jon.editionFeed({ before: editions[2]!.label, limit: 2 })
    expect(pageTwo.entries.map((entry) => entry.edition.label)).toEqual([
      editions[3]!.label,
      editions[4]!.label,
    ])
    expect(pageTwo.next).toBe(editions[4]!.label)
    const ranged = await jon.editionFeed({ after: editions[3]!.label, before: editions[0]!.label })
    expect(ranged).toMatchObject({ next: null })
    expect(ranged.entries.map((entry) => entry.edition.label)).toEqual([
      editions[1]!.label,
      editions[2]!.label,
    ])
    expect(newest!.edition.label).toBe(editions[0]!.label)
  })

  it('counts an item for some groups only, and shows nothing else of it', async () => {
    const jon = as('per_jon')
    const editions = await jon.listEditions({ limit: 100 })
    const range = { from: editions.at(-1)!.label, to: editions[0]!.label }
    const all = await jon.compareEditions({ ...range, limit: 200 })
    const grouped = getFixtureItems().filter((item) => item.audience.kind !== 'everyone')
    expect(all.withheld).toBeGreaterThan(0)
    expect(all.items.some((item) => grouped.some((g) => g.id === item.itemId))).toBe(false)
    expect(all.sentence).toMatch(/facts? that only some groups see changed/)
    const feed = await jon.editionFeed({ limit: 100 })
    const hidden = feed.entries.find((entry) => entry.withheld > 0)!
    expect(hidden.items.some((item) => grouped.some((g) => g.id === item.itemId))).toBe(false)
    // The item that edition changed: not shown even in depth.
    const diff = await jon.diffEdition({ label: hidden.edition.label })
    const id = diff.items.find((change) => grouped.some((g) => g.id === change.id))!.id
    expect(
      await refusal(jon.compareEditionItem({ id, from: diff.from!, to: hidden.edition.label })),
    ).toBe('not-found')
  })

  it('narrows a comparison to some items, as the Workbench asks about one question', async () => {
    const jon = as('per_jon')
    const item = salesNote()
    const [start] = await jon.listEditions({ limit: 1 })
    await changed(item, 'Online sales to Norway stopped for good')
    const retire = await jon.retireItem({ id: salesNote([item.id]).id, reason: 'Ended' })
    const whole = await jon.compareEditions({ from: start!.label, to: retire.label })
    expect(whole.total).toBe(2)
    expect(
      workflow
        .as('per_jon')
        .compareEditions({ from: start!.label, to: retire.label })
        .items.map((entry) => entry.itemId),
    ).toEqual(whole.items.map((entry) => entry.itemId))
  })

  it('is for owners, deputies and administrators, and does not find what is not there', async () => {
    const [live] = await as('per_ravi').listEditions({ limit: 1 })
    const item = getFixtureItems()[0]!
    for (const person of ['per_maria', 'per_lars', 'per_kofi']) {
      expect(await refusal(as(person).compareEditions()), person).toBe('forbidden')
      expect(await refusal(as(person).compareEditionItem({ id: item.id })), person).toBe(
        'forbidden',
      )
      expect(await refusal(as(person).editionFeed()), person).toBe('forbidden')
    }
    for (const person of ['per_jon', 'per_sofia', 'per_ravi'])
      expect((await as(person).editionFeed({ limit: 1 })).entries[0]!.edition.label).toBe(
        live!.label,
      )
    const jon = as('per_jon')
    expect(await refusal(jon.compareEditions({ from: '2020-01-01.9' }))).toBe('not-found')
    expect(await refusal(jon.compareEditionItem({ id: 'itm_nosuchitem1' }))).toBe('not-found')
    expect(await refusal(jon.editionFeed({ before: '2020-01-01.9' }))).toBe('not-found')
  })
})

describe('the editions reads in the query cache', () => {
  it('pages a comparison on the two editions its first page compared', async () => {
    const options = editionComparisonPagesQuery({ change: 'retired' })
    expect(options.queryKey).toEqual(queryKeys.editionComparisonPages({ change: 'retired' }))
    // Every key starts with `editions`, which a new edition makes stale.
    expect(options.queryKey[0]).toBe(queryKeys.editions[0])
    const page = await as('per_jon').compareEditions({ limit: 1 })
    const next = options.getNextPageParam(
      { ...page, offset: 0, items: page.items, total: page.items.length + 1 },
      [],
      { offset: 0 },
      [],
    )
    expect(next).toEqual({
      offset: page.items.length,
      to: page.to.label,
      ...(page.from ? { from: page.from.label } : {}),
    })
    expect(
      options.getNextPageParam({ ...page, total: page.items.length }, [], { offset: 0 }, []),
    ).toBeUndefined()
  })

  it('pages the feed by its cursor', async () => {
    const options = editionFeedPagesQuery({ limit: 2 })
    const feed = await as('per_jon').editionFeed({ limit: 2 })
    expect(options.getNextPageParam(feed, [], null, [])).toBe(feed.next)
  })

  it('reads a range of the feed that ends before the live edition, edition by edition', async () => {
    const jon = as('per_jon')
    const newest = (await jon.editionFeed({ limit: 5 })).entries.map((e) => e.edition.label)
    const range = await jon.editionFeed({ after: newest[4]!, through: newest[2]! })
    expect(range.next).toBeNull()
    expect(range.entries.map((entry) => entry.edition.label)).toEqual([newest[2], newest[3]])
    const paged = await jon.editionFeed({ through: newest[1]!, limit: 1 })
    expect(paged.entries.map((entry) => entry.edition.label)).toEqual([newest[1]])
    expect(paged.next).toBe(newest[1])
  })
})
