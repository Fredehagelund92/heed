import type { ReactNode } from 'react'
import * as z from 'zod/mini'
import { draftSchema, type Draft } from '@domain/draft'
import type { Area } from '@domain/item'
import { ownCaveat } from '@domain/proposal-rules'
import type { MarkedField, Provenance } from '@domain/provenance'
import type { Review } from '@/api'
import {
  HeedValidUntilIcon,
  CircleSlashIcon,
  ExternalLinkIcon,
  FileTextIcon,
  HeedRiskIcon,
  HeedDomainIcon,
  PencilIcon,
  QuoteIcon,
  ScaleIcon,
  ShapesIcon,
  TargetIcon,
  TextAlignStartIcon,
  type Icon,
} from '@/components/icons'
import { ClaimBadge, RiskBadge } from '@/components/item/fact-badges'
import { FieldRow, FieldTable } from '@/components/item/field-table'
import { DomainBadge, KindBadge } from '@/components/item/item-marks'
import { MentionText } from '@/components/mentions/mention-text'
import { ScopeTermLabel, scopeTermKind } from '@/components/mentions/scope-term'
import { previewRender } from '@/components/preview/preview-link'
import { ProvenanceSummary } from '@/components/proposal/attribution'
import { ProvenanceFlagBadge, ProvenanceMark } from '@/components/proposal/provenance-mark'
import { Badge } from '@/components/ui/badge'
import { formatDay } from '@/lib/library'
import { countMarks } from '@/lib/provenance'
import { targetsByKey, type MentionOption } from '@/lib/mention-targets'
import { previewTargetOf } from '@/lib/preview'
import { cn } from '@/lib/utils'
import { scopeKeys } from '@/lib/mention-targets'
import { useMentionTargets } from '@/lib/use-mention-targets'
import { lastDayFromEnd } from '@/lib/validity-range'

/*
  The Fields tab of a proposal (frame B, 3): what the proposal says, one row per field with the
  field's own icon, as the item page shows an accepted item. For a change to an accepted item,
  a changed row says so and shows what it said before, from the review's field diff; the
  fields the change leaves alone stay as they are.
*/

type Lookups = { targets: ReadonlyMap<string, MentionOption>; areas: readonly Area[] }

type FieldSpec = {
  id: string
  /** The field whose provenance mark the row shows (FR-121). */
  marked?: MarkedField
  label: string
  icon: Icon
  /** The draft fields the row shows; a change to any of them marks the row as changed. */
  fields: readonly (keyof Draft)[]
  render: (draft: Draft, lookups: Lookups) => ReactNode | null
}

function validityText(draft: Draft): string | null {
  const validity = draft.validity
  if (!validity?.start) return null
  const start = formatDay(validity.start)
  const last = lastDayFromEnd(validity.end)
  if (draft.kind === 'issue')
    return last ? `Started ${start}, ended ${formatDay(last)}` : `Started ${start}, still going on`
  return last ? `From ${start} to ${formatDay(last)} (last day)` : `From ${start}, no end date`
}

/**
 * A draft's link is free text until it is submitted, so only an http or https address becomes a
 * link; anything else (a `javascript:` address, a typo) shows as the text it is.
 */
export function webLink(url: string): { href: string; host: string } | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? { href: parsed.href, host: parsed.hostname }
      : null
  } catch {
    return null
  }
}

const specs: FieldSpec[] = [
  {
    id: 'kind',
    marked: 'kind',
    label: 'Kind',
    icon: ShapesIcon,
    fields: ['kind'],
    render: (draft) => (draft.kind ? <KindBadge kind={draft.kind} /> : null),
  },
  {
    id: 'summary',
    marked: 'summary',
    label: 'What happened',
    icon: TextAlignStartIcon,
    fields: ['summary', 'summaryMarkup', 'title'],
    render: (draft, { targets }) => {
      const markup = draft.summaryMarkup ?? draft.summary
      return markup ? (
        <p className="max-w-prose text-body break-words">
          <MentionText markup={markup} lookup={targets} />
        </p>
      ) : null
    },
  },
  {
    id: 'scope',
    marked: 'scope',
    label: 'Where it applies',
    icon: TargetIcon,
    fields: ['scope'],
    render: (draft, { targets }) => {
      const keys = draft.scope ? scopeKeys(draft.scope) : []
      if (!keys.length) return null
      return (
        <ul className="flex flex-wrap gap-2" aria-label="Metrics, dimensions and values">
          {keys.map((key) => {
            const option = targets.get(key)
            const kind = scopeTermKind(key)
            // A term chip opens its catalogue page and previews it; a metric group has no page.
            const preview = previewTargetOf(key)
            return (
              <li key={key}>
                <Badge
                  form="outline"
                  render={preview ? previewRender(preview) : undefined}
                  className={cn(
                    preview && 'hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
                  )}
                >
                  <ScopeTermLabel
                    term={{
                      kind,
                      name: option?.name ?? key,
                      dimensionName: kind === 'dimension_value' ? option?.detail : null,
                    }}
                  />
                </Badge>
              </li>
            )
          })}
        </ul>
      )
    },
  },
  {
    id: 'validity',
    marked: 'validity',
    label: 'When it applies',
    icon: HeedValidUntilIcon,
    fields: ['validity'],
    render: (draft) => validityText(draft),
  },
  {
    id: 'evidence',
    marked: 'evidence',
    label: 'Where this comes from',
    icon: QuoteIcon,
    fields: ['evidence'],
    render: (draft) => {
      const sources = (draft.evidence ?? []).filter((source) => source.url || source.quote)
      if (!sources.length) return null
      return (
        <div className="flex flex-col gap-3">
          {sources.map((source, index) => (
            <figure key={`${source.url}-${index}`} className="flex flex-col gap-1">
              {source.quote ? (
                <blockquote className="max-w-prose text-body">“{source.quote}”</blockquote>
              ) : null}
              <figcaption className="flex flex-wrap items-center gap-x-3 text-dense text-muted-foreground">
                {source.url
                  ? (() => {
                      const link = webLink(source.url)
                      return link ? (
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-brand-ink underline underline-offset-4"
                        >
                          {link.host}
                          <ExternalLinkIcon aria-hidden="true" className="size-icon-sm" />
                          <span className="sr-only">(opens in a new tab)</span>
                        </a>
                      ) : (
                        <span className="break-all">{source.url}</span>
                      )
                    })()
                  : null}
                {source.date ? (
                  <span className="tabular-nums">Read {formatDay(source.date)}</span>
                ) : null}
              </figcaption>
            </figure>
          ))}
        </div>
      )
    },
  },
  {
    id: 'domain',
    marked: 'areaId',
    label: 'Domain',
    icon: HeedDomainIcon,
    fields: ['areaId'],
    render: (draft, { areas }) => {
      const area = areas.find((candidate) => candidate.id === draft.areaId)
      return area ? <DomainBadge name={area.name} label={area.label} /> : null
    },
  },
  {
    id: 'claim',
    marked: 'claimLevel',
    label: 'Cause',
    icon: ScaleIcon,
    fields: ['claimLevel', 'claimAuthority', 'claimQuote'],
    render: (draft) => (draft.claimLevel ? <ClaimBadge level={draft.claimLevel} /> : null),
  },
  {
    id: 'risk',
    marked: 'riskLevel',
    label: 'Risk',
    icon: HeedRiskIcon,
    fields: ['riskLevel'],
    render: (draft) => (draft.riskLevel ? <RiskBadge level={draft.riskLevel} /> : null),
  },
  {
    id: 'notToConclude',
    marked: 'notToConclude',
    label: 'What not to conclude',
    icon: CircleSlashIcon,
    fields: ['notToConclude'],
    // The stored default says what the cause row already says, so only own words show (FR-104).
    render: (draft) => ownCaveat(draft.notToConclude),
  },
  {
    id: 'body',
    marked: 'body',
    label: 'Longer explanation',
    icon: FileTextIcon,
    fields: ['body', 'bodyMarkup'],
    render: (draft, { targets }) => {
      const markup = draft.bodyMarkup ?? draft.body
      return markup ? (
        <p className="max-w-prose text-body break-words whitespace-pre-line">
          <MentionText markup={markup} lookup={targets} />
        </p>
      ) : null
    },
  },
]

/** The diff's "before" values as a draft: each field that reads as the draft's own field. */
function beforeDraft(diff: Review['diff']): Draft {
  const shape = draftSchema.shape as Record<string, z.ZodMiniType | undefined>
  return Object.fromEntries(
    diff.flatMap(({ field, before }) => {
      const schema = shape[field]
      if (!schema || before === null) return []
      const parsed = z.safeParse(schema, before)
      return parsed.success ? [[field, parsed.data]] : []
    }),
  )
}

export function ProposalFields({
  draft,
  diff,
  change,
  areas,
  provenance = null,
  proposer,
}: {
  draft: Draft
  /** The review's field diff; for a change, the rows it names are marked as changed. */
  diff: Review['diff'] | null
  /** A change to an accepted item (not a new item). */
  change: boolean
  areas: readonly Area[]
  /** Where each field came from, when an AI app or the assistant wrote the draft (FR-121). */
  provenance?: Provenance | null
  /** Who proposed it, for the summary line of a drafted proposal. */
  proposer?: { name: string; you: boolean; submitted: boolean }
}) {
  const { targets } = useMentionTargets()
  const lookups: Lookups = { targets: targetsByKey(targets), areas }
  const changed = new Set(change && diff ? diff.map((entry) => entry.field) : [])
  const before = change && diff ? beforeDraft(diff) : {}
  const rows = specs.flatMap((spec) => {
    const value = spec.render(draft, lookups)
    const isChanged = spec.fields.some((field) => changed.has(field))
    if (value === null && !isChanged) return []
    const mark = provenance && spec.marked ? (provenance.fields[spec.marked] ?? null) : null
    return [{ spec, value, isChanged, mark }]
  })
  const table = (
    <FieldTable label="What the proposal says" wideLabels={Boolean(provenance)}>
      {rows.map(({ spec, value, isChanged, mark }) => {
        const previous = isChanged ? spec.render(before, lookups) : null
        const flags = provenance?.flags.filter((flag) => flag.field === spec.marked) ?? []
        return (
          <FieldRow
            key={spec.id}
            icon={spec.icon}
            label={spec.label}
            mark={
              provenance && mark ? (
                <ProvenanceMark mark={mark} by={provenance.by} where="review" />
              ) : null
            }
            wrote={mark === 'prefilled'}
          >
            {isChanged ? (
              <Badge form="soft" tone="info" size="sm" icon={PencilIcon}>
                Changed
              </Badge>
            ) : null}
            {value ?? <span className="text-muted-foreground">Not filled in</span>}
            {isChanged ? (
              <div className="flex flex-col gap-1 text-dense text-muted-foreground">
                <span className="text-caption font-bold">Before</span>
                {previous ?? 'Not filled in'}
              </div>
            ) : null}
            {flags.length ? (
              <span className="flex flex-wrap items-center gap-1" data-slot="row-provenance">
                {flags.map((flag) => (
                  <ProvenanceFlagBadge key={flag.code} flag={flag} />
                ))}
              </span>
            ) : null}
          </FieldRow>
        )
      })}
    </FieldTable>
  )
  if (!provenance || !proposer) return table
  const counts = countMarks(rows.flatMap(({ mark }) => (mark ? [mark] : [])))
  return (
    <div className="flex flex-col gap-3">
      <ProvenanceSummary
        provenance={provenance}
        person={proposer.name}
        you={proposer.you}
        counts={counts}
        submitted={proposer.submitted}
        marked={counts.wrote > 0}
      />
      {table}
    </div>
  )
}
