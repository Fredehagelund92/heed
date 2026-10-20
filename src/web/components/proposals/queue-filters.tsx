import { useMemo, useState, type ReactNode } from 'react'
import type { Area } from '@domain/item'
import { riskLevels } from '@domain/item'
import { HeedDomainIcon, HeedRiskIcon, UserRoundCheckIcon } from '@/components/icons'
import { RiskBadge } from '@/components/item/fact-badges'
import { DomainBadge } from '@/components/item/item-marks'
import { FilterMenu, type FilterMenuField } from '@/components/page/filter-menu'
import { claimFilterNames, claimFilters, visibleQueueRows, type QueueRow } from '@/lib/review'
import type { ProposalsSearch } from '@/lib/search-params'

type Field = 'area' | 'risk' | 'claimed'

/**
 * The Filter menu of the To review view, the library's two-pane menu: domain, risk and who holds
 * the proposal, each value drawn as it reads in the grid with the number of proposals the queue
 * would show after clicking it. Each field takes one value and lives in the address.
 */
export function QueueFilters({
  search,
  areas,
  rows,
  viewerId,
  activeCount,
  onSearch,
}: {
  search: ProposalsSearch
  areas: readonly Area[]
  rows: readonly QueueRow[]
  viewerId: string
  activeCount: number
  onSearch: (patch: Partial<ProposalsSearch>) => void
}) {
  const [open, setOpen] = useState(false)
  const count = useMemo(
    () =>
      open
        ? (patch: Partial<ProposalsSearch>) =>
            visibleQueueRows(rows, { ...search, ...patch }, viewerId).length
        : () => 0,
    [open, rows, search, viewerId],
  )
  const choose = (field: Field, value: string) => {
    const on = search[field] === value
    return { patch: { [field]: on ? undefined : value } as Partial<ProposalsSearch>, on }
  }
  const domains = areas.filter((area) => rows.some((row) => row.areaId === area.id))
  const option = (field: Field, value: string, name: string, children: ReactNode) => {
    const { patch, on } = choose(field, value)
    return {
      key: value,
      name,
      checked: on,
      count: count(patch),
      onChange: () => onSearch(patch),
      children,
    }
  }
  const fields: FilterMenuField[] = [
    ...(domains.length > 1
      ? [
          {
            id: 'area',
            title: 'Domain',
            icon: HeedDomainIcon,
            on: search.area ? 1 : 0,
            options: domains.map((area) =>
              option(
                'area',
                area.id,
                area.name,
                <DomainBadge name={area.name} label={area.label} size="sm" />,
              ),
            ),
          },
        ]
      : []),
    {
      id: 'risk',
      title: 'Risk',
      icon: HeedRiskIcon,
      on: search.risk ? 1 : 0,
      options: [...riskLevels]
        .reverse()
        .map((level) =>
          option('risk', level, `${level} risk`, <RiskBadge level={level} form="bare" size="sm" />),
        ),
    },
    {
      id: 'claimed',
      title: 'Claimed by',
      icon: UserRoundCheckIcon,
      on: search.claimed ? 1 : 0,
      options: claimFilters.map((claimed) =>
        option(
          'claimed',
          claimed,
          claimFilterNames[claimed],
          <span>{claimFilterNames[claimed]}</span>,
        ),
      ),
    },
  ]
  return <FilterMenu fields={fields} activeCount={activeCount} open={open} onOpenChange={setOpen} />
}
