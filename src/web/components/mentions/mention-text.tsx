import { Fragment } from 'react'
import { parseMentions } from '@domain/mentions'
import { MentionChip, type MentionChipTarget } from '@/components/item/mention-chip'
import { PreviewLink } from '@/components/preview/preview-link'
import { targetType, type MentionStatus } from '@/lib/mention-names'
import type { MentionOption } from '@/lib/mention-targets'
import { previewTargetOf } from '@/lib/preview'

const linkClass =
  'rounded-badge outline-none focus-visible:outline-2 focus-visible:outline-ring hover:[&>[data-slot=mention-chip]]:bg-accent'

/** The chip look for a stored target: from the target when it is known, else from its prefix. */
export function chipTargetOf(key: string, option?: MentionOption): MentionChipTarget {
  const type = option?.type ?? targetType(key) ?? 'item'
  if (type === 'area') return { type, label: option?.label ?? 'gray' }
  if (type === 'item') return { type, kind: option?.kind ?? 'note' }
  return { type }
}

/**
 * One stored mention as its chip. For a metric, a dimension, a value or an item that is still
 * there, the chip links to its page and previews it on hover, focus or a tap
 * (components/preview); a domain, a missing target and a retired one stay a plain chip.
 */
export function LinkedMentionChip({
  targetKey,
  label,
  option,
  status = option?.status ?? 'current',
  missing = !option,
}: {
  /** The target as the markup stores it. */
  targetKey: string
  label: string
  option?: MentionOption
  status?: MentionStatus
  missing?: boolean
}) {
  const preview =
    missing || status === 'retired' || status === 'source_missing'
      ? null
      : previewTargetOf(targetKey)
  const chip = (
    <MentionChip
      target={chipTargetOf(targetKey, option)}
      name={label}
      status={status}
      missing={missing}
      hint={!preview}
    />
  )
  return preview ? (
    <PreviewLink preview={preview} className={linkClass}>
      {chip}
    </PreviewLink>
  ) : (
    chip
  )
}

/**
 * Text with mentions, read only: each `@[words](target)` token is an inline chip that shows the
 * author's words with the look of what it points at; the rest is plain text. A target that is
 * not in `targets` is a missing chip, unless `statuses` (from `items.links`) knows its state.
 * Malformed tokens stay as the text they were written as.
 */
export function MentionText({
  markup,
  lookup,
  statuses,
}: {
  markup: string
  /** The known targets by key (mention-targets.ts, targetsByKey). */
  lookup: ReadonlyMap<string, MentionOption>
  statuses?: Readonly<Record<string, MentionStatus>>
}) {
  return parseMentions(markup).parts.map((part, index) => {
    if (part.kind === 'text') return <Fragment key={index}>{part.text}</Fragment>
    const option = lookup.get(part.target)
    return (
      <LinkedMentionChip
        key={index}
        targetKey={part.target}
        label={part.label}
        option={option}
        status={statuses?.[part.target] ?? option?.status ?? 'current'}
        missing={!option && !statuses?.[part.target]}
      />
    )
  })
}
