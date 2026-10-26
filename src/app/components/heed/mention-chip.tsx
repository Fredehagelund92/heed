import * as React from 'react'
import { CircleSlashIcon, FolderIcon, GlobeIcon, UserRoundIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { PersonAvatar } from '@/components/heed/bits'
import { TypeGlyph } from '@/components/heed/definition'
import { kindIcons } from '@/components/heed/kind-icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { domains, person, type DomainId } from '@/data/world'
import { chipTone, domainHue } from '@/lib/tones'
import { openDock } from '@/lib/dock'
import {
  mentionParts,
  parseMentionId,
  useMentionTarget,
  type Mentionable,
  type MentionRef,
} from '@/lib/mentions'

// A mention as a small chip with its type's icon, the same in the editors, the Ask composer, a
// question, comments and read-only text. A click opens its quick view: a context item or a
// definition in the dock, a domain or a person as a small card. Navigation only. A target that
// was deleted or archived keeps the author's words in a calm dashed chip that says it is no
// longer available.

/** The type icon for a mention, at the chip's size. */
export function MentionIcon({
  m,
  className,
  avatar,
}: {
  m: Pick<Mentionable, 'kind' | 'contextKind' | 'synonym' | 'label'>
  className?: string
  avatar?: boolean
}) {
  const cls = cn('size-3 shrink-0 text-muted-foreground', className)
  switch (m.kind) {
    case 'domain':
      return <FolderIcon aria-hidden className={cls} />
    case 'metric':
    case 'dimension':
    case 'term':
      return (
        <TypeGlyph d={{ type: m.kind, sameAs: m.synonym ? m.label : undefined }} className={cls} />
      )
    case 'context': {
      const Icon = kindIcons[m.contextKind ?? 'note']
      return <Icon aria-hidden className={cls} />
    }
    case 'market':
      return <GlobeIcon aria-hidden className={cls} />
    case 'person':
      // In a list a face helps; in a line of text the initials would be too small to read.
      return avatar ? (
        <PersonAvatar name={m.label} size={20} />
      ) : (
        <UserRoundIcon aria-hidden className={cls} />
      )
  }
}

// Whole, never broken across lines: the chip sits on the text's baseline and the line wraps around
// it; a title longer than the line ends in an ellipsis inside the chip, the full title on hover.
const chip =
  'mention-chip inline-flex max-w-full items-baseline gap-1 rounded-sm px-1.5 py-px align-baseline text-[0.92em] font-medium whitespace-nowrap [&>svg]:self-center'

/** A mention's tint: the same as its tag chip (metrics, markets, terms and domains tinted; the rest neutral). */
function mentionTone(kind: string, key: string) {
  if (kind === 'metric' || kind === 'dimension' || kind === 'term' || kind === 'market')
    return chipTone(kind)
  if (kind === 'domain') return chipTone('domain', domainHue[key as DomainId])
  return chipTone('neutral')
}

/** The chip's words: cut with an ellipsis when the line is too short for them. */
const Label = ({ children }: { children: React.ReactNode }) => (
  <span className="min-w-0 truncate">{children}</span>
)

/** A domain's or a person's quick view: a small card. */
function CardChip({ target, children }: { target: Mentionable; children: React.ReactElement }) {
  const { kind, key } = parseMentionId(target.id)
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={150}
        nativeButton={false}
        render={children}
      />
      <PopoverContent align="start" className="w-64 gap-1.5">
        {kind === 'domain' ? (
          <>
            <p className="flex items-center gap-1.5 font-medium">
              <FolderIcon className="size-3.5 text-muted-foreground" aria-hidden />
              {domains[key as DomainId].name}
            </p>
            <p className="text-muted-foreground">{domains[key as DomainId].covers}</p>
            <p className="text-xs text-muted-foreground">
              Owned by {domains[key as DomainId].owners.join(' and ')}
            </p>
          </>
        ) : (
          <div className="flex items-center gap-2.5">
            <PersonAvatar name={key} size={32} />
            <div className="min-w-0">
              <p className="truncate font-medium">{key}</p>
              <p className="truncate text-xs text-muted-foreground">{person(key).role}</p>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * One mention. `interactive` is off inside a text box while typing (the box's own caret and
 * keys come first) and on everywhere it is read.
 */
export function MentionChip({
  mention,
  interactive = true,
  className,
}: {
  mention: MentionRef
  interactive?: boolean
  className?: string
}) {
  const target = useMentionTarget(mention.id)
  const label = mention.label || target?.label || ''

  if (!target)
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              tabIndex={interactive ? 0 : undefined}
              className={cn(
                chip,
                'border border-dashed border-muted-foreground/60 bg-transparent font-normal text-muted-foreground',
                className,
              )}
            />
          }
        >
          <CircleSlashIcon aria-hidden className="size-3 shrink-0" />
          <Label>{label}</Label>
          <span className="sr-only">, no longer available</span>
        </TooltipTrigger>
        <TooltipContent>No longer available. These are the author's words.</TooltipContent>
      </Tooltip>
    )

  const body = (
    <>
      <MentionIcon m={target} />
      <Label>{label}</Label>
    </>
  )
  const { kind, key } = parseMentionId(target.id)
  const tone = mentionTone(kind, key)
  if (!interactive || kind === 'market')
    return (
      <span title={label} style={tone.style} className={cn(chip, tone.className, className)}>
        {body}
      </span>
    )

  const open = () => {
    if (kind === 'context') openDock('context', key)
    else if (kind === 'metric' || kind === 'dimension' || kind === 'term') openDock('def', key)
  }
  const button = (
    <span
      role="button"
      tabIndex={0}
      title={label}
      style={tone.style}
      className={cn(
        chip,
        tone.className,
        'cursor-pointer transition-[filter] outline-none hover:brightness-95 focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:brightness-125',
        className,
      )}
      onClick={(e) => {
        e.stopPropagation()
        open()
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        open()
      }}
    >
      {body}
    </span>
  )
  return kind === 'domain' || kind === 'person' ? (
    <CardChip target={target}>{button}</CardChip>
  ) : (
    button
  )
}

/** Stored text with its mentions as chips: for read-only paragraphs, list items and questions. */
export function MentionText({ text, interactive }: { text: string; interactive?: boolean }) {
  const parts = mentionParts(text)
  return (
    <>
      {parts.map((p, i) => {
        if (typeof p === 'string') {
          // Punctuation that follows a chip travels with it (below), so it never starts a line alone.
          const lead = typeof parts[i - 1] === 'object' ? (p.match(/^[.,;:!?)]+/)?.[0] ?? '') : ''
          return <React.Fragment key={i}>{p.slice(lead.length)}</React.Fragment>
        }
        const next = parts[i + 1]
        const punct = typeof next === 'string' ? (next.match(/^[.,;:!?)]+/)?.[0] ?? '') : ''
        const chip = (
          <MentionChip
            mention={p}
            interactive={interactive}
            className={punct ? 'min-w-0' : undefined}
          />
        )
        return punct ? (
          <span key={i} className="inline-flex max-w-full items-baseline whitespace-nowrap">
            {chip}
            {punct}
          </span>
        ) : (
          <React.Fragment key={i}>{chip}</React.Fragment>
        )
      })}
    </>
  )
}

/**
 * Stored context text as the editor wrote it, read-only: paragraphs, lists and quotes, with
 * mentions as chips. `dense` is the quick view's smaller text.
 */
export function ContextText({ text, dense }: { text: string; dense?: boolean }) {
  return text.split('\n\n').map((para, i) =>
    /^(- |\d\. )/.test(para) ? (
      <ul
        key={i}
        className={cn(
          'list-disc marker:text-muted-foreground',
          dense ? 'ml-5 space-y-1' : 'ml-6 space-y-1.5',
        )}
      >
        {para.split('\n').map((li, j) => (
          <li key={j}>
            <MentionText text={li.replace(/^(- |\d\. )/, '')} />
          </li>
        ))}
      </ul>
    ) : para.startsWith('> ') ? (
      <blockquote
        key={i}
        className={cn('border-l-2 text-muted-foreground', dense ? 'pl-3' : 'pl-4')}
      >
        <MentionText text={para.replace(/^> ?/gm, '')} />
      </blockquote>
    ) : (
      <p key={i}>
        <MentionText text={para} />
      </p>
    ),
  )
}

/**
 * "Mentioned in": the context items and terms that link here, as a plain list (not a graph).
 * Nothing when nothing does. Links never change what agents get.
 */
