import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { EditionChangeKind } from '@domain/editions'
import type { ItemKind, RiskLevel } from '@domain/item'
import { toApiError } from '@/api'
import { editionItemComparisonQuery } from '@/api/edition-queries'
import { areasQuery, peopleQuery } from '@/api/queries'
import { CheckIcon, EyeIcon } from '@/components/icons'
import { RiskBadge } from '@/components/item/fact-badges'
import { CountBadge, DomainBadge, KindBadge } from '@/components/item/item-marks'
import { ListEmpty, ListError } from '@/components/library/list-state'
import { DockPanel } from '@/components/page/dock-panel'
import type { DiffLookups } from '@/components/review/field-diff'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TabsContent } from '@/components/ui/tabs'
import { changeAttribution, changeLabels, type ItemComparison } from '@/lib/edition-diff'
import { editionReason, versionWords } from '@/lib/editions'
import { formatMoment } from '@/lib/library'
import { targetsByKey } from '@/lib/mention-targets'
import { useMentionTargets } from '@/lib/use-mention-targets'
import { EditionChangeBadge, EditionChangeCard } from './change-card'

/** What the list knows of the item, shown while its comparison loads. */
export type PanelPlaceholder = {
  title: string
  change: EditionChangeKind
  kind: ItemKind
  areaId: string
  riskLevel: RiskLevel
}

/** The panel's tabs; the tab is in the address (`tab=steps`), so it is linkable and stays. */
export type ComparePanelTab = 'changes' | 'steps'

/**
 * One changed item in the docked panel beside the list (Editions design, S2: "docked panel for
 * the diff"): the item's title and badges, then what changed field by field (the diff kit's
 * card, in the unified layout), and each edition between the two that changed it, with who did
 * it and why. j and k step through the list, Escape closes it; the item's own page is the
 * expand button.
 */
export function CompareItemPanel({
  itemId,
  from,
  to,
  placeholder,
  position,
  onPrevious,
  onNext,
  onClose,
  tab,
  onTabChange,
  viewed,
  onToggleViewed,
}: {
  itemId: string
  /** The earlier edition; left out, the edition before `to` (one edition's own change). */
  from?: string | undefined
  to: string
  placeholder: PanelPlaceholder | undefined
  /** Where the item is in the list, when it is in it. */
  position: { index: number; total: number } | null
  onPrevious?: (() => void) | undefined
  onNext?: (() => void) | undefined
  onClose: () => void
  tab: ComparePanelTab
  onTabChange: (tab: ComparePanelTab) => void
  /** Whether the person marked this change as viewed; null before the change is known. */
  viewed: boolean | null
  onToggleViewed: (comparison: ItemComparison) => void
}) {
  const comparison = useQuery(
    editionItemComparisonQuery({ id: itemId, to, ...(from ? { from } : {}) }),
  )
  const { data: areas = [] } = useQuery(areasQuery())
  const { data: people = [] } = useQuery(peopleQuery())
  const { targets: targetList } = useMentionTargets()
  const lookups = useMemo<DiffLookups>(
    () => ({
      areas,
      targets: targetsByKey(targetList),
      nameOf: (id) => people.find((person) => person.id === id)?.name ?? null,
    }),
    [areas, people, targetList],
  )

  const data = comparison.data
  const change = data?.change ?? null
  const shown = change ?? placeholder
  const area = shown ? areas.find((candidate) => candidate.id === shown.areaId) : undefined
  const title = shown?.title ?? null
  const steps = data?.steps ?? []

  return (
    <DockPanel
      title={comparison.isError && !shown ? "This fact couldn't load" : title}
      contentKey={`${itemId}:${from ?? ''}:${to}`}
      meta={
        <>
          <span className="truncate">{shown ? changeLabels[shown.change] : 'Changed fact'}</span>
          {position ? (
            <span className="shrink-0">
              · {(position.index + 1).toLocaleString('en')} of {position.total.toLocaleString('en')}
            </span>
          ) : null}
        </>
      }
      badges={
        shown ? (
          <div className="flex flex-wrap items-center gap-2">
            <EditionChangeBadge change={shown.change} />
            <KindBadge kind={shown.kind} />
            {area ? <DomainBadge name={area.name} label={area.label} /> : null}
            {shown.riskLevel === 'high' ? <RiskBadge level="high" /> : null}
          </div>
        ) : null
      }
      note={
        change ? (
          <p className="text-dense text-muted-foreground">
            {versionWords({ from: change.from?.version ?? null, to: change.to?.version ?? null })}
          </p>
        ) : null
      }
      tabs={[
        { value: 'changes', label: 'What changed' },
        {
          value: 'steps',
          label: 'Edition by edition',
          count: data ? <CountBadge count={steps.length} tone="quiet" /> : undefined,
        },
      ]}
      tab={tab}
      onTabChange={onTabChange}
      tabsLabel="Fact changes"
      onPrevious={onPrevious}
      onNext={onNext}
      onClose={onClose}
      expand={<Link to="/library/$itemId" params={{ itemId }} aria-label="Open the fact's page" />}
      footer={
        data?.change && viewed !== null ? (
          <Button
            variant={viewed ? 'outline' : 'default'}
            aria-pressed={viewed}
            onClick={() => onToggleViewed(data)}
          >
            {viewed ? <CheckIcon aria-hidden /> : <EyeIcon aria-hidden />}
            {viewed ? 'Viewed' : 'Mark as viewed'}
          </Button>
        ) : null
      }
    >
      <TabsContent value="changes" className="flex flex-col gap-4">
        {comparison.isPending ? (
          <div role="status" aria-label="Loading what changed" className="flex flex-col gap-3">
            <Skeleton className="h-row w-full" />
            <Skeleton className="h-row-scope w-full" />
            <Skeleton className="h-row-scope w-full" />
          </div>
        ) : comparison.isError ? (
          toApiError(comparison.error).kind === 'not-found' ? (
            <NotInRange />
          ) : (
            <ListError
              title="We couldn't load what changed"
              safe="Nothing is lost."
              error={comparison.error}
              onRetry={() => void comparison.refetch()}
            />
          )
        ) : (
          <EditionChangeCard comparison={comparison.data} lookups={lookups} header={false} />
        )}
      </TabsContent>
      <TabsContent value="steps" className="flex flex-col gap-4">
        {data ? (
          steps.length ? (
            <ol aria-label="Editions that changed this fact" className="flex flex-col divide-y">
              {steps.map((step) => (
                <li key={step.edition.seq} className="flex flex-col gap-2 py-4 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to="/editions/$label"
                      params={{ label: step.edition.label }}
                      className="font-mono text-dense tabular-nums underline-offset-4 hover:underline"
                      translate="no"
                    >
                      {step.edition.label}
                    </Link>
                    <EditionChangeBadge change={step.change} />
                  </div>
                  <p className="text-caption text-muted-foreground">
                    {formatMoment(step.edition.sealedAt ?? step.edition.createdAt)} ·{' '}
                    {editionReason(step.edition)} ·{' '}
                    {versionWords({
                      from: step.from?.version ?? null,
                      to: step.to?.version ?? null,
                    })}
                  </p>
                  {changeAttribution(step.why, lookups.nameOf).map((line, index) => (
                    <p key={index} className="text-dense break-words">
                      {line}
                    </p>
                  ))}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-body text-muted-foreground">
              No edition between these two changed this fact.
            </p>
          )
        ) : (
          <Skeleton className="h-row-scope w-full" />
        )}
      </TabsContent>
    </DockPanel>
  )
}

function NotInRange() {
  return (
    <ListEmpty title="Nothing to show for this fact">
      It isn't in these editions, or only some groups can see it. The list is still where it was.
    </ListEmpty>
  )
}
