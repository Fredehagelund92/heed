import * as React from 'react'
import {
  HIDE_UNDER,
  monthName,
  SHOWN,
  STATE_WORDS,
  type Shown,
  type Topic,
} from '@/data/observability'
import { domains, type DomainId } from '@/data/world'

// Questions' filters and saved views. A view belongs to the workspace, as LangSmith's do: saved
// once, everyone with access sees it as a tab. Five come with it; more are saved from the filters.

export type Gap = 'draft' | 'suggestion' | 'none'
export type Filters = {
  answer?: Shown[]
  domain?: DomainId
  agent?: string
  gap?: Gap[]
  month?: string
}
export type SavedView = {
  id: string
  name: string
  filters: Filters
  by?: string
  custom?: boolean
}

/** The five every workspace starts with: what most often needs a look. */
export const BUILT_IN: (SavedView & { has: (t: Topic) => boolean })[] = [
  { id: 'all', name: 'All topics', filters: {}, has: () => true },
  { id: 'not-covered', name: 'Not found', filters: {}, has: (t) => t.week.missing >= 3 },
  { id: 'disagree', name: 'Conflict', filters: {}, has: (t) => t.week.conflict > 0 },
  { id: 'stale', name: 'Outdated', filters: {}, has: (t) => t.week.stale > 0 },
  { id: 'reported', name: 'Reported', filters: {}, has: (t) => !!t.reported },
]

let custom: SavedView[] = []
const listeners = new Set<() => void>()

export function useSavedViews() {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => custom,
  )
}

export function saveView(name: string, filters: Filters, by: string) {
  const id = `v-${custom.length + 1}`
  custom = [...custom, { id, name, filters, by, custom: true }]
  listeners.forEach((l) => l())
  return id
}

export function removeView(id: string) {
  custom = custom.filter((v) => v.id !== id)
  listeners.forEach((l) => l())
}

/** A topic's gap, as the Gap status filter reads it. */
export const gapOf = (t: Topic): Gap | undefined =>
  t.gap?.label === 'Draft ready'
    ? 'draft'
    : t.gap?.label === 'A suggestion waits'
      ? 'suggestion'
      : t.gap || t.week.missing >= HIDE_UNDER
        ? 'none'
        : undefined
export const GAP_WORDS: Record<Gap, string> = {
  draft: 'Draft ready',
  suggestion: 'A suggestion waits',
  none: 'No draft yet',
}

/** Whether a topic passes the filters (the time and the search are applied apart). */
export function passes(t: Topic & { counts: Record<Shown, number> }, f: Filters) {
  if (f.domain && t.domain !== f.domain) return false
  if (f.month && t.month !== f.month) return false
  if (f.answer?.length && !f.answer.some((s) => t.counts[s] > 0)) return false
  if (f.gap?.length && !f.gap.includes(gapOf(t) as Gap)) return false
  return true
}

/** The filters read back as a sentence, the way Context and Definitions say theirs. */
export function sentence(f: Filters) {
  return [
    f.answer?.length &&
      `Answer is ${f.answer.length > 1 ? 'any of ' : ''}${f.answer.map((s) => STATE_WORDS[s]).join(', ')}`,
    f.domain && `Domain is ${domains[f.domain].name}`,
    f.agent && `Agent is ${f.agent}`,
    f.gap?.length &&
      `In the Inbox is ${f.gap.length > 1 ? 'any of ' : ''}${f.gap.map((g) => GAP_WORDS[g]).join(', ')}`,
    f.month && `Month is ${monthName(f.month)}`,
  ].filter(Boolean) as string[]
}

/** The filters from the address: "answer=missing,partial", or "found" for everything written down. */
export function filtersFrom(q: URLSearchParams): Filters {
  const a = q.get('answer')
  const answer =
    a === 'found'
      ? (SHOWN.filter((s) => s !== 'missing') as Shown[])
      : (a?.split(',').filter((s): s is Shown => (SHOWN as string[]).includes(s)) ?? undefined)
  const gap = q
    .get('gap')
    ?.split(',')
    .filter((g): g is Gap => ['draft', 'suggestion', 'none'].includes(g))
  return {
    answer: answer?.length ? answer : undefined,
    domain: (q.get('domain') as DomainId) || undefined,
    agent: q.get('agent') || undefined,
    gap: gap?.length ? gap : undefined,
    month: /^\d{4}-\d{2}$/.test(q.get('month') ?? '') ? q.get('month')! : undefined,
  }
}

/** The same filters, back into the address. */
export function filtersTo(f: Filters): Record<string, string | undefined> {
  return {
    answer: f.answer?.join(','),
    domain: f.domain,
    agent: f.agent,
    gap: f.gap?.join(','),
    month: f.month,
  }
}
