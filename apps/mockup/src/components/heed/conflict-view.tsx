import * as React from "react"
import { AtSignIcon, CheckIcon, ChevronRightIcon, CircleCheckIcon, ExternalLinkIcon, EyeIcon, LockIcon, PencilIcon, SplitIcon, Undo2Icon, LayersIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"
import { PersonAvatar, StateLine } from "@/components/heed/bits"
import { DomainDot } from "@/components/heed/tag-chip"
import { kindIcons } from "@/components/heed/kind-icons"
import { Loadable } from "@/components/heed/load-state"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  askedOf,
  conflictPairs,
  keptBoth,
  ownerNames,
  pairAt,
  rightsOf,
  saidNow,
  saidWithOnly,
  saidWithoutFlag,
  stampOf,
  sublineOf,
  titleOf,
  type ConflictPair,
  type Said,
  type Settled,
  type SettleHow,
} from "@/data/conflicts"
import { domains, kindLabel, ownersOf, type Fact } from "@/data/world"
import { TODAY } from "@/data/history"
import { comparePair, type Compared } from "@/lib/conflict-words"
import { commentActions } from "@/lib/comments"
import { useIsMobile } from "@/hooks/use-mobile"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { useWide } from "@/hooks/use-wide"
import { pageKey } from "@/lib/keys"
import { CONFLICT_KEYS, SIDE_BY_SIDE, type ConflictCommand } from "@/lib/conflict"
import { navigate, useRoute } from "@/lib/router"
import { useOnline, useScenario, useSend } from "@/lib/scenario"
import { useFacts, useMe, useStore, type LogEntry } from "@/lib/store"

// The conflict view: one component, a pair of items, every surface. It reads its own width, so the
// same code is two columns in a 720 dock, the review and a wide page, and one pile per item (same row
// order) in a 480 dock or on a phone. Evidence first: what each says and where it comes from, then
// what agents would say with only that one, then the actions under the thing they act on. The rest of
// the ways to settle it sit below, and every choice asks for a reason and shows what agents will then
// say before it is made. A conflict is declared by a person, so the view never says the texts
// contradict: it shows what each says and who said it.

/* ---------- the parts ---------- */

/** The Conflict chip: a triangle and the word, never colour alone. */
export function ConflictChip({ className }: { className?: string }) {
  return <StateLine state="conflict" className={className} />
}

/** One statement, with the words both share greyed or the words that differ marked, as the app found them. */
export function Statement({ c, className }: { c: Compared; className?: string }) {
  return (
    <p className={cn("text-base leading-7 text-pretty", className)}>
      {c.inBoth.length > 0 && <span className="sr-only">Words in both: {c.inBoth.join("; ")}. </span>}
      {c.runs.map((r, i) =>
        r.shared ? (
          <span key={i} data-shared className="text-muted-foreground">
            {r.text}
          </span>
        ) : r.differs ? (
          <mark key={i} data-mark="differs" className="bg-transparent font-semibold text-inherit underline decoration-[var(--warn)] decoration-2 underline-offset-3">
            <span className="sr-only">[differs: </span>
            {r.text}
            <span className="sr-only">]</span>
          </mark>
        ) : (
          <React.Fragment key={i}>{r.text}</React.Fragment>
        )
      )}
    </p>
  )
}

/** One line that says how to read the marks, or that nothing is marked and why. */
export function Legend({ how, className }: { how: Compared["how"]; className?: string }) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      {how === "shared" ? (
        <>
          <span className="font-semibold">Grey words</span> are in both. The words in full ink are where they part.
        </>
      ) : how === "differs" ? (
        <>
          <span className="font-semibold text-foreground underline decoration-[var(--warn)] decoration-2 underline-offset-3">Underlined words</span> are where
          the two differ.
        </>
      ) : (
        "These are written differently, so no words are marked. Read both and the checked dates."
      )}
    </p>
  )
}

/** What agents say: the state chip and the words, in the quiet box Try it uses. */
export function SaysBox({ said, className }: { said: Said; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-frame border bg-muted/40 p-3", className)}>
      <StateLine state={said.state} tip={false} />
      <p className="text-sm leading-relaxed text-pretty">{said.text}</p>
    </div>
  )
}

const short = (f: Fact) => `${domains[f.domain].name}, checked ${f.checkedOn}`
const sourceShort = (f: Fact) => f.source.replace("https://", "")

/** Where an item comes from: domain and kind, owners, the check, the source and its quoted line. */
function Provenance({ f }: { f: Fact }) {
  const KindIcon = kindIcons[f.kind]
  const owners = ownersOf(f)
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 font-medium">
          <DomainDot id={f.domain} />
          {domains[f.domain].name}
        </span>
        <span className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">
          <KindIcon aria-hidden className="size-3" />
          {kindLabel[f.kind]}
        </span>
      </p>
      <p className="flex items-center gap-2">
        <span className="flex -space-x-1" aria-hidden>
          {owners.map((o) => (
            <PersonAvatar key={o} name={o} size={20} className="ring-2 ring-background" />
          ))}
        </span>
        <span>owned by {ownerNames(f)}</span>
      </p>
      <p className="text-muted-foreground">
        Checked {f.checkedOn}
        {f.checkedBy && <>, by {f.checkedBy}</>}
      </p>
      {f.source && (
        <a
          href={f.source}
          target="_blank"
          rel="noreferrer"
          className="flex w-fit max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium break-all text-primary underline-offset-4 hover:underline"
        >
          <ExternalLinkIcon aria-hidden className="size-3 shrink-0" />
          {sourceShort(f)}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
      {f.quote && <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground italic">“{f.quote}”</blockquote>}
    </div>
  )
}

/* ---------- the compact form: the gate, Ask, the Inbox card, the item page ---------- */

/**
 * The pair in a few lines: each item's title, what it says (marked the same way as the full view),
 * its domain, check date and source. Two columns when it fits, else one above the other.
 */
export function ConflictPairCompact({ pair, label, className }: { pair: ConflictPair; label?: React.ReactNode; className?: string }) {
  const [ref, wide] = useWide<HTMLDivElement>(SIDE_BY_SIDE)
  const [a, b] = comparePair(pair.holder.summary, pair.other.summary)
  const side = (f: Fact, c: Compared) => (
    <div className="flex min-w-0 flex-col gap-1.5 p-3 sm:p-4">
      <p className="text-sm font-semibold">{f.title}</p>
      <Statement c={c} className="text-sm leading-6" />
      <p className="text-xs text-muted-foreground">
        {short(f)}
        {f.source && <span className="break-all">, {sourceShort(f)}</span>}
      </p>
    </div>
  )
  return (
    <div ref={ref} className={cn("overflow-hidden rounded-frame border", className)}>
      {label && <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium sm:px-4">{label}</div>}
      <div className={cn("grid", wide ? "grid-cols-2 divide-x" : "grid-cols-1 divide-y")} role="group" aria-label="The two items">
        {side(pair.holder, a)}
        {side(pair.other, b)}
      </div>
    </div>
  )
}

/* ---------- the reason box ---------- */

type Pending = { how: "keep"; keep: Fact; other: Fact } | { how: "both" } | { how: "unrelated" }

function dialogCopy(p: Pending, pair: ConflictPair) {
  if (p.how === "keep")
    return {
      title: `Keep “${p.keep.title}”`,
      description: `Agents stop getting “${p.other.title}”. You can undo this for 6 seconds.`,
      reason: "Why does this one stay?",
      empty: "Add a reason to keep this one.",
      confirm: "Keep this one",
      then: saidWithOnly(p.keep),
      told: `${ownerNames(p.other)}, who own${ownersOf(p.other).length > 1 ? "" : "s"} “${p.other.title}”, ${ownersOf(p.other).length > 1 ? "are" : "is"} told.`,
    }
  if (p.how === "both")
    return {
      title: "Keep both",
      description: "Agents keep saying Conflict until one of these changes what they get. The pair leaves the conflict lists until then.",
      reason: "Why do both stay?",
      empty: "Add a reason to keep both.",
      confirm: "Keep both",
      then: saidNow,
      told: `The other owners of the two items are told.`,
    }
  return {
    title: "Not a conflict",
    description: `Removes the Conflict flag from “${pair.holder.title}”. Agents then give both and say nothing about a difference.`,
    reason: "Why is this not a conflict?",
    empty: "Add a reason to remove the flag.",
    confirm: "Not a conflict",
    then: saidWithoutFlag(pair),
    told: `${ownerNames(pair.other)}, who own${ownersOf(pair.other).length > 1 ? "" : "s"} “${pair.other.title}”, ${ownersOf(pair.other).length > 1 ? "are" : "is"} told.`,
  }
}

type Draft = { reason: string; quote: string }

function SettleDialog({
  pair,
  pending,
  draft,
  onDraft,
  onClose,
  onConfirm,
  sending,
  failed,
}: {
  pair: ConflictPair
  pending: Pending | null
  draft: Draft
  onDraft: (d: Draft) => void
  onClose: () => void
  onConfirm: () => void
  sending: boolean
  failed: boolean
}) {
  const copy = pending ? dialogCopy(pending, pair) : null
  const ready = draft.reason.trim().length > 0
  const id = React.useId()
  return (
    <Dialog open={!!pending} onOpenChange={(open) => !open && onClose()}>
      {copy && (
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) {
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
            <div role="alert" className="flex items-start gap-2 rounded-frame border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>
                <span className="font-medium">{`Could not ${copy.confirm.toLowerCase()}. Nothing changed.`}</span>{" "}
                <span className="text-muted-foreground">Your reason and the line are kept in the box.</span>
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-quote`}>
              A line that settles it <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id={`${id}-quote`} value={draft.quote} onChange={(e) => onDraft({ ...draft, quote: e.target.value })} placeholder="Quote the source, word for word" />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">Agents will then say</p>
            <SaysBox said={copy.then} />
          </div>
          <p className="text-xs text-muted-foreground">
            {copy.told} Your reason and the line are kept on both items.
          </p>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={onConfirm} disabled={!ready || sending} aria-keyshortcuts="Meta+Enter">
              <CheckIcon data-icon="inline-start" />
              {sending ? "Saving…" : copy.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}

/* ---------- ask the owner ---------- */

function AskOwnerDialog({ about, open, onOpenChange }: { about: Fact | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const me = useMe()
  const [text, setText] = React.useState("")
  const owner = about ? (ownersOf(about).find((o) => o !== me.name) ?? ownersOf(about)[0]) : ""
  const id = React.useId()
  if (!about) return null
  const send = () => {
    commentActions.post(`context:${about.id}`, me.name, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: `person:${owner}`, label: owner } }, { type: "text", text: ` ${text.trim()}` }] }],
    })
    onOpenChange(false)
    setText("")
    toast(`Asked ${owner}`, { description: `A comment on “${about.title}”, and a card in their Inbox.` })
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ask {owner}</DialogTitle>
          <DialogDescription>
            A comment on “{about.title}” that mentions {owner}. It also lands in their Inbox.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id}>Your question</Label>
          <Textarea id={id} autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Which one should agents get?" />
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={send} disabled={!text.trim()}>
            <AtSignIcon data-icon="inline-start" />
            Ask {owner}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- the outcome ---------- */

type Done = { pair: ConflictPair; settled: Settled; before: ReturnType<typeof useStore>["state"]; entry: string }

function outcomeOf(d: Done): { chip: string; line: string; now: Said } {
  const { pair, settled } = d
  if (settled.how === "keep") {
    const kept = settled.kept === pair.holder.id ? pair.holder : pair.other
    const gone = kept === pair.holder ? pair.other : pair.holder
    return { chip: "Settled", line: `Kept “${kept.title}”. Archived “${gone.title}”.`, now: saidWithOnly(kept) }
  }
  if (settled.how === "both") return { chip: "Kept both", line: "Kept both. Agents keep saying Conflict until one of these changes what they get.", now: saidNow }
  return { chip: "Settled", line: `Not a conflict. The flag is removed from “${pair.holder.title}”.`, now: saidWithoutFlag(pair) }
}

function Outcome({ done, next, onUndo, onNext }: { done: Done; next?: ConflictPair; onUndo: () => void; onNext: () => void }) {
  const reduced = useReducedMotion()
  const [held, setHeld] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const o = outcomeOf(done)
  const asked = askedOf(done.pair)
  React.useEffect(() => ref.current?.focus(), [])
  // A letter key moves on at once; the pointer or focus on it holds the wait; reduced motion waits for Next.
  React.useEffect(() => {
    if (!next) return
    const onKey = (e: KeyboardEvent) => {
      if (pageKey(e) && /^[a-z]$/i.test(e.key) && e.key.toLowerCase() !== "u") onNext()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [next, onNext])
  return (
    <div className="flex flex-col gap-4">
      <div
        ref={ref}
        tabIndex={-1}
        role="status"
        onPointerEnter={() => setHeld(true)}
        onPointerLeave={() => setHeld(false)}
        className="flex flex-col gap-3 rounded-frame border border-l-4 border-l-primary p-4 outline-none animate-in duration-(--dur-4) fade-in-0 slide-in-from-bottom-1 sm:p-5"
      >
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="value-changed flex items-center gap-1.5 rounded-md bg-primary/8 px-2 py-1 font-semibold">
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
          {done.settled.by}, today, {done.settled.at}. Reason: {done.settled.reason}
          {done.settled.quote && <> “{done.settled.quote}”</>}
        </p>
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">Agents now say</p>
          <SaysBox said={o.now} />
        </div>
        {next && !reduced && (
          <>
            <span aria-hidden className="h-0.5 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full origin-left animate-[countdown_6s_linear_forwards] bg-primary"
                style={{ animationPlayState: held ? "paused" : "running" }}
                onAnimationEnd={onNext}
              />
            </span>
            <p className="text-xs text-muted-foreground">Next conflict in a moment. Hover over this to stay here.</p>
          </>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-frame border p-4 text-sm">
        <span className="min-w-0 flex-1 text-pretty">
          {done.pair.topic} had {asked.asked} questions this week with a Conflict.
          {next ? ` Next: ${next.topic}, ${askedOf(next).asked} questions.` : " Nothing else disagrees."}
        </span>
        {next ? (
          <Button variant="outline" size="sm" onClick={onNext}>
            <ChevronRightIcon data-icon="inline-start" />
            Next conflict
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => navigate("/context/conflicts")}>
            All conflicts
          </Button>
        )}
      </p>
    </div>
  )
}

/* ---------- the view ---------- */

export type ConflictPlace = "page" | "dock"

/**
 * The whole view for the pair at `pairKey`. `onStep` moves to the next or previous conflict of the
 * list it was opened from; the page binds J and K to it, the dock its up and down buttons.
 */
export function ConflictView({ pairKey, place, onStep }: { pairKey: string; place: ConflictPlace; onStep?: (to: ConflictPair) => void }) {
  const facts = useFacts()
  const me = useMe()
  const { state, dispatch } = useStore()
  const { query } = useRoute()
  const scenario = useScenario()
  const online = useOnline()
  const sender = useSend()
  const isMobile = useIsMobile()
  const [measure, wide] = useWide<HTMLDivElement>(SIDE_BY_SIDE)
  const root = React.useRef<HTMLDivElement | null>(null)
  const ref = (el: HTMLDivElement | null) => {
    measure(el)
    root.current = el
  }
  const [pending, setPending] = React.useState<Pending | null>(null)
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({})
  const [asking, setAsking] = React.useState<Fact | null>(null)
  const [settling, setSettling] = React.useState(false)
  const [done, setDone] = React.useState<Done | null>(null)
  const [focusSide, setFocusSide] = React.useState<0 | 1>(0)
  const [seenChange, setSeenChange] = React.useState(false)
  // ?state=refused: the first decision fails, so the failure and the kept reason can be seen.
  const [refused, setRefused] = React.useState(false)
  const refuses = query.get("state") === "refused" && !refused
  const heading = React.useRef<HTMLHeadingElement>(null)
  const sides = [React.useRef<HTMLDivElement>(null), React.useRef<HTMLDivElement>(null)]

  const pair = pairAt(facts, pairKey)
  const all = conflictPairs(facts).filter((p) => !keptBoth(p, state.settled[p.key]))
  const at = pair ? all.findIndex((p) => p.key === pair.key) : -1
  const next = done ? all.find((p) => p.key !== done.pair.key) : at >= 0 ? all[at + 1] : undefined
  const prev = at > 0 ? all[at - 1] : undefined

  // Focus moves to the view's heading when it opens or the pair changes.
  React.useEffect(() => heading.current?.focus({ preventScroll: true }), [pairKey])

  const changed = query.get("state") === "changed" && !seenChange
  const held = changed || !online || sender.state === "sending"
  const rights = pair ? rightsOf(me, pair) : null
  const draftKey = pending ? (pending.how === "keep" ? `keep.${pending.keep.id}` : pending.how) : ""
  const draft = drafts[draftKey] ?? { reason: "", quote: "" }

  const open = (p: Pending) => {
    if (held) return
    sender.reset()
    setPending(p)
  }
  const keep = (i: 0 | 1) => {
    if (!pair || !rights) return
    const [k, o] = i === 0 ? [pair.holder, pair.other] : [pair.other, pair.holder]
    if (rights.keep(k, o)) open({ how: "keep", keep: k, other: o })
  }
  const edit = (f: Fact) => {
    if (!pair || held) return
    const other = f.id === pair.holder.id ? pair.other : pair.holder
    navigate(`/context/${f.id}/${rights?.edit(f) ? "edit" : "suggest"}`, { beside: other.id })
  }

  const confirm = () => {
    if (!pair || !pending || !draft.reason.trim()) return
    if (refuses) return setRefused(true)
    sender.send(() => {
      const before = state
      const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      const how: SettleHow = pending.how
      const settled: Settled = {
        how,
        reason: draft.reason.trim(),
        quote: draft.quote.trim() || undefined,
        by: me.name,
        at: time,
        ...(pending.how === "keep" ? { kept: pending.keep.id, archived: pending.other.id } : {}),
        ...(pending.how === "both" ? { seen: { [pair.holder.id]: stampOf(pair.holder), [pair.other.id]: stampOf(pair.other) } } : {}),
      }
      const patches: Record<string, Partial<Fact>> =
        pending.how === "keep"
          ? { [pending.other.id]: { status: "Archived" } }
          : pending.how === "unrelated"
            ? // The link comes off whichever side holds it; both may.
              Object.fromEntries([pair.holder, pair.other].filter((f) => f.disagreesWith).map((f) => [f.id, { disagreesWith: undefined }]))
            : {}
      const summary =
        pending.how === "keep"
          ? `Conflict settled: kept “${pending.keep.title}”, archived “${pending.other.title}”. Reason: ${settled.reason}`
          : pending.how === "both"
            ? `Conflict kept: both stay, agents keep saying Conflict. Reason: ${settled.reason}`
            : `Not a conflict: the flag is removed. Reason: ${settled.reason}`
      const entry: LogEntry = {
        id: `log-settled-${pair.key}-${Date.now()}`,
        on: TODAY,
        who: me.name,
        what: "settled",
        summary,
        items: [pair.holder, pair.other].map((f) => ({ id: f.id, title: f.title, domain: f.domain })),
      }
      dispatch({ type: "settle", key: pair.key, settled, patches, entry })
      setDrafts((d) => ({ ...d, [draftKey]: { reason: "", quote: "" } }))
      setPending(null)
      const d: Done = { pair, settled, before, entry: entry.id }
      setDone(d)
      const undo = () => {
        dispatch({ type: "revert", before, cards: [], facts: [pair.holder.id, pair.other.id], entry: entry.id, pairs: [pair.key] })
        setDone(null)
        toast("Undone", { description: "Both items are as they were." })
      }
      toast(how === "keep" ? "Kept one, archived the other" : how === "both" ? "Kept both" : "Not a conflict", {
        description: "You can undo this for 6 seconds.",
        duration: 6000,
        action: { label: "Undo", onClick: undo },
      })
    })
  }

  const undoDone = () => {
    if (!done) return
    dispatch({ type: "revert", before: done.before, cards: [], facts: [done.pair.holder.id, done.pair.other.id], entry: done.entry, pairs: [done.pair.key] })
    setDone(null)
  }
  const goNext = React.useCallback(() => {
    if (!next) return
    setDone(null)
    onStep?.(next)
  }, [next, onStep])

  // The Conflict scope: single keys while nobody is typing. A digit, B or N only opens a box that needs
  // a reason, so a slip never archives anything.
  React.useEffect(() => {
    if (!pair || done) return
    const onKey = (e: KeyboardEvent) => {
      if (!pageKey(e) || pending || asking) return
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      // J and K step through the list it was opened from: on the page, and in the dock while focus is in it.
      const stepping = place === "page" || !!root.current?.contains(e.target as Node)
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
        edit: () => edit(focusSide === 0 ? pair.holder : pair.other),
        both: rights?.both ? () => open({ how: "both" }) : undefined,
        notConflict: rights?.notConflict ? () => open({ how: "unrelated" }) : undefined,
        ask: () => setAsking(pair.other),
        next: stepping && next ? () => onStep?.(next) : undefined,
        previous: stepping && prev ? () => onStep?.(prev) : undefined,
      }
      const command = CONFLICT_KEYS.find((x) => x.key === k)?.command
      const fn = command && run[command]
      if (!fn) return
      e.preventDefault()
      fn()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const skeleton = (
    <div className="flex flex-col gap-4" aria-hidden>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-7 w-2/3" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-frame border">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-3 p-4">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ))}
      </div>
    </div>
  )

  if (done) return <Outcome done={done} next={next} onUndo={undoDone} onNext={goNext} />

  if (!pair) {
    const s = state.settled[pairKey] ?? Object.entries(state.settled).find(([k]) => k.split(".").sort().join(".") === pairKey.split(".").sort().join("."))?.[1]
    return (
      <div role="status" className="flex items-start gap-3 rounded-frame border border-l-4 border-l-primary p-4 text-sm">
        <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-medium">{s ? `${s.by} settled this at ${s.at}.` : "These two no longer disagree."}</p>
          <p className="text-muted-foreground">There is nothing left to decide.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate("/context/conflicts")}>
          All conflicts
        </Button>
      </div>
    )
  }

  const [ca, cb] = comparePair(pair.holder.summary, pair.other.summary)
  const asked = askedOf(pair)
  const kept = state.settled[pair.key]
  const both = keptBoth(pair, kept) ? kept : undefined
  const settledElsewhere = scenario === null && query.get("state") === "settled"
  const off = !online ? "Off until you are back" : undefined
  const sideCols: { f: Fact; other: Fact; c: Compared; i: 0 | 1; label: string }[] = [
    { f: pair.holder, other: pair.other, c: ca, i: 0, label: "First item" },
    { f: pair.other, other: pair.holder, c: cb, i: 1, label: "Second item" },
  ]
  const mine = (f: Fact) => me.owns.includes(f.domain) || ownersOf(f).includes(me.name)
  // Across two domains, a side says whose it is.
  const sideLabel = (s: (typeof sideCols)[number]) =>
    pair.holder.domain !== pair.other.domain && !me.admin ? (mine(s.f) ? "Yours" : `Owned by ${domains[s.f.domain].name}`) : s.label

  const keepButton = (s: (typeof sideCols)[number]) => {
    const can = rights!.keep(s.f, s.other)
    return (
      <Button variant="outline" disabled={held || !can} onClick={() => keep(s.i)} aria-keyshortcuts={String(s.i + 1)} aria-describedby={`keep-hint-${s.i}`}>
        <CheckIcon data-icon="inline-start" />
        {off ?? "Keep this one"}
      </Button>
    )
  }
  const keepHint = (s: (typeof sideCols)[number]) =>
    rights!.keep(s.f, s.other)
      ? "Archives the other one. Asks why first."
      : `Archives the ${domains[s.other.domain].name} item. Only ${ownerNames(s.other)} or an admin can do that.`

  const actionsFor = (s: (typeof sideCols)[number]) => (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2 pointer-coarse:*:h-11">
        {keepButton(s)}
        {rights!.edit(s.f) ? (
          <Button variant="outline" disabled={held} onClick={() => edit(s.f)}>
            <PencilIcon data-icon="inline-start" />
            Edit this one
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={held}
            onClick={() => {
              toast(`Suggested archiving “${s.f.title}”`, { description: `${ownerNames(s.f)} get${ownersOf(s.f).length > 1 ? "" : "s"} it in their Inbox, with your reason.` })
            }}
          >
            <CheckIcon data-icon="inline-start" />
            Suggest archiving this one
          </Button>
        )}
      </div>
      <p id={`keep-hint-${s.i}`} className="text-xs text-muted-foreground">
        {keepHint(s)}
        {!rights!.edit(s.f) && ` Suggest archiving sends it to ${ownerNames(s.f)}, with your reason.`}
      </p>
    </div>
  )

  const rows: { label: string; cell: (s: (typeof sideCols)[number]) => React.ReactNode }[] = [
    { label: "It says", cell: (s) => <Statement c={s.c} /> },
    { label: "Where it comes from", cell: (s) => <Provenance f={s.f} /> },
    { label: "If agents got only this one", cell: (s) => <SaysBox said={saidWithOnly(s.f)} /> },
    { label: "What you can do with this one", cell: actionsFor },
  ]

  const sideHeader = (s: (typeof sideCols)[number]) => (
    <div
      ref={sides[s.i]}
      tabIndex={-1}
      className="-m-1 flex flex-col gap-0.5 rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onFocus={() => setFocusSide(s.i)}
    >
      <span className="text-xs text-muted-foreground">{sideLabel(s)}</span>
      <span className="font-semibold text-pretty">{s.f.title}</span>
    </div>
  )

  const compare = wide ? (
    <table className="w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-frame border text-left">
      <caption className="sr-only">The two items, row by row</caption>
      <thead>
        <tr>
          {sideCols.map((s) => (
            <th key={s.i} scope="col" className={cn("bg-muted/40 p-4 align-top font-normal", s.i === 1 && "border-l")}>
              {sideHeader(s)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            {sideCols.map((s) => (
              <td key={s.i} className={cn("border-t p-4 align-top", s.i === 1 && "border-l")}>
                <p className={cn("mb-2 text-xs text-muted-foreground", r.label === "Where it comes from" && "sr-only")}>{r.label}</p>
                {r.cell(s)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <div className="flex flex-col gap-4">
      {sideCols.map((s) => (
        <section key={s.i} aria-label={`${s.label}: ${s.f.title}`} className="overflow-hidden rounded-frame border">
          <div className="border-b bg-muted/40 p-4">{sideHeader(s)}</div>
          {rows.map((r) => (
            <div key={r.label} className="border-t p-4 first-of-type:border-t-0">
              <p className={cn("mb-2 text-xs text-muted-foreground", r.label === "Where it comes from" && "sr-only")}>{r.label}</p>
              {r.cell(s)}
            </div>
          ))}
        </section>
      ))}
    </div>
  )

  const otherWays = (
    <section aria-labelledby="other-ways" className="flex flex-col gap-3 rounded-frame border p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-60">
          <h3 id="other-ways" className="text-sm font-semibold">
            Or settle it another way
          </h3>
          <p className="text-xs text-muted-foreground">Agents keep saying Conflict until one of these changes what they get.</p>
        </div>
        <div className="flex flex-wrap gap-2 pointer-coarse:*:h-11">
          {rights!.both && (
            <Button variant="outline" disabled={held} onClick={() => open({ how: "both" })} aria-keyshortcuts="B">
              <LayersIcon data-icon="inline-start" />
              {off ?? "Keep both"}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={held || !rights!.notConflict}
            onClick={() => open({ how: "unrelated" })}
            aria-keyshortcuts="N"
            aria-describedby={rights!.notConflict ? undefined : "not-conflict-why"}
          >
            <SplitIcon data-icon="inline-start" />
            {off ?? "Not a conflict"}
          </Button>
          <Button variant="ghost" onClick={() => setAsking(pair.other)} aria-keyshortcuts="O">
            <AtSignIcon data-icon="inline-start" />
            Ask the owner
          </Button>
        </div>
      </div>
      {!rights!.notConflict && (
        <p id="not-conflict-why" className="text-xs text-muted-foreground">
          Not a conflict removes the flag that “{pair.holder.title}” holds. Only {ownerNames(pair.holder)} or an admin can do that.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3 text-sm">
        <span className="text-xs text-muted-foreground">What agents say now</span>
        <ConflictChip />
        <span className="min-w-0 flex-1 basis-60 text-pretty text-muted-foreground">{saidNow.text}</span>
      </div>
    </section>
  )

  const crossDomain = pair.holder.domain !== pair.other.domain && !me.admin && rights!.any
  const theirs = mine(pair.holder) ? pair.other : pair.holder
  const rightsLine = me.admin
    ? "You can do all of this: you are an admin. Anyone else can ask the owner."
    : crossDomain
      ? null
      : rights!.any
        ? `You can do all of this: you own ${domains[pair.holder.domain].name}, where both live. An admin can too. Anyone else can ask the owner.`
        : `You own neither item, so you can ask the owner. ${ownerNames(pair.holder)} or an admin can settle it.`

  return (
    <div ref={ref} className="flex flex-col gap-5">
      <Loadable what="the two items" skeleton={skeleton}>
        <header className="flex flex-col gap-2">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <ConflictChip />
            <span>
              Since {asked.since} - {asked.asked} questions this week
            </span>
          </p>
          <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold text-pretty outline-none">
            {titleOf(pair)}
          </h2>
          {place === "page" && <p className="max-w-prose text-sm text-muted-foreground text-pretty">{sublineOf(pair)}</p>}
        </header>

        {both && (
          <p role="status" className="flex items-start gap-2 rounded-frame border border-dashed p-3 text-sm">
            <LayersIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              <span className="font-medium">Kept both: {both.by}, today, {both.at}.</span> <span className="text-muted-foreground">Reason: {both.reason} Agents keep saying Conflict. It is off the conflict lists until either item changes.</span>
            </span>
          </p>
        )}
        {changed && (
          <div role="alert" className="flex flex-wrap items-start gap-3 rounded-frame border border-l-4 border-l-[var(--warn)] p-4 text-sm">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--warn)]" />
            <div className="min-w-0 flex-1 basis-60">
              <p className="font-medium">Sofia Brandt edited “{pair.holder.title}” at 10:12.</p>
              <p className="text-muted-foreground">The buttons are held until you have seen what changed.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setSeenChange(true)}>
              <EyeIcon data-icon="inline-start" />
              Show what changed
            </Button>
          </div>
        )}
        {settledElsewhere && (
          <div role="status" className="flex flex-wrap items-start gap-3 rounded-frame border border-l-4 border-l-primary p-4 text-sm">
            <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 basis-60">
              <p className="font-medium">Ines Duarte archived “{pair.holder.title}” at 10:12.</p>
              <p className="text-muted-foreground">Agents now say Checked for {pair.topic}. There is nothing left to decide.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate(`/context/${pair.other.id}`)}>
              Open the item
            </Button>
          </div>
        )}

        <Legend how={ca.how} />
        {compare}
        {otherWays}
        {crossDomain ? (
          <section className="flex flex-wrap items-center gap-3 rounded-frame border p-4">
            <div className="min-w-0 flex-1 basis-60">
              <p className="text-sm font-semibold">
                You own {me.owns.map((d) => domains[d].name).join(" and ")}. {ownerNames(theirs)} own{ownersOf(theirs).length > 1 ? "" : "s"} {domains[theirs.domain].name}.
              </p>
              <p className="text-xs text-muted-foreground">
                You can edit or archive your own item. Anything on the {domains[theirs.domain].name} item goes to {ownerNames(theirs)} as a suggestion or a question.
              </p>
            </div>
            <Button onClick={() => setAsking(theirs)}>
              <AtSignIcon data-icon="inline-start" />
              Ask {ownersOf(theirs)[0]}
            </Button>
          </section>
        ) : (
          rightsLine && <p className="text-xs text-muted-foreground">{rightsLine}</p>
        )}
        {crossDomain && (
          <p className="flex items-center gap-2 rounded-frame border p-3 text-sm text-muted-foreground">
            <LockIcon aria-hidden className="size-4 shrink-0" />
            Someone who cannot read an item sees “An item you cannot read”, with its domain and owner, and no text.
          </p>
        )}
      </Loadable>

      {/* On a phone: two actions at full touch size along the bottom; Settle it opens the six choices. */}
      {isMobile && place === "page" && (
        <div className="sticky bottom-0 -mx-4 mt-auto flex gap-2 border-t bg-background px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] *:h-11 *:flex-1">
          <Button variant="outline" onClick={() => setAsking(pair.other)}>
            <AtSignIcon data-icon="inline-start" />
            Ask
          </Button>
          <Button disabled={held || !rights!.any} onClick={() => setSettling(true)}>
            <SplitIcon data-icon="inline-start" />
            {off ?? "Settle it"}
          </Button>
        </div>
      )}
      <Sheet open={settling} onOpenChange={setSettling}>
        <SheetContent side="bottom" className="gap-0 pb-[env(safe-area-inset-bottom)]">
          <SheetHeader>
            <SheetTitle>Settle it</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col pb-2">
            {[
              { label: `Keep “${pair.holder.title}”`, can: rights!.keep(pair.holder, pair.other), run: () => keep(0) },
              { label: `Keep “${pair.other.title}”`, can: rights!.keep(pair.other, pair.holder), run: () => keep(1) },
              { label: "Edit one of them", can: rights!.edit(pair.holder) || rights!.edit(pair.other), run: () => edit(rights!.edit(pair.holder) ? pair.holder : pair.other) },
              { label: "Keep both", can: rights!.both, run: () => open({ how: "both" }) },
              { label: "Not a conflict", can: rights!.notConflict, run: () => open({ how: "unrelated" }) },
              { label: "Ask the owner", can: true, run: () => setAsking(pair.other) },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                disabled={!o.can}
                className="flex min-h-13 items-center border-t px-4 text-left text-sm font-medium disabled:text-muted-foreground"
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
        pair={pair}
        pending={pending}
        draft={draft}
        onDraft={(d) => setDrafts((all) => ({ ...all, [draftKey]: d }))}
        onClose={() => setPending(null)}
        onConfirm={confirm}
        sending={sender.state === "sending"}
        failed={sender.state === "failed" || (refused && sender.state === "idle" && query.get("state") === "refused")}
      />
      <AskOwnerDialog about={asking} open={!!asking} onOpenChange={(o) => !o && setAsking(null)} />
    </div>
  )
}
