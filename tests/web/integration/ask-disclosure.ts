import { domains } from '@/api/mock/data/world'
import type { HeedApi } from '@/api/client'
import type { ObsData } from '@/model/observability'

/*
  What each person may see of what agents asked (FR-614), from the pages themselves: their own
  Observability page for its topics, and for any other the strictest view an owner of its domain
  has, or the administrators' where it has no owner. The differential tests hold Ask's counts to it,
  and the evaluation harness holds every reply to it.
*/

/** A topic as Ask names it. */
const titleOf = (t: ObsData['topics'][number]) =>
  [t.metric, t.where === 'All markets' ? '' : t.where].filter(Boolean).join(' in ')

/** How much of a count a page shows: the count, or only a floor; null for none. */
export type Cell = { count: number | null; atLeast: number } | null

/** The stricter of two: exact shows more than a floor, and hidden least. */
const stricter = (a: Cell, b: Cell): Cell => {
  if (!a || !b) return null
  if (a.count !== null && b.count !== null) return a
  return { count: null, atLeast: Math.min(a.count ?? a.atLeast, b.count ?? b.atLeast) }
}

export const ADMIN = 'Ravi Kapoor'

export function disclosure(as: (name: string) => Promise<HeedApi>) {
  /** A person's own page, by what Ask names each subject, or null for someone who has no page. */
  const pageOf = async (name: string) => {
    const api = await as(name)
    const page = await api.observabilityPage({ section: 'questions', range: 7 }).catch(() => null)
    if (!page) return null
    const cells = new Map<string, { domain: string | null; cell: Cell }>()
    for (const s of page.subjects) {
      const first = page.topics.find((t) => s.topics.includes(t.id))!
      cells.set(titleOf(first), {
        domain: first.domain ?? null,
        cell: { count: s.total, atLeast: s.atLeast },
      })
    }
    return cells
  }

  /** What this person may see of each topic the administrators' page lists. */
  const expectedRows = async (name: string) => {
    const mine = await pageOf(name)
    const owners = await Promise.all(
      Object.entries(domains).flatMap(([id, d]) =>
        d.owners.map(async (owner) => ({ id, page: await pageOf(owner) })),
      ),
    )
    const admin = await pageOf(ADMIN)
    const rows = new Map<string, Cell>()
    for (const [title, { domain }] of admin!) {
      // A topic of the person's own view is that page's number.
      if (mine?.has(title)) {
        rows.set(title, mine.get(title)!.cell)
        continue
      }
      // Any other is the strictest view an owner of its domain has, and the administrators' with none.
      const own = owners.filter((o) => `area_${o.id}` === domain)
      const views = own.length ? own.map((o) => o.page) : [admin]
      rows.set(
        title,
        views.map((v) => v?.get(title)?.cell ?? null).reduce((a, b) => stricter(a, b)),
      )
    }
    return rows
  }

  return { pageOf, expectedRows }
}
