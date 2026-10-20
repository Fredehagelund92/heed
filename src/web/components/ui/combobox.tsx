import * as React from 'react'
import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { usePopupLayer } from '@/components/ui/layer'
import { CheckIcon, ChevronsUpDownIcon, LoaderCircleIcon, XIcon } from '@/components/icons'

/**
 * Combobox on Base UI (contract 7.1): a text input that filters a list. Single or multiple;
 * the multiple form holds its choices as chips inside the field. Typing filters, Up and Down
 * move, Enter picks, Escape closes, Backspace in an empty chip input removes the last chip.
 * The states the contract asks for: open, loading options (`ComboboxStatus`), no match
 * (`ComboboxEmpty`) and max reached (the caller disables the items and says why).
 */
const Combobox = ComboboxPrimitive.Root

/** The field box, shared by the single input and the chips: the same height as a `SelectTrigger`. */
const comboboxFieldVariants = cva(
  'relative flex w-full min-w-0 items-center rounded-md border border-input bg-background text-foreground transition-colors has-disabled:cursor-not-allowed has-disabled:opacity-50 has-aria-invalid:border-destructive has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring max-md:min-h-control-touch max-md:text-large dark:bg-input/30 pointer-coarse:min-h-control-touch pointer-coarse:text-large',
  {
    variants: {
      size: {
        default: 'min-h-control-md text-dense',
        /** 28, in a toolbar beside the toolbar's other controls; its open button is 24. */
        toolbar: 'min-h-control-sm text-dense',
        lg: 'min-h-control-lg text-body',
      },
    },
    defaultVariants: { size: 'default' },
  },
)

function ComboboxValue({ ...props }: ComboboxPrimitive.Value.Props) {
  return <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />
}

/** The single-choice field: an input with a button that opens the list, and an optional clear. */
function ComboboxInput({
  className,
  size = 'default',
  showClear = false,
  disabled = false,
  ...props
}: Omit<ComboboxPrimitive.Input.Props, 'size'> &
  VariantProps<typeof comboboxFieldVariants> & { showClear?: boolean }) {
  return (
    <div
      data-slot="combobox-field"
      className={cn(comboboxFieldVariants({ size }), 'h-auto pr-1', className)}
    >
      <ComboboxPrimitive.Input
        data-slot="combobox-input"
        disabled={disabled}
        className="min-w-0 flex-1 self-stretch bg-transparent pl-3 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        {...props}
      />
      {showClear && (
        <ComboboxPrimitive.Clear
          data-slot="combobox-clear"
          aria-label="Clear"
          disabled={disabled}
          className="inline-flex size-control-sm shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground max-md:size-control-touch [&_svg]:size-4"
        >
          <XIcon />
        </ComboboxPrimitive.Clear>
      )}
      <ComboboxPrimitive.Trigger
        data-slot="combobox-trigger"
        aria-label="Show options"
        disabled={disabled}
        className={cn(
          'inline-flex size-control-sm shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground max-md:size-control-touch [&_svg]:size-4',
          size === 'toolbar' && 'size-6',
        )}
      >
        <ChevronsUpDownIcon />
      </ComboboxPrimitive.Trigger>
    </div>
  )
}

/**
 * The multiple-choice field: chips first, then the input. Pass the same ref to
 * `ComboboxContent`'s `anchor` (see `useComboboxAnchor`) so the list lines up with the box.
 */
function ComboboxChips({
  className,
  size = 'default',
  ...props
}: React.ComponentPropsWithRef<typeof ComboboxPrimitive.Chips> &
  ComboboxPrimitive.Chips.Props &
  VariantProps<typeof comboboxFieldVariants>) {
  return (
    <ComboboxPrimitive.Chips
      data-slot="combobox-chips"
      className={cn(comboboxFieldVariants({ size }), 'flex-wrap gap-1 px-1 py-1', className)}
      {...props}
    />
  )
}

/**
 * One choice inside the chips: the outline badge (radius 4, 24 high) with a remove button
 * named after it ("Remove Norway"). Arrow keys move between chips, Backspace removes one.
 */
function ComboboxChip({
  className,
  children,
  label,
  showRemove = true,
  ...props
}: ComboboxPrimitive.Chip.Props & {
  /** The chip's name for the remove button, when its children are not plain text. */
  label?: string
  showRemove?: boolean
}) {
  const name = label ?? (typeof children === 'string' ? children : undefined)
  return (
    <ComboboxPrimitive.Chip
      data-slot="combobox-chip"
      className={cn(
        'flex badge-md max-w-full min-w-0 items-center rounded-badge border border-border bg-background whitespace-nowrap text-foreground outline-offset-0 focus-visible:outline-2 focus-visible:outline-ring has-disabled:pointer-events-none has-disabled:opacity-50 has-data-[slot=combobox-chip-remove]:pr-0 [&_svg:not([class*="size-"])]:size-icon-sm',
        className,
      )}
      {...props}
    >
      <span className="flex min-w-0 items-center gap-1 truncate">{children}</span>
      {showRemove && (
        <ComboboxPrimitive.ChipRemove
          data-slot="combobox-chip-remove"
          aria-label={name ? `Remove ${name}` : 'Remove'}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-badge text-muted-foreground hover:text-foreground [&_svg]:size-icon-sm"
        >
          <XIcon />
        </ComboboxPrimitive.ChipRemove>
      )}
    </ComboboxPrimitive.Chip>
  )
}

function ComboboxChipsInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-chip-input"
      className={cn(
        'h-6 min-w-16 flex-1 bg-transparent px-2 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  )
}

function useComboboxAnchor() {
  return React.useRef<HTMLDivElement | null>(null)
}

function ComboboxContent({
  className,
  side = 'bottom',
  sideOffset = 4,
  align = 'start',
  alignOffset = 0,
  anchor,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    'side' | 'align' | 'sideOffset' | 'alignOffset' | 'anchor'
  >) {
  const layer = usePopupLayer()
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className={cn('isolate', layer)}
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            'group/combobox-content relative flex max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) min-w-menu origin-(--transform-origin) flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-raised ring-1 ring-foreground/10 duration-fast data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        'max-h-list scroll-py-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0',
        className,
      )}
      {...props}
    />
  )
}

/** One option, 32 high (44 on a coarse pointer). A count or a second label goes in `ComboboxItemMeta`. */
function ComboboxItem({ className, children, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "relative flex min-h-control-md w-full cursor-default items-center gap-2 rounded-md py-1 pr-8 pl-2 text-dense outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground max-md:min-h-control-touch pointer-coarse:min-h-control-touch data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

/** Right-aligned quiet text in an option: a count, or "also called Norge". */
function ComboboxItemMeta({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="combobox-item-meta"
      className={cn('ml-auto shrink-0 text-caption text-muted-foreground tabular-nums', className)}
      {...props}
    />
  )
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return (
    <ComboboxPrimitive.Group
      data-slot="combobox-group"
      className={cn('flex flex-col', className)}
      {...props}
    />
  )
}

function ComboboxLabel({ className, ...props }: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-label"
      className={cn('px-2 py-1 text-caption text-muted-foreground', className)}
      {...props}
    />
  )
}

function ComboboxCollection({ ...props }: ComboboxPrimitive.Collection.Props) {
  return <ComboboxPrimitive.Collection data-slot="combobox-collection" {...props} />
}

/** Shown when nothing matches the text. Say what to do, never accept the unknown value. */
function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        'hidden flex-col items-start gap-2 p-3 text-dense text-muted-foreground group-data-empty/combobox-content:flex',
        className,
      )}
      {...props}
    />
  )
}

/**
 * A polite status line in the list: "Loading options", or why nothing more can be added. It
 * stays mounted so screen readers hear each change; only its children change.
 */
function ComboboxStatus({
  className,
  loading = false,
  children,
  ...props
}: ComboboxPrimitive.Status.Props & { loading?: boolean }) {
  return (
    <ComboboxPrimitive.Status
      data-slot="combobox-status"
      className={cn(
        'flex items-center gap-2 px-3 py-2 text-dense text-muted-foreground empty:p-0',
        className,
      )}
      {...props}
    >
      {loading && <LoaderCircleIcon aria-hidden className="size-4 motion-safe:animate-spin" />}
      {children}
    </ComboboxPrimitive.Status>
  )
}

export {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemMeta,
  ComboboxLabel,
  ComboboxList,
  ComboboxStatus,
  ComboboxValue,
  useComboboxAnchor,
}
