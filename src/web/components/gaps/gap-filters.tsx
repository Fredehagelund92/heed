import { useMemo, useState, type ReactNode } from 'react'
import type { Area } from '@domain/item'
import { CircleDashedIcon, HeedDomainIcon, FlagIcon, ShapesIcon } from '@/components/icons'
import { DomainBadge } from '@/components/item/item-marks'
import { FilterMenu, type FilterMenuField } from '@/components/page/filter-menu'
import {
  gapOriginFilterNames,
  gapOrigins,
  gapStatuses,
  gapStatusNames,
  gapTypeNames,
  gapTypes,
} from '@/lib/gaps'
import type { GapsSearch } from '@/lib/search-params'
import { FromPeopleBadge, GapStatusBadge } from './gap-marks'

type Field = 'status' | 'type' | 'origin' | 'area'

/**
 * The Filter menu of the Gaps page, the library's two-pane menu: the fields on the left with how
 * many values each has on, the values of the chosen field on the right, each drawn as it reads
 * in the grid, with the number of rows the list would show after clicking it. Each field takes
 * one value and lives in the address. The topic counts filter by domain only.
 */
export function GapFilters({
  search,
  areas,
  fields: shownFields,
  count,
  activeCount,
  onSearch,
}: {
  search: GapsSearch
  areas: readonly Area[]
  fields: readonly Field[]
  /** How many rows the view would show with a filter changed. */
  count: (patch: Partial<GapsSearch>) => number
  activeCount: number
  onSearch: (patch: Partial<GapsSearch>) => void
}) {
  const [open, setOpen] = useState(false)
  // Counted only while the menu is open: one filter pass per value.
  const countOf = useMemo(() => (open ? count : () => 0), [open, count])
  const choose = (field: Field, value: string) => {
    const on = search[field] === value
    return { patch: { [field]: on ? undefined : value } as Partial<GapsSearch>, on }
  }
  const option = (field: Field, value: string, name: string, children: ReactNode) => {
    const { patch, on } = choose(field, value)
    return {
      key: value,
      name,
      checked: on,
      count: countOf(patch),
      onChange: () => onSearch(patch),
      children,
    }
  }
  const fields: FilterMenuField[] = [
    {
      id: 'status',
      title: 'Status',
      icon: CircleDashedIcon,
      on: search.status ? 1 : 0,
      options: gapStatuses.map((status) =>
        option(
          'status',
          status,
          gapStatusNames[status],
          <GapStatusBadge status={status} size="sm" />,
        ),
      ),
    },
    {
      id: 'type',
      title: 'Type',
      icon: ShapesIcon,
      on: search.type ? 1 : 0,
      options: gapTypes.map((type) =>
        option(
          'type',
          type,
          gapTypeNames[type],
          <span className="truncate">{gapTypeNames[type]}</span>,
        ),
      ),
    },
    {
      id: 'origin',
      title: 'Origin',
      icon: FlagIcon,
      on: search.origin ? 1 : 0,
      options: gapOrigins.map((origin) =>
        option(
          'origin',
          origin,
          gapOriginFilterNames[origin],
          origin === 'person' ? (
            <FromPeopleBadge size="sm" />
          ) : (
            <span className="truncate">{gapOriginFilterNames[origin]}</span>
          ),
        ),
      ),
    },
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
  ].filter((field) => shownFields.includes(field.id as Field))
  return <FilterMenu fields={fields} activeCount={activeCount} open={open} onOpenChange={setOpen} />
}
