import type { ReactNode } from 'react'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'
import type { DomainHue, ItemKind } from '@domain/item'
import type { Icon } from '@/components/icons'
import { CutTooltip } from '@/components/ui/truncated-text'
import { useTextCut } from '@/hooks/use-text-cut'
import { cn } from '@/lib/utils'

/*
  The badge (contract 6.13). One anatomy: a mark and a label in a 24 pixel box (md), 20 in
  compact rows, phone rows and menus (sm), radius 6, label weight 400. The mark is a 14 pixel
  icon, 12 in sm: every badge carries one (a domain its Heed domain mark, a date a clock). Four
  forms:

  - soft: tinted fill and a 1px tint line. A domain, always, and anything that asks for a look.
  - outline: a hairline, no fill. A plain fact.
  - bare: the mark and the label, no box. The same fact inside a dense cell.
  - solid: an ink fill. Only a count that waits for this person.

  Tint means look at this: in a healthy row only the domain is tinted.

  A badge is never wider than the room it is given: the label ends in an ellipsis instead. With
  `fullText`, a cut label keeps the whole text in a tooltip (truncated-text.tsx).

  Colour is the Reference recipe (tokens.css, contract 6.13): a very pale tint, a line one step
  darker, and one deep ink for the label and the mark. In dark mode every tone shares one neutral
  fill and line, so the hue is only in the label and the mark.
*/

export type BadgeTone = DomainHue | 'success' | 'warning' | 'info' | 'danger' | ItemKind | 'neutral'

const badgeVariants = cva(
  'inline-flex w-fit max-w-full min-w-0 shrink-0 items-center rounded-badge border font-normal whitespace-nowrap [&>svg]:shrink-0 [&>svg]:text-tone-dot',
  {
    variants: {
      form: {
        soft: 'border-tone-line bg-tone-tint text-tone-ink',
        outline: 'border-border text-foreground',
        bare: 'border-transparent text-tone-ink',
        solid: 'border-ink bg-ink font-bold text-ink-foreground tabular-nums',
      },
      size: {
        md: 'badge-md [&>svg]:size-icon-sm',
        sm: 'badge-sm [&>svg]:size-3 [&>svg]:stroke-icon-sm',
      },
    },
    defaultVariants: { form: 'soft', size: 'md' },
  },
)

type BadgeProps = useRender.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & {
    tone?: BadgeTone
    /** A 14 pixel glyph in the tone: a domain, a date, a state or a type. */
    icon?: Icon
    /** Any other mark of the same size, such as the risk level's bars. */
    mark?: ReactNode
    /**
     * Mutes the label of a bare or outline badge, for a quiet state such as Accepted. A Heed mark
     * in it keeps its point in the foreground.
     */
    quiet?: boolean
    /** Keep the label for assistive technology while drawing only the mark. */
    iconOnly?: boolean
    /** The whole label, as the tooltip says it while the label is cut by the badge's room. */
    fullText?: string
    children?: ReactNode
  }

function Badge({
  className,
  form = 'soft',
  size = 'md',
  tone = 'neutral',
  icon: Glyph,
  mark,
  quiet = false,
  iconOnly = false,
  fullText,
  render,
  children,
  ...props
}: BadgeProps) {
  const label = useTextCut<HTMLSpanElement>(fullText)
  const cut = fullText !== undefined && label.cut
  const badge = useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: cn(
          badgeVariants({ form, size }),
          quiet && 'text-muted-foreground heed-ink',
          cut && 'relative z-raised',
          className,
        ),
        children: (
          <>
            {Glyph ? <Glyph aria-hidden="true" /> : (mark ?? null)}
            <span
              ref={fullText === undefined ? undefined : label.ref}
              data-slot="badge-label"
              className={iconOnly ? 'sr-only' : 'min-w-0 truncate'}
            >
              {children}
            </span>
          </>
        ),
      },
      props,
    ),
    render,
    state: { slot: 'badge', form, size, tone, cut },
  })
  return (
    <CutTooltip cut={cut} text={fullText}>
      {badge}
    </CutTooltip>
  )
}

export { Badge, badgeVariants }
