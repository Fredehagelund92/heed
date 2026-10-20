import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { limits } from '@domain/proposal-rules'
import {
  BotIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FilePenIcon,
  FileTextIcon,
  GlobeIcon,
  LoaderCircleIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
  UserRoundIcon,
  type Icon,
} from '@/components/icons'
import { ChangeCard, wroteMark } from '@/components/change/change-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { CardField, DraftCard, DraftProposal, FieldSource } from '@/lib/assistant'
import { formatDay } from '@/lib/library'
import { safeHref } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import './answer-motion.css'

/*
  A draft the assistant wrote, as the person confirms it (FR-706, FR-707): every field it filled,
  read only, each with where it came from (the person's words, a page it read, its own
  suggestion), then Not now or Create draft. Nothing is opened or saved before the person says
  so, and what they see is the call the service signed, so what is saved is what is shown. Once
  saved, the card says so and opens the draft in the form, to check every field and submit it.
*/

/** A field's name as the person reads it. */
const fieldNames: Record<CardField, string> = {
  kind: 'Kind',
  title: 'Title',
  summary: 'What happened',
  scope: 'Where it applies',
  validity: 'When',
  evidence: 'Where it comes from',
  areaId: 'Domain',
  body: 'Detail',
  notToConclude: 'What not to conclude',
  reviewDate: 'Check again by',
}

/** Each source's mark: its words, what they mean, its glyph and its form (contract 6.13). */
function sourceLook(source: FieldSource): {
  label: string
  meaning: string
  icon: Icon
  form: 'outline' | 'bare'
} {
  switch (source.kind) {
    case 'person':
      return {
        label: 'Your words',
        meaning: 'From what you wrote.',
        icon: UserRoundIcon,
        form: 'bare',
      }
    case 'page':
      return {
        label: `From ${source.site}`,
        meaning: `Taken from ${source.site}, which the assistant read just now.`,
        icon: GlobeIcon,
        form: 'outline',
      }
    case 'suggested':
      // Quiet like Your words: the line beside the field is what asks for the look (6.13).
      return {
        label: 'Assistant wrote',
        meaning: 'Written by the assistant. Check it.',
        icon: BotIcon,
        form: 'bare',
      }
    case 'item':
      return {
        label: 'From a fact',
        meaning: 'Taken from a fact in the library.',
        icon: FileTextIcon,
        form: 'outline',
      }
    case 'gap':
      return {
        label: 'From a gap',
        meaning: 'Taken from a question AI apps asked that nothing answered.',
        icon: DatabaseIcon,
        form: 'bare',
      }
    case 'default':
      return {
        label: 'Default',
        meaning: 'The usual setting. The owner can change it.',
        icon: SlidersHorizontalIcon,
        form: 'bare',
      }
  }
}

/** The assistant wrote the value: anything but the person's own words. */
const wroteBy = (source: FieldSource | undefined) =>
  source !== undefined && source.kind !== 'person'

/** Where one field came from, beside its name. */
export function SourceMark({ source }: { source: FieldSource }) {
  const look = sourceLook(source)
  return (
    <Badge
      size="sm"
      form={look.form}
      tone="neutral"
      quiet={look.form === 'bare'}
      icon={look.icon}
      data-slot="ask-draft-source"
      data-source={source.kind}
      title={look.meaning}
      className="min-w-0"
    >
      <span className="truncate">{look.label}</span>
      <span className="sr-only">: {look.meaning}</span>
    </Badge>
  )
}

/** One field: its name and where it came from, then its value; "Not given" when empty. */
function Field({
  field,
  card,
  children,
}: {
  field: CardField
  card: DraftCard
  children: ReactNode
}) {
  const source = card.sources[field]
  const wrote = Boolean(children) && wroteBy(source)
  return (
    <div
      data-slot="ask-draft-field"
      data-field={field}
      data-wrote={wrote || undefined}
      className={cn('flex min-w-0 flex-col gap-1', wrote && wroteMark)}
    >
      <dt className="flex min-w-0 items-center justify-between gap-2 text-caption text-muted-foreground">
        {fieldNames[field]}
        {source && children ? <SourceMark source={source} /> : null}
      </dt>
      <dd className="min-w-0 text-dense break-words">
        {children ?? <span className="text-muted-foreground">Not given</span>}
      </dd>
    </div>
  )
}

/** "212 of 280 characters": a summary agents read first is short (FR-118). */
function SummaryCount({ summary }: { summary: string }) {
  const length = [...summary].length
  const over = length > limits.summary
  return (
    <p
      data-slot="ask-draft-count"
      data-over={over || undefined}
      className={cn(
        'flex items-center gap-1 text-caption tabular-nums',
        over ? 'text-status-warning-fg' : 'text-muted-foreground',
      )}
    >
      {over ? <TriangleAlertIcon aria-hidden="true" className="size-icon-sm shrink-0" /> : null}
      {length.toLocaleString('en')} of {limits.summary} characters
      {over ? ': shorten it before you send it' : ''}
    </p>
  )
}

/** From and to, as the last day it applies, and a mark when the person was unsure of them. */
function Dates({ dates }: { dates: NonNullable<DraftCard['dates']> }) {
  const from = dates.from ? formatDay(dates.from) : 'a day not given'
  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <span>
          {dates.to ? `${from} to ${formatDay(dates.to)}` : `From ${from}, still going on`}
        </span>
        {dates.uncertain ? (
          <Badge
            size="sm"
            tone="warning"
            icon={CircleHelpIcon}
            data-slot="ask-draft-uncertain"
            title="You weren’t sure of the date"
          >
            Uncertain
          </Badge>
        ) : null}
      </span>
      {dates.uncertain ? (
        <span className="text-caption text-muted-foreground">
          You weren’t sure of the date, so it’s marked for the owner. Change it in the draft if you
          find the day.
        </span>
      ) : null}
    </span>
  )
}

/** The evidence: the link, the one sentence taken from it and the day it was read. */
function Evidence({ evidence }: { evidence: DraftCard['evidence'] }) {
  return (
    <ul className="flex flex-col gap-2">
      {evidence.map((entry) => {
        // The address comes from the model's call before the service has saved anything: only a
        // web address becomes a link, anything else stays the words.
        const href = safeHref(entry.url)
        return (
          <li key={`${entry.url}\n${entry.quote}`} className="flex min-w-0 flex-col gap-1">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="flex w-fit max-w-full min-w-0 items-center gap-1 underline underline-offset-4 hover:no-underline"
              >
                <span className="truncate">{entry.site}</span>
                <ExternalLinkIcon aria-hidden="true" className="size-icon-sm shrink-0" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <span data-slot="ask-draft-address" className="break-all">
                {entry.url}
              </span>
            )}
            {entry.quote ? (
              <q
                data-slot="ask-draft-quote"
                className="border-l-2 pl-3 text-muted-foreground before:content-none after:content-none"
              >
                {entry.quote}
              </q>
            ) : null}
            {entry.readOn ? (
              <span className="text-caption text-muted-foreground">
                Read {formatDay(entry.readOn)}
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The draft's fields, read only. What happened, where, when, where it comes from and the domain
 * show at once; the detail, what not to conclude and the review day fold under More.
 */
function DraftFields({ card }: { card: DraftCard }) {
  const more = card.body || card.notToConclude || card.reviewDate
  return (
    <div data-slot="ask-draft-fields" className="flex flex-col gap-3">
      <dl className="flex flex-col gap-3">
        <Field field="summary" card={card}>
          {card.summary ? (
            <span className="flex flex-col gap-1">
              <span>{card.summary}</span>
              <SummaryCount summary={card.summary} />
            </span>
          ) : null}
        </Field>
        <Field field="scope" card={card}>
          {card.where.length ? (
            <span className="flex flex-wrap gap-1">
              {card.where.map((name) => (
                <Badge key={name} size="sm" form="outline" className="min-w-0">
                  <span className="truncate">{name}</span>
                </Badge>
              ))}
            </span>
          ) : null}
        </Field>
        <Field field="validity" card={card}>
          {card.dates ? <Dates dates={card.dates} /> : null}
        </Field>
        <Field field="evidence" card={card}>
          {card.evidence.length ? <Evidence evidence={card.evidence} /> : null}
        </Field>
        <Field field="areaId" card={card}>
          {card.domain}
        </Field>
      </dl>
      {more ? (
        <details data-slot="ask-draft-more" className="group/more flex flex-col gap-3">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-caption text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon
              aria-hidden="true"
              className="size-icon-sm shrink-0 transition-transform group-open/more:rotate-90 motion-reduce:transition-none"
            />
            More:{' '}
            {[
              card.body && 'detail',
              card.notToConclude && 'what not to conclude',
              card.reviewDate && 'when to check it again',
            ]
              .filter(Boolean)
              .join(', ')}
          </summary>
          <dl className="flex flex-col gap-3 pt-3">
            {card.body ? (
              <Field field="body" card={card}>
                <span className="whitespace-pre-line">{card.body}</span>
              </Field>
            ) : null}
            {card.notToConclude ? (
              <Field field="notToConclude" card={card}>
                {card.notToConclude}
              </Field>
            ) : null}
            {card.reviewDate ? (
              <Field field="reviewDate" card={card}>
                {formatDay(card.reviewDate)}
              </Field>
            ) : null}
          </dl>
        </details>
      ) : null}
    </div>
  )
}

/** The way to a saved draft: the form, to check every field and submit it. */
export function OpenDraftLink({
  saved,
  onLeave,
}: {
  saved: NonNullable<DraftProposal['saved']>
  onLeave?: (() => void) | undefined
}) {
  const words = `Open draft #${saved.number}`
  return (
    <Button
      className="w-fit"
      render={
        saved.itemId ? (
          <Link
            to="/library/$itemId/suggest"
            params={{ itemId: saved.itemId }}
            search={{ draft: saved.id }}
            onClick={onLeave}
          />
        ) : (
          <Link to="/library/new" search={{ draft: saved.id }} onClick={onLeave} />
        )
      }
    >
      <FilePenIcon />
      {words}
    </Button>
  )
}

/** The note on evidence from a web page read just now: an external source, unreviewed. */
function WebNote({ sites }: { sites: string[] }) {
  if (!sites.length) return null
  return (
    <p data-slot="ask-draft-web" className="flex items-start gap-2 text-caption">
      <GlobeIcon aria-hidden="true" className="size-icon-sm shrink-0 translate-y-px" />
      <span>
        It comes from {sites.join(' and ')}, which the assistant read just now. The owner of its
        domain checks it before AI apps get it.
      </span>
    </p>
  )
}

/** The fields the card shows at once, in its order, for what was written and what was left. */
const shownFields = ['summary', 'scope', 'validity', 'evidence', 'areaId'] as const

/** A field's value on the card, or null when the draft leaves it empty. */
function filled(card: DraftCard, field: (typeof shownFields)[number]): boolean {
  switch (field) {
    case 'summary':
      return Boolean(card.summary)
    case 'scope':
      return card.where.length > 0
    case 'validity':
      return card.dates !== null
    case 'evidence':
      return card.evidence.length > 0
    case 'areaId':
      return Boolean(card.domain)
  }
}

const lowerName = (field: CardField) => fieldNames[field].toLowerCase()

/** "what happened and where it applies". */
const listed = (fields: readonly CardField[]) => {
  const names = fields.map(lowerName)
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]!
}

/**
 * What the draft took from the person, what the assistant filled in and what it left for them,
 * from each field's source (FR-707): the same facts the marks beside the fields give.
 */
function WrittenNote({ card }: { card: DraftCard }) {
  // A field the call gave no source for is neither: the card never guesses who wrote it.
  const yours = shownFields.filter((f) => filled(card, f) && card.sources[f]?.kind === 'person')
  const wrote = shownFields.filter((f) => filled(card, f) && wroteBy(card.sources[f]))
  const left = shownFields.filter((f) => !filled(card, f))
  const parts = [
    yours.length ? `From your words: ${listed(yours)}.` : null,
    wrote.length ? `The assistant filled in ${listed(wrote)}.` : null,
    left.length ? `Left for you: ${listed(left)}.` : null,
  ].filter(Boolean)
  return parts.length ? <p data-slot="ask-draft-written">{parts.join(' ')}</p> : null
}

/** Where the draft stands, beside the decision. */
function DraftStatus({ draft }: { draft: DraftProposal }) {
  switch (draft.state) {
    case 'saving':
      return (
        <>
          <LoaderCircleIcon
            aria-hidden="true"
            className="size-icon-sm shrink-0 motion-safe:animate-spin"
          />
          Saving the draft
        </>
      )
    case 'saved':
      return draft.saved ? (
        <span className="animate-settle flex items-center gap-2">
          <CircleCheckIcon aria-hidden="true" className="size-icon-sm shrink-0" />
          Saved as your draft #{draft.saved.number}
        </span>
      ) : null
    case 'failed':
      return (
        <>
          <TriangleAlertIcon
            aria-hidden="true"
            className="size-icon-sm shrink-0 text-status-warning-icon"
          />
          The draft wasn’t saved
        </>
      )
    case 'asking':
      return null
  }
}

/**
 * The draft card, a change card about the item the draft would be (contract 9.8): asking (the
 * fields, what the assistant wrote and what it left, then Not now or Create draft), saving, saved
 * (folded, with the way to the draft) or not saved.
 */
export function DraftConfirm({
  draft,
  onApprove,
  onLeave,
}: {
  draft: DraftProposal
  onApprove: (approvalId: string, approved: boolean) => void
  onLeave?: (() => void) | undefined
}) {
  const { card, state } = draft
  const meta = [
    card.itemId ? 'A change to a fact' : 'New fact',
    state === 'saved' ? 'only you can see it' : state === 'failed' ? 'not saved' : 'not saved yet',
  ].join(' · ')
  const asking = state === 'asking' && draft.approvalId
  return (
    <ChangeCard
      data-slot="ask-confirm-draft"
      data-state={state}
      label={card.itemId ? 'Draft change' : 'New draft'}
      kind={card.kind}
      title={card.title}
      badges={
        <Badge tone="warning" icon={FilePenIcon}>
          Draft
        </Badge>
      }
      meta={<span>{meta}</span>}
      marked={
        state !== 'saved' && shownFields.some((f) => filled(card, f) && wroteBy(card.sources[f]))
          ? 'assistant'
          : undefined
      }
      note={
        state === 'saved' ? (
          'Open it, check each part, then send it for review. The owner of its domain checks it before AI apps get it.'
        ) : state === 'failed' ? (
          'Nothing is saved. The answer says why. Ask again, or write it yourself in Add context.'
        ) : (
          <div className="flex flex-col gap-1">
            <WrittenNote card={card} />
            <p>Create it to save it as your draft. Then check each part and send it for review.</p>
          </div>
        )
      }
      status={<DraftStatus draft={draft} />}
      actions={
        asking ? (
          <>
            <Button variant="ghost" onClick={() => onApprove(draft.approvalId!, false)}>
              Not now
            </Button>
            <Button onClick={() => onApprove(draft.approvalId!, true)}>Create draft</Button>
          </>
        ) : state === 'saved' && draft.saved ? (
          <OpenDraftLink saved={draft.saved} onLeave={onLeave} />
        ) : null
      }
    >
      {state === 'saved' ? (
        <details data-slot="ask-draft-saved-fields" className="group/saved flex flex-col">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-caption text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon
              aria-hidden="true"
              className="size-icon-sm shrink-0 transition-transform group-open/saved:rotate-90 motion-reduce:transition-none"
            />
            What was saved
          </summary>
          <div className="pt-3">
            <DraftFields card={card} />
          </div>
        </details>
      ) : (
        <DraftFields card={card} />
      )}
      <WebNote sites={draft.webSites} />
    </ChangeCard>
  )
}
