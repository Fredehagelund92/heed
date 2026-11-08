import {
  demoCases,
  gateCases,
  type DemoCase,
  type PlanCase,
} from '../../../src/server/modules/answer/index.ts'
import type { EvalCase, Pattern, TurnExpect } from './types.ts'

/*
  The burned cases of gates 1 to 3 and their cold panels as development conversations: what each
  must and must not say, without how today's router says it. A fixed sentence of today's design
  ("What to do is not written down. Here is what is.") becomes the fact it states (nothing written
  says what to do); a line only today's design prints (its footer, its read line) is left out;
  a records table's "Orders in Norway | 31" becomes the topic and its count on one line. Every
  change widens a pattern, so what today's answers matched they still match. How a case was read
  (records, reads, a reply) is today's design too, and is not scored.
*/

const NOT_WRITTEN =
  /\b(?:not written|nothing (?:is )?written|isn't written|no item says|nothing (?:in Heed |here )?says|does(?: not|n't) say)\b/i
const ONLY_WRITTEN =
  /\b(?:only what is written|not what others|other (?:outdoor )?retailers|outside (?:Heed|the workspace)|does(?: not|n't) (?:hold|keep|have))\b/i
const NO_NUMBERS =
  /\b(?:keeps no (?:numbers|figures)|holds no (?:numbers|figures)|no (?:numbers|figures|data values) (?:are )?(?:kept|held)|does(?: not|n't) (?:keep|hold|have) (?:any |the )?(?:numbers|figures|order figures|data))\b/i
const DECLINES_PERSON =
  /\b(?:one person's|a person's|someone's|individual|one person|any one person)\b/i
const NOT_ASK_TO_WRITE =
  /\b(?:(?:does not|doesn't|cannot|can't|won't) (?:write|settle|change|add|edit)|start (?:it|a draft)|decision is (?:theirs|the owners'))\b/i
const SOURCE_TOOL = /\b(?:source tool|(?:cannot|can't|does not|doesn't) change)\b/i
const DUE =
  /\b(?:check date (?:has )?passed|due for a check|overdue|past its check date|needs (?:a )?check(?:ing)?)\b/i
const HIDDEN = /\b(?:hidden|not shown|withheld|(?:cannot|can't) (?:see|show))\b/i
const FEWER_THAN_5 = /\b(?:fewer|less) than (?:5|five)\b|\bunder (?:5|five)\b/i
const WEEK = /\b16(?:th)?(?: Oct[a-z]*)? ?(?:to|-|–) ?22(?:nd)? Oct/i

/** Fixed sentences of today's design, and what each states: null where it states nothing a reply owes. */
const MEANING = new Map<string, Pattern | null>([
  ["Ask does not answer questions about one person's work.", DECLINES_PERSON],
  ["one person's work", DECLINES_PERSON],
  [
    'Ask answers questions about the business, its numbers and what is written about them. This question is outside that, so nothing was looked up.',
    null,
  ],
  ['What to do is not written down. Here is what is.', NOT_WRITTEN],
  ['What happens next is not written down. Here is what is.', NOT_WRITTEN],
  ['What happens next is not written down.', NOT_WRITTEN],
  ['Ask knows only what is written here, not what others do. Here is what is.', ONLY_WRITTEN],
  ['Ask knows only what is written here, not what others do.', ONLY_WRITTEN],
  ['keeps no numbers, so Ask cannot work this out\\.', NO_NUMBERS],
  ['keeps no numbers', NO_NUMBERS],
  ['Definitions live in your source tool, so Ask cannot change one.', SOURCE_TOOL],
  ['Ask does not write context. You can start it here.', NOT_ASK_TO_WRITE],
  ['Not seen:', null],
  ['calls only', null],
  ['Open your Inbox', /Inbox/],
  ['Waiting on you', /\b(?:waiting|Inbox)\b/i],
  ['check date has passed', DUE],
  ['[Hh]idden', HIDDEN],
  ['hidden', HIDDEN],
  ['[Ff]ewer than 5', FEWER_THAN_5],
  ['fewer than 5 times', FEWER_THAN_5],
  ['16 to 22 Oct', WEEK],
  ['Look first at Orders in Spain', 'Orders in Spain'],
  ['\\d+ cards', /\b\d+\b[^.\n]{0,30}\b(?:cards?|waiting|items?)\b/i],
  [
    'Nothing is written about Poland in particular.',
    /\b(?:nothing|nobody|no item|not)\b[^.\n]*\bPoland\b|\bPoland\b[^.\n]*\b(?:nothing|no item|not)\b/i,
  ],
  ['On-time shipping rate is in no domain, so nobody owns it.', /On-time shipping rate/],
  ['Out of 21 live context items', /\b(?:out )?of (?:the |its |all )?21\b/i],
  ['Out of [45] live context items in Marketing', /\b(?:out )?of (?:the |its |all )?[45]\b/i],
  ['no conflicts in Marketing', /\bno (?:marked )?conflicts?\b/i],
  ['Ranked by the share of metrics with no context written', null],
])

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** "13 of 22 metrics" as "13 of the 22", "13 of its 22" or "13 of 22 metrics". */
const COUNT_NOUN = / (?:live )?(?:metrics?|context items?|definitions?)$/

/** A pattern of a case, as the fact it states. */
export function neutral(p: Pattern): Pattern | null {
  const source = typeof p === 'string' ? escape(p) : p.source
  const known = MEANING.get(typeof p === 'string' ? p : p.source)
  if (known !== undefined) return known
  // A row of a records table: the row's subject and its cells on one line, however drawn.
  if (source.includes(' \\| '))
    return new RegExp(
      source.split(' \\| ').join('[^\\n]{0,60}?'),
      typeof p === 'string' ? '' : p.flags,
    )
  // A count out of a denominator, with or without the noun.
  if (/^[\d[\]]+ (?:pair )?of /.test(source))
    return new RegExp(
      source
        .replace(COUNT_NOUN, '')
        .replace(/ (?:pair )?of /g, '\\b[^.\\n]{0,12}?of (?:the |its |all |our )?'),
      typeof p === 'string' ? '' : p.flags,
    )
  return p
}

const neutralAll = (ps: readonly Pattern[] | undefined) =>
  (ps ?? []).flatMap((p) => {
    const n = neutral(p)
    return n === null ? [] : [n]
  })

/** A pattern that only today's design could say, kept out of a case's must-nots. */
const DESIGN_ONLY = new Set([String(/\b(?:I recommend|I suggest|you should|we should)\b/i)])

const expectOf = (e: {
  state?: TurnExpect['state']
  must?: readonly Pattern[]
  refuse?: readonly Pattern[]
  cites?: readonly string[]
  never?: readonly string[]
  says?: RegExp
}): TurnExpect => {
  const says = [...neutralAll(e.must), ...(e.cites ?? []), ...(e.says ? [e.says] : [])]
  const never = [...(e.refuse ?? []).filter((p) => !DESIGN_ONLY.has(String(p))), ...(e.never ?? [])]
  return {
    ...(says.length ? { says } : {}),
    ...(never.length ? { never } : {}),
    ...(e.state !== undefined ? { state: e.state } : {}),
  }
}

const ML = 'Maria Lindqvist'

/** Gates 2 and 3 and their panels, as the person each names asked them. */
export const demoConversations = (cases: readonly DemoCase[] = demoCases): EvalCase[] =>
  cases.map((c) => ({
    id: c.id,
    class: c.class,
    as: c.as,
    source: c.id.startsWith('FP')
      ? 'panel 2'
      : c.id.startsWith('GP')
        ? 'panel 3'
        : c.id.startsWith('F')
          ? 'gate 2'
          : 'gate 3',
    turns: [
      ...(c.setup ? [{ ask: c.setup }] : []),
      { ask: c.question, expect: expectOf(c.expect) },
    ],
  }))

/**
 * Where plan-world.ts and the demo week differ, the demo week's facts: it publishes 21 items, not
 * 22, and 3 of them are due for a check, not 2.
 */
const DEMO_WEEK = new Map<Pattern, Pattern>([
  ['2 of 22 context items', '3 of 21 context items'],
  ['1 pair of 22 context items', '1 pair of 21 context items'],
])
/** Items plan-world publishes that the demo week holds only as a suggestion: no reader may see one. */
const SUGGESTED = ['Card payments in Spain failed from 14 to 16 October 2026']

/**
 * Gate 1 and its panel. They were written for plan-world.ts, whose items are the demo week's but
 * for the few above, so they run there too; a case asked in a world of its own, with a plan of its
 * own or with sources the browser never sends is left out, since the demo week cannot ask it.
 */
export const gateOneConversations = (cases: readonly PlanCase[] = gateCases): EvalCase[] => {
  const byId = new Map(cases.map((c) => [c.id, c]))
  const before = (c: PlanCase): string[] => {
    if (!c.after) return []
    const prior = byId.get(c.after)
    return prior ? [...before(prior), prior.question] : [c.after]
  }
  return cases
    .filter((c) => !c.world && !c.with && !c.sources && !c.scoped)
    .map((c) => ({
      id: c.id,
      class: c.class ?? 'S',
      as: c.as ?? ML,
      source: c.id.startsWith('H') ? 'gate 1' : 'panel 1',
      what: c.what,
      turns: [
        ...before(c).map((ask) => ({ ask })),
        {
          ask: c.question,
          expect: expectOf({
            ...c.expect,
            must: c.expect.must?.map((p) => DEMO_WEEK.get(p) ?? p),
            cites: c.expect.cites?.filter((t) => !SUGGESTED.includes(t)),
            never: [
              ...(c.expect.never ?? []),
              ...(c.expect.cites ?? []).filter((t) => SUGGESTED.includes(t)),
            ],
          }),
        },
      ],
    }))
}
