import { domains } from '@/api/mock/data/world'
import type { Fact } from '@/model/items'
import type { EvalTurn, Pattern, Reply, TurnGrade } from './types.ts'

/*
  The code graders: what a reply must hold to keep Ask's promises, read from the reply, what the
  answerer read, and what the reader's own pages show. Each is strict and answers the same for
  any answerer: none reads how an answer was made.
*/

/** A context item as a reader reads it on its page, in plain text. */
export const itemText = (f: Fact) =>
  [
    f.title,
    `In ${domains[f.domain]?.name ?? f.domain}${f.owners?.length ? `, owned by ${f.owners.join(' and ')}` : ''}. Status: ${f.status}.`,
    f.summary,
    f.body,
    f.when,
    `Checked by ${f.checkedBy} on ${f.checkedOn}`,
    f.quote,
    f.dontConclude,
    f.outOfDate,
    f.source,
  ]
    .filter(Boolean)
    .join('\n')

/** One context item as the reader may read it. */
export type ReadableItem = { title: string; text: string; status: string }

/** A topic of what agents asked, with what this reader may see of its count. */
export type TopicCount = {
  title: string
  /** The count the reader may see, or null when it is hidden from them. */
  shown: number | null
  /** Whether what the reader sees is a floor ("13+"), not the count. */
  floor: boolean
}

/** What the graders know about the reader and the chat so far. */
export type GradeContext = {
  /** Every item the reader may read, by id. */
  readable: ReadonlyMap<string, ReadableItem>
  /** The titles of items the reader may not read. */
  unreadable: readonly string[]
  topics: readonly TopicCount[]
  /** The person's own messages in this chat, this one included. */
  said: readonly string[]
  /** The replies before this one in the chat. */
  earlier: readonly Reply[]
  /** What Ask knows without a tool: today, the week, what Heed keeps. */
  fixed: string
}

const WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  hundred: 100,
}
const NUMBER = new RegExp(`\\d[\\d,]*(?:\\.\\d+)?|\\b(?:${Object.keys(WORDS).join('|')})\\b`, 'gi')
/** A citation mark: [2], or an item's id. */
const MARK = /\[(?:\d+|[a-z]+_[A-Za-z0-9_-]+)\]/g

/** The numbers a text states, as values: "1,240" is 1240, "seven" is 7. */
export function numbersIn(text: string): string[] {
  return [...text.replace(MARK, ' ').matchAll(NUMBER)].map(([n]) => {
    const word = WORDS[n.toLowerCase()]
    if (word !== undefined) return String(word)
    return String(Number(n.replace(/,/g, '')))
  })
}

const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?'
/** Dates and times, which can hold any number and count nothing. */
const DATE = new RegExp(
  [
    `\\b\\d{1,2}(?:\\s*(?:to|-|–|and)\\s*\\d{1,2})?\\s+${MONTH}(?:\\s+\\d{4})?`,
    `\\b${MONTH}\\s+\\d{1,2}(?:,?\\s+\\d{4})?`,
    `\\b${MONTH}\\s+\\d{4}`,
    '\\b\\d{4}-\\d{2}-\\d{2}\\b',
    '\\b\\d{1,2}:\\d{2}\\b',
    '\\b(?:19|20)\\d{2}\\b',
  ].join('|'),
  'gi',
)

const sentencesOf = (text: string) =>
  text
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"“])/)
    .map((s) => s.trim())
    .filter(Boolean)

const matches = (text: string, p: Pattern) =>
  typeof p === 'string' ? text.includes(p) : new RegExp(p.source, p.flags).test(text)

/** The reply as the person reads it: its lines, and the titles of the items it cites. */
export function rendered(reply: Reply, ctx: Pick<GradeContext, 'readable'>): string {
  return [reply.text, ...reply.sources.map((id) => ctx.readable.get(id)?.title ?? id)].join('\n')
}

/** Every number comes from a tool, a record, the person's words or the fixed facts. */
export function ungroundedNumbers(reply: Reply, ctx: GradeContext): string[] {
  const cited = reply.sources.flatMap((id) => {
    const item = ctx.readable.get(id)
    return item ? [item.title, item.text] : []
  })
  const known = new Set(
    numbersIn(
      [
        ...reply.evidence,
        ...cited,
        ...[...ctx.readable.values()].map((i) => i.title),
        ...ctx.said,
        ...ctx.earlier.flatMap((r) => [r.text, ...r.evidence]),
        ctx.fixed,
      ].join('\n'),
    ),
  )
  // "Items 6 and 7" names sources by their place, as [6] and [7] do.
  const places = reply.text.replace(
    /\bitems? (\d+)((?:,? (?:and |or )?\d+)*)/gi,
    (all: string, ...[first, rest]: string[]) =>
      [first, ...(rest ?? '').split(/\D+/)]
        .filter(Boolean)
        .every((n) => Number(n) >= 1 && Number(n) <= reply.sources.length)
        ? ' '
        : all,
  )
  return [...new Set(numbersIn(places).filter((n) => !known.has(n)))]
}

/** Every item the reply cites is one the reader may read, and every mark points at one. */
export function badCitations(reply: Reply, ctx: GradeContext): string[] {
  const bad: string[] = []
  for (const id of reply.sources)
    if (!ctx.readable.has(id)) bad.push(`cites ${id}, which the reader cannot read`)
  for (const [mark] of reply.text.matchAll(MARK)) {
    const inner = mark.slice(1, -1)
    const n = Number(inner)
    if (Number.isInteger(n) ? n < 1 || n > reply.sources.length : !reply.sources.includes(inner))
      bad.push(`${mark} points at no source`)
  }
  return bad
}

/** Words that say a count is of what agents asked. */
const ASKING = /\b(?:ask(?:ed|ing|s)?|questions?|calls?|times)\b/i

/**
 * What agents asked about a topic, said as more than the reader may see, or an item they cannot
 * read named. Once a reply speaks of asking at all, a line about a topic may hold no count above
 * the floor this reader sees, and none at all (but the minimum, 5) where the count is hidden
 * from them; dates count nothing and are left out.
 */
export function hiddenShown(reply: Reply, ctx: GradeContext): string[] {
  const text = rendered(reply, ctx)
  const found: string[] = []
  for (const title of ctx.unreadable)
    if (text.toLowerCase().includes(title.toLowerCase())) found.push(`names "${title}"`)
  if (!ASKING.test(text)) return found
  const sentences = sentencesOf(text)
  for (const t of ctx.topics) {
    if (t.shown !== null && !t.floor) continue
    const [metric = t.title, where] = t.title.toLowerCase().split(' in ')
    for (const s of sentences) {
      const l = s.toLowerCase()
      if (
        !l.includes(t.title.toLowerCase()) &&
        !(l.includes(metric) && (!where || l.includes(where)))
      )
        continue
      const shown = numbersIn(s.replace(DATE, ' ')).map(Number)
      const over =
        t.shown === null ? shown.filter((n) => n !== 5) : shown.filter((n) => n > t.shown!)
      if (over.length)
        found.push(
          `gives ${t.title} as ${over.join(', ')}, where this reader sees ${t.shown === null ? 'no count' : `${t.shown}+`}: "${s.slice(0, 120)}"`,
        )
    }
  }
  for (const s of sentences)
    if (/\b[Aa]sked (?:about \S+(?: \S+)? )?[1-4] times?\b/.test(s))
      found.push(`gives a count under 5: "${s.slice(0, 120)}"`)
  return found
}

/** Imperatives a sentence may lead with that tell the person what to do. */
const IMPERATIVE =
  /^(?:Check|Confirm|Verify|Make sure|Ensure|Consider|Compare|Avoid|Ask (?!(?:does|did|could|can|cannot|can't|answers|knows|read|reads|found|finds|has|had|is|was|keeps|looked|will|would|only)\b)|Talk to|Speak to|Reach out|Contact|Review|Treat|Wait|Hold off|Flag|Exclude|Include|Look (?:at|into|for)|Don't|Do not|Never|Be careful|Keep in mind|Remember|Start with|Focus on|Use|Rely on|Double-check|Adjust|Plan)\b/
/** Advice anywhere in a sentence, in a voice of its own. */
const OWN_VOICE =
  /\b(?:you should|you shouldn't|you'd want|you may want|you might want|you'll want|you need to|I recommend|I suggest|I'd (?:recommend|suggest|check|start|look)|I would (?:recommend|suggest|check|start|look)|we recommend|it(?:'s| is) (?:best|wise|safer|worth (?:checking|confirming|asking))|best to|(?:should|must) be (?:checked|confirmed|verified|treated|excluded|adjusted))\b/i
/** Words that hand a sentence to an item or an owner: an item's own check, relayed. */
const ATTRIBUTED =
  /\b(?:says|say|said|according to|notes|warns|recommends|advises|asks (?:you|readers|people)|tells|the item|its owners?|it reads)\b|\[\d+\]/i

/**
 * Sentences that tell the person what to do in Ask's own voice. One copied whole from what Ask
 * read (an item's own words, a definition's) is the item speaking, relayed.
 */
export function adviceIn(reply: Reply, ctx: Pick<GradeContext, 'readable'>): string[] {
  const read = [
    ...reply.evidence,
    ...reply.sources.flatMap((id) => {
      const item = ctx.readable.get(id)
      return item ? [item.title, item.text] : []
    }),
  ].join('\n')
  return sentencesOf(reply.text).filter(
    (s) => !read.includes(s) && (IMPERATIVE.test(s) || OWN_VOICE.test(s)) && !ATTRIBUTED.test(s),
  )
}

/** The state chip agrees with what the reply found. */
export function stateProblems(reply: Reply, ctx: Pick<GradeContext, 'readable'>): string[] {
  const n = reply.sources.length
  switch (reply.state) {
    case 'grounded':
    case 'partial':
      return n ? [] : [`${reply.state} with no item cited`]
    case 'conflict':
      return n >= 2 ? [] : [`conflict with ${n} item${n === 1 ? '' : 's'} cited`]
    case 'stale':
      return reply.sources.some((id) => ctx.readable.get(id)?.status === 'Needs checking')
        ? []
        : ['stale with no cited item due for a check']
    case 'missing':
      return n ? [`not found, yet ${n} item${n === 1 ? '' : 's'} cited`] : []
    default:
      return []
  }
}

/** One turn graded by code: each promise it broke, and what it missed of its case. */
export function gradeTurn(turn: EvalTurn, reply: Reply, ctx: GradeContext): TurnGrade {
  const text = rendered(reply, ctx)
  const e = turn.expect ?? {}
  const breaches: TurnGrade['breaches'] = {}
  const add = (promise: keyof TurnGrade['breaches'], found: string[]) => {
    if (found.length) breaches[promise] = found
  }
  add(
    'numbers',
    ungroundedNumbers(reply, ctx).map((n) => `${n} is in no tool result or record`),
  )
  add('citations', badCitations(reply, ctx))
  add('hidden', hiddenShown(reply, ctx))
  add(
    'advice',
    adviceIn(reply, ctx).map((s) => `"${s.slice(0, 120)}"`),
  )
  add('state', stateProblems(reply, ctx))
  add(
    'never',
    (e.never ?? []).filter((p) => matches(text, p)).map((p) => `says ${String(p)}`),
  )
  const misses = [
    ...(e.says ?? []).filter((p) => !matches(text, p)).map((p) => `does not say ${String(p)}`),
    ...(e.state !== undefined && reply.state !== e.state
      ? [`state ${reply.state ?? 'none'}, not ${e.state ?? 'none'}`]
      : []),
    ...(e.asksBack !== undefined && /\?\s*$/m.test(reply.text) !== e.asksBack
      ? [e.asksBack ? 'asks nothing back' : 'asks back']
      : []),
  ]
  return { breaches, misses }
}
