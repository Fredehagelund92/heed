import { createContext, isValidElement, use, type ReactElement } from 'react'
import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-dense font-bold whitespace-nowrap transition-press select-none active:not-aria-[haspopup]:scale-97 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /** The main button, in the product accent (contract 6.1). */
        // A key hint in the solid button takes its colour, as it does in a tooltip.
        default:
          'bg-primary text-primary-foreground hover:bg-primary-hover **:data-[slot=kbd]:bg-primary-foreground/20 **:data-[slot=kbd]:text-primary-foreground',
        /** Ink, for a control that must not read as the main action: the assistant launcher. */
        ink: 'bg-ink text-ink-foreground hover:bg-ink-hover',
        outline:
          'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        ghost:
          'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
        /** The tinted danger button (contract 7.1): the danger status pair, which meets AA in both themes. */
        destructive:
          'border-status-danger-border bg-status-danger-bg text-status-danger-fg hover:border-status-danger-icon [&_svg]:text-status-danger-icon',
        link: 'text-brand-ink underline-offset-4 hover:underline',
      },
      size: {
        /** 32, the default for toolbars, headers and menus (contract 6.6). */
        default:
          'h-control-md gap-2 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 max-md:min-h-control-touch pointer-coarse:h-control-touch',
        /** 28, inline row buttons and buttons in a panel header. */
        sm: 'h-control-sm gap-1 px-2 max-md:min-h-control-touch',
        /**
         * 28 with the default's room, in a 44 pixel toolbar and the 48 pixel header (the
         * professional pass, rule 2). 44 with a coarse pointer.
         */
        toolbar:
          'h-control-sm gap-2 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 max-md:min-h-control-touch pointer-coarse:h-control-touch',
        /** 40, form buttons on the paper, in dialogs and on the first-run page. */
        lg: 'h-control-lg gap-2 px-4 text-body has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 max-md:min-h-control-touch pointer-coarse:h-control-touch',
        /** 44, everything on phones. */
        touch: 'h-control-touch gap-2 px-4',
        icon: 'size-control-md max-md:min-h-control-touch max-md:min-w-control-touch pointer-coarse:size-control-touch',
        'icon-sm': 'size-control-sm max-md:min-h-control-touch max-md:min-w-control-touch',
        /** The icon-only toolbar and header button: 28, 44 with a coarse pointer. */
        'icon-toolbar':
          'size-control-sm max-md:min-h-control-touch max-md:min-w-control-touch pointer-coarse:size-control-touch',
        'icon-lg':
          'size-control-lg max-md:min-h-control-touch max-md:min-w-control-touch pointer-coarse:size-control-touch',
        'icon-touch': 'size-control-touch',
      },
    },
  },
)

type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>

/**
 * Inside a quiet region an outline button is drawn as a ghost one (the professional pass, rule
 * 4: a box means a field, a filter that is on, or the one primary action). The docked panel's
 * head and footer and a dialog's footer are quiet (`<QuietButtons value>`), so their secondary
 * actions sit as ghost buttons beside the one primary, while the same action groups keep their
 * outline on a document page. A bare context, so the first load carries no component for it.
 */
const QuietButtons = createContext(false)

function Button({
  className,
  variant = 'default',
  size = 'default',
  render,
  nativeButton,
  ...props
}: ButtonProps) {
  const drawn = variant === 'outline' && use(QuietButtons) ? 'ghost' : variant
  const classes = cn(buttonVariants({ variant: drawn, size, className }))
  // A button drawn as a link (`render={<Link />}`) stays a link: the anchor keeps its own role
  // and keys, and Base UI does not warn that a native button is missing.
  if (isValidElement(render) && nativeButton === undefined) {
    const { disabled: _disabled, focusableWhenDisabled: _focusable, ...rest } = props
    // Only the props an anchor takes are left; the ref is the anchor's.
    const anchor = rest as unknown as useRender.ComponentProps<'a'>
    return <LinkButton {...anchor} render={render} className={classes} />
  }
  return (
    <ButtonPrimitive
      data-slot="button"
      className={classes}
      render={render}
      nativeButton={nativeButton}
      {...props}
    />
  )
}

function LinkButton({
  render,
  ...props
}: useRender.ComponentProps<'a'> & { render: ReactElement }) {
  return useRender({
    defaultTagName: 'a',
    render,
    props: mergeProps<'a'>({ 'data-slot': 'button' } as useRender.ComponentProps<'a'>, props),
  })
}

export { Button, QuietButtons, buttonVariants }
