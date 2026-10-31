/**
 * Ask on the Heed service: the answer engine's answer (`ask.lookup`) and Asked this week
 * (`ask.asked`) as the app reads them (src/web/model/ask.ts), and the person's chats, which stay in
 * their browser (FR-717). The engine decides the state, the sources and what agents are told; the
 * words here are written without a model, the way the mock's matcher writes them: each source's
 * first sentence with its number, then one sentence that fits the state.
 */
import type { Asked, AnswerResult } from '@contract/answer'
import type { Vocabulary } from '@domain/item'
import { plainText as wordsOfMarkdown } from '@domain/doc-diff'
import { shiftDate } from '@domain/validity'
import { windowWords } from '@domain/dates'
import { plainText } from '@/lib/mentions'
import type { Answer, AnswerLinks, AskedRow, AskedWeek, Example, Thread } from '@/model/ask'
import { scopeText, unreadReason } from '@/model/ask'

/** A scope as the engine reads it: metric keys, each dimension's value keys, and its days. */
export type ReadScope = Asked['rows'][number]['scope']

/** What a look-up takes beside the words: the scope's own fields, both days included. */
export function lookupFields(scope: ReadScope) {
  return {
    metrics: scope.metrics,
    dimension_filters: Object.entries(scope.filters).map(([dimension, values]) => ({
      dimension,
      values,
    })),
    ...(scope.window.end
      ? { window: { from: scope.window.start, to: shiftDate(scope.window.end, -1) } }
      : {}),
  }
}

/** The names of the vocabulary's keys: `metric:orders` is Orders, `val:market/norway` is Norway. */
export type Names = { metric: (key: string) => string; value: (key: string) => string }

export function namesOf(vocabulary: Vocabulary): Names & {
  /** A metric's key by its name, any case. */
  metricKey: (name: string) => string | undefined
  /** A market's key by its name, any case. */
  marketKey: (name: string) => string | undefined
} {
  const metrics = new Map(vocabulary.metrics.map((m) => [`metric:${m.id}`, m.name]))
  const values = new Map(
    vocabulary.dimensions.flatMap((d) => d.values.map((v) => [`val:${d.id}/${v.id}`, v.name])),
  )
  const market = vocabulary.dimensions.find((d) => d.id === 'market')
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  return {
    metric: (key) => metrics.get(key) ?? key.replace(/^[a-z]+:/, ''),
    value: (key) => values.get(key) ?? key.replace(/^.*\//, ''),
    metricKey: (name) => {
      const m = vocabulary.metrics.find((x) => same(x.name, name))
      return m && `metric:${m.id}`
    },
    marketKey: (name) => {
      const v = market?.values.find((x) => same(x.name, name))
      return v && market && `val:${market.id}/${v.id}`
    },
  }
}

/** "1 to 31 Aug 2026", "1 Jul to 30 Sep 2026": the days a question was read for. */
const datesOf = (window: { start: string; end: string | null }) =>
  windowWords(window).replace(/^(\d+)-/, '$1 to ')

/**
 * An item's first sentence, as the answer says it. An example opens with the question it answers
 * ("How did Orders change in France in September 2024?"), so the answer says what follows it.
 */
const sentenceOf = (summary: string) => {
  const [first = '', ...rest] = plainText(summary)
    .split(/(?<=[.!?])\s/)
    .map((sentence) => sentence.trim())
  return first.endsWith('?') && rest[0] ? rest[0] : first
}

const items = (n: number) => (n === 1 ? '1 context item' : `${n} context items`)

/** Why items that are about the question were left out, in words. */
const leftOutWords: Record<AnswerResult['leftOut'][number]['reason'], string> = {
  source_visibility: 'about metrics you cannot see',
  stopped: 'paused',
  high_risk_unverified: 'waiting for a check',
  cut: 'past the limit of one answer',
  replaced: 'replaced by a newer item',
  dates: 'for other dates',
  values: 'for another market or value',
  dimension: 'split by something the question did not name',
}

function leftOutOf(a: AnswerResult): string | undefined {
  const groups = new Map<string, string[]>()
  for (const l of a.leftOut) groups.set(l.reason, [...(groups.get(l.reason) ?? []), l.title])
  const parts = [...groups].map(
    ([reason, titles]) =>
      `${items(titles.length)} ${leftOutWords[reason as keyof typeof leftOutWords]} (${titles.join('; ')})`,
  )
  if (a.leftOutMore) parts.push(`${items(a.leftOutMore)} more`)
  if (a.forAnotherGroup) parts.push(`${items(a.forAnotherGroup)} for another group`)
  return parts.length ? `${parts.join(', ')}.` : undefined
}

const relOf = { replaces: 'replaces', conflicts_with: 'disagrees', mentions: 'mentions' } as const

/**
 * What get_related followed from the answer's items, as Ask shows it: an item by its id and a
 * term by its word, as a mention names them, each with what the agent read there.
 */
export function linksOf(a: AnswerResult): AnswerLinks | undefined {
  if (!a.links) return undefined
  const titles = new Map(a.items.map((i) => [i.id, i.title]))
  const from = (id: string) => ({ id, title: titles.get(id) ?? '' })
  const to = (t: { type: 'item' | 'term'; id: string; label: string }) => ({
    id: t.type === 'item' ? `context:${t.id}` : `term:${t.label}`,
    label: t.label,
  })
  return {
    on: a.links.on,
    followed: a.links.followed.map((l) => ({
      from: from(l.from),
      rel: relOf[l.rel],
      to: to(l.to),
      // A term's meaning is Markdown: the agent reads its words.
      read: wordsOfMarkdown(l.to.read ?? ''),
    })),
    notFollowed: a.links.notFollowed.map((l) => ({
      from: from(l.from),
      rel: relOf[l.rel],
      to: to(l.to),
    })),
  }
}

/** Why an item may be out of date, in words. */
const outOfDate: Record<NonNullable<AnswerResult['items'][number]['unverifiedReason']>, string> = {
  past_review_date: 'its check date passed',
  needs_check: 'its definition changed since it was checked',
  source_missing: 'its source is missing',
}

/**
 * The engine's answer as Ask shows it, for the question as asked. The words follow the state:
 * Not checked has none, Not found says what nothing is written for, and every other state gives
 * its sources' first sentences, numbered, then what the context does not say.
 */
export function answerOf(
  a: AnswerResult,
  question: string,
  names: Names,
  extra: Pick<Answer, 'parts' | 'scope'> = {},
  /**
   * The words a real model wrote from the answer's items, when the service sent them: they take
   * the place of Ask's own; the state, its note, the sources and what agents are told stay the
   * engine's.
   */
  written?: string,
): Answer {
  const answer = engineAnswerOf(a, question, names, extra)
  return written && a.items.length ? { ...answer, text: written } : answer
}

function engineAnswerOf(
  a: AnswerResult,
  question: string,
  names: Names,
  extra: Pick<Answer, 'parts' | 'scope'>,
): Answer {
  const scope = a.scope
  const metric = scope?.metrics[0] ? names.metric(scope.metrics[0]) : ''
  const markets = Object.entries(scope?.filters ?? {})
    .filter(([dimension]) => dimension === 'dim:market')
    .flatMap(([, values]) => values.map(names.value))
  const dates = scope && !a.assumed ? datesOf(scope.window) : undefined
  const sources = a.items.map((i) => i.id)
  const cited = Object.fromEntries(
    a.items.map((i) => [i.id, { quote: i.quote ?? '', dontConclude: i.notToConclude ?? '' }]),
  )
  const links = linksOf(a)
  const base = {
    id: 'custom',
    question,
    metric,
    markets,
    dates,
    state: a.state,
    sources,
    said: a.say,
    leftOut: leftOutOf(a),
    ...(a.items.length ? { cited } : {}),
    ...(links ? { links } : {}),
    ...extra,
  }
  const what = scopeText({ metric, markets, dates }) || 'this question'
  // The engine read nothing: no answer state, only its reason (never Not found, which says that
  // nothing is written down).
  if (a.status === 'need_more_detail') return { ...base, state: null, text: unreadReason(a.say) }
  if (a.state === 'failed')
    return {
      ...base,
      note: "The check couldn't run just now. That is not the same as nothing written down: ask again in a minute.",
      text: '',
    }
  if (a.state === 'missing')
    return {
      ...base,
      text: `Nobody has written down anything about ${what}. That doesn't mean there's no explanation, only that none is written down yet.`,
    }
  const said = a.items.map((i, n) => `${sentenceOf(i.summary)} [${n + 1}]`).join(' ')
  if (a.state === 'conflict') {
    // The items that name each other as conflicting, not every item the answer gives.
    const ids = new Set(a.items.map((i) => i.id))
    const named = new Set(a.items.flatMap((i) => i.conflictsWith.filter((id) => ids.has(id))))
    const conflict = a.items
      .filter((i) => named.has(i.id) || i.conflictsWith.some((id) => ids.has(id)))
      .map((i) => i.id)
    return { ...base, text: `${said} Both are kept until an owner chooses.`, conflict }
  }
  if (a.state === 'partial') {
    const uncovered = new Set(a.uncovered.values)
    const marketKeys = scope?.filters['dim:market'] ?? []
    const covered = marketKeys.filter((k) => !uncovered.has(k)).map(names.value)
    const none = marketKeys.filter((k) => uncovered.has(k)).map(names.value)
    return {
      ...base,
      text: said,
      ...(covered.length && none.length
        ? {
            note: `There's context for ${covered.join(' and ')} and nothing for ${none.join(' and ')}.`,
          }
        : {}),
    }
  }
  if (a.state === 'stale') {
    const stale = a.items.find((i) => i.unverified)
    const reason = stale?.unverifiedReason ? outOfDate[stale.unverifiedReason] : 'it may be old'
    return {
      ...base,
      text: said,
      note: `Based on ${a.items.length === 1 ? '1 context item' : `${a.items.length} context items, one of them`} that may be out of date: ${reason}.`,
    }
  }
  // A question about why something moved is told the context does not give the cause.
  const cause =
    /\b(why|drop|dropped|fall|fell|rise|rose|jump|jumped|spike|increase|increased|decrease|decreased|decline|declined)\b/i
  return {
    ...base,
    text: cause.test(question) ? `${said} The context doesn't say what caused it.` : said,
  }
}

/** The answer when the check could not run: Not checked, never Not found. */
export const failedAnswer = (question: string): Answer => ({
  id: 'custom',
  question,
  metric: '',
  markets: [],
  state: 'failed',
  note: "The check couldn't run just now. That is not the same as nothing written down: ask again in a minute.",
  text: '',
  sources: [],
  said: "The check failed. Do not say that nothing is known; say that the check couldn't run.",
})

/** The answer when nothing is shared with agents yet: no context, so nothing applies. */
export const nothingLiveAnswer = (question: string): Answer => ({
  id: 'custom',
  question,
  metric: '',
  markets: [],
  state: 'missing',
  text: 'Nothing is written down yet, so nothing applies. Once an owner publishes the first context item, Ask answers from it.',
  sources: [],
  said: 'Nothing is written down yet. No match does not prove that nothing applies.',
})

/** The question a row or a starter asks: "What should I know about Orders in Norway?" */
export const questionAbout = (title: string) => `What should I know about ${title}?`

/** Asked this week as Ask shows it, with each row's question; an empty week when nothing is live. */
export function askedWeekOf(asked: Asked | null, names: Names): AskedWeek {
  if (!asked) return { rows: [], hidden: 0, asked: 0 }
  const rows = asked.rows.map((r): AskedRow => {
    const markets = r.scope.filters['dim:market'] ?? []
    const month = r.months[0] ?? r.scope.window.start
    return {
      topic: {
        id: `${r.title}|${month}`,
        metric: r.scope.metrics[0] ? names.metric(r.scope.metrics[0]) : '',
        where: markets.length ? markets.map(names.value).join(' and ') : 'All markets',
        ...(r.area ? { domain: r.area } : {}),
        month: month.slice(0, 7),
      },
      title: r.title,
      question: questionAbout(r.title),
      times: r.count ?? r.atLeast,
      count: r.count === null ? `${r.atLeast}+` : String(r.count),
      state: r.state,
      sources: r.items,
      // A Not found card with a draft is named by its draft (the Inbox's own naming).
      ...(r.gap
        ? {
            next: r.gap.draft
              ? { label: 'Write it', href: `/context/new?gap=${r.gap.draft}` }
              : { label: 'Open the card', href: `/inbox?card=${encodeURIComponent(r.gap.card)}` },
          }
        : {}),
    }
  })
  return {
    rows,
    hidden: asked.hidden ?? 0,
    asked: asked.asked,
    askedAtLeast: asked.askedAtLeast,
  }
}

/**
 * The questions Ask offers from the workspace itself (decided 27 October 2026): what agents asked
 * most this week, then the starters made from what it has written. Each asks with its scope.
 */
export function examplesOf(asked: Asked | null): (Example & { scope: ReadScope })[] {
  if (!asked) return []
  return [
    ...asked.rows.map((r) => ({
      id: `asked:${r.title}`,
      label: r.title,
      question: questionAbout(r.title),
      scope: r.scope,
    })),
    ...asked.starters.map((s) => ({
      id: `starter:${s.title}`,
      label: s.title,
      question: questionAbout(s.title),
      scope: s.scope,
      starter: true,
    })),
  ]
}

/* ---------- the person's chats, in their browser ---------- */

type StoredChat = { id: string; title: string; question: string; at: number; preview: string }

const SHORT_MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')
const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0)
const clockTime = (t: number) => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** When a chat was, as the history groups and shows it. */
export function dayOf(at: number, now: number): Pick<Thread, 'day' | 'time'> {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000)
  if (days <= 0) return { day: 'Today', time: clockTime(at) }
  if (days === 1) return { day: 'Yesterday', time: clockTime(at) }
  const d = new Date(at)
  return { day: 'Earlier', time: `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}` }
}

/** Where the browser keeps things: its local storage, or memory when that is not there. */
export type Shelf = {
  get: (key: string) => string | null
  set: (key: string, value: string) => void
}

export function browserShelf(): Shelf {
  const memory = new Map<string, string>()
  const storage = () => {
    try {
      return globalThis.localStorage ?? null
    } catch {
      return null
    }
  }
  return {
    get(key) {
      try {
        return storage()?.getItem(key) ?? memory.get(key) ?? null
      } catch {
        return memory.get(key) ?? null
      }
    },
    set(key, value) {
      memory.set(key, value)
      try {
        storage()?.setItem(key, value)
      } catch {
        // A browser that keeps nothing (a private window, storage full) keeps the chats in memory.
      }
    },
  }
}

/**
 * The chats under Ask, kept in the person's browser under their own key, so another person signed
 * in on the same browser never sees them, and never sent to the service (FR-603, FR-717).
 */
export function createChatShelf(shelf: Shelf, now: () => number = Date.now) {
  const undos = new Map<string, () => void>()
  const keyOf = (person: string) => `heed.ask.chats.${person}`
  const read = (person: string): StoredChat[] => {
    try {
      const parsed: unknown = JSON.parse(shelf.get(keyOf(person)) ?? '[]')
      return Array.isArray(parsed) ? (parsed as StoredChat[]) : []
    } catch {
      return []
    }
  }
  const write = (person: string, chats: StoredChat[]) =>
    shelf.set(keyOf(person), JSON.stringify(chats))
  return {
    list: (person: string): Thread[] =>
      read(person)
        .sort((a, b) => b.at - a.at)
        .map((c) => ({
          id: c.id,
          title: c.title,
          question: c.question,
          preview: c.preview,
          ...dayOf(c.at, now()),
        })),
    /** A chat the person just started, at the top of Today, with what its first answer said. */
    add(person: string, id: string, question: string, preview: string) {
      write(person, [
        { id, title: question, question, at: now(), preview },
        ...read(person).filter((c) => c.id !== id),
      ])
    },
    rename(person: string, id: string, title: string) {
      write(
        person,
        read(person).map((c) => (c.id === id ? { ...c, title } : c)),
      )
    },
    /** Deletes a chat; the token puts it back as it was. */
    remove(person: string, id: string): { undo: string } {
      const gone = read(person).find((c) => c.id === id)
      write(
        person,
        read(person).filter((c) => c.id !== id),
      )
      const token = `chat:${globalThis.crypto.randomUUID()}`
      undos.set(token, () => {
        if (gone && !read(person).some((c) => c.id === id)) write(person, [...read(person), gone])
      })
      return { undo: token }
    },
    /** Whether a token is one of these chats' own; it puts the chat back once. */
    undo(token: string): boolean {
      const put = undos.get(token)
      if (!put) return false
      undos.delete(token)
      put()
      return true
    },
  }
}
