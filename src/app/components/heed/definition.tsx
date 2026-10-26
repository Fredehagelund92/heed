import * as React from 'react'
import {
  EqualIcon,
  LockIcon,
  PencilIcon,
  SigmaIcon,
  SplitIcon,
  TriangleAlertIcon,
  UserIcon,
  WholeWordIcon,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { TagChip } from '@/components/heed/tag-chip'
import { Separator } from '@/components/ui/separator'
import { domains, type Fact } from '@/data/world'
import {
  addSynonym,
  parseTags,
  saveTerm,
  conflictOf,
  contextAbout,
  cubeRef,
  findDefinition,
  meaningOf,
  kindName,
  removeTerm,
  sourceUrl,
  SYNCED_AT,
  synonymsOf,
  useDefinitions,
  type Definition,
  type DefinitionType,
} from '@/lib/definitions'
import { openDock } from '@/lib/dock'
import { useFacts, useMe } from '@/lib/store'
import { mentionId, plainText } from '@/lib/mentions'
import { MentionText } from '@/components/heed/mention-chip'
import { Related } from '@/components/heed/related'
import { useRelated } from '@/hooks/use-related'
import { DEFINITIONS_TOOL } from '@/data/integrations'
import { PeekFact, PeekFacts } from '@/components/heed/peek'
import { useFigures } from '@/lib/figures'
import { MoreProperties, Property } from '@/components/heed/doc'
import { VersionHistory } from '@/components/heed/version-history'
import { historyOfDefinition } from '@/data/history'
import { useShowMore } from '@/hooks/use-show-more'
import { ShowMoreButton } from '@/components/heed/show-more'

// The marks of a definition, as the Heed app draws a catalogue term's type: a lucide glyph in a
// neutral tile (sigma for a metric, split for a dimension). The Heed app has no terms; the mockup
// adds whole-word for a term with its own meaning and equals for a synonym, from the same set.

const glyphs: Record<DefinitionType | 'synonym', LucideIcon> = {
  metric: SigmaIcon,
  dimension: SplitIcon,
  term: WholeWordIcon,
  synonym: EqualIcon,
}

const kindOf = (d: Pick<Definition, 'type' | 'sameAs'>) => (d.sameAs ? 'synonym' : d.type)

/** The type as a neutral tile: 24 in compact rows, 28 in comfortable rows, headers and on a phone. Labelled for screen readers. */
export function TypeTile({
  d,
  size = 'md',
  className,
}: {
  d: Pick<Definition, 'type' | 'sameAs'>
  size?: 'md' | 'lg'
  className?: string
}) {
  const Glyph = glyphs[kindOf(d)]
  return (
    <span
      role="img"
      aria-label={kindName(d)}
      title={kindName(d)}
      className={cn(
        'inline-flex shrink-0 items-center justify-center border bg-muted text-foreground',
        size === 'md'
          ? 'size-6 rounded-[5px] [&>svg]:size-3.5'
          : 'size-7 rounded-md [&>svg]:size-4',
        className,
      )}
    >
      <Glyph aria-hidden />
    </span>
  )
}

/** The type as a plain glyph, for chips and menus where the words beside it say what it is. */
export function TypeGlyph({
  d,
  className,
}: {
  d: Pick<Definition, 'type' | 'sameAs'>
  className?: string
}) {
  const Glyph = glyphs[kindOf(d)]
  return <Glyph aria-hidden className={cn('size-3.5 shrink-0 text-muted-foreground', className)} />
}

/** A synonym's quiet link to the definition whose meaning it uses: "Another name for Σ Gross sales". */
export function AnotherNameFor({ target, className }: { target: Definition; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        openDock('def', target.name)
      }}
      className={cn(
        'inline-flex h-6 max-w-full shrink-0 items-center gap-1 rounded-md border px-1.5 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
    >
      Another name for
      <TypeGlyph d={target} className="text-foreground" />
      <span className="truncate font-medium text-foreground">{target.name}</span>
    </button>
  )
}

/** Why a term can mislead an agent, said once, in the warning tone. */
export function ConflictNote({ d, className }: { d: Definition; className?: string }) {
  const conflict = conflictOf(d)
  if (!conflict) return null
  return (
    <p
      role="note"
      className={cn(
        'flex gap-2 rounded-frame border border-[oklch(0.68_0.16_65/0.4)] bg-[oklch(0.68_0.16_65/0.08)] px-3 py-2 text-sm',
        className,
      )}
    >
      <TriangleAlertIcon
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-[oklch(0.55_0.15_60)] dark:text-[oklch(0.78_0.14_70)]"
      />
      <span>
        <span className="font-medium">
          {conflict.kind === 'chain'
            ? 'Points to a synonym. '
            : conflict.kind === 'two-things'
              ? 'Used for two things. '
              : 'Points nowhere. '}
        </span>
        {conflict.message} Agents don't use it until it's settled.
      </span>
    </p>
  )
}

type Refused = { word: string; reason: string }

/**
 * The other names for a definition, as tags in one box: type a word and a comma (or Enter, or
 * paste "GMV, turnover, sales value") and each becomes a tag at once, saved as a synonym. Backspace
 * in the empty box selects the last tag, then removes it; x removes one. A word that already means
 * something else stays as a warning tag that says who has it, and is never saved. The source's own
 * names are locked tags. Escape keeps every tag made so far. The same box on the definition's
 * page, in its quick view and in the term editor, so all three write the one list.
 */
export function SynonymTags({
  d,
  label = 'Also called',
  canEdit,
  level = 3,
}: {
  d: Definition
  label?: string
  canEdit: boolean
  level?: 2 | 3
}) {
  const H = level === 2 ? 'h2' : 'h3'
  const me = useMe()
  useDefinitions()
  const point = d.sameAs ? meaningOf(d) : d
  const synonyms = synonymsOf(point.name)
  const [text, setText] = React.useState('')
  const [refused, setRefused] = React.useState<Refused[]>([])
  const [selected, setSelected] = React.useState<string | null>(null)
  const [said, setSaid] = React.useState('')
  const [flash, setFlash] = React.useState<string | null>(null)
  const input = React.useRef<HTMLInputElement>(null)
  const id = React.useId()
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

  const commit = (words: string[]) => {
    const added: string[] = []
    const out: Refused[] = []
    for (const w of words) {
      const r = addSynonym(point, w, me.name)
      if (r.ok) added.push(w)
      else if (r.why === 'here')
        setFlash(
          synonyms.find((s) => same(s.name, w))?.name ??
            point.sourceNames.find((n) => same(n, w)) ??
            null,
        )
      else if (r.why !== 'empty') out.push({ word: w, reason: r.reason })
    }
    setRefused((prev) => [
      ...prev.filter(
        (p) => !out.some((o) => same(o.word, p.word)) && !added.some((a) => same(a, p.word)),
      ),
      ...out,
    ])
    setSaid(
      [
        added.length && `Added synonym ${added.join(', ')}.`,
        out.map((o) => o.reason).join(' '),
        words.length && !added.length && !out.length && 'Already there.',
      ]
        .filter(Boolean)
        .join(' '),
    )
  }
  const remove = (name: string) => {
    const was = findDefinition(name)
    removeTerm(name)
    setSelected(null)
    setSaid(`Removed synonym ${name}.`)
    toast(`Removed “${name}”`, {
      description: `${point.name} itself is unchanged.`,
      action: was ? { label: 'Undo', onClick: () => saveTerm(undefined, was) } : undefined,
    })
    input.current?.focus()
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === ',' || (e.key === 'Enter' && text.trim())) {
      e.preventDefault()
      commit(parseTags(text))
      setText('')
      return
    }
    if (e.key === 'Backspace' && !text) {
      const last = synonyms[synonyms.length - 1]
      if (!last) return
      e.preventDefault()
      if (selected === last.name) remove(last.name)
      else {
        setSelected(last.name)
        setSaid(`${last.name} selected. Backspace again removes it.`)
      }
      return
    }
    if (e.key === 'Escape' && (text || selected)) {
      // Escape lets go of what is half typed; every tag made so far stays.
      e.stopPropagation()
      setText('')
      setSelected(null)
      return
    }
    setSelected(null)
  }

  const chips = (
    <>
      {point.sourceNames.map((n) => (
        <TagChip
          key={n}
          icon={<LockIcon aria-hidden />}
          title={`${DEFINITIONS_TOOL}'s own name, read-only`}
          className={cn(flash && same(flash, n) && 'ring-2 ring-ring')}
        >
          {n}
          <span className="sr-only"> (from {DEFINITIONS_TOOL}, read-only)</span>
        </TagChip>
      ))}
      {synonyms.map((s) => {
        const conflict = conflictOf(s)
        return (
          <TagChip
            key={s.name}
            tone={conflict ? 'warn' : 'term'}
            icon={conflict ? <TriangleAlertIcon aria-hidden /> : <EqualIcon aria-hidden />}
            title={conflict ? conflict.message : `${s.name}, added by ${s.by}`}
            onRemove={canEdit ? () => remove(s.name) : undefined}
            removeLabel={`Remove the synonym ${s.name}`}
            className={cn(
              'max-w-48',
              (selected === s.name || (flash && same(flash, s.name))) && 'ring-2 ring-ring',
            )}
          >
            {s.name}
            {conflict && <span className="sr-only"> (conflict: {conflict.short})</span>}
          </TagChip>
        )
      })}
      {refused.map((r) => (
        <TagChip
          key={r.word}
          tone="warn"
          icon={<TriangleAlertIcon aria-hidden />}
          title={r.reason}
          onRemove={() => setRefused((x) => x.filter((y) => y !== r))}
          removeLabel={`Dismiss ${r.word}`}
          className="max-w-48 line-through decoration-1"
        >
          {r.word}
        </TagChip>
      ))}
    </>
  )

  return (
    <section aria-labelledby={`${id}-label`} className="flex flex-col gap-1.5">
      <H id={`${id}-label`} className="text-sm font-medium">
        {label}
      </H>
      {canEdit ? (
        // The box takes clicks anywhere into its field, as a tag box does.
        <div
          onClick={() => input.current?.focus()}
          className={cn(
            'flex min-h-9 cursor-text flex-wrap items-center gap-1.5 rounded-md border bg-background px-1.5 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
            'pointer-coarse:min-h-11',
          )}
        >
          {chips}
          <input
            ref={input}
            id={`${id}-input`}
            value={text}
            aria-label={`Add another name for ${point.name}`}
            aria-describedby={`${id}-help`}
            placeholder={
              synonyms.length || point.sourceNames.length
                ? 'Add a word'
                : 'Type a word, then a comma'
            }
            onChange={(e) => {
              const v = e.target.value
              // A comma typed or pasted mid-word: every finished word becomes a tag, the rest stays.
              if (v.includes(',')) {
                const parts = v.split(',')
                commit(parseTags(parts.slice(0, -1).join(',')))
                setText(parts[parts.length - 1].trimStart())
              } else setText(v)
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text')
              if (!/[,\n]/.test(pasted)) return
              e.preventDefault()
              commit(parseTags(`${text}${pasted}`))
              setText('')
            }}
            onKeyDown={onKeyDown}
            className="h-6 min-w-28 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground pointer-coarse:h-8"
          />
        </div>
      ) : synonyms.length || point.sourceNames.length ? (
        <div className="flex flex-wrap items-center gap-1.5">{chips}</div>
      ) : (
        <p className="text-sm text-muted-foreground">No other names yet.</p>
      )}
      {refused.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-[oklch(0.5_0.14_55)] dark:text-[oklch(0.8_0.13_75)]">
          {refused.map((r) => (
            <li key={r.word}>{r.reason}</li>
          ))}
        </ul>
      )}
      {canEdit && (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          A comma or Enter adds a word; each one means {point.name} to agents.
          {point.sourceNames.length ? ` Locked words come from ${DEFINITIONS_TOOL}.` : ''}
        </p>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {said}
      </p>
    </section>
  )
}

/**
 * What a definition is, read-only, the same in the peek and on its page: for a synced item the
 * synced note, its meaning and the names Cube gives it; for a term its meaning or what it is the
 * same as; then "Also called in Heed" and the context about it.
 */
/** The context about a definition: the first five, then more on request, so the page grows instead of a box scrolling. */
function ContextAbout({ subject, about }: { subject: Definition; about: Fact[] }) {
  const { shown, more, next, showMore } = useShowMore(about, 5, 10)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">
        Context about {subject.name}{' '}
        <span className="font-normal text-muted-foreground tabular-nums">{about.length}</span>
      </p>
      {about.length ? (
        shown.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => openDock('context', f.id)}
            className="rounded-md border px-3 py-2 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="line-clamp-1">{f.title}</span>
            <span className="text-xs text-muted-foreground">
              {domains[f.domain].name}, {f.where.join(', ')}
            </span>
          </button>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          No context yet. Agents asking about {subject.name} hear that nothing is written down.
        </p>
      )}
      <ShowMoreButton more={more} next={next} onClick={showMore} />
    </div>
  )
}

export function DefinitionDetails({ d }: { d: Definition }) {
  const me = useMe()
  const canEdit = me.admin || (!!d.domain && me.owns.includes(d.domain))
  const facts = useFacts()
  useDefinitions()
  const target = d.sameAs ? findDefinition(d.sameAs) : undefined
  const about = contextAbout(d, facts)
  const subject = target ? meaningOf(d) : d
  const related = useRelated(mentionId(d.type, d.name))
  const figures = useFigures()
  const domain = d.domain ? domains[d.domain].name : 'All domains'
  const mentioned = related.length > 0
  const hasDetails = !!d.values || d.synced || mentioned
  // The meaning is the page; then one quiet line on where it comes from, and the rest folded into Details.
  return (
    <div className="flex flex-col gap-5">
      <ConflictNote d={d} />
      {target ? (
        <div className="flex flex-col items-start gap-2">
          <AnotherNameFor target={target} />
          <p className="max-w-reading text-base leading-7 text-muted-foreground">
            {plainText(meaningOf(d).definition)}
          </p>
        </div>
      ) : d.definition ? (
        <div className="max-w-reading text-base leading-7">
          <MentionText text={d.definition} />
        </div>
      ) : (
        <p className="text-base text-muted-foreground">No meaning written yet.</p>
      )}
      <div className="flex flex-col gap-3 border-t pt-4 text-sm">
        <PeekFacts>
          {d.synced ? (
            <PeekFact icon={LockIcon}>
              <b>{domain}</b> - read-only, synced from {DEFINITIONS_TOOL} {SYNCED_AT} -{' '}
              <a
                href={sourceUrl(d)}
                target="_blank"
                rel="noreferrer"
                className="font-medium whitespace-nowrap text-primary underline-offset-4 hover:underline"
              >
                Open in source
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </PeekFact>
          ) : (
            <PeekFact icon={PencilIcon}>
              <b>{domain}</b> - written by <b>{d.by}</b> - {d.updated}
            </PeekFact>
          )}
          {/* A metric's figures have a person to ask, named in its integration's settings. */}
          {d.synced && d.type === 'metric' && (
            <PeekFact icon={UserIcon}>
              Data contact <b>{figures.contact('cube')}</b>, who hears about a figure that looks
              wrong
            </PeekFact>
          )}
        </PeekFacts>
        {hasDetails && (
          <MoreProperties
            label="Details"
            summary={[d.synced && cubeRef(d), d.values, mentioned && `${related.length} related`]
              .filter(Boolean)
              .join(' - ')}
          >
            {d.values && <Property label="Values">{d.values}</Property>}
            {d.synced && d.sourceNames.length > 0 && (
              <Property label={`Other names in ${DEFINITIONS_TOOL}`}>
                {d.sourceNames.map((n) => (
                  <span
                    key={n}
                    className="inline-flex h-6 items-center gap-1 rounded-md bg-muted px-2 text-xs text-muted-foreground"
                  >
                    <LockIcon aria-hidden className="size-3" />
                    {n}
                  </span>
                ))}
              </Property>
            )}
            {d.synced && (
              <Property label="From">
                <span className="py-1">
                  <span className="font-mono text-xs">{cubeRef(d)}</span>
                  {d.changed && (
                    <span className="block text-xs text-muted-foreground">
                      Definition changed in {DEFINITIONS_TOOL} on {d.changed}
                    </span>
                  )}
                </span>
              </Property>
            )}
            {mentioned && (
              <Property label="Related">
                <Related id={mentionId(d.type, d.name)} />
              </Property>
            )}
          </MoreProperties>
        )}
      </div>
      {!d.sameAs && (
        <>
          <Separator />
          <SynonymTags d={d} canEdit={canEdit} />
        </>
      )}
      {subject.type !== 'dimension' && (
        <>
          <Separator />
          <ContextAbout subject={subject} about={about} />
        </>
      )}
      <Separator />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">History</p>
        <VersionHistory
          versions={historyOfDefinition(d, DEFINITIONS_TOOL)}
          canRestore={!d.synced && canEdit}
        />
      </div>
    </div>
  )
}
