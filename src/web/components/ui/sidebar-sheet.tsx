import * as React from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

/**
 * The sidebar on a phone: a sheet from the side. A chunk of its own (sidebar.tsx loads it only on
 * a phone), so the dialog's focus trap, scroll lock and dismissal are not part of the first load
 * on a wider screen.
 */
export function SidebarSheet({
  open,
  onOpenChange,
  side,
  dir,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  open: boolean
  onOpenChange: (open: boolean) => void
  side: 'left' | 'right'
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} {...props}>
      <SheetContent
        dir={dir}
        data-sidebar="sidebar"
        data-slot="sidebar"
        data-mobile="true"
        // The phone sheet sits on the sidebar layer (contract 6.10), under menus and popovers,
        // so the user menu and other menus opened from it show above it.
        className="z-sidebar bg-sidebar p-0 text-sidebar-foreground data-[side=left]:w-sidebar! data-[side=right]:w-sidebar! [&>button]:hidden"
        overlayClassName="z-sidebar"
        side={side}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Sidebar</SheetTitle>
          <SheetDescription>Displays the mobile sidebar.</SheetDescription>
        </SheetHeader>
        <div className="flex h-full w-full flex-col">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
