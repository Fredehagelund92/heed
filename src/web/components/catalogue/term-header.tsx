import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { CatalogueTermDetail } from '@/api'
import { ChevronDownIcon, DatabaseIcon, Link2OffIcon } from '@/components/icons'
import { StateNote } from '@/components/item/item-header'
import { PageDocumentHeader } from '@/components/page/page'
import { Badge, badgeVariants } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { catalogueStatusAsks, type DomainInfo } from '@/lib/catalogue'
import { termTool, type ReadChip as ReadChipModel, type TermNote } from '@/lib/term-page'
import { cn } from '@/lib/utils'
import {
  CatalogueStatusBadge,
  TermDomainBadge,
  termKindGlyphs,
  termKindNames,
} from './catalogue-marks'

/**
 * The read chip: when Heed last read the definition, as the badge that ends the row (the item
 * page's validity chip). Outline, and soft amber only while the newest read of the source failed,
 * because the copy is then older than it should be (CON-213). Only a trigger, so it sits inside a
 * `Collapsible` with its detail line.
 */
function ReadChip({ chip }: { chip: ReadChipModel }) {
  return (
    <CollapsibleTrigger
      data-slot="read-chip"
      data-tone={chip.failing ? 'warning' : 'neutral'}
      className={cn(
        badgeVariants({ form: chip.failing ? 'soft' : 'outline' }),
        'group/chip cursor-pointer focus-visible:outline-2 focus-visible:outline-ring',
        !chip.failing && 'hover:bg-accent',
      )}
    >
      <DatabaseIcon aria-hidden="true" />
      <span data-slot="badge-label" className="min-w-0 truncate">
        {chip.label}
      </span>
      <ChevronDownIcon
        aria-hidden="true"
        className="size-3 stroke-icon-sm transition-transform group-data-panel-open/chip:rotate-180"
      />
    </CollapsibleTrigger>
  )
}

/** The note line's words: a sentence, or the one issue linked by its title. */
function NoteText({ note }: { note: TermNote }) {
  if (note.kind !== 'issue') return note.text
  return (
    <>
      {note.lead}
      {note.issue ? (
        <>
          <Link
            to="/library/$itemId"
            params={{ itemId: note.issue.id }}
            className="font-bold underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
            {note.issue.title}
          </Link>{' '}
        </>
      ) : null}
      {note.tail}
    </>
  )
}

/**
 * The term's badges: one row (the type, the domain, the status while it asks for a look) that
 * ends in the read chip, which opens the read's detail line under it.
 */
export function TermBadges({
  term,
  domain,
  chip,
}: {
  term: CatalogueTermDetail
  domain: DomainInfo
  chip: ReadChipModel | null
}) {
  return (
    <Collapsible className="flex flex-col gap-3">
      <div data-slot="term-badges" className="flex flex-wrap items-center gap-2">
        <Badge
          form="outline"
          icon={termKindGlyphs[term.kind]}
          data-slot="term-kind"
          data-kind={term.kind}
        >
          {termKindNames[term.kind]}
        </Badge>
        <TermDomainBadge name={domain.name} label={domain.label} none={domain.none} />
        {catalogueStatusAsks(term.status) ? (
          <CatalogueStatusBadge
            status={term.status}
            activeIssues={term.shelf.activeIssues}
            tool={termTool(term)}
          />
        ) : null}
        <span aria-hidden="true" className="hidden px-1 @md:block">
          <span className="block h-4 w-px bg-border" />
        </span>
        {chip ? (
          <ReadChip chip={chip} />
        ) : (
          <Badge form="bare" quiet icon={Link2OffIcon} data-slot="read-chip">
            Not linked to a definition
          </Badge>
        )}
      </div>
      {chip ? (
        <CollapsibleContent
          data-slot="read-detail"
          className="flex max-w-prose flex-col gap-1 rounded-md bg-muted px-3 py-2 text-dense"
        >
          <p className="font-bold break-words">{chip.title}</p>
          <p className="text-muted-foreground">{chip.line}</p>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  )
}

/** The labelled copy of the source's description, or why there is none. */
export function TermDescription({
  term,
  className,
}: {
  term: CatalogueTermDetail
  className?: string
}) {
  const description = term.definition?.descriptionCopy ?? null
  return (
    <p
      data-slot="term-description"
      className={cn('max-w-prose', description === null && 'text-muted-foreground', className)}
    >
      {description ??
        (term.definition
          ? `No description in ${termTool(term)}.`
          : 'No description: it names no definition.')}
    </p>
  )
}

/** The one note line, only while something asks for a look. */
export function TermNoteLine({ note }: { note: TermNote }) {
  return (
    <StateNote>
      <NoteText note={note} />
    </StateNote>
  )
}

/**
 * The term page header (the item page's note line, contract 5): on the page background, one row
 * of badges (the type, the domain, the status while it asks for a look) that ends in the read
 * chip, the name with the one action group beside it from a 1,024 pixel page, the labelled copy
 * of the source's description, and, only while something asks for a look, one note line. No
 * coloured band. The tabs start below it, so the state shows on every tab.
 */
export function TermHeader({
  term,
  domain,
  chip,
  note,
  actions,
}: {
  term: CatalogueTermDetail
  domain: DomainInfo
  chip: ReadChipModel | null
  note: TermNote | null
  actions: ReactNode
}) {
  return (
    <PageDocumentHeader data-slot="term-header">
      <TermBadges term={term} domain={domain} chip={chip} />
      <div className="flex flex-col gap-3 @5xl:flex-row @5xl:items-start @5xl:justify-between @5xl:gap-8">
        <div className="flex max-w-reading min-w-0 flex-col gap-3">
          <h1 className="text-display font-bold tracking-display">{term.name}</h1>
          <TermDescription term={term} className="text-large" />
        </div>
        {actions}
      </div>
      {note ? <TermNoteLine note={note} /> : null}
    </PageDocumentHeader>
  )
}
