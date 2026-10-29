/**
 * The write side of the `ContextApi` conformance suite: proposals, review and editions, played by
 * several people. The same steps run against the mock binding (tests/unit) and against the http
 * binding on the real service and PostgreSQL (tests/integration), so the mock's state machine
 * keeps the service's rules. Ids, times and edition labels differ between the two and are not
 * compared; everything a screen branches on is.
 *
 * The people are the fixture's: Maria writes, Jon is owner of Sales and Sandbox, Sofia is
 * Sales's second owner, Lars is the high-risk approver of Sales, Ravi is an administrator
 * and Kofi has no role.
 */
import { describe, expect, it } from 'vitest'
import type { ContextApi, Edition, LibraryItem, ProposalRecord } from '../../src/web/api/client.ts'
import { ApiError } from '../../src/web/api/errors.ts'
import { proposalRecordSchema } from '../../src/contract/proposals.ts'
import { appFamilies } from '../../src/domain/app-family.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { shiftDate } from '../../src/domain/validity.ts'
import { FIXTURE_TODAY } from '../../db/seed/fixtures/reference-data.ts'

export const conformancePeople = ['maria', 'jon', 'sofia', 'lars', 'ravi', 'kofi'] as const
export type ConformancePerson = (typeof conformancePeople)[number]
export type SignedIn = Record<ConformancePerson, ContextApi>

export type WriteConformanceOptions = {
  /** The binding's id for a fixture person, for example `per_maria`. */
  personId: (fixtureId: string) => string
}

/** Resolves to the `ApiError` a call is refused with; fails the test when it succeeds. */
async function refusal(call: Promise<unknown>): Promise<ApiError> {
  try {
    await call
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error('Expected the call to be refused')
}

function norway(extra: Draft = {}): Draft {
  return {
    areaId: 'area_sandbox',
    title: 'Norway closure',
    summary: 'Online sales to Norway stopped',
    scope: {
      metrics: ['metric:orders'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    },
    validity: { start: '2026-08-04', end: null },
    evidence: [
      { url: 'https://example.test/law', quote: 'Online sales stopped', date: '2026-08-04' },
    ],
    ...extra,
  }
}

/** Jon and Sofia are owners of Sales; Lars is its high-risk approver. */
const sales = (extra: Draft = {}) => norway({ areaId: 'area_sales', ...extra })

export function describeContextApiWrites(
  name: string,
  getApis: () => SignedIn,
  { personId }: WriteConformanceOptions,
) {
  const as = (person: ConformancePerson) => getApis()[person]
  const id = (person: ConformancePerson) => personId(`per_${person}`)

  async function submitted(by: ConformancePerson, draft: Draft): Promise<ProposalRecord> {
    const created = await as(by).createProposal({ draft })
    return as(by).submitProposal({ id: created.id, revision: created.revision })
  }

  describe(`ContextApi writes conformance: ${name}`, () => {
    it("reads each person's roles from the session", async () => {
      const permissions = async (person: ConformancePerson) =>
        (await as(person).getSession()).person.permissions
      expect((await as('jon').getSession()).person).toMatchObject({
        id: id('jon'),
        name: 'Jon Abara',
      })
      expect(await permissions('maria')).toEqual({ roles: [], assignments: [] })
      expect(await permissions('jon')).toEqual({
        roles: [],
        assignments: [
          { areaId: 'area_sales', role: 'owner' },
          { areaId: 'area_sandbox', role: 'owner' },
        ],
      })
      expect(await permissions('sofia')).toEqual({
        roles: [],
        assignments: [{ areaId: 'area_sales', role: 'owner' }],
      })
      expect(await permissions('lars')).toEqual({
        roles: [],
        assignments: [{ areaId: 'area_sales', role: 'approver' }],
      })
      expect(await permissions('ravi')).toEqual({ roles: ['administrator'], assignments: [] })
    })

    let proposal: ProposalRecord

    it('creates a draft with the defaults of its area', async () => {
      expect(
        await refusal(as('maria').createProposal({ draft: { title: 'Nowhere' } })),
      ).toMatchObject({ kind: 'invalid', status: 422 })
      proposal = await as('maria').createProposal({ draft: sales() })
      expect(proposal).toMatchObject({
        action: 'create',
        state: 'draft',
        areaId: 'area_sales',
        itemId: null,
        itemVersionId: null,
        proposerId: id('maria'),
        channel: 'form',
        revision: 1,
        findings: [],
        claimedBy: null,
        dueAt: null,
      })
      expect(proposal.draft).toMatchObject({
        kind: 'note',
        riskLevel: 'low',
        claimLevel: 'fact_only',
        ownerId: id('jon'),
        notToConclude: 'cause not proven',
        reviewDate: shiftDate(FIXTURE_TODAY, 90),
      })
      expect(await as('maria').getProposal(proposal.id)).toMatchObject({
        id: proposal.id,
        revision: 1,
      })
    })

    it('saves level 1 findings with a draft, and refuses sensitive text', async () => {
      const unknown = await as('maria').createProposal({
        draft: norway({
          scope: { metrics: ['metric:not_a_metric'], dimensions: [], dimensionValues: [] },
        }),
      })
      expect(unknown.findings).toContainEqual(
        expect.objectContaining({ code: 'unknown_scope', severity: 'error' }),
      )
      const sensitive = await refusal(
        as('maria').createProposal({ draft: norway({ summary: 'Mail jon@example.com' }) }),
      )
      expect(sensitive.kind).toBe('invalid')
      expect(sensitive.findings).toContainEqual(
        expect.objectContaining({ code: 'email_address', severity: 'error' }),
      )
    })

    it('refuses a change made on an old revision, and sends the current proposal', async () => {
      const conflict = await refusal(
        as('maria').saveDraft({ id: proposal.id, revision: 9, draft: sales() }),
      )
      expect(conflict).toMatchObject({ kind: 'conflict', status: 409 })
      expect(conflict.current).toMatchObject({ id: proposal.id, revision: 1, state: 'draft' })

      proposal = await as('maria').saveDraft({
        id: proposal.id,
        revision: 1,
        draft: sales({ title: 'Norway closed for online sales' }),
      })
      expect(proposal).toMatchObject({ revision: 2, state: 'draft' })
      expect(proposal.draft.title).toBe('Norway closed for online sales')
    })

    it('keeps what is wrong with the current version on a change, and only on a change', async () => {
      const library = await as('maria').listLibrary()
      const target = library.items.find(
        (item) => item.areaId === 'area_sandbox' && item.status === 'accepted',
      )!
      let change = await as('maria').createProposal({
        itemId: target.id,
        draft: {},
        reason: '  The end date is a week late  ',
      })
      expect(change).toMatchObject({ action: 'change', reason: 'The end date is a week late' })
      // Left out, the reason stays; empty, it is cleared.
      change = await as('maria').saveDraft({
        id: change.id,
        revision: change.revision,
        draft: change.draft,
      })
      expect(change.reason).toBe('The end date is a week late')
      const sensitive = await refusal(
        as('maria').saveDraft({
          id: change.id,
          revision: change.revision,
          draft: change.draft,
          reason: 'Ask jon@example.com',
        }),
      )
      expect(sensitive.kind).toBe('invalid')
      expect(sensitive.findings).toContainEqual(
        expect.objectContaining({ code: 'email_address', severity: 'error' }),
      )
      expect(
        await refusal(
          as('maria').saveDraft({
            id: change.id,
            revision: change.revision,
            draft: change.draft,
            reason: 'See @[Orders](metric:orders)',
          }),
        ),
      ).toMatchObject({ kind: 'invalid', status: 422 })
      change = await as('maria').saveDraft({
        id: change.id,
        revision: change.revision,
        draft: change.draft,
        reason: ' ',
      })
      expect(change.reason).toBeNull()
      expect(
        await refusal(
          as('maria').createProposal({ draft: norway(), reason: 'Nothing is there yet' }),
        ),
      ).toMatchObject({ kind: 'invalid', status: 422 })
      await as('maria').discardDraft({ id: change.id, revision: change.revision })
    })

    it('refuses to submit a draft with format errors, naming them', async () => {
      const incomplete = await as('maria').createProposal({ draft: norway({ evidence: [] }) })
      const error = await refusal(
        as('maria').submitProposal({ id: incomplete.id, revision: incomplete.revision }),
      )
      expect(error.kind).toBe('invalid')
      expect(error.findings).toContainEqual(
        expect.objectContaining({ field: 'evidence', severity: 'error' }),
      )
      // A person without a role cannot even see someone else's draft.
      expect(await as('kofi').getProposal(incomplete.id)).toBeNull()
    })

    it('previews what an agent would get from a draft, for its own and for another day', async () => {
      const question = {
        id: proposal.id,
        question: '',
        metrics: ['metric:orders'],
        dimension_filters: [{ dimension: 'dim:market', values: ['val:market/norway'] }],
      }
      const during = await as('maria').previewProposal({
        ...question,
        window: { from: '2026-08-04', to: '2026-08-04' },
      })
      expect(during).toMatchObject({ proposalId: proposal.id, revision: proposal.revision })
      expect(during.result).toMatchObject({
        status: 'matched',
        items: expect.arrayContaining([
          expect.objectContaining({ title: 'Norway closed for online sales' }),
        ]) as unknown,
      })
      const before = await as('maria').previewProposal({
        ...question,
        window: { from: '2026-08-01', to: '2026-08-01' },
      })
      expect(JSON.stringify(before.result)).not.toContain('Norway closed for online sales')
      const incomplete = await as('maria').createProposal({ draft: { areaId: 'area_sales' } })
      expect(
        await refusal(as('maria').previewProposal({ ...question, id: incomplete.id })),
      ).toMatchObject({ kind: 'invalid', status: 422 })
    })

    it("lists overlapping drafts by title for their writer, and only a yes for others'", async () => {
      const second = await as('maria').createProposal({
        draft: sales({ title: 'Norway follow-up' }),
      })
      const own = await as('maria').getProposalOverlap(second.id)
      expect(own.ownProposals).toContainEqual({
        id: proposal.id,
        number: proposal.number,
        title: 'Norway closed for online sales',
        kind: 'note',
        state: 'draft',
      })
      expect(own.ownProposals.map((row) => row.id)).not.toContain(second.id)
      expect(own.otherProposalExists).toBe(false)
      const jons = await as('jon').createProposal({ draft: sales({ title: "Jon's note" }) })
      const other = await as('jon').getProposalOverlap(jons.id)
      expect(other.ownProposals).toEqual([])
      // A draft stays with its writer, even for the owner of its area.
      expect(other.otherProposals).toEqual([])
      expect(other.otherProposalExists).toBe(true)
      expect(JSON.stringify(other)).not.toContain('Norway closed for online sales')
    })

    it("submits into the owner's queue, and keeps it from people without a role", async () => {
      proposal = await as('maria').submitProposal({ id: proposal.id, revision: 2 })
      expect(proposal).toMatchObject({ state: 'submitted', revision: 3, claimedBy: null })
      expect(proposal.itemId).toMatch(/^itm_[a-z0-9]{8,16}$/)
      expect(proposal.itemVersionId).toEqual(expect.any(String))
      expect(proposal.dueAt).toEqual(expect.any(String))

      expect((await as('jon').listReviewQueue()).map((row) => row.id)).toContain(proposal.id)
      expect(await as('maria').listReviewQueue()).toEqual([])
      expect((await as('lars').listReviewQueue()).map((row) => row.id)).not.toContain(proposal.id)
      expect(await as('kofi').getProposal(proposal.id)).toBeNull()
      expect(await as('kofi').getReview(proposal.id)).toBeNull()
      expect(await as('ravi').getProposal(proposal.id)).toMatchObject({ id: proposal.id })
      expect((await as('maria').listProposals({ own: true })).rows.map((row) => row.id)).toContain(
        proposal.id,
      )
      expect(
        await refusal(as('maria').claimProposal({ id: proposal.id, revision: 3 })),
      ).toMatchObject({ kind: 'forbidden', status: 403 })
    })

    it("names the proposal by its number and title in the history log's entries", async () => {
      const { entries } = await as('ravi').searchAudit({
        subjectType: 'proposal',
        subjectId: proposal.id,
      })
      expect(entries.map((entry) => entry.action)).toEqual(
        expect.arrayContaining(['proposal.submitted', 'proposal.checked']),
      )
      for (const entry of entries)
        expect(entry).toMatchObject({
          subjectNumber: proposal.number,
          subjectTitle: proposal.draft.title,
        })
      // Heed ran the checks; the entry still names the person who submitted (FR-806).
      expect(entries.find((entry) => entry.action === 'proposal.checked')).toMatchObject({
        actorId: id('maria'),
        actorKind: 'person',
      })
      // The export is the log itself, without the screen's names for the subject.
      const exported = await as('ravi').exportAudit({ subjectId: proposal.id })
      expect(exported.content).not.toContain('subjectTitle')
    })

    it('lists overlapping proposals with titles and kinds for a reviewer of their area only', async () => {
      const jons = await as('jon').createProposal({
        draft: sales({ kind: 'event', title: 'Norway event, from the owner' }),
      })
      const reviewer = await as('jon').getProposalOverlap(jons.id)
      expect(reviewer.otherProposals).toContainEqual({
        id: proposal.id,
        number: proposal.number,
        title: 'Norway closed for online sales',
        kind: 'note',
        state: 'submitted',
      })
      expect(reviewer.ownProposals).toContainEqual(
        expect.objectContaining({ title: "Jon's note", kind: 'note', state: 'draft' }),
      )
      expect(reviewer.otherProposalExists).toBe(true)
      // The writer has no role: they learn that others overlap, never which.
      const writer = await as('maria').getProposalOverlap(proposal.id)
      expect(writer.otherProposals).toEqual([])
      expect(writer.otherProposalExists).toBe(true)
      await as('jon').discardDraft({ id: jons.id, revision: jons.revision })
    })

    it('shows the review: the diff, the checks and the question for the source tool', async () => {
      const review = await as('jon').getReview(proposal.id)
      expect(review?.proposal).toMatchObject({
        id: proposal.id,
        subject: 'item',
        action: 'create',
        state: 'submitted',
        riskLevel: 'low',
        title: 'Norway closed for online sales',
        revision: 3,
      })
      expect(review?.gate).toMatchObject({
        required: ['format', 'matching', 'delivery'],
        approvals: { owner: false, approver: null },
      })
      expect(review?.gate?.levels.map((level) => [level.level, level.outcome])).toEqual([
        ['format', 'passed'],
        ['matching', 'passed'],
        ['delivery', 'passed'],
      ])
      expect(review?.diff.map((change) => change.field)).toContain('title')
      expect(review?.diff.every((change) => change.before === null)).toBe(true)
      expect(review?.sourceToolQuestion).toMatch(/belongs in the source tool/)
      expect(review?.decisions).toEqual([])
      expect(
        (await as('maria').listProposalEvents(proposal.id)).map((event) => event.kind),
      ).toEqual(['created', 'saved', 'submitted', 'checked', 'checked'])
    })

    it('records comments, which move the revision on', async () => {
      proposal = await as('maria').commentOnProposal({
        id: proposal.id,
        revision: 3,
        text: 'The regulator confirmed it by phone.',
      })
      expect(proposal.revision).toBe(4)
      const events = await as('jon').listProposalEvents(proposal.id)
      expect(events.at(-1)).toMatchObject({
        kind: 'commented',
        actorId: id('maria'),
        data: { text: 'The regulator confirmed it by phone.' },
      })
      expect(
        await refusal(
          as('maria').commentOnProposal({
            id: proposal.id,
            revision: 4,
            text: 'See @[Orders](metric:orders)',
          }),
        ),
      ).toMatchObject({ kind: 'invalid' })
    })

    it('lets an owner claim and hand over, and only the holder decides', async () => {
      proposal = await as('jon').claimProposal({ id: proposal.id, revision: 4 })
      expect(proposal).toMatchObject({ state: 'in_review', claimedBy: id('jon'), revision: 5 })
      proposal = await as('jon').handOverProposal({
        id: proposal.id,
        revision: 5,
        personId: id('sofia'),
      })
      expect(proposal).toMatchObject({ claimedBy: id('sofia'), revision: 6 })
      expect(
        await refusal(
          as('jon').decide({ id: proposal.id, revision: 6, outcome: 'accept', reason: 'Fine' }),
        ),
      ).toMatchObject({ kind: 'conflict' })
      // An owner of another area cannot take it: Sofia is no owner of Jon's Sandbox.
      const sandbox = await submitted('maria', norway({ title: 'Sandbox note' }))
      const claimed = await as('jon').claimProposal({ id: sandbox.id, revision: sandbox.revision })
      expect(
        await refusal(
          as('jon').handOverProposal({
            id: sandbox.id,
            revision: claimed.revision,
            personId: id('sofia'),
          }),
        ),
      ).toMatchObject({ kind: 'forbidden' })

      const decided = await as('sofia').decide({
        id: proposal.id,
        revision: 6,
        outcome: 'request_changes',
        reason: 'Name the source',
      })
      expect(decided).toMatchObject({
        proposal: { state: 'changes_requested', revision: 7, claimedBy: null },
        edition: null,
      })
      expect((await as('maria').getReview(proposal.id))?.decisions).toEqual([
        expect.objectContaining({
          decidedBy: id('sofia'),
          capacity: 'owner',
          outcome: 'request_changes',
          reason: 'Name the source',
        }),
      ])
    })

    it('asks for changes, takes a new version and accepts it into a new edition', async () => {
      // In Sales, the domain Cube gives Orders: elsewhere the format check warns about the
      // domain (`domain_mismatch`), which the reviewer reads and which never blocks (FR-505).
      const other = await submitted('maria', sales({ title: 'Spain note' }))
      const changes = await as('jon').decide({
        id: other.id,
        revision: other.revision,
        outcome: 'request_changes',
        reason: 'Name the regulator',
      })
      expect(changes).toMatchObject({
        proposal: { state: 'changes_requested', revision: other.revision + 1 },
        edition: null,
      })
      const saved = await as('maria').saveDraft({
        id: other.id,
        revision: other.revision + 1,
        draft: sales({ title: 'Spain note, regulator named' }),
      })
      // While Maria edits, there is nothing since the request yet.
      expect((await as('jon').getReview(other.id))?.sinceRequest).toBeNull()
      const again = await as('maria').submitProposal({ id: other.id, revision: saved.revision })
      expect(again).toMatchObject({ state: 'submitted', claimedBy: null, itemId: other.itemId })
      expect(again.itemVersionId).not.toBe(other.itemVersionId)
      // The resubmission reads as what changed since the request (heed-ux B2).
      const resubmitted = (await as('jon').getReview(other.id))!
      expect(resubmitted.sinceRequest).toEqual({
        decisionId: resubmitted.decisions[0]!.id,
        diff: [{ field: 'title', before: 'Spain note', after: 'Spain note, regulator named' }],
      })
      expect(resubmitted.diff.length).toBeGreaterThan(1)

      expect(
        await refusal(
          as('jon').decide({
            id: other.id,
            revision: saved.revision,
            outcome: 'accept',
            reason: 'Fine',
          }),
        ),
      ).toMatchObject({ kind: 'conflict' })
      const accepted = await as('jon').decide({
        id: other.id,
        revision: again.revision,
        outcome: 'accept',
        reason: 'Checked against the evidence',
      })
      expect(accepted.proposal).toMatchObject({ state: 'accepted', revision: again.revision + 1 })
      expect(accepted.proposal.closedAt).toEqual(expect.any(String))
      expect(accepted.edition).toMatchObject({
        reason: 'proposal_accepted',
        actorId: id('jon'),
        live: true,
      })
      expect(accepted.edition?.label).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
      const [latest, before] = await as('sofia').listEditions({ limit: 2 })
      expect(latest).toMatchObject({ label: accepted.edition?.label, live: true })
      expect(before?.live).toBe(false)

      const review = await as('maria').getReview(other.id)
      expect(review?.decisions.map((d) => [d.decidedBy, d.capacity, d.outcome])).toEqual([
        [id('jon'), 'owner', 'request_changes'],
        [id('jon'), 'owner', 'accept'],
      ])
    })

    it('says when nothing changed since the request for changes', async () => {
      const first = await submitted('maria', sales({ title: 'Poland note' }))
      const asked = await as('jon').decide({
        id: first.id,
        revision: first.revision,
        outcome: 'request_changes',
        reason: 'Name the regulator',
      })
      const again = await as('maria').submitProposal({
        id: first.id,
        revision: asked.proposal.revision,
      })
      const review = (await as('sofia').getReview(again.id))!
      expect(review.sinceRequest).toEqual({ decisionId: review.decisions[0]!.id, diff: [] })
      // Once it is decided, the review reads as the whole proposal again.
      await as('jon').decide({
        id: again.id,
        revision: again.revision,
        outcome: 'reject',
        reason: 'Nothing was named',
      })
      expect((await as('sofia').getReview(again.id))?.sinceRequest).toBeNull()
    })

    it('lets an owner of the area and an administrator decide their own proposal (FR-206)', async () => {
      // Jon, an owner of Sales, accepts his own normal-risk event there.
      const own = await submitted('jon', sales({ kind: 'event', title: 'Sales event' }))
      expect(own.draft.riskLevel).toBe('normal')
      expect((await as('jon').listReviewQueue()).map((row) => row.id)).toContain(own.id)
      const accepted = await as('jon').decide({
        id: own.id,
        revision: own.revision,
        outcome: 'accept',
        reason: 'Checked',
      })
      expect(accepted.proposal.state).toBe('accepted')
      expect(accepted.edition?.live).toBe(true)
      const timeline = await as('jon').listProposalEvents(own.id)
      expect(timeline.find((event) => event.kind === 'decided')?.data).toMatchObject({
        capacity: 'owner',
        byProposer: true,
      })

      // Ravi, an administrator with no role in Sales, sees his own in To review and accepts
      // it as administrator.
      const admins = await submitted('ravi', sales({ kind: 'event', title: 'Admin event' }))
      expect((await as('ravi').listReviewQueue()).map((row) => row.id)).toContain(admins.id)
      const byAdmin = await as('ravi').decide({
        id: admins.id,
        revision: admins.revision,
        outcome: 'accept',
        reason: 'Checked',
      })
      expect(byAdmin.proposal.state).toBe('accepted')
      expect(
        (await as('ravi').getReview(admins.id))?.decisions.map((d) => [d.decidedBy, d.capacity]),
      ).toEqual([[id('ravi'), 'administrator']])
    })

    it('keeps everyone else from deciding their own proposal (FR-206)', async () => {
      // An owner of another domain, a contributor and an approver who is neither.
      const elsewhere = await submitted(
        'jon',
        norway({ areaId: 'area_marketing', title: 'Marketing note of Jon' }),
      )
      const kofis = await submitted('kofi', sales({ title: 'Kofi note' }))
      const larss = await submitted(
        'lars',
        sales({ kind: 'event', riskLevel: 'high', title: 'Lars event' }),
      )
      for (const [person, p] of [
        ['jon', elsewhere],
        ['kofi', kofis],
        ['lars', larss],
      ] as const)
        expect(
          await refusal(
            as(person).decide({
              id: p.id,
              revision: p.revision,
              outcome: 'accept',
              reason: 'Mine',
            }),
          ),
        ).toMatchObject({ kind: 'forbidden' })
    })

    it('publishes a high-risk proposal on one accept, after levels 1 to 3 (FR-513)', async () => {
      const high = await submitted(
        'maria',
        sales({ kind: 'event', riskLevel: 'high', title: 'High' }),
      )
      // An approver no longer decides anything, so it is not in their queue either.
      expect((await as('lars').listReviewQueue()).map((row) => row.id)).not.toContain(high.id)
      expect(
        await refusal(
          as('lars').decide({
            id: high.id,
            revision: high.revision,
            outcome: 'accept',
            reason: 'Fine',
          }),
        ),
      ).toMatchObject({ kind: 'forbidden' })
      const review = await as('jon').getReview(high.id)
      expect(review?.gate?.required).toEqual(['format', 'matching', 'delivery'])
      expect(review?.gate?.approvals).toEqual({ owner: false, approver: null })
      const decided = await as('jon').decide({
        id: high.id,
        revision: review!.proposal.revision,
        outcome: 'accept',
        reason: 'Fine',
      })
      expect(decided.proposal.state).toBe('accepted')
      expect(decided.edition?.live).toBe(true)
    })

    it('lets an owner change risk, review date, claim and owner in review, and checks again', async () => {
      const note = await submitted('maria', sales({ title: 'Edited in review' }))
      const edit = { id: note.id, revision: note.revision }
      // An owner of the area: never the proposer, an approver or someone without a role.
      for (const [person, kind] of [
        ['maria', 'forbidden'],
        ['lars', 'forbidden'],
        ['ravi', 'forbidden'],
        ['kofi', 'not-found'],
      ] as const)
        expect(await refusal(as(person).editReview({ ...edit, riskLevel: 'high' }))).toMatchObject({
          kind,
        })
      expect(
        await refusal(
          as('jon').editReview({ ...edit, revision: note.revision - 1, riskLevel: 'high' }),
        ),
      ).toMatchObject({ kind: 'conflict' })
      expect(await refusal(as('jon').editReview({ ...edit, riskLevel: 'low' }))).toMatchObject({
        kind: 'invalid',
        status: 422,
      })
      const notOwner = await refusal(as('jon').editReview({ ...edit, ownerId: id('kofi') }))
      expect(notOwner).toMatchObject({ kind: 'invalid' })
      expect(notOwner.findings).toContainEqual(expect.objectContaining({ code: 'owner' }))

      const reviewDate = shiftDate(FIXTURE_TODAY, 30)
      const raised = await as('jon').editReview({
        ...edit,
        riskLevel: 'high',
        reviewDate,
        claim: {
          level: 'effect_stated',
          authority: 'Norway Customs Office',
          quote: 'All online sales are paused',
        },
        ownerId: id('sofia'),
        reason: 'The regulator states the effect',
      })
      expect(raised.proposal).toMatchObject({
        state: 'submitted',
        riskLevel: 'high',
        proposerId: id('maria'),
        itemId: note.itemId,
        revision: note.revision + 1,
      })
      expect(raised.proposal.itemVersionId).not.toBe(note.itemVersionId)
      // A higher risk needs the same three levels and no approver; the earlier version's checks
      // do not count (FR-513).
      expect(raised.gate?.required).toEqual(['format', 'matching', 'delivery'])
      expect(raised.gate?.approvals).toEqual({ owner: false, approver: null })
      expect(
        raised.gate?.levels
          .filter((level) => ['format', 'matching', 'delivery'].includes(level.level))
          .map((level) => level.outcome),
      ).toEqual(['passed', 'passed', 'passed'])
      const after = (field: string) => raised.diff.find((change) => change.field === field)?.after
      expect([after('riskLevel'), after('reviewDate'), after('claimLevel')]).toEqual([
        'high',
        reviewDate,
        'effect_stated',
      ])
      expect((await as('lars').listReviewQueue()).map((row) => row.id)).not.toContain(note.id)

      const events = await as('maria').listProposalEvents(note.id)
      const edited = events.findIndex((event) => event.kind === 'edited')
      // The checks run again on the changed version.
      expect(events[edited + 1]?.kind).toBe('checked')
      expect(events[edited]).toMatchObject({
        actorId: id('jon'),
        data: {
          versionId: raised.proposal.itemVersionId,
          replaces: note.itemVersionId,
          reason: 'The regulator states the effect',
          changes: {
            riskLevel: { before: 'low', after: 'high' },
            claimLevel: { before: 'fact_only', after: 'effect_stated' },
            ownerId: { before: id('jon'), after: id('sofia') },
          },
        },
      })
      // The writer's draft follows, so a resubmission after "ask for changes" keeps the change.
      expect((await as('maria').getProposal(note.id))?.draft).toMatchObject({
        riskLevel: 'high',
        reviewDate,
        claimLevel: 'effect_stated',
        claimAuthority: 'Norway Customs Office',
        ownerId: id('sofia'),
      })

      // Only the holder of a claim changes it; the holder can lower it again.
      const claimed = await as('sofia').claimProposal({
        id: note.id,
        revision: raised.proposal.revision,
      })
      expect(
        await refusal(
          as('jon').editReview({ id: note.id, revision: claimed.revision, riskLevel: 'normal' }),
        ),
      ).toMatchObject({ kind: 'conflict' })
      const lowered = await as('sofia').editReview({
        id: note.id,
        revision: claimed.revision,
        riskLevel: 'normal',
        claim: { level: 'fact_only' },
      })
      expect(lowered.proposal).toMatchObject({
        state: 'in_review',
        claimedBy: id('sofia'),
        riskLevel: 'normal',
      })
      expect(lowered.gate?.required).toEqual(['format', 'matching', 'delivery'])
      expect((await as('maria').getProposal(note.id))?.draft).not.toHaveProperty('claimAuthority')
    })

    it('moves a proposal to another area only for an owner of both, to its owner', async () => {
      const note = await submitted('maria', sales({ title: 'Belongs in the sandbox' }))
      // Sofia is owner of Sales only.
      expect(
        await refusal(
          as('sofia').editReview({
            id: note.id,
            revision: note.revision,
            areaId: 'area_sandbox',
          }),
        ),
      ).toMatchObject({ kind: 'forbidden' })
      const moved = await as('jon').editReview({
        id: note.id,
        revision: note.revision,
        areaId: 'area_sandbox',
      })
      expect(moved.proposal).toMatchObject({ areaId: 'area_sandbox', state: 'submitted' })
      expect(moved.diff.find((change) => change.field === 'areaId')?.after).toBe('area_sandbox')
      expect(
        (await as('jon').listReviewQueue({ areaId: 'area_sandbox' })).map((row) => row.id),
      ).toContain(note.id)
      expect((await as('sofia').listReviewQueue()).map((row) => row.id)).not.toContain(note.id)
      expect((await as('maria').getProposal(note.id))?.areaId).toBe('area_sandbox')
    })

    it('withdraws a submitted proposal, never a draft', async () => {
      const draft = await as('maria').createProposal({ draft: norway({ title: 'Kept' }) })
      expect(
        await refusal(
          as('maria').withdrawProposal({ id: draft.id, revision: 1, reason: 'Not needed' }),
        ),
      ).toMatchObject({ kind: 'conflict' })
      const sent = await as('maria').submitProposal({ id: draft.id, revision: 1 })
      const withdrawn = await as('maria').withdrawProposal({
        id: sent.id,
        revision: sent.revision,
        reason: 'Not needed after all',
      })
      expect(withdrawn).toMatchObject({ state: 'withdrawn', revision: sent.revision + 1 })
      expect((await as('jon').listReviewQueue()).map((row) => row.id)).not.toContain(sent.id)
    })

    it('discards a draft for its author or an administrator, never a sent proposal', async () => {
      const draft = await as('maria').createProposal({ draft: norway({ title: 'Abandoned' }) })
      expect(
        await refusal(as('jon').discardDraft({ id: draft.id, revision: draft.revision })),
      ).toMatchObject({ kind: 'forbidden', status: 403 })
      expect(
        await refusal(as('kofi').discardDraft({ id: draft.id, revision: draft.revision })),
      ).toMatchObject({ kind: 'not-found', status: 404 })
      expect(await as('maria').discardDraft({ id: draft.id, revision: draft.revision })).toEqual({
        id: draft.id,
        discardedAt: expect.any(String) as unknown,
      })
      expect(await as('maria').getProposal(draft.id)).toBeNull()
      expect(await as('maria').listProposalEvents(draft.id)).toEqual([])
      expect(
        (await as('maria').listProposals({ own: true })).rows.map((row) => row.id),
      ).not.toContain(draft.id)
      expect(
        await refusal(as('maria').discardDraft({ id: draft.id, revision: draft.revision + 1 })),
      ).toMatchObject({ kind: 'not-found' })

      const left = await as('maria').createProposal({ draft: norway({ title: 'Left' }) })
      await as('ravi').discardDraft({ id: left.id, revision: left.revision })
      expect(await as('maria').getProposal(left.id)).toBeNull()

      const sent = await submitted('maria', norway({ title: 'Sent' }))
      expect(
        await refusal(as('maria').discardDraft({ id: sent.id, revision: sent.revision })),
      ).toMatchObject({ kind: 'conflict', status: 409 })
      expect(await as('maria').getProposal(sent.id)).toMatchObject({ state: 'submitted' })
    })

    it('lets only an administrator go back to an earlier edition', async () => {
      const [live, earlier] = await as('ravi').listEditions({ limit: 2 })
      expect(
        await refusal(as('jon').rollbackEdition({ label: earlier!.label, note: 'Undo' })),
      ).toMatchObject({ kind: 'forbidden' })
      expect(
        await refusal(as('ravi').rollbackEdition({ label: live!.label, note: 'Again' })),
      ).toMatchObject({ kind: 'conflict' })
      // What going back would change is read first, by an administrator only.
      expect(await refusal(as('jon').previewRollback(earlier!.label))).toMatchObject({
        kind: 'forbidden',
      })
      const preview = await as('ravi').previewRollback(earlier!.label)
      expect(preview).toMatchObject({
        live: { label: live!.label, live: true },
        target: { label: earlier!.label, live: false },
        comparison: {
          backwards: true,
          from: { label: live!.label },
          to: { label: earlier!.label },
        },
        blocked: [],
      })
      expect(preview.comparison.total).toBe(
        Object.values(preview.comparison.facets.change).reduce((sum, count) => sum + count, 0),
      )
      const restored = await as('ravi').rollbackEdition({
        label: earlier!.label,
        note: 'Back to the content before the last accept',
      })
      expect(restored).toMatchObject({
        reason: 'rollback',
        restores: earlier!.label,
        actorId: id('ravi'),
        live: true,
        digest: earlier!.digest,
      })
      expect((await as('sofia').listEditions({ limit: 1 }))[0]?.label).toBe(restored.label)
      // The history log keeps who went back and why, under the new edition.
      const { entries } = await as('ravi').searchAudit({
        action: 'edition.rollback',
        subjectId: restored.label,
      })
      expect(entries).toEqual([
        expect.objectContaining({
          actorId: id('ravi'),
          action: 'edition.rollback',
          subjectType: 'edition',
          subjectId: restored.label,
          details: expect.objectContaining({
            note: 'Back to the content before the last accept',
          }) as unknown,
        }),
      ])
    })

    it('says what an edition changed and exports it, for owners and administrators', async () => {
      const [live] = await as('jon').listEditions({ limit: 1 })
      const diff = await as('jon').diffEdition({ label: live!.label })
      expect(diff.to).toBe(live!.label)
      expect(diff.from).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
      for (const change of diff.items) {
        expect(change.id).toMatch(/^itm_[a-z0-9]{8,16}$/)
        expect(change.from !== change.to).toBe(true)
      }
      expect(await refusal(as('jon').diffEdition({ label: '2020-01-01.9' }))).toMatchObject({
        kind: 'not-found',
      })
      const exported = await as('sofia').exportEdition(live!.label)
      expect(exported).toMatchObject({
        format: 'heed.edition/1',
        edition: { label: live!.label },
        digest: live!.digest,
      })
      expect(exported.items.length).toBeGreaterThan(0)
      // Editions are run by the data platform team and the areas' owners (Quality design G13).
      for (const person of ['maria', 'lars', 'kofi'] as const) {
        expect(await refusal(as(person).listEditions({ limit: 1 }))).toMatchObject({
          kind: 'forbidden',
        })
        expect(await refusal(as(person).diffEdition({ label: live!.label }))).toMatchObject({
          kind: 'forbidden',
        })
        expect(await refusal(as(person).exportEdition(live!.label))).toMatchObject({
          kind: 'forbidden',
        })
      }
    })

    it('shows everyone which stops are on; only an administrator switches them', async () => {
      const stop = { scope: 'area', areaId: 'area_sales', reason: 'Wrong caveat' } as const
      expect(await refusal(as('jon').setStop({ ...stop, on: true }))).toMatchObject({
        kind: 'forbidden',
      })
      expect(
        await refusal(as('ravi').setStop({ scope: 'item', on: true, reason: 'No item' })),
      ).toMatchObject({ kind: 'bad-request' })
      const on = await as('ravi').setStop({ ...stop, on: true })
      try {
        expect(on).toEqual([
          {
            seq: expect.any(Number) as unknown,
            at: expect.any(String) as unknown,
            scope: 'area',
            areaId: 'area_sales',
            itemId: null,
            reason: 'Wrong caveat',
          },
        ])
        for (const person of ['maria', 'jon', 'kofi'] as const)
          expect(await as(person).listStops(), person).toEqual([
            {
              at: on[0]!.at,
              scope: 'area',
              areaId: 'area_sales',
              itemId: null,
              reason: 'Wrong caveat',
            },
          ])
        expect(await as('ravi').listStops()).toEqual(on)
      } finally {
        expect(await as('ravi').setStop({ ...stop, on: false, reason: 'Fixed' })).toEqual([])
      }
      expect(await as('maria').listStops()).toEqual([])
      // The history log keeps each switch with its reason, newest first.
      const { entries } = await as('ravi').searchAudit({
        action: 'stop',
        subjectId: 'area_sales',
        limit: 2,
      })
      expect(entries).toEqual([
        expect.objectContaining({
          actorId: id('ravi'),
          action: 'stop.off',
          areaId: 'area_sales',
          subjectType: 'area',
          details: { reason: 'Fixed' },
        }),
        expect.objectContaining({ action: 'stop.on', details: { reason: 'Wrong caveat' } }),
      ])
    })

    let retirement: { target: LibraryItem; edition: Edition }

    it('retires an item for an owner at once and lets anyone else propose it', async () => {
      const library = await as('maria').listLibrary()
      const target = library.items.find(
        (item) =>
          item.areaId === 'area_sales' &&
          item.status === 'accepted' &&
          item.kind === 'note' &&
          item.checkFlag === null,
      )!
      const proposed = await as('kofi').proposeRetirement({ id: target.id, reason: 'Ended' })
      const mine = await as('kofi').listProposals({ own: true, limit: 100 })
      expect(mine.rows.map((row) => row.id)).toContain(proposed.id)
      // The seeded review history can give a person more proposals than one page holds.
      expect(mine.rows).toHaveLength(Math.min(mine.total, 100))
      const read = await as('kofi').getProposal(proposed.id)
      expect(proposalRecordSchema.parse(read)).toEqual(read)
      expect(read).toMatchObject({
        subject: 'item',
        action: 'retire',
        title: target.title,
        reason: 'Ended',
      })
      expect(await as('maria').getProposal(proposed.id)).toBeNull()
      expect(await as('jon').getProposal(proposed.id)).toEqual(read)
      expect(await as('kofi').listProposals({ own: true, limit: 1, offset: mine.total })).toEqual({
        rows: [],
        total: mine.total,
        limit: 1,
        offset: mine.total,
      })
      expect(proposed).toMatchObject({
        action: 'retire',
        state: 'submitted',
        itemId: target.id,
        areaId: 'area_sales',
        proposerId: id('kofi'),
        reason: 'Ended',
      })
      expect(
        await refusal(as('maria').proposeRetirement({ id: target.id, reason: 'Ended too' })),
      ).toMatchObject({ kind: 'conflict' })
      expect(
        await refusal(as('kofi').retireItem({ id: target.id, reason: 'Ended' })),
      ).toMatchObject({ kind: 'forbidden' })
      const edition = await as('jon').retireItem({ id: target.id, reason: 'Ended' })
      retirement = { target, edition }
      expect(edition).toMatchObject({
        reason: 'item_retired',
        actorId: id('jon'),
        note: 'Ended',
        live: true,
      })
      expect((await as('maria').getItem(target.id))?.status).toBe('retired')
      expect((await as('ravi').diffEdition({ label: edition.label })).items).toEqual([
        { id: target.id, from: target.version, to: null },
      ])
      expect(await refusal(as('jon').retireItem({ id: target.id, reason: 'Again' }))).toMatchObject(
        { kind: 'not-found' },
      )
    })

    it('says what changed between editions, who made each change and why, to those who maintain an area', async () => {
      const { target, edition } = retirement
      const { riskLevel } = (await as('jon').getItem(target.id))!
      const none = { added: 0, changed: 0, checked: 0, resaved: 0, retired: 0, removed: 0 }
      const retired = {
        itemId: target.id,
        change: 'retired',
        title: target.title,
        areaId: 'area_sales',
        kind: target.kind,
        riskLevel,
        from: { version: target.version, versionId: expect.any(String) as string },
        to: null,
        // An owner's retirement has no proposal: the decision says who and why.
        why: {
          proposal: null,
          proposerId: null,
          channel: null,
          editedBy: null,
          decisions: [
            {
              decidedBy: id('jon'),
              capacity: 'owner',
              outcome: 'retire',
              reason: 'Ended',
              decidedAt: expect.any(String) as string,
            },
          ],
        },
      }

      const feed = await as('jon').editionFeed({ limit: 1 })
      // The cursor is the last edition on the page: the next page starts before it.
      expect(feed.next).toBe(edition.label)
      expect(feed.entries).toEqual([
        {
          edition: expect.objectContaining({ label: edition.label, live: true }) as Edition,
          sentence: `"${target.title}" in Sales was archived. Archived by Jon Abara. Why: Ended.`,
          counts: { ...none, retired: 1 },
          areas: ['area_sales'],
          highestRisk: riskLevel,
          vocabulary: 0,
          actorId: id('jon'),
          why: 'Ended',
          items: [retired],
          more: 0,
          withheld: 0,
        },
      ])
      const [previous] = (await as('ravi').editionFeed({ before: feed.next!, limit: 1 })).entries
      const before = previous!.edition.label
      expect(before).not.toBe(edition.label)

      // By default, the live edition against the one before it.
      const comparison = await as('sofia').compareEditions()
      expect(comparison).toMatchObject({
        from: { label: before },
        to: { label: edition.label, live: true },
        editions: 1,
        backwards: false,
        sentence: `"${target.title}" in Sales was archived. Across 1 edition.`,
        facets: {
          change: { ...none, retired: 1 },
          areas: [{ areaId: 'area_sales', count: 1 }],
          kinds: [{ kind: target.kind, count: 1 }],
          risks: [{ riskLevel, count: 1 }],
        },
        vocabulary: 0,
        withheld: 0,
        total: 1,
        limit: 50,
        offset: 0,
      })
      expect(comparison.items).toEqual([{ ...retired, fields: [] }])
      const pair = { from: before, to: edition.label }
      expect(await as('ravi').compareEditions({ ...pair, change: 'changed' })).toMatchObject({
        total: 0,
        items: [],
        facets: { change: { ...none, retired: 1 } },
      })
      // Backwards: what going back to the edition before would change.
      const backwards = await as('ravi').compareEditions({ from: edition.label, to: before })
      expect(backwards).toMatchObject({ backwards: true, editions: 1, total: 1 })
      expect(backwards.items.map((item) => [item.itemId, item.change])).toEqual([
        [target.id, 'added'],
      ])

      // One item in depth: each field going to nothing, and the edition that took it out.
      const item = await as('jon').compareEditionItem({ id: target.id, ...pair })
      expect(item).toMatchObject({ ...pair, backwards: false, change: retired })
      expect(item.fields).toContainEqual({
        field: 'title',
        before: target.title,
        after: null,
        systemFilled: false,
      })
      expect(item.steps).toEqual([
        {
          edition: expect.objectContaining({ label: edition.label }) as Edition,
          change: 'retired',
          from: retired.from,
          to: null,
          why: retired.why,
        },
      ])
      expect(
        await as('jon').compareEditionItem({
          id: target.id,
          from: edition.label,
          to: edition.label,
        }),
      ).toMatchObject({ change: null, fields: [], steps: [] })

      expect(await refusal(as('jon').compareEditionItem({ id: 'itm_nosuchitem1' }))).toMatchObject({
        kind: 'not-found',
      })
      expect(await refusal(as('jon').compareEditions({ from: '2020-01-01.9' }))).toMatchObject({
        kind: 'not-found',
      })
      // Editions are run by the data platform team and the areas' owners (Quality design G13).
      for (const person of ['maria', 'lars', 'kofi'] as const) {
        expect(await refusal(as(person).editionFeed()), person).toMatchObject({
          kind: 'forbidden',
        })
        expect(await refusal(as(person).compareEditions()), person).toMatchObject({
          kind: 'forbidden',
        })
        expect(
          await refusal(as(person).compareEditionItem({ id: target.id })),
          person,
        ).toMatchObject({ kind: 'forbidden' })
      }
    })

    it('records a check only for an owner of the area', async () => {
      const library = await as('maria').listLibrary()
      const target = library.items.find(
        (item) => item.areaId === 'area_sales' && item.status === 'accepted',
      )!
      expect(
        await refusal(as('kofi').recheckItem({ id: target.id, reason: 'Checked' })),
      ).toMatchObject({ kind: 'forbidden' })
      expect(
        await refusal(as('ravi').recheckItem({ id: target.id, reason: 'Checked' })),
      ).toMatchObject({ kind: 'forbidden' })
    })

    it('lets only an administrator read or change the tools and the clients', async () => {
      for (const person of ['maria', 'jon'] as const) {
        expect(await refusal(as(person).listTools()), person).toMatchObject({ kind: 'forbidden' })
        expect(await refusal(as(person).listClients()), person).toMatchObject({
          kind: 'forbidden',
        })
        expect(
          await refusal(as(person).setTool({ tool: 'get_context', enabled: false, reason: 'No' })),
        ).toMatchObject({ kind: 'forbidden' })
        expect(
          await refusal(
            as(person).saveClient({
              label: 'claude-code',
              displayName: 'Claude Code',
              toolsAllowed: null,
              ratePerMinute: null,
              maxResponseBytes: null,
              enabled: false,
              reason: 'No',
            }),
          ),
        ).toMatchObject({ kind: 'forbidden' })
      }
    })

    it('switches a tool off and on for every client, with a reason', async () => {
      const tools = await as('ravi').listTools()
      expect(tools.map((tool) => tool.tool)).toEqual(
        expect.arrayContaining(['get_context', 'get_related', 'report']),
      )
      expect(tools.find((tool) => tool.tool === 'get_related')?.enabled).toBe(true)
      const before = tools.find((tool) => tool.tool === 'report')!
      expect(before.enabled).toBe(true)

      const off = await as('ravi').setTool({
        tool: 'report',
        enabled: false,
        reason: 'Conformance: off for a moment',
      })
      expect(off).toMatchObject({ tool: 'report', enabled: false })
      expect(Date.parse(off.updatedAt)).toBeGreaterThanOrEqual(Date.parse(before.updatedAt))
      expect((await as('ravi').listTools()).find((tool) => tool.tool === 'report')).toEqual(off)
      // Switching it to what it already is changes nothing.
      expect(await as('ravi').setTool({ tool: 'report', enabled: false, reason: 'Again' })).toEqual(
        off,
      )
      expect(
        await as('ravi').setTool({
          tool: 'report',
          enabled: true,
          reason: 'Conformance: back on',
        }),
      ).toMatchObject({ tool: 'report', enabled: true })

      expect(
        await refusal(as('ravi').setTool({ tool: 'no_such_tool', enabled: true, reason: 'On' })),
      ).toMatchObject({ kind: 'not-found' })
      expect(
        await refusal(
          as('ravi').setTool({
            tool: 'get_context',
            enabled: false,
            reason: 'Ask ravi@example.test why',
          }),
        ),
      ).toMatchObject({ kind: 'invalid' })
      expect(
        (await as('ravi').listTools()).find((tool) => tool.tool === 'get_context')?.enabled,
      ).toBe(true)
    })

    it('adds a client and changes its tools, limits and switch; a label stays', async () => {
      const label = 'conformance-bot'
      const added = await as('ravi').saveClient({
        label,
        displayName: 'Conformance bot',
        toolsAllowed: ['find_context', 'get_context', 'get_context'],
        ratePerMinute: 30,
        maxResponseBytes: null,
        enabled: true,
        reason: 'Conformance: a new client',
      })
      expect(added).toEqual({
        label,
        displayName: 'Conformance bot',
        toolsAllowed: ['find_context', 'get_context'],
        ratePerMinute: 30,
        maxResponseBytes: null,
        enabled: true,
      })
      const listed = await as('ravi').listClients()
      expect(listed.map((client) => client.label)).toEqual(
        [...listed.map((client) => client.label)].sort(),
      )
      expect(listed.find((client) => client.label === label)).toEqual(added)

      const changed = await as('ravi').saveClient({
        ...added,
        displayName: 'Conformance bot (paused)',
        toolsAllowed: null,
        maxResponseBytes: 50_000,
        enabled: false,
        reason: 'Conformance: paused',
      })
      expect(changed).toMatchObject({
        toolsAllowed: null,
        maxResponseBytes: 50_000,
        enabled: false,
      })
      expect((await as('ravi').listClients()).filter((client) => client.label === label)).toEqual([
        changed,
      ])

      expect(
        await refusal(
          as('ravi').saveClient({
            ...added,
            toolsAllowed: ['get_context', 'no_such_tool'],
            reason: 'Conformance: unknown tool',
          }),
        ),
      ).toMatchObject({ kind: 'invalid' })
      expect(
        await refusal(as('ravi').saveClient({ ...added, reason: 'password: hunter2hunter2' })),
      ).toMatchObject({ kind: 'invalid' })
      expect((await as('ravi').listClients()).find((client) => client.label === label)).toEqual(
        changed,
      )
    })

    it('shows retrieval results to owners and administrators, each of their areas', async () => {
      const live = (await as('ravi').listEditions()).find((edition) => edition.live)!
      for (const person of ['maria', 'lars'] as const) {
        expect(await refusal(as(person).getRetrievalLatest())).toMatchObject({
          kind: 'forbidden',
        })
        expect(await refusal(as(person).getRetrievalTrend())).toMatchObject({ kind: 'forbidden' })
      }
      expect(await refusal(as('sofia').getRetrievalLatest({ area: 'area_sandbox' }))).toMatchObject(
        { kind: 'forbidden' },
      )
      for (const person of ['jon', 'sofia', 'ravi'] as const)
        expect((await as(person).getRetrievalLatest()).edition).toBe(live.label)
      // Before an edition's pass its run is null; the mock passes every edition.
      const run = (await as('jon').getRetrievalEdition({ label: live.label })).run
      for (const result of run?.results ?? [])
        expect(['area_sales', 'area_sandbox']).toContain(result.area)
      expect(await refusal(as('jon').getRetrievalEdition({ label: '2020-01-01.1' }))).toMatchObject(
        { kind: 'not-found' },
      )
      expect(Array.isArray(await as('ravi').getRetrievalTrend({ limit: 5 }))).toBe(true)
    })

    it('gives the Quality page to owners and administrators, each of their areas', async () => {
      for (const person of ['maria', 'lars', 'kofi'] as const) {
        const api = as(person)
        for (const read of [
          () => api.getQualityHistory(),
          () => api.getFeedbackCounts(),
          () => api.getAppFamilyCounts(),
          () => api.getUpkeep(),
          () => api.getUntested(),
          () => api.getFixNext(),
        ])
          expect(await refusal(read())).toMatchObject({ kind: 'forbidden' })
      }
      expect(await refusal(as('sofia').getUntested({ area: 'area_sandbox' }))).toMatchObject({
        kind: 'forbidden',
      })
      const mine = ['area_sales', 'area_sandbox']
      const untested = await as('jon').getUntested()
      expect(untested.areas.map((row) => row.area)).toEqual(mine)
      for (const row of untested.areas) {
        expect(row.untested).toBeLessThanOrEqual(row.items)
        expect(row.untestedRequired).toBe(row.byKind.event + row.byKind.example)
      }
      for (const point of await as('jon').getQualityHistory({ limit: 3 }))
        expect(mine).toContain(point.area)
      const upkeep = await as('jon').getUpkeep({ weeks: 4 })
      expect(upkeep.rows).toHaveLength(mine.length * 4)
      expect(upkeep.rows.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.week))).toBe(true)
      // Feedback no delivery places in an area is a row of its own, for administrators only.
      const feedback = await as('jon').getFeedbackCounts({ area: 'area_sales', weeks: 2 })
      expect(feedback.rows.map((row) => row.area)).toEqual(['area_sales', 'area_sales'])
      expect((await as('ravi').getFeedbackCounts({ weeks: 1 })).rows.at(-1)?.area).toBeNull()
      // The agents per family and week (FR-410): a family from the fixed list, never a name.
      const apps = await as('jon').getAppFamilyCounts({ weeks: 2 })
      expect(apps.minimumCount).toBeGreaterThan(0)
      for (const row of apps.rows) {
        expect(appFamilies).toContain(row.family)
        expect(/^\d{4}-\d{2}-\d{2}$/.test(row.week)).toBe(true)
        for (const count of [
          row.calls,
          row.needMoreDetail,
          row.noMatch,
          row.invalidInput,
          row.errors,
        ])
          expect(count === null || count === 0 || count >= apps.minimumCount).toBe(true)
      }
      const next = await as('jon').getFixNext({ limit: 10 })
      expect(next.entries.length).toBeLessThanOrEqual(10)
      for (const entry of next.entries) expect(mine).toContain(entry.area)
      const scores = next.entries.map((entry) => entry.score)
      expect(scores).toEqual([...scores].sort((a, b) => b - a))
      expect(
        await refusal(as('jon').compareRuns({ id: '00000000-0000-4000-8000-00000000abcd' })),
      ).toMatchObject({ kind: 'not-found' })
    })

    it("gives the Workbench one test question across two runs and its history, for its area's maintainers", async () => {
      const id = 'conformance-workbench-orders'
      const unknownRun = '00000000-0000-4000-8000-00000000abcd'
      await as('jon').saveTestQuestion({
        id,
        question: {
          id,
          area: 'area_sales',
          wordings: [
            { kind: 'natural', text: 'Why did orders fall in the Netherlands last week?' },
            {
              kind: 'precise',
              text: 'What explains orders in the Netherlands, 28 Sep to 4 Oct 2026?',
            },
          ],
          scope: {},
          expected: { must_deliver: [], must_not_deliver: [] },
          source: 'Conformance, October 2026',
        },
      })
      for (const person of ['maria', 'lars', 'kofi'] as const) {
        expect(await refusal(as(person).getQuestionHistory({ question: id }))).toMatchObject({
          kind: 'forbidden',
        })
        expect(
          await refusal(as(person).compareQuestion({ question: id, run: unknownRun })),
        ).toMatchObject({ kind: 'forbidden' })
      }
      expect(
        await refusal(as('jon').getQuestionHistory({ question: 'no-such-question' })),
      ).toMatchObject({ kind: 'not-found' })
      expect(
        await refusal(as('jon').compareQuestion({ question: id, run: unknownRun })),
      ).toMatchObject({ kind: 'not-found' })
      // The service has run nothing yet; the mock's weekly runs pass every question.
      const history = await as('sofia').getQuestionHistory({ question: id, limit: 3 })
      expect(history).toMatchObject({ question: id, area: 'area_sales' })
      expect(history.runs.length).toBeLessThanOrEqual(3)
      expect(history.retrieval.length).toBeLessThanOrEqual(3)
      for (const run of history.runs) {
        expect(['scheduled', 'full']).toContain(run.kind)
        expect(run.state === 'tested').toBe(run.revision !== null)
      }
      const [newest] = history.runs
      if (newest) {
        const comparison = await as('jon').compareQuestion({ question: id, run: newest.run })
        expect(comparison).toMatchObject({ question: id, area: 'area_sales' })
        expect(comparison.run.run.id).toBe(newest.run)
        // By default, against the weekly run that finished before.
        if (comparison.against)
          expect(comparison.against.run.finishedAt < comparison.run.run.finishedAt).toBe(true)
        for (const factor of comparison.unknown)
          expect(comparison.heldConstant).not.toContain(factor)
      }
    })

    it('attaches test questions to a proposal for its check, reported and never blocking (FR-524)', async () => {
      const question = (id: string, area: string, split: 'development' | 'held_out') => ({
        id,
        question: {
          id,
          area,
          wordings: [
            { kind: 'natural' as const, text: 'What happened to orders in Norway in August?' },
            { kind: 'precise' as const, text: 'Orders in Norway, 1 to 31 August 2026' },
          ],
          scope: {
            metrics: ['metric:orders'],
            dimension_filters: [{ dimension: 'dim:market', values: ['val:market/norway'] }],
            window: { from: '2026-08-01', to: '2026-08-31' },
          },
          expected: { must_deliver: [], must_not_deliver: [] },
          source: 'Conformance, October 2026',
          split,
        },
      })
      const orders = 'conformance-attach-orders'
      const held = 'conformance-attach-held'
      const sandbox = 'conformance-attach-sandbox'
      await as('jon').saveTestQuestion(question(orders, 'area_sales', 'development'))
      await as('jon').saveTestQuestion(question(held, 'area_sales', 'held_out'))
      await as('jon').saveTestQuestion(question(sandbox, 'area_sandbox', 'development'))

      // The draft's author attaches while it is a draft; again changes nothing.
      const draft = await as('maria').createProposal({ draft: sales({ title: 'Attached' }) })
      const tests = await as('maria').attachProposalTest({ id: draft.id, question: orders })
      expect(tests).toEqual([
        {
          question: orders,
          active: true,
          attachedHour: expect.stringMatching(/T\d{2}:00:00Z$/) as unknown,
        },
      ])
      expect(await as('maria').attachProposalTest({ id: draft.id, question: orders })).toEqual(
        tests,
      )
      expect(await as('maria').listProposalTests(draft.id)).toEqual(tests)
      expect(await as('jon').listProposalTests(draft.id)).toEqual(tests)
      // A held-out question is not found for the author and never attached (FR-503); a question
      // of another area is refused; only the author and the area's maintainers attach.
      expect(
        await refusal(as('maria').attachProposalTest({ id: draft.id, question: held })),
      ).toMatchObject({ kind: 'not-found' })
      expect(
        await refusal(as('jon').attachProposalTest({ id: draft.id, question: held })),
      ).toMatchObject({ kind: 'invalid', status: 422 })
      expect(
        await refusal(as('maria').attachProposalTest({ id: draft.id, question: sandbox })),
      ).toMatchObject({ kind: 'invalid', status: 422 })
      expect(
        await refusal(as('lars').attachProposalTest({ id: draft.id, question: orders })),
      ).toMatchObject({ kind: 'forbidden' })
      expect(await refusal(as('kofi').listProposalTests(draft.id))).toMatchObject({
        kind: 'not-found',
      })
      expect(await as('maria').detachProposalTest({ id: draft.id, question: orders })).toEqual([])
      expect(await as('maria').detachProposalTest({ id: draft.id, question: orders })).toEqual([])
      await as('maria').attachProposalTest({ id: draft.id, question: orders })

      // A draft that moves to another area leaves the tests of the old one behind.
      const moving = await as('maria').createProposal({ draft: sales({ title: 'Moving' }) })
      await as('maria').attachProposalTest({ id: moving.id, question: orders })
      await as('maria').saveDraft({
        id: moving.id,
        revision: moving.revision,
        draft: norway({ title: 'Moving' }),
      })
      expect(await as('maria').listProposalTests(moving.id)).toEqual([])

      // Sent, it is the area's maintainers' until a decision. Level 3 reports the test with the
      // change; it passes either way here, and decides nothing.
      const sent = await as('maria').submitProposal({ id: draft.id, revision: draft.revision })
      expect(
        await refusal(as('maria').detachProposalTest({ id: draft.id, question: orders })),
      ).toMatchObject({ kind: 'forbidden' })
      const review = await as('jon').getReview(draft.id)
      expect(review?.gate?.attached).toEqual([
        {
          question: orders,
          active: true,
          attachedHour: expect.stringMatching(/T\d{2}:00:00Z$/) as unknown,
          retrieval: { baseline: true, candidate: true },
          answer: null,
        },
      ])
      const delivery = review?.gate?.levels.find((level) => level.level === 'delivery')
      expect(delivery?.outcome).toBe('passed')
      expect(delivery?.details).toMatchObject({
        questions: expect.arrayContaining([
          expect.objectContaining({ id: orders, attached: true, regression: false }),
        ]) as unknown,
      })
      expect(await as('sofia').detachProposalTest({ id: draft.id, question: orders })).toEqual([])
      expect(await as('jon').attachProposalTest({ id: draft.id, question: orders })).toHaveLength(1)

      // Decided, its tests stay as they were.
      await as('jon').decide({
        id: draft.id,
        revision: review!.proposal.revision,
        outcome: 'reject',
        reason: 'Covered by the event item',
      })
      expect(
        await refusal(as('jon').detachProposalTest({ id: draft.id, question: orders })),
      ).toMatchObject({ kind: 'conflict' })
      expect((await as('maria').listProposalTests(sent.id)).map((test) => test.question)).toEqual([
        orders,
      ])
    })

    it("proposes an administrator's batch of terms and accepts it as one edition (FR-125)", async () => {
      // Only an administrator reads the source's members that are not terms yet, and proposes.
      expect(await refusal(as('kofi').listTermCandidates())).toMatchObject({ kind: 'forbidden' })
      for (const candidate of await as('ravi').listTermCandidates())
        expect(candidate.key).toMatch(/^(metric|dim):[a-z0-9_]+$/)
      const term = (key: string, extra: object = {}) => ({
        key,
        kind: 'metric' as const,
        parentKey: null,
        name: key,
        aliases: [],
        areaId: 'area_sales',
        definitionRefs: [],
        ...extra,
      })
      const terms = [
        term('val:conformance_channel/email', {
          kind: 'dimension_value' as const,
          parentKey: 'dim:conformance_channel',
          name: 'Email',
        }),
        term('metric:conformance_clicks', { name: 'Conformance clicks' }),
        term('dim:conformance_channel', {
          kind: 'dimension' as const,
          name: 'Conformance channel',
        }),
      ]
      expect(await refusal(as('maria').proposeTerms({ terms }))).toMatchObject({
        kind: 'forbidden',
      })
      // All or none: a key twice changes nothing and names the entry.
      const twice = await refusal(as('ravi').proposeTerms({ terms: [...terms, terms[1]!] }))
      expect(twice).toMatchObject({ kind: 'invalid' })
      expect(twice.findings).toContainEqual(
        expect.objectContaining({ code: 'duplicate_key', field: 'terms.3.key' }),
      )
      // A dimension names one member of each view (strict merge by name); a metric one at most.
      const oneView = await refusal(
        as('ravi').proposeTerms({
          terms: [
            term('dim:conformance_region', {
              kind: 'dimension' as const,
              name: 'Conformance region',
              areaId: null,
              definitionRefs: ['cube:segments.market', 'cube:segments.channel'],
            }),
            term('metric:conformance_both', {
              name: 'Conformance both',
              definitionRefs: ['cube:orders.orders', 'cube:orders.returns'],
            }),
          ],
        }),
      )
      expect(oneView.findings.map((finding) => [finding.code, finding.field])).toEqual(
        expect.arrayContaining([
          ['definition_view', 'terms.0.definitionRefs'],
          ['definition_count', 'terms.1.definitionRefs'],
        ]),
      )
      const batch = await as('ravi').proposeTerms({ terms, sourceName: 'Cube members' })
      // A dimension comes before its values.
      expect(batch.proposals.map((p) => [p.termKey, p.subject, p.state, p.channel])).toEqual([
        ['metric:conformance_clicks', 'vocabulary', 'submitted', 'import'],
        ['dim:conformance_channel', 'vocabulary', 'submitted', 'import'],
        ['val:conformance_channel/email', 'vocabulary', 'submitted', 'import'],
      ])
      // The proposer finds them under their own proposals.
      const mine = await as('ravi').listProposals({ own: true, limit: 100 })
      expect(mine.rows.filter((row) => batch.proposals.some((p) => p.id === row.id))).toHaveLength(
        3,
      )
      const first = batch.proposals[0]!
      expect((await as('jon').getReview(first.id))?.termBatch).toEqual({
        id: batch.batchId,
        open: 3,
        total: 3,
      })
      // Someone without a role there finds nothing to decide; the proposer, an administrator,
      // decides their own batch (FR-206).
      expect(
        await refusal(
          as('maria').decideTermBatch({ batchId: batch.batchId, outcome: 'accept', reason: 'Ok' }),
        ),
      ).toMatchObject({ kind: 'not-found' })
      const decided = await as('ravi').decideTermBatch({
        batchId: batch.batchId,
        outcome: 'accept',
        reason: 'The terms the model defines',
      })
      expect(decided.proposals.map((p) => [p.termKey, p.state])).toEqual([
        ['metric:conformance_clicks', 'accepted'],
        ['dim:conformance_channel', 'accepted'],
        ['val:conformance_channel/email', 'accepted'],
      ])
      expect(decided.edition).toMatchObject({ reason: 'vocabulary_changed', live: true })
      expect(
        await refusal(
          as('jon').decideTermBatch({ batchId: batch.batchId, outcome: 'accept', reason: 'Ok' }),
        ),
      ).toMatchObject({ kind: 'not-found' })

      // A term its proposer no longer wants is withdrawn like any proposal, and leaves the batch.
      const again = await as('ravi').proposeTerms({
        terms: [term('metric:conformance_views', { name: 'Conformance views' })],
      })
      const sent = again.proposals[0]!
      expect(
        await refusal(
          as('jon').withdrawProposal({ id: sent.id, revision: sent.revision, reason: 'Mine now' }),
        ),
      ).toMatchObject({ kind: 'forbidden' })
      expect(
        await as('ravi').withdrawProposal({
          id: sent.id,
          revision: sent.revision,
          reason: 'Not needed after all',
        }),
      ).toMatchObject({ state: 'withdrawn', subject: 'vocabulary' })
      expect(
        await refusal(
          as('jon').decideTermBatch({ batchId: again.batchId, outcome: 'accept', reason: 'Ok' }),
        ),
      ).toMatchObject({ kind: 'not-found' })
    })

    it('lets an administrator move items to the Bin in one edition and restore them', async () => {
      const library = await as('ravi').listLibrary()
      const [first, second] = library.items.filter(
        (item) =>
          item.areaId === 'area_sales' &&
          item.status === 'accepted' &&
          item.kind === 'note' &&
          item.checkFlag === null,
      )
      const retired = library.items.find((item) => item.status === 'retired')!
      const ids = [first!.id, second!.id, retired.id]
      for (const person of ['jon', 'kofi', 'maria'] as const) {
        expect(await refusal(as(person).listBin())).toMatchObject({ kind: 'forbidden' })
        expect(await refusal(as(person).previewBin({ ids }))).toMatchObject({ kind: 'forbidden' })
        expect(
          await refusal(as(person).moveToBin({ ids, reason: 'Not mine to move' })),
        ).toMatchObject({ kind: 'forbidden' })
      }

      // Open proposals from earlier steps may name these items; their count is read, not fixed.
      const preview = (await as('ravi').previewBin({ ids })).items
      expect(preview.map(({ itemId, title, live }) => ({ itemId, title, live }))).toEqual([
        { itemId: first!.id, title: first!.title, live: true },
        { itemId: second!.id, title: second!.title, live: true },
        { itemId: retired.id, title: retired.title, live: false },
      ])
      expect(preview.every((item) => Number.isInteger(item.openProposals))).toBe(true)
      const moved = await as('ravi').moveToBin({ ids, reason: 'Duplicates of the import' })
      // One edition for the whole action, for the two items agents get.
      expect(moved.edition).toMatchObject({
        reason: 'item_retired',
        actorId: id('ravi'),
        note: 'Duplicates of the import',
        live: true,
      })
      expect(moved.items.map((entry) => [entry.itemId, entry.wasLive]).sort()).toEqual(
        [
          [first!.id, true],
          [second!.id, true],
          [retired.id, false],
        ].sort(),
      )
      expect(moved.items.find((entry) => entry.itemId === first!.id)).toMatchObject({
        kind: first!.kind,
        areaId: first!.areaId,
        title: first!.title,
        version: first!.version,
        reason: 'Duplicates of the import',
        binnedBy: id('ravi'),
      })

      // Out of every read: the library, its search and the item itself.
      const after = (await as('maria').listLibrary()).items.map((item) => item.id)
      for (const binned of ids) expect(after).not.toContain(binned)
      expect(await as('maria').getItem(first!.id)).toBeNull()
      const found = await as('maria').listItems({ q: first!.title, limit: 50 })
      expect(found.rows.map((row) => row.id)).not.toContain(first!.id)
      expect((await as('ravi').listBin()).items.map((entry) => entry.itemId).sort()).toEqual(
        [...ids].sort(),
      )
      // An administrator reads an item in the Bin before restoring it, as the library showed it.
      const binned = await as('ravi').getBinItem(first!.id)
      expect(binned?.entry).toMatchObject({ itemId: first!.id, reason: 'Duplicates of the import' })
      expect(binned?.item).toMatchObject({
        id: first!.id,
        title: first!.title,
        version: first!.version,
        status: 'accepted',
      })
      expect((await as('ravi').getBinItem(retired.id))?.item.status).toBe('retired')
      expect(await refusal(as('maria').getBinItem(first!.id))).toMatchObject({ kind: 'forbidden' })
      expect(await as('ravi').getBinItem('itm_notthere01')).toBeNull()

      expect(
        await refusal(as('ravi').moveToBin({ ids: [first!.id], reason: 'Again' })),
      ).toMatchObject({ kind: 'conflict' })
      expect(
        await refusal(as('ravi').moveToBin({ ids: ['itm_notthere01'], reason: 'No' })),
      ).toMatchObject({ kind: 'not-found' })
      expect(await refusal(as('jon').restoreFromBin({ ids: [first!.id] }))).toMatchObject({
        kind: 'forbidden',
      })

      const restored = await as('ravi').restoreFromBin({ ids })
      expect(restored.restored.sort()).toEqual([...ids].sort())
      expect(restored.edition).toMatchObject({
        reason: 'item_restored',
        actorId: id('ravi'),
        live: true,
      })
      const back = (await as('maria').listLibrary()).items
      expect(back.find((item) => item.id === first!.id)).toMatchObject({ status: 'accepted' })
      expect(back.find((item) => item.id === second!.id)).toMatchObject({ status: 'accepted' })
      // An item retired before it went to the Bin comes back retired.
      expect(back.find((item) => item.id === retired.id)).toMatchObject({ status: 'retired' })
      expect((await as('ravi').listBin()).items).toEqual([])
      expect(await as('ravi').getBinItem(first!.id)).toBeNull()
      expect(await refusal(as('ravi').restoreFromBin({ ids: [first!.id] }))).toMatchObject({
        kind: 'not-found',
      })
    })

    it("keeps a proposal's discussion with its proposer and its reviewers (FR-222)", async () => {
      // A term takes comments as an item does.
      const proposed = await as('ravi').proposeTerms({
        terms: [
          {
            key: 'metric:conformance_talk',
            kind: 'metric',
            parentKey: null,
            name: 'Conformance talk',
            aliases: [],
            areaId: 'area_sales',
            definitionRefs: [],
          },
        ],
      })
      let term = proposed.proposals[0]!
      const asked = await as('jon').commentOnProposal({
        id: term.id,
        revision: term.revision,
        text: 'Is this the **gross** or the net figure?',
      })
      expect(asked.revision).toBe(term.revision + 1)
      const answered = await as('ravi').commentOnProposal({
        id: term.id,
        revision: asked.revision,
        text: 'Net, see [the model](https://example.test/model).',
      })
      const said = (events: { kind: string; data: Record<string, unknown> }[]) =>
        events.filter((event) => event.kind === 'commented').map((event) => event.data.text)
      expect(said(await as('jon').listProposalEvents(term.id))).toEqual([
        'Is this the **gross** or the net figure?',
        'Net, see [the model](https://example.test/model).',
      ])
      // Someone who neither proposed nor reviews it cannot join in.
      expect(
        await refusal(
          as('kofi').commentOnProposal({ id: term.id, revision: answered.revision, text: 'Hi' }),
        ),
      ).toMatchObject({ kind: 'not-found' })

      // Accepted, the term is everyone's to read; its discussion stays with its people.
      term = (await as('jon').getReview(term.id))!.proposal
      await as('jon').decide({
        id: term.id,
        revision: term.revision,
        outcome: 'accept',
        reason: 'Matches the model',
      })
      for (const person of ['kofi', 'maria'] as const)
        expect(said(await as(person).listProposalEvents(term.id))).toEqual([])
      for (const person of ['ravi', 'jon', 'lars'] as const)
        expect(said(await as(person).listProposalEvents(term.id))).toHaveLength(2)

      // A request for changes may carry a comment for the discussion; nothing else does.
      const item = await submitted('maria', sales({ title: 'Discussed note' }))
      expect(
        await refusal(
          as('jon').decide({
            id: item.id,
            revision: item.revision,
            outcome: 'accept',
            reason: 'Fine',
            comment: 'A comment with an accept',
          }),
        ),
      ).toMatchObject({ kind: 'invalid' })
      const changes = await as('jon').decide({
        id: item.id,
        revision: item.revision,
        outcome: 'request_changes',
        reason: 'Name the regulator',
        comment: 'The notice names it in its **second** line.',
      })
      expect(changes.proposal.state).toBe('changes_requested')
      const decisionId = (await as('maria').getReview(item.id))!.decisions[0]!.id
      expect(
        (await as('maria').listProposalEvents(item.id)).find((event) => event.kind === 'commented'),
      ).toMatchObject({
        actorId: id('jon'),
        data: { text: 'The notice names it in its **second** line.', decisionId },
      })
      // While changes are asked for, the proposer answers in the discussion.
      expect(
        await as('maria').commentOnProposal({
          id: item.id,
          revision: changes.proposal.revision,
          text: 'Added it.',
        }),
      ).toMatchObject({ state: 'changes_requested' })
    })

    it('decides several proposals with one reason, leaving out and naming the rest (FR-223)', async () => {
      const first = await submitted('maria', sales({ title: 'Bulk note one' }))
      const second = await submitted('maria', sales({ title: 'Bulk note two' }))
      const own = await submitted('jon', sales({ title: 'Bulk note of Jon' }))
      const targets = [first, second, own].map(({ id, revision }) => ({ id, revision }))

      // The plan says what would happen to each, and changes nothing. Jon decides his own as
      // Sales's owner (FR-206).
      const plan = await as('jon').planDecisions({ proposals: targets, outcome: 'accept' })
      expect(plan.decided.map((entry) => [entry.title, entry.effect])).toEqual([
        ['Bulk note one', 'publish'],
        ['Bulk note two', 'publish'],
        ['Bulk note of Jon', 'publish'],
      ])
      expect(plan.skipped).toEqual([])
      expect(plan.editions).toBe(1)
      expect((await as('jon').getReview(first.id))?.proposal.state).toBe('submitted')

      // Each gets its own decision; the accepts are one edition.
      const result = await as('jon').decideMany({
        proposals: targets,
        outcome: 'accept',
        reason: 'Checked against the evidence',
      })
      expect(result.proposals.map((p) => [p.title, p.state])).toEqual([
        ['Bulk note one', 'accepted'],
        ['Bulk note two', 'accepted'],
        ['Bulk note of Jon', 'accepted'],
      ])
      expect(result.skipped).toEqual([])
      expect(result.editions).toHaveLength(1)
      expect(result.editions[0]).toMatchObject({ reason: 'proposal_accepted', live: true })
      for (const p of [first, second]) {
        const review = (await as('maria').getReview(p.id))!
        expect(review.decisions.map((d) => [d.decidedBy, d.outcome, d.reason])).toEqual([
          [id('jon'), 'accept', 'Checked against the evidence'],
        ])
      }

      // Someone who may not decide their own has it left out and named.
      const maria = await submitted('maria', sales({ title: 'Bulk note Maria keeps' }))
      const left = await as('maria').planDecisions({
        proposals: [{ id: maria.id, revision: maria.revision }],
        outcome: 'accept',
      })
      expect(left.skipped.map((entry) => entry.code)).toEqual(['own'])
      expect(left.skipped[0]?.message).toMatch(/You proposed it/)

      // A selection read before a change is left out, never decided on what the person did not read.
      const stale = await as('jon').decideMany({
        proposals: [{ id: first.id, revision: first.revision }],
        outcome: 'reject',
        reason: 'Too late',
      })
      expect(stale).toMatchObject({ proposals: [], editions: [] })
      expect(stale.skipped.map((entry) => entry.code)).toEqual(['changed'])
    })

    it('publishes only the first of two changes to one item in a bulk accept, and names the second', async () => {
      const library = await as('maria').listLibrary()
      const itemId = library.items.findLast(
        (item) =>
          item.areaId === 'area_sales' && item.status === 'accepted' && item.kind === 'note',
      )!.id
      const change = async (title: string) => {
        const created = await as('maria').createProposal({
          itemId,
          draft: { title },
          reason: title,
        })
        return as('maria').submitProposal({ id: created.id, revision: created.revision })
      }
      const first = await change('Bulk shared item, first change')
      const second = await change('Bulk shared item, second change')
      const targets = [first, second].map(({ id, revision }) => ({ id, revision }))

      const plan = await as('jon').planDecisions({ proposals: targets, outcome: 'accept' })
      expect(plan.decided.map((entry) => entry.id)).toEqual([first.id])
      expect(plan.skipped.map((entry) => [entry.id, entry.code])).toEqual([[second.id, 'refused']])

      const result = await as('jon').decideMany({
        proposals: targets,
        outcome: 'accept',
        reason: 'Checked',
      })
      expect(result.proposals.map((p) => [p.id, p.state])).toEqual([[first.id, 'accepted']])
      expect(result.skipped.map((entry) => [entry.id, entry.code])).toEqual([
        [second.id, 'refused'],
      ])
      expect(result.skipped[0]?.message).toMatch(/same fact/)
      expect(result.editions).toHaveLength(1)
      expect((await as('jon').getReview(second.id))?.proposal.state).toBe('submitted')
    })

    it('decides terms in bulk as one edition, and assigns new items and changes (FR-223)', async () => {
      // A term is accepted or rejected only; the accepts of terms are one edition.
      const terms = await as('ravi').proposeTerms({
        terms: ['metric:bulk_one', 'metric:bulk_two'].map((key) => ({
          key,
          kind: 'metric' as const,
          parentKey: null,
          name: key,
          aliases: [],
          areaId: 'area_sales',
          definitionRefs: [],
        })),
      })
      const termTargets = terms.proposals.map(({ id, revision }) => ({ id, revision }))
      const asked = await as('jon').decideMany({
        proposals: termTargets,
        outcome: 'request_changes',
        reason: 'Rename them',
      })
      expect(asked.skipped.map((entry) => entry.code)).toEqual(['not_allowed', 'not_allowed'])
      const decided = await as('jon').decideMany({
        proposals: termTargets,
        outcome: 'accept',
        reason: 'The model defines them',
      })
      expect(decided.proposals.map((p) => p.state)).toEqual(['accepted', 'accepted'])
      expect(decided.editions.map((edition) => edition.reason)).toEqual(['vocabulary_changed'])

      // Assign claims a new item or change for a reviewer of its area; a term, or what the person
      // cannot see, is named.
      const open = await submitted('maria', sales({ title: 'Bulk note to hand over' }))
      const accepted = terms.proposals[0]!
      const assigned = await as('jon').assignProposals({
        proposals: [
          { id: open.id, revision: open.revision },
          { id: accepted.id, revision: accepted.revision },
        ],
        personId: id('sofia'),
      })
      expect(assigned.proposals.map((p) => [p.title, p.claimedBy])).toEqual([
        ['Bulk note to hand over', id('sofia')],
      ])
      expect(assigned.skipped.map((entry) => entry.code)).toEqual(['not_allowed'])
      const stranger = await as('kofi').assignProposals({
        proposals: [{ id: open.id, revision: open.revision }],
        personId: id('kofi'),
      })
      expect(stranger.skipped.map((entry) => entry.code)).toEqual(['not_found'])
    })

    it('ends the session on sign out', async () => {
      await as('kofi').getSession()
      await as('kofi').signOut()
      expect(await refusal(as('kofi').getSession())).toMatchObject({
        kind: 'signed-out',
        status: 401,
      })
      expect(await refusal(as('kofi').listAreas())).toMatchObject({ kind: 'signed-out' })
    })
  })
}
