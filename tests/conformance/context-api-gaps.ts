/**
 * The gaps side of the `ContextApi` conformance suite (FR-604 to FR-616): the same steps run
 * against the mock binding (tests/unit/mock-gaps.test.ts) and against the http binding on the
 * real service and PostgreSQL (tests/integration/gaps-api.test.ts), both holding the fixture gaps
 * of src/web/mocks/gaps.ts. So the mock keeps the service's privacy rule (FR-614): who sees which
 * gap, which counts come back hidden, who reads notes and who may change a status.
 *
 * Maria has no role, Jon is owner of Sales and Sandbox, Sofia owner of Sales and
 * Ravi an administrator. The steps run in order: reads first, then the changes.
 */
import { describe, expect, it } from 'vitest'
import type { ContextApi } from '../../src/web/api/client.ts'
import { ApiError } from '../../src/web/api/errors.ts'
import { GAP_MINIMUM_COUNT, gapFixtures } from '../../src/web/mocks/gaps.ts'

export const gapPeople = ['maria', 'jon', 'sofia', 'ravi'] as const
export type GapPerson = (typeof gapPeople)[number]
export type GapApis = Record<GapPerson, ContextApi>

const ref = (n: number) => gapFixtures[n - 1]!.ref
const id = (n: number) => gapFixtures[n - 1]!.id

async function refusal(call: Promise<unknown>): Promise<ApiError> {
  try {
    await call
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error('Expected the call to be refused')
}

export function describeContextApiGaps(name: string, getApis: () => GapApis) {
  const as = (person: GapPerson) => getApis()[person]

  describe(`ContextApi gaps conformance: ${name}`, () => {
    it('shows a person without a role only the gaps whose weeks reach the minimum, open first', async () => {
      const gaps = await as('maria').listGaps({ limit: 200 })
      expect(gaps.map((gap) => gap.ref)).toEqual([5, 7, 10, 1, 9, 2, 4, 6].map(ref))
      expect(gaps.every((gap) => !gap.canManage)).toBe(true)
    })

    it('hides every count below the minimum from a reader who does not manage the gap', async () => {
      const orders = (await as('maria').listGaps({ limit: 200 })).find((gap) => gap.id === id(1))
      expect(orders).toMatchObject({
        type: 'missing',
        status: 'open',
        openedBy: 'no_item_calls',
        topic: {
          areaId: 'area_sales',
          metrics: ['metric:orders'],
          dimensions: [],
          dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
          month: '2026-10-01',
        },
        // The visible reports add up to nothing, so the total is hidden as well.
        reports: null,
        personReports: null,
        noItemCalls: 40,
        weeks: [
          { week: '2026-09-14', reports: 0, personReports: null, noItemCalls: 6 },
          { week: '2026-09-21', reports: null, personReports: null, noItemCalls: 9 },
          { week: '2026-09-28', reports: null, personReports: null, noItemCalls: 14 },
          // People's reports are left out for a reader: two of the three are agents'.
          { week: '2026-10-05', reports: null, personReports: null, noItemCalls: 11 },
        ],
      })
      const roas = await as('maria').getGap(id(9))
      // Without the five reports people made, the second week stays below the minimum: people's
      // reports never count for a reader, who could otherwise add some and subtract their own.
      expect(roas).toMatchObject({
        reports: 5,
        personReports: null,
        noItemCalls: null,
        notes: null,
      })
      expect(roas?.weeks).toEqual([
        { week: '2026-09-14', reports: 5, personReports: null, noItemCalls: 0 },
      ])
      // Net revenue in Spain (the demo's regression): its first week is below the minimum,
      // so a reader sees only the second.
      expect(await as('maria').getGap(id(10))).toMatchObject({
        noItemCalls: 12,
        weeks: [{ week: '2026-10-05', reports: 0, personReports: null, noItemCalls: 12 }],
      })
      // Its owners see them all.
      expect(await as('ravi').getGap(id(9))).toMatchObject({ reports: 12, personReports: 5 })
    })

    it('reads a gap with too few calls as not found, for anyone who does not manage it', async () => {
      expect(await as('maria').getGap(id(3))).toBeNull()
      expect(await as('maria').getGap(id(8))).toBeNull()
      expect(await as('jon').getGap(id(3))).toBeNull()
    })

    it('shows an owner of the area every gap of it in full, with its notes', async () => {
      const jon = await as('jon').listGaps({ areaId: 'area_sales', limit: 200 })
      expect(jon.map((gap) => gap.ref)).toEqual([10, 1, 8, 2, 4].map(ref))
      expect(jon.every((gap) => gap.canManage)).toBe(true)
      expect(jon.find((gap) => gap.id === id(8))).toMatchObject({
        openedBy: 'person',
        reports: 2,
        personReports: 2,
        noItemCalls: 1,
        weeks: [{ week: '2026-10-05', reports: 2, personReports: 2, noItemCalls: 1 }],
      })
      const orders = await as('sofia').getGap(id(1))
      expect(orders).toMatchObject({ canManage: true, reports: 6, noItemCalls: 40 })
      expect(orders?.notes?.map((note) => note.source)).toEqual(['report_gap', 'owner'])
      expect((await as('jon').getGap(id(8)))?.notes?.map((note) => note.source)).toEqual(['person'])
      // A gap of another area keeps the reader's rule.
      expect(await as('jon').getGap(id(7))).toMatchObject({ canManage: false, notes: null })
    })

    it('lets only an administrator manage a gap whose topic spans areas', async () => {
      expect(await as('jon').getGap(id(5))).toMatchObject({ canManage: false, reports: 6 })
      expect(await as('ravi').getGap(id(5))).toMatchObject({ canManage: true, reports: 10 })
      expect((await as('ravi').listGaps({ limit: 200 })).map((gap) => gap.ref)).toHaveLength(10)
    })

    it('filters by area, status and type, and pages', async () => {
      const ravi = as('ravi')
      expect((await ravi.listGaps({ status: 'resolved' })).map((gap) => gap.ref)).toEqual([ref(6)])
      expect((await ravi.listGaps({ type: 'missing' })).map((gap) => gap.ref)).toEqual(
        [7, 10, 3, 1].map(ref),
      )
      expect((await ravi.listGaps({ areaId: 'area_paid_media' })).map((gap) => gap.ref)).toEqual([
        ref(9),
      ])
      expect((await ravi.listGaps({ limit: 2, offset: 1 })).map((gap) => gap.ref)).toEqual(
        [7, 10].map(ref),
      )
    })

    it('counts topics per week only where a topic week reaches the minimum', async () => {
      const counts = await as('maria').getTopicCounts()
      expect(counts.minimumCount).toBe(GAP_MINIMUM_COUNT)
      expect(counts.hiddenTopicWeeks).toBe(5)
      expect(counts.rows).toHaveLength(21)
      expect(counts.rows[0]).toEqual({
        topic: {
          areaId: 'area_sales',
          areaIds: ['area_sales'],
          metrics: ['metric:orders'],
          dimensions: [],
          dimensionValues: [{ dimension: 'dim:market', value: 'val:market/spain' }],
          month: '2026-10-01',
        },
        week: '2026-10-05',
        calls: 37,
        noItemCalls: 0,
        noItemShare: 0,
      })
      const footwear = counts.rows.find((row) => row.topic.metrics[0] === 'metric:gross_sales')
      expect(footwear).toMatchObject({ calls: 26, noItemCalls: null, noItemShare: null })
      expect(counts.rows.every((row) => row.calls >= GAP_MINIMUM_COUNT)).toBe(true)

      // A topic that spans Marketing and Customer value counts in each of them.
      const marketing = await as('maria').getTopicCounts({ areaId: 'area_marketing' })
      expect(marketing.rows.map((row) => [row.week, row.calls])).toEqual([
        ['2026-10-05', 20],
        ['2026-09-28', 16],
        ['2026-09-28', 8],
      ])
      expect(marketing.hiddenTopicWeeks).toBe(2)
      const lastWeeks = await as('maria').getTopicCounts({ weeks: 2 })
      expect(new Set(lastWeeks.rows.map((row) => row.week))).toEqual(
        new Set(['2026-10-05', '2026-09-28']),
      )
    })

    it('totals the calls per week over every topic, the same for everyone, never giving a hidden count away', async () => {
      const weekly = await as('maria').getWeeklyCalls()
      expect(weekly.minimumCount).toBe(GAP_MINIMUM_COUNT)
      expect(weekly.weeks).toEqual([
        { week: '2026-08-17', calls: 11, noItemCalls: 7, shownCalls: 11 },
        { week: '2026-08-24', calls: 6, noItemCalls: 5, shownCalls: 6 },
        { week: '2026-08-31', calls: 0, noItemCalls: 0, shownCalls: 0 },
        // Three calls found nothing that week: under the minimum, so hidden.
        { week: '2026-09-07', calls: 26, noItemCalls: null, shownCalls: 26 },
        { week: '2026-09-14', calls: 34, noItemCalls: 11, shownCalls: 34 },
        // 51 calls, 47 of them in shown topic weeks: the total would give away a topic week of
        // four, so it is hidden; the 20 that found nothing add six to the shown 14, so they show.
        { week: '2026-09-21', calls: null, noItemCalls: 20, shownCalls: 47 },
        { week: '2026-09-28', calls: null, noItemCalls: null, shownCalls: 105 },
        // Nine calls over the shown 129, in three hidden topic weeks: enough to show.
        { week: '2026-10-05', calls: 138, noItemCalls: 47, shownCalls: 129 },
      ])
      expect(await as('jon').getWeeklyCalls()).toEqual(weekly)
      expect(await as('ravi').getWeeklyCalls()).toEqual(weekly)

      // The exact total: the shown topic weeks alone undercount it, by the hidden ones.
      const counts = await as('maria').getTopicCounts()
      const shown = (week: string) =>
        counts.rows.filter((row) => row.week === week).reduce((sum, row) => sum + row.calls, 0)
      const shownNoItem = (week: string) =>
        counts.rows
          .filter((row) => row.week === week)
          .reduce((sum, row) => sum + (row.noItemCalls ?? 0), 0)
      expect(shown('2026-10-05')).toBeLessThan(138)
      for (const week of weekly.weeks) {
        expect(week.shownCalls).toBe(shown(week.week))
        // No total gives a hidden count away: it adds nothing, or at least the minimum.
        for (const added of [
          week.calls === null ? 0 : week.calls - week.shownCalls,
          week.noItemCalls === null ? 0 : week.noItemCalls - shownNoItem(week.week),
        ])
          expect(added === 0 || added >= GAP_MINIMUM_COUNT).toBe(true)
      }

      const lastWeeks = await as('maria').getWeeklyCalls({ weeks: 2 })
      expect(lastWeeks.weeks.map((week) => week.week)).toEqual(['2026-09-28', '2026-10-05'])
      expect((await refusal(as('maria').getWeeklyCalls({ weeks: 53 }))).kind).toBe('bad-request')
    })

    it('refuses a status change or a note from anyone who does not manage the gap', async () => {
      expect(
        (await refusal(as('maria').setGapStatus({ id: id(1), status: 'resolved' }))).kind,
      ).toBe('forbidden')
      expect((await refusal(as('maria').addGapNote({ id: id(1), note: 'Hello' }))).kind).toBe(
        'forbidden',
      )
      expect((await refusal(as('jon').setGapStatus({ id: id(3), status: 'resolved' }))).kind).toBe(
        'not-found',
      )
    })

    it('keeps a note or a reason that holds personal data out', async () => {
      const note = await refusal(as('jon').addGapNote({ id: id(1), note: 'Ask maria@example.com' }))
      expect(note.kind).toBe('invalid')
      expect(note.findings.map((finding) => finding.code)).toEqual(['email_address'])
      const reason = await refusal(
        as('jon').setGapStatus({ id: id(1), status: 'resolved', reason: 'Call 555-123-4567' }),
      )
      expect(reason.kind).toBe('invalid')
      expect((await as('jon').getGap(id(1)))?.status).toBe('open')
    })

    it('adds an owner note, newest last', async () => {
      const gap = await as('sofia').addGapNote({ id: id(1), note: 'An event item would cover it.' })
      expect(gap.notes?.map((note) => [note.source, note.note]).at(-1)).toEqual([
        'owner',
        'An event item would cover it.',
      ])
      expect(gap.notes).toHaveLength(3)
    })

    it('links a test question of the area to a gap, for its owners and administrators only (FR-610)', async () => {
      const question = (id: string, area: string, split: 'development' | 'held_out') => ({
        id,
        question: {
          id,
          area,
          wordings: [
            { kind: 'natural' as const, text: 'Why did orders stall in Norway this month?' },
            {
              kind: 'precise' as const,
              text: 'What explains orders in Norway, October 2026?',
            },
          ],
          scope: {},
          expected: { must_deliver: [], must_not_deliver: [] },
          source: 'Conformance, October 2026',
          split,
        },
      })
      await as('jon').saveTestQuestion(
        question('conformance-gap-checkout', 'area_sales', 'development'),
      )
      await as('jon').saveTestQuestion(question('conformance-gap-held', 'area_sales', 'held_out'))
      await as('ravi').saveTestQuestion(
        question('conformance-gap-paid', 'area_paid_media', 'held_out'),
      )

      const linked = await as('jon').linkGapTest({
        id: id(1),
        question: 'conformance-gap-checkout',
      })
      expect(linked.tests).toEqual([
        expect.objectContaining({
          question: 'conformance-gap-checkout',
          split: 'development',
          active: true,
          evidenceRun: null,
          passed: null,
        }),
      ])
      expect(linked.tests?.[0]?.linkedHour).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/)
      // Linking it again changes nothing; a held-out test of the area may be linked too.
      await as('sofia').linkGapTest({ id: id(1), question: 'conformance-gap-checkout' })
      const both = await as('sofia').linkGapTest({ id: id(1), question: 'conformance-gap-held' })
      expect(both.tests?.map((test) => [test.question, test.split])).toEqual([
        ['conformance-gap-checkout', 'development'],
        ['conformance-gap-held', 'held_out'],
      ])
      expect(both.history?.filter((entry) => entry.action === 'gap.test_linked')).toEqual([
        expect.objectContaining({ details: { question: 'conformance-gap-checkout' } }),
        expect.objectContaining({ details: { question: 'conformance-gap-held' } }),
      ])

      // A reader sees whether the gap is verified, never which tests or its history.
      expect(await as('maria').getGap(id(1))).toMatchObject({
        resolvedEdition: null,
        verifiedAt: null,
        verifiedEdition: null,
        tests: null,
        history: null,
      })
      // Nobody else links, and only the area's tests, found only by those who may read them.
      expect(
        (
          await refusal(
            as('maria').linkGapTest({ id: id(1), question: 'conformance-gap-checkout' }),
          )
        ).kind,
      ).toBe('forbidden')
      expect(
        (await refusal(as('jon').linkGapTest({ id: id(7), question: 'conformance-gap-checkout' })))
          .kind,
      ).toBe('forbidden')
      expect(
        (await refusal(as('jon').linkGapTest({ id: id(1), question: 'conformance-gap-paid' })))
          .kind,
      ).toBe('not-found')
      expect(
        (await refusal(as('ravi').linkGapTest({ id: id(1), question: 'conformance-gap-paid' })))
          .kind,
      ).toBe('invalid')
      expect(
        (await refusal(as('ravi').linkGapTest({ id: id(5), question: 'conformance-gap-checkout' })))
          .kind,
      ).toBe('invalid')
      // A topic that spans domains takes the tests of each of them.
      await as('ravi').saveTestQuestion(
        question('conformance-gap-marketing', 'area_marketing', 'development'),
      )
      const spanning = await as('ravi').linkGapTest({
        id: id(5),
        question: 'conformance-gap-marketing',
      })
      expect(spanning.tests?.map((test) => test.question)).toEqual(['conformance-gap-marketing'])
      expect(
        (
          await refusal(
            as('jon').linkGapTest({
              id: id(1),
              question: 'conformance-gap-checkout',
              evidenceRun: '00000000-0000-4000-8000-00000000abcd',
            }),
          )
        ).kind,
      ).toBe('invalid')

      const unlinked = await as('jon').unlinkGapTest({
        id: id(1),
        question: 'conformance-gap-held',
      })
      expect(unlinked.tests?.map((test) => test.question)).toEqual(['conformance-gap-checkout'])
      // Unlinking it again changes nothing.
      const again = await as('jon').unlinkGapTest({ id: id(1), question: 'conformance-gap-held' })
      expect(again.history?.map((entry) => entry.action).slice(-2)).toEqual([
        'gap.test_linked',
        'gap.test_unlinked',
      ])
      expect(
        (
          await refusal(
            as('maria').unlinkGapTest({ id: id(1), question: 'conformance-gap-checkout' }),
          )
        ).kind,
      ).toBe('forbidden')
    })

    it('sets a status with a reason, and reopens a gap marked won’t fix', async () => {
      const resolved = await as('jon').setGapStatus({
        id: id(1),
        status: 'resolved',
        reason: 'The event item covers the August pause.',
      })
      expect(resolved.status).toBe('resolved')
      expect(resolved.statusSince).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/)
      const reopened = await as('jon').setGapStatus({
        id: id(4),
        status: 'open',
        reason: 'Asked again.',
      })
      expect(reopened.status).toBe('open')
      // Setting the status it has changes nothing.
      expect((await as('jon').setGapStatus({ id: id(4), status: 'open' })).status).toBe('open')
    })

    it('records the live edition when a gap is resolved, and clears it when the gap leaves resolved', async () => {
      const resolved = await as('jon').getGap(id(1))
      expect(resolved).toMatchObject({
        status: 'resolved',
        verifiedAt: null,
        verifiedEdition: null,
      })
      expect(resolved?.resolvedEdition).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
      expect(resolved?.history?.at(-1)).toMatchObject({
        action: 'gap.status_changed',
        details: {
          from: 'open',
          to: 'resolved',
          edition: resolved?.resolvedEdition,
          reason: 'The event item covers the August pause.',
        },
      })
      expect(resolved?.history?.at(-1)?.hour).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/)
      // Every reader sees the edition, and still no tests.
      expect(await as('maria').getGap(id(1))).toMatchObject({
        resolvedEdition: resolved?.resolvedEdition,
        tests: null,
      })

      const reopened = await as('jon').setGapStatus({ id: id(1), status: 'open' })
      expect(reopened).toMatchObject({ status: 'open', resolvedEdition: null, verifiedAt: null })
      expect(reopened.tests?.map((test) => [test.question, test.passed])).toEqual([
        ['conformance-gap-checkout', null],
      ])
      expect(reopened.history?.slice(-2)).toEqual([
        expect.objectContaining({
          action: 'gap.status_changed',
          details: { from: 'resolved', to: 'open' },
        }),
        expect.objectContaining({ action: 'gap.verification_cleared', details: {} }),
      ])
      // A gap marked won't fix records no edition.
      expect(await as('jon').setGapStatus({ id: id(2), status: 'wont_fix' })).toMatchObject({
        status: 'wont_fix',
        resolvedEdition: null,
      })
    })

    it('starts a draft from a gap with the topic filled in, and needs an area for a topic that spans areas', async () => {
      expect((await refusal(as('maria').startDraftFromGap({ id: id(5) }))).kind).toBe('bad-request')
      const draft = await as('maria').startDraftFromGap({ id: id(5), areaId: 'area_marketing' })
      expect(draft).toMatchObject({ state: 'draft', areaId: 'area_marketing', channel: 'form' })
      expect(draft.draft.scope).toEqual({
        metrics: ['metric:active_customers', 'metric:marketing_spend'],
        dimensions: [],
        dimensionValues: [],
      })
      // The topic's month is when people asked, not when the fact applies: no dates.
      expect(draft.draft).not.toHaveProperty('validity')
      const gap = await as('maria').getGap(id(5))
      expect(gap).toMatchObject({ status: 'proposal_made', proposals: [draft.id] })
      expect((await as('ravi').getGap(id(5)))?.history?.at(-1)).toMatchObject({
        action: 'gap.draft_started',
        details: { proposal: draft.id },
      })

      // A discarded draft leaves the gap's list; the gap keeps its status. The draft is read
      // again first: the service links it to the gap after answering, which moves its revision on.
      const current = await as('maria').getProposal(draft.id)
      await as('maria').discardDraft({ id: draft.id, revision: current!.revision })
      expect(await as('maria').getGap(id(5))).toMatchObject({
        status: 'proposal_made',
        proposals: [],
      })
    })

    it("counts a person's report against the topic's gap, as report_gap does, and names no one", async () => {
      const scope = {
        metrics: ['metric:orders'],
        dimension_filters: [{ dimension: 'dim:market', values: ['val:market/poland'] }],
        window: { from: '2026-10-01', to: '2026-10-07' },
      }
      const first = await as('maria').reportGap({
        ...scope,
        type: 'missing',
        note: 'Nothing about the Poland launch.',
      })
      const second = await as('jon').reportGap({ ...scope, type: 'missing' })
      expect(second.id).toBe(first.id)
      // Orders has no area in the vocabulary; Cube gives it Sales, so the topic is
      // Sales's (CON-206) and its owners manage it. Two reports are below the minimum, so
      // nobody else sees the gap.
      expect(await as('ravi').getGap(first.id)).toMatchObject({
        type: 'missing',
        status: 'open',
        openedBy: 'person',
        canManage: true,
        reports: 2,
        personReports: 2,
        noItemCalls: 0,
        topic: {
          areaId: 'area_sales',
          areaIds: ['area_sales'],
          metrics: ['metric:orders'],
          dimensions: [],
          dimensionValues: [{ dimension: 'dim:market', value: 'val:market/poland' }],
          month: '2026-10-01',
        },
        notes: [
          expect.objectContaining({ source: 'person', note: 'Nothing about the Poland launch.' }),
        ],
      })
      expect(await as('maria').getGap(first.id)).toBeNull()
      expect(await as('jon').getGap(first.id)).toMatchObject({ canManage: true, reports: 2 })
      // Another type is another gap.
      const outdated = await as('sofia').reportGap({ ...scope, type: 'outdated' })
      expect(outdated.id).not.toBe(first.id)
      // A scope without dates is read at today, as get_facts reads it: this month's topic.
      const { window: _window, ...dateless } = scope
      const today = await as('sofia').reportGap({ ...dateless, type: 'missing' })
      expect(today.id).toBe(first.id)
      expect(await as('jon').getGap(first.id)).toMatchObject({ reports: 3, personReports: 3 })
    })

    it('refuses a report whose scope get_facts would not resolve, or whose note is personal', async () => {
      const unknown = await refusal(
        as('maria').reportGap({
          metrics: ['metric:nothing_like_this'],
          window: { from: '2026-10-01', to: '2026-10-07' },
          type: 'missing',
        }),
      )
      expect(unknown.kind).toBe('invalid')
      expect(unknown.findings.map((finding) => finding.code)).toContain('unknown_term')
      const personal = await refusal(
        as('maria').reportGap({
          metrics: ['metric:orders'],
          window: { from: '2026-10-01', to: '2026-10-07' },
          type: 'missing',
          note: 'Ask maria@example.com',
        }),
      )
      expect(personal.kind).toBe('invalid')
      expect(personal.findings.map((finding) => finding.code)).toEqual(['email_address'])
    })

    it("attaches a gap's linked development tests to a draft started from it (FR-524)", async () => {
      const draft = await as('maria').startDraftFromGap({ id: id(1) })
      expect(draft.areaId).toBe('area_sales')
      expect(
        (await as('maria').listProposalTests(draft.id)).map((test) => [test.question, test.active]),
      ).toEqual([['conformance-gap-checkout', true]])
    })
  })
}
