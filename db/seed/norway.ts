import type { ContextItem } from '../../src/domain/item.ts'
import { generateItems } from '../../src/web/mocks/items.ts'
import { demoTestQuestions } from './test-questions.ts'

/*
  The Norway show (docs/demo.md): the demo library with a clean slate where the show's story
  happens. On the demo seed an AI app asking about orders in Norway or Spain in October
  2026 already gets general notes on orders, so neither question starts from nothing, and a
  search by words finds the demo's invented stops on online sales to those two markets on other
  days, which contradict the one Maria writes. The show library leaves out the items that would
  answer either question and those stops, and nothing else: Try it finds nothing for Norway
  until Maria writes the fact, her stop is the only one, and Spain stays an honest "nothing
  written down" all through the show. `npm run demo` seeds it (scripts/demo.ts), and the daily check
  (tests/demo) fails when either question stops starting from nothing.
*/

/** What the show asks about: one metric, two markets and one month, by the library's ids. */
export const norwayShow = {
  metric: 'orders',
  markets: ['norway', 'spain'],
  /** The month asked about, with an exclusive end, as validity has it. */
  window: { from: '2026-10-01', until: '2026-11-01' },
  questions: {
    norway: 'How did orders in Norway change in October 2026?',
    spain: 'How did orders in Spain change in October 2026?',
  },
} as const

/**
 * Whether an item could be given for the show's questions: about orders (or every metric), in
 * Norway or Spain (or every market), and valid at some time in October 2026. It reads wide
 * on purpose: leaving out one item too many changes nothing the show tells.
 */
export function answersTheShow(item: ContextItem): boolean {
  const { metrics, dimensions, dimensionValues } = item.scope
  const metric = !metrics.length || metrics.includes(norwayShow.metric)
  const markets = dimensionValues.filter((value) => value.dimension === 'market')
  const market =
    dimensions.includes('market') ||
    !markets.length ||
    markets.some((value) => (norwayShow.markets as readonly string[]).includes(value.value))
  const { start, end } = item.validity
  const valid = start < norwayShow.window.until && (end === null || end > norwayShow.window.from)
  return metric && market && valid
}

/** Whether an item says online sales stopped in Norway or Spain, on any day. */
export function stopsTheShowMarkets(item: ContextItem): boolean {
  return (
    /^Online sales to (Norway|Spain) stopped/.test(item.title) &&
    item.scope.dimensionValues.some(
      (value) =>
        value.dimension === 'market' &&
        (norwayShow.markets as readonly string[]).includes(value.value),
    )
  )
}

/**
 * The demo library (generateItems) without what would muddle the show's story. An item a test
 * question expects stays, so the demo's quality history is the demo seed's.
 */
export function norwayLibrary(): ContextItem[] {
  const expected = new Set(
    demoTestQuestions.flatMap(({ question }) => question.expected?.must_deliver ?? []),
  )
  return generateItems().filter(
    (item) => expected.has(item.id) || (!answersTheShow(item) && !stopsTheShowMarkets(item)),
  )
}
