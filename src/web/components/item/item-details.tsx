import type { ContextItem } from '@domain/item'
import { AudienceBadge, ClaimBadge, RiskBadge } from '@/components/item/fact-badges'
import { StatusBadge } from '@/components/item/item-marks'
import type { ItemFacts } from '@/components/item/item-parts'
import { DetailsList } from '@/components/page/details-list'
import { PersonPreview } from '@/components/preview/preview-link'
import { channelText, formatDay } from '@/lib/library'

/** Facts remain available on every tab; Source explains their meaning. */
type DetailFacts = Pick<
  ItemFacts,
  'state' | 'owner' | 'proposer' | 'latestAccepted' | 'historyPending' | 'retiredRow'
>

type Row = Parameters<typeof DetailsList>[0]['rows'][number]

/** The fact's details: where it stands, when it applies, its check date, source, cause and risk. */
export function itemDetailRows(item: ContextItem, { state }: Pick<DetailFacts, 'state'>): Row[] {
  return [
    { label: 'Status', value: state.lifecycle.title, hint: state.lifecycle.line },
    { label: 'When it applies', value: state.chip.label + state.chip.tail },
    {
      label: 'Check again by',
      value: state.nextCheck && item.reviewDate ? formatDay(item.reviewDate, 'long') : 'Not set',
    },
    {
      label: 'Source',
      hint: state.source?.what ?? 'Its sources are in place and unchanged.',
      value: state.source ? <StatusBadge status={state.source.flag} size="sm" /> : 'In sync',
    },
    { label: 'Cause', value: <ClaimBadge level={item.claimLevel} short /> },
    { label: 'Risk', value: <RiskBadge level={item.riskLevel} /> },
    { label: 'Who can see it', value: <AudienceBadge audience={item.audience} /> },
  ]
}

/** The fact's people: its owner, who wrote it, who confirmed it and who archived it. */
export function itemPeopleRows(item: ContextItem, facts: DetailFacts): Row[] {
  const { owner, proposer, latestAccepted } = facts
  return [
    {
      label: 'Owner',
      value: owner ? (
        <PersonPreview personId={owner.id}>{owner.name}</PersonPreview>
      ) : (
        'Not assigned'
      ),
    },
    {
      label: 'Written by',
      hint: channelText[item.createdVia],
      value: proposer ? (
        <PersonPreview personId={proposer.id}>{proposer.name}</PersonPreview>
      ) : (
        'Not recorded'
      ),
    },
    {
      label: 'Confirmed',
      value: facts.historyPending ? (
        'Loading'
      ) : latestAccepted ? (
        <span>
          {latestAccepted.by}
          <br />
          <span className="text-caption text-muted-foreground">
            {formatDay(latestAccepted.date, 'long')}
          </span>
        </span>
      ) : (
        'Not recorded'
      ),
    },
    ...(facts.retiredRow ? [{ label: 'Archived by', value: facts.retiredRow.by }] : []),
  ]
}

export function ItemDetails({ item, facts }: { item: ContextItem; facts: DetailFacts }) {
  return (
    <>
      <section aria-label="Details" className="flex flex-col gap-3">
        <h2 className="text-body font-bold">Details</h2>
        <DetailsList label="Details" rows={itemDetailRows(item, facts)} />
      </section>
      <section
        aria-label="People"
        className="flex flex-col gap-3 border-t border-border-subtle pt-4"
      >
        <h2 className="text-body font-bold">People</h2>
        <DetailsList label="People" rows={itemPeopleRows(item, facts)} />
      </section>
      <section aria-label="Fact" className="flex flex-col gap-3 border-t border-border-subtle pt-4">
        <h2 className="text-body font-bold">Fact</h2>
        <DetailsList label="Fact" rows={[{ label: 'Version', value: item.version }]} />
      </section>
    </>
  )
}
