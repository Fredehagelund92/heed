import { stateLabel, type Answer } from '@/model/ask'
import { servedToAgents, type Fact } from '@/model/items'
import { monthName, monthShort, observability, type Topic } from '@/model/observability'
import { NEXT, type ReplayStep, type When } from '@/model/replay'
import { answerFor } from './data/ask'
import { obsData } from './data/observability'
import { facts as allFacts } from './data/world'

const { topicName } = observability(obsData('normal'))

// The mock's replay of a topic: the same lookup Ask runs (data/ask.ts), in about 30 ms, for free.

/** The publish a replay can be compared with: what agents got before it. */
export const BEFORE = {
  label: 'Before 20 Oct',
  title: 'Units sold excludes test accounts',
  factId: 'itm_s90n5xps',
  summary: 'Units sold in Norway leaves out the accounts our teams use to test the webshop.',
}

const MS = [3, 11, 2, 4, 6, 1]

export function replay(t: Topic, when: When = 'now', pool: Fact[] = allFacts) {
  const facts =
    when === 'before'
      ? pool.map((f) => (f.id === BEFORE.factId ? { ...f, summary: BEFORE.summary } : f))
      : pool
  const markets = t.where === 'All markets' ? [] : [t.where]
  const month = monthName(t.month)
  const answer: Answer = answerFor(
    `What should I know about ${topicName(t)} in ${month}?`,
    t.metric,
    markets,
    month,
    { pool: facts },
  )
  const used = answer.sources.map((id) => facts.find((f) => f.id === id)!).filter(Boolean)
  // What is about the metric but didn't reach the agent, and why.
  const left = facts
    .filter((f) => f.where.includes(t.metric) && !answer.sources.includes(f.id))
    .map((f) => ({
      id: f.id,
      title: f.title,
      why:
        f.status === 'Draft'
          ? 'is a draft, not published'
          : !servedToAgents(f)
            ? 'is archived'
            : `is about ${f.where.filter((w) => w !== t.metric).join(', ') || 'something else'}`,
    }))
    .slice(0, 3)
  const n = (k: number, one: string) => `${k} ${k === 1 ? one : `${one}s`}`
  const steps: ReplayStep[] = [
    {
      key: 'scope',
      title: 'Read the scope',
      ms: MS[0],
      text: 'The dates were read from the question, and kept as a scope. The words are not kept.',
      scope: [
        { label: t.metric, kind: 'metric' },
        { label: t.where, kind: 'market' },
        { label: monthDays(t.month), kind: 'dates' },
      ],
    },
    {
      key: 'looked',
      title: 'Looked for context',
      ms: MS[1],
      text: `${n(used.length, 'context item')} ${used.length === 1 ? 'applies' : 'apply'} to ${topicName(t)} in ${month}.`,
      items: used.map((f) => ({ id: f.id, title: f.title })),
    },
    {
      key: 'left',
      title: 'Left out',
      ms: MS[2],
      text: left.length
        ? `${n(left.length, 'item')} did not reach the agent.`
        : 'Nothing about it was left out.',
      items: left,
    },
    { key: 'checked', title: 'Checked', ms: MS[3], text: stateLabel[answer.state] },
    { key: 'said', title: 'Said', ms: MS[4], text: answer.said },
    { key: 'next', title: 'Told the agent what to do next', ms: MS[5], text: NEXT[answer.state] },
  ]
  return { answer, steps, ms: MS.reduce((a, b) => a + b, 0) }
}

/** The steps that read differently before the publish, to mark them in a compare. */
export function changedSteps(t: Topic, pool: Fact[] = allFacts) {
  const now = replay(t, 'now', pool).steps
  const before = replay(t, 'before', pool).steps
  return now
    .filter(
      (s, i) =>
        s.text !== before[i]!.text || JSON.stringify(s.items) !== JSON.stringify(before[i]!.items),
    )
    .map((s) => s.key)
}

/** A month as the dates read from a question: "1 to 30 Sep 2026". */
function monthDays(m: string) {
  const [y = 0, mo = 0] = m.split('-').map(Number)
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  const [name, year] = monthShort(m).split(' ')
  return `1 to ${last} ${name} ${year}`
}
