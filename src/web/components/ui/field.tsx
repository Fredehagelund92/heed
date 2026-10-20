import * as React from 'react'
import { Field as FieldPrimitive } from '@base-ui/react/field'
import { Fieldset as FieldsetPrimitive } from '@base-ui/react/fieldset'
import { cn } from '@/lib/utils'
import { CircleAlertIcon, type Icon } from '@/components/icons'

/**
 * Form fields (contract 9.9), on Base UI's Field so the label, the hint, the counter and the
 * error are tied to the control by id and `aria-describedby` without any wiring in a feature.
 *
 * - The label sits above the field in `text-body` bold, with its field icon (one field, one
 *   icon: the same icon as the column header and the Details key). An optional field says
 *   "optional" in words; there are no asterisks.
 * - A hint sits under the label in `text-caption`, muted.
 * - An error sits under the field in `text-caption` with the danger icon. Pass `invalid` to
 *   `Field` and the message to `FieldError`; the control gets `aria-invalid`.
 * - A character count sits under the field on the right ("62 of 500 characters").
 *
 * Any Base UI control inside (`Input`, `Select`, `Combobox`, `RadioGroup`, `Switch`, `Checkbox`)
 * registers itself. A plain element registers through `FieldControl` with `render`.
 */
/** Set inside a `Field`, so a description knows to join the control's description. */
const InField = React.createContext(false)

/** Set inside a `FieldSet`: a description there describes the whole group. */
const FieldSetDescription = React.createContext<{ id: string; show: (on: boolean) => void } | null>(
  null,
)

function Field({ className, ...props }: FieldPrimitive.Root.Props) {
  return (
    <InField.Provider value>
      <FieldPrimitive.Root
        data-slot="field"
        className={cn('group/field flex w-full min-w-0 flex-col gap-2', className)}
        {...props}
      />
    </InField.Provider>
  )
}

/** The label and the hint under it, as one block above the control. */
function FieldHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="field-header" className={cn('flex flex-col gap-1', className)} {...props} />
  )
}

function FieldLabel({
  className,
  children,
  icon: FieldIcon,
  optional = false,
  ...props
}: FieldPrimitive.Label.Props & {
  /** The field's icon from the icon module. Decorative: the words name the field. */
  icon?: Icon
  /** Adds the word "optional" after the label. */
  optional?: boolean
}) {
  return (
    <FieldPrimitive.Label
      data-slot="field-label"
      className={cn(
        'flex w-fit max-w-full min-w-0 items-start gap-2 text-body font-bold text-foreground heed-ink group-data-disabled/field:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:translate-y-0.5 [&>svg]:text-muted-foreground',
        className,
      )}
      {...props}
    >
      {FieldIcon && <FieldIcon aria-hidden />}
      <span className="min-w-0 break-words">
        {children}
        {optional && (
          <>
            {' '}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </>
        )}
      </span>
    </FieldPrimitive.Label>
  )
}

const descriptionClass =
  'max-w-prose text-caption text-muted-foreground [&_a]:text-brand-ink [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:decoration-2'

/**
 * A hint. Inside a `Field` it describes the control; directly inside a `FieldSet` (one per set)
 * it describes the whole group, read when focus enters it.
 */
function FieldDescription({ className, ...props }: FieldPrimitive.Description.Props) {
  const inField = React.useContext(InField)
  const group = React.useContext(FieldSetDescription)
  const show = group?.show
  React.useLayoutEffect(() => {
    if (inField || !show) return undefined
    show(true)
    return () => show(false)
  }, [inField, show])
  if (inField)
    return (
      <FieldPrimitive.Description
        data-slot="field-description"
        className={cn(descriptionClass, className)}
        {...props}
      />
    )
  const { render: _render, ...rest } = props
  return (
    <p
      id={group?.id}
      data-slot="field-description"
      className={cn(descriptionClass, typeof className === 'string' ? className : undefined)}
      {...(rest as React.ComponentProps<'p'>)}
    />
  )
}

/**
 * The error under a field. Renders nothing without a message, so a field can always hold one.
 * Its id joins the control's `aria-describedby` while it shows.
 */
function FieldError({ className, children, ...props }: FieldPrimitive.Error.Props) {
  if (children === undefined || children === null || children === false || children === '')
    return null
  return (
    <FieldPrimitive.Error
      data-slot="field-error"
      match
      className={cn(
        'flex items-start gap-1 text-caption text-status-danger-fg [&>svg]:size-icon-sm [&>svg]:shrink-0 [&>svg]:translate-y-px [&>svg]:text-status-danger-icon',
        className,
      )}
      {...props}
    >
      <CircleAlertIcon aria-hidden />
      <span className="min-w-0">{children}</span>
    </FieldPrimitive.Error>
  )
}

/** The row under a control: the error or a hint on the left, the counter on the right. */
function FieldFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-footer"
      className={cn(
        'flex items-start justify-between gap-3 empty:hidden *:data-[slot=field-counter]:ml-auto',
        className,
      )}
      {...props}
    />
  )
}

/**
 * "62 of 500 characters". Turns to the danger colour over the limit and says by how much, so
 * colour is not the only sign. It is part of the field's description, read when the control
 * gets focus; it is not a live region, so it does not talk over typing.
 */
function FieldCounter({
  className,
  count,
  max,
  ...props
}: Omit<FieldPrimitive.Description.Props, 'children'> & { count: number; max: number }) {
  const over = count - max
  return (
    <FieldPrimitive.Description
      data-slot="field-counter"
      data-over={over > 0 || undefined}
      className={cn(
        'shrink-0 text-caption whitespace-nowrap text-muted-foreground tabular-nums data-over:font-bold data-over:text-status-danger-fg',
        className,
      )}
      {...props}
    >
      {count.toLocaleString('en')} of {max.toLocaleString('en')} characters
      {over > 0 && `, ${over.toLocaleString('en')} too many`}
    </FieldPrimitive.Description>
  )
}

/** Registers a plain element (a `Textarea`, say) with the field: `render={<Textarea />}`. */
function FieldControl(props: FieldPrimitive.Control.Props) {
  return <FieldPrimitive.Control data-slot="field-control" {...props} />
}

/** One option of a radio or checkbox group: the control, then its label and an optional hint. */
function FieldItem({ className, ...props }: FieldPrimitive.Item.Props) {
  return (
    <FieldPrimitive.Item
      data-slot="field-item"
      className={cn(
        'flex items-start gap-3 *:data-[slot=checkbox]:translate-y-0.5 *:data-[slot=radio-group-item]:translate-y-0.5',
        className,
      )}
      {...props}
    />
  )
}

/** The words beside an option's control: its label and a hint under it. */
function FieldItemContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-item-content"
      className={cn('flex min-w-0 flex-col gap-1', className)}
      {...props}
    />
  )
}

/** Fields stacked at the form's rhythm: 24 between fields, 32 between groups. */
function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-group"
      className={cn('flex w-full flex-col gap-6 *:data-[slot=field-group]:gap-4', className)}
      {...props}
    />
  )
}

/** Related fields under one legend, such as the three parts of "Where this comes from". */
function FieldSet({ className, ...props }: FieldsetPrimitive.Root.Props) {
  const id = React.useId()
  const [described, setDescribed] = React.useState(false)
  const group = React.useMemo(() => ({ id, show: setDescribed }), [id])
  return (
    <FieldSetDescription.Provider value={group}>
      <FieldsetPrimitive.Root
        data-slot="field-set"
        aria-describedby={described ? id : undefined}
        className={cn('flex min-w-0 flex-col gap-4', className)}
        {...props}
      />
    </FieldSetDescription.Provider>
  )
}

function FieldLegend({
  className,
  children,
  icon: LegendIcon,
  ...props
}: FieldsetPrimitive.Legend.Props & { icon?: Icon }) {
  return (
    <FieldsetPrimitive.Legend
      data-slot="field-legend"
      className={cn(
        'flex items-start gap-2 text-body font-bold text-foreground heed-ink [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:translate-y-0.5 [&>svg]:text-muted-foreground',
        className,
      )}
      {...props}
    >
      {LegendIcon && <LegendIcon aria-hidden />}
      <span className="min-w-0">{children}</span>
    </FieldsetPrimitive.Legend>
  )
}

export {
  Field,
  FieldControl,
  FieldCounter,
  FieldDescription,
  FieldError,
  FieldFooter,
  FieldGroup,
  FieldHeader,
  FieldItem,
  FieldItemContent,
  FieldLabel,
  FieldLegend,
  FieldSet,
}
