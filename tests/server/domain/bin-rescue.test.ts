import { describe, expect, it } from 'vitest'
import { rescueDraft, type RescueWorld } from '../../../src/domain/bin-rescue.ts'
import type { Draft } from '../../../src/domain/draft.ts'

/*
  Restoring an item of a deleted domain into another domain (FR-814): the item's last content is
  fitted to the chosen domain, and every change is named, never kept silently.
*/

const ITEM = 'itm_bakery0001'

const world = (changes: Partial<RescueWorld> = {}): RescueWorld => ({
  today: '2026-10-17',
  from: { name: 'Bakery' },
  to: { id: 'pantry', name: 'Pantry', owners: ['per_mia', 'per_ravi'] },
  terms: new Set(['metric:visits', 'dim:market', 'val:market/norway']),
  definitions: new Set(['demo:visits']),
  items: new Set(['itm_other00001']),
  areas: new Set(['pantry', 'finance']),
  personName: (id) => ({ per_mia: 'Mia Chen', per_ravi: 'Ravi Kapoor', per_old: 'Ola Berg' })[id]!,
  termName: (key) => ({ 'metric:loaves': 'Loaves baked', 'val:kiosk/north': 'North kiosk' })[key]!,
  itemTitle: (id) => ({ itm_gone000001: 'Rye counted twice' })[id]!,
  ...changes,
})

const draft = (changes: Partial<Draft> = {}): Draft => ({
  kind: 'note',
  areaId: 'bakery',
  title: 'North kiosk closed on Mondays',
  summary: 'Closed on Mondays',
  scope: { metrics: ['metric:visits'], dimensions: [], dimensionValues: [] },
  validity: { start: '2026-08-04', end: null },
  reviewDate: '2026-12-01',
  evidence: [{ url: 'https://example.test/bakery', quote: 'Closed', date: '2026-08-04' }],
  references: ['demo:visits'],
  changeMarks: { 'demo:visits': '1' },
  ownerId: 'per_ravi',
  replaces: [],
  conflicts: [],
  ...changes,
})

describe('fitting an item of a deleted domain to another domain', () => {
  it('names the domain, keeps an owner of the chosen domain and changes nothing else', () => {
    const rescue = rescueDraft(draft(), ITEM, world())
    expect(rescue.changes).toEqual([{ field: 'domain', before: 'Bakery', after: 'Pantry' }])
    expect(rescue.problem).toBeNull()
    expect(rescue.draft).toEqual({ ...draft(), areaId: 'pantry' })
  })

  it("gives the chosen domain's first owner when the owner is not one of its owners", () => {
    const rescue = rescueDraft(draft({ ownerId: 'per_old' }), ITEM, world())
    expect(rescue.draft.ownerId).toBe('per_mia')
    expect(rescue.changes).toContainEqual({
      field: 'owner',
      before: 'Ola Berg',
      after: 'Mia Chen',
    })
  })

  it('takes out what the live edition no longer has, naming each', () => {
    const rescue = rescueDraft(
      draft({
        summaryMarkup:
          'Closed, as @[the bakery](area:bakery) said; see @[rye](item:itm_gone000001), @[this](item:itm_bakery0001) and @[visits](metric:visits)',
        scope: {
          metrics: ['metric:visits', 'metric:loaves'],
          dimensions: [],
          dimensionValues: [
            { dimension: 'dim:market', value: 'val:market/norway' },
            { dimension: 'dim:kiosk', value: 'val:kiosk/north' },
          ],
        },
        references: ['demo:visits', 'demo:loaves'],
        changeMarks: { 'demo:visits': '1', 'demo:loaves': '2' },
        conflicts: ['itm_other00001', 'itm_gone000001'],
      }),
      ITEM,
      world(),
    )
    expect(rescue.changes).toEqual([
      { field: 'domain', before: 'Bakery', after: 'Pantry' },
      { field: 'scope', before: 'Loaves baked', after: null },
      // A value goes with its dimension, named once.
      { field: 'scope', before: 'North kiosk', after: null },
      { field: 'references', before: 'demo:loaves', after: null },
      { field: 'mentions', before: 'the bakery', after: null },
      { field: 'mentions', before: 'rye', after: null },
      { field: 'mentions', before: 'this', after: null },
      { field: 'conflicts', before: 'Rye counted twice', after: null },
    ])
    expect(rescue.draft).toMatchObject({
      scope: {
        metrics: ['metric:visits'],
        dimensions: [],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
      },
      references: ['demo:visits'],
      changeMarks: { 'demo:visits': '1' },
      summaryMarkup: 'Closed, as the bakery said; see rye, this and @[visits](metric:visits)',
      conflicts: ['itm_other00001'],
    })
  })

  it('gives a review date that has passed the default a new draft has', () => {
    const rescue = rescueDraft(draft({ reviewDate: '2026-10-16' }), ITEM, world())
    expect(rescue.draft.reviewDate).toBe('2027-01-15')
    expect(rescue.changes).toContainEqual({
      field: 'reviewDate',
      before: '2026-10-16',
      after: '2027-01-15',
    })
    expect(rescueDraft(draft({ reviewDate: '2026-10-17' }), ITEM, world()).changes).toHaveLength(1)
  })

  it('refuses a domain with no owner to review it, and an item left with no scope', () => {
    expect(
      rescueDraft(draft(), ITEM, world({ to: { id: 'cellar', name: 'Cellar', owners: [] } }))
        .problem,
    ).toBe('Cellar has no owner to review it. Give it an owner in Administration, Domains, first.')
    const scopeless = rescueDraft(
      draft({ scope: { metrics: ['metric:loaves'], dimensions: [], dimensionValues: [] } }),
      ITEM,
      world(),
    )
    expect(scopeless.problem).toBe(
      'None of the metrics or markets it applies to exist any more, so AI apps could never get it.',
    )
  })
})
