import { answerFor, stateLabel, type Answer, type AnswerState } from "@/data/ask"
import { monthName, monthShort, topicName, type Topic } from "@/data/observability"
import { facts as allFacts, servedToAgents, type Fact } from "@/data/world"

// The answer panel's Steps: a replay. Answering is fixed rules with no model, so a topic can be run
// again, step by step, on what agents get now or on what they got before a publish, without anything
// having been recorded. It runs the same lookup Ask runs (data/ask.ts), in about 30 ms, for free.

export type When = "now" | "before"

export type ReplayStep = {
  key: "scope" | "looked" | "left" | "checked" | "said" | "next" | "after"
  title: string
  /** How long the step took, in milliseconds; the last one counts what happened after, so it has none. */
  ms?: number
  text: string
  /** The scope's parts, as chips. */
  scope?: { label: string; kind: "metric" | "market" | "dates" }[]
  /** Context items the step is about, with why when they were left out. */
  items?: { id: string; title: string; why?: string }[]
}

/** What an agent is told to do next, by the answer's state. */
export const NEXT: Record<AnswerState, string> = {
  grounded: "Relay the sentence with its source, and who checked it when. Do not add a cause it doesn't give.",
  partial: "Say which part is covered and which isn't. Do not fill in the rest.",
  missing: "Say that nothing is written down. Do not guess a cause. Offer to report it.",
  conflict: "Say that two items disagree, and give both. Do not pick one.",
  stale: "Say it may be out of date, and when it was last checked.",
  failed: "Say it couldn't check just now, and to ask again.",
}

/** The publish a replay can be compared with: what agents got before it. */
export const BEFORE = {
  label: "Before 20 Oct",
  title: "Units sold excludes test accounts",
  factId: "itm_s90n5xps",
  summary: "Units sold in Norway leaves out the accounts our teams use to test the webshop.",
}

const MS = [3, 11, 2, 4, 6, 1]

export function replay(t: Topic, when: When = "now", pool: Fact[] = allFacts) {
  const facts = when === "before" ? pool.map((f) => (f.id === BEFORE.factId ? { ...f, summary: BEFORE.summary } : f)) : pool
  const markets = t.where === "All markets" ? [] : [t.where]
  const month = monthName(t.month)
  const answer: Answer = answerFor(`What should I know about ${topicName(t)} in ${month}?`, t.metric, markets, month, { pool: facts })
  const used = answer.sources.map((id) => facts.find((f) => f.id === id)!).filter(Boolean)
  // What is about the metric but didn't reach the agent, and why.
  const left = facts
    .filter((f) => f.where.includes(t.metric) && !answer.sources.includes(f.id))
    .map((f) => ({
      id: f.id,
      title: f.title,
      why:
        f.status === "Draft"
          ? "is a draft, not published"
          : !servedToAgents(f)
            ? "is archived"
            : `is about ${f.where.filter((w) => w !== t.metric).join(", ") || "something else"}`,
    }))
    .slice(0, 3)
  const n = (k: number, one: string) => `${k} ${k === 1 ? one : `${one}s`}`
  const steps: ReplayStep[] = [
    {
      key: "scope",
      title: "Read the scope",
      ms: MS[0],
      text: "The dates were read from the question, and kept as a scope. The words are not kept.",
      scope: [
        { label: t.metric, kind: "metric" },
        { label: t.where, kind: "market" },
        { label: monthDays(t.month), kind: "dates" },
      ],
    },
    {
      key: "looked",
      title: "Looked for context",
      ms: MS[1],
      text: `${n(used.length, "context item")} ${used.length === 1 ? "applies" : "apply"} to ${topicName(t)} in ${month}.`,
      items: used.map((f) => ({ id: f.id, title: f.title })),
    },
    {
      key: "left",
      title: "Left out",
      ms: MS[2],
      text: left.length ? `${n(left.length, "item")} did not reach the agent.` : "Nothing about it was left out.",
      items: left,
    },
    { key: "checked", title: "Checked", ms: MS[3], text: stateLabel[answer.state] },
    { key: "said", title: "Said", ms: MS[4], text: answer.said },
    { key: "next", title: "Told the agent what to do next", ms: MS[5], text: NEXT[answer.state] },
  ]
  return { answer, steps, ms: MS.reduce((a, b) => a + b, 0) }
}

/** What agents did after the answer this week, as counts. */
export function afterAnswer(t: Topic) {
  const reports = t.week.missing >= 5 ? 2 : t.reported ? 1 : 0
  const followed = t.week.grounded > 10 ? 3 : 0
  const again = t.week.missing ? 1 : 0
  return `${reports} ${reports === 1 ? "agent" : "agents"} sent a report about it. ${followed} followed a link. ${again} asked again with other dates.`
}

/** The steps that read differently before the publish, to mark them in a compare. */
export function changedSteps(t: Topic) {
  const now = replay(t, "now").steps
  const before = replay(t, "before").steps
  return now.filter((s, i) => s.text !== before[i].text || JSON.stringify(s.items) !== JSON.stringify(before[i].items)).map((s) => s.key)
}

/** A month as the dates read from a question: "1 to 30 Sep 2026". */
function monthDays(m: string) {
  const [y, mo] = m.split("-").map(Number)
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  const [name, year] = monthShort(m).split(" ")
  return `1 to ${last} ${name} ${year}`
}
