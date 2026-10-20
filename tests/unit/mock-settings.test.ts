import { describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { createMockApi } from '@/api/mock-api'
import { createMockWorkflow } from '@/api/mock-workflow'
import { getFixtureItems } from '@/mocks/fixtures'
import { areas, FIXTURE_TODAY, people, roleGrants, vocabulary } from '@/mocks/reference-data'
import {
  describeContextApiSettings,
  settingsPeople,
  type SettingsSignedIn,
} from '../conformance/context-api-settings.ts'

/*
  Settings on the mock (slice W11b). A world of its own, so these steps do not leak into other
  tests. The same suite runs against the real service in tests/integration/api-settings.test.ts.
*/

const world = () =>
  createMockWorkflow({
    today: FIXTURE_TODAY,
    areas,
    people,
    vocabulary,
    items: getFixtureItems,
    approvers: roleGrants.approvers,
    administrators: roleGrants.administrators,
    auditors: roleGrants.auditors,
  })
const workflow = world()
const apiOf = (person: string, of = workflow) =>
  createMockApi({ personId: () => `per_${person}`, workflow: () => Promise.resolve(of) })
const apis = Object.fromEntries(
  settingsPeople.map((person) => [person, apiOf(person)]),
) as SettingsSignedIn

describeContextApiSettings('mock binding', () => apis, { personId: (id) => id })

describe('the mock alone', () => {
  it('records each change in a chained history log, newest first', async () => {
    const mine = world()
    const ravi = apiOf('ravi', mine)
    await ravi.applyGrants({ changes: [{ op: 'grant', personId: 'per_kofi', role: 'auditor' }] })
    const { entries } = await ravi.searchAudit({ limit: 3 })
    expect(entries[0]).toMatchObject({
      action: 'role.granted',
      actorName: 'Ravi Kapoor',
      subjectId: 'per_kofi',
    })
    expect(new Set(entries.map((entry) => entry.hash)).size).toBe(3)
    expect(entries[0]!.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('makes proposals from an applied import, submitted for review, in one batch', async () => {
    const mine = world()
    const ravi = apiOf('ravi', mine)
    const report = await ravi.importItems({
      content: stringify([
        {
          areaId: 'area_sandbox',
          title: 'Imported closure',
          summary: 'Online sales to Norway stopped',
          scope: {
            metrics: ['metric:orders'],
            dimensions: [],
            dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
          },
          validity: { start: '2026-08-04', end: null },
          evidence: [{ url: 'https://example.test/law', quote: 'Closed', date: '2026-08-04' }],
        },
      ]),
      dryRun: false,
      sourceName: 'closures.yaml',
    })
    expect(report).toMatchObject({ applied: true, counts: { create: 1, errors: 0 } })
    const proposal = await ravi.getProposal(report.entries[0]!.proposalId!)
    expect(proposal).toMatchObject({ state: 'submitted', channel: 'import' })
    const { entries } = await ravi.searchAudit({ action: 'import', limit: 1 })
    expect(entries[0]?.action).toBe('import.applied')
    expect(entries[0]?.details).toMatchObject({ sourceName: 'closures.yaml', create: 1 })
  })

  it('creates an area that is served at once, with no state, and owners it once given', async () => {
    const mine = world()
    const ravi = apiOf('ravi', mine)
    await ravi.createArea({
      id: 'area_retention',
      name: 'Retention',
      label: 'lime',
      reviewDays: 5,
      chatChannel: null,
      ownerTeam: null,
      reason: 'A new team',
    })
    await ravi.applyGrants({
      changes: [{ op: 'grant', areaId: 'area_retention', personId: 'per_kofi', role: 'owner' }],
    })
    const kofi = apiOf('kofi', mine)
    const retention = (await kofi.listAreas()).find((area) => area.id === 'area_retention')
    expect(retention).toMatchObject({ summary: '', description: '', ownerIds: ['per_kofi'] })
    expect(retention).not.toHaveProperty('state')
    expect((await kofi.getSession()).person.permissions.assignments).toContainEqual({
      areaId: 'area_retention',
      role: 'owner',
    })
  })

  it('keeps the last administrator, and lets one hand the role on in one step', async () => {
    const mine = world()
    const ravi = apiOf('ravi', mine)
    const own = { op: 'revoke', personId: 'per_ravi', role: 'administrator' } as const
    await expect(ravi.applyGrants({ changes: [own] })).rejects.toMatchObject({
      kind: 'conflict',
    })
    // His own removal comes last, so giving Kofi the role first is still his to do.
    await ravi.applyGrants({
      changes: [own, { op: 'grant', personId: 'per_kofi', role: 'administrator' }],
    })
    expect((await apiOf('kofi', mine).getSession()).person.permissions.roles).toEqual([
      'administrator',
    ])
    await expect(ravi.listGrants()).rejects.toMatchObject({ kind: 'forbidden' })
  })

  it('puts every role back as it was when one change of a step is refused', async () => {
    const mine = world()
    const ravi = apiOf('ravi', mine)
    const before = await ravi.listGrants()
    const log = (await ravi.searchAudit({ limit: 1 })).entries[0]
    await expect(
      ravi.applyGrants({
        changes: [
          { op: 'revoke', personId: 'per_tomas', areaId: 'area_marketing', role: 'owner' },
          { op: 'grant', personId: 'per_kofi', role: 'auditor' },
          { op: 'grant', personId: 'per_nobody', areaId: 'area_marketing', role: 'owner' },
        ],
      }),
    ).rejects.toMatchObject({ kind: 'not-found' })
    expect(await ravi.listGrants()).toEqual(before)
    expect((await ravi.searchAudit({ limit: 1 })).entries[0]).toEqual(log)
  })

  it('queues a job once until it has run', async () => {
    const ravi = apiOf('ravi', world())
    expect(await ravi.runJob({ job: 'gaps.detect' })).toMatchObject({ status: 'queued' })
    await expect(ravi.runJob({ job: 'gaps.detect' })).rejects.toMatchObject({ kind: 'conflict' })
    const overview = await ravi.getOperations()
    expect(overview.jobs.find((job) => job.name === 'gaps.detect')?.queue?.queued).toBe(1)
  })
})

describe('deleting a domain on the mock (FR-814)', () => {
  it('moves its accepted items to the Bin in one edition, and brings them back after a restore', async () => {
    const mine = world()
    const ravi = apiOf('ravi', mine)
    const removal = (await ravi.getAreaRemoval('area_sales'))!
    expect(removal.outcome).toBe('archive')
    expect(removal.holdings.items).toBeGreaterThan(0)
    // The preview names the first 200 of each kind; the counts give every one.
    expect(removal.items).toHaveLength(Math.min(200, removal.holdings.items))
    // Its metrics' domain comes from the source: they lose it, and stay.
    expect(removal.terms.every((term) => term.fate === 'source')).toBe(true)
    const ids = (await ravi.listLibrary()).items
      .filter((item) => item.areaId === 'area_sales' && item.status === 'accepted')
      .map((item) => item.id)
    expect(ids).toHaveLength(removal.holdings.items)

    const removed = await ravi.removeArea({
      id: 'area_sales',
      revision: removal.revision,
      confirm: 'permanently delete',
    })
    expect(removed).toMatchObject({ outcome: 'archived', edition: { reason: 'area_deleted' } })
    const library = (await ravi.listLibrary()).items.map((item) => item.id)
    for (const id of ids) expect(library).not.toContain(id)
    const bin = (await ravi.listBin()).items
    expect(bin.map((entry) => entry.itemId).sort()).toEqual([...ids].sort())
    expect(bin.every((entry) => entry.reason === 'Domain deleted')).toBe(true)
    await expect(ravi.restoreFromBin({ ids: [ids[0]!] })).rejects.toMatchObject({
      kind: 'conflict',
      message: expect.stringMatching(
        /which was deleted\. Nothing was restored\. Choose another domain for it, or restore Sales first/,
      ) as string,
    })

    const restored = await ravi.restoreArea({ id: 'area_sales' })
    expect(restored.binnedItems.map((item) => item.id).sort()).toEqual([...ids].sort())
    expect(restored.edition).toMatchObject({ reason: 'area_restored' })
    await ravi.restoreFromBin({ ids })
    const back = (await ravi.listLibrary()).items
    for (const id of ids) expect(back.find((item) => item.id === id)?.status).toBe('accepted')
  })

  it('restores an item of a deleted domain into another domain, retired, with a proposal there', async () => {
    const mine = world()
    const ravi = apiOf('ravi', mine)
    const tomas = apiOf('tomas', mine)
    const removal = (await ravi.getAreaRemoval('area_sales'))!
    const item = (await ravi.listLibrary()).items.find(
      (candidate) =>
        candidate.areaId === 'area_sales' &&
        candidate.status === 'accepted' &&
        candidate.ownerId !== 'per_tomas',
    )!
    await ravi.removeArea({
      id: 'area_sales',
      revision: removal.revision,
      confirm: 'permanently delete',
    })
    expect((await ravi.listBin()).items.find((entry) => entry.itemId === item.id)).toMatchObject({
      deletedDomain: 'Sales',
    })
    // Only an administrator, and only into a domain that exists.
    await expect(
      tomas.previewRescue({ ids: [item.id], areaId: 'area_marketing' }),
    ).rejects.toMatchObject({ kind: 'forbidden' })
    await expect(
      ravi.previewRescue({ ids: [item.id], areaId: 'area_sales' }),
    ).rejects.toMatchObject({ kind: 'invalid' })

    // What the chosen domain changes, before anyone confirms: its domain and its owner.
    const [preview] = (await ravi.previewRescue({ ids: [item.id], areaId: 'area_marketing' })).items
    expect(preview).toMatchObject({ itemId: item.id, deletedDomain: 'Sales', problem: null })
    expect(preview!.changes.slice(0, 2)).toEqual([
      { field: 'domain', before: 'Sales', after: 'Marketing' },
      { field: 'owner', before: expect.any(String) as string, after: 'Tomas Eriksen' },
    ])
    // A domain with no owner cannot review it.
    const empty = await ravi.createArea({
      id: 'empty_shelf',
      name: 'Empty shelf',
      label: 'stone',
      reviewDays: 5,
      chatChannel: null,
      ownerTeam: null,
    })
    expect(empty.ownerIds).toEqual([])
    const [unstaffed] = (await ravi.previewRescue({ ids: [item.id], areaId: 'empty_shelf' })).items
    expect(unstaffed!.problem).toBe(
      'Empty shelf has no owner to review it. Give it an owner in Administration, Domains, first.',
    )
    await expect(
      ravi.restoreFromBin({ ids: [item.id], areaId: 'empty_shelf' }),
    ).rejects.toMatchObject({ kind: 'invalid' })

    const restored = await ravi.restoreFromBin({ ids: [item.id], areaId: 'area_marketing' })
    expect(restored).toMatchObject({ restored: [item.id], edition: null })
    expect(restored.proposals).toEqual([
      { itemId: item.id, id: expect.any(String) as string, number: expect.any(Number) as number },
    ])
    // Back retired, never served, out of the Bin.
    expect((await ravi.listBin()).items.map((entry) => entry.itemId)).not.toContain(item.id)
    expect(
      (await ravi.listLibrary()).items.find((candidate) => candidate.id === item.id),
    ).toMatchObject({ status: 'retired' })
    const [logged] = (await ravi.searchAudit({ action: 'item.restored', limit: 1 })).entries
    expect(logged).toMatchObject({
      areaId: 'area_marketing',
      subjectId: item.id,
      details: {
        deletedDomain: 'Sales',
        domain: 'Marketing',
        proposal: restored.proposals[0]!.number,
      },
    })

    // The domain's owner reviews it like any proposal; accepting it serves it there.
    const id = restored.proposals[0]!.id
    const review = await tomas.getReview(id)
    expect(review).toMatchObject({
      proposal: { action: 'change', state: 'submitted', areaId: 'area_marketing' },
      rescue: { deletedDomain: 'Sales', restoredBy: 'per_ravi' },
    })
    expect(review!.diff).toContainEqual({
      field: 'areaId',
      before: 'area_sales',
      after: 'area_marketing',
    })
    const decided = await tomas.decide({
      id,
      revision: review!.proposal.revision,
      outcome: 'accept',
      reason: 'Still true for Marketing',
    })
    expect(decided.edition).toMatchObject({ reason: 'proposal_accepted' })
    expect(
      (await ravi.listLibrary()).items.find((candidate) => candidate.id === item.id),
    ).toMatchObject({ status: 'accepted', areaId: 'area_marketing', ownerId: 'per_tomas' })
  })

  it('restores a domain however long ago it was deleted', async () => {
    const mine = world()
    const ravi = apiOf('ravi', mine)
    const created = await ravi.createArea({
      id: 'old_bakery',
      name: 'Old bakery',
      label: 'stone',
      reviewDays: 5,
      chatChannel: null,
      ownerTeam: null,
    })
    await apiOf('kofi', mine).createProposal({ draft: { areaId: 'old_bakery', title: 'Kept' } })
    await ravi.removeArea({
      id: 'old_bakery',
      revision: created.revision,
      confirm: 'permanently delete',
    })
    mine.travelTo('2026-12-31T12:00:00.000Z')
    expect((await ravi.listArchivedAreas()).map((area) => area.id)).toContain('old_bakery')
    const restored = await ravi.restoreArea({ id: 'old_bakery' })
    expect(restored.area).toMatchObject({ id: 'old_bakery' })
  })
})
