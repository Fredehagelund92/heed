import type { AnswerState } from './answer.ts'
import {
  recordsKinds,
  type RecordsFound,
  type RecordsIntent,
  type RecordsKind,
  type RecordsPeriod,
  type RecordsRow,
  type RecordsAnswer,
} from './records-answer.ts'
import { normalizeName, type Term } from './vocabulary.ts'

/*
  Records answers: a question about the context's own records, not about the business. "Give me
  context created in the last 24 hours", "what is due for a check in Sales", "who owns Orders".
  Ask answers them from what the workspace keeps about its context items, domains and owners, and
  from what agents asked this week, never from what an item says, and agents never read them.

  The list of questions is closed: seven intents, read by fixed word patterns, each answered by a
  fixed read and a sentence template. No model chooses or writes anything. A question none of them
  fits is left to the answer engine, which says when it looked nothing up. A model may later fill
  the same `RecordsAsk` for words the patterns miss; the reads, the permissions and the screen would
  not change.

  Pure, so the service and the mock binding read a question and answer it alike: the caller gives
  the records the person may see (only what the Context list shows them), the names the engine's
  reader found in the words, and the moment it is now. Times are UTC: Heed keeps no time zone of
  its own, so every period says it.
*/

export {
  recordsAnswerSchema,
  recordsIntents,
  recordsKinds,
  type RecordsAnswer,
  type RecordsFound,
  type RecordsIntent,
  type RecordsKind,
  type RecordsPeriod,
  type RecordsRow,
} from './records-answer.ts'

/** Each kind as people name it, one and several, and as a table's row names it. */
const kindWords: Record<RecordsKind, { one: string; many: string; label: string }> = {
  event: { one: 'event', many: 'events', label: 'Event' },
  issue: { one: 'warning', many: 'warnings', label: 'Warning' },
  note: { one: 'rule', many: 'rules', label: 'Rule' },
  guide: { one: 'guide', many: 'guides', label: 'Guide' },
}

/** How many rows an answer lists at most, on every screen. Context lists the rest. */
export const RECORDS_ROWS = 5

/** What a question asks, from the closed list: an intent and its few slots. */
export type RecordsAsk = {
  intent: RecordsIntent
  /** A domain, by id. */
  domain: string | null
  /** A kind of context item, or definitions (the metrics and dimensions of the vocabulary). */
  kind: RecordsKind | 'definition' | null
  /** A metric, by key, for who owns it. */
  metric: string | null
  period: RecordsPeriod | null
  /** Which domains and context items have no owner, instead of who owns one. */
  noOwner: boolean
}

/* ---------- reading the question ---------- */

/** What the engine's reader found in the words, and the names a question may use. */
export type RecordsReading = {
  /** The names the reader found, by where they are in the question (UTF-16 offsets, end exclusive). */
  spans: readonly { start: number; end: number; keys?: readonly string[]; dates?: boolean }[]
  /** The vocabulary the keys are from. */
  terms: readonly Pick<Term, 'key' | 'kind' | 'name' | 'areaId'>[]
  /** The domains, by id and name. */
  domains: readonly { id: string; name: string }[]
  /** The moment it is now, as an ISO instant. */
  now: string
}

export type RecordsRecognition =
  | { type: 'records'; ask: RecordsAsk }
  /** A question about one person's work: refused, with a reason, never looked up. */
  | { type: 'refused' }

/** Words the way the patterns read them: lower case, letters and digits, one space between. */
const plain = (text: string) =>
  normalizeName(text)
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/'(?!s\b)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where a name is in the question, whole words only, any case. */
function findName(question: string, name: string): { start: number; end: number } | null {
  const words = name.trim()
  if (!words) return null
  const found = new RegExp(`(?<![\\p{L}\\p{N}])${escape(words)}(?![\\p{L}\\p{N}])`, 'iu').exec(
    question,
  )
  return found ? { start: found.index, end: found.index + found[0].length } : null
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end

/**
 * Nouns that make a question about the records: what Heed keeps, never what the business does.
 * Plainer words for an entry and the kinds' names (an item, a rule, an event) are everyday words
 * too ("the new rule in Spain", "items sold in Norway"), so they count only in a question that
 * names no metric and no market.
 */
const RECORDS_NOUN = /\b(context|definitions?|domains?|library|owners?)\b/
const PLAIN_NOUN =
  /\b(items?|entries|entry|records?|facts?|guides?|rules?|warnings?|events?|notes?)\b/

/** Who may be the subject of "what did X write" without it being one person's work. */
const NOT_A_PERSON =
  'agents?|anyone|anybody|someone|somebody|people|everyone|everybody|we|the|owners|administrators|admins|heed|been|it|this|that|there|they|you'
const PERSON_VERBS =
  'write|wrote|written|add|added|change|changed|edit|edited|check|checked|create|created|publish|published|archive|archived|suggest|suggested|review|reviewed|do|done|work on|worked on'

/** A question about what one person did: refused, since no read here filters by a person. */
function aboutAPerson(t: string): boolean {
  if (
    new RegExp(
      `\\b(?:what|which|how many)\\b(?: [a-z]+){0,3} (?:did|has|have|does) (?!(?:${NOT_A_PERSON})\\b)[a-z]+(?: [a-z]+)? (?:${PERSON_VERBS})\\b`,
    ).test(t)
  )
    return true
  if (
    new RegExp(
      `\\b(?:written|added|changed|edited|checked|created|published|archived|suggested|reviewed) by (?!(?:an? )?(?:${NOT_A_PERSON}|agent|owner|administrator)\\b)[a-z]+`,
    ).test(t)
  )
    return true
  if (/\bwho (?:wrote|created|added|changed|edited|checked|published|archived|reviewed)\b/.test(t))
    return true
  return /\b(?:my|[a-z]+'s) (?:work|changes|edits|checks|suggestions|drafts)\b/.test(t)
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  fourteen: 14,
  thirty: 30,
  'twenty four': 24,
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
const SHORT = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')

/** A day as the answers write it: "2 Oct 2026". */
export function dayWords(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${SHORT[m! - 1]} ${y}`
}

/** An instant to the minute, UTC: "29 Oct 15:30", with the year when it is not `now`'s. */
function instantWords(at: number, now: number): string {
  const d = new Date(at)
  const year = d.getUTCFullYear() === new Date(now).getUTCFullYear() ? '' : ` ${d.getUTCFullYear()}`
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  return `${d.getUTCDate()} ${SHORT[d.getUTCMonth()]}${year} ${time}`
}

const midnight = (at: number) => at - (at % DAY)

function period(start: number, end: number, words: string, now: number, assumed = false) {
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    words,
    label: `${instantWords(start, now)} to ${instantWords(end, now)}, UTC`,
    assumed,
  }
}

/**
 * The period the words name, up to now: the hours or days back from now ("the last 24 hours",
 * "the past 3 days"), or whole UTC days from midnight ("today", "yesterday", "since Monday", "this
 * week", "last week", "this month"). A week starts on Monday. Null when the words name none.
 */
export function readRecordsPeriod(text: string, nowIso: string): RecordsPeriod | null {
  const t = plain(text)
  const now = Date.parse(nowIso)
  const today = midnight(now)
  const back = new RegExp(
    `\\b(?:in |over |during )?(?:the )?(?:last|past|previous) (\\d+|${Object.keys(NUMBERS).join('|')}) (hours?|days?|weeks?)\\b`,
  ).exec(t)
  if (back) {
    const n = /^\d+$/.test(back[1]!) ? Number(back[1]) : NUMBERS[back[1]!]!
    const unit = back[2]!.startsWith('hour') ? HOUR : back[2]!.startsWith('day') ? DAY : 7 * DAY
    const name = back[2]!.replace(/s$/, '')
    return period(now - n * unit, now, `in the last ${n === 1 ? name : `${n} ${name}s`}`, now)
  }
  if (/\b(?:last|past) (?:day|24 ?h)\b/.test(t))
    return period(now - DAY, now, 'in the last 24 hours', now)
  if (/\b(?:last|past) hour\b/.test(t)) return period(now - HOUR, now, 'in the last hour', now)
  const since =
    /\bsince (monday|tuesday|wednesday|thursday|friday|saturday|sunday|yesterday)\b/.exec(t)
  if (since) {
    if (since[1] === 'yesterday') return period(today - DAY, now, 'since yesterday', now)
    const want = WEEKDAYS.indexOf(since[1]!)
    const day = (new Date(now).getUTCDay() + 6) % 7
    const start = today - ((day - want + 7) % 7) * DAY
    return period(start, now, `since ${since[1]![0]!.toUpperCase()}${since[1]!.slice(1)}`, now)
  }
  if (/\btoday\b/.test(t)) return period(today, now, 'today', now)
  if (/\byesterday\b/.test(t)) return period(today - DAY, today, 'yesterday', now)
  const monday = today - ((new Date(now).getUTCDay() + 6) % 7) * DAY
  if (/\bthis week\b/.test(t)) return period(monday, now, 'this week', now)
  if (/\blast week\b/.test(t)) return period(monday - 7 * DAY, monday, 'last week', now)
  const first = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1)
  if (/\bthis month\b/.test(t)) return period(first, now, 'this month', now)
  if (/\blast month\b/.test(t)) {
    const d = new Date(first)
    const before = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)
    return period(before, first, 'last month', now)
  }
  return null
}

/** The period an answer about changes takes when the words name none: the last 7 days. */
const assumedPeriod = (nowIso: string): RecordsPeriod => {
  const now = Date.parse(nowIso)
  return period(now - 7 * DAY, now, 'in the last 7 days', now, true)
}

/** The kind a word names, or definitions. */
function kindIn(t: string): RecordsKind | 'definition' | null {
  if (/\bdefinitions?\b/.test(t)) return 'definition'
  if (/\bguides?\b/.test(t)) return 'guide'
  if (/\brules?\b/.test(t)) return 'note'
  if (/\bwarnings?\b/.test(t)) return 'issue'
  if (/\bevents?\b/.test(t)) return 'event'
  return null
}

/**
 * Reads a question as one of the seven records questions, or as a question about one person's
 * work, which is refused; null for anything else, which the answer engine reads as before.
 *
 * A domain is found by its name. The names of metrics and markets the engine's reader found are
 * taken out of the words first, so "What is new customers?" is not "what is new". A question that
 * names a metric or a market is a records question only when it also names what Heed keeps (a
 * context item, a domain, an owner) or asks who owns it: "What changed in returns in the United
 * Kingdom this week?" stays a question about the business.
 */
export function recogniseRecords(
  question: string,
  reading: RecordsReading,
): RecordsRecognition | null {
  // The domain is the longest name found, and the reader's names inside it are the domain's.
  const domain = [...reading.domains]
    .sort((a, b) => b.name.length - a.name.length)
    .map((d) => ({ d, at: findName(question, d.name) }))
    .find((x) => x.at)
  const terms = new Map(reading.terms.map((t) => [t.key, t]))
  const named = reading.spans.filter((s) => !s.dates && !(domain && overlaps(s, domain.at!)))
  const metric = named
    .flatMap((s) => (s.keys ?? []).map((k) => terms.get(k)))
    .find((t) => t?.kind === 'metric')
  // The words without the names the reader found, and without the domain's name.
  let words = question
  for (const at of [...named, ...(domain ? [domain.at!] : [])].sort((a, b) => b.start - a.start))
    words = `${words.slice(0, at.start)} ${words.slice(at.end)}`
  const t = plain(words)
  const scoped = named.length > 0
  const noun = RECORDS_NOUN.test(t) || (!named.length && PLAIN_NOUN.test(t))
  if (aboutAPerson(t)) return { type: 'refused' }

  const ask = (intent: RecordsIntent, extra: Partial<RecordsAsk> = {}): RecordsRecognition => ({
    type: 'records',
    ask: {
      intent,
      domain: domain?.d.id ?? null,
      kind: null,
      metric: null,
      period: null,
      noOwner: false,
      ...extra,
    },
  })

  if (
    !(scoped && !noun) &&
    (/\bagents?\b.*\b(?:nothing|not found|no answers?|missing|unanswered|not (?:find|found|get|answered)|did not find|didn t find|could not find|couldn t find|found no)\b/.test(
      t,
    ) ||
      /\b(?:nothing|not found|no answers?)\b.*\bagents?\b/.test(t) ||
      /\bunanswered\b|\bwent unanswered\b|\bwhat (?:is|are) (?:missing|not covered)\b/.test(t))
  )
    return ask('asked_nothing', {
      period: readRecordsPeriod('this week', reading.now),
    })
  if (
    /\b(?:no|without|missing|lacks?|lacking) (?:an? )?owners?\b|\bunowned\b|\bnobody owns\b|\bno one owns\b|\bnot owned\b|\bhas no owner\b/.test(
      t,
    )
  )
    return ask('owner', { noOwner: true })
  if (
    /\bwho (?:owns|is the owner|are the owners|is responsible|are responsible|looks after|look after|is in charge)\b|\bowners? of\b|\bwhose\b|\bwho checks\b|\bwho reviews\b/.test(
      t,
    )
  )
    return ask('owner', { metric: domain ? null : (metric?.key ?? null) })
  if (scoped && !noun) return null
  if (
    /\b(?:archived|retired|taken down|withdrawn|no longer (?:in use|active|used|served))\b/.test(t)
  )
    return ask('archived', { kind: kindOrNull(t) })
  if (
    /\b(?:due for (?:a )?(?:check|review)s?|overdue|out of date|outdated|stale|needs? (?:a )?(?:check|review|look|rechecking|checking)|past (?:its|their) check date|check date (?:has )?passed|need (?:to be )?checked)\b/.test(
      t,
    )
  )
    return ask('due', { kind: kindOrNull(t) })
  if (/\bhow many\b|\b(?:count|number) of\b|\bin total\b/.test(t) && noun)
    return ask('count', { kind: kindIn(t) })

  const created =
    /\b(?:created|added|add|new|newest|latest|recent|recently|lately|published|came in|written|wrote)\b/.test(
      t,
    )
  const changed = /\b(?:changed|change|changes|updated|edited|modified|touched|different)\b/.test(t)
  if (created || changed) {
    const read = readRecordsPeriod(words, reading.now)
    const chosen = read ?? assumedPeriod(reading.now)
    return ask(changed ? 'changed' : 'created', { kind: kindOrNull(t), period: chosen })
  }
  return null
}

/** A kind of context item the words name; definitions are no context items. */
const kindOrNull = (t: string): RecordsKind | null => {
  const k = kindIn(t)
  return k === 'definition' ? null : k
}

/* ---------- answering it ---------- */

/** A context item as the records keep it, as the Context list shows it to the person. */
export type RecordsItem = {
  id: string
  kind: RecordsKind
  areaId: string
  title: string
  /** As the Context list says it: live, due for a check, or archived. */
  status: 'live' | 'due' | 'archived'
  reviewDate: string | null
  checkFlag: 'needs_check' | 'source_missing' | null
  /** When it was first published: agents first got it. Null when not known. */
  publishedAt: string | null
  /** When its current version was published. */
  changedAt: string | null
  /** When its current version was last confirmed: its acceptance, or a later check. */
  checkedAt: string | null
  /** When it was archived; null while it is not. */
  archivedAt: string | null
  /** Its own owners, by id, when not its domain's. */
  owners: readonly string[]
}

/** The records a question is answered from: only what the person may see. */
export type RecordsWorld = {
  items: readonly RecordsItem[]
  areas: readonly { id: string; name: string; ownerIds: readonly string[] }[]
  /** People's names, by id, as Context names them. */
  people: Readonly<Record<string, string>>
  terms: readonly Pick<Term, 'key' | 'kind' | 'name' | 'areaId'>[]
  /**
   * What agents asked this week, as Asked this week counts it: each topic's count, null under the
   * minimum, and the state Ask gives it now. Null when the question does not need it.
   */
  asked: {
    rows: readonly {
      title: string
      count: number | null
      atLeast: number
      state: AnswerState
      gap: { card: string; draft: string | null } | null
    }[]
    minimum: number
  } | null
}

const count = (n: number) => n.toLocaleString('en-GB')
const itemsWords = (n: number, kind: RecordsKind | null = null) =>
  `${count(n)} ${kind ? (n === 1 ? kindWords[kind].one : kindWords[kind].many) : n === 1 ? 'context item' : 'context items'}`
const was = (n: number) => (n === 1 ? 'was' : 'were')
const is = (n: number) => (n === 1 ? 'is' : 'are')
const list = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
const since = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN)
const within = (iso: string | null, p: RecordsPeriod) =>
  iso !== null && since(iso) >= since(p.start) && since(iso) < since(p.end)

const NOTE =
  'Live means published and in use. Due for a check means its check date passed or its source changed.'

/**
 * The answer to a records question, from the records the person may see. Every count is exact:
 * it counts what the Context list shows them. Only what agents asked is counted under a minimum
 * and hidden below it, as Asked this week does.
 */
export function answerRecords(ask: RecordsAsk, world: RecordsWorld, nowIso: string): RecordsFound {
  const area = ask.domain ? (world.areas.find((a) => a.id === ask.domain) ?? null) : null
  const domain = area ? { id: area.id, name: area.name } : null
  const inScope = world.items.filter(
    (i) =>
      (!area || i.areaId === area.id) &&
      (!ask.kind || ask.kind === 'definition' || i.kind === ask.kind),
  )
  const kind = ask.kind && ask.kind !== 'definition' ? ask.kind : null
  const what = itemsWords(inScope.length, kind)
  const base = {
    refused: false as const,
    intent: ask.intent,
    period: ask.period,
    domain,
    read: `Read ${what}${domain ? ` in ${domain.name}` : ''}`,
    detail: null,
    detailItem: null,
    columns: [] as string[],
    rows: [] as RecordsRow[],
    total: 0,
    shown: null,
    more: null,
    note: null,
  }
  const where = domain ? ` in ${domain.name}` : ''
  const things = kind ? kindWords[kind].many : 'context items'
  const itemRow = (i: RecordsItem, cells: string[]): RecordsRow => ({
    type: 'item',
    id: i.id,
    kind: i.kind,
    title: i.title,
    areaId: i.areaId,
    cells,
  })
  const ownersOf = (a: { ownerIds: readonly string[] }) =>
    a.ownerIds.map((id) => world.people[id] ?? 'Someone who left')

  switch (ask.intent) {
    case 'created': {
      const p = ask.period ?? assumedPeriod(nowIso)
      const found = inScope
        .filter((i) => within(i.publishedAt, p))
        .sort((a, b) => since(b.publishedAt) - since(a.publishedAt))
      const latest = [...inScope]
        .filter((i) => i.publishedAt && since(i.publishedAt) < since(p.end))
        .sort((a, b) => since(b.publishedAt) - since(a.publishedAt))[0]
      const n = found.length
      return {
        ...base,
        period: p,
        understood: `${kind ? `${kindWords[kind].label}s` : 'Context'} created${where}, ${p.words.replace(/^in the /, '')}`,
        sentence: n
          ? `${itemsWords(n, kind)} ${was(n)} created${where} ${p.words}.`
          : `${kind ? `No ${things} were` : 'Nothing was'} created${where} ${p.words}.`,
        ...(!n && latest
          ? {
              detail: `The latest ${kind ? kindWords[kind].one : 'context item'} was created on ${dayWords(latest.publishedAt!)}:`,
              detailItem: { id: latest.id, title: latest.title },
            }
          : {}),
        columns: ['Context item', 'Created'],
        rows: found.slice(0, RECORDS_ROWS).map((i) => itemRow(i, [dayWords(i.publishedAt!)])),
        total: n,
        shown: n > RECORDS_ROWS ? `Showing the ${RECORDS_ROWS} newest` : null,
        note: 'Created means first published, when agents could first get it.',
      }
    }
    case 'changed': {
      const p = ask.period ?? assumedPeriod(nowIso)
      const changes = inScope
        .flatMap((i) => {
          const what: [string, string | null][] = [
            ['Archived', i.archivedAt],
            ['Added', i.publishedAt],
            ['Changed', i.changedAt],
            ['Checked', i.checkedAt],
          ]
          const hit = what.find(([, at]) => within(at, p))
          return hit ? [{ item: i, what: hit[0], at: hit[1]! }] : []
        })
        .sort((a, b) => since(b.at) - since(a.at))
      const by = (w: string) => changes.filter((c) => c.what === w).length
      const parts = (
        [
          ['added', by('Added')],
          ['changed', by('Changed')],
          ['checked', by('Checked')],
          ['archived', by('Archived')],
        ] as const
      )
        .filter(([, n]) => n > 0)
        .map(([w, n]) => `${count(n)} ${w}`)
      const n = changes.length
      return {
        ...base,
        period: p,
        understood: `Changes to ${kind ? `${kindWords[kind].many}` : 'context'}${where}, ${p.words.replace(/^in the /, '')}`,
        sentence: n
          ? `${itemsWords(n, kind)} changed${where} ${p.words}: ${list(parts)}.`
          : `Nothing changed${where} ${p.words}.`,
        columns: ['Context item', 'What', 'When'],
        rows: changes.slice(0, RECORDS_ROWS).map((c) => itemRow(c.item, [c.what, dayWords(c.at)])),
        total: n,
        shown: n > RECORDS_ROWS ? `Showing the ${RECORDS_ROWS} latest` : null,
        note: 'Each context item is counted once, for the last thing that happened to it.',
      }
    }
    case 'due': {
      const due = inScope
        .filter((i) => i.status === 'due')
        .sort(
          (a, b) =>
            (a.reviewDate ?? '9999').localeCompare(b.reviewDate ?? '9999') ||
            a.title.localeCompare(b.title),
        )
      const n = due.length
      const owners = area ? ownersOf(area) : []
      const reason = (i: RecordsItem) =>
        i.checkFlag === 'source_missing'
          ? 'Source missing'
          : i.checkFlag === 'needs_check'
            ? 'Definition changed'
            : i.reviewDate
              ? dayWords(i.reviewDate)
              : 'Not recorded'
      return {
        ...base,
        understood: `Due for a check${kind ? `, ${kindWords[kind].many}` : ''}${domain ? `, in ${domain.name}` : ''}`,
        sentence: n
          ? `${itemsWords(n, kind)}${where} ${is(n)} due for a check.`
          : `${kind ? `No ${things}` : 'Nothing'}${where} ${kind ? 'are' : 'is'} due for a check.`,
        detail:
          area && owners.length
            ? `${domain!.name} is owned by ${list(owners)}.`
            : area
              ? `${domain!.name} has no owner to check them. An administrator can add one.`
              : null,
        columns: ['Context item', 'Due since', 'Last checked'],
        rows: due
          .slice(0, RECORDS_ROWS)
          .map((i) => itemRow(i, [reason(i), i.checkedAt ? dayWords(i.checkedAt) : 'Never'])),
        total: n,
        shown: n > RECORDS_ROWS ? `Showing the ${RECORDS_ROWS} oldest` : null,
        more: n
          ? {
              label: `Show all ${count(n)} in Context`,
              to: 'context',
              domain: domain?.id ?? null,
              status: 'due',
            }
          : null,
      }
    }
    case 'archived': {
      const gone = inScope
        .filter((i) => i.status === 'archived')
        .sort((a, b) => since(b.archivedAt) - since(a.archivedAt) || a.title.localeCompare(b.title))
      const n = gone.length
      return {
        ...base,
        understood: `Archived${kind ? `, ${kindWords[kind].many}` : ''}${domain ? `, in ${domain.name}` : ''}`,
        sentence: n
          ? `${itemsWords(n, kind)}${where} ${is(n)} archived.`
          : `${kind ? `No ${things} are` : 'Nothing is'} archived${where}.`,
        columns: ['Context item', 'Archived'],
        rows: gone
          .slice(0, RECORDS_ROWS)
          .map((i) => itemRow(i, [i.archivedAt ? dayWords(i.archivedAt) : ''])),
        total: n,
        shown: n > RECORDS_ROWS ? `Showing the ${RECORDS_ROWS} latest` : null,
        more: n
          ? {
              label: `Show all ${count(n)} in Context`,
              to: 'context',
              domain: domain?.id ?? null,
              status: 'archived',
            }
          : null,
        note: 'Archived context items stay in Context. Agents no longer get them.',
      }
    }
    case 'owner':
      return ownerAnswer(ask, world, base, area)
    case 'count': {
      if (ask.kind === 'definition') {
        const terms = world.terms.filter(
          (t) => (t.kind === 'metric' || t.kind === 'dimension') && (!area || t.areaId === area.id),
        )
        const metrics = terms.filter((t) => t.kind === 'metric').length
        const dimensions = terms.length - metrics
        const n = terms.length
        return {
          ...base,
          understood: `Count of definitions${domain ? `, in ${domain.name}` : ''}`,
          read: `Read ${count(n)} ${n === 1 ? 'definition' : 'definitions'}${where}`,
          sentence: `${domain ? domain.name : 'The workspace'} has ${count(n)} ${n === 1 ? 'definition' : 'definitions'}: ${count(metrics)} ${metrics === 1 ? 'metric' : 'metrics'} and ${count(dimensions)} ${dimensions === 1 ? 'dimension' : 'dimensions'}.`,
          total: n,
          more: {
            label: domain ? `Open ${domain.name} in Definitions` : 'Open Definitions',
            to: 'definitions',
            domain: domain?.id ?? null,
            status: null,
          },
        }
      }
      const tally = (items: readonly RecordsItem[]) => [
        items.filter((i) => i.status === 'live').length,
        items.filter((i) => i.status === 'due').length,
        items.filter((i) => i.status === 'archived').length,
      ]
      const [live, due, archived] = tally(inScope)
      const n = inScope.length
      const kinds = kind ? [kind] : recordsKinds
      return {
        ...base,
        understood: `Count of ${things}${domain ? `, in ${domain.name}` : ''}`,
        sentence: `${domain ? domain.name : 'The workspace'} has ${itemsWords(n, kind)}${n ? `: ${count(live!)} live, ${count(due!)} due for a check and ${count(archived!)} archived` : ''}.`,
        columns: ['Kind', 'Live', 'Due for a check', 'Archived'],
        rows: n
          ? [
              ...kinds.map((k): RecordsRow => ({
                type: 'kind',
                kind: k,
                label: kindWords[k].label,
                cells: tally(inScope.filter((i) => i.kind === k)).map(count),
              })),
              ...(kind
                ? []
                : [
                    {
                      type: 'kind' as const,
                      kind: null,
                      label: 'All',
                      cells: [live!, due!, archived!].map(count),
                    },
                  ]),
            ]
          : [],
        total: n,
        more: {
          label: domain ? `Open ${domain.name} in Context` : 'Open Context',
          to: 'context',
          domain: domain?.id ?? null,
          status: null,
        },
        note: NOTE,
      }
    }
    case 'asked_nothing': {
      const asked = world.asked ?? { rows: [], minimum: 5 }
      const nothing = asked.rows.filter((r) => r.state === 'missing')
      const n = nothing.length
      return {
        ...base,
        understood: 'Topics agents asked about that found nothing, this week',
        read: 'Read what agents asked this week',
        sentence: n
          ? `Agents found nothing written for ${count(n)} ${n === 1 ? 'topic' : 'topics'} this week.`
          : `No topic agents asked about ${asked.minimum} times or more this week found nothing.`,
        columns: ['Topic', 'Asked'],
        rows: nothing.slice(0, RECORDS_ROWS).map((r) => ({
          type: 'topic' as const,
          title: r.title,
          cells: [r.count === null ? `${count(r.atLeast)}+` : count(r.count)],
          gap: r.gap,
        })),
        total: n,
        shown: n > RECORDS_ROWS ? `Showing the ${RECORDS_ROWS} asked most` : null,
        note: `A topic asked about fewer than ${asked.minimum} times is not shown, so no small count is given away.`,
      }
    }
  }
}

function ownerAnswer(
  ask: RecordsAsk,
  world: RecordsWorld,
  base: Omit<RecordsFound, 'understood' | 'sentence'>,
  area: RecordsWorld['areas'][number] | null,
): RecordsFound {
  const names = (a: { ownerIds: readonly string[] }) =>
    a.ownerIds.map((id) => world.people[id] ?? 'Someone who left')
  const own = (who: string[], what: string) =>
    `${list(who)} ${who.length === 1 ? 'owns' : 'own'} ${what}.`
  const itemsIn = (a: { id: string }) => world.items.filter((i) => i.areaId === a.id)
  const domainLink = (a: { id: string; name: string }) => ({
    label: `Open ${a.name}`,
    to: 'domain' as const,
    domain: a.id,
    status: null,
  })
  if (ask.noOwner) {
    const none = world.areas.filter((a) => !a.ownerIds.length)
    const orphans = none.flatMap((a) => itemsIn(a).filter((i) => !i.owners.length))
    return {
      ...base,
      understood: 'Domains and context items with no owner',
      read: `Read ${count(world.areas.length)} ${world.areas.length === 1 ? 'domain' : 'domains'} and ${itemsWords(world.items.length)}`,
      sentence: none.length
        ? `${list(none.map((a) => a.name))} ${none.length === 1 ? 'has' : 'have'} no owner, so ${itemsWords(orphans.length)} ${orphans.length === 1 ? 'has' : 'have'} nobody to check ${orphans.length === 1 ? 'it' : 'them'}.`
        : 'Every domain has an owner, so every context item has someone to check it.',
      detail: none.length ? 'An administrator can add an owner to a domain.' : null,
      columns: ['Domain', 'Context items with no owner'],
      rows: none.slice(0, RECORDS_ROWS).map((a) => ({
        type: 'area' as const,
        id: a.id,
        name: a.name,
        cells: [count(itemsIn(a).filter((i) => !i.owners.length).length)],
      })),
      total: none.length,
      shown: none.length > RECORDS_ROWS ? `Showing ${RECORDS_ROWS} of ${none.length}` : null,
    }
  }
  if (area) {
    const who = names(area)
    const n = itemsIn(area).length
    return {
      ...base,
      understood: `Owner of ${area.name}`,
      read: `Read ${area.name} and its ${itemsWords(n)}`,
      sentence: who.length
        ? own(who, area.name)
        : `${area.name} has no owner. An administrator can add one.`,
      detail: `${itemsWords(n)} in ${area.name} ${n === 1 ? 'is' : 'are'} ${who.length ? 'theirs' : 'waiting for an owner'} to check.`,
      more: domainLink(area),
    }
  }
  const metric = ask.metric ? world.terms.find((t) => t.key === ask.metric) : undefined
  if (metric) {
    const home = metric.areaId ? world.areas.find((a) => a.id === metric.areaId) : undefined
    if (!home)
      return {
        ...base,
        understood: `Owner of ${metric.name}`,
        read: `Read ${metric.name} and ${count(world.areas.length)} domains`,
        sentence: `${metric.name} is in no domain, so nobody owns it.`,
        detail: 'A domain has owners, not a single metric. An administrator can put it in one.',
      }
    const who = names(home)
    return {
      ...base,
      domain: { id: home.id, name: home.name },
      understood: `Owner of ${metric.name}`,
      read: `Read ${metric.name} and its domain, ${home.name}`,
      sentence: who.length
        ? own(who, metric.name)
        : `${metric.name} is in ${home.name}, which has no owner. An administrator can add one.`,
      detail: `${metric.name} is a definition in ${home.name}. A domain has owners, not a single metric.`,
      more: domainLink(home),
    }
  }
  const owned = world.areas.filter((a) => a.ownerIds.length).length
  return {
    ...base,
    understood: 'Owners of every domain',
    read: `Read ${count(world.areas.length)} ${world.areas.length === 1 ? 'domain' : 'domains'}`,
    sentence:
      owned === world.areas.length
        ? `Every domain has an owner. ${count(world.areas.length)} ${world.areas.length === 1 ? 'domain is' : 'domains are'} shown.`
        : `${count(owned)} of ${count(world.areas.length)} domains have an owner.`,
    columns: ['Domain', 'Owners'],
    rows: world.areas.map((a) => ({
      type: 'area' as const,
      id: a.id,
      name: a.name,
      cells: [names(a).length ? list(names(a)) : 'No owner'],
    })),
    total: world.areas.length,
  }
}

/** A question about one person's work, refused with what Ask can say instead. */
export function refusedAnswer(world: Pick<RecordsWorld, 'areas'>): RecordsAnswer {
  const first = world.areas[0]?.name
  return {
    refused: true,
    reason: 'person',
    sentence: "Ask does not answer questions about one person's work.",
    detail:
      'It can tell you what changed this week, and who owns a domain. To see who changed one context item, open its history.',
    offers: ['What changed this week?', ...(first ? [`Who owns ${first}?`] : [])],
  }
}
