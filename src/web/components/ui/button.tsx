import * as React from 'react'
import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { LoaderCircleIcon } from '@/components/icons'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { useAfter } from '@/lib/loading'

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition duration-(--dur-1) outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:scale-97 disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 aria-disabled:active:scale-100 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Every variant fades when it is disabled, also when it is only aria-disabled (still focusable,
        // so a press can say why). The primary action instead turns muted but stays legible (never a
        // faded fill that reads as a white button); its tooltip says what is missing.
        default:
          'bg-primary text-primary-foreground hover:bg-primary/80 disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 aria-disabled:border-border aria-disabled:bg-muted aria-disabled:text-muted-foreground aria-disabled:opacity-100 aria-disabled:hover:bg-muted',
        outline:
          'border-border bg-background hover:bg-muted hover:text-foreground aria-disabled:hover:bg-background aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/10 dark:hover:bg-input/20 dark:aria-disabled:hover:bg-input/10',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary-hover aria-disabled:hover:bg-secondary aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-muted hover:text-foreground aria-disabled:hover:bg-transparent aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
        destructive:
          'bg-destructive/10 text-destructive-ink hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 aria-disabled:hover:bg-destructive/10 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40 dark:aria-disabled:hover:bg-destructive/20',
        link: 'text-primary underline-offset-4 hover:underline aria-disabled:hover:no-underline',
      },
      size: {
        default:
          'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: "h-6 gap-1 rounded-md px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-md px-2.5 text-control-sm in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        icon: 'size-8',
        'icon-xs':
          "size-6 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-7 rounded-md in-data-[slot=button-group]:rounded-lg',
        'icon-lg': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

/**
 * `loading`: the action is under way. The button says so to a screen reader at once (aria-busy) and
 * ignores more presses; after 150ms a spinner takes the icon's place, or sits over a label with no
 * icon, so the label and the width stay. With reduced motion the spinner stands still and
 * `loadingLabel` ("Publishing…") says it is still working.
 */
function Button({
  className,
  variant = 'default',
  size = 'default',
  loading,
  loadingLabel,
  children,
  onClick,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean
    loadingLabel?: string
  }) {
  const spin = useAfter(!!loading)
  let content = children
  if (spin) {
    const kids = React.Children.toArray(children)
    const icon = kids.findIndex(
      (k) =>
        React.isValidElement(k) &&
        (k.props as { 'data-icon'?: string })['data-icon'] === 'inline-start',
    )
    const spinner = (
      <LoaderCircleIcon data-icon="inline-start" className="animate-spin" aria-hidden />
    )
    const label = loadingLabel ? (
      <>
        <span className="contents motion-reduce:hidden">
          {icon >= 0 ? kids.filter((_, i) => i !== icon) : kids}
        </span>
        <span className="hidden motion-reduce:inline">{loadingLabel}</span>
      </>
    ) : icon >= 0 ? (
      kids.filter((_, i) => i !== icon)
    ) : (
      kids
    )
    content =
      icon >= 0 ? (
        <>
          {spinner}
          {label}
        </>
      ) : (
        <>
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center motion-reduce:hidden">
            {spinner}
          </span>
          <span className="contents text-transparent motion-reduce:text-inherit">{label}</span>
        </>
      )
  }
  return (
    <ButtonPrimitive
      data-slot="button"
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size, className }), spin && 'relative')}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...props}
    >
      {content}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
