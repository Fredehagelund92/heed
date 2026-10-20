import * as React from 'react'
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { useScrollEdges } from '@/hooks/use-scroll-edges'
import './scroll-fade.css'

function Tabs({ className, orientation = 'horizontal', ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn('group/tabs flex gap-2 data-horizontal:flex-col', className)}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  'group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-1 text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none',
  {
    variants: {
      variant: {
        default: 'bg-muted group-data-horizontal/tabs:h-8 max-md:group-data-horizontal/tabs:h-auto',
        /**
         * Page tabs (contract 7.1): a line under the row, 40 high, 44 with a coarse pointer. A row
         * wider than its column (four tabs with counts on a 320 phone) scrolls sideways in place,
         * so the page never does.
         */
        line: 'scroll-fade-x no-scrollbar gap-1 overflow-x-auto overscroll-x-contain bg-transparent p-0 group-data-horizontal/tabs:h-tabs group-data-horizontal/tabs:max-md:min-h-control-touch pointer-coarse:h-control-touch',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function TabsList({
  className,
  variant = 'default',
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  const { ref: list, start, end } = useScrollEdges<HTMLDivElement>()
  // A line row that scrolls keeps its active tab in view, as it opens and as the tab changes;
  // only the row scrolls, never the page. Its clipped edges fade (scroll-fade.css).
  React.useLayoutEffect(() => {
    const row = list.current
    const active = row?.querySelector<HTMLElement>('[data-slot="tabs-trigger"][data-active]')
    if (variant !== 'line' || !row || !active || row.scrollWidth <= row.clientWidth) return
    const from =
      active.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft
    const to = from + active.offsetWidth
    if (from < row.scrollLeft) row.scrollTo({ left: from })
    else if (to > row.scrollLeft + row.clientWidth) row.scrollTo({ left: to - row.clientWidth })
  })
  return (
    <TabsPrimitive.List
      ref={list}
      data-slot="tabs-list"
      data-variant={variant}
      data-clip-start={(variant === 'line' && start) || undefined}
      data-clip-end={(variant === 'line' && end) || undefined}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-full flex-1 items-center justify-center gap-2 rounded-md border border-transparent px-2 py-1 text-dense font-bold whitespace-nowrap text-foreground/60 -outline-offset-2 transition-colors group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 max-md:min-h-control-touch dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-raised group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        'group-data-[variant=line]/tabs-list:flex-none group-data-[variant=line]/tabs-list:px-3 group-data-[variant=line]/tabs-list:after:inset-x-2 group-data-[variant=line]/tabs-list:after:bottom-0 group-data-[variant=line]/tabs-list:after:rounded-full',
        'group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent',
        'data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground',
        'after:absolute after:border-foreground after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:-bottom-1 group-data-horizontal/tabs:after:h-0 group-data-horizontal/tabs:after:border-t-2 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0 group-data-vertical/tabs:after:border-l-2 group-data-[variant=line]/tabs-list:data-active:after:opacity-100',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn('flex-1 text-dense outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
