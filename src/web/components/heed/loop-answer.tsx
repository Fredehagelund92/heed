import * as React from 'react'
import type { LoopBlock, LoopItem, LoopOverview, LoopTurn } from '@contract/answer'
import type { LucideIcon } from '@/components/icons'
import {
  ItemRow,
  NounChip,
  Runs,
  dayText,
  statusWords,
  PartsContext,
  useParts,
  type LoopParts,
  type Nouns,
} from '@/components/heed/loop-nouns'
import type { Answer, QuestionPart } from '@/model/ask'
import type { Turn } from '@/model/ask-turn'
import type { Fact } from '@/model/items'

/*
  An answer of Ask's loop, as direction C draws it (FR-349, FR-718 to FR-720): the state and its
  fixed sentence on one line, the answer in one to three sentences with its nouns as chips, then
  the evidence code wrote from the reads in a fixed order (what disagrees, what was used, the
  closest written, who owns it), the next step, and one footer line that opens What Ask read.
  An overview is its groups. Everything but the model's own sentences is the service's, from the
  reads; this only draws it, and nothing here knows a dimension, a domain or a person by name.
*/

/** The most rows of the closest written shown before Show more. */
const CLOSEST_SHOWN = 4
/** The most rows of an overview's group shown before Show all. */
const GROUP_SHOWN = 4

type Props = {
  turn: Turn
  docked?: boolean
  onRetry?: () => void
  onAsk?: (question: string) => void
  latest?: boolean
}

/** The turn's nouns by id, and its items by their number as sources. */
function useMaps(loop: LoopTurn) {
  return React.useMemo(() => {
    const nouns: Nouns = new Map(loop.nouns.map((n) => [n.id, n]))
    const byId = new Map(loop.items.map((i) => [i.id, i]))
    const numbered = new Map<number, LoopItem>()
    loop.sources.forEach((id, i) => {
      const item = byId.get(id)
      if (item) numbered.set(i + 1, { ...item, n: i + 1 })
    })
    return { nouns, byId, numbered }
  }, [loop])
}

/* ---------- while it reads ---------- */

/** Each read as a step, the one under way moving; Stop and Escape stop it (the chat's own). */
export function LoopProgress({ turn }: { turn: Turn }) {
  const P = useParts()
  const reads = turn.reads
  const nouns: Nouns = React.useMemo(
    () => new Map((reads?.nouns ?? []).map((n) => [n.id, n])),
    [reads],
  )
  const steps = reads?.steps ?? []
  const done = steps.length > 0 && steps.every((s) => s.done)
  return (
    <ol className="flex flex-col gap-1.5 text-sm text-muted-foreground" aria-live="polite">
      {steps.map((s, i) => (
        <li key={i} className="flex items-center gap-2">
          {s.done ? (
            <P.CheckIcon aria-hidden className="size-4 shrink-0 text-primary" />
          ) : (
            <span aria-hidden className="size-4 shrink-0" />
          )}
          {s.done ? (
            <span>
              <Runs runs={s.runs} nouns={nouns} items={new Map()} />
            </span>
          ) : (
            <P.ReadingLine running={!turn.stopped}>
              <Runs runs={s.runs} nouns={nouns} items={new Map()} />
            </P.ReadingLine>
          )}
        </li>
      ))}
      {(done || !steps.length) && (
        <li className="flex items-center gap-2">
          <span aria-hidden className="size-4 shrink-0" />
          <P.ReadingLine running={!turn.stopped}>
            {turn.stopped
              ? 'Stopped while reading'
              : done
                ? 'Writing the answer…'
                : (turn.working ?? 'Reading…')}
          </P.ReadingLine>
        </li>
      )}
    </ol>
  )
}

/* ---------- under the question ---------- */

/**
 * How the question was read, under it: its nouns as chips and its days, and Change, which puts the
 * question back in the box with them; a follow-up says what it carried from the last question.
 */
/** How the question was read, under it, with Ask's parts (loop-parts.ts). */
export function LoopReadLine({
  parts,
  ...props
}: { parts: LoopParts } & React.ComponentProps<typeof ReadLine>) {
  return (
    <PartsContext.Provider value={parts}>
      <ReadLine {...props} />
    </PartsContext.Provider>
  )
}

function ReadLine({
  answer,
  onRescope,
}: {
  answer: Answer
  onRescope?: (parts: QuestionPart[]) => void
}) {
  const P = useParts()
  const loop = answer.loop!
  const subject = loop.subject
  const nouns: Nouns = React.useMemo(() => new Map(loop.nouns.map((n) => [n.id, n])), [loop])
  if (!subject || (!subject.about.length && subject.assumedToday)) return null
  const about = subject.about.filter((id) => nouns.has(id))
  return (
    <p className="flex max-w-22/25 flex-wrap items-center justify-end gap-x-1.5 gap-y-1 text-right text-xs text-muted-foreground @lg:max-w-4/5">
      <span>{subject.carried ? 'Read with' : 'Read as'}</span>
      {about.map((id, i) => (
        <span key={id} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {i > 0 && <span aria-hidden>·</span>}
          <NounChip id={id} nouns={nouns} />
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        {about.length > 0 && <span aria-hidden>·</span>}
        <span className="inline-flex items-center rounded-sm bg-muted px-1.5 py-px font-medium text-foreground">
          {subject.assumedToday ? 'Today · assumed' : subject.period}
        </span>
      </span>
      {subject.carried && <span>carried from your last question</span>}
      {onRescope && (
        <button
          type="button"
          className="rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() =>
            onRescope([
              `${P.askedOf(answer)} `,
              ...about.flatMap((id) => {
                const label = nouns.get(id)?.name ?? id
                return [{ id: mentionOf(id, label), label }, ' ']
              }),
            ])
          }
        >
          {subject.carried ? 'Drop them' : 'Change'}
        </button>
      )}
    </p>
  )
}

/**
 * A noun's id as the composer's mention (src/web/lib/mentions.ts): a definition and a person by
 * name, a value and a domain by key, as the editor stores them.
 */
const mentionOf = (id: string, name: string) =>
  id.startsWith('metric:') || id.startsWith('dimension:') || id.startsWith('person:')
    ? `${id.slice(0, id.indexOf(':'))}:${name}`
    : id

/* ---------- the answer ---------- */

/** The words as blocks: paragraphs, the model's short lists, and the lists of reads as rows. */
function Body({
  body,
  nouns,
  numbered,
  byId,
  seen,
}: {
  body: readonly LoopBlock[]
  nouns: Nouns
  numbered: ReadonlyMap<number, LoopItem>
  byId: ReadonlyMap<string, LoopItem>
  seen: Set<string>
}) {
  return (
    <div data-answer-words className="flex max-w-reading flex-col gap-3 text-base leading-chat">
      {body.map((b, i) =>
        b.t === 'p' ? (
          <p key={i}>
            <Runs runs={b.runs} nouns={nouns} items={numbered} seen={seen} />
          </p>
        ) : b.t === 'ul' ? (
          <ul key={i} className="ml-6 list-disc space-y-1.5 marker:text-muted-foreground">
            {b.items.map((runs, j) => (
              <li key={j}>
                <Runs runs={runs} nouns={nouns} items={numbered} seen={seen} />
              </li>
            ))}
          </ul>
        ) : (
          <Rows
            key={i}
            items={b.rows.flatMap((id) => {
              const item = byId.get(id)
              return item ? [item] : []
            })}
            nouns={nouns}
            more={b.more}
          />
        ),
      )}
    </div>
  )
}

/** Rows of items, each told apart from another with the same title. */
function Rows({
  items,
  nouns,
  more,
  shown = Infinity,
  moreLabel,
}: {
  items: readonly LoopItem[]
  nouns: Nouns
  more?: number
  shown?: number
  moreLabel?: (n: number) => string
}) {
  const [all, setAll] = React.useState(false)
  const unique = items.filter((x, i) => items.findIndex((y) => y.id === x.id) === i)
  const titles = new Map<string, number>()
  for (const i of unique) titles.set(i.title, (titles.get(i.title) ?? 0) + 1)
  const visible = all ? unique : unique.slice(0, shown)
  const hidden = unique.length - visible.length
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2.5">
        {visible.map((item) => (
          <ItemRow key={item.id} item={item} nouns={nouns} twin={titles.get(item.title)! > 1} />
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="w-fit rounded-sm text-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {moreLabel ? moreLabel(hidden) : `Show ${hidden} more`}
        </button>
      )}
      {!!more && (
        <p className="text-xs text-muted-foreground">
          {more.toLocaleString('en-GB')} more {more === 1 ? 'was' : 'were'} found than listed.
        </p>
      )}
    </div>
  )
}

/** A small label over an evidence block, with its icon. */
const BlockLabel = ({ icon: Icon, children }: { icon?: LucideIcon; children: React.ReactNode }) => (
  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
    {Icon && <Icon aria-hidden className="size-3.5" />}
    {children}
  </p>
)

/**
 * A subject as a sentence says it, with its chips: its metrics, then the values it narrowed,
 * "Orders in Poland"; the connecting word is the kind's, never a dimension's name.
 */
function Subject({
  ids,
  nouns,
  still,
}: {
  ids: readonly string[]
  nouns: Nouns
  still?: boolean
}) {
  const metrics = ids.filter((id) => !id.startsWith('value:'))
  const values = ids.filter((id) => id.startsWith('value:'))
  return (
    <>
      <Joined ids={metrics} nouns={nouns} still={still} />
      {metrics.length > 0 && values.length > 0 && ' in '}
      <Joined ids={values} nouns={nouns} still={still} />
    </>
  )
}

/** Names joined as a sentence says them: "A, B and C". */
function Joined({ ids, nouns, still }: { ids: readonly string[]; nouns: Nouns; still?: boolean }) {
  return (
    <>
      {ids.map((id, i) => (
        <React.Fragment key={id}>
          {i > 0 && (i === ids.length - 1 ? ' and ' : ', ')}
          <NounChip id={id} nouns={nouns} still={still} />
        </React.Fragment>
      ))}
    </>
  )
}

/** The two that disagree, side by side, and who decides which holds. */
function Disagree({ loop, maps }: { loop: LoopTurn; maps: ReturnType<typeof useMaps> }) {
  const P = useParts()
  const pair = loop.conflict.flatMap((id) => {
    const n = loop.sources.indexOf(id) + 1
    const item = maps.numbered.get(n)
    return item ? [item] : []
  })
  if (pair.length !== 2) return null
  const domains = [...new Set(pair.flatMap((i) => (i.domain ? [i.domain] : [])))]
  return (
    <div className="flex max-w-reading flex-col gap-2">
      <BlockLabel icon={P.TriangleAlertIcon}>These two disagree</BlockLabel>
      <div className="grid gap-2 @lg:grid-cols-2">
        {pair.map((item) => {
          const status = statusWords(item)
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => P.openDock('context', item.id)}
              className="flex flex-col gap-1.5 rounded-lg border bg-background px-3 py-2.5 text-left text-sm transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground tabular-nums">{item.n}</span>
                {item.domain && <NounChip id={item.domain} nouns={maps.nouns} still />}
              </span>
              <span className="font-medium">{item.title}</span>
              <span className="text-xs text-muted-foreground">
                {status.words}
                {status.day && ` · ${status.day}`}
              </span>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
        {domains.length > 0 && (
          <span>
            Which one holds is for the owners of <Joined ids={domains} nouns={maps.nouns} /> to
            decide.
          </span>
        )}
        <P.Button
          size="sm"
          variant="outline"
          onClick={() => P.openDock('conflict', loop.conflict.join('.'))}
        >
          <P.ArrowLeftRightIcon data-icon="inline-start" />
          Compare the two
        </P.Button>
      </div>
    </div>
  )
}

/** Who owns the subject: "Orders is in Sales, owned by …", or each domain with its owners. */
function Owners({ loop, nouns }: { loop: LoopTurn; nouns: Nouns }) {
  const owned = loop.owners.filter((o) => o.people.length)
  if (!owned.length) return null
  const metrics = (loop.subject?.about ?? []).filter((id) => id.startsWith('metric:'))
  return (
    <div className="flex max-w-reading flex-col gap-1 text-sm">
      {owned.map((o, i) => (
        <p key={o.domain}>
          {i === 0 && metrics.length === 1 && owned.length === 1 ? (
            <>
              <NounChip id={metrics[0]!} nouns={nouns} /> is in{' '}
              <NounChip id={o.domain} nouns={nouns} />, owned by{' '}
            </>
          ) : (
            <>
              <NounChip id={o.domain} nouns={nouns} /> is owned by{' '}
            </>
          )}
          <Joined ids={o.people} nouns={nouns} />.
        </p>
      ))}
    </div>
  )
}

/** The closest written to a Not found's subject: counted by each value of the dimension it narrowed. */
function Closest({ loop, maps }: { loop: LoopTurn; maps: ReturnType<typeof useMaps> }) {
  const closest = loop.closest
  if (!closest?.items.length) return null
  const items = closest.items.flatMap((id) => maps.byId.get(id) ?? [])
  const metrics = (loop.subject?.about ?? []).filter((id) => id.startsWith('metric:'))
  return (
    <div className="flex max-w-reading flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs leading-6 font-medium text-muted-foreground">
          Written nearest
          {metrics.length > 0 && (
            <>
              {' about '}
              <Joined ids={metrics} nouns={maps.nouns} />
            </>
          )}
          {closest.by && (
            <>
              {', by '}
              <NounChip id={closest.by} nouns={maps.nouns} />
            </>
          )}
        </p>
        {closest.counts.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
            {closest.counts.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1">
                <NounChip id={c.id} nouns={maps.nouns} />
                <span className="font-semibold tabular-nums">{c.count}</span>
              </span>
            ))}
          </p>
        )}
      </div>
      <Rows
        items={items}
        nouns={maps.nouns}
        shown={CLOSEST_SHOWN}
        moreLabel={(n) => `Show ${n} more`}
      />
    </div>
  )
}

/** What Ask read, folded under the footer: each read in code's words, and the reads by tool. */
function WhatAskRead({ loop, footer }: { loop: LoopTurn; footer: string[] }) {
  const P = useParts()
  return (
    <P.Collapsible className="flex flex-col gap-2 text-xs text-muted-foreground">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {footer.map((line, i) => (
          <span key={i}>{line}</span>
        ))}
        <P.FoldTrigger
          variant="inline"
          label="What Ask read"
          className="px-1 text-xs text-foreground"
        />
      </p>
      <P.CollapsibleContent>
        <div className="flex max-w-reading flex-col gap-2 rounded-frame border bg-background px-3.5 py-3 text-sm">
          {loop.read.length ? (
            <ul className="flex flex-col gap-1.5">
              {loop.read.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          ) : (
            <p>Nothing was read for this answer.</p>
          )}
          <p className="text-xs">
            Each read runs as you, so it sees only what your own pages show you. Earlier reads in
            this chat are read again before they are used.
          </p>
          {!!loop.reads.length && (
            <P.Collapsible>
              <P.FoldTrigger
                variant="inline"
                label="Developer details"
                className="mt-1 -ml-1 px-1 text-xs text-muted-foreground"
              />
              <P.CollapsibleContent>
                <pre className="mt-2 overflow-x-auto rounded-md bg-muted/50 p-2.5 font-mono text-xs leading-relaxed text-foreground/90">
                  {JSON.stringify({ reads: loop.reads, checks: loop.checks }, null, 2)}
                </pre>
              </P.CollapsibleContent>
            </P.Collapsible>
          )}
        </div>
      </P.CollapsibleContent>
    </P.Collapsible>
  )
}

/** What to do next that fits the state: write the missing context, or check what may be old. */
function Next({
  loop,
  nouns,
  items,
}: {
  loop: LoopTurn
  nouns: Nouns
  items: readonly LoopItem[]
}) {
  const P = useParts()
  const me = P.useMe()
  const write = P.useWrite()
  const subject = loop.subject
  const owned = new Set(loop.owners.map((o) => o.domain.replace(/^domain:(area_)?/, '')))
  const owns = me.admin || me.owns.some((d) => owned.has(d.replace(/^area_/, '')))
  if (loop.state === 'missing' || loop.state === 'partial') {
    // What is not written: the subject under Not found, what no item covers under Partial.
    const about = (
      loop.state === 'partial' ? (subject?.uncovered ?? []) : (subject?.about ?? [])
    ).filter((id) => nouns.has(id))
    if (!owns || !about.length) return null
    const names = about.map((id) => nouns.get(id)!.name)
    return (
      <P.Button
        size="sm"
        variant="outline"
        className="w-fit"
        nativeButton={false}
        render={<a href={P.href('/context/new', { about: names.join('|') })} />}
      >
        <P.PencilIcon data-icon="inline-start" />
        Write context for <Subject ids={about} nouns={nouns} still />
      </P.Button>
    )
  }
  if (loop.state === 'stale') {
    const f = items.find((i) => i.status === 'due' || i.outOfDate)
    if (!f || !owns) return null
    return (
      <div className="flex flex-wrap items-center gap-2">
        <P.Button
          size="sm"
          variant="outline"
          onClick={() =>
            void write('editItem', {
              id: f.id,
              patch: { status: 'Live', outOfDate: undefined, checkedBy: me.name },
            }).then(() =>
              P.toast('Checked: still true', {
                description: 'Agents get it without the warning from now on.',
              }),
            )
          }
        >
          Mark it still true
        </P.Button>
        <P.Button
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={<a href={P.href(`/context/${f.id}/edit`)} />}
        >
          Edit
        </P.Button>
      </div>
    )
  }
  return null
}

/** The definition, only when the service shows it: a quote captioned with its metric and tool. */
function Definitions({ loop, nouns }: { loop: LoopTurn; nouns: Nouns }) {
  if (!loop.definitions.length) return null
  return (
    <div className="flex max-w-reading flex-col gap-2">
      {loop.definitions.map((d) => (
        <figure key={d.name} className="flex flex-col gap-1 border-l-2 pl-3 text-sm">
          <figcaption className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {d.mark && (
              <span className="basis-full font-medium">
                What the definition says about {d.mark}, in its own words
              </span>
            )}
            {d.id && nouns.has(d.id) ? <NounChip id={d.id} nouns={nouns} /> : d.name}
            <span>as {d.tool} defines it</span>
          </figcaption>
          <blockquote className="text-pretty">
            {d.mark ? <Marked words={d.words ?? ''} mark={d.mark} /> : d.words}
          </blockquote>
        </figure>
      ))}
    </div>
  )
}

/** Words with one word marked, as the question turns on it. */
function Marked({ words, mark }: { words: string; mark: string }) {
  const at = words.toLowerCase().indexOf(mark.toLowerCase())
  if (at < 0) return <>{words}</>
  return (
    <>
      {words.slice(0, at)}
      <mark className="rounded-sm bg-warn/14 px-0.5 text-foreground">
        {words.slice(at, at + mark.length)}
      </mark>
      {words.slice(at + mark.length)}
    </>
  )
}

/** Each overview group's icon, by what it holds: the Inbox's own, else what it is by. */
const groupIcons = (P: LoopParts): Record<string, LucideIcon> => ({
  names: P.TagIcon,
  gap: P.CircleDashedIcon,
  flag: P.FlagIcon,
  look: P.TriangleAlertIcon,
  alert: P.BellIcon,
  mention: P.AtSignIcon,
  check: P.CalendarClockIcon,
  suggestion: P.GitPullRequestArrowIcon,
  due: P.CalendarClockIcon,
})

/** Where a group is shown filtered, when a page shows it: due items in Context, a domain's items. */
function groupPage(P: LoopParts, o: LoopOverview, key: string | null) {
  if (!key) return null
  if ((o.from === 'inbox' && key === 'check') || (o.from === 'records' && key === 'due'))
    return { href: '/context?due=1', label: 'Open in Context' }
  if (o.from === 'records' && key.startsWith('domain:'))
    return {
      href: P.href('/context', { domain: key.slice('domain:'.length) }),
      label: 'Open in Context',
    }
  return null
}

/**
 * An overview (FR-720): one line with the total the groups add up to, and the page's own count
 * when it differs, with why; then each group, in the read's stated order, with its icon, its count
 * and its rows, long ones folded behind Show all, each row cited and opening what it is about.
 */
function Overview({
  o,
  loop,
  maps,
}: {
  o: LoopOverview
  loop: LoopTurn
  maps: ReturnType<typeof useMaps>
}) {
  const P = useParts()
  const [open, setOpen] = React.useState<Record<number, boolean>>({})
  const seen = React.useMemo(() => new Set<string>(), [])
  return (
    <div data-answer-words className="flex max-w-reading flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="text-base leading-chat">
          <Runs runs={o.headline} nouns={maps.nouns} items={maps.numbered} />
          {o.from === 'inbox' && (
            <>
              {' '}
              <a
                href="/inbox"
                className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Open the Inbox
                <P.ArrowRightIcon aria-hidden className="size-3.5" />
              </a>
            </>
          )}
        </p>
        {o.page && (
          <p className="text-sm text-muted-foreground">
            The page counts <span className="font-semibold tabular-nums">{o.page.count}</span>
            {o.page.why ? `: ${o.page.why}` : '.'}
          </p>
        )}
        {o.order && (
          <p className="text-xs text-muted-foreground">
            {o.order.charAt(0).toUpperCase()}
            {o.order.slice(1)}.
          </p>
        )}
      </div>
      {o.groups.map((g, i) => {
        const Icon = (g.key && groupIcons(P)[g.key]) || P.LayersIcon
        const page = groupPage(P, o, g.key)
        const rows = open[i] ? g.rows : g.rows.slice(0, GROUP_SHOWN)
        return (
          <section key={`${g.key}-${g.name}`} className="flex flex-col gap-2" aria-label={g.name}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span>{g.name}</span>
                <span className="rounded-md bg-muted px-1.5 text-xs font-medium tabular-nums">
                  {g.count.toLocaleString('en-GB')}
                </span>
              </h3>
              {page && (
                <a
                  href={page.href}
                  className="ml-auto inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {page.label}
                  <P.ArrowRightIcon aria-hidden className="size-3.5" />
                </a>
              )}
            </div>
            <ul className="ml-6 flex flex-col gap-2.5">
              {rows.map((row, j) => {
                const n = row.item ? loop.sources.indexOf(row.item) + 1 : 0
                const item = n ? maps.numbered.get(n) : undefined
                const values = row.about.filter((id) => id.startsWith('value:'))
                return (
                  <li key={j} className="flex flex-col gap-1 text-sm">
                    <span className="flex items-start gap-2">
                      {item ? (
                        <Runs runs={[{ t: 'cite', n }]} nouns={maps.nouns} items={maps.numbered} />
                      ) : null}
                      {row.card ? (
                        <a
                          href={P.href('/inbox', { card: row.card })}
                          className="rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          {row.title}
                        </a>
                      ) : item ? (
                        <button
                          type="button"
                          onClick={() => P.openDock('context', item.id)}
                          className="rounded-sm text-left font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          {row.title}
                        </button>
                      ) : (
                        <span className="font-medium">{row.title}</span>
                      )}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                      {values.map((id) => (
                        <NounChip key={id} id={id} nouns={maps.nouns} />
                      ))}
                      {row.domain && <NounChip id={row.domain} nouns={maps.nouns} />}
                      {row.status && <span>{row.status}</span>}
                      {row.date && (
                        <span className="tabular-nums">· {dayText(row.date, true)}</span>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
            {g.rows.length > GROUP_SHOWN && !open[i] && (
              <button
                type="button"
                onClick={() => setOpen((x) => ({ ...x, [i]: true }))}
                className="ml-6 w-fit rounded-sm text-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Show all {g.count.toLocaleString('en-GB')}
              </button>
            )}
            {open[i] && g.more > 0 && (
              <p className="ml-6 text-xs text-muted-foreground">
                {g.more.toLocaleString('en-GB')} more are on the page.
              </p>
            )}
          </section>
        )
      })}
      {o.note && (
        <p className="text-sm text-muted-foreground">
          <Runs runs={o.note} nouns={maps.nouns} items={maps.numbered} seen={seen} />
        </p>
      )}
    </div>
  )
}

/** The plain words a Copy takes: the answer's own, its marks gone. */
const copyOf = (answer: Answer) => answer.text.replace(/\[\d+\]/g, '')

/** The state on one line with its fixed sentence, or From Heed's records for a records answer. */
function StateRow({ loop, words }: { loop: LoopTurn; words: React.RefObject<HTMLElement | null> }) {
  const P = useParts()
  if (!loop.state)
    return loop.reads.some((r) =>
      ['records', 'agent_questions', 'inbox', 'conflicts'].includes(r.tool),
    ) && !loop.overview ? (
      <p className="flex w-fit items-center gap-2 rounded-md bg-muted px-2 py-1 text-sm font-semibold">
        <P.TableIcon aria-hidden className="size-4" />
        From {P.PRODUCT}&apos;s records
      </p>
    ) : null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <P.StateHelp state={loop.state} words={words} />
      {loop.state !== 'grounded' && (
        <span className="text-sm text-muted-foreground">
          {P.ANSWER_LINES.find((l) => l.state === loop.state)!.sentence}
        </span>
      )}
    </div>
  )
}

/** The footer's lines, said once each: what was found out of what, and what may be out of date. */
const footerLines = (loop: LoopTurn) =>
  [loop.footer.denominator, loop.footer.stale, loop.footer.notSeen].filter((x): x is string => !!x)

/** A turn of the loop that stopped: its fixed sentence, Ask again, and a search for its words. */
function Stopped({ answer, onRetry }: { answer: Answer; onRetry?: () => void }) {
  const P = useParts()
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2 text-base leading-chat">
        <P.CircleStopIcon aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
        {answer.text}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {onRetry && (
          <P.Button variant="outline" size="sm" onClick={onRetry}>
            <P.RefreshCwIcon data-icon="inline-start" />
            Ask again
          </P.Button>
        )}
        <P.Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<a href={P.href('/search', { q: P.askedOf(answer) })} />}
        >
          <P.SearchIcon data-icon="inline-start" />
          Search for these words
        </P.Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Nothing it wrote was checked, so nothing is shown.
      </p>
    </div>
  )
}

/**
 * The loop's answer in the chat: while it reads, each read as a step; once in, the answer, its
 * evidence, the next step, the footer and the actions, in direction C's order.
 */
/** The loop's answer in the chat, with Ask's parts (loop-parts.ts). */
export function LoopAnswerBody({ parts, ...props }: Props & { parts: LoopParts }) {
  return (
    <PartsContext.Provider value={parts}>
      <AnswerOfLoop {...props} />
    </PartsContext.Provider>
  )
}

function AnswerOfLoop({ turn, docked, onRetry, onAsk, latest }: Props) {
  const P = useParts()
  const { answer, stopped } = turn
  const loop = answer.loop
  const done = turn.stage === 'done' && !!loop
  const words = React.useRef<HTMLDivElement>(null)
  const facts = P.useFacts()
  const [wrong, setWrong] = React.useState(false)
  const [sent, setSent] = React.useState<Answer['report']>(undefined)
  const key = P.answerKey(answer)
  const cited = React.useMemo(
    () => (loop ? loop.sources.flatMap((id) => facts.find((f) => f.id === id) ?? []) : []),
    [loop, facts],
  )
  React.useEffect(() => {
    if (done) P.keepShown(key, { answer, facts: cited })
  }, [done, key, answer, cited])
  if (!done || !loop)
    return (
      <div className="flex min-w-0 flex-col gap-4" aria-busy={P.isLive(turn)}>
        <LoopProgress turn={turn} />
        {stopped && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <P.CircleStopIcon className="size-4 shrink-0" aria-hidden />
              You stopped it before an answer. Nothing was shown.
            </span>
            {onRetry && (
              <P.Button variant="outline" size="sm" onClick={onRetry}>
                <P.RefreshCwIcon data-icon="inline-start" />
                Ask again
              </P.Button>
            )}
          </div>
        )}
      </div>
    )
  return (
    <Finished
      loop={loop}
      answer={answer}
      {...{
        docked,
        onRetry,
        onAsk,
        latest,
        words,
        wrong,
        setWrong,
        sent,
        setSent,
        cited,
        answerId: key,
      }}
    />
  )
}

function Finished({
  loop,
  answer,
  docked,
  onRetry,
  onAsk,
  latest,
  words,
  wrong,
  setWrong,
  sent,
  setSent,
  cited,
  answerId,
}: {
  loop: LoopTurn
  answer: Answer
  docked?: boolean
  onRetry?: () => void
  onAsk?: (question: string) => void
  latest?: boolean
  words: React.RefObject<HTMLDivElement | null>
  wrong: boolean
  setWrong: (w: boolean) => void
  sent: Answer['report']
  setSent: (s: Answer['report']) => void
  cited: Fact[]
  answerId: string
}) {
  const P = useParts()
  const maps = useMaps(loop)
  const seen = React.useMemo(() => new Set<string>(), [])
  const used = loop.sources.flatMap((_, i) => {
    const item = maps.numbered.get(i + 1)
    return item && !loop.conflict.includes(item.id) ? [item] : []
  })
  const listed = new Set(loop.body.flatMap((b) => (b.t === 'list' ? b.rows : [])))
  const usedRows = used.filter((i) => !listed.has(i.id))
  const showOwners = loop.state === 'missing' || loop.state === 'partial' || loop.state === 'stale'
  const footer = footerLines(loop)
  return (
    <div className="group/msg flex min-w-0 animate-in flex-col gap-4 duration-(--dur-3) fade-in-0">
      {loop.kind === 'stopped' ? (
        <Stopped answer={answer} onRetry={onRetry} />
      ) : (
        <>
          <StateRow loop={loop} words={words} />
          <div ref={words}>
            {loop.overview ? (
              <Overview o={loop.overview} loop={loop} maps={maps} />
            ) : loop.kind === 'question' ? (
              <p data-answer-words className="max-w-reading text-base leading-chat">
                {loop.text}
              </p>
            ) : (
              <Body
                body={loop.body}
                nouns={maps.nouns}
                numbered={maps.numbered}
                byId={maps.byId}
                seen={seen}
              />
            )}
          </div>
          {loop.kind === 'question' && loop.choices.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {loop.choices.map((choice) =>
                onAsk ? (
                  <P.Button key={choice} variant="outline" size="sm" onClick={() => onAsk(choice)}>
                    {choice}
                  </P.Button>
                ) : (
                  <span
                    key={choice}
                    className="rounded-full border px-3 py-1 text-sm text-muted-foreground"
                  >
                    {choice}
                  </span>
                ),
              )}
            </div>
          )}
          {loop.state === 'partial' && !!loop.subject?.uncovered.length && (
            <p className="text-xs leading-6 text-muted-foreground">
              Nothing is written about <Subject ids={loop.subject.uncovered} nouns={maps.nouns} />{' '}
              yet.
            </p>
          )}
          {loop.state === 'conflict' && <Disagree loop={loop} maps={maps} />}
          {usedRows.length > 0 && !loop.overview && (
            <div className="flex max-w-reading flex-col gap-2">
              <BlockLabel>Used</BlockLabel>
              <Rows items={usedRows} nouns={maps.nouns} />
            </div>
          )}
          {loop.state === 'missing' && <Closest loop={loop} maps={maps} />}
          {showOwners && <Owners loop={loop} nouns={maps.nouns} />}
          <Definitions loop={loop} nouns={maps.nouns} />
          <Next loop={loop} nouns={maps.nouns} items={used} />
          {(footer.length > 0 || loop.read.length > 0) && (
            <WhatAskRead loop={loop} footer={footer} />
          )}
        </>
      )}
      {sent && <P.ReportLine report={sent} />}
      {wrong && !sent && cited.length > 0 && (
        <P.SomethingWrong
          answer={answer}
          facts={cited}
          onClose={() => setWrong(false)}
          onSent={() => {
            setWrong(false)
            setSent({ on: 'just now' })
          }}
        />
      )}
      <P.AnswerActions
        answer={answer}
        copyText={loop.kind === 'stopped' ? '' : copyOf(answer)}
        facts={cited}
        answerId={answerId}
        draft={false}
        docked={docked}
        latest={latest}
        onRetry={loop.kind === 'stopped' ? undefined : onRetry}
        wrong={wrong}
        onWrong={(w) => cited.length > 0 && !sent && setWrong(w)}
        canReport={cited.length > 0 && !sent}
      />
    </div>
  )
}
