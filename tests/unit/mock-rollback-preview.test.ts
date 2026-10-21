import { afterEach, describe, expect, it } from 'vitest'
import { ApiError, type ContextApi } from '@/api'
import { createMockApi } from '@/api/mock-api'
import { MOCK_SCENARIO_KEY } from '@/api/mock-scenario'
import { createMockWorkflow, type MockWorkflow } from '@/api/mock-workflow'
import { getFixtureItems, versionDays } from '@/mocks/fixtures'
import { areas, FIXTURE_TODAY, people, roleGrants, vocabulary } from '@/mocks/reference-data'

/*
  Going back and the stop switch in the mock, by the service's rules (rollbackPreview and
  rollbackTo in src/server/modules/editions, setStop in release.ts; tested on PostgreSQL in
  tests/integration/edition-compare.test.ts): the preview compares the live edition with the
  target before anyone goes back, a version that cannot be served again refuses going back with
  a conflict that names it, and both actions are kept in the history log. Ravi is an
  administrator, Jon the owner of Sales and Sandbox.
*/

function workflowFor(scenario?: string): MockWorkflow {
  if (scenario) window.localStorage.setItem(MOCK_SCENARIO_KEY, scenario)
  else window.localStorage.removeItem(MOCK_SCENARIO_KEY)
  return createMockWorkflow({
    today: FIXTURE_TODAY,
    areas,
    people,
    vocabulary,
    items: getFixtureItems,
    approvers: roleGrants.approvers,
    administrators: roleGrants.administrators,
    versionDays,
  })
}
const as = (workflow: MockWorkflow, personId: string): ContextApi =>
  createMockApi({ personId: () => personId, workflow: () => Promise.resolve(workflow) })

afterEach(() => window.localStorage.removeItem(MOCK_SCENARIO_KEY))

const refused = async (call: Promise<unknown>) => {
  const error = await call.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

describe('the preview of going back', () => {
  it('compares the live edition with the target, backwards, and names nothing blocked', async () => {
    const ravi = as(workflowFor(), 'per_ravi')
    const preview = await ravi.previewRollback('2026-10-02.1')
    expect(preview.live.live).toBe(true)
    expect(preview.target.label).toBe('2026-10-02.1')
    expect(preview.comparison).toMatchObject({
      backwards: true,
      from: { label: preview.live.label },
      to: { label: '2026-10-02.1' },
    })
    expect(preview.comparison.total).toBeGreaterThan(0)
    expect(preview.blocked).toEqual([])
  })

  it('is an administrator’s, like going back', async () => {
    const jon = as(workflowFor(), 'per_jon')
    expect((await refused(jon.previewRollback('2026-10-02.1'))).kind).toBe('forbidden')
    const ravi = as(workflowFor(), 'per_ravi')
    expect((await refused(ravi.previewRollback('2020-01-01.9'))).kind).toBe('not-found')
  })
})

describe('a version that cannot be served again', () => {
  /** The newest earlier edition the `rollback-blocked` scenario keeps from coming back. */
  async function blockedEdition(api: ContextApi) {
    const editions = await api.listEditions({ limit: 100 })
    for (const edition of editions.filter((candidate) => !candidate.live)) {
      const preview = await api.previewRollback(edition.label)
      if (preview.blocked.length) return preview
    }
    throw new Error('The scenario blocks no edition')
  }

  it('is named by the preview and refuses going back with a conflict that names it', async () => {
    const workflow = workflowFor('rollback-blocked')
    const ravi = as(workflow, 'per_ravi')
    const preview = await blockedEdition(ravi)
    const [blocked] = preview.blocked
    expect(preview.blocked).toHaveLength(1)
    expect(blocked).toEqual({
      itemId: 'itm_lmi0e4pz',
      title: 'Average order value lags by one day in the source tool',
      version: 1,
      problem: 'a required check has not passed',
    })
    expect(preview.target.label).toBe('2026-08-02.1')
    const error = await refused(
      ravi.rollbackEdition({ label: preview.target.label, note: 'Back before the change' }),
    )
    expect(error.kind).toBe('conflict')
    expect(error.message).toBe(
      `You can't go back to edition ${preview.target.label}. "${blocked!.title}" (version ${blocked!.version}) can't be shared with agents again: a required check has not passed.`,
    )
    expect(error.blocked).toEqual(preview.blocked)
    // Nothing was published.
    const [live] = await ravi.listEditions({ limit: 1 })
    expect(live!.label).toBe(preview.live.label)
  })

  it('does not block an edition whose versions all pass', async () => {
    const ravi = as(workflowFor('rollback-blocked'), 'per_ravi')
    const [live, before] = await ravi.listEditions({ limit: 2 })
    const preview = await ravi.previewRollback(before!.label)
    expect(preview.blocked).toEqual([])
    const back = await ravi.rollbackEdition({ label: before!.label, note: 'One step back' })
    expect(back).toMatchObject({ reason: 'rollback', restores: before!.label, live: true })
    expect(back.label).not.toBe(live!.label)
  })
})

describe('the history log', () => {
  it('keeps who went back, to which edition and why', async () => {
    const ravi = as(workflowFor(), 'per_ravi')
    const back = await ravi.rollbackEdition({ label: '2026-10-02.1', note: 'A wrong caveat' })
    const { entries } = await ravi.searchAudit({ action: 'edition.rollback', limit: 1 })
    expect(entries[0]).toMatchObject({
      actorId: 'per_ravi',
      actorName: 'Ravi Kapoor',
      action: 'edition.rollback',
      subjectType: 'edition',
      subjectId: back.label,
      details: { reason: 'rollback', note: 'A wrong caveat' },
    })
  })

  it('keeps each stop and switch on, and nothing for a switch that did not move', async () => {
    const ravi = as(workflowFor(), 'per_ravi')
    const stop = { scope: 'area', areaId: 'area_sales' } as const
    const before = (await ravi.searchAudit({ action: 'stop' })).entries.length
    await ravi.setStop({ ...stop, on: true, reason: 'Wrong caveat' })
    await ravi.setStop({ ...stop, on: true, reason: 'Again' })
    await ravi.setStop({ ...stop, on: false, reason: 'Fixed' })
    const { entries } = await ravi.searchAudit({ action: 'stop' })
    expect(entries).toHaveLength(before + 2)
    expect(entries.slice(0, 2)).toMatchObject([
      {
        action: 'stop.off',
        actorName: 'Ravi Kapoor',
        areaId: 'area_sales',
        subjectType: 'area',
        subjectId: 'area_sales',
        details: { reason: 'Fixed' },
      },
      { action: 'stop.on', details: { reason: 'Wrong caveat' } },
    ])
  })
})
