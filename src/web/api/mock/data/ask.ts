import { findDefinition, meaningOf, synonymIn, type Definition } from '@/lib/definitions'
import { servedToAgents, type DomainId, type Fact } from '@/model/items'
import { facts, markets, metrics } from './world'
import { definitionSeed } from '../definitions'
import { parseMentionId, plainText, type MentionRef } from '@/lib/mentions'
import { scopeText, stateLabel, type Answer, type Example, type QuestionPart } from '@/model/ask'

/** The definitions the matcher reads synonyms from: the mock's, as they stand (mock/index.ts). */
let definitionsNow: () => Definition[] = () => definitionSeed
export const readDefinitionsFrom = (read: () => Definition[]) => {
  definitionsNow = read
}

/** Limits a question can carry beyond its metric and markets: a domain, or named context items. `pool` is the context as it is now. */
type Limit = { domain?: DomainId; only?: string[]; pool?: Fact[] }

export const examples: Example[] = [
  {
    id: 'grounded',
    label: stateLabel.grounded,
    starter: true,
    question: 'Why did orders in Norway drop in August?',
  },
  {
    id: 'partial',
    label: stateLabel.partial,
    question: 'How did orders do in Norway and Spain last quarter?',
  },
  {
    id: 'missing',
    label: stateLabel.missing,
    starter: true,
    question: 'How did orders in Spain change in October 2026?',
  },
  {
    id: 'conflict',
    label: stateLabel.conflict,
    starter: true,
    question: 'Do Norway orders include gift-card money?',
  },
  {
    id: 'stale',
    label: stateLabel.stale,
    starter: true,
    question: 'Why did Norway returns drop at the end of April?',
  },
  {
    id: 'correction',
    label: 'An answer that needs correction',
    question: 'How many test accounts does units sold leave out in Norway?',
  },
  {
    id: 'failed',
    label: stateLabel.failed,
    question: 'What changed in returns in the United Kingdom this week?',
  },
  {
    id: 'synonym',
    label: 'Asked in a synonym',
    question: 'Why did purchases in Norway drop in August?',
  },
  {
    id: 'figconflict',
    label: 'A figure that does not fit the context',
    question: 'Did discount cost in Norway fall after 9 May?',
  },
  {
    id: 'nodata',
    label: 'No figure to read',
    question: 'What was net promoter score in Norway in August?',
  },
]

const curated: Record<string, Omit<Answer, 'id' | 'question'>> = {
  grounded: {
    metric: 'Orders',
    markets: ['Norway'],
    dates: '1 to 31 Aug 2026',
    state: 'grounded',
    text: "Online sales to Norway stopped on 4 August 2026 under a new customs rule, and there are no stores there [1]. Price promotions in Norway have been paused since 9 May 2026 [2]. The context doesn't say how much each of these moved orders.",
    sources: ['itm_norway_stop', 'itm_za26xpzv'],
    said: '2 context items apply to Orders in Norway from 1 to 31 August 2026. Only that was checked.',
    leftOut: '1 context item about Germany (another market).',
  },
  partial: {
    metric: 'Orders',
    markets: ['Norway', 'Spain'],
    dates: '1 Jul to 30 Sep 2026',
    state: 'partial',
    note: "There's context for Norway and nothing for Spain. “Last quarter” was read as 1 Jul to 30 Sep 2026; use Change it under the question if you meant other dates.",
    text: 'For Norway, online sales stopped on 4 August 2026, so orders there from that day are close to nothing [1]. For Spain, nothing is written down for these dates.',
    sources: ['itm_norway_stop'],
    said: '1 context item applies to Orders in Norway from 1 July to 30 September 2026. Nothing is written down for Spain. Dates assumed: last quarter.',
    times: 4,
  },
  missing: {
    metric: 'Orders',
    markets: ['Spain'],
    dates: '1 to 31 Oct 2026',
    state: 'missing',
    text: "Nobody has written down anything about Orders in Spain in October 2026. That doesn't mean there's no explanation, only that none is written down yet.",
    sources: [],
    said: 'Nothing is written down for Orders in Spain from 1 to 31 October 2026. No match does not prove that nothing applies.',
    times: 9,
  },
  conflict: {
    metric: 'Orders',
    markets: ['Norway'],
    state: 'conflict',
    text: 'One context item says Norway orders count store credit and gift cards [1]. Another says they count card and cash payments only [2]. Both are kept until an owner chooses.',
    sources: ['itm_gift_store_credit', 'itm_gift_card_only'],
    conflict: ['itm_gift_store_credit', 'itm_gift_card_only'],
    said: '2 context items apply to Orders in Norway, and they disagree. Give both sides; do not pick one.',
  },
  stale: {
    metric: 'Returns',
    markets: ['Norway'],
    dates: '20 Apr to 10 May 2026',
    state: 'stale',
    note: 'Based on 1 context item whose check date passed on 2 Oct.',
    text: "From 28 April 2026, Norway returns count only refunds that reached the customer's bank, and earlier weeks read about 4 percent higher [1]. It doesn't say anything else moved returns.",
    sources: ['itm_ra39ow6c'],
    said: '1 context item applies to Returns in Norway from 20 April to 10 May 2026. It may be out of date: its check date passed on 2 October.',
  },
  correction: {
    metric: 'Units sold',
    markets: ['Norway'],
    state: 'grounded',
    text: "Units sold in Norway leaves out the 312 accounts our teams use to test the webshop, and the new app's test accounts from 29 May 2026 [1].",
    sources: ['itm_s90n5xps'],
    said: '1 context item applies to Units sold in Norway. Only that was checked.',
    correction: {
      note: 'There are 340 test accounts now, and the returns team has used 28 more since October.',
      correct:
        "Units sold in Norway leaves out the 340 accounts our teams use to test the webshop, and the returns team's 28 from 1 October 2026.",
      link: 'https://wiki.example/data/definitions/units-sold-october',
    },
  },
  figconflict: {
    metric: 'Discount cost',
    markets: ['Norway'],
    dates: '9 to 31 May 2026',
    state: 'grounded',
    text: "The Norway regulator paused all price promotions on 9 May 2026, and no paid campaign has run there since [1]. The context doesn't say how much this moved discount cost.",
    sources: ['itm_za26xpzv'],
    said: '1 context item applies to Discount cost in Norway from 9 to 31 May 2026. Only that was checked.',
  },
  nodata: {
    metric: 'Net promoter score',
    markets: ['Norway'],
    dates: '1 to 31 Aug 2026',
    state: 'missing',
    text: "Nobody has written down anything about net promoter score in Norway in August 2026. That doesn't mean there's no explanation, only that none is written down yet.",
    sources: [],
    said: 'Nothing is written down for Net promoter score in Norway from 1 to 31 August 2026. No match does not prove that nothing applies.',
  },
  failed: {
    metric: 'Returns',
    markets: ['United Kingdom'],
    dates: '19 to 25 Oct 2026',
    state: 'failed',
    note: "The check couldn't run just now. That is not the same as nothing written down: ask again in a minute.",
    text: '',
    sources: [],
    said: "The check failed. Do not say that nothing is known; say that the check couldn't run.",
  },
}

/** The question's words, without case, marks or order: "Why did @Orders drop in @Norway in August?" reads like the example. */
const wordsOf = (q: string) =>
  q
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ')

/** The example a question is, however it was typed or scoped, so the same question always gets the same answer. */
export const exampleFor = (question: string) =>
  examples.find((e) => wordsOf(e.question) === wordsOf(question))

export function exampleAnswer(id: string): Answer {
  const ex = examples.find((e) => e.id === id) ?? examples[0]!
  // Not curated: read like a typed question, so the synonym resolves the way it would live.
  if (!curated[ex.id]) {
    const read = readQuestion(ex.question)
    return {
      ...answerFor(ex.question, read.metric, read.markets, '1 to 31 Aug 2026'),
      id: ex.id,
      alias: read.alias,
    }
  }
  return explain({ id: ex.id, question: ex.question, ...curated[ex.id]! })
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

/**
 * What an answer owes the asker besides the context: when no item is dated the month asked about,
 * and that the change the question assumes (a drop, a rise) isn't checked here.
 */
function explain(a: Answer): Answer {
  if (a.state === 'failed' || a.state === 'missing' || !a.sources.length) return a
  const lower = a.question.toLowerCase()
  const notes = [a.note]
  const month = MONTH_NAMES.findIndex((m) => new RegExp(`\\b${m}\\b`).test(lower))
  if (month >= 0) {
    const year = Number(lower.match(/\b(20\d\d)\b/)?.[1] ?? 2026)
    const start = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const end = `${year}-${String(month + 1).padStart(2, '0')}-31`
    const dated = a.sources
      .map((id) => facts.find((f) => f.id === id))
      .filter((f): f is Fact => !!f)
      .some((f) => {
        const v = f.valid
        if (!v.from && !v.until) return true
        // An item with only a start date is about that time, not every month after it, unless it is still going on.
        const until =
          v.until ??
          (v.ongoing
            ? '9999-12-31'
            : new Date(Date.parse(v.from!) + 31 * 86400000).toISOString().slice(0, 10))
        return (v.from ?? '0000-01-01') <= end && until >= start
      })
    if (!dated)
      notes.push(
        `No item is dated ${MONTH_NAMES[month]![0]!.toUpperCase()}${MONTH_NAMES[month]!.slice(1)}; these are the nearest that apply.`,
      )
  }
  const change = lower.match(
    /\b(drop|dropped|fall|fell|rise|rose|jump|jumped|spike|increase|increased|decrease|decreased|decline|declined)\b/,
  )?.[1]
  if (change)
    notes.push(
      `The numbers aren't shown here, so the ${/^(drop|dropped|fall|fell|decline|declined|decrease|decreased)$/.test(change) ? 'drop' : 'change'} itself isn't confirmed.`,
    )
  return { ...a, note: notes.filter(Boolean).join(' ') || undefined }
}

// A metric's own word stands for it ("conversion" is Conversion rate), unless the word is shared
// or too common to mean one metric.
const COMMON = new Set(['return', 'online', 'customer', 'marketing', 'first-time'])
const stems = metrics.flatMap((m) => {
  const first = m.name.toLowerCase().split(' ')[0]!
  const shared = metrics.filter((x) => x.name.toLowerCase().split(' ')[0] === first).length > 1
  return m.name.includes(' ') && first.length >= 5 && !shared && !COMMON.has(first)
    ? [{ stem: first, metric: m.name }]
    : []
})

/**
 * Reads a metric and markets from plain words, the way get_context does, with no model. Either may
 * be missing: a question that names neither matches nothing, and gets Not found.
 */
export function readQuestion(q: string) {
  const lower = q.toLowerCase()
  // A synonym counts as the metric it means: "turnover" is read as Net revenue.
  const synonym = synonymIn(definitionsNow(), q)
  const alias =
    synonym && synonym.is.type !== 'term'
      ? { asked: synonym.asked, is: synonym.is.name, type: synonym.is.type }
      : undefined
  const named = metrics
    .flatMap((m) => [m.name, ...(m.otherNames ?? [])].map((n) => ({ n, metric: m.name })))
    .sort((a, b) => b.n.length - a.n.length)
    .find(({ n }) =>
      new RegExp(`\\b${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower),
    )?.metric
  const metric =
    (alias?.type === 'metric' ? alias.is : undefined) ??
    named ??
    stems.find((s) => new RegExp(`\\b${s.stem}`).test(lower))?.metric ??
    (/\borders?\b/.test(lower) ? 'Orders' : /\breturns?\b/.test(lower) ? 'Returns' : '')
  const found = markets.filter((m) => lower.includes(m.toLowerCase()))
  return { metric, markets: found, alias, matched: !!metric || found.length > 0 }
}

function sentence(f: Fact) {
  return plainText(f.summary).split(/(?<=\.)\s/)[0]
}

/** Builds an answer from the context for any metric and markets: the mock matcher behind Ask. */
export function answerFor(
  question: string,
  metric: string,
  ms: string[],
  dates?: string,
  limit: Limit = {},
): Answer {
  return explain(answerCore(question, metric, ms, dates, limit))
}

// Words that say what an item is about beyond its metric and market: "store credit", "card and cash".
const QUIET = new Set([
  'the',
  'and',
  'or',
  'of',
  'in',
  'on',
  'to',
  'for',
  'from',
  'are',
  'is',
  'only',
  'count',
  'counts',
  'orders',
  'order',
  'with',
  'by',
  'a',
  'an',
  'its',
  'it',
])
const topicOf = (f: Fact) =>
  plainText(f.title)
    .toLowerCase()
    .split(/[^a-z-]+/)
    .filter(
      (w) =>
        w.length > 2 &&
        !QUIET.has(w) &&
        !markets.some((m) => m.toLowerCase() === w) &&
        !/^\d/.test(w),
    )

/** Whether a question is about what an item says, beyond sharing its metric and market. */
const bearsOn = (f: Fact, question: string) => {
  const words = question.toLowerCase().split(/[^a-z-]+/)
  return topicOf(f).some((t) =>
    words.some((w) => w === t || w.startsWith(t.replace(/s$/, '')) || t.split('-').includes(w)),
  )
}

function answerCore(
  question: string,
  metric: string,
  ms: string[],
  dates?: string,
  limit: Limit = {},
): Answer {
  const live = (limit.pool ?? facts).filter(
    (f) => servedToAgents(f) && (!limit.domain || f.domain === limit.domain),
  )
  // Scoped to named context items, those are what applies; otherwise the metric and each market
  // decide. A question with no metric reads every metric in its markets, and one with no market
  // every market for its metric. A question that names neither matches nothing.
  // An item with no "Applies to" is read from its own words, as the editor says.
  const covers = (f: Fact, name: string) =>
    f.where.length
      ? f.where.includes(name)
      : new RegExp(`\\b${name.toLowerCase()}`).test(
          plainText(`${f.title} ${f.summary}`).toLowerCase(),
        )
  const apply = (m?: string) =>
    limit.only
      ? live.filter((f) => limit.only!.includes(f.id))
      : live.filter(
          (f) => (!metric || covers(f, metric)) && (!m || covers(f, m) || f.where.length === 1),
        )
  const matched = !!(metric || ms.length || limit.only || limit.domain)
  const per = matched
    ? (ms.length ? ms : [undefined]).map((m) => ({ market: m, facts: apply(m) }))
    : []
  const found = [...new Map(per.flatMap((p) => p.facts).map((f) => [f.id, f])).values()]
  // Two items that disagree count only when the question is about what they disagree on; otherwise
  // they are listed as related, not used, so the state doesn't change because of something else.
  const offTopic = found.filter((f) => {
    const pair = f.disagreesWith ?? found.find((x) => x.disagreesWith === f.id)?.id
    if (!pair) return false
    const other = found.find((x) => x.id === pair)
    return !bearsOn(f, question) && !(other && bearsOn(other, question))
  })
  const all = found.filter((f) => !offTopic.includes(f))
  const related = offTopic.length ? offTopic.map((f) => f.id) : undefined
  const scope = scopeText({ metric, markets: ms, dates }) || 'this question'
  const base = { id: 'custom', question, metric, markets: ms, dates, related }

  if (!matched) {
    return {
      ...base,
      state: 'missing',
      text: 'This question names no metric or market the context covers, so nothing written down applies. Agents say so rather than guess.',
      sources: [],
      said: 'Nothing written matches this question. No match does not prove that nothing applies.',
    }
  }

  if (all.length === 0) {
    return {
      ...base,
      state: 'missing',
      text: `Nobody has written down anything about ${scope}. That doesn't mean there's no explanation, only that none is written down yet.`,
      sources: [],
      said: `Nothing is written down for ${scope}. No match does not prove that nothing applies.`,
      times: 3,
    }
  }
  const sources = all.map((f) => f.id)
  const text = all.map((f, i) => `${sentence(f)} [${i + 1}]`).join(' ')
  if (all.some((f) => f.disagreesWith)) {
    return {
      ...base,
      state: 'conflict',
      text: `${text} Both are kept until an owner chooses.`,
      sources,
      // The pairs that disagree, not every item that applies.
      conflict: all
        .filter(
          (f) =>
            all.some((x) => x.id === f.disagreesWith) || all.some((x) => x.disagreesWith === f.id),
        )
        .map((f) => f.id),
      said: `${all.length} context items apply to ${scope}, and they disagree. Give both sides.`,
    }
  }
  const covered = per.filter((p) => p.facts.length)
  if (ms.length && covered.length < per.length) {
    const none = per.filter((p) => !p.facts.length).map((p) => p.market)
    return {
      ...base,
      state: 'partial',
      note: `There's context for ${covered.map((p) => p.market).join(' and ')} and nothing for ${none.join(' and ')}.`,
      text,
      sources,
      said: `Context applies to ${metric} in ${covered.map((p) => p.market).join(' and ')}. Nothing is written down for ${none.join(' and ')}.`,
    }
  }
  const stale = all.find((f) => f.outOfDate)
  if (stale) {
    return {
      ...base,
      state: 'stale',
      note: `Based on ${all.length === 1 ? '1 context item' : `${all.length} context items, one of them`} that may be out of date. ${stale.outOfDate}`,
      text,
      sources,
      said: `${all.length} ${all.length === 1 ? 'context item applies' : 'context items apply'} to ${scope}. One may be out of date.`,
    }
  }
  return {
    ...base,
    state: 'grounded',
    text: `${text} The context doesn't say what caused it.`,
    sources,
    said: `${all.length} ${all.length === 1 ? 'context item applies' : 'context items apply'} to ${scope}. Only that was checked.`,
  }
}

/**
 * A question scoped with '@': a metric (or a term that means one), markets, a domain or context
 * items, each taking the place of what would be read from the words. The rest is read as usual.
 */
export function answerForScope(
  question: string,
  scope: MentionRef[],
  parts?: QuestionPart[],
  pool?: Fact[],
): Answer {
  // The same question gets the same answer, scoped or not.
  const ex = exampleFor(question)
  if (ex) return { ...exampleAnswer(ex.id), question, scope, parts }
  const read = readQuestion(question)
  const keys = (...kinds: string[]) =>
    scope
      .map((m) => parseMentionId(m.id))
      .filter((m) => kinds.includes(m.kind))
      .map((m) => m.key)
  const word = keys('metric', 'term')
    .map((k) => findDefinition(definitionsNow(), k))
    .map((d) => d && meaningOf(definitionsNow(), d))
    .find((d) => d?.type === 'metric')
  const ms = keys('market')
  const domain: DomainId | undefined = keys('domain')[0]
  const only = keys('context')
  const answer = answerFor(
    question,
    word?.name ?? read.metric,
    ms.length ? ms : read.markets,
    undefined,
    { domain, only: only.length ? only : undefined, pool },
  )
  return { ...answer, alias: word ? undefined : read.alias, scope, parts }
}

/** An answer from the context as it is now (`pool`), the way a typed question gets it: an example by its words, or the matcher. */
export function askQuestion(question: string, pool?: Fact[]): Answer {
  const ex = exampleFor(question)
  if (ex) return { ...exampleAnswer(ex.id), question }
  const read = readQuestion(question)
  return {
    ...answerFor(question, read.metric, read.markets, undefined, { pool }),
    alias: read.alias,
  }
}
