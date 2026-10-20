import * as React from 'react'
import { Select as SelectPrimitive } from '@base-ui/react/select'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { usePopupLayer } from '@/components/ui/layer'
import { CheckIcon, ChevronDownIcon, ChevronsUpDownIcon, ChevronUpIcon } from '@/components/icons'

/**
 * Select on Base UI (contract 7.1): a button that opens a list. Inside a `Field` it is labelled
 * and described by the field. `lg` (40) is the size for forms on the paper and in dialogs, the
 * default (32) for toolbars, `rich` for a value of two lines (the sign-in's person). A coarse
 * pointer always gets 44. On phones, short lists use `NativeSelect` instead.
 */
const Select = SelectPrimitive.Root

const selectTriggerVariants = cva(
  "group/select-trigger flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background whitespace-nowrap text-foreground transition-colors select-none hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-placeholder:text-muted-foreground *:data-[slot=select-value]:truncate max-md:min-h-control-touch max-md:text-large dark:bg-input/30 dark:hover:bg-input/50 pointer-coarse:text-large [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      size: {
        default: 'h-control-md px-3 text-dense pointer-coarse:h-control-touch',
        lg: 'h-control-lg px-3 text-body pointer-coarse:h-control-touch',
        /**
         * At least 40 (44 on a coarse pointer), growing to a value of two lines: an avatar, a name
         * and a line under it.
         */
        rich: 'min-h-control-lg py-2 pr-3 pl-2 text-body pointer-coarse:min-h-control-touch',
      },
    },
    defaultVariants: { size: 'default' },
  },
)

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn('flex min-w-0 flex-1 items-center gap-2 text-left', className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: SelectPrimitive.Trigger.Props & VariantProps<typeof selectTriggerVariants>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(selectTriggerVariants({ size }), className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon render={<ChevronsUpDownIcon className="text-muted-foreground" />} />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = 'bottom',
  sideOffset = 4,
  align = 'start',
  alignOffset = 0,
  alignItemWithTrigger = false,
  collisionPadding = 12,
  empty,
  ...props
}: SelectPrimitive.Popup.Props & {
  /** Shown when there are no options: say why, and what to do. */
  empty?: React.ReactNode
} & Pick<
    SelectPrimitive.Positioner.Props,
    'align' | 'alignOffset' | 'side' | 'sideOffset' | 'alignItemWithTrigger' | 'collisionPadding'
  >) {
  const layer = usePopupLayer()
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        // A long list stops 12 short of the window's edge, so its end reads as the list's edge,
        // not the window's, and scrolls inside. 12, not the menus' 16, keeps the sign-in's twelve
        // demo people in one list at 1440 by 900.
        collisionPadding={collisionPadding}
        className={cn('isolate', layer)}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            'relative isolate flex max-h-(--available-height) w-(--anchor-width) min-w-menu origin-(--transform-origin) flex-col overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-raised ring-1 ring-foreground/10 duration-fast outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            layer,
            className,
          )}
          {...props}
        >
          <SelectScrollUpButton />
          {/* The list scrolls, not the popup: Base UI shows the scroll arrows from the list. */}
          <SelectPrimitive.List className="min-h-0 overflow-x-hidden overflow-y-auto">
            {empty !== undefined && React.Children.count(children) === 0 ? (
              // A listbox needs an option, so the message is one that cannot be chosen.
              <SelectPrimitive.Item
                data-slot="select-empty"
                value="__empty__"
                disabled
                className="px-2 py-2 text-dense text-muted-foreground"
              >
                {empty}
              </SelectPrimitive.Item>
            ) : (
              children
            )}
          </SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn('flex flex-col', className)}
      {...props}
    />
  )
}

function SelectLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn('px-2 py-1 text-caption text-muted-foreground', className)}
      {...props}
    />
  )
}

/**
 * One option: 32 high (44 on a coarse pointer), its text and a tick when chosen. Put a mark,
 * a second line or a count inside; only the text in `SelectItemText` names the option.
 */
function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex min-h-control-md w-full cursor-default items-center gap-2 rounded-md py-1 pr-8 pl-2 text-dense outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground max-md:min-h-control-touch pointer-coarse:min-h-control-touch data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

/** The words that name an option, shown in the trigger once it is chosen. */
function SelectItemText({ className, ...props }: SelectPrimitive.ItemText.Props) {
  return (
    <SelectPrimitive.ItemText
      data-slot="select-item-text"
      className={cn('min-w-0 truncate', className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        'absolute inset-x-0 top-0 z-sticky flex cursor-default items-center justify-center rounded-t-lg bg-popover py-1',
        className,
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        'absolute inset-x-0 bottom-0 z-sticky flex cursor-default items-center justify-center rounded-b-lg bg-popover py-1',
        className,
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  selectTriggerVariants,
}
