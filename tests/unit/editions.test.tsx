import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createMockApi } from '@/api/mock-api'
import { createMockWorkflow } from '@/api/mock-workflow'
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { usePopupLayer } from '@/components/ui/layer'
import {
  blockedProblem,
  editionDay,
  editionReason,
  goBackBlocked,
  goBackEffect,
  goBackRefusal,
  goBackSummary,
  parseEditionLabel,
  releaseHistoryLine,
  resumeEffect,
  shortDigest,
  stopConfirmText,
  stopEffect,
  stopHeadline,
  stopReach,
  versionWords,
} from '@/lib/editions'
import { validateEvalsSearch } from '@/lib/search-params'
import { getFixtureItems, versionDays } from '@/mocks/fixtures'
import { areas, FIXTURE_TODAY, people, roleGrants, vocabulary } from '@/mocks/reference-data'

describe('edition numbers', () => {
  it('reads the day and the number of an edition, and nothing else', () => {
    expect(parseEditionLabel('2026-10-07.2')).toEqual({ day: '2026-10-07', number: 2 })
    expect(parseEditionLabel(' 2026-10-07.12 ')).toEqual({ day: '2026-10-07', number: 12 })
    for (const wrong of ['2026-10-07', '2026-10-07.0', '2026-02-30.1', '07-10-2026.1', 'x'])
      expect(parseEditionLabel(wrong), wrong).toBeNull()
  })

  it('keeps an edition number in the address and drops anything else', () => {
    expect(validateEvalsSearch({ tab: 'editions', edition: '2026-10-07.2', page: 3 })).toEqual({
      tab: 'editions',
      edition: '2026-10-07.2',
      page: 3,
    })
    expect(validateEvalsSearch({ edition: 'latest', page: 1 })).toEqual({
      edition: undefined,
      page: undefined,
    })
  })
})

describe('what an edition is and what it changed', () => {
  it('names what made an edition in a few words', () => {
    expect(editionReason({ reason: 'proposal_accepted', restores: null })).toBe('Proposal accepted')
    expect(editionReason({ reason: 'rollback', restores: '2026-10-06.2' })).toBe(
      'Went back to 2026-10-06.2',
    )
    expect(editionReason({ reason: 'source_rechecked', restores: null })).toBe(
      'Checked, still correct',
    )
    expect(editionReason({ reason: 'item_restored', restores: null })).toBe('Restored from the Bin')
    expect(editionReason({ reason: 'something_new', restores: null })).toBe('Other change')
  })

  it('names the versions of a change', () => {
    expect(
      [
        { from: null, to: 1 },
        { from: 2, to: 3 },
        { from: 4, to: null },
        { from: null, to: 3 },
      ].map(versionWords),
    ).toEqual(['Version 1, new', 'Version 2 to 3', 'Was version 4', 'Version 3'])
  })

  it('says what going back does to each item, from the live edition read backwards', () => {
    const v = (version: number) => ({ version })
    expect(goBackEffect({ change: 'removed', from: v(1), to: null })).toBe('Stops being shared')
    expect(goBackEffect({ change: 'added', from: null, to: v(2) })).toBe('Comes back')
    expect(goBackEffect({ change: 'changed', from: v(3), to: v(2) })).toBe(
      'Version 3 returns to version 2',
    )
    expect(goBackEffect({ change: 'resaved', from: v(2), to: v(1) })).toBe(
      'Earlier save, nothing different',
    )
    expect(goBackEffect({ change: 'checked', from: v(2), to: v(1) })).toBe(
      'Earlier check, same content',
    )
  })

  it('sums up what going back changes for AI apps, and what else goes back', () => {
    const counts = (change: Partial<Record<string, number>>) => ({
      facets: {
        change: { added: 0, changed: 0, checked: 0, resaved: 0, retired: 0, removed: 0, ...change },
        areas: [],
        kinds: [],
        risks: [],
      },
      vocabulary: 0,
      withheld: 0,
    })
    expect(goBackSummary(counts({}))).toBe('Nothing changes for AI apps.')
    expect(goBackSummary(counts({ removed: 23, changed: 1, resaved: 14 }))).toBe(
      '38 facts change for AI apps: 23 stop being shared, 1 returns to an earlier version and 14 go back to an earlier save with nothing different.',
    )
    expect(
      goBackSummary({
        ...counts({ added: 1 }),
        vocabulary: 12,
        withheld: 2,
      }),
    ).toBe(
      "1 fact changes for AI apps: 1 comes back. 12 names of metrics, markets or products go back too. 2 facts only some groups can see change too, and aren't shown here.",
    )
  })

  it("says in plain words why a version can't be shared again, and that nothing changed", () => {
    expect(blockedProblem('a required check has not passed')).toBe(
      "A check this version needs hasn't passed.",
    )
    expect(blockedProblem('no accept decision by an owner or deputy of the area')).toBe(
      'No owner of its domain accepted this version.',
    )
    expect(blockedProblem('version does not exist')).toBe('Version does not exist.')
    expect(goBackRefusal('2026-08-02.1', 1)).toBe(
      "You can't go back to edition 2026-08-02.1. One of its fact versions can't be shared with AI apps again. Nothing has changed.",
    )
    expect(goBackBlocked(3, '2026-10-07.2')).toBe(
      "3 of its fact versions can't be shared with AI apps again. Nothing has changed: AI apps still get edition 2026-10-07.2.",
    )
  })

  it('names the day of an edition as people read it', () => {
    expect(editionDay('2026-10-07.2')).toBe('7 October 2026')
    expect(editionDay('latest')).toBeNull()
  })

  it('shortens a digest for reading', () => {
    expect(shortDigest('5f42b0f0'.repeat(8))).toBe('5f42b0f0…42b0f0')
    expect(shortDigest('abc')).toBe('abc')
  })
})

describe('the stop switch in words', () => {
  it('asks to type the domain name or "everything", and nothing for one item', () => {
    expect(stopConfirmText({ scope: 'area', areaName: 'Sales' })).toBe('Sales')
    expect(stopConfirmText({ scope: 'all' })).toBe('everything')
    expect(stopConfirmText({ scope: 'item', itemTitle: 'Net revenue' })).toBeUndefined()
  })

  it('says what stopping and starting again do, and what the banner says', () => {
    expect(stopEffect({ scope: 'area', areaName: 'Sales' })).toBe(
      'Within a minute, AI apps get no facts from Sales. Nothing is lost, and you can start again at any time.',
    )
    expect(stopEffect({ scope: 'item', itemTitle: 'Net revenue' })).toMatch(
      /^Within a minute, AI apps no longer get the fact "Net revenue"\./,
    )
    expect(resumeEffect({ scope: 'all' })).toBe('Within a minute, AI apps get every fact again.')
    expect(stopHeadline({ scope: 'all' })).toBe('AI apps get no facts for now.')
    expect(stopHeadline({ scope: 'area', areaName: 'Sales' })).toBe(
      'AI apps get no facts from Sales for now.',
    )
    expect(stopHeadline({ scope: 'item' })).toBe("AI apps don't get one fact for now.")
  })

  it('says how far a stop reaches, counted from the facts AI apps get', () => {
    expect(stopReach({ scope: 'area', areaName: 'Sales' }, 328)).toBe(
      'AI apps stop getting the 328 facts in Sales. Other domains stay as they are.',
    )
    expect(stopReach({ scope: 'area', areaName: 'Sales' }, 1)).toMatch(
      /^AI apps stop getting the one fact in Sales\./,
    )
    expect(stopReach({ scope: 'all' }, 1395)).toBe(
      'AI apps stop getting the 1,395 facts, in every domain.',
    )
    expect(stopReach({ scope: 'area', areaName: 'Sales' }, undefined)).toMatch(
      /^AI apps stop getting every fact in Sales\./,
    )
    expect(stopReach({ scope: 'item', itemTitle: 'Net revenue' }, 1395)).toBe(
      'AI apps stop getting only this fact. They still get every other fact.',
    )
  })

  it('reads an entry of the history log as who did what, when and why', () => {
    const at = '2026-10-07T12:02:00.000Z'
    expect(
      releaseHistoryLine(
        {
          action: 'edition.rollback',
          actorName: 'Ravi Kapoor',
          at,
          subjectId: '2026-10-07.2',
          details: { note: ' A wrong caveat ' },
        },
        { restores: '2026-10-02.1' },
      ),
    ).toMatch(
      /^Ravi Kapoor went back to 2026-10-02\.1, as edition 2026-10-07\.2, on .+\. Why: A wrong caveat\.$/,
    )
    expect(
      releaseHistoryLine(
        { action: 'stop.on', actorName: null, at, subjectId: 'all', details: {} },
        { target: 'everything' },
      ),
    ).toMatch(/^Someone whose name is unavailable stopped sharing everything with AI apps on .+\.$/)
    expect(
      releaseHistoryLine(
        {
          action: 'stop.off',
          actorName: 'Ravi Kapoor',
          at,
          subjectId: 'area_sales',
          details: { reason: 'Fixed' },
        },
        { target: 'Sales' },
      ),
    ).toMatch(/^Ravi Kapoor started sharing Sales with AI apps again on .+\. Why: Fixed\.$/)
  })
})

function LayerProbe() {
  return <span data-testid="layer">{usePopupLayer()}</span>
}

describe('popup layers', () => {
  it('puts a popup on the popover layer, and above the overlay inside a dialog', async () => {
    const { unmount } = render(<LayerProbe />)
    expect(screen.getByTestId('layer')).toHaveTextContent('z-popover')
    unmount()
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Stop delivery</AlertDialogTitle>
          <LayerProbe />
        </AlertDialogContent>
      </AlertDialog>,
    )
    expect(await screen.findByTestId('layer')).toHaveTextContent('z-overlay')
  })
})

describe('the mock editions', () => {
  const world = () =>
    createMockWorkflow({
      today: FIXTURE_TODAY,
      areas,
      people,
      vocabulary,
      items: getFixtureItems,
      approvers: roleGrants.approvers,
      administrators: roleGrants.administrators,
      versionDays,
    })
  const as = (workflow: ReturnType<typeof world>, personId: string) =>
    createMockApi({ personId: () => personId, workflow: () => Promise.resolve(workflow) })

  it('starts with the library history, one edition per change, the live one on the fixture day', async () => {
    const api = as(world(), 'per_ravi')
    const editions = [
      ...(await api.listEditions({ limit: 100 })),
      ...(await api.listEditions({ limit: 100, offset: 100 })),
    ]
    expect(editions).toHaveLength(61)
    expect(editions[0]).toMatchObject({ label: `${FIXTURE_TODAY}.1`, live: true })
    expect(editions.at(-1)).toMatchObject({ label: '2024-01-01.1', reason: 'bootstrap' })
    expect(editions.filter((edition) => edition.reason === 'item_retired')).toHaveLength(5)
    for (const edition of editions.slice(0, -1)) {
      const diff = await api.diffEdition({ label: edition.label })
      expect(diff.items, edition.label).toHaveLength(1)
    }
  })

  it('serves what an edition serves: retiring and going back change the library', async () => {
    const workflow = world()
    const jon = as(workflow, 'per_jon')
    const ravi = as(workflow, 'per_ravi')
    const [live] = await jon.listEditions({ limit: 1 })
    const item = (await jon.getItem('itm_gjdvl50x'))!
    expect(item.status).toBe('accepted')
    const retired = await jon.retireItem({ id: item.id, reason: 'Wrong' })
    expect(retired).toMatchObject({ reason: 'item_retired', live: true, note: 'Wrong' })
    expect((await jon.getItem(item.id))?.status).toBe('retired')
    expect((await jon.diffEdition({ label: retired.label })).items).toEqual([
      { id: item.id, from: item.version, to: null },
    ])
    expect((await jon.listLibrary()).items.find((entry) => entry.id === item.id)?.status).toBe(
      'retired',
    )

    const back = await ravi.rollbackEdition({ label: live!.label, note: 'Undo' })
    expect(back.restores).toBe(live!.label)
    expect((await jon.getItem(item.id))?.status).toBe('accepted')
    const exported = await ravi.exportEdition(back.label)
    expect(exported.format).toBe('heed.edition/1')
    expect(exported.items.some((entry) => entry.id === item.id)).toBe(true)
  })

  it('records a check with a new version and a new review date', async () => {
    const workflow = world()
    const tomas = as(workflow, 'per_tomas')
    const before = (await tomas.getItem('itm_6n54lyca'))!
    expect(before.checkFlag).toBe('needs_check')
    const result = await tomas.recheckItem({ id: before.id, reason: 'Checked' })
    expect(result.proposal).toMatchObject({ action: 'recheck', itemId: before.id })
    if (before.riskLevel === 'high') expect(result.edition).toBeNull()
    else {
      expect(result.edition).toMatchObject({ reason: 'source_rechecked' })
      const after = (await tomas.getItem(before.id))!
      expect(after).toMatchObject({ checkFlag: null, version: before.version + 1 })
    }
  })
})

describe('the stop switch in the mock', () => {
  it('is read by everyone, numbered for an administrator only, and switched by them', async () => {
    const workflow = createMockWorkflow({
      today: FIXTURE_TODAY,
      areas,
      people,
      vocabulary,
      items: getFixtureItems,
      approvers: roleGrants.approvers,
      administrators: roleGrants.administrators,
    })
    const api = (personId: string) =>
      createMockApi({ personId: () => personId, workflow: () => Promise.resolve(workflow) })
    await expect(
      api('per_jon').setStop({ scope: 'all', on: true, reason: 'Wrong' }),
    ).rejects.toMatchObject({ kind: 'forbidden' })
    await expect(
      api('per_ravi').setStop({ scope: 'item', on: true, reason: 'Wrong' }),
    ).rejects.toMatchObject({ kind: 'bad-request' })
    const on = await api('per_ravi').setStop({
      scope: 'area',
      areaId: 'area_sales',
      on: true,
      reason: 'Wrong caveat',
    })
    expect(on).toEqual([expect.objectContaining({ seq: expect.any(Number) as number })])
    expect(await api('per_maria').listStops()).toEqual([
      {
        at: on[0]!.at,
        scope: 'area',
        areaId: 'area_sales',
        itemId: null,
        reason: 'Wrong caveat',
      },
    ])
    expect(
      await api('per_ravi').setStop({
        scope: 'area',
        areaId: 'area_sales',
        on: false,
        reason: 'Fixed',
      }),
    ).toEqual([])
  })
})
