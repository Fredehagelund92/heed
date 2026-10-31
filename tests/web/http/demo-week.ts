import { randomUUID } from 'node:crypto'
import pg from 'pg'
import type { JSONContent } from '@tiptap/core'
import type { CommentItem, CommentReaction } from '@/components/templates/comment-box/types'
import { text } from '@/components/templates/comment-box/utils'
import { seedComments, seedReactions } from '@/api/mock/data/comments'
import { TERMS } from '@/api/mock/data/terms'
import { spainDraft } from '@/api/mock/data/drafts'
import { reviews } from '@/api/mock/data/review'
import { facts, people as worldPeople, WORKSPACE_NAME } from '@/api/mock/data/world'
import { seedAgents } from '@/api/mock/data/agents'
import { agentScopes, toolScopes } from '@domain/agents'
import type { Subject } from '@/model/comments'
import type { Fact } from '@/model/items'
import { bulkSeed, seedPersonId } from '../../../db/seed/bulk.ts'
import { reviewQuestion, type ContextItem } from '../../../src/domain/item.ts'
import { parseMentions, serializeMentions, type MentionPart } from '../../../src/domain/mentions.ts'
import { defaultNotToConclude } from '../../../src/domain/proposal-rules.ts'
import type { Draft } from '../../../src/domain/draft.ts'
import { shiftDate } from '../../../src/domain/validity.ts'
import { buildApp } from '../../../src/server/app.ts'
import { systemClock } from '../../../src/server/clock.ts'
import { calendarDateTypes, databaseFromPool } from '../../../src/server/db/database.ts'
import { localRoles } from '../../../src/server/db/roles.ts'
import { createLogger } from '../../../src/server/observability/logger.ts'
import { definitionRefOf, demoDefinitions } from '../../../db/seed/fixtures/cube-model.ts'
import {
  areas,
  people as seedPeople,
  vocabulary,
} from '../../../db/seed/fixtures/reference-data.ts'
import { idleJobs } from '../../server/idle-jobs.ts'
import { seedDriveRead, type DriveCard } from './demo-drive.ts'
import { seedObservability } from './demo-observability.ts'
import { raiseDemoAlerts } from './demo-alerts.ts'
import { takeDemoSnapshots } from './demo-snapshots.ts'
import { seedSavedQuestions } from './demo-saved.ts'

/*
  The mockup's demo week on the real service, for the golden journeys in http mode: Larchwood
  Outdoor's context items (src/web/api/mock/data/world.ts) as a library, and the suggestions that
  wait for Jon Abara, owner of Sales (data/review.ts), sent through the service's own API by the
  people who send them in the mock. The texts are the mock's, so the review shows the same change;
  what the service computes from them (the difference, the claims, the Ready line) is its own. The
  report on Orders in Germany comes in as Maria Lindqvist's named report from Ask. What
  agents asked this week comes in as the topics and counts the service keeps (Asked this week).

  The items' links are the mock's too: a mention the service can follow is kept as its markup (a
  term written in Definitions by its id), and the owners' relations (replaces, disagrees with) as
  the service records them.

  The comments are the mock's threads (data/comments.ts), each written, answered, reacted to,
  edited and deleted through the API by the person the mock names, then dated as the mock dates
  them. Tomas's mention of Jon on the Marketing item waits in Jon's Inbox as "Mentioned you"; Jon
  has read every other thread, so no reply is new to him.

  The two suggestions this morning's Google Drive read made come in through the service's own
  sources job and content pipeline (demo-drive.ts), made by the read and never published by it.

  The thread in which Lars takes back his suggestion to archive is the mock's too: Jon's question
  as a plain comment (a suggestion to archive is closed or archived on the service, never
  returned), and Lars's answer, which Lars marks as taking the suggestion back (P9c), dated as the
  mock dates it.

  What the service cannot hold yet stays out, and the journeys skip the steps that need it (decided
  27 October 2026): Jon's own suggestion to Marketing, and Tomas's question on it, stay out too: Jon is an admin, so
  on the service it would wait in his own review queue. So does Tomas's thread on Sofia's
  suggestion: on the service a waiting suggestion is read by its sender, its domain's owners and
  the admins, and Tomas owns Marketing, not Sales. The mock's drafts are drafts on the service
  too: each started by the person the mock names, never sent.

  What agents asked over the weeks Observability counts, and what they reported, are the mock's
  too (demo-observability.ts), as delivery and request records with no question and no person.

  The terms and synonyms people wrote in Definitions are the mock's too, each by its writer. A
  synonym of a synonym (Takings, for Turnover) means what that one means, as the service keeps it,
  so the mock's chain conflict is not on the service; the other conflict, Sales, needs Cube to call
  Gross sales "Sales" after Ines wrote her word, which P7c's Definitions journeys arrange.
*/

/** The service's today in the demo week: the mock's days are 22 and 23 October 2026. */
export const TODAY = '2026-10-23'

/** The person whose Inbox the journeys open, as the mock starts signed in. */
export const OWNER = { name: 'Jon Abara', email: 'per_jon@example.test' }

/** A mock id as the service takes it: `itm_` and 8 to 16 letters or digits. */
export const serverItemId = (id: string) => `itm_${id.slice(4).replace(/[^a-z0-9]/g, '')}`

const areaOf = (domain: string) => `area_${domain}`
const metricOf = (name: string) => vocabulary.metrics.find((m) => m.name === name)
const marketValues = vocabulary.dimensions.find((d) => d.id === 'market')!.values
const marketOf = (name: string) => marketValues.find((v) => v.name === name)
const marks = new Map(demoDefinitions.map((d) => [d.ref, d.changeMark]))
const personId = (name: string) => {
  const p = seedPeople.find((x) => x.name === name)
  if (!p) throw new Error(`${name} is not one of the seeded people`)
  return p.id
}
/** A mention as the mock stores it, `[@ id="..." label="Words"]`, read as its words. */
const plain = (text: string) => text.replace(/\[@ id="[^"]*" label="([^"]*)"\]/g, '$1')
/**
 * The ids the terms with their own meaning get on the service, by their word in lower case: they
 * are written with the library, so its texts can mention them.
 */
const termIds = new Map(
  TERMS.filter((t) => !t.sameAs).map((t) => [t.name.toLowerCase(), randomUUID()]),
)

/**
 * A mock text's mentions as the service keeps them, in the markup the http binding writes: an item
 * by its id on the service, a metric or a market by its key, a term with its own meaning by its
 * id. None when it mentions nothing the service can follow; a synonym is kept as its words.
 */
function markupOf(text: string): string | undefined {
  const parts = text.split(/(\[@ id="[^"]*" label="[^"]*"\])/).map((part): MentionPart => {
    const [, kind, key = '', label = ''] =
      /^\[@ id="([a-z]+):([^"]*)" label="([^"]*)"\]$/.exec(part) ?? []
    const metric = kind === 'metric' ? metricOf(key) : undefined
    const market = kind === 'market' ? marketOf(key) : undefined
    const term = kind === 'term' ? termIds.get(key.toLowerCase()) : undefined
    const target =
      kind === 'context'
        ? `item:${serverItemId(key)}`
        : metric
          ? `metric:${metric.id}`
          : market
            ? `val:market/${market.id}`
            : term
              ? `term:${term}`
              : undefined
    if (target) return { kind: 'mention', target, label }
    return { kind: 'text', text: kind ? label : part }
  })
  return parts.some((p) => p.kind === 'mention') ? serializeMentions(parts) : undefined
}

/** The mock's "3 Oct 2026" as a calendar day. */
function isoDay(label: string, fallback: string) {
  const t = Date.parse(`${label} 12:00 UTC`)
  return Number.isNaN(t) ? fallback : new Date(t).toISOString().slice(0, 10)
}

/** What an item applies to, by the library's ids: its metrics, and its markets as values. */
function scopeOf(where: readonly string[]) {
  const metrics = where.flatMap((w) => metricOf(w)?.id ?? [])
  const values = where.flatMap((w) => marketOf(w)?.id ?? [])
  return { metrics, values }
}

/**
 * A text as the service keeps it: a summary of at most 280 characters, the rest in the body. A
 * longer one keeps its first sentence as the summary, so both sides of a change split alike.
 */
function split(text: string): { summary: string; body?: string } {
  if ([...text].length <= 280) return { summary: text }
  const end = text.indexOf('. ') + 1
  return { summary: text.slice(0, end), body: text.slice(end + 1) }
}

/** The service's end of a window: the first day it no longer applies, the day after the last. */
const endOf = (until: string | undefined) => (until ? shiftDate(until, 1) : null)

/**
 * What changes about an item before the week starts, so its suggestion shows the mock's change. A
 * text with links is its markup (`bodyMarkup`), which also gives its words.
 */
type Before = {
  summary?: string
  body?: string | null
  bodyMarkup?: string
  source?: string
  until?: string
}
/** A suggested version: the fields it changes. */
type After = Before & { summaryMarkup?: string }

/** The words of the service's markup, as agents read them. */
const wordsOf = (markup: string) => parseMentions(markup).text

const reviewText = (id: string) => {
  const r = reviews.find((x) => x.id === id)
  if (!r) throw new Error(`No review ${id} in the mock`)
  // The mock writes the source and the dates into its stored text as a line of their own.
  const strip = (s: string) =>
    s
      .split('\n\n')
      .filter((p) => !/^(Source|When): /.test(p))
      .join('\n\n')
  return { r, before: strip(r.source.before), after: strip(r.source.after) }
}

/** The edits Ines Duarte sends from a chat, by their mock card, with what they change. */
const edits: { card: string; item: string; before: Before; after: After }[] = (() => {
  const units = reviewText('sug-ines')
  // The formatting change is made on the item's own text, with its links, which both versions keep.
  const norway = markupOf(facts.find((f) => f.id === 'itm_norway_stop')!.body!)!
  const formatted = norway
    .replace('was the only way to buy there.', 'was **the only way to buy there**.')
    .replace('\n\n- Parcels', '\n\n1. Parcels')
    .replace('\n- Compare', '\n2. Compare')
    .replace('never across it.', '_never across it_.')
  const order = reviewText('sug-ines-order')
  const long = reviewText('sug-ines-long')
  const link = reviews.find((r) => r.id === 'sug-ines-link')!
  const linkBlock = link.blocks.find((b) => b.kind === 'Link' && 'before' in b) as {
    before: string
    after: string
  }
  const unitsLink = units.r.blocks.find((b) => b.kind === 'Link' && 'before' in b) as {
    before: string
    after: string
  }
  return [
    {
      card: 'sug-ines',
      item: 'itm_s90n5xps',
      before: { summary: units.before, source: unitsLink.before },
      // The mock writes the link to Test account as the editor's token; the service keeps its markup.
      after: {
        summary: plain(units.after),
        summaryMarkup: markupOf(units.after)!,
        source: unitsLink.after,
      },
    },
    {
      card: 'sug-ines-format',
      item: 'itm_norway_stop',
      before: { bodyMarkup: norway },
      after: { bodyMarkup: formatted },
    },
    {
      card: 'sug-ines-link',
      item: 'itm_ra39ow6c',
      before: { source: linkBlock.before },
      after: { source: linkBlock.after },
    },
    {
      card: 'sug-ines-order',
      item: 'itm_kcy22j54',
      before: { body: order.before },
      after: { body: order.after },
    },
    {
      card: 'sug-ines-long',
      item: 'itm_2a1wp53q',
      before: { summary: long.before },
      // The suggestion keeps the first sentence as the summary and moves the rest to the body.
      after: { summary: long.after.split('\n\n')[0]!, body: long.after.split('\n\n')[1]! },
    },
    {
      card: 'sug-ines-dates',
      item: 'itm_spe2w9kh',
      before: { until: '2026-05-19' },
      after: { until: '2026-05-26' },
    },
  ]
})()

/** The checks that are due, by item: a date that passed, or a definition that changed. */
const due: Record<string, { card: string; reviewDate?: string; checkFlag?: 'needs_check' }> = {
  itm_ra39ow6c: { card: 'check-returns', reviewDate: '2026-10-02' },
  itm_kcy22j54: { card: 'check-margin', checkFlag: 'needs_check' },
  itm_pfet8zj3: { card: 'check-italy', reviewDate: '2026-09-18' },
}

/** Each mock card due for a check, by the service's card for it. */
export const checkCards = () =>
  Object.fromEntries(
    Object.entries(due).map(([item, d]) => [d.card, `check:${serverItemId(item)}`]),
  )

/** One mock context item as the library's item, with the text its week's suggestion starts from. */
function itemOf(f: Fact): ContextItem {
  const before = edits.find((e) => e.item === f.id)?.before ?? {}
  const { metrics, values } = scopeOf(f.where)
  const references = metrics.map((id) =>
    definitionRefOf({
      key: `metric:${id}`,
      group: vocabulary.metrics.find((m) => m.id === id)!.group,
    }),
  )
  const checked = isoDay(f.checkedOn, '2026-06-01')
  const start = f.valid.from ?? '2025-01-01'
  const end = endOf(before.until ?? f.valid.until)
  const text = split(plain(before.summary ?? f.summary))
  const body = before.bodyMarkup
    ? wordsOf(before.bodyMarkup)
    : before.body === undefined
      ? (text.body ?? (f.body ? plain(f.body) : undefined))
      : before.body
  // The links written in its body, which Related and agents follow.
  const bodyMarkup =
    before.bodyMarkup ??
    (before.body === undefined && !text.body && f.body ? markupOf(f.body) : undefined)
  const area = areas.find((a) => a.id === areaOf(f.domain))!
  return {
    id: serverItemId(f.id),
    kind: f.kind,
    areaId: area.id,
    status: f.status === 'Archived' ? 'retired' : 'accepted',
    version: 1,
    title: f.title,
    summary: text.summary,
    ...(body ? { body } : {}),
    ...(bodyMarkup ? { bodyMarkup } : {}),
    references,
    scope: {
      metrics,
      dimensions: [],
      dimensionValues: values.map((value) => ({ dimension: 'market', value })),
    },
    validity: { start, end },
    reviewDate: due[f.id]?.reviewDate ?? (end ? null : '2027-03-01'),
    reviewQuestion: reviewQuestion({ kind: f.kind, validity: { end } }),
    evidence: [{ url: before.source ?? f.source, quote: f.quote, date: checked }],
    checkFlag: due[f.id]?.checkFlag ?? null,
    claimLevel: 'fact_only',
    riskLevel: 'normal',
    notToConclude: f.dontConclude || defaultNotToConclude,
    audience: { kind: 'everyone' },
    ownerId: area.ownerIds[0]!,
    changeMarks: Object.fromEntries(references.map((ref) => [ref, marks.get(ref)!])),
    createdVia: 'form',
    proposerId: area.ownerIds[0]!,
    createdAt: `${checked}T08:00:00Z`,
    updatedAt: `${checked}T09:00:00Z`,
  }
}

/** The library of the demo week: every live and archived item of the mock world. */
export const demoLibrary = (): ContextItem[] =>
  facts.filter((f) => f.status !== 'Draft').map(itemOf)

/** A context item as a suggestion's whole new version, with `after` applied. */
function draftOf(item: ContextItem, after: After): Draft {
  const text = after.summary === undefined ? null : split(after.summary)
  const body = after.bodyMarkup
    ? wordsOf(after.bodyMarkup)
    : (text?.body ?? (after.body === undefined ? item.body : (after.body ?? undefined)))
  // A summary with a link is short enough to stay one.
  const summaryMarkup = after.summaryMarkup && !text?.body ? after.summaryMarkup : undefined
  return {
    areaId: item.areaId,
    kind: item.kind,
    title: item.title,
    summary: text?.summary ?? item.summary,
    ...(summaryMarkup ? { summaryMarkup } : {}),
    ...(body ? { body } : {}),
    // A body the suggestion leaves alone keeps its links.
    ...(after.bodyMarkup
      ? { bodyMarkup: after.bodyMarkup }
      : body === item.body && item.bodyMarkup
        ? { bodyMarkup: item.bodyMarkup }
        : {}),
    scope: {
      metrics: item.scope.metrics.map((m) => `metric:${m}`),
      dimensions: [],
      dimensionValues: item.scope.dimensionValues.map((v) => ({
        dimension: `dim:${v.dimension}`,
        value: `val:${v.dimension}/${v.value}`,
      })),
    },
    validity: {
      start: item.validity.start,
      end: after.until ? endOf(after.until) : item.validity.end,
    },
    reviewDate: item.reviewDate,
    evidence: [{ ...item.evidence[0]!, url: after.source ?? item.evidence[0]!.url }],
    notToConclude: item.notToConclude,
  }
}

/** A new item a person suggests, from a mock suggestion's draft. */
function newDraft(d: {
  domain: string
  kind: ContextItem['kind']
  title: string
  summary: string
  where: string[]
  from: string
  source: string
  quote: string
  notToConclude: string
  body?: string
  until?: string
}): Draft {
  const { metrics, values } = scopeOf(d.where)
  return {
    areaId: areaOf(d.domain),
    kind: d.kind,
    title: d.title,
    summary: d.summary,
    ...(d.body ? { body: d.body } : {}),
    scope: {
      metrics: metrics.map((m) => `metric:${m}`),
      dimensions: [],
      dimensionValues: values.map((v) => ({ dimension: 'dim:market', value: `val:market/${v}` })),
    },
    validity: { start: d.from, end: endOf(d.until) },
    reviewDate: d.until ? null : '2027-03-01',
    evidence: [{ url: d.source, quote: d.quote, date: TODAY }],
    notToConclude: d.notToConclude,
  }
}

/**
 * The suggestions of the week in the order the mock's review queue shows them, newest first, so the
 * service's own order (newest first) is the mock's. Each is sent at its time today.
 */
export const queue = [
  'gap-spain',
  'sug-ines',
  'sug-ines-format',
  'sug-ines-link',
  'sug-ines-order',
  'sug-ines-long',
  'sug-ines-dates',
  'sug-agent',
  'sug-sofia-clash',
  'sug-lars-retire',
] as const
export type QueueCard = (typeof queue)[number]

/** Who sends each suggestion, as the mock's people. */
const sender: Record<QueueCard, string> = {
  // The drafting helper drafts a Not found card's text; its suggestion is under the name of someone
  // who owns no domain, so it waits in no owner's own list.
  'gap-spain': 'Maria Lindqvist',
  'sug-ines': 'Ines Duarte',
  'sug-ines-format': 'Ines Duarte',
  'sug-ines-link': 'Ines Duarte',
  'sug-ines-order': 'Ines Duarte',
  'sug-ines-long': 'Ines Duarte',
  'sug-ines-dates': 'Ines Duarte',
  'sug-agent': 'Kofi Mensah',
  'sug-sofia-clash': 'Sofia Brandt',
  'sug-lars-retire': 'Lars Dahl',
}

/** Everyone the service's sign-in offers in the demo week, by the seed's addresses. */
export const devPeople = () =>
  seedPeople.map((p) => ({
    name: p.name,
    email: `${p.id}@example.test`,
    // The mock's admins are admins on a new install too, before any seed grants them anything.
    roles: worldPeople.some((w) => w.name === p.name && w.admin) ? ['administrator' as const] : [],
  }))

type Inject = (
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  who: string,
  payload?: object,
) => Promise<Record<string, unknown>>

/** A draft the mock world started and never sent, as the service keeps a draft: what it has so far. */
function startedDraft(f: Fact): Draft {
  const { metrics, values } = scopeOf(f.where)
  return {
    areaId: areaOf(f.domain),
    kind: f.kind,
    title: f.title,
    summary: plain(f.summary),
    ...(f.body ? { body: plain(f.body) } : {}),
    scope: {
      metrics: metrics.map((m) => `metric:${m}`),
      dimensions: [],
      dimensionValues: values.map((v) => ({ dimension: 'dim:market', value: `val:market/${v}` })),
    },
    validity: { start: f.valid.from ?? TODAY, end: endOf(f.valid.until) },
    reviewDate: f.valid.until ? null : '2027-03-01',
    ...(f.source ? { evidence: [{ url: f.source, quote: f.quote, date: TODAY }] } : {}),
    ...(f.dontConclude ? { notToConclude: f.dontConclude } : {}),
  }
}

/** The mock world's drafts: started, never published, by the people who started them. */
export const demoDrafts = () => facts.filter((f) => f.status === 'Draft')

/**
 * Sends the week's suggestions through the service's API, each as the person the mock names, and
 * starts the mock's drafts. Returns each suggestion's proposal, and each draft's by its mock id.
 */
async function sendSuggestions(databaseUrl: string): Promise<{
  ids: Record<QueueCard, string>
  drafts: Record<string, string>
  comments: DatedComment[]
}> {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 2,
    options: `-c role=${localRoles.api}`,
    types: calendarDateTypes,
  })
  pool.on('error', () => undefined)
  const app = buildApp({
    database: databaseFromPool(pool),
    jobs: idleJobs(),
    logger: createLogger({ level: 'silent' }),
    clock: systemClock(TODAY),
    devPeople: devPeople(),
  })
  const sessions = new Map<string, Record<string, string>>()
  const signIn = async (name: string) => {
    const known = sessions.get(name)
    if (known) return known
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
      payload: { email: `${personId(name)}@example.test` },
    })
    if (response.statusCode !== 200) throw new Error(`${name} could not sign in: ${response.body}`)
    const headers = {
      origin: 'http://localhost',
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
    }
    sessions.set(name, headers)
    return headers
  }
  const call: Inject = async (method, path, who, payload) => {
    const response = await app.inject({
      method,
      url: '/api/v1' + path,
      headers: { ...(await signIn(who)), 'idempotency-key': randomUUID() },
      ...(payload ? { payload } : {}),
    })
    if (response.statusCode !== 200)
      throw new Error(`${method} ${path} as ${who}: ${response.statusCode} ${response.body}`)
    return response.json<Record<string, unknown>>()
  }
  /**
   * A suggestion sent the way the mock's card says: from a chat or the editor. A change carries
   * its note; the service keeps no reason for a new item.
   */
  const submit = async (card: QueueCard, draft: Draft, itemId?: string) => {
    const r = reviews.find((x) => x.id === card)!
    const p = await call('POST', '/proposals', sender[card], {
      draft,
      channel: r.via === 'editor' ? 'form' : 'chat',
      ...(itemId ? { itemId, ...(r.note ? { reason: r.note } : {}) } : {}),
    })
    const who = sender[card]
    await call('POST', `/proposals/${p.id as string}/submit`, who, { revision: p.revision })
    return p.id as string
  }
  try {
    const library = new Map(demoLibrary().map((item) => [item.id, item]))
    const ids = {} as Record<QueueCard, string>
    for (const edit of edits) {
      const item = library.get(serverItemId(edit.item))!
      ids[edit.card as QueueCard] = await submit(
        edit.card as QueueCard,
        draftOf(item, edit.after),
        item.id,
      )
    }
    const agent = reviews.find((r) => r.id === 'sug-agent')!
    ids['sug-agent'] = await submit(
      'sug-agent',
      newDraft({
        domain: 'sales',
        kind: 'issue',
        title: agent.title,
        summary: agent.source.after,
        where: ['Orders', 'Poland'],
        from: '2026-10-14',
        source: 'https://status.example/payments/poland',
        quote: agent.claims!.sentence,
        notToConclude:
          'Low orders in Poland for these days do not mean that customers ordered less. Wait until the data catches up before comparing Poland with other markets.',
      }),
    )
    // What agents couldn't answer about Orders in Spain in October, drafted from a status page.
    ids['gap-spain'] = await submit(
      'gap-spain',
      newDraft({
        domain: 'sales',
        kind: spainDraft.kind,
        title: spainDraft.title,
        summary: spainDraft.summary,
        where: spainDraft.where,
        from: spainDraft.valid.from!,
        source: spainDraft.source,
        quote: spainDraft.quote,
        notToConclude: spainDraft.dontConclude,
        body: spainDraft.body,
        until: spainDraft.valid.until,
      }),
    )
    const clash = reviews.find((r) => r.id === 'sug-sofia-clash')!
    ids['sug-sofia-clash'] = await submit(
      'sug-sofia-clash',
      newDraft({
        domain: 'sales',
        kind: 'note',
        title: clash.title,
        summary: clash.source.after,
        where: ['Orders', 'Norway'],
        from: '2026-11-01',
        source: 'https://wiki.example/finance/store-credit-2026-11',
        quote: 'From 1 November 2026, store credit and gift cards are not booked as orders.',
        notToConclude: 'Lower Norway orders from November 2026 do not mean fewer purchases.',
      }),
    )
    const retire = reviews.find((r) => r.id === 'sug-lars-retire')!
    const retired = await call(
      'POST',
      `/items/${serverItemId(retire.retire!.factId)}/retire-proposals`,
      sender['sug-lars-retire'],
      { reason: retire.retire!.reason },
    )
    ids['sug-lars-retire'] =
      (retired.proposal as { id: string } | undefined)?.id ?? (retired.id as string)
    const drafts: Record<string, string> = {}
    for (const f of demoDrafts()) {
      const started = await call('POST', '/proposals', f.by!, {
        draft: startedDraft(f),
        channel: 'form',
      })
      drafts[f.id] = started.id as string
    }
    const comments = await seedThreads(call, ids)
    return { ids, drafts, comments }
  } finally {
    // Closing the app ends its pool.
    await app.close()
  }
}

/** A mock day and time ("Today, 08:50", "Yesterday, 14:20", "16 Oct") in the demo week. */
function atOf(when: string): string {
  const [day = '', time = '12:00'] = when.split(', ')
  const date =
    day === 'Today'
      ? TODAY
      : day === 'Yesterday'
        ? shiftDate(TODAY, -1)
        : isoDay(`${day} ${TODAY.slice(0, 4)}`, TODAY)
  return `${date}T${time}:00Z`
}

/**
 * A seeded comment's id on the service, and when the mock says it was written and edited; one that
 * took its suggestion back did so as it was written.
 */
type DatedComment = { id: string; at: string; edited: boolean; withdrew: boolean }

/** The mock's threads the service does not hold (see the note at the top). */
const leftOut = new Set<Subject>(['review:sug-jon', 'review:sug-sofia-clash'])

/** The threads the service holds, by the mock's subject. */
const seededThreads = (Object.keys(seedComments) as Subject[]).filter((s) => !leftOut.has(s))

/** A mock subject as the service names it: a suggestion by its proposal, an item by its id. */
function serviceSubject(subject: Subject, ids: Record<QueueCard, string>): string {
  const [kind, id = ''] = subject.split(':')
  if (kind === 'context') return `context:${serverItemId(id)}`
  const proposal = ids[id as QueueCard]
  if (!proposal) throw new Error(`${subject} is not a suggestion on the service`)
  return `review:${proposal}`
}

/** A comment as the service takes it: a mention names its person by id. */
function serviceBody(node: JSONContent): JSONContent {
  if (node.type === 'mention') {
    const label = String(node.attrs?.label ?? '')
    return { type: 'mention', attrs: { id: `person:${seedPersonId(personId(label))}`, label } }
  }
  return node.content ? { ...node, content: node.content.map(serviceBody) } : node
}

/**
 * The mock's threads, written through the API by the people who write them in the mock: each
 * comment and its replies in order, the reactions on them and on what they hang on, the edit and
 * the deletion. Jon then opens each thread, as he has read them in the mock, which leaves the
 * mentions of him unread. Returns each comment's time in the mock, for the seed to date it.
 */
async function seedThreads(call: Inject, ids: Record<QueueCard, string>) {
  const dated: DatedComment[] = []
  const deleted: { id: string; by: string }[] = []
  const react = async (subject: string, list: CommentReaction[] = [], commentId?: string) => {
    for (const r of list)
      for (const who of r.by)
        await call('POST', '/reactions/toggle', who, {
          subject,
          emoji: r.emoji,
          ...(commentId ? { commentId } : {}),
        })
  }
  const write = async (subject: string, c: CommentItem, parentId?: string) => {
    // A deleted comment had words once; the deletion takes them away.
    const body = c.deleted ? serviceBody(text('A comment taken back.')) : serviceBody(c.content)
    const posted = await call('POST', '/comments', c.author, {
      subject,
      body,
      ...(parentId ? { parentId } : {}),
    })
    const id = posted.id as string
    dated.push({ id, at: atOf(c.when), edited: Boolean(c.edited), withdrew: Boolean(c.withdrew) })
    if (c.deleted) deleted.push({ id, by: c.author })
    else await react(subject, c.reactions, id)
    if (c.withdrew) await call('POST', `/comments/${id}/withdraw`, c.author, { withdrew: true })
    return id
  }
  for (const mockSubject of seededThreads) {
    const subject = serviceSubject(mockSubject, ids)
    for (const c of seedComments[mockSubject] ?? []) {
      const id = await write(subject, c)
      for (const r of c.replies ?? []) await write(subject, r, id)
    }
  }
  for (const [mockSubject, list] of Object.entries(seedReactions) as [Subject, CommentReaction[]][])
    if (!leftOut.has(mockSubject)) await react(serviceSubject(mockSubject, ids), list)
  // Deleted once the thread has answered them, so each keeps its place.
  for (const d of deleted) await call('DELETE', `/comments/${d.id}`, d.by)
  for (const mockSubject of seededThreads)
    await call('POST', '/comments/threads/read', OWNER.name, {
      subject: serviceSubject(mockSubject, ids),
    })
  return dated
}

/** Dates the seeded comments as the mock does; an edited one was edited two hours later. */
async function dateComments(client: pg.Client, comments: readonly DatedComment[]) {
  // The comments' guard keeps a comment's time as it was written: dated here as the seed's owner.
  await client.query('set session_replication_role = replica')
  try {
    for (const c of comments)
      await client.query(
        `update comments set created_at=$2::timestamptz,
                edited_at=case when $3 then $2::timestamptz + interval '2 hours' end,
                withdrew_at=case when $4 then $2::timestamptz end
          where id=$1`,
        [c.id, c.at, c.edited, c.withdrew],
      )
  } finally {
    await client.query('set session_replication_role = origin')
  }
}

/** The mock's terms with their own meaning, as the library is written with them. */
const ownTerms = () =>
  TERMS.filter((t) => !t.sameAs).map((t) => ({
    id: termIds.get(t.name.toLowerCase())!,
    name: t.name,
    meaning: t.definition,
    areaId: t.domain ? areaOf(t.domain) : null,
    by: seedPersonId(personId(t.by!)),
    at: `${isoDay(t.updated, TODAY)}T09:00:00Z`,
  }))

/**
 * The mock's synonyms, once the library is served: each pointing at what it finally means, a
 * metric or a dimension by its key, or a term with its own meaning by its id.
 */
async function seedSynonyms(client: pg.Client) {
  const terms = TERMS
  const byName = new Map(terms.map((t) => [t.name.toLowerCase(), t]))
  const meaningOf = (name: string): string => {
    const t = byName.get(name.toLowerCase())
    return t?.sameAs ? meaningOf(t.sameAs) : name
  }
  const keyOf = (name: string) => {
    const metric = metricOf(name)
    if (metric) return `metric:${metric.id}`
    const dimension = vocabulary.dimensions.find((d) => d.name === name)
    if (dimension) return `dim:${dimension.id}`
    return null
  }
  for (const t of terms.filter((x) => x.sameAs)) {
    const target = meaningOf(t.sameAs!)
    const key = keyOf(target)
    await client.query(
      `insert into terms (name, meaning, same_as_key, same_as_term, area_id, created_by, updated_by,
                          created_at, updated_at)
       values ($1, null, $2, $3::uuid, $4, $5::uuid, $5::uuid, $6::timestamptz, $6::timestamptz)`,
      [
        t.name,
        key,
        key ? null : termIds.get(target.toLowerCase()),
        t.domain ? areaOf(t.domain) : null,
        seedPersonId(personId(t.by!)),
        `${isoDay(t.updated, TODAY)}T09:00:00Z`,
      ],
    )
  }
}

/** What the demo week's mock ids are on the service. */
export type DemoWeekIds = Record<QueueCard | DriveCard | 'flag-germany', string> &
  Record<`topic.${string}`, string> & {
    /** Each draft's proposal, by the draft's mock id. */
    drafts: Record<string, string>
  }

/**
 * What agents asked this week, as the service keeps it: topics and their counts, never the words
 * (FR-602). The mock's topics (data/observability.ts), 142 calls in all, on the service's own
 * vocabulary: the mock's Revenue group is Gross sales here, its Black Friday is all markets, its
 * Repeat purchases is Repeat purchase rate, and Orders in Germany is one month. Net revenue in
 * Norway is 12 and 5 rather than 13 and 4: beside its row's "13+", the total would give the 4
 * away, so the service would hide it (FR-614). Orders in Spain is the Not found card's topic,
 * seeded with it.
 */
export const askedThisWeek: {
  area: string | null
  metric: string | null
  market: string | null
  month: string
  calls: number
  nothing: number
}[] = [
  {
    area: 'area_sales',
    metric: 'orders',
    market: 'norway',
    month: '2026-10',
    calls: 24,
    nothing: 1,
  },
  {
    area: 'area_sales',
    metric: 'orders',
    market: 'norway',
    month: '2026-09',
    calls: 7,
    nothing: 0,
  },
  {
    area: 'area_sales',
    metric: 'net_revenue',
    market: 'norway',
    month: '2026-10',
    calls: 12,
    nothing: 1,
  },
  {
    area: 'area_sales',
    metric: 'net_revenue',
    market: 'norway',
    month: '2026-09',
    calls: 5,
    nothing: 0,
  },
  {
    area: 'area_sales',
    metric: 'gross_sales',
    market: 'norway',
    month: '2026-10',
    calls: 5,
    nothing: 0,
  },
  {
    area: 'area_sales',
    metric: 'units_sold',
    market: null,
    month: '2026-10',
    calls: 12,
    nothing: 1,
  },
  { area: null, metric: null, market: 'norway', month: '2026-10', calls: 5, nothing: 0 },
  {
    area: 'area_marketing',
    metric: 'discount_cost',
    market: null,
    month: '2026-10',
    calls: 14,
    nothing: 0,
  },
  {
    area: 'area_sales',
    metric: 'orders',
    market: 'poland',
    month: '2026-10',
    calls: 13,
    nothing: 6,
  },
  {
    area: 'area_sales',
    metric: 'orders',
    market: 'spain',
    month: '2026-10',
    calls: 12,
    nothing: 9,
  },
  {
    area: 'area_sales',
    metric: 'orders',
    market: 'germany',
    month: '2026-10',
    calls: 6,
    nothing: 6,
  },
  {
    area: 'area_marketing',
    metric: 'cost_per_acquisition',
    market: 'germany',
    month: '2026-10',
    calls: 10,
    nothing: 0,
  },
  {
    area: 'area_customer_value',
    metric: 'new_customers',
    market: 'norway',
    month: '2026-10',
    calls: 6,
    nothing: 0,
  },
  {
    area: 'area_paid_media',
    metric: 'return_on_ad_spend',
    market: 'sweden',
    month: '2026-10',
    calls: 6,
    nothing: 0,
  },
  {
    area: 'area_customer_value',
    metric: 'repeat_purchase_rate',
    market: null,
    month: '2026-10',
    calls: 5,
    nothing: 1,
  },
]

async function seedAskedThisWeek(client: pg.Client) {
  for (const t of askedThisWeek) {
    const metrics = t.metric ? [`metric:${t.metric}`] : []
    const values = t.market ? [`val:market/${t.market}`] : []
    const key = [t.area ?? '', t.metric ?? '', t.market ?? '', t.month].join('|')
    // The Not found card's topic is already there: its counts join it.
    const [topic] = (
      await client.query<{ id: string }>(
        `insert into topics (key, area_id, metric_keys, value_keys, month)
         values ($1, $2, $3, $4, $5::date)
         on conflict (key) do update set key = excluded.key
         returning id::text`,
        [key, t.area, metrics, values, `${t.month}-01`],
      )
    ).rows
    for (const [status, calls, nothing] of [
      ['matched', t.calls - t.nothing, 0],
      ['no_match', t.nothing, t.nothing],
    ] as const)
      if (calls)
        await client.query(
          `insert into topic_week_counts (topic_id, week, status, calls, no_item_calls)
           values ($1, date_trunc('week', $5::date)::date, $2, $3, $4)`,
          [topic!.id, status, calls, nothing, TODAY],
        )
  }
}

/**
 * Seeds an empty migrated database with the demo week, as a superuser: the library, Jon as an
 * admin as the mock has him, the terms and synonyms, the suggestions and the drafts through the
 * API, then who wrote what and when each was sent, the report and the Not found card. Returns each
 * mock card's id on the service: a suggestion's proposal (the Not found card's draft for
 * gap-spain), the report's card, and each draft's proposal.
 */
/**
 * The agents people connected, as the mock lists them: each agent registered once with the
 * login server, and a connection for each person, made the day the mock says, used as lately as
 * it says. Nothing here is a token: a connection's tokens are only ever made by signing in.
 */
async function seedAgentConnections(client: pg.Client) {
  const ago = { Today: '2 hours', Yesterday: '1 day' } as Record<string, string>
  for (const [index, row] of seedAgents.entries()) {
    const clientId = `demo-agent-${row.agent.toLowerCase().replace(/[^a-z]+/g, '-')}`
    await client.query(
      `insert into auth.oauth_clients (id, kind, name, redirect_uris)
       values ($1, 'registered', $2, '{http://127.0.0.1:43123/callback}') on conflict (id) do nothing`,
      [clientId, row.agent],
    )
    await client.query(
      `insert into auth.oauth_grants (person_id, client_id, scopes, created_at, expires_at, last_used_at)
       values ($1, $2, $6, $3::timestamptz, now() + interval '30 days',
               now() - $4::interval - make_interval(mins => $5))`,
      [
        seedPersonId(personId(row.who)),
        clientId,
        `${isoDay(row.since, TODAY)}T09:00:00Z`,
        ago[row.used] ?? '3 days',
        index,
        // What the person allowed: the scopes of the tools the agent may have.
        agentScopes.filter((scope) =>
          row.tools.some((t) => t.allowed && toolScopes[t.tool] === scope),
        ),
      ],
    )
    // Each is an agent by name, with the tools an admin left on for it, as the mock has it (FR-420).
    await client.query(
      `insert into auth.agents (kind, name, person_id, client_id, tools, tools_set_by, tools_set_at)
       values ('app', $1, $2, $3, $4, $5, $6)`,
      [
        row.agent,
        seedPersonId(personId(row.who)),
        clientId,
        row.tools.filter((t) => t.on).map((t) => t.tool),
        row.setBy ? seedPersonId(personId(row.setBy.name)) : null,
        row.setBy ? `${isoDay(row.setBy.on, TODAY)}T09:00:00Z` : null,
      ],
    )
  }
}

export async function seedDemoWeek(superuserUrl: string): Promise<DemoWeekIds> {
  let flag: string | undefined
  let topics: Map<string, string> | undefined
  const client = new pg.Client({ connectionString: superuserUrl, types: calendarDateTypes })
  await client.connect()
  try {
    await bulkSeed(client, demoLibrary(), {
      conflicts: [[serverItemId('itm_gift_store_credit'), serverItemId('itm_gift_card_only')]],
      replaces: facts.flatMap((f) =>
        f.replaces ? [[serverItemId(f.id), serverItemId(f.replaces)] as const] : [],
      ),
      terms: ownTerms(),
    })
    const admins = worldPeople.filter((p) => p.admin).map((p) => seedPersonId(personId(p.name)))
    await client.query(
      `insert into global_role_grants (person_id, role)
       select unnest($1::uuid[]), 'administrator' on conflict do nothing`,
      [admins],
    )
    await seedSynonyms(client)
  } finally {
    await client.end()
  }
  const { ids, drafts, comments } = await sendSuggestions(superuserUrl)
  const after = new pg.Client({ connectionString: superuserUrl })
  await after.connect()
  try {
    // An agent wrote Kofi's, sent with his OK (named below, once the agents are in).
    await after.query(
      `update proposals set provenance='{"by":"agent","fields":{},"flags":[]}' where id=$1`,
      [ids['sug-agent']],
    )
    await dateComments(after, comments)
    await after.query('select cl_ensure_delivery_partitions(2), cl_ensure_request_partitions(2)')
    // Maria asked Ask about Orders in Germany, got "Orders lags by one day in the source tool",
    // and reported it with her name, as the mockup's Observability lists it ("Maria Lindqvist,
    // from Ask"). Sent after every seeded decision, so nothing an owner did answers it yet.
    const [report] = (
      await after.query<{ id: string }>(
        `insert into reports (person_id, area_id, item_id, part, question, what)
         values ($1, 'area_sales', $2, 'item', 'Why are Germany orders low for yesterday?',
                 'Is this Germany only, or every market?')
         returning id::text`,
        [seedPersonId(personId('Maria Lindqvist')), serverItemId('itm_0tmqp7o1')],
      )
    ).rows
    flag = `report:${report!.id}`
    // Agents asked about Orders in Spain for October 9 times this week and found nothing written
    // down: the Not found card, with the draft the drafting helper made from a status page.
    const [gap] = (
      await after.query<{ id: string }>(
        `with topic as (
           insert into topics (key, area_id, metric_keys, value_keys, month)
           values ('area_sales|orders|spain|2026-10', 'area_sales', '{metric:orders}', '{val:market/spain}', '2026-10-01')
           returning id)
         insert into gaps (topic_id, type, opened_by_case) select id, 'missing', 1 from topic
         returning id::text`,
      )
    ).rows
    await after.query(
      `insert into gap_weekly_counts (gap_id, week, no_item_calls)
       values ($1, date_trunc('week', now() at time zone 'UTC')::date, 9)`,
      [gap!.id],
    )
    await seedAskedThisWeek(after)
    await after.query(
      `update proposals set source_gap_id = $1, provenance = '{"by":"assistant","fields":{},"flags":[]}' where id = $2`,
      [gap!.id, ids['gap-spain']],
    )
    await after.query('insert into gap_proposals (gap_id, proposal_id) values ($1, $2)', [
      gap!.id,
      ids['gap-spain'],
    ])
    // The workspace finished its setup: agents asked through MCP, and someone used Ask.
    await after.query(
      `insert into mcp_requests (client_label, tool, status, app_family) values ('claude', 'get_context', 'ok', 'claude_code')`,
    )
    await after.query(`insert into setup_marks (step) values ('ask') on conflict do nothing`)
    // The workspace's name, as an admin named it, and the agents people connected (P11a).
    await after.query(
      `insert into settings_versions (key, version, value, reason)
       select 'workspace.name', max(version) + 1, to_jsonb($1::text), 'Named in General.'
         from settings_versions where key = 'workspace.name'`,
      [WORKSPACE_NAME],
    )
    await seedAgentConnections(after)
    // An agent wrote Kofi's, sent with his OK: his Claude Code, named on the suggestion as
    // suggest_context names it. Which agent sent a suggestion never changes once it is made, so the
    // seed writes it past that guard.
    await after.query('begin')
    await after.query("set local session_replication_role = 'replica'")
    await after.query(
      `update proposals p set channel='mcp',
              agent_id=a.id, agent_name=a.name
         from auth.agents a
        where p.id=$1 and a.kind='app' and a.person_id=p.proposer_id and a.name=$2`,
      [ids['sug-agent'], reviews.find((r) => r.id === 'sug-agent')!.agent],
    )
    await after.query('commit')
    // What agents asked over the weeks Observability counts, and what they reported (P12).
    topics = await seedObservability(after)
    // Sent this morning, one minute apart, newest first in the mock's order.
    for (const [index, card] of queue.entries())
      await after.query(
        `update proposals set submitted_at=$2::timestamptz, created_at=$2::timestamptz where id=$1`,
        [ids[card], `${TODAY}T09:${String(12 - index).padStart(2, '0')}:00Z`],
      )
  } finally {
    await after.end()
  }
  if (!flag) throw new Error('The report was not seeded')
  // The saved questions people keep, and how the check found them (P12).
  await seedSavedQuestions(superuserUrl, TODAY, (name) => seedPersonId(personId(name)))
  // This morning's Google Drive read, before anyone sent a suggestion: last in the queue.
  const drive = await seedDriveRead(superuserUrl, TODAY)
  // What the alert rules raised on it, and the Inbox items they sent (P12).
  await raiseDemoAlerts(superuserUrl, TODAY)
  // Summary's monthly snapshots of August and September, as the nightly job took them.
  await takeDemoSnapshots(superuserUrl)
  return {
    ...ids,
    ...drive,
    'flag-germany': flag,
    drafts,
    ...Object.fromEntries([...(topics ?? [])].map(([mock, id]) => [`topic.${mock}`, id])),
  }
}
