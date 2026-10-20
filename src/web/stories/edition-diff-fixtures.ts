import { changeSentence, noChanges } from '@domain/editions'
import type { EditionComparison, ItemComparison } from '@/lib/edition-diff'
import type { DiffLookups } from '@/components/review/field-diff'
import { areas, people, vocabulary } from '@/mocks/reference-data'
import { buildMentionTargets, targetsByKey } from '@/lib/mention-targets'

export const editionDiffLookups: DiffLookups = {
  areas,
  targets: targetsByKey(buildMentionTargets({ vocabulary, areas })),
  nameOf: (id) => people.find((person) => person.id === id)?.name ?? null,
}

/** Endpoint-shaped examples, using the real-flow scout's changed text and decisions. */
export const changedComparison: ItemComparison = {
  from: '2026-10-07.2',
  to: '2026-10-10.10',
  backwards: false,
  change: {
    itemId: 'itm_editions1',
    change: 'changed',
    kind: 'note',
    title: 'Online share lags by one day in the source tool',
    areaId: 'area_sales',
    riskLevel: 'high',
    from: { version: 1, versionId: 'version-before' },
    to: { version: 3, versionId: 'version-after' },
    why: {
      proposal: { id: 'proposal-example', number: 42 },
      proposerId: 'per_maria',
      channel: 'form',
      editedBy: null,
      decisions: [
        {
          decidedBy: 'per_jon',
          capacity: 'owner',
          outcome: 'accept',
          reason: 'Confirmed the delay with the source owner.',
          decidedAt: '2026-10-10T12:00:00Z',
        },
      ],
    },
  },
  fields: [
    {
      field: 'summary',
      before: 'Online share lags by one day in the source tool.',
      after:
        'Online share lags by two days in the source tool. Check the source before comparing markets.',
      systemFilled: false,
    },
    {
      field: 'scope',
      before: { metrics: ['metric:orders'], dimensions: [], dimensionValues: [] },
      after: {
        metrics: ['metric:orders', 'metric:marketing_spend'],
        dimensions: [],
        dimensionValues: [],
      },
      systemFilled: false,
    },
    {
      field: 'validity',
      before: { start: '2026-06-15', end: null },
      after: { start: '2026-06-15', end: '2026-09-03' },
      systemFilled: false,
    },
    { field: 'riskLevel', before: 'normal', after: 'high', systemFilled: false },
    {
      field: 'evidence',
      before: [],
      after: [
        {
          url: 'https://example.com/source-update',
          quote: 'The source now reports two days behind.',
          date: '2026-10-10',
        },
      ],
      systemFilled: false,
    },
    {
      field: 'references',
      before: ['cube:segments.market'],
      after: ['cube:segments.market', 'cube:measures.orders'],
      systemFilled: true,
    },
    {
      field: 'changeMarks',
      before: { 'cube:segments.market': 'old' },
      after: { 'cube:segments.market': 'new' },
      systemFilled: true,
    },
    {
      field: 'summaryMarkup',
      before: 'Online share lags by one day in the source tool.',
      after:
        'Online share lags by two days in the source tool. Check the source before comparing markets.',
      systemFilled: true,
    },
  ],
  mentions: { added: [], removed: [] },
  steps: [],
}

export function comparisonState(
  change: NonNullable<ItemComparison['change']>['change'],
): ItemComparison {
  const item = changedComparison.change!
  if (change === 'changed') return structuredClone(changedComparison)
  const content = changedComparison.fields.filter((field) => !field.systemFilled)
  const oneSided = change === 'added' || change === 'retired' || change === 'removed'
  return {
    ...structuredClone(changedComparison),
    change: {
      ...item,
      change,
      from: change === 'added' ? null : item.from,
      to: change === 'retired' || change === 'removed' ? null : item.to,
      why:
        change === 'resaved'
          ? { proposal: null, proposerId: null, channel: 'import', editedBy: null, decisions: [] }
          : {
              ...item.why,
              decisions: item.why.decisions.map((decision) => ({
                ...decision,
                outcome: change === 'retired' ? 'retire' : 'accept',
              })),
            },
    },
    fields: oneSided
      ? content.map((field) => ({
          ...field,
          before: change === 'added' ? null : field.after,
          after: change === 'added' ? field.after : null,
        }))
      : change === 'checked'
        ? changedComparison.fields.filter((field) => field.field === 'changeMarks')
        : [],
  }
}

/** A paged response still carries the full range's sentence and counts. */
const summaryCounts = { ...noChanges(), changed: 12 }
const summaryEdition: EditionComparison['to'] = {
  seq: 12,
  label: '2026-10-10.10',
  reason: 'proposal_accepted',
  actorId: 'per_jon',
  note: null,
  restores: null,
  digest: null,
  sealedAt: '2026-10-10T12:00:00Z',
  createdAt: '2026-10-10T12:00:00Z',
  live: true,
}
export const pagedComparison: EditionComparison = {
  from: { ...summaryEdition, seq: 4, label: '2026-10-07.2', live: false },
  to: summaryEdition,
  backwards: false,
  editions: 8,
  sentence: changeSentence({
    reason: null,
    counts: summaryCounts,
    areas: ['Sales'],
    vocabulary: 0,
    editions: 8,
  }),
  facets: {
    change: summaryCounts,
    areas: [{ areaId: 'area_sales', count: 12 }],
    kinds: [{ kind: 'note', count: 12 }],
    risks: [{ riskLevel: 'high', count: 12 }],
  },
  vocabulary: 0,
  withheld: 0,
  total: 12,
  limit: 1,
  offset: 0,
  items: [
    { ...changedComparison.change!, fields: changedComparison.fields.map((field) => field.field) },
  ],
}
