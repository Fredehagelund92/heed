import { askQuestion, type AnswerState } from '@/data/ask'
import { week } from '@/data/inbox'
import { groupCount, HIDE_UNDER, rollUp, TOPICS, type Topic } from '@/data/observability'
import { markets, type Fact } from '@/data/world'

// Asked this week: in place of fixed starters, what agents asked about most in the last 7 days, as
// topics and counts. The words of a question and who asked are never kept, so a row is a topic
// (a metric and a market, its months joined, as Questions groups them), and asking it asks about
// that topic. Its state is the one Ask gives now, from the same function that answers the click. A
// topic asked fewer than 5 times never shows, and a total never gives a month under 5 away.

/** How many topics show at first; the rest open in place under More asked this week. */
export const ASKED_ROWS = 4

export type AskedRow = {
  topic: Topic
  /** What the row says: "Orders in Norway". */
  title: string
  /** What a click asks. */
  question: string
  /** How often, for sorting: the total, or what its shown months add up to. */
  times: number
  /** How often, as shown: "31", or "13+" when a month under 5 would be given away. */
  count: string
  state: AnswerState
  sources: number
  /** For an owner of the topic's domain, on a Not found row: the draft or the suggestion that waits. */
  next?: { label: string; href: string }
}

export const questionAbout = (
  t: Pick<Topic, 'metric' | 'where'> & Partial<Pick<Topic, 'named'>>,
) =>
  t.named === 'none' || !t.metric
    ? `What should I know about ${t.where}?`
    : `What should I know about ${t.metric} ${markets.includes(t.where) ? 'in' : t.where === 'All markets' ? 'in' : 'for'} ${t.where === 'All markets' ? 'all markets' : t.where}?`

function nextOf(t: Topic, state: AnswerState): AskedRow['next'] {
  if (state !== 'missing' || !t.gap) return undefined
  const card = t.gap.href.match(/card=([\w-]+)/)?.[1]
  // A draft waits: Write it opens that draft, never a blank page. A suggestion waits: review it.
  if (t.gap.label === 'Draft ready' && card)
    return { label: 'Write it', href: `#/context/new?gap=${card}` }
  return t.gap.label === 'A suggestion waits'
    ? { label: 'Review it', href: t.gap.href }
    : { label: 'Open the card', href: t.gap.href }
}

export function askedThisWeek(pool?: Fact[]) {
  const groups = rollUp(TOPICS.map((t) => ({ ...t, counts: t.week })))
  const all = groups
    .map((g): AskedRow => {
      const t = g.rows[0]
      const question = questionAbout(t)
      const a = askQuestion(question, pool)
      return {
        topic: t,
        title: g.name,
        question,
        times: g.visible ?? g.shown,
        count: groupCount(g),
        state: a.state,
        sources: a.sources.length,
        next: nextOf(t, a.state),
      }
    })
    .sort((a, b) => b.times - a.times)
  const shown = all.filter((r) => r.times >= HIDE_UNDER)
  return {
    /** Every topic asked 5 times or more, most asked first. */
    rows: shown,
    /** Calls about topics asked fewer than 5 times: counted, never shown. */
    hidden: groups
      .filter((g) => (g.visible ?? g.shown) < HIDE_UNDER)
      .reduce((n, g) => n + g.total, 0),
    asked: week.asked,
  }
}
