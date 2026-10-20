import { Link } from '@tanstack/react-router'
import type { Area, ItemKind } from '@domain/item'
import { parseMentions } from '@domain/mentions'
import type { ItemLinks } from '@/api'
import { MentionChip, type MentionChipTarget } from '@/components/item/mention-chip'
import { PreviewLink } from '@/components/preview/preview-link'
import { previewTargetOf } from '@/lib/preview'

/*
  The item's text with its @ mentions as inline chips (FR-129, contract 6.13). The plain summary
  and body are what agents read; the markup is the same text with typed mentions, so the page
  shows the chip where the author wrote one. A chip links where it points and previews it on hover,
  focus or a tap (components/preview): an item to its page, a metric or a dimension to its
  catalogue page, a value to its dimension's page with the value picked out. A domain keeps its
  link to the library of that domain, which has no catalogue page.
*/

export type MentionLookup = {
  /** Kind and whether it is an ended issue, for items in the person's library. */
  item: (id: string) => { kind: ItemKind; calm: boolean } | undefined
  area: (id: string) => Area | undefined
  links: ItemLinks | undefined
}

type Field = 'summary' | 'body'

function chipTarget(target: string, lookup: MentionLookup): MentionChipTarget {
  const [prefix, rest = ''] = target.split(/:(.*)/s)
  if (prefix === 'item') {
    const known = lookup.item(rest)
    return { type: 'item', kind: known?.kind ?? 'note', calm: known?.calm ?? false }
  }
  if (prefix === 'area') return { type: 'area', label: lookup.area(rest)?.label ?? 'gray' }
  if (prefix === 'metric') return { type: 'metric' }
  if (prefix === 'dim') return { type: 'dim' }
  return { type: 'val' }
}

const linkClass =
  'rounded-badge outline-none focus-visible:outline-2 focus-visible:outline-ring hover:[&>[data-slot=mention-chip]]:bg-accent'

function Paragraphs({
  field,
  plain,
  markup,
  lookup,
}: {
  field: Field
  plain: string
  markup: string | undefined
  lookup: MentionLookup
}) {
  if (markup === undefined) {
    return plain.split(/\n{2,}/).map((paragraph, at) => <p key={at}>{paragraph}</p>)
  }
  const status = new Map(
    (lookup.links?.mentions ?? [])
      .filter((mention) => mention.field === field)
      .map((mention) => [mention.position, mention.target.status]),
  )
  let position = 0
  return markup.split(/\n{2,}/).map((paragraph, at) => (
    <p key={at}>
      {parseMentions(paragraph).parts.map((part, index) => {
        if (part.kind === 'text') return part.text
        const target = chipTarget(part.target, lookup)
        const state = status.get(position)
        position += 1
        const missing = state === 'retired' || state === 'source_missing'
        const preview = missing ? null : previewTargetOf(part.target)
        const chip = (
          <MentionChip target={target} name={part.label} missing={missing} hint={!preview} />
        )
        if (preview)
          return (
            <PreviewLink key={index} preview={preview} className={linkClass}>
              {chip}
            </PreviewLink>
          )
        if (!missing && target.type === 'area')
          return (
            <Link
              key={index}
              to="/library"
              search={{ area: part.target.slice('area:'.length) }}
              data-slot="mention-link"
              className={linkClass}
            >
              {chip}
            </Link>
          )
        return <span key={index}>{chip}</span>
      })}
    </p>
  ))
}

export function ItemText({
  summary,
  summaryMarkup,
  body,
  bodyMarkup,
  lookup,
  reading = false,
}: {
  reading?: boolean
  summary: string
  summaryMarkup?: string
  body?: string
  bodyMarkup?: string
  lookup: MentionLookup
}) {
  return (
    <div
      data-slot="item-text"
      className={`flex max-w-prose flex-col gap-3 ${reading ? 'text-reading' : 'text-large'}`}
    >
      <Paragraphs field="summary" plain={summary} markup={summaryMarkup} lookup={lookup} />
      {body ? <Paragraphs field="body" plain={body} markup={bodyMarkup} lookup={lookup} /> : null}
    </div>
  )
}
