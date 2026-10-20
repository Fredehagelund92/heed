import { useMemo, useState, type ReactNode } from 'react'
import type { Area } from '@domain/item'
import { proposalStates, type ProposalState } from '@domain/proposal-state'
import { CircleDashedIcon, HeedDomainIcon } from '@/components/icons'
import { DomainBadge, ProposalStatusBadge } from '@/components/item/item-marks'
import { FilterMenu, type FilterMenuField } from '@/components/page/filter-menu'
import { proposalStateNames, visibleProposalRows, type ProposalRow } from '@/lib/proposals'
import type { ProposalsSearch } from '@/lib/search-params'

type Field = 'state' | 'area'

/**
 * The Filter menu of the Proposals page, the library's menu (the Reference bar): the fields on
 * the left with how many values each has on, the values of the chosen field on the right, each
 * drawn as it reads in the grid, with the number of proposals the list would show after clicking
 * it. Status and domain take one value each and live in the address.
 */
export function ProposalFilters({
  search,
  areas,
  rows,
  activeCount,
  onSearch,
}: {
  search: ProposalsSearch
  areas: readonly Area[]
  /** Every proposal of the view, for the counts. */
  rows: readonly ProposalRow[]
  activeCount: number
  onSearch: (patch: Partial<ProposalsSearch>) => void
}) {
  const [open, setOpen] = useState(false)
  // Counted only while the menu is open: one filter pass per value.
  const count = useMemo(
    () =>
      open
        ? (patch: Partial<ProposalsSearch>) =>
            visibleProposalRows(rows, { ...search, ...patch }).length
        : () => 0,
    [open, rows, search],
  )
  const choose = (field: Field, value: string) => {
    const on = search[field] === value
    return { patch: { [field]: on ? undefined : value } as Partial<ProposalsSearch>, on }
  }
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
    {
      id: 'state',
      title: 'Status',
      icon: CircleDashedIcon,
      on: search.state ? 1 : 0,
      options: proposalStates.map((state: ProposalState) =>
        option(
          'state',
          state,
          proposalStateNames[state],
          <ProposalStatusBadge state={state} size="sm" />,
        ),
      ),
    },
    ...(areas.length > 1
      ? [
          {
            id: 'area',
            title: 'Domain',
            icon: HeedDomainIcon,
            on: search.area ? 1 : 0,
            options: areas.map((area) =>
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
  ]
  return <FilterMenu fields={fields} activeCount={activeCount} open={open} onOpenChange={setOpen} />
}
