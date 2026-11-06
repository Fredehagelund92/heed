import type { DecideNames, NamesDecision, NamesRead } from '@contract/inbox'
import { contentDigest } from '@domain/canonical'
import { nameRefusal, sourceNames, type WordHolders } from '@domain/source-names'
import type { CandidateMember } from '@domain/term-candidates'
import { termName } from '@domain/terms'
import { ApiError } from '@/api/errors'
import { namesWords, type InboxCard } from '@/model/inbox'

// The names a read makes in the mock (FR-141): the same rules as the service, on the members of an
// invented shop's dbt project. They wait once a definitions tool is connected, or with
// ?demo=names. Accepting one takes it off the list; the mock's vocabulary is the demo's own, so
// nothing else changes. Kept until the page reloads.

const member = (
  name: string,
  title: string | null,
  extra: Partial<CandidateMember> = {},
): CandidateMember => ({
  ref: `dbt:${name}`,
  source: 'dbt',
  kind: 'metric',
  name,
  title,
  description: null,
  valueType: 'count',
  areaHint: 'sales',
  synonyms: [],
  baseName: null,
  mergeDimensions: 'never',
  ...extra,
})

const shop: CandidateMember[] = [
  member('orders.completed_orders', 'Completed orders', {
    description: 'Orders that were paid and sent.',
  }),
  member('orders.basket_value', 'Basket value', { description: 'Average value of an order.' }),
  member('orders.total', 'Total'),
  member('refunds.total', 'Total'),
  member('orders.ship_method', null, { kind: 'dimension', valueType: 'categorical' }),
  member('orders.paid_at', 'Paid at', { kind: 'dimension', valueType: 'time' }),
]

/** The words that mean something else in the mock's demo: the demo has its own Orders. */
const holders: WordHolders = new Map([
  ['basket value', [{ origin: 'vocabulary', ref: 'metric:aov', name: 'Average order value' }]],
])

export function createMockNames() {
  let waiting = false
  const taken = new Set<string>()
  const left = new Set<string>()

  const names = () =>
    waiting
      ? sourceNames(
          shop.filter((m) => !taken.has(m.ref)),
          [],
          holders,
          left,
        )
      : []
  const read = async (): Promise<NamesRead> => {
    const shown = names().map(
      ({ source: _source, views: _views, valueType: _type, suggested: _s, ...name }) => ({
        ...name,
        tool: 'dbt',
      }),
    )
    return { revision: await contentDigest(shown), names: shown }
  }
  return {
    /** A read of a definitions tool ended. */
    load: () => {
      waiting = true
    },
    read,
    card(me: string): InboxCard | null {
      const list = names()
      const ready = list.filter((n) => n.state === 'ready').length
      const flagged = list.filter((n) => n.state === 'flagged').length
      if (!ready && !flagged) return null
      const counts = { ready, flagged, tools: ['dbt'] }
      return {
        id: 'names:waiting',
        type: 'names',
        domain: 'sales',
        for: me,
        when: 'Today',
        ...namesWords(counts),
        detail: '',
        primary: 'Review',
        secondary: [],
        names: counts,
      }
    },
    async decide(input: DecideNames): Promise<NamesDecision> {
      if ((await read()).revision !== input.revision)
        throw new ApiError('conflict', 'The names changed after you opened them.')
      const list = names()
      const chosen = new Map(
        input.accept.map(({ key, name }) => [
          key,
          termName(name ?? list.find((n) => n.key === key)?.name ?? key),
        ]),
      )
      const going = new Map(
        [...chosen].map(([key, name]) => [
          key,
          [name, ...(list.find((n) => n.key === key)?.aliases ?? [])],
        ]),
      )
      for (const [key, name] of chosen) {
        const refused = nameRefusal(key, name, holders, going)
        if (refused) throw new ApiError('invalid', refused)
      }
      for (const key of chosen.keys())
        list
          .find((n) => n.key === key)
          ?.definitionRefs.forEach((ref) => {
            taken.add(ref)
            left.delete(ref)
          })
      for (const key of input.leaveOut)
        list.find((n) => n.key === key)?.definitionRefs.forEach((ref) => left.add(ref))
      return {
        edition: chosen.size ? 'today.1' : null,
        accepted: chosen.size,
        leftOut: input.leaveOut.length,
      }
    },
  }
}
