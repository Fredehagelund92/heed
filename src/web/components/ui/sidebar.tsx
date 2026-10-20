import * as React from 'react'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

import { useIsMobile } from '@/hooks/use-mobile'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// Widths come from tokens.css (--sidebar-width, --sidebar-width-icon), not from this file.

// The phone's sheet loads only on a phone (sidebar-sheet.tsx). It opens as soon as it arrives
// when the sidebar was opened before that.
const SidebarSheet = React.lazy(() =>
  import('./sidebar-sheet').then((module) => ({ default: module.SidebarSheet })),
)

type SidebarContextProps = {
  state: 'expanded' | 'collapsed'
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider.')
  }

  return context
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === 'function' ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }
    },
    [setOpenProp, open],
  )

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open)
  }, [isMobile, setOpen, setOpenMobile])

  // The keyboard shortcut (mod+b) is bound from the command registry (src/web/lib/commands.ts).

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? 'expanded' : 'collapsed'

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar],
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        className={cn('group/sidebar-wrapper flex min-h-svh w-full', className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

function Sidebar({
  side = 'left',
  collapsible = 'offcanvas',
  peek = false,
  className,
  children,
  dir,
  ...props
}: React.ComponentProps<'div'> & {
  side?: 'left' | 'right'
  collapsible?: 'offcanvas' | 'icon' | 'none'
  /** Tablets: the expanded sidebar overlays the page instead of pushing it (contract 4.2). */
  peek?: boolean
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

  if (collapsible === 'none') {
    return (
      <div
        data-slot="sidebar"
        className={cn(
          'flex h-full w-sidebar flex-col bg-sidebar text-sidebar-foreground',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    )
  }

  if (isMobile) {
    return (
      <React.Suspense fallback={null}>
        <SidebarSheet
          open={openMobile}
          onOpenChange={setOpenMobile}
          dir={dir}
          side={side}
          {...props}
        >
          {children}
        </SidebarSheet>
      </React.Suspense>
    )
  }

  return (
    <div
      className="group peer hidden text-sidebar-foreground md:block"
      data-state={state}
      data-collapsible={state === 'collapsed' ? collapsible : ''}
      data-side={side}
      data-peek={peek || undefined}
      data-slot="sidebar"
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          'relative w-sidebar bg-transparent transition-layout duration-base ease-out',
          'group-data-[collapsible=offcanvas]:w-0',
          'group-data-[side=right]:rotate-180',
          'group-data-peek:w-rail group-data-[collapsible=icon]:w-rail',
        )}
      />
      <div
        data-slot="sidebar-container"
        data-side={side}
        className={cn(
          'fixed inset-y-0 z-sticky hidden h-svh w-sidebar transition-layout duration-base ease-out data-[side=left]:left-0 data-[side=left]:group-data-[collapsible=offcanvas]:-left-sidebar data-[side=right]:right-0 data-[side=right]:group-data-[collapsible=offcanvas]:-right-sidebar md:flex',
          'group-data-peek:z-sidebar group-data-peek:shadow-overlay group-data-[collapsible=icon]:w-rail group-data-[side=left]:border-r group-data-[side=right]:border-l',
          className,
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="flex size-full flex-col bg-sidebar"
        >
          {children}
        </div>
      </div>
    </div>
  )
}

// A plain region (not <main>): the shell puts the banner and the <main> landmark inside it.
function SidebarInset({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-inset"
      className={cn('relative flex w-full min-w-0 flex-1 flex-col bg-background', className)}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn('flex flex-col gap-2 p-2', className)}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn('flex flex-col gap-2 p-2', className)}
      {...props}
    />
  )
}

function SidebarSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn('w-auto bg-sidebar-border', className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        'no-scrollbar flex min-h-0 flex-1 flex-col gap-0 overflow-auto group-data-[collapsible=icon]:overflow-hidden',
        className,
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn('relative flex w-full min-w-0 flex-col p-2', className)}
      {...props}
    />
  )
}

function SidebarGroupLabel({
  className,
  render,
  ...props
}: useRender.ComponentProps<'div'> & React.ComponentProps<'div'>) {
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        className: cn(
          'flex h-control-md shrink-0 items-center rounded-md px-2 text-caption text-muted-foreground -outline-offset-2 transition-opacity duration-instant group-data-[collapsible=icon]:hidden [&>svg]:size-4 [&>svg]:shrink-0',
          className,
        ),
      },
      props,
    ),
    render,
    state: {
      slot: 'sidebar-group-label',
      sidebar: 'group-label',
    },
  })
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn('flex w-full min-w-0 flex-col gap-0', className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn('group/menu-item relative', className)}
      {...props}
    />
  )
}

const sidebarMenuButtonVariants = cva(
  'peer/menu-button group/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-dense -outline-offset-2 transition-layout group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-control-md! group-data-[collapsible=icon]:p-2! hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-open:hover:bg-sidebar-accent data-open:hover:text-sidebar-accent-foreground data-active:bg-selected data-active:font-bold data-active:text-sidebar-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate',
  {
    variants: {
      variant: {
        default: 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        outline:
          'bg-background ring-1 ring-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:ring-1 hover:ring-sidebar-accent',
      },
      size: {
        /** 28 from 768 wide (the professional pass), 32 in the phone's sheet. */
        default: 'h-control-touch text-dense md:h-control-sm',
        sm: 'h-control-sm text-caption',
        lg: 'h-12 text-dense group-data-[collapsible=icon]:p-1!',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function SidebarMenuButton({
  render,
  isActive = false,
  variant = 'default',
  size = 'default',
  tooltip,
  className,
  ...props
}: useRender.ComponentProps<'button'> &
  React.ComponentProps<'button'> & {
    isActive?: boolean
    tooltip?: string | React.ComponentProps<typeof TooltipContent>
  } & VariantProps<typeof sidebarMenuButtonVariants>) {
  const { isMobile, state } = useSidebar()
  const comp = useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(
      {
        className: cn(sidebarMenuButtonVariants({ variant, size }), className),
      },
      props,
    ),
    render: !tooltip ? render : <TooltipTrigger render={render} />,
    state: {
      slot: 'sidebar-menu-button',
      sidebar: 'menu-button',
      size,
      active: isActive,
    },
  })

  if (!tooltip) {
    return comp
  }

  if (typeof tooltip === 'string') {
    tooltip = {
      children: tooltip,
    }
  }

  return (
    <Tooltip>
      {comp}
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== 'collapsed' || isMobile}
        {...tooltip}
      />
    </Tooltip>
  )
}

/** A count at the end of a menu button. It is as tall as the button, so its centre is the label's. */
function SidebarMenuBadge({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        'pointer-events-none absolute top-0 right-2 flex h-control-touch items-center justify-end text-caption text-muted-foreground tabular-nums select-none group-data-[collapsible=icon]:hidden peer-data-[size=lg]/menu-button:h-12 peer-data-[size=sm]/menu-button:h-control-sm md:peer-data-[size=default]/menu-button:h-control-sm',
        className,
      )}
      {...props}
    />
  )
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn('flex min-w-0 flex-col gap-0 group-data-[collapsible=icon]:hidden', className)}
      {...props}
    />
  )
}

function SidebarMenuSubItem({ className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn('group/menu-sub-item relative', className)}
      {...props}
    />
  )
}

function SidebarMenuSubButton({
  render,
  size = 'md',
  isActive = false,
  className,
  ...props
}: useRender.ComponentProps<'a'> &
  React.ComponentProps<'a'> & {
    size?: 'sm' | 'md'
    isActive?: boolean
  }) {
  return useRender({
    defaultTagName: 'a',
    props: mergeProps<'a'>(
      {
        className: cn(
          'flex h-control-touch min-w-0 items-center gap-2 overflow-hidden rounded-md pr-2 pl-8 text-sidebar-foreground -outline-offset-2 group-data-[collapsible=icon]:hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[size=md]:text-dense data-[size=sm]:text-caption md:h-control-sm data-active:bg-selected data-active:font-bold data-active:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground',
          className,
        ),
      },
      props,
    ),
    render,
    state: {
      slot: 'sidebar-menu-sub-button',
      sidebar: 'menu-sub-button',
      size,
      active: isActive,
    },
  })
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarSeparator,
  useSidebar,
}
