import { askQuestion } from '@/api/mock/data/ask'
import type { AnswerState, AskedRow } from '@/model/ask'
import { week } from '@/api/mock/data/inbox'
import { obsData } from '@/api/mock/data/observability'
import { groupCount, HIDE_UNDER, observability, type Topic } from '@/api/mock/obs-engine'
import { markets } from '@/api/mock/data/world'
import type { Fact } from '@/model/items'

// Asked this week: in place of fixed starters, what agents asked about most in the last 7 days, as
// topics and counts. The words of a question and who asked are never kept, so a row is a topic
// (a metric and a market, its months joined, as Questions groups them), and asking it asks about
// that topic. Its state is the one Ask gives now, from the same function that answers the click. A
// topic asked fewer than 5 times never shows, and a total never gives a month under 5 away.

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
    return { label: 'Write it', href: `/context/new?gap=${card}` }
  return t.gap.label === 'A suggestion waits'
    ? { label: 'Review it', href: t.gap.href }
    : { label: 'Open the card', href: t.gap.href }
}

export function askedThisWeek(pool?: Fact[]) {
  const obs = observability(obsData('normal'))
  const groups = obs.rollUp(obs.data.topics.map((t) => ({ ...t, counts: t.week })))
  const all = groups
    .map((g): AskedRow => {
      // A group has its rows: one, or a topic's months.
      const t = g.rows[0]!
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
