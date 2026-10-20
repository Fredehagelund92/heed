import { describe, expect, it } from 'vitest'
import { workbenchLinks } from '@/components/workbench/links'
import type { WorkbenchSearch } from '@/lib/search-params'
import { openRecordSearch } from '@/lib/workbench-address'

/*
  Where the links inside a record body go in the Workbench (Workbench plan, slice W6b): another
  record opens in the record pane with its tab kept, and the run compared with stays the scope's.
*/

const RUN = '00000000-0000-4000-b000-000000000090'
const EARLIER = '00000000-0000-4000-b000-000000000080'
const TRY = '00000000-0000-4000-b000-00000009002b'

const open: WorkbenchSearch = {
  area: 'area_commercial',
  view: 'worse',
  open: 'question:net-revenue-month-to-date',
  tab: 'result',
  against: EARLIER,
  cell: TRY,
  mode: 'compare',
}

describe('opening another record', () => {
  it('keeps the tab, the scope and the list, and leaves the transcript and compare behind', () => {
    expect(openRecordSearch(open, 'question:units-sold-source-lag')).toEqual({
      ...open,
      open: 'question:units-sold-source-lag',
      cell: undefined,
      mode: undefined,
    })
  })
})

describe('Health as the home of a record body', () => {
  it('opens a record body’s link in the record pane, with the tab and the comparison kept', () => {
    const linkTo = workbenchLinks(open)
    expect(
      linkTo({ record: 'question:units-sold-source-lag', tab: undefined, against: undefined }),
    ).toEqual({
      to: '/health',
      search: {
        area: 'area_commercial',
        view: 'worse',
        open: 'question:units-sold-source-lag',
        tab: 'result',
        against: EARLIER,
      },
    })
  })

  it('names Quality’s tabs in the Workbench’s words for a question, and keeps a run’s', () => {
    const linkTo = workbenchLinks({ open: `run:${RUN}`, tab: 'changes' })
    expect(linkTo({ record: 'question:units-sold-source-lag', tab: 'results' }).search).toEqual({
      open: 'question:units-sold-source-lag',
      tab: 'result',
    })
    expect(linkTo({ record: 'question:units-sold-source-lag', tab: 'overview' }).search).toEqual({
      open: 'question:units-sold-source-lag',
      tab: 'evidence',
    })
    expect(linkTo({ record: `run:${RUN}`, tab: 'results', cell: TRY }).search).toEqual({
      open: `run:${RUN}`,
      tab: 'results',
      cell: TRY,
    })
  })

  it('changes the run compared with, or the transcript, in place', () => {
    const linkTo = workbenchLinks({ open: `run:${RUN}`, tab: 'changes', against: EARLIER })
    expect(linkTo({ against: undefined, cell: undefined }).search).toEqual({
      open: `run:${RUN}`,
      tab: 'changes',
    })
    expect(linkTo({ against: RUN }).search).toEqual({
      open: `run:${RUN}`,
      tab: 'changes',
      against: RUN,
    })
    expect(workbenchLinks(open)({ cell: undefined }).search).toEqual({
      area: 'area_commercial',
      view: 'worse',
      open: 'question:net-revenue-month-to-date',
      tab: 'result',
      against: EARLIER,
      mode: 'compare',
    })
  })

  it('opens a gap in Health too', () => {
    const gap = 'gap:ca9a0000-0000-4000-8000-00000000000a'
    expect(workbenchLinks({})({ record: gap })).toEqual({
      to: '/health',
      search: { open: gap },
    })
  })
})
