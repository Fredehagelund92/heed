import * as React from 'react'
import {
  ArchiveIcon,
  ArrowLeftIcon,
  AtSignIcon,
  BanIcon,
  MessageSquareTextIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ClockIcon,
  FlagIcon,
  GitPullRequestArrowIcon,
  InboxIcon,
  MailOpenIcon,
  MessageSquareIcon,
  PencilIcon,
  SearchIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import { toast } from 'sonner'
import { cn, midSentence } from '@/lib/utils'
import { DomainBadge, FieldDiff } from '@/components/heed/bits'
import { ToolLogo } from '@/components/heed/tool-logo'
import { connectorById } from '@/model/integrations'
import { careLine, countWord, type Review } from '@/model/review'
import { QuickReview, Sender } from '@/pages/review'
import { TOUCH } from '@/lib/touch'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { TextSwitch } from '@/components/heed/switches'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { scopeText } from '@/model/ask'
import { cardTypeLabel, type CardType, type InboxCard, type Waiting } from '@/model/inbox'
import type { DomainId, Fact } from '@/model/items'
import { useIsMobile } from '@/hooks/use-mobile'
import { openDock, useDock } from '@/lib/dock'
import { open } from '@/lib/events'
import { navigate, setQuery, useRoute } from '@/lib/router'
import { useQuery } from '@tanstack/react-query'
import {
  inboxPageQuery,
  readQuestionQuery,
  useInbox,
  useReviews,
  useSavedQuestions,
  useSession,
  useWorkspace,
  useWrite,
} from '@/api/queries'
import { setupSteps } from '@/lib/setup'
import { useDomains, useFacts, useMe } from '@/lib/workspace'
import type { Outcome } from '@/model/inbox'
import { useCommentActions, useNewReply, type MentionNote } from '@/lib/comments'
import {
  groupOf,
  INBOX_GROUPS,
  needs,
  rowId,
  rowTitle,
  useInboxRows,
  type InboxRow,
} from '@/lib/inbox-rows'
import { suggestionIcon } from '@/components/heed/change-icons'
import type { Subject } from '@/model/comments'
import { TruncatedText } from '@/components/heed/truncated'
import { plainText } from '@/lib/mentions'
import { DEFINITIONS_TOOL } from '@/model/integrations'
import { ListSkeleton, Loadable } from '@/components/heed/load-state'
import { BulkBar, BulkButton } from '@/components/heed/bulk-bar'
import { useOnline } from '@/lib/send'
import { Checkbox } from '@/components/ui/checkbox'
import { useSelection, type RowSelection } from '@/hooks/use-selection'
import { pageKey } from '@/lib/keys'
import { ResultIcon } from '@/components/obs/result'
import { arriveRef, leaveThen, useLeavingRows } from '@/lib/presence'

// The Inbox, built like shadcn's Mail example (a list with All and Needs me and a search field, and
// a detail pane with the selected card's one primary action) and dressed as Efferd's dashboard 2:
// a frame of flat cells divided by hairlines. A suggestion's review opens in the dock, which takes
// the detail pane's place, so there is one right panel.

/** Efferd's dashboard card: a shadcn Card made flat, so the frame's hairlines are its only edges. */
function Cell({ className, ...props }: React.ComponentProps<typeof Card>) {
  return (
    <Card className={cn('rounded-none bg-background shadow-none ring-0', className)} {...props} />
  )
}

const typeIcon: Record<CardType, typeof FlagIcon> = {
  suggestion: GitPullRequestArrowIcon,
  gap: CircleDashedIcon,
  flag: FlagIcon,
  check: CalendarClockIcon,
  look: TriangleAlertIcon,
}

/* ---------- the list ---------- */

/** How big a suggestion is, from its review: "2 wording, 1 link - 12 questions". */
function evidence(r: Review | undefined) {
  if (!r) return ''
  const size =
    r.mode === 'new'
      ? 'New item'
      : r.mode === 'retire'
        ? 'Archives an item'
        : r.counts.map((c) => `${c.n} ${countWord(c.kind, c.n)}`).join(', ')
  const care = careLine(r)
  return [care, size, `${r.tryIt.reach} ${r.tryIt.reach === 1 ? 'question' : 'questions'}`]
    .filter(Boolean)
    .join(' - ')
}

/** The row's second line: who it is from and what it is worth, so the list can be read without opening. */
function meta(row: InboxRow, reviews: Review[]) {
  if (row.kind === 'mention') return `Mentioned by ${row.note.from}`
  if (row.kind === 'waiting') return `Waiting for ${row.item.waitingFor.split(',')[0]}`
  const { card, done } = row
  if (done) return `${done.label}, ${midSentence(done.at)}`
  const s = card.suggestion
  const from = card.source
    ? `${card.source.tool}, ${card.source.folder}`
    : s
      ? s.agent
        ? `An agent, with ${s.from}'s OK`
        : s.from
      : ''
  if (s || card.source)
    return [from, evidence(reviews.find((r) => r.id === card.id))].filter(Boolean).join(' - ')
  if (card.gap)
    return `Asked ${card.gap.times} times this week, found nothing${card.gap.acrossMonths ? ', across a month edge' : ''}`
  if (card.flag) return `Reported as ${card.flag.reason}: “${card.flag.note}”`
  if (card.look) return 'Raised by an alert: saved questions answer worse'
  return card.line.startsWith(DEFINITIONS_TOOL) ? 'A definition changed' : 'Its check date passed'
}

/** The row's second line; a mention of you, or a reply in a suggestion's comments, takes its place, quietly. */
function RowMeta({ row }: { row: InboxRow }) {
  const reply = useNewReply(`review:${rowId(row)}`)
  const reviews = useReviews()
  if (row.note)
    return (
      <span className="line-clamp-1 flex items-center gap-1.5 text-xs text-foreground/80">
        <AtSignIcon className="size-3 shrink-0" aria-hidden />
        Mentioned by {row.note.from}
      </span>
    )
  if (reply && row.kind === 'card' && !row.done)
    return (
      <span className="line-clamp-1 flex items-center gap-1.5 text-xs text-foreground/80">
        <MessageSquareTextIcon className="size-3 shrink-0" aria-hidden />
        New reply from {reply.from}
      </span>
    )
  return <span className="line-clamp-1 text-xs text-muted-foreground">{meta(row, reviews)}</span>
}

/** In the quick view: who answered, and what, with the way to the thread. */
function NewReply({ id }: { id: string }) {
  const reply = useNewReply(`review:${id}`)
  if (!reply) return null
  return (
    <div className="mb-5 flex flex-col gap-1.5 border-l-2 border-primary/60 py-0.5 pl-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <MessageSquareTextIcon className="size-3.5" aria-hidden />
        New reply from {reply.from}, {midSentence(reply.when)}
      </p>
      <p className="line-clamp-3 text-muted-foreground">{reply.excerpt}</p>
      <a
        href={`/inbox/${id}/review`}
        className="w-fit text-primary underline-offset-4 hover:underline"
      >
        Read the comments
      </a>
    </div>
  )
}

function InboxList({
  rows,
  selected,
  onSelect,
  sel,
  list,
}: {
  rows: InboxRow[]
  selected?: string
  onSelect: (id: string) => void
  sel: RowSelection
  list: React.RefObject<HTMLUListElement | null>
}) {
  const { opened } = useInbox()
  const reviews = useReviews()
  const leaving = useLeavingRows()
  // Rows added after the list first shows open in; the first ones are simply there.
  React.useEffect(() => arriveRef(list.current), [list])
  // The selected row stays in sight: on a click, on J and K, and on a link straight to a card.
  React.useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-row="${CSS.escape(selected ?? '')}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [list, selected])
  return (
    <ul
      ref={list}
      className="flex flex-col divide-y divide-border border-b"
      onKeyDown={sel.onKeyDown}
    >
      {rows.map((row, i) => {
        const id = rowId(row)
        const review =
          row.kind === 'card' && row.card.type === 'suggestion'
            ? reviews.find((r) => r.id === row.card.id)
            : undefined
        const Icon = review
          ? suggestionIcon(review)
          : row.kind === 'card'
            ? typeIcon[row.card.type]
            : row.kind === 'mention' || row.note
              ? AtSignIcon
              : ClockIcon
        // A suggestion that needs care says so on its row, before it is opened.
        const care = review && row.kind === 'card' && !row.done ? careLine(review) : undefined
        const group = groupOf(row)
        const firstOfGroup = i === 0 || groupOf(rows[i - 1]!) !== group
        const inGroup = rows.filter((r) => groupOf(r) === group).length
        const source = row.kind === 'card' ? row.card.source : undefined
        const prev = rows[i - 1]
        // Suggestions from one sync read sit under one header: "From Google Drive, today 06:00".
        const firstOfRead =
          source && !(prev?.kind === 'card' && prev.card.source?.read === source.read)
        const fromRead = source
          ? rows.filter((r) => r.kind === 'card' && r.card.source?.read === source.read).length
          : 0
        const done = row.kind === 'card' && !!row.done && !row.note
        // The dot is "not opened yet": it goes once the card was opened here or in the review.
        const unread = row.note ? true : row.kind === 'card' && !row.done && !opened[row.card.id]
        const isSelected = selected === id
        const ticked = sel.isSelected(id)
        return (
          <React.Fragment key={id}>
            {firstOfGroup && (
              <li className="flex h-8 items-end gap-1.5 px-4 pb-1.5 text-xs font-medium text-muted-foreground @md:px-6">
                {INBOX_GROUPS.find((g) => g.id === group)!.label}
                <span className="font-normal tabular-nums">{inGroup}</span>
              </li>
            )}
            {firstOfRead && (
              <li className="flex h-10 items-center gap-2 bg-band px-4 text-xs @md:px-6">
                <ToolLogo c={connectorById('google-drive')!} size="sm" />
                <span className="truncate font-medium">
                  From {source.tool}, {midSentence(source.read)}
                </span>
                <span className="shrink-0 text-muted-foreground @max-md:hidden">
                  {fromRead} new {fromRead === 1 ? 'suggestion' : 'suggestions'}
                </span>
                <a
                  href="/settings/integrations/google-drive?state=suggestions"
                  className="ml-auto shrink-0 whitespace-nowrap text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  About this read
                </a>
              </li>
            )}
            <li
              data-row={id}
              data-leaving={leaving.has(id) || undefined}
              onMouseDown={sel.onMouseDown}
              className={cn(
                'group/row row-presence hover:bg-muted/50 has-[[data-row-open]:active]:bg-muted has-[[data-row-open]:focus-visible]:bg-muted/50 has-[[data-row-open]:focus-visible]:ring-3 has-[[data-row-open]:focus-visible]:ring-ring/50 has-[[data-row-open]:focus-visible]:ring-inset',
                ticked &&
                  'bg-primary/[0.06] hover:bg-primary/10 dark:bg-primary/12 dark:hover:bg-primary/16',
                isSelected && 'bg-muted hover:bg-muted',
              )}
            >
              <div className="flex">
                {/* On a wide list each row has a checkbox, as in Context: shown on a hover, and on every row while rows are ticked. */}
                <span className="hidden shrink-0 items-center pr-1 pl-5 @md:flex">
                  <Checkbox
                    aria-label={`Select ${rowTitle(row)}`}
                    {...sel.checkbox(id)}
                    className={cn(
                      'transition-opacity group-hover/row:opacity-100',
                      !sel.count && !ticked && 'opacity-0 focus-visible:opacity-100',
                    )}
                  />
                </span>
                <button
                  type="button"
                  data-row-open={id}
                  aria-current={isSelected || undefined}
                  onClick={(e) => sel.rowClick(id, e) || onSelect(id)}
                  className="flex h-16 min-w-0 flex-1 items-center gap-3 px-4 text-left outline-none @md:pr-6 @md:pl-0"
                >
                  <span
                    aria-hidden={!care}
                    className={cn(
                      'flex size-10 shrink-0 items-center justify-center [&_svg]:size-4',
                      done && 'text-muted-foreground',
                    )}
                  >
                    {care ? (
                      <TriangleAlertIcon aria-label={care} className="text-caution-icon" />
                    ) : source ? (
                      <ToolLogo c={connectorById('google-drive')!} size="sm" />
                    ) : (
                      <Icon />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <TruncatedText
                      text={rowTitle(row)}
                      className={cn(
                        'text-sm leading-snug',
                        done ? 'text-muted-foreground' : 'text-foreground',
                      )}
                    />
                    <RowMeta row={row} />
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1.5 self-center">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {row.note
                        ? row.note.when.replace(/^Today, /, '')
                        : row.kind === 'card'
                          ? row.done
                            ? ''
                            : row.card.when
                          : row.kind === 'waiting'
                            ? row.item.sent
                            : ''}
                    </span>
                    {unread ? (
                      <span
                        className="size-1.5 rounded-full bg-primary"
                        aria-label="Not opened yet"
                      />
                    ) : (
                      <span className="size-1.5" />
                    )}
                  </span>
                </button>
              </div>
            </li>
          </React.Fragment>
        )
      })}
    </ul>
  )
}

/* ---------- the detail pane ---------- */

/** An icon button whose tooltip names it, and its key when it has one. */
function IconAction({
  label,
  icon: Icon,
  onClick,
  disabled,
  shortcut,
}: {
  label: string
  icon: typeof FlagIcon
  onClick: () => void
  disabled?: boolean
  shortcut?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="outline" size="icon-sm" disabled={disabled} onClick={onClick} />}
      >
        <Icon />
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && <Kbd className="ml-1">{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * A card's actions. What changes context goes through the send state: offline it waits, and with
 * ?state=failed the first try fails and says so, with Try again. Opening the review just navigates.
 */
function useActions(card: InboxCard) {
  const me = useMe()
  const online = useOnline()
  const decide = React.useContext(Decide)
  const run = (d: Decision) => decide(card, d)
  const primary = () => {
    switch (card.type) {
      case 'suggestion':
        return navigate(`/inbox/${card.id}/review`)
      case 'gap':
        // A draft waits: the same review as any suggestion. With none yet, the editor opens on the scope.
        return card.gap?.draft
          ? navigate(`/inbox/${card.id}/review`)
          : navigate('/context/new', { metric: card.gap?.scope[0], market: card.gap?.scope[1] })
      case 'flag':
        // A report that names no context item has one thing to decide.
        return card.factId ? openDock('context', card.factId, { flag: card.id }) : notAProblem()
      case 'look':
        return navigate(`/observability/quality?domain=${card.domain}`)
      case 'check':
        return run({
          outcome: 'Checked',
          message: 'Checked: still true',
          description: 'The next check is due on 20 Jan 2027.',
          patch: {
            status: 'Live',
            outOfDate: undefined,
            checkedBy: me.name,
            checkedOn: '22 Oct 2026',
          },
        })
    }
  }
  function notAProblem() {
    run({
      outcome: 'Not a problem',
      message: 'Report closed',
      description: 'The context item stays as it is.',
    })
  }
  const secondary: Record<string, () => void> = {
    'Not something we write down': () =>
      run({
        outcome: 'Closed',
        message: 'Closed',
        description: 'Agents keep saying honestly that nothing is written down.',
      }),
    'Not a problem': notAProblem,
    Edit: () => navigate(`/context/${card.factId}/edit`),
    Archive: () =>
      run({
        outcome: 'Archived',
        message: 'Archived',
        description: 'Agents stop getting it from the next question.',
        patch: { status: 'Archived' },
      }),
  }
  // Only what writes needs the connection; Review and Edit only open a page.
  const writes = card.type === 'check' || (card.type === 'flag' && !card.factId)
  return { primary, secondary, online, writes }
}

/** A decision on a card: what it is called, what the toast says, and what it changes on the item. */
type Decision = { outcome: string; message: string; description?: string; patch?: Partial<Fact> }
const Decide = React.createContext<(card: InboxCard, d: Decision) => void>(() => {})

const secondaryIcon: Record<string, typeof FlagIcon> = {
  'Not something we write down': BanIcon,
  'Not a problem': BanIcon,
  Edit: PencilIcon,
  Archive: ArchiveIcon,
}

function from(card: InboxCard) {
  if (card.source)
    return `From ${card.source.tool}, ${card.source.folder}: created by a read, not by a person.`
  const s = card.suggestion
  if (s)
    return s.agent
      ? `From an agent, sent with ${s.from}'s OK.`
      : `From ${s.from}, ${s.via === 'editor' ? 'written in the editor' : `from ${s.via}`}.`
  if (card.flag)
    return card.flag.by
      ? `By ${card.flag.by}, from ${card.flag.via === 'Ask' ? 'Ask' : 'a chat with an agent'}. Only what was sent is kept: the words and the question.`
      : 'From a chat with an agent. Only the words that were sent are kept, not who sent them.'
  if (card.look) return 'From an alert, after the check that runs after every change.'
  return 'From an automatic check.'
}

function Toolbar({
  children,
  onStep,
  onBack,
}: {
  children?: React.ReactNode
  onStep: (d: 1 | -1) => void
  onBack?: () => void
}) {
  return (
    <CardAction className="flex items-center gap-2">
      {onBack && (
        <Button variant="outline" size="icon-sm" aria-label="Back to the list" onClick={onBack}>
          <ArrowLeftIcon />
        </Button>
      )}
      {children}
      <IconAction label="Previous" shortcut="K" icon={ChevronUpIcon} onClick={() => onStep(-1)} />
      <IconAction label="Next" shortcut="J" icon={ChevronDownIcon} onClick={() => onStep(1)} />
    </CardAction>
  )
}

function CardDetail({
  card,
  done,
  note,
  onStep,
  onBack,
  next,
}: {
  card: InboxCard
  done?: Outcome
  note?: MentionNote
  onStep: (d: 1 | -1) => void
  onBack?: () => void
  next: () => void
}) {
  const { primary, secondary, online, writes } = useActions(card)
  // Opening a card in the quick view is reading it: its unread dot goes.
  const write = useWrite()
  const facts = useFacts()
  const reviews = useReviews()
  React.useEffect(() => {
    void write('markOpened', { ids: [card.id] })
    // Once per card opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id])
  const waits = !online
  const fact = card.factId ? facts.find((f) => f.id === card.factId) : undefined
  const s = card.suggestion
  const changed = s?.changes.filter((c) => c.before !== c.after) ?? []
  // A suggestion's pane is the quick view: what changes, and Review to open the full screen.
  const review = reviews.find((r) => r.id === card.id)

  return (
    <Cell className="group/pane h-full gap-0 py-0">
      <CardHeader className="border-b px-4 py-4">
        <CardTitle className="text-base">{card.title}</CardTitle>
        {review ? (
          // One author line with the time; the summary below is the only other heading-like text.
          <CardDescription>
            <Sender r={review} when={midSentence(card.when)} />
          </CardDescription>
        ) : (
          <CardDescription>
            {cardTypeLabel[card.type]}, {midSentence(card.when)}. {from(card)}
          </CardDescription>
        )}
        <Toolbar onStep={onStep} onBack={onBack}>
          {card.secondary.map((label) => (
            <IconAction
              key={label}
              label={label}
              icon={secondaryIcon[label]!}
              disabled={!!done || (label !== 'Edit' && waits)}
              onClick={secondary[label]!}
            />
          ))}
        </Toolbar>
      </CardHeader>
      {/* J and K move between cards often: the next card is there at once. */}
      <CardContent className="@container min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {review ? (
          <div className="max-w-2xl">
            {note && <MentionBlock note={note} href={`/inbox/${card.id}/review`} />}
            <NewReply id={card.id} />
            <QuickReview r={review} sender={false} />
          </div>
        ) : (
          <div className="flex max-w-2xl flex-col gap-4 text-sm leading-relaxed">
            <div>
              <DomainBadge id={card.domain} />
            </div>
            <p>{card.line}</p>
            <p className="text-muted-foreground">{card.detail}</p>
            {s?.note && (
              <blockquote className="border-l-2 pl-3 text-muted-foreground italic">
                “{s.note}”
              </blockquote>
            )}
            {s && (
              <div className="border-y py-3">
                {(s.factId
                  ? changed
                  : s.changes.filter((c) =>
                      ['What agents should know', 'Where', 'When'].includes(c.label),
                    )
                ).map((c) => (
                  <FieldDiff key={c.label} {...c} />
                ))}
              </div>
            )}
            {card.look && <LookList ids={card.look.questions} />}
            {card.gap && (
              <div className="flex flex-col gap-3">
                <p className="text-muted-foreground">
                  Agents asked about {card.gap.scope.join(', ')}, {card.gap.times} times this week.
                </p>
                <p>
                  <span className="font-medium">Where the fix probably belongs:</span>{' '}
                  {card.gap.belongs}.
                </p>
              </div>
            )}
            {fact && card.type !== 'suggestion' && (
              <div className="flex flex-col gap-1 border-y py-3">
                <div className="font-medium">{fact.title}</div>
                <p className="text-muted-foreground">{plainText(fact.summary)}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="h-bar shrink-0 gap-3 rounded-none border-t bg-background px-4">
        {done ? (
          <>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleCheckIcon className="size-4" aria-hidden /> {done.label},{' '}
              {midSentence(done.at)}.
            </p>
            {note && <MentionDone subject={note.subject} next={next} />}
          </>
        ) : (
          <>
            {!online && (writes || card.secondary.some((l) => l !== 'Edit')) ? (
              <p className="truncate text-sm text-muted-foreground">
                Offline: changes wait until you're back.
              </p>
            ) : null}
            {/* The key, only while the pointer is on the pane: it is for people who already work with the keyboard. */}
            <span className="hidden text-xs text-muted-foreground opacity-0 transition-opacity group-hover/pane:opacity-100 md:inline pointer-coarse:hidden">
              <Kbd>Enter</Kbd> to {card.primary.toLowerCase()}
            </span>
            <Button
              size="sm"
              className="ml-auto max-sm:flex-1"
              data-primary
              disabled={writes && !online}
              onClick={primary}
            >
              {card.primary}
            </Button>
          </>
        )}
      </CardFooter>
    </Cell>
  )
}

/** The saved questions an alert raised, each with what it answered and what it answers now. */
function LookList({ ids }: { ids: string[] }) {
  const all = useSavedQuestions()
  const qs = ids.map((id) => all.find((q) => q.id === id)).filter((q) => !!q)
  return (
    <ul className="flex flex-col border-y">
      {qs.map((q) => (
        <li key={q.id} className="flex gap-2.5 border-b py-3 last:border-b-0">
          <ResultIcon result={q.result} className="mt-0.5" />
          <div className="min-w-0">
            <p className="font-medium">{q.question}</p>
            <p className="text-muted-foreground">{q.why}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Who mentioned you, when, and what they wrote, with the way to the thread. */
function MentionBlock({
  note,
  href,
  link = 'Read the comments',
}: {
  note: MentionNote
  href?: string
  link?: string
}) {
  return (
    <div className="mb-5 flex flex-col gap-1.5 border-l-2 border-primary/60 py-0.5 pl-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <AtSignIcon className="size-3.5" aria-hidden />
        {note.from} mentioned you, {midSentence(note.when)}
      </p>
      <p className="line-clamp-3 text-muted-foreground">{note.excerpt}</p>
      {href && (
        <a href={href} className="w-fit text-primary underline-offset-4 hover:underline">
          {link}
        </a>
      )}
    </div>
  )
}

/** Clears a mention from Needs you; the comment itself stays. */
function MentionDone({ subject, next }: { subject: Subject; next: () => void }) {
  const commentActions = useCommentActions()
  return (
    <Button
      size="sm"
      className="ml-auto max-sm:flex-1"
      data-primary
      onClick={() => {
        void commentActions.seenMention(subject)
        toast('Done', { description: 'The comment stays in the thread.' })
        next()
      }}
    >
      Done
    </Button>
  )
}

const CommentBox = React.lazy(() =>
  import('@/components/templates/comment-box').then((m) => ({ default: m.CommentBox })),
)

/** The thread itself, to read and answer without leaving the Inbox. */
function Thread({ subject, domain }: { subject: Subject; domain: DomainId }) {
  const me = useMe()
  const domains = useDomains()
  return (
    <React.Suspense fallback={null}>
      <CommentBox
        subject={subject}
        me={me.name}
        owners={domains[domain]?.owners ?? []}
        className="border-t pt-5"
      />
    </React.Suspense>
  )
}

function WaitingDetail({
  item,
  note,
  onStep,
  onBack,
  next,
}: {
  item: Waiting
  note?: MentionNote
  onStep: (d: 1 | -1) => void
  onBack?: () => void
  next: () => void
}) {
  return (
    <Cell className="h-full gap-0 py-0">
      <CardHeader className="border-b px-4 py-4">
        <CardTitle className="text-base">{item.title}</CardTitle>
        <CardDescription>
          Your suggestion, sent {item.sent.toLowerCase() === 'today' ? 'today' : `on ${item.sent}`}.
        </CardDescription>
        <Toolbar onStep={onStep} onBack={onBack} />
      </CardHeader>
      <CardContent className="@container min-h-0 flex-1 overflow-y-auto px-4 py-5 text-sm">
        <div className="flex max-w-2xl flex-col gap-4">
          {note && <MentionBlock note={note} />}
          <div>
            <DomainBadge id={item.domain} />
          </div>
          <p className="text-muted-foreground">
            Waiting for {item.waitingFor}. You'll see here when it is published or returned.
          </p>
          <Thread subject={`review:${item.card}`} domain={item.domain} />
        </div>
      </CardContent>
      {note && (
        <CardFooter className="h-bar shrink-0 gap-3 rounded-none border-t bg-background px-4">
          <MentionDone subject={note.subject} next={next} />
        </CardFooter>
      )}
    </Cell>
  )
}

/** A mention on something that isn't in your Inbox otherwise: someone else's context item or suggestion. */
function MentionDetail({
  subject,
  title,
  note,
  onStep,
  onBack,
  next,
}: {
  subject: Subject
  title: string
  note: MentionNote
  onStep: (d: 1 | -1) => void
  onBack?: () => void
  next: () => void
}) {
  const [kind, id] = subject.split(':')
  const facts = useFacts()
  const domains = useDomains()
  const { cards } = useInbox()
  const fact = kind === 'context' ? facts.find((f) => f.id === id) : undefined
  const card = kind === 'review' ? cards.find((c) => c.id === id) : undefined
  const domain = fact?.domain ?? card?.domain ?? 'sales'
  return (
    <Cell className="h-full gap-0 py-0">
      <CardHeader className="border-b px-4 py-4">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          A comment on {fact ? 'a context item' : 'a suggestion'} in {domains[domain]?.name}.
          Comments are not part of what agents get.
        </CardDescription>
        <Toolbar onStep={onStep} onBack={onBack} />
      </CardHeader>
      <CardContent className="@container min-h-0 flex-1 overflow-y-auto px-4 py-5 text-sm">
        <div className="flex max-w-2xl flex-col gap-4">
          <MentionBlock
            note={note}
            href={fact ? `/context/${fact.id}` : undefined}
            link="Open the context item"
          />
          <Thread subject={subject} domain={domain} />
        </div>
      </CardContent>
      <CardFooter className="h-bar shrink-0 gap-3 rounded-none border-t bg-background px-4">
        <span className="hidden text-xs text-muted-foreground md:inline">
          Reply in the thread, or mark it done.
        </span>
        <MentionDone subject={note.subject} next={next} />
      </CardFooter>
    </Cell>
  )
}

/* ---------- setup and all done ---------- */

function Setup() {
  const {
    setup: { done: setupDone },
  } = useWorkspace()
  const write = useWrite()
  const first = setupSteps.find((s) => !setupDone[s.id])
  // A question about the first item, from what it applies to or, if that is empty, its own words.
  // A new install has only what this visit added, newest first.
  const item = useFacts()[0]
  const words = useQuery({
    ...readQuestionQuery(item ? `${item.title} ${item.summary}` : ''),
    enabled: !!item && !item.where.length,
  }).data
  const read =
    item && (item.where.length ? { metric: item.where[0], markets: item.where.slice(1) } : words)
  const scope = read && scopeText({ metric: read.metric ?? '', markets: read.markets })
  const firstQuestion = scope
    ? `What should I know about ${scope}?`
    : 'What should I know about our numbers?'
  const doneCount = setupSteps.filter((s) => setupDone[s.id]).length
  const go = (id: string) => {
    if (id === 'definitions') navigate('/settings/integrations/cube/connect', { setup: '1' })
    if (id === 'about') navigate('/settings/general', { setup: '1' })
    if (id === 'fact') navigate('/context/new', { setup: '1' })
    // A question about the first item, typed in and ready to send.
    if (id === 'ask') navigate('/ask', { setup: '1', n: 'setup', q: firstQuestion })
    if (id === 'agent') {
      void write('completeSetupStep', { step: 'agent' })
      open('connect')
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The same header as the Inbox in every state, so the page keeps its shape. */}
      <SiteHeader title="Inbox" icon={<InboxIcon />}>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Ask in the side panel"
          onClick={() => openDock('ask')}
        >
          <MessageSquareIcon />
        </Button>
      </SiteHeader>
      <div className="@container/main min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col p-4 md:p-6">
          <div className="grid grid-cols-1 gap-px bg-border p-px">
            <Cell className="gap-0 py-0">
              <CardHeader className="border-b px-4 py-4">
                <CardTitle className="text-base">
                  Set up your workspace so agents can use what you know
                </CardTitle>
                <CardDescription>
                  Your team writes down what the numbers don't show, and every agent reads it before
                  it answers. Write first, connect later: about ten minutes to your first answer.
                  Context goes to the domain Company, owned by you.
                </CardDescription>
                <CardAction className="text-xs text-muted-foreground tabular-nums">
                  {doneCount} of {setupSteps.length} done
                </CardAction>
              </CardHeader>
              <CardContent className="px-0">
                <ol className="flex flex-col divide-y divide-border">
                  {setupSteps.map((step, i) => {
                    const isDone = setupDone[step.id]
                    return (
                      <li
                        key={step.id}
                        className="flex min-h-16 items-center gap-3 px-4 py-3 @md:px-6"
                      >
                        <span
                          aria-hidden
                          className="flex size-10 shrink-0 items-center justify-center text-sm text-muted-foreground tabular-nums"
                        >
                          {isDone ? <CircleCheckIcon className="size-4 text-foreground" /> : i + 1}
                        </span>
                        <span className="min-w-0 flex-1 space-y-1">
                          <span
                            className={cn(
                              'block text-sm leading-snug',
                              isDone && 'text-muted-foreground line-through',
                            )}
                          >
                            {step.title}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {step.description}
                          </span>
                        </span>
                        {isDone ? (
                          <span className="sr-only">Done</span>
                        ) : (
                          <Button
                            variant={first?.id === step.id ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => go(step.id)}
                          >
                            {step.action}
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </CardContent>
              <CardFooter className="rounded-none border-t bg-background px-4 py-4 text-xs text-muted-foreground @md:px-6">
                Until there is context, agents hear “Nothing is written down for this.” That is the
                honest answer, not an error.
              </CardFooter>
            </Cell>
          </div>
        </div>
      </div>
    </div>
  )
}

/** What agents asked this week, in counts only: the quiet sign that it is working. */
function WeekLine() {
  const { week } = useInbox()
  if (week.asked === 0) return <>Agents asked nothing this week.</>
  if (week.asked === null) return <>This week agents asked fewer than 5 times.</>
  if (week.found === null || week.nothing === null)
    return <>This week agents asked {week.asked} times.</>
  const most = week.mostAbout ? `, most about ${week.mostAbout}` : ''
  return (
    <>
      <span className="max-sm:hidden">
        This week agents asked {week.asked} times. {week.found} found checked context;{' '}
        {week.nothing} found nothing written down{most}.
      </span>
      <span className="sm:hidden">
        Agents asked {week.asked} times this week; {week.nothing} found nothing written down.
      </span>
    </>
  )
}

function AllDone({ waitingCount }: { waitingCount: number }) {
  return (
    <Empty className="py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleCheckIcon />
        </EmptyMedia>
        <EmptyTitle>Nothing needs you</EmptyTitle>
        <EmptyDescription className="text-xs">
          Nothing new is uncovered, reported or suggested.
          {waitingCount > 0 &&
            ` ${waitingCount === 1 ? 'One suggestion of yours is' : `${waitingCount} of yours are`} waiting on others, under All.`}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={() => navigate('/ask')}>
          <MessageSquareIcon data-icon="inline-start" />
          Ask a question
        </Button>
      </EmptyContent>
    </Empty>
  )
}

/* ---------- the page ---------- */

export function InboxPage() {
  const load = useQuery(inboxPageQuery())
  const inbox = useInbox()
  const { install } = useSession()
  const write = useWrite()
  const commentActions = useCommentActions()
  const { query } = useRoute()
  const isMobile = useIsMobile()
  const dock = useDock()
  // A decision shows at once, while it is saved; a failed save takes it back by itself.
  const [decided, addDecided] = React.useOptimistic(
    inbox.done,
    (done, d: { card: string; outcome: string }) => ({
      ...done,
      [d.card]: { label: d.outcome, at: 'Just now' },
    }),
  )
  const { needing, rows, waiting: mineWaiting } = useInboxRows(decided)
  const tab = query.get('tab') === 'all' ? 'all' : 'needs'
  const [search, setSearch] = React.useState('')

  const visible = rows.filter((r) => {
    if (tab === 'needs' && !needs(r)) return false
    const text = r.kind === 'card' ? `${r.card.title} ${r.card.line}` : rowTitle(r)
    return text.toLowerCase().includes(search.toLowerCase())
  })
  // ?card=none is the cleared selection (Esc): the pane says so instead of opening the first card.
  const cleared = query.get('card') === 'none'
  const selectedId = cleared
    ? undefined
    : (query.get('card') ?? (isMobile ? undefined : visible[0] && rowId(visible[0])))
  const selected = rows.find((r) => rowId(r) === selectedId)
  const select = (id?: string) => setQuery({ card: id ?? (isMobile ? undefined : 'none') })
  const ids = visible.map(rowId)
  const listRef = React.useRef<HTMLUListElement>(null)
  const online = useOnline()
  const sel = useSelection(ids, { scope: listRef })
  // Ticked rows, read: the dot goes, and a mention or a new reply is marked seen.
  const markRead = () => {
    const picked = rows.filter((r) => sel.isSelected(rowId(r)))
    for (const r of picked) {
      if (r.kind === 'card') {
        void write('markOpened', { ids: [r.card.id] })
        void commentActions.seen(`review:${r.card.id}`)
      }
      if (r.note) void commentActions.seenMention(r.note.subject)
    }
    toast(`Marked ${picked.length} as read`)
    sel.clear()
  }
  const step = (d: 1 | -1) => {
    const i = ids.indexOf(selectedId ?? '')
    // With nothing selected, either key opens the first card.
    const nextId = i < 0 ? ids[0] : ids[Math.min(ids.length - 1, Math.max(0, i + d))]
    if (nextId) select(nextId)
  }
  // After acting on a card, move to the next one that needs you.
  const next = () => {
    const rest = needing.filter((r) => rowId(r) !== selectedId)
    setQuery({ card: rest[0] && rowId(rest[0]), dock: undefined })
  }

  // J and K step through the list, Enter opens the selected card's primary action.
  const frameRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (!pageKey(e)) return
      if (e.key === 'j') step(1)
      if (e.key === 'k') step(-1)
      // Esc clears the selection: on a phone the list comes back, on a wide screen the pane empties.
      // Ticked rows clear first, in the selection's own Esc.
      if (e.key === 'Escape' && selected && !sel.count) select(undefined)
      if (e.key === 'Enter' && t === document.body)
        frameRef.current?.querySelector<HTMLButtonElement>('button[data-primary]')?.click()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /**
   * A decision on a card, without a wait: the row goes now and the next card opens; Undo stays for
   * 6s; the save runs behind it (it takes as long as a send, and with ?decide=fail or
   * ?state=failed the mock fails each card's first one), and if it fails the card comes back with
   * Try again.
   */
  const decide = (card: InboxCard, d: Decision) => {
    let undone = false
    let saved: string | undefined
    next()
    leaveThen(card.id, () =>
      React.startTransition(async () => {
        addDecided({ card: card.id, outcome: d.outcome })
        try {
          const { undo } = await write('decideCard', {
            card: card.id,
            outcome: d.outcome,
            patch: d.patch,
          })
          saved = undo
          // Undo was pressed while it was being saved: it is taken back as soon as it is in.
          if (undone) await write('undo', { token: undo })
        } catch {
          if (undone) return
          toast.error("Couldn't save that decision", {
            description: 'Nothing changed. The card is back in the Inbox.',
            action: { label: 'Try again', onClick: () => decide(card, d) },
          })
        }
      }),
    )
    toast(d.message, {
      description: d.description,
      duration: 6000,
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true
          if (saved) void write('undo', { token: saved })
        },
      },
    })
  }

  if (install === 'new') return <Setup />

  const allDone = tab === 'needs' && needing.length === 0

  const back = isMobile ? () => select(undefined) : undefined
  const detail = selected ? (
    selected.kind === 'card' ? (
      <CardDetail
        key={selected.card.id}
        card={selected.card}
        done={selected.done}
        note={selected.note}
        onStep={step}
        next={next}
        onBack={back}
      />
    ) : selected.kind === 'waiting' ? (
      <WaitingDetail
        key={selected.item.id}
        item={selected.item}
        note={selected.note}
        onStep={step}
        next={next}
        onBack={back}
      />
    ) : (
      <MentionDetail
        key={selected.subject}
        subject={selected.subject}
        title={selected.title}
        note={selected.note}
        onStep={step}
        next={next}
        onBack={back}
      />
    )
  ) : (
    <Cell className="h-full justify-center">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nothing selected</EmptyTitle>
          <EmptyDescription className="text-xs">
            Pick a card on the left, or press J to open the first.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </Cell>
  )

  const list = (
    <div className="flex h-full min-h-0 flex-col gap-0">
      <Cell className="h-full min-h-0 gap-0 py-0">
        <CardHeader className="border-b px-4 py-4">
          <CardTitle className="text-base">{tab === 'all' ? 'Everything' : 'Needs you'}</CardTitle>
          <CardDescription>
            {tab === 'all' ? 'Yours, waiting on others, and done.' : <WeekLine />}
          </CardDescription>
          <CardAction>
            {/* A filter, not navigation: quiet words with counts. */}
            <TextSwitch
              label="Show"
              value={tab}
              onChange={(v) => setQuery({ tab: v === 'all' ? 'all' : undefined, card: undefined })}
              options={[
                { value: 'needs', label: 'Needs me', count: needing.length },
                { value: 'all', label: 'All', count: rows.length },
              ]}
            />
          </CardAction>
          <form className="col-span-full mt-3" onSubmit={(e) => e.preventDefault()}>
            <div className="relative">
              <SearchIcon
                className="absolute top-2 left-2.5 size-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                placeholder="Search the Inbox"
                aria-label="Search the Inbox"
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </form>
        </CardHeader>
        {/* The rows take focus, not the box they scroll in: no stop without a ring. */}
        <div tabIndex={-1} className="@container min-h-0 flex-1 overflow-y-auto outline-none">
          {allDone ? (
            <AllDone waitingCount={mineWaiting.length} />
          ) : visible.length === 0 ? (
            <p className="px-6 py-4 text-sm text-muted-foreground">No cards match “{search}”.</p>
          ) : (
            <InboxList
              rows={visible}
              selected={selectedId}
              onSelect={select}
              sel={sel}
              list={listRef}
            />
          )}
        </div>
        <BulkBar
          label="Selected cards"
          count={sel.count}
          onClear={sel.clear}
          note={
            online
              ? undefined
              : { text: "You're offline. Changes are off until you're back; nothing is lost." }
          }
        >
          <BulkButton
            reason={online ? undefined : "Off while you're offline. Nothing is lost."}
            onClick={markRead}
          >
            <MailOpenIcon />
            <span className="max-sm:sr-only">Mark as read</span>
          </BulkButton>
        </BulkBar>
      </Cell>
    </div>
  )

  const panes = isMobile ? (
    <div className="h-full min-h-0">{selected ? detail : list}</div>
  ) : allDone || dock ? (
    <div className="h-full min-h-0">{list}</div>
  ) : (
    <ResizablePanelGroup orientation="horizontal" id="inbox">
      <ResizablePanel id="inbox-list" defaultSize="42" minSize={320}>
        {list}
      </ResizablePanel>
      <ResizableHandle className="w-px bg-border" />
      <ResizablePanel id="inbox-detail" defaultSize="58" minSize={360}>
        {detail}
      </ResizablePanel>
    </ResizablePanelGroup>
  )

  return (
    <div className={cn('flex h-full min-h-0 flex-col', TOUCH)}>
      <SiteHeader title="Inbox" icon={<InboxIcon />}>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Ask in the side panel"
          onClick={() => openDock('ask')}
        >
          <MessageSquareIcon />
        </Button>
      </SiteHeader>
      <div
        className="@container/main flex min-h-0 flex-1 flex-col px-4 pt-4 md:px-6 md:pt-6"
        ref={frameRef}
      >
        <div className="mx-auto flex h-full min-h-0 w-full max-w-wide flex-col gap-px bg-border p-px">
          <div className="min-h-0 flex-1 bg-background">
            <Loadable what="the Inbox" skeleton={<ListSkeleton />} query={load}>
              <Decide.Provider value={decide}>{panes}</Decide.Provider>
            </Loadable>
          </div>
        </div>
      </div>
    </div>
  )
}
