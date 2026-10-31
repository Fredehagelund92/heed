import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AtSignIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  ExternalLinkIcon,
  EyeIcon,
  LayersIcon,
  LockIcon,
  PencilIcon,
  SplitIcon,
  TriangleAlertIcon,
  Undo2Icon,
} from '@/components/icons'
import { PersonAvatar, StateLine } from '@/components/heed/bits'
import { kindIcons } from '@/components/heed/kind-icons'
import { Statement } from '@/components/heed/conflict-pair'
import { Loadable } from '@/components/heed/load-state'
import { markText } from '@/components/heed/mark'
import { DomainDot } from '@/components/heed/tag-chip'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { conflictQuery, conflictsQuery, useWrite } from '@/api/queries'
import { ApiError } from '@/api/errors'
import { useIsMobile } from '@/hooks/use-mobile'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { useWide } from '@/hooks/use-wide'
import { CONFLICT_KEYS, SIDE_BY_SIDE, type ConflictCommand } from '@/lib/conflict'
import { comparePair, type Compared } from '@/lib/differing-words'
import { pageKey } from '@/lib/keys'
import { navigate } from '@/lib/router'
import { useOnline, useSend } from '@/lib/send'
import { cn } from '@/lib/utils'
import { useMe } from '@/lib/workspace'
import {
  SAID_NOW,
  sideTitle,
  sublineOf,
  titleOf,
  type Conflict,
  type ConflictDecision,
  type ConflictRow,
  type ConflictSide,
  type Said,
  type SettleOutcome,
} from '@/model/conflicts'
import { kindLabel } from '@/model/items'

// The conflict view: one component, a pair of items, every place it shows (FR-220). It reads its
// own width: two columns from SIDE_BY_SIDE, as in the 720 dock and on a page; one pile per item
// below it (a 480 dock, a phone), in the same row order. Evidence first: what each says and where
// it comes from, what agents would say with only that one, then the actions under the item they
// act on; the other ways to settle it below. Every choice asks why and shows what agents will then
// say before it is made. A conflict is declared by a person, so the view never says the texts
// contradict: it shows what each says and who said it.

/** The Conflict chip: a triangle and the word, never colour alone. */
export function ConflictChip({ className }: { className?: string }) {
  // Its words keep the text's own ink wherever it sits, for 4.5:1 on its tint.
  return <StateLine state="conflict" className={cn('text-foreground', className)} />
}

/** One line that says how to read the marks, or that nothing is marked and why. */
export function Legend({ how }: { how: Compared['how'] }) {
  return (
    <p className="text-xs text-muted-foreground">
      {how === 'shared' ? (
        <>
          <span className="font-semibold">Grey words</span> are in both. The words in full ink are
          where they part.
        </>
      ) : how === 'differs' ? (
        <>
          <span className={cn('text-foreground', markText('differs'))}>Underlined words</span> are
          where the two differ.
        </>
      ) : (
        'These are written differently, so no words are marked. Read both and the checked dates.'
      )}
    </p>
  )
}

/** What agents say: the state chip and the words, in the quiet box Try it uses. */
export function SaysBox({ said, className }: { said: Said; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2 rounded-frame border bg-muted/40 p-3', className)}>
      <StateLine state={said.state} tip={false} />
      <p className="text-sm leading-relaxed text-pretty">{said.text}</p>
    </div>
  )
}

const sourceShort = (url: string) => url.replace(/^https?:\/\//, '')
const ownerNames = (s: Pick<ConflictSide, 'owners' | 'domainName'>) =>
  s.owners.length > 1
    ? `${s.owners.slice(0, -1).join(', ')} and ${s.owners.at(-1)}`
    : (s.owners[0] ?? `the owners of ${s.domainName}`)

/** Where an item comes from: domain and kind, owners, the check, the source and its quoted line. */
function Provenance({ s }: { s: ConflictSide }) {
  const KindIcon = kindIcons[s.kind]
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 font-medium">
          <DomainDot id={s.domain} />
          {s.domainName}
        </span>
        <span className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">
          <KindIcon aria-hidden className="size-3" />
          {kindLabel[s.kind]}
        </span>
      </p>
      <p className="flex items-center gap-2">
        <span className="flex -space-x-1" aria-hidden>
          {s.owners.map((o) => (
            <PersonAvatar key={o} name={o} size={20} className="ring-2 ring-background" />
          ))}
        </span>
        <span>owned by {ownerNames(s)}</span>
      </p>
      {s.checkedOn && (
        <p className="text-muted-foreground">
          Checked {s.checkedOn}
          {s.checkedBy && <>, by {s.checkedBy}</>}
        </p>
      )}
      {s.source && (
        <a
          href={s.source.url}
          target="_blank"
          rel="noreferrer"
          className="flex w-fit max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium break-all text-primary underline-offset-4 hover:underline"
        >
          <ExternalLinkIcon aria-hidden className="size-3 shrink-0" />
          {sourceShort(s.source.url)}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
      {s.source?.quote && (
        <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground italic">
          “{s.source.quote}”
        </blockquote>
      )}
    </div>
  )
}

/* ---------- the reason box ---------- */

type Pending =
  | { how: 'kept_one'; keep: ConflictSide; other: ConflictSide }
  | { how: 'kept_both' }
  | { how: 'not_conflict' }
  /** Someone who may not archive an item suggests it to its owners instead (FR-112). */
  | { how: 'suggest_archive'; goes: ConflictSide; stays: ConflictSide }

const owns = (s: ConflictSide) => (s.owners.length > 1 ? 'own' : 'owns')
const are = (s: ConflictSide) => (s.owners.length > 1 ? 'are' : 'is')

function dialogCopy(p: Pending, c: Conflict) {
  const said = c.said
  if (p.how === 'kept_one')
    return {
      title: `Keep “${sideTitle(p.keep)}”`,
      description: `Agents stop getting “${sideTitle(p.other)}”. You can undo this for a few seconds.`,
      reason: 'Why does this one stay?',
      empty: 'Add a reason to keep this one.',
      confirm: 'Keep this one',
      then: said ? (p.keep.id === c.holder.id ? said.onlyHolder : said.onlyOther) : null,
      told: `${ownerNames(p.other)}, who ${owns(p.other)} “${sideTitle(p.other)}”, ${are(p.other)} told.`,
    }
  if (p.how === 'suggest_archive')
    return {
      title: `Suggest archiving “${sideTitle(p.goes)}”`,
      description: `${ownerNames(p.goes)} ${p.goes.owners.length > 1 ? 'decide' : 'decides'}: it waits in their Inbox with your reason. Nothing changes until then.`,
      reason: 'Why should it be archived?',
      empty: 'Add a reason for the owners.',
      confirm: 'Send the suggestion',
      then: said ? (p.stays.id === c.holder.id ? said.onlyHolder : said.onlyOther) : null,
      told: `${ownerNames(p.goes)} ${are(p.goes)} told.`,
    }
  if (p.how === 'kept_both')
    return {
      title: 'Keep both',
      description:
        'Agents keep saying Conflict until one of these changes what they get. The pair leaves the conflict lists until then.',
      reason: 'Why do both stay?',
      empty: 'Add a reason to keep both.',
      confirm: 'Keep both',
      then: said?.now ?? SAID_NOW,
      told: 'The other owners of the two items are told.',
    }
  return {
    title: 'Not a conflict',
    description: `Removes the Conflict flag from “${sideTitle(c.holder)}”. Agents then give both and say nothing about a difference.`,
    reason: 'Why is this not a conflict?',
    empty: 'Add a reason to remove the flag.',
    confirm: 'Not a conflict',
    then: said?.withoutFlag ?? null,
    told: `${ownerNames(c.other)}, who ${owns(c.other)} “${sideTitle(c.other)}”, ${are(c.other)} told.`,
  }
}

type Draft = { reason: string; quote: string }

function SettleDialog({
  conflict,
  pending,
  draft,
  onDraft,
  onClose,
  onConfirm,
  sending,
  failed,
}: {
  conflict: Conflict
  pending: Pending | null
  draft: Draft
  onDraft: (d: Draft) => void
  onClose: () => void
  onConfirm: () => void
  sending: boolean
  failed: string | null
}) {
  const copy = pending ? dialogCopy(pending, conflict) : null
  const ready = draft.reason.trim().length > 0
  const id = React.useId()
  return (
    <Dialog open={!!pending} onOpenChange={(open) => !open && onClose()}>
      {copy && (
        <DialogContent
          className="max-h-screen-inset overflow-y-auto sm:max-w-lg"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready) {
              e.preventDefault()
              onConfirm()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="pr-8 text-pretty">{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
          {failed && (
            <div role="alert" className="flex items-start gap-2 rounded-frame border p-3 text-sm">
              <TriangleAlertIcon
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-destructive-ink"
              />
              <span>
                <span className="font-medium">{failed}</span>{' '}
                <span className="text-muted-foreground">
                  Your reason and the line are kept in the box.
                </span>
              </span>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-reason`}>
              {copy.reason} <span className="font-normal text-muted-foreground">(needed)</span>
            </Label>
            <Textarea
              id={`${id}-reason`}
              autoFocus
              rows={3}
              value={draft.reason}
              onChange={(e) => onDraft({ ...draft, reason: e.target.value })}
              aria-describedby={ready ? undefined : `${id}-empty`}
            />
            {!ready && (
              <p id={`${id}-empty`} className="text-xs text-muted-foreground">
                {copy.empty}
              </p>
            )}
          </div>
          {pending?.how !== 'suggest_archive' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-quote`}>
                A line that settles it{' '}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id={`${id}-quote`}
                value={draft.quote}
                onChange={(e) => onDraft({ ...draft, quote: e.target.value })}
                placeholder="Quote the source, word for word"
              />
            </div>
          )}
          {copy.then && (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">
                {pending?.how === 'suggest_archive'
                  ? 'If the owners archive it, agents will say'
                  : 'Agents will then say'}
              </p>
              <SaysBox said={copy.then} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {copy.told}
            {pending?.how !== 'suggest_archive' &&
              ' Your reason and the line are kept on both items.'}
          </p>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={onConfirm} disabled={!ready || sending} aria-keyshortcuts="Meta+Enter">
              <CheckIcon data-icon="inline-start" />
              {sending ? 'Saving…' : copy.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}

/* ---------- ask the owner ---------- */

function AskOwnerDialog({ about, onClose }: { about: ConflictSide | null; onClose: () => void }) {
  const me = useMe()
  const write = useWrite()
  const [text, setText] = React.useState('')
  const id = React.useId()
  const owner = about ? (about.owners.find((o) => o !== me.name) ?? about.owners[0] ?? '') : ''
  const send = async () => {
    if (!about) return
    await write('postComment', {
      subject: `context:${about.id}`,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              ...(owner
                ? [{ type: 'mention', attrs: { id: `person:${owner}`, label: owner } }]
                : []),
              { type: 'text', text: ` ${text.trim()}` },
            ],
          },
        ],
      },
    })
    onClose()
    setText('')
    toast(`Asked ${owner || 'the owners'}`, {
      description: `A comment on “${sideTitle(about)}”, and a card in their Inbox.`,
    })
  }
  return (
    <Dialog open={!!about} onOpenChange={(o) => !o && onClose()}>
      {about && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ask {owner || 'the owner'}</DialogTitle>
            <DialogDescription>
              A comment on “{sideTitle(about)}” that mentions {owner || 'its owners'}. It also lands
              in their Inbox.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id}>Your question</Label>
            <Textarea
              id={id}
              autoFocus
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Which one should agents get?"
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={() => void send()} disabled={!text.trim()}>
              <AtSignIcon data-icon="inline-start" />
              Ask {owner || 'the owner'}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}

/* ---------- the outcome ---------- */

type Done = { conflict: Conflict; decision: ConflictDecision; undo: string }

function outcomeOf({ conflict: c, decision: d }: Done): {
  chip: string
  line: string
  now: Said | null
} {
  if (d.outcome === 'kept_one') {
    const kept = d.keptId === c.holder.id ? c.holder : c.other
    const gone = kept === c.holder ? c.other : c.holder
    return {
      chip: 'Settled',
      line: `Kept “${sideTitle(kept)}”. Archived “${sideTitle(gone)}”.`,
      now: c.said ? (kept === c.holder ? c.said.onlyHolder : c.said.onlyOther) : null,
    }
  }
  if (d.outcome === 'kept_both')
    return {
      chip: 'Kept both',
      line: 'Kept both. Agents keep saying Conflict until one of these changes what they get.',
      now: c.said?.now ?? SAID_NOW,
    }
  return {
    chip: 'Settled',
    line: `Not a conflict. The flag is removed from “${sideTitle(c.holder)}”.`,
    now: c.said?.withoutFlag ?? null,
  }
}

function Outcome({
  done,
  next,
  onUndo,
  onNext,
}: {
  done: Done
  next?: ConflictRow
  onUndo: () => void
  onNext: () => void
}) {
  const reduced = useReducedMotion()
  const [held, setHeld] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const o = outcomeOf(done)
  React.useEffect(() => ref.current?.focus(), [])
  // A letter key moves on at once; the pointer on it holds the wait; reduced motion waits for Next.
  React.useEffect(() => {
    if (!next) return
    const onKey = (e: KeyboardEvent) => {
      if (pageKey(e) && /^[a-z]$/i.test(e.key)) onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, onNext])
  return (
    <div className="flex flex-col gap-4">
      <div
        ref={ref}
        tabIndex={-1}
        role="status"
        onPointerEnter={() => setHeld(true)}
        onPointerLeave={() => setHeld(false)}
        className="flex animate-in flex-col gap-3 rounded-frame border border-primary p-4 duration-(--dur-4) fade-in-0 outline-none slide-in-from-bottom-1"
      >
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="flex value-changed items-center gap-1.5 rounded-md bg-primary/8 px-2 py-1 font-semibold">
            <CircleCheckIcon aria-hidden className="size-4 text-primary" />
            {o.chip}
          </span>
          <span className="min-w-0 flex-1 text-pretty">{o.line}</span>
          <Button variant="ghost" size="sm" onClick={onUndo}>
            <Undo2Icon data-icon="inline-start" />
            Undo
          </Button>
        </p>
        <p className="text-sm text-muted-foreground">
          {done.decision.by}, today, {done.decision.at}. Reason: {done.decision.reason}
          {done.decision.quote && <> “{done.decision.quote}”</>}
        </p>
        {o.now && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">Agents now say</p>
            <SaysBox said={o.now} />
          </div>
        )}
        {next && !reduced && (
          <>
            <span aria-hidden className="h-0.5 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full origin-left animate-[countdown_2.6s_linear_forwards] bg-primary"
                style={{ animationPlayState: held ? 'paused' : 'running' }}
                onAnimationEnd={onNext}
              />
            </span>
            <p className="text-xs text-muted-foreground">
              Next conflict in a moment. Hover over this to stay here.
            </p>
          </>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-frame border p-4 text-sm">
        <span className="min-w-0 flex-1 text-pretty">
          {done.conflict.topic || 'This pair'} had {done.conflict.asked} questions this week with a
          Conflict.
          {next ? ` Next: ${next.topic}, ${next.asked} questions.` : ' Nothing else disagrees.'}
        </span>
        {next ? (
          <Button variant="outline" size="sm" onClick={onNext}>
            <ChevronRightIcon data-icon="inline-start" />
            Next conflict
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => navigate('/context/conflicts')}>
            All conflicts
          </Button>
        )}
      </p>
    </div>
  )
}

/* ---------- the view ---------- */

export type ConflictPlace = 'page' | 'dock'

/**
 * The whole view for the pair at `pairKey` (`holderId.otherId`). `onStep` moves to the next or
 * previous conflict of the list; the page binds J and K to it, the dock its up and down buttons.
 */
export function ConflictView({
  pairKey,
  place,
  openAs,
  onStep,
}: {
  pairKey: string
  place: ConflictPlace
  /** Opens the Not a conflict confirm step on arrival, as after an edit made from the conflict. */
  openAs?: 'not_conflict'
  onStep?: (to: ConflictRow) => void
}) {
  const query = useQuery(conflictQuery(pairKey))
  const list = useQuery(conflictsQuery('all'))
  const me = useMe()
  const write = useWrite()
  const online = useOnline()
  const sender = useSend()
  const isMobile = useIsMobile()
  const [measure, wide] = useWide<HTMLDivElement>(SIDE_BY_SIDE)
  const root = React.useRef<HTMLDivElement | null>(null)
  const ref = (el: HTMLDivElement | null) => {
    measure(el)
    root.current = el
  }
  const [picked, pick] = React.useState<Pending | null>(null)
  const [left, setLeft] = React.useState(false)
  const setPending = (p: Pending | null) => {
    setLeft(true)
    pick(p)
  }
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({})
  const [asking, setAsking] = React.useState<ConflictSide | null>(null)
  const [settling, setSettling] = React.useState(false)
  const [done, setDone] = React.useState<Done | null>(null)
  const [failed, setFailed] = React.useState<string | null>(null)
  const [changed, setChanged] = React.useState(false)
  const [focusSide, setFocusSide] = React.useState<0 | 1>(0)
  const heading = React.useRef<HTMLHeadingElement>(null)
  const sides = [React.useRef<HTMLDivElement>(null), React.useRef<HTMLDivElement>(null)] as const

  const c = query.data ?? null
  const pending: Pending | null =
    picked ?? (openAs && !left && c?.rights.notConflict ? { how: 'not_conflict' } : null)
  const rows = list.data ?? []
  const at = rows.findIndex((r) => r.key === (done?.conflict.key ?? c?.key ?? pairKey))
  const next =
    rows.find((r, i) => i > at && r.key !== done?.conflict.key) ??
    (done ? rows.find((r) => r.key !== done.conflict.key) : undefined)
  const prev = at > 0 ? rows[at - 1] : undefined

  // Focus moves to the view's heading when it opens or the pair changes.
  React.useEffect(() => heading.current?.focus({ preventScroll: true }), [pairKey, c?.key])

  const held = changed || !online || sender.state === 'sending'
  const draftKey = pending
    ? pending.how === 'kept_one'
      ? `keep.${pending.keep.id}`
      : pending.how === 'suggest_archive'
        ? `suggest.${pending.goes.id}`
        : pending.how
    : ''
  const draft = drafts[draftKey] ?? { reason: '', quote: '' }

  const open = (p: Pending) => {
    if (held) return
    setFailed(null)
    setPending(p)
  }
  const keep = (i: 0 | 1) => {
    if (!c) return
    const [k, o] = i === 0 ? [c.holder, c.other] : [c.other, c.holder]
    if (i === 0 ? c.rights.keepHolder : c.rights.keepOther)
      open({ how: 'kept_one', keep: k, other: o })
  }
  const edit = (s: ConflictSide) => {
    if (!c || held) return
    const other = s.id === c.holder.id ? c.other : c.holder
    const mayEdit = s.id === c.holder.id ? c.rights.editHolder : c.rights.editOther
    navigate(`/context/${s.id}/${mayEdit ? 'edit' : 'suggest'}`, { beside: other.id })
  }

  const confirm = () => {
    if (!c || !pending || !draft.reason.trim()) return
    if (pending.how === 'suggest_archive') {
      const goes = pending.goes
      sender.send(async () => {
        try {
          await write('suggestArchiving', { id: goes.id, reason: draft.reason.trim() })
        } catch (error) {
          setFailed('Could not send the suggestion. Nothing changed.')
          throw error
        }
        setDrafts((d) => ({ ...d, [draftKey]: { reason: '', quote: '' } }))
        setPending(null)
        toast(`Suggested archiving “${sideTitle(goes)}”`, {
          description: `${ownerNames(goes)} get${goes.owners.length > 1 ? '' : 's'} it in their Inbox, with your reason.`,
        })
      })
      return
    }
    const outcome: SettleOutcome = pending.how
    sender.send(async () => {
      try {
        const result = await write('settleConflict', {
          holderId: c.holder.id,
          otherId: c.other.id,
          outcome,
          ...(pending.how === 'kept_one' ? { keepId: pending.keep.id } : {}),
          reason: draft.reason.trim(),
          ...(draft.quote.trim() ? { quote: draft.quote.trim() } : {}),
          versions: { holder: c.holder.version, other: c.other.version },
        })
        setDrafts((d) => ({ ...d, [draftKey]: { reason: '', quote: '' } }))
        setPending(null)
        setDone({ conflict: c, decision: result.decision, undo: result.undo })
        toast(
          outcome === 'kept_one'
            ? 'Kept one, archived the other'
            : outcome === 'kept_both'
              ? 'Kept both'
              : 'Not a conflict',
          { description: 'You can undo this for a few seconds.' },
        )
      } catch (error) {
        // A newer version of either holds the decision, as Publish does: see what changed first.
        if (error instanceof ApiError && error.kind === 'conflict') {
          setPending(null)
          setChanged(true)
          return
        }
        setFailed(`Could not ${dialogCopy(pending, c).confirm.toLowerCase()}. Nothing changed.`)
        throw error
      }
    })
  }

  const undoDone = async () => {
    if (!done) return
    await write('undo', { token: done.undo })
    setDone(null)
    toast('Undone', { description: 'Both items are as they were.' })
  }
  const goNext = React.useCallback(() => {
    if (!next) return
    setDone(null)
    onStep?.(next)
  }, [next, onStep])

  // The Conflict scope: single keys while nobody is typing. A digit, B or N only opens a box that
  // needs a reason, so a slip never archives anything.
  React.useEffect(() => {
    if (!c || done) return
    const onKey = (e: KeyboardEvent) => {
      if (!pageKey(e) || pending || asking) return
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      // J and K step through the list: on the page, and in the dock while focus is in it.
      const stepping = place === 'page' || !!root.current?.contains(e.target as Node)
      const run: Record<ConflictCommand, (() => void) | undefined> = {
        first: () => {
          setFocusSide(0)
          sides[0].current?.focus()
        },
        second: () => {
          setFocusSide(1)
          sides[1].current?.focus()
        },
        keepFirst: () => keep(0),
        keepSecond: () => keep(1),
        edit: () => edit(focusSide === 0 ? c.holder : c.other),
        both: c.rights.keepBoth ? () => open({ how: 'kept_both' }) : undefined,
        notConflict: c.rights.notConflict ? () => open({ how: 'not_conflict' }) : undefined,
        ask: () => setAsking(c.other),
        next: stepping && rows[at + 1] ? () => onStep?.(rows[at + 1]!) : undefined,
        previous: stepping && prev ? () => onStep?.(prev) : undefined,
      }
      const command = CONFLICT_KEYS.find((x) => x.key === k)?.command
      const fn = command && run[command]
      if (!fn) return
      e.preventDefault()
      fn()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const skeleton = (
    <div className="flex flex-col gap-4" aria-hidden>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-7 w-2/3" />
      <div className="grid grid-cols-2 overflow-hidden rounded-frame border">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-3 p-4">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  )

  if (done)
    return <Outcome done={done} next={next} onUndo={() => void undoDone()} onNext={goNext} />

  return (
    <div ref={ref} className="flex flex-col gap-5">
      <Loadable what="the two items" skeleton={skeleton} query={query}>
        {!c ? (
          <div
            role="status"
            className="flex flex-wrap items-start gap-3 rounded-frame border border-primary p-4 text-sm"
          >
            <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="font-medium">These two no longer disagree.</p>
              <p className="text-muted-foreground">There is nothing left to decide.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate('/context/conflicts')}>
              All conflicts
            </Button>
          </div>
        ) : (
          <ConflictBody
            c={c}
            place={place}
            wide={wide}
            heading={heading}
            sides={sides}
            setFocusSide={setFocusSide}
            held={held}
            online={online}
            changed={changed}
            onSeenChange={() => {
              setChanged(false)
              void query.refetch()
            }}
            mine={(s) => me.owns.includes(s.domain) || s.owners.includes(me.name)}
            admin={me.admin}
            ownsLabel={me.owns.length ? me.owns : []}
            keep={keep}
            edit={edit}
            open={open}
            ask={setAsking}
            isMobile={isMobile}
            onSettle={() => setSettling(true)}
          />
        )}
      </Loadable>
      {c && (
        <>
          <Sheet open={settling} onOpenChange={setSettling}>
            <SheetContent side="bottom" className="gap-0">
              <SheetHeader>
                <SheetTitle>Settle it</SheetTitle>
              </SheetHeader>
              <div className="flex flex-col pb-2">
                {[
                  {
                    label: `Keep “${sideTitle(c.holder)}”`,
                    can: c.rights.keepHolder,
                    run: () => keep(0),
                  },
                  {
                    label: `Keep “${sideTitle(c.other)}”`,
                    can: c.rights.keepOther,
                    run: () => keep(1),
                  },
                  {
                    label: 'Edit one of them',
                    can: c.rights.editHolder || c.rights.editOther,
                    run: () => edit(c.rights.editHolder ? c.holder : c.other),
                  },
                  {
                    label: 'Keep both',
                    can: c.rights.keepBoth,
                    run: () => open({ how: 'kept_both' }),
                  },
                  {
                    label: 'Not a conflict',
                    can: c.rights.notConflict,
                    run: () => open({ how: 'not_conflict' }),
                  },
                  { label: 'Ask the owner', can: true, run: () => setAsking(c.other) },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    disabled={!o.can}
                    className="flex min-h-12 items-center border-t px-4 text-left text-sm font-medium disabled:text-muted-foreground"
                    onClick={() => {
                      setSettling(false)
                      o.run()
                    }}
                  >
                    <span className="truncate">{o.label}</span>
                  </button>
                ))}
              </div>
            </SheetContent>
          </Sheet>
          <SettleDialog
            conflict={c}
            pending={pending}
            draft={draft}
            onDraft={(d) => setDrafts((all) => ({ ...all, [draftKey]: d }))}
            onClose={() => setPending(null)}
            onConfirm={confirm}
            sending={sender.state === 'sending'}
            failed={failed}
          />
          <AskOwnerDialog about={asking} onClose={() => setAsking(null)} />
        </>
      )}
    </div>
  )
}

/** The view's content for a pair that loaded: the summary, the two items row by row, the other ways. */
function ConflictBody({
  c,
  place,
  wide,
  heading,
  sides,
  setFocusSide,
  held,
  online,
  changed,
  onSeenChange,
  mine,
  admin,
  ownsLabel,
  keep,
  edit,
  open,
  ask,
  isMobile,
  onSettle,
}: {
  c: Conflict
  place: ConflictPlace
  wide: boolean
  heading: React.RefObject<HTMLHeadingElement | null>
  sides: readonly [React.RefObject<HTMLDivElement | null>, React.RefObject<HTMLDivElement | null>]
  setFocusSide: (i: 0 | 1) => void
  held: boolean
  online: boolean
  changed: boolean
  onSeenChange: () => void
  mine: (s: ConflictSide) => boolean
  admin: boolean
  ownsLabel: string[]
  keep: (i: 0 | 1) => void
  edit: (s: ConflictSide) => void
  open: (p: Pending) => void
  ask: (s: ConflictSide) => void
  isMobile: boolean
  onSettle: () => void
}) {
  const [ca, cb] = comparePair(c.holder.summary ?? '', c.other.summary ?? '')
  const off = !online ? 'Off until you are back' : undefined
  const any = Object.values(c.rights).some(Boolean)
  const crossDomain = c.holder.domain !== c.other.domain && !admin && any
  type Col = { s: ConflictSide; other: ConflictSide; c: Compared; i: 0 | 1; label: string }
  const cols: Col[] = [
    { s: c.holder, other: c.other, c: ca, i: 0, label: 'First item' },
    { s: c.other, other: c.holder, c: cb, i: 1, label: 'Second item' },
  ]
  // Across two domains, a side says whose it is.
  const sideLabel = (col: Col) =>
    crossDomain ? (mine(col.s) ? 'Yours' : `Owned by ${col.s.domainName}`) : col.label
  const mayKeep = (col: Col) => (col.i === 0 ? c.rights.keepHolder : c.rights.keepOther)
  const mayEdit = (col: Col) => (col.i === 0 ? c.rights.editHolder : c.rights.editOther)

  const actionsFor = (col: Col) => (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={held || !mayKeep(col)}
          onClick={() => keep(col.i)}
          aria-keyshortcuts={String(col.i + 1)}
          aria-describedby={`keep-hint-${col.i}`}
        >
          <CheckIcon data-icon="inline-start" />
          {off ?? 'Keep this one'}
        </Button>
        {mayEdit(col) ? (
          <Button variant="outline" disabled={held} onClick={() => edit(col.s)}>
            <PencilIcon data-icon="inline-start" />
            Edit this one
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={held}
            onClick={() => open({ how: 'suggest_archive', goes: col.s, stays: col.other })}
          >
            <CheckIcon data-icon="inline-start" />
            Suggest archiving this one
          </Button>
        )}
      </div>
      <p id={`keep-hint-${col.i}`} className="text-xs text-muted-foreground">
        {mayKeep(col)
          ? 'Archives the other one. Asks why first.'
          : `Archives the ${col.other.domainName} item. Only ${ownerNames(col.other)} or an admin can do that.`}
        {!mayEdit(col) && ` Suggest archiving sends it to ${ownerNames(col.s)}, with your reason.`}
      </p>
    </div>
  )

  const rows: { label: string; hidden?: boolean; cell: (col: Col) => React.ReactNode }[] = [
    {
      label: 'It says',
      cell: (col) =>
        col.s.readable ? (
          <Statement c={col.c} />
        ) : (
          <p className="flex items-center gap-2 text-muted-foreground">
            <LockIcon aria-hidden className="size-4" />
            An item you cannot read.
          </p>
        ),
    },
    { label: 'Where it comes from', hidden: true, cell: (col) => <Provenance s={col.s} /> },
    ...(c.said
      ? [
          {
            label: 'If agents got only this one',
            cell: (col: Col) => (
              <SaysBox said={col.i === 0 ? c.said!.onlyHolder : c.said!.onlyOther} />
            ),
          },
        ]
      : []),
    { label: 'What you can do with this one', cell: actionsFor },
  ]

  const sideHeader = (col: Col) => (
    <div
      ref={sides[col.i]}
      tabIndex={-1}
      className="flex flex-col gap-0.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onFocus={() => setFocusSide(col.i)}
    >
      <span className="text-xs text-muted-foreground">{sideLabel(col)}</span>
      <span className="font-semibold text-pretty">{sideTitle(col.s)}</span>
    </div>
  )

  const compare = wide ? (
    <div className="overflow-hidden rounded-frame border">
      <table className="w-full table-fixed text-left">
        <caption className="sr-only">The two items, row by row</caption>
        <thead>
          <tr>
            {cols.map((col) => (
              <th
                key={col.i}
                scope="col"
                className={cn('bg-muted/40 p-4 align-top font-normal', col.i === 1 && 'border-l')}
              >
                {sideHeader(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              {cols.map((col) => (
                <td key={col.i} className={cn('border-t p-4 align-top', col.i === 1 && 'border-l')}>
                  <p className={cn('mb-2 text-xs text-muted-foreground', r.hidden && 'sr-only')}>
                    {r.label}
                  </p>
                  {r.cell(col)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="flex flex-col gap-4">
      {cols.map((col) => (
        <section
          key={col.i}
          aria-label={`${col.label}: ${sideTitle(col.s)}`}
          className="overflow-hidden rounded-frame border"
        >
          <div className="border-b bg-muted/40 p-4">{sideHeader(col)}</div>
          {rows.map((r, i) => (
            <div key={r.label} className={cn('p-4', i > 0 && 'border-t')}>
              <p className={cn('mb-2 text-xs text-muted-foreground', r.hidden && 'sr-only')}>
                {r.label}
              </p>
              {r.cell(col)}
            </div>
          ))}
        </section>
      ))}
    </div>
  )

  const theirs = mine(c.holder) ? c.other : c.holder
  const rightsLine = admin
    ? 'You can do all of this: you are an admin. Anyone else can ask the owner.'
    : crossDomain
      ? null
      : any
        ? `You can do all of this: you own ${c.holder.domainName}, where both live. An admin can too. Anyone else can ask the owner.`
        : `You own neither item, so you can ask the owner. ${ownerNames(c.holder)} or an admin can settle it.`

  return (
    <>
      <header className="flex flex-col gap-2">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <ConflictChip />
          {c.since && (
            <span>
              Since {c.since} - {c.asked} {c.asked === 1 ? 'question' : 'questions'} this week
            </span>
          )}
        </p>
        <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold text-pretty outline-none">
          {titleOf(c)}
        </h2>
        {place === 'page' && (
          <p className="max-w-2xl text-sm text-pretty text-muted-foreground">{sublineOf(c)}</p>
        )}
      </header>

      {c.keptBoth && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-frame border border-dashed p-3 text-sm"
        >
          <LayersIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            <span className="font-medium">
              Kept both: {c.keptBoth.by}, {c.keptBoth.at}.
            </span>{' '}
            <span className="text-muted-foreground">
              Reason: {c.keptBoth.reason} Agents keep saying Conflict. It is off the conflict lists
              until either item changes.
            </span>
          </span>
        </p>
      )}
      {changed && (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-3 rounded-frame border p-4 text-sm"
        >
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-caution-icon" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">One of the two changed while you read.</p>
            <p className="text-muted-foreground">
              The buttons are held until you have seen what changed.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onSeenChange}>
            <EyeIcon data-icon="inline-start" />
            Show what changed
          </Button>
        </div>
      )}

      {c.holder.readable && c.other.readable && <Legend how={ca.how} />}
      {compare}

      <section
        aria-labelledby="other-ways"
        className="flex flex-col gap-3 rounded-frame border p-4"
      >
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="other-ways" className="text-sm font-semibold">
              Or settle it another way
            </h3>
            <p className="text-xs text-muted-foreground">
              Agents keep saying Conflict until one of these changes what they get.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {c.rights.keepBoth && (
              <Button
                variant="outline"
                disabled={held}
                onClick={() => open({ how: 'kept_both' })}
                aria-keyshortcuts="B"
              >
                <LayersIcon data-icon="inline-start" />
                {off ?? 'Keep both'}
              </Button>
            )}
            <Button
              variant="outline"
              disabled={held || !c.rights.notConflict}
              onClick={() => open({ how: 'not_conflict' })}
              aria-keyshortcuts="N"
              aria-describedby={c.rights.notConflict ? undefined : 'not-conflict-why'}
            >
              <SplitIcon data-icon="inline-start" />
              {off ?? 'Not a conflict'}
            </Button>
            <Button variant="ghost" onClick={() => ask(c.other)} aria-keyshortcuts="O">
              <AtSignIcon data-icon="inline-start" />
              Ask the owner
            </Button>
          </div>
        </div>
        {!c.rights.notConflict && (
          <p id="not-conflict-why" className="text-xs text-muted-foreground">
            Not a conflict removes the flag that “{sideTitle(c.holder)}” holds. Only{' '}
            {ownerNames(c.holder)} or an admin can do that.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3 text-sm">
          <span className="text-xs text-muted-foreground">What agents say now</span>
          <ConflictChip />
          <span className="min-w-0 flex-1 text-pretty text-muted-foreground">{SAID_NOW.text}</span>
        </div>
      </section>

      {crossDomain ? (
        <section className="flex flex-wrap items-center gap-3 rounded-frame border p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              You own {ownsLabel.join(' and ')}. {ownerNames(theirs)} {owns(theirs)}{' '}
              {theirs.domainName}.
            </p>
            <p className="text-xs text-muted-foreground">
              You can edit or archive your own item. Anything on the {theirs.domainName} item goes
              to {ownerNames(theirs)} as a suggestion or a question.
            </p>
          </div>
          <Button onClick={() => ask(theirs)}>
            <AtSignIcon data-icon="inline-start" />
            Ask {theirs.owners[0] ?? 'the owner'}
          </Button>
        </section>
      ) : (
        rightsLine && <p className="text-xs text-muted-foreground">{rightsLine}</p>
      )}

      {/* On a phone: two actions at full touch size along the bottom; Settle it opens the six choices. */}
      {isMobile && place === 'page' && (
        <div className="sticky bottom-0 -mx-4 mt-auto flex gap-2 border-t bg-background px-4 pt-2 pb-3">
          <Button variant="outline" className="h-11 flex-1" onClick={() => ask(c.other)}>
            <AtSignIcon data-icon="inline-start" />
            Ask
          </Button>
          <Button className="h-11 flex-1" disabled={held || !any} onClick={onSettle}>
            <SplitIcon data-icon="inline-start" />
            {off ?? 'Settle it'}
          </Button>
        </div>
      )}
    </>
  )
}
