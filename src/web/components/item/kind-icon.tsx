import type { ItemKind } from '@domain/item'
import {
  HeedEventIcon,
  HeedExampleIcon,
  HeedGuideIcon,
  HeedIssueIcon,
  HeedNoteIcon,
  type Icon,
} from '@/components/icons'
import { kindNames } from '@/lib/library-core'
import { cn } from '@/lib/utils'

/** The glyph of each kind, a Heed mark (contract 6.11): one glyph per kind in every screen. */
export const kindGlyphs: Record<ItemKind, Icon> = {
  event: HeedEventIcon,
  note: HeedNoteIcon,
  guide: HeedGuideIcon,
  example: HeedExampleIcon,
  issue: HeedIssueIcon,
}

const kindIconSize = { sm: 'size-icon-sm', md: 'size-4' }

/**
 * The one icon of an item kind, in every screen (Home drew it first): the kind's glyph, bare and
 * quiet. Amber only for an issue that applies today, the one kind that warns; every other kind,
 * and an issue that has ended, stays muted, so the domain badge is a row's one accent. Labelled
 * with the kind's name; `decorative` hides it where the kind is written beside it.
 */
export function KindIcon({
  kind,
  active = false,
  size = 'md',
  decorative = false,
  className,
}: {
  kind: ItemKind
  /** An issue that applies today: the glyph turns amber. Ignored for the other kinds. */
  active?: boolean
  size?: 'sm' | 'md'
  decorative?: boolean
  className?: string
}) {
  const Glyph = kindGlyphs[kind]
  const warns = active && kind === 'issue'
  return (
    <Glyph
      {...(decorative
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': kindNames[kind], 'aria-hidden': false })}
      data-slot="kind-icon"
      data-kind={kind}
      data-active={warns || undefined}
      className={cn(
        'shrink-0',
        kindIconSize[size],
        warns ? 'text-status-warning-icon' : 'text-muted-foreground',
        className,
      )}
    />
  )
}
