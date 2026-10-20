import { useId, useState, type ReactNode } from 'react'
import { SearchIcon, SlidersHorizontalIcon, type Icon } from '@/components/icons'
import { CountBadge } from '@/components/item/item-marks'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

/*
  The list pages' one Filter menu (the Reference bar): a search field on top, then the fields on
  the left with how many values each has on, and the values of the chosen field on the right,
  each drawn as it reads in the grid with the number of rows the list would show after clicking
  it. Typing in the search field lists the matching values of every field at once, under their
  field's name, so a value is two keys away (the professional pass: menus are searchable, their
  items 28 high at 400, their labels muted at 400). The library, proposals, the review queue and
  gaps fill it with their own fields.
*/

export type FilterMenuOption = {
  key: string
  /** The value's name, its checkbox's accessible name and what the search matches. */
  name: string
  checked: boolean
  count: number
  onChange: () => void
  /** The value as it reads in the grid: a badge, a mark or the plain name. */
  children: ReactNode
}

export type FilterMenuField = {
  id: string
  title: string
  icon: Icon
  /** How many of its values are on. */
  on: number
  options: readonly FilterMenuOption[]
  /** A line under the values, such as why the list leaves something out. */
  note?: ReactNode
}

/** One choice in the Filter menu: a checkbox, the value as it reads in the grid, and its count. */
export function FilterOption({
  name,
  checked,
  count,
  onChange,
  children,
}: Omit<FilterMenuOption, 'key'>) {
  return (
    <label
      data-slot="filter-option"
      aria-label={name}
      className="flex min-h-control-sm cursor-default items-center gap-3 rounded-md px-2 text-dense hover:bg-accent has-data-checked:bg-accent max-md:min-h-control-touch pointer-coarse:min-h-control-touch"
    >
      <Checkbox checked={checked} onCheckedChange={onChange} />
      <span className="flex min-w-0 flex-1 items-center">{children}</span>
      <span aria-hidden="true" className="text-caption text-muted-foreground tabular-nums">
        {count.toLocaleString('en')}
      </span>
    </label>
  )
}

function FieldValues({ field, headingId }: { field: FilterMenuField; headingId?: string }) {
  return (
    <>
      <h2 id={headingId} className="px-2 py-1 text-caption text-muted-foreground">
        {field.title}
      </h2>
      {field.options.map(({ key, ...option }) => (
        <FilterOption key={key} {...option} />
      ))}
      {field.note ? (
        <p className="px-2 py-1 text-caption text-muted-foreground">{field.note}</p>
      ) : null}
    </>
  )
}

/** What a search finds: every value whose name matches, or every value of a field that does. */
function matching(fields: readonly FilterMenuField[], query: string): FilterMenuField[] {
  const words = query.trim().toLocaleLowerCase('en')
  if (!words) return []
  return fields
    .map((field) =>
      field.title.toLocaleLowerCase('en').includes(words)
        ? field
        : {
            ...field,
            options: field.options.filter((option) =>
              option.name.toLocaleLowerCase('en').includes(words),
            ),
          },
    )
    .filter((field) => field.options.length > 0)
}

export function FilterMenu({
  fields,
  activeCount,
  open,
  onOpenChange,
}: {
  fields: readonly FilterMenuField[]
  /** How many values are on in all fields, for the button. */
  activeCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const phone = useIsMobile()
  const [query, setQuery] = useState('')
  const searchId = useId()
  const first = fields.find((field) => field.on > 0)?.id ?? fields[0]?.id
  const found = matching(fields, query)
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery('')
        onOpenChange(next)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="toolbar"
            aria-label={activeCount > 0 ? `Filter, ${activeCount} on` : 'Filter'}
            className={cn(
              'shrink-0 @max-2xl:h-control-touch',
              activeCount > 0 && 'border-ring bg-selected',
            )}
          />
        }
      >
        <SlidersHorizontalIcon aria-hidden="true" />
        Filter
        {activeCount > 0 ? <CountBadge count={activeCount} tone="ink" /> : null}
      </PopoverTrigger>
      <PopoverContent
        sheetTitle="Filter"
        align="start"
        collisionAvoidance={{ side: 'none', align: 'shift', fallbackAxisSide: 'none' }}
        collisionPadding={16}
        className="@container w-dialog gap-0 p-0"
      >
        <label
          htmlFor={searchId}
          className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-muted-foreground max-md:h-control-touch pointer-coarse:h-control-touch"
        >
          <SearchIcon aria-hidden="true" className="size-4 shrink-0" />
          <span className="sr-only">Find a filter</span>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter…"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-dense text-foreground outline-none placeholder:text-muted-foreground max-md:text-large pointer-coarse:text-large [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
        {query.trim() ? (
          <div
            data-slot="filter-results"
            className="flex max-h-list flex-col gap-1 overflow-y-auto p-2"
          >
            {found.length > 0 ? (
              found.map((field) => (
                <section
                  key={field.id}
                  aria-labelledby={`${searchId}-${field.id}`}
                  className="flex flex-col gap-1"
                >
                  <FieldValues field={field} headingId={`${searchId}-${field.id}`} />
                </section>
              ))
            ) : (
              <p role="status" className="px-2 py-1 text-dense text-muted-foreground">
                No filter matches “{query.trim()}”.
              </p>
            )}
          </div>
        ) : (
          <Tabs
            defaultValue={first}
            orientation={phone ? 'horizontal' : 'vertical'}
            className="min-h-0 flex-row gap-0 @max-md:flex-col"
          >
            <TabsList
              aria-label="Filter by"
              className="w-filter-fields shrink-0 items-stretch justify-start gap-1 rounded-none border-r bg-transparent p-2 @max-md:w-full @max-md:flex-row @max-md:flex-wrap @max-md:border-r-0 @max-md:border-b"
            >
              <span className="px-2 py-1 text-caption text-muted-foreground @max-md:sr-only">
                Filter by
              </span>
              {fields.map((field) => (
                <TabsTrigger
                  key={field.id}
                  value={field.id}
                  className="h-auto min-h-control-sm flex-none justify-start gap-2 px-2 py-0 font-normal text-foreground max-md:min-h-control-touch pointer-coarse:min-h-control-touch data-active:bg-accent data-active:shadow-none"
                >
                  <field.icon aria-hidden="true" className="text-muted-foreground" />
                  <span className="truncate">{field.title}</span>
                  {field.on > 0 ? (
                    <span className="ml-auto text-caption text-muted-foreground tabular-nums">
                      {field.on}
                    </span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-2">
              {fields.map((field) => (
                <TabsContent key={field.id} value={field.id} className="flex flex-col gap-1">
                  <FieldValues field={field} />
                </TabsContent>
              ))}
            </div>
          </Tabs>
        )}
      </PopoverContent>
    </Popover>
  )
}
