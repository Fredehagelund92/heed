import type { ReactNode } from 'react'
import { catalogueStatuses } from '@domain/catalogue'
import type { Area } from '@domain/item'
import { Rows3Icon, SlidersHorizontalIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  NO_DOMAIN,
  catalogueFiltersOf,
  catalogueStatusFilterName,
  type CatalogueFilters,
} from '@/lib/catalogue'
import { formatList } from '@/lib/library'
import type { CatalogueSearch } from '@/lib/search-params'
import { catalogueStatusGlyphs, TermDomainBadge } from './catalogue-marks'
import { isCatalogueDensity, type CatalogueDensity } from './catalogue-table'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <span className="text-caption font-bold text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]
}

type MenuProps = {
  search: CatalogueSearch
  onSearch: (patch: Partial<CatalogueSearch>) => void
}

const clearedFilters: Partial<CatalogueSearch> = { status: undefined, area: undefined }

type DomainChoices = { areas: readonly Area[]; noDomain: boolean }
/** The tool the catalogue's definitions come from, for the status names ("Changed in Cube"). */
type ToolProps = { tool: string }

function FilterFields({
  search,
  domains,
  tool,
  onSearch,
}: MenuProps & ToolProps & { domains: DomainChoices }) {
  const filters: CatalogueFilters = catalogueFiltersOf(search)
  return (
    <>
      <Row label="Status">
        {catalogueStatuses.map((status) => {
          const Glyph = catalogueStatusGlyphs[status]
          return (
            <Toggle
              key={status}
              size="sm"
              pressed={filters.statuses.includes(status)}
              onPressedChange={() =>
                onSearch({ status: formatList(toggleIn(filters.statuses, status)) })
              }
            >
              <Glyph aria-hidden="true" className="size-icon-sm" />
              {catalogueStatusFilterName(status, tool)}
            </Toggle>
          )
        })}
      </Row>
      <Row label="Domain">
        {domains.areas.map((area) => (
          <Toggle
            key={area.id}
            size="sm"
            pressed={filters.area === area.id}
            onPressedChange={(pressed) => onSearch({ area: pressed ? area.id : undefined })}
          >
            <TermDomainBadge name={area.name} label={area.label} none={null} form="bare" />
          </Toggle>
        ))}
        {domains.noDomain ? (
          <Toggle
            size="sm"
            pressed={filters.area === NO_DOMAIN}
            onPressedChange={(pressed) => onSearch({ area: pressed ? NO_DOMAIN : undefined })}
          >
            No domain
          </Toggle>
        ) : null}
      </Row>
    </>
  )
}

function DisplayFields({
  search,
  density,
  onSearch,
  onDensity,
}: MenuProps & { density: CatalogueDensity; onDensity: (density: CatalogueDensity) => void }) {
  return (
    <>
      <Row label="Order">
        <ToggleGroup
          value={[search.order ?? 'domain']}
          onValueChange={(value: string[]) => {
            const next = value[0]
            if (next) onSearch({ order: next === 'az' ? 'az' : undefined })
          }}
        >
          <ToggleGroupItem value="domain" size="sm">
            By domain
          </ToggleGroupItem>
          <ToggleGroupItem value="az" size="sm">
            A to Z
          </ToggleGroupItem>
        </ToggleGroup>
      </Row>
      <Row label="Density">
        <ToggleGroup
          value={[density]}
          onValueChange={(value: string[]) => {
            const next = value[0]
            if (next && isCatalogueDensity(next)) onDensity(next)
          }}
        >
          <ToggleGroupItem value="description" size="sm">
            With description
          </ToggleGroupItem>
          <ToggleGroupItem value="compact" size="sm">
            Compact
          </ToggleGroupItem>
        </ToggleGroup>
      </Row>
    </>
  )
}

/*
  Taller than most windows on a phone, so a panel stays under its button and scrolls inside, and
  keeps the 16 pixel page gutter (4.1), as the library's menu does.
*/
const panel = {
  align: 'end' as const,
  collisionAvoidance: { side: 'none', align: 'shift', fallbackAxisSide: 'none' } as const,
  collisionPadding: 16,
  className: 'w-dialog px-0 py-3',
}
const scroll = 'flex min-h-0 flex-col gap-4 overflow-y-auto px-4 py-1'

/** The count of filters on, in the corner of the button that holds them. */
function FilterCount({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <span
      aria-hidden="true"
      className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-ink text-caption font-bold text-ink-foreground tabular-nums"
    >
      {count}
    </span>
  )
}

/** Filter (table design 4.6): what the list shows, with the count of filters on. */
export function CatalogueFilterMenu({
  search,
  domains,
  tool,
  activeCount,
  onSearch,
}: MenuProps & ToolProps & { domains: DomainChoices; activeCount: number }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="toolbar"
            className="relative"
            aria-label={activeCount > 0 ? `Filter, ${activeCount} on` : 'Filter'}
          />
        }
      >
        <SlidersHorizontalIcon />
        Filter
        <FilterCount count={activeCount} />
      </PopoverTrigger>
      <PopoverContent {...panel}>
        <section className={scroll} aria-label="Filter">
          <FilterFields search={search} domains={domains} tool={tool} onSearch={onSearch} />
          {activeCount > 0 ? (
            <div className="flex justify-end border-t pt-4">
              <Button variant="ghost" size="sm" onClick={() => onSearch(clearedFilters)}>
                Clear filters
              </Button>
            </div>
          ) : null}
        </section>
      </PopoverContent>
    </Popover>
  )
}

/** Display (table design 4.6): the order (by domain or A to Z) and the density. */
export function CatalogueDisplayMenu({
  search,
  density,
  onSearch,
  onDensity,
}: MenuProps & { density: CatalogueDensity; onDensity: (density: CatalogueDensity) => void }) {
  return (
    <Popover>
      {/* The library's Display button: an icon, its name for assistive technology and the pointer. */}
      <PopoverTrigger
        render={<Button variant="ghost" size="icon-toolbar" aria-label="Display" title="Display" />}
      >
        <Rows3Icon />
      </PopoverTrigger>
      <PopoverContent {...panel}>
        <section className={scroll} aria-label="Display">
          <DisplayFields
            search={search}
            density={density}
            onSearch={onSearch}
            onDensity={onDensity}
          />
        </section>
      </PopoverContent>
    </Popover>
  )
}

/** On a phone, Filter and Display share one icon button (catalogue research 6.2). */
export function CatalogueViewMenu({
  search,
  domains,
  tool,
  activeCount,
  density,
  onSearch,
  onDensity,
}: MenuProps &
  ToolProps & {
    domains: DomainChoices
    activeCount: number
    density: CatalogueDensity
    onDensity: (density: CatalogueDensity) => void
  }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative size-control-touch shrink-0"
            aria-label={
              activeCount > 0
                ? `Filter and display, ${activeCount} filters on`
                : 'Filter and display'
            }
          />
        }
      >
        <SlidersHorizontalIcon />
        <FilterCount count={activeCount} />
      </PopoverTrigger>
      <PopoverContent {...panel}>
        <div className={scroll}>
          <section className="flex flex-col gap-4" aria-label="Filter">
            <h2 className="text-dense font-bold">Filter</h2>
            <FilterFields search={search} domains={domains} tool={tool} onSearch={onSearch} />
          </section>
          <section className="flex flex-col gap-4 border-t pt-4" aria-label="Display">
            <h2 className="text-dense font-bold">Display</h2>
            <DisplayFields
              search={search}
              density={density}
              onSearch={onSearch}
              onDensity={onDensity}
            />
          </section>
          {activeCount > 0 ? (
            <div className="flex justify-end border-t pt-4">
              <Button variant="ghost" size="sm" onClick={() => onSearch(clearedFilters)}>
                Clear filters
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
