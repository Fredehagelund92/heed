import type { ClashRelation } from '@domain/clash-relations'
import { readinessFrom, readinessWords, type ReadinessFacts } from '@domain/readiness'
import { claimsToCheck, type Readiness, type Review } from '@/model/review'

// The Ready line for a mock review, which has no document diff to read it from. The service decides
// the line from the diff (src/domain/readiness.ts); the mock reads the same facts off the review it
// has and hands them to the same rules, so the demo and the service cannot say different things.

const domainRelation: Record<
  NonNullable<Review['clash']>['items'][number]['relation'] & string,
  ClashRelation
> = { replaces: 'replaces', disagree: 'disagrees', unrelated: 'unrelated' }

/** What the Ready line reads of a review: everything but the Fields table and the versions. */
type Source = Omit<Review, 'ready' | 'fields' | 'versions'>

/** The facts the Ready line is decided from, as a review shows them. */
function factsOf(r: Source): ReadinessFacts {
  const newSource = r.blocks.some((b) => b.kind === 'Link' && 'after' in b)
  const unanswered = r.clash?.items.some((c) => !c.relation)
  const answer = r.clash?.items[0]?.relation
  return {
    drafted: !!r.drafted,
    claimsToCheck: claimsToCheck(r),
    clash: r.clash ? { relation: unanswered || !answer ? null : domainRelation[answer] } : null,
    mode: r.mode,
    withdrawn: !!r.retire?.withdrawn,
    unsourced:
      r.mode !== 'edit' || newSource
        ? []
        : r.moved.filter((m) => /number|date/i.test(m.label)).map((m) => m.after),
    newLink: newSource,
    only: r.formattingOnly
      ? 'formatting'
      : r.counts.every((c) => c.kind === 'Order')
        ? 'order'
        : null,
    synced: !!r.synced,
  }
}

export function readyOf(r: Source): Readiness {
  const ready = readinessFrom(factsOf(r))
  const { title, text } = readinessWords(ready, {
    ...(r.retire?.withdrawn ? { withdrawnBy: r.retire.withdrawn.by } : {}),
    diff: {
      counts: r.counts.map((c) => ({ kind: c.kind.toLowerCase() as 'link', n: c.n })),
    },
    clashes: r.clash?.items.length ?? 0,
  })
  return { ok: ready.ok, bulk: ready.bulk, title, text }
}
