import { useId } from 'react'
import { Link } from '@tanstack/react-router'
import type { EditionChangeKind, ChangeCounts } from '@domain/editions'
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  HeedRetiredIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  type Icon,
} from '@/components/icons'
import { DomainBadge, KindBadge } from '@/components/item/item-marks'
import { RiskBadge } from '@/components/item/fact-badges'
import { LinkedMentionChip } from '@/components/mentions/mention-text'
import { EditionFieldRows, type DiffLookups } from '@/components/review/field-diff'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  changeAttribution,
  changeCountParts,
  changeLabels,
  itemChangeSentence,
  partitionEditionFields,
  type EditionComparison,
  type EditionSummary,
  type ItemComparison,
} from '@/lib/edition-diff'
import { versionWords } from '@/lib/editions'

const marks: Record<EditionChangeKind, { icon: Icon; tone: BadgeTone }> = {
  added: { icon: PlusIcon, tone: 'success' },
  changed: { icon: PencilIcon, tone: 'info' },
  checked: { icon: CheckIcon, tone: 'neutral' },
  resaved: { icon: CopyIcon, tone: 'neutral' },
  retired: { icon: HeedRetiredIcon, tone: 'danger' },
  removed: { icon: MinusIcon, tone: 'neutral' },
}

export function EditionChangeBadge({ change }: { change: EditionChangeKind }) {
  return <Badge {...marks[change]}>{changeLabels[change]}</Badge>
}

/** Uses full endpoint counts, never the current page's item count. */
export function EditionChangeCounts({ counts }: { counts: ChangeCounts }) {
  const parts = changeCountParts(counts)
  if (!parts.length) return <p className="text-caption text-muted-foreground">No fact changed.</p>
  return (
    <ul aria-label="Changes by type" className="flex flex-wrap gap-2">
      {parts.map(({ kind, text }) => (
        <li key={kind}>
          <Badge {...marks[kind]}>{text}</Badge>
        </li>
      ))}
    </ul>
  )
}

/** The service's template sentence includes vocabulary, domain state and withheld counts. */
export function EditionChangeSummary({ summary }: { summary: EditionSummary | EditionComparison }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-body break-words">{summary.sentence}</p>
      <EditionChangeCounts counts={'counts' in summary ? summary.counts : summary.facets.change} />
    </div>
  )
}

/** S1: a presentational card for a generated compareItem response. No page or action state. */
export function EditionChangeCard({
  comparison,
  lookups,
  header = true,
}: {
  comparison: ItemComparison
  lookups: DiffLookups
  /**
   * The badges, title and versions on top, with the way to the item's page. A surface that
   * already shows them, such as the docked panel, leaves them out; the card is then named by
   * the item's title.
   */
  header?: boolean
}) {
  const heading = useId()
  const change = comparison.change
  if (!change)
    return (
      <p className="rounded-sm border px-4 py-3 text-body text-muted-foreground">
        This fact is the same in both editions.
      </p>
    )
  const area = lookups.areas.find((candidate) => candidate.id === change.areaId)
  const fields = partitionEditionFields(comparison.fields)
  const singleSide =
    change.change === 'added'
      ? 'after'
      : change.change === 'retired' || change.change === 'removed'
        ? 'before'
        : undefined
  return (
    <article
      aria-labelledby={header ? heading : undefined}
      aria-label={header ? undefined : `What changed in ${change.title}`}
      className="flex min-w-0 flex-col overflow-hidden rounded-sm border bg-card"
    >
      {header ? (
        <header className="flex min-w-0 flex-col gap-2 border-b px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <EditionChangeBadge change={change.change} />
            <KindBadge kind={change.kind} />
            {area ? <DomainBadge name={area.name} label={area.label} /> : null}
            {change.riskLevel === 'high' ? <RiskBadge level={change.riskLevel} /> : null}
            <Button
              variant="ghost"
              size="sm"
              render={<Link to="/library/$itemId" params={{ itemId: change.itemId }} />}
              aria-label={`Open fact: ${change.title}`}
              className="ml-auto"
            >
              Open fact
            </Button>
          </div>
          <h3 id={heading} className="text-large font-normal break-words">
            {change.title}
          </h3>
          <p className="text-caption text-muted-foreground">
            {versionWords({ from: change.from?.version ?? null, to: change.to?.version ?? null })}
          </p>
        </header>
      ) : null}
      <div className="flex flex-col gap-2 border-b px-4 py-3">
        <p className="text-body">{itemChangeSentence(change)}</p>
        {changeAttribution(change.why, lookups.nameOf).map((line, index) => (
          <p key={index} className="text-dense break-words text-muted-foreground">
            {line}
          </p>
        ))}
      </div>
      {fields.content.length ? (
        <EditionFieldRows
          fields={fields.content}
          lookups={lookups}
          issue={change.kind === 'issue'}
          {...(singleSide ? { singleSide } : {})}
        />
      ) : null}
      {(['removed', 'added'] as const).map((kind) =>
        comparison.mentions[kind].length ? (
          <div key={kind} className="flex flex-col gap-2 border-t px-4 py-3">
            <h4 className="text-caption text-muted-foreground">Mentions {kind}</h4>
            <ul className="flex flex-wrap gap-2">
              {comparison.mentions[kind].map((mention, index) => (
                <li
                  key={`${mention.field}-${mention.position}-${index}`}
                  className="flex items-center gap-1"
                >
                  <LinkedMentionChip
                    targetKey={mention.target}
                    label={mention.label}
                    option={lookups.targets.get(mention.target)}
                  />
                  <span className="text-caption text-muted-foreground">
                    in {mention.field === 'summary' ? 'what happened' : 'the longer explanation'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      {fields.system.length ? (
        <Collapsible className="border-t">
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                className="group/details h-auto w-full justify-start rounded-none px-4 py-3 text-left whitespace-pre-line"
              />
            }
          >
            <ChevronDownIcon
              aria-hidden="true"
              className="size-icon-sm shrink-0 -rotate-90 transition-transform group-data-panel-open/details:rotate-0"
            />
            {fields.system.length}{' '}
            {fields.system.length === 1
              ? 'field the system fills in'
              : 'fields the system fills in'}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <EditionFieldRows
              fields={fields.system}
              lookups={lookups}
              issue={change.kind === 'issue'}
              {...(singleSide ? { singleSide } : {})}
            />
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </article>
  )
}
