import { Link } from '@tanstack/react-router'
import { useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ContextItem, RiskLevel } from '@domain/item'
import { ownCaveat } from '@domain/proposal-rules'
import { isEndedIssue } from '@domain/status'
import {
  areasQuery,
  itemHistoryQuery,
  itemLinksQuery,
  libraryQuery,
  peopleQuery,
  vocabularyQuery,
} from '@/api/queries'
import { useShellActions } from '@/components/app-shell/shell-actions'
import {
  BadgeCheckIcon,
  CircleSlashIcon,
  CopyIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  HashIcon,
  HeedAcceptedIcon,
  HeedRetiredIcon,
  HeedRiskIcon,
  HistoryIcon,
  NetworkIcon,
  PencilLineIcon,
  QuoteIcon,
  RotateCcwIcon,
  ScaleIcon,
  TargetIcon,
  TextAlignStartIcon,
  UserRoundIcon,
  UsersIcon,
} from '@/components/icons'
import { ConnectedItems, linkCount } from '@/components/item/connected-items'
import { AudienceBadge, ClaimBadge, RiskBadge } from '@/components/item/fact-badges'
import { FieldRow, FieldTable, Section } from '@/components/item/field-table'
import { HistoryTable, versionRows } from '@/components/item/history-table'
import { ItemActions } from '@/components/item/item-actions'
import { CountBadge, DateBadge, Owner, StatusBadge } from '@/components/item/item-marks'
import { ItemText, type MentionLookup } from '@/components/item/item-text'
import { ScopeTermLabel, type ScopeTermView } from '@/components/mentions/scope-term'
import { previewRender } from '@/components/preview/preview-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TabsContent } from '@/components/ui/tabs'
import { PersonPreview } from '@/components/preview/preview-link'
import { caveatWords } from '@/lib/context-help'
import { itemState } from '@/lib/item-state'
import { previewTargetOfAbout } from '@/lib/preview'
import { channelText, formatDay } from '@/lib/library'
import type { ItemTab } from '@/lib/search-params'
import { usePermissions } from '@/lib/use-session'
import { cn } from '@/lib/utils'

/*
  The parts of an item that the item page and the library's docked panel both show: what is
  read about the item (its state, history, links and people), the one action group, and the
  Read, Source, History and Links tabs. Each surface lays the parts out its own way; the parts
  are the same, so the page and the panel never say different things about one item.
*/

/** What the first section is called, by kind: an event happened, a note says, a guide tells. */
const firstSection: Record<ContextItem['kind'], string> = {
  event: 'What happened',
  note: 'What it says',
  guide: 'How to investigate',
  example: 'The checked question',
  issue: 'What is affected',
}

/** What a risk level changes: nothing any more, every fact gets the same review (FR-513). */
const riskMeaning: Record<RiskLevel, string> = {
  low: 'A change gets the same three checks and one accept as every fact.',
  normal: 'A change gets the same three checks and one accept as every fact.',
  high: 'Legal, regulatory or financial content. A change gets the same three checks and one accept as every fact.',
}

const claimMeaning = {
  effect_stated: 'A named authority states the effect, so agents can say what caused it.',
  fact_only:
    "This fact doesn't prove a cause. Agents may say the two could be related, never that one caused the other.",
} as const

const tabNames: Record<ItemTab, string> = {
  read: 'Read',
  source: 'Source',
  history: 'History',
  links: 'Links',
}

function Loading({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-2">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  )
}

/** Everything the parts read about one item, loaded once by the surface that shows it. */
export function useItemFacts(item: ContextItem) {
  const { data: library } = useQuery(libraryQuery())
  const { data: areas } = useQuery(areasQuery())
  const { data: people } = useQuery(peopleQuery())
  const { data: vocabulary } = useQuery(vocabularyQuery())
  const permissions = usePermissions()
  const { data: history, isPending: historyPending } = useQuery(itemHistoryQuery(item.id))
  const { data: links, isPending: linksPending } = useQuery(itemLinksQuery(item.id))

  const today = library?.today ?? new Date().toISOString().slice(0, 10)
  const area = areas?.find((candidate) => candidate.id === item.areaId)
  const person = (id: string) => people?.find((candidate) => candidate.id === id)
  const name = (id: string) => person(id)?.name ?? 'Someone'
  const owner = person(item.ownerId)
  const proposer = person(item.proposerId)
  const versions = versionRows(history ?? [], name)
  const retiredRow = versions.find((row) => row.retired)?.retired ?? null
  const latestAccepted = versions.find((row) => row.accepted)?.accepted ?? null
  const state = itemState(item, {
    today,
    ownerName: owner?.name ?? null,
    areaName: area?.name ?? null,
    retired: item.status === 'retired' ? (retiredRow ?? { by: null, date: item.updatedAt }) : null,
  })

  const libraryItems = useMemo(
    () => new Map((library?.items ?? []).map((entry) => [entry.id, entry])),
    [library?.items],
  )
  const lookup: MentionLookup = {
    item: (id) => {
      const entry = libraryItems.get(id)
      return entry ? { kind: entry.kind, calm: isEndedIssue(entry, today) } : undefined
    },
    area: (id) => areas?.find((candidate) => candidate.id === id),
    links: links ?? undefined,
  }

  const metricName = (id: string) =>
    vocabulary?.metrics.find((metric) => metric.id === id)?.name ?? id
  const dimension = (id: string) => vocabulary?.dimensions.find((candidate) => candidate.id === id)
  const aboutLinks: { key: string; term: ScopeTermView }[] = [
    ...item.scope.metrics.map((id) => ({
      key: id,
      term: { kind: 'metric' as const, name: metricName(id) },
    })),
    ...item.scope.dimensionValues.map(({ dimension: dimensionId, value }) => {
      const known = dimension(dimensionId)
      return {
        key: `${dimensionId}:${value}`,
        term: {
          kind: 'dimension_value' as const,
          name: known?.values.find((candidate) => candidate.id === value)?.name ?? value,
          dimensionName: known?.name ?? dimensionId,
        },
      }
    }),
    // "Market any value" (FR-126): the item applies to a question about any market.
    ...item.scope.dimensions.map((dimensionId) => ({
      key: `${dimensionId}:*`,
      term: { kind: 'dimension' as const, name: dimension(dimensionId)?.name ?? dimensionId },
    })),
  ]

  return {
    today,
    area,
    owner,
    proposer,
    versions,
    retiredRow,
    latestAccepted,
    historyPending,
    links: links ?? undefined,
    linksPending,
    state,
    lookup,
    aboutLinks,
    itemKind: (id: string) => libraryItems.get(id)?.kind,
    canRecheck: permissions.canReview(item.areaId),
    canRetire: permissions.canRetire(item.areaId),
  }
}

export type ItemFacts = ReturnType<typeof useItemFacts>

/**
 * The item's one action group (FR-111, FR-112, FR-218, CON-211): the owner's check while
 * something asks for a look, Suggest a change, and Retire or Propose retirement in More.
 */
export function ItemActionGroup({
  item,
  facts,
  page = false,
  onChecked,
}: {
  item: ContextItem
  facts: ItemFacts
  page?: boolean
  /** Runs once the owner's check is recorded: the next item of the list it was opened from. */
  onChecked?: () => void
}) {
  return (
    <ItemActions
      itemId={item.id}
      page={page}
      onChecked={onChecked}
      canRetire={facts.canRetire}
      retired={item.status === 'retired'}
      check={
        facts.canRecheck && facts.state.conditions.warnings.length > 0
          ? { stillGoingOn: facts.state.stillGoingOn, highRisk: item.riskLevel === 'high' }
          : null
      }
    />
  )
}

/** The item's tabs, each with its name and, for History and Links, a count once it is known. */
export function itemTabItems(
  facts: ItemFacts,
): { value: ItemTab; label: string; count: ReactNode }[] {
  const count = (value: number | null) =>
    value === null || value === 0 ? null : <CountBadge count={value} />
  return (['read', 'source', 'history', 'links'] as const).map((value) => ({
    value,
    label: tabNames[value],
    count:
      value === 'history'
        ? count(facts.historyPending ? null : facts.versions.length)
        : value === 'links'
          ? count(facts.linksPending ? null : linkCount(facts.links))
          : null,
  }))
}

function evidenceHost(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/**
 * The contents of the Read, Source, History and Links tabs, as `TabsContent` panels for the
 * `Tabs` of the surface that shows them. `headingLevel` is 3 where the surface's own title is
 * an h2 (the docked panel).
 */
export function ItemTabPanels({
  item,
  facts,
  headingLevel = 2,
  className,
  detailsInRail = false,
}: {
  item: ContextItem
  facts: ItemFacts
  headingLevel?: 2 | 3
  detailsInRail?: boolean
  className?: string
}) {
  const { copyLinks } = useShellActions()
  const { state, today, area, owner, proposer, retiredRow, latestAccepted } = facts
  // What not to conclude, when someone wrote their own line: the default says what Cause says.
  const caveat = ownCaveat(item.notToConclude)
  const showsNextCheck =
    item.reviewDate !== null &&
    (state.conditions.lifecycle === 'accepted' || state.conditions.lifecycle === 'active_issue')

  return (
    <>
      <TabsContent value="read" className={className}>
        <Section title={firstSection[item.kind]} icon={TextAlignStartIcon} level={headingLevel}>
          <ItemText
            reading={detailsInRail}
            summary={item.summary}
            summaryMarkup={item.summaryMarkup}
            body={item.body}
            bodyMarkup={item.bodyMarkup}
            lookup={facts.lookup}
          />
        </Section>
        {caveat ? (
          <Section title={caveatWords.title} icon={CircleSlashIcon} level={headingLevel}>
            {/* The measure and type of the item's text above it (ItemText). */}
            <div
              className={cn(
                'flex max-w-prose flex-col gap-2',
                detailsInRail ? 'text-reading' : 'text-large',
              )}
            >
              <p data-slot="item-caveat" className="break-words">
                {caveat}
              </p>
              <p className="text-caption text-muted-foreground">{caveatWords.readers}</p>
            </div>
          </Section>
        ) : null}
        <Section title="Where it applies" icon={TargetIcon} level={headingLevel}>
          <ul className="flex flex-wrap gap-2" aria-label="Metrics, markets and other names">
            {facts.aboutLinks.map((about) => (
              <li key={about.key}>
                <Badge
                  form="outline"
                  className="hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                  render={previewRender(previewTargetOfAbout(about.key)!)}
                >
                  <ScopeTermLabel term={about.term} />
                </Badge>
              </li>
            ))}
          </ul>
        </Section>
      </TabsContent>

      <TabsContent value="source" className={className}>
        <Section title="Where this comes from" icon={QuoteIcon} level={headingLevel}>
          {item.evidence.map((evidence) => (
            <figure key={evidence.url} className="flex flex-col gap-2 border-l-2 pl-4">
              <blockquote
                className={detailsInRail ? 'max-w-prose text-reading' : 'max-w-prose text-body'}
              >
                “{evidence.quote}”
              </blockquote>
              <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-dense text-muted-foreground">
                <a
                  href={evidence.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-brand-ink underline underline-offset-4"
                >
                  {evidenceHost(evidence.url)}
                  <ExternalLinkIcon aria-hidden="true" className="size-icon-sm" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
                <span className="tabular-nums">{formatDay(evidence.date)}</span>
              </figcaption>
            </figure>
          ))}
        </Section>
        {detailsInRail ? (
          <Section title="What the details mean" icon={UserRoundIcon} level={headingLevel}>
            <div className="flex max-w-prose flex-col gap-3 text-reading">
              <p>{state.lifecycle.line}</p>
              <p>{state.source?.what ?? 'Its sources are in place and unchanged.'}</p>
              <p>{claimMeaning[item.claimLevel]}</p>
              <p>{riskMeaning[item.riskLevel]}</p>
            </div>
          </Section>
        ) : (
          <Section title="Who stands behind it" icon={UserRoundIcon} level={headingLevel}>
            <FieldTable label="Source details">
              <FieldRow
                icon={DatabaseIcon}
                label="Source"
                hint={state.source ? state.source.what : 'Its sources are in place and unchanged.'}
              >
                {state.source ? (
                  <StatusBadge status={state.source.flag} />
                ) : (
                  <Badge form="bare" quiet icon={HeedAcceptedIcon}>
                    In sync
                  </Badge>
                )}
              </FieldRow>
              {item.status === 'retired' ? (
                <FieldRow
                  icon={HeedRetiredIcon}
                  label="Archived"
                  hint={`${retiredRow ? `On ${formatDay(retiredRow.date)}. ` : ''}It stays in the history, and agents don't get it.`}
                >
                  {retiredRow?.by ?? 'Not recorded'}
                </FieldRow>
              ) : null}
              <FieldRow
                icon={BadgeCheckIcon}
                label="Confirmed"
                hint={
                  latestAccepted
                    ? `${formatDay(latestAccepted.date, 'long')} · version ${item.version}`
                    : `Version ${item.version}`
                }
              >
                {facts.historyPending ? 'Loading' : (latestAccepted?.by ?? 'Not recorded')}
              </FieldRow>
              <FieldRow icon={ScaleIcon} label="Cause" hint={claimMeaning[item.claimLevel]}>
                <ClaimBadge level={item.claimLevel} short />
              </FieldRow>
              <FieldRow icon={HeedRiskIcon} label="Risk" hint={riskMeaning[item.riskLevel]}>
                <RiskBadge level={item.riskLevel} />
              </FieldRow>
              <FieldRow icon={UsersIcon} label="Who can see it">
                <AudienceBadge audience={item.audience} />
              </FieldRow>
              {showsNextCheck && item.reviewDate ? (
                <FieldRow
                  icon={RotateCcwIcon}
                  label="Check again by"
                  hint={`${formatDay(item.reviewDate, 'long')}. ${
                    state.conditions.warnings.includes('stale')
                      ? 'It was due on this date.'
                      : 'An owner checks it again by this date.'
                  }`}
                >
                  <DateBadge date={item.reviewDate} today={today} deadline />
                </FieldRow>
              ) : null}
              <FieldRow icon={UserRoundIcon} label="Owner">
                {owner ? (
                  <PersonPreview personId={owner.id}>
                    <Owner
                      name={owner.name}
                      personId={owner.id}
                      initials={owner.initials}
                      size="lg"
                      role={area ? `Owner of ${area.name}` : undefined}
                    />
                  </PersonPreview>
                ) : (
                  <Owner name={null} size="lg" />
                )}
              </FieldRow>
              <FieldRow
                icon={PencilLineIcon}
                label="Written by"
                hint={channelText[item.createdVia]}
              >
                {proposer?.name ?? 'Someone'}
              </FieldRow>
              <FieldRow icon={HashIcon} label="Fact ID">
                <span className="inline-flex max-w-full items-center gap-1">
                  <span className="truncate font-mono text-caption">{item.id}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => copyLinks([item.id])}
                    aria-label="Copy a link to this fact"
                  >
                    <CopyIcon />
                  </Button>
                </span>
              </FieldRow>
            </FieldTable>
          </Section>
        )}
      </TabsContent>

      <TabsContent value="history" className={className}>
        <Section title="History" icon={HistoryIcon} level={headingLevel}>
          {facts.historyPending ? (
            <Loading label="Loading the history" />
          ) : (
            <HistoryTable rows={facts.versions} quiet={detailsInRail} />
          )}
        </Section>
      </TabsContent>

      <TabsContent value="links" className={className}>
        <Section title="Connections" icon={NetworkIcon} level={headingLevel}>
          {facts.linksPending ? (
            <Loading label="Loading the connections" />
          ) : (
            <ConnectedItems
              links={facts.links}
              itemKind={facts.itemKind}
              emptyAction={
                detailsInRail ? (
                  <Button variant="ghost" render={<Link to="/library" />}>
                    Browse the library
                  </Button>
                ) : undefined
              }
            />
          )}
        </Section>
      </TabsContent>
    </>
  )
}
