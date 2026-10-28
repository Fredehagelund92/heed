import { ORPCError } from '@orpc/client'
import type {
  AnswerResult,
  Asked,
  FollowedLinks,
  LookupEvent,
  LookupInput,
  Reach,
  Replay,
  TryItRun,
} from '../../../contract/answer.ts'
import type { TryItInput } from '../../../contract/connect.ts'
import type { ProposalRecord } from '../../../contract/proposals.ts'
import {
  answer,
  askedTopics,
  lookUp,
  reach,
  startersOf,
  topicScope,
  topicWords,
  type Answer,
  type AnswerAsk,
  type TopicCount,
} from '../../../domain/answer.ts'
import { followedFrom } from '../../../domain/links.ts'
import { compareIds } from '../../../domain/resolver.ts'
import { visibleTotal } from '../../../domain/gaps.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { tryIt } from '../agents/index.ts'
import { enabledTools, loadServingBundle, type ServingBundle } from '../editions/index.ts'
import { draftBundle } from '../proposals/index.ts'

/** An edition to answer on: its sequence, its label and the overlay of stops and flags now. */
type Head = { seq: string; label: string; overlay: string }
type Target = AnswerResult['target']

const nothingLive = () =>
  new ORPCError('PRECONDITION_FAILED', {
    message:
      'Nothing is shared with agents yet. They get facts once an owner accepts the first one.',
  })
/** Steps are timed with the process's clock; the answer is the same whatever it says. */
const clockMs = () => performance.now()

const overlayOf = `coalesce((select seq::text from serving_overlay),'0') as overlay`
async function liveHead(tx: Queryable): Promise<Head | null> {
  const [head] = await tx.query<Head>(
    `select e.seq::text,e.label,${overlayOf} from editions e join live_edition l on l.seq=e.seq`,
  )
  return head ?? null
}
/** The sealed edition before the live one: what agents got before the last publish. */
async function headBefore(tx: Queryable): Promise<Head | null> {
  const [head] = await tx.query<Head>(
    `select e.seq::text,e.label,${overlayOf} from editions e
      where e.sealed_at is not null and e.seq < (select seq from live_edition)
      order by e.seq desc limit 1`,
  )
  return head ?? null
}

/**
 * The bundles answers are read from, by edition and overlay, kept for 15 seconds like the agents'
 * edition source keeps them, so a look-up does not read the whole edition each time. A bundle is
 * what agents get, the same for every person (its reads are the security definer serving
 * functions), so one bundle serves everyone. A new publish or stop switch is a new key.
 */
export function createBundleCache(capacity = 4, ttl = 15_000, now = () => Date.now()) {
  const cache = new Map<string, { bundle: Promise<ServingBundle>; expires: number }>()
  return {
    bundle(tx: Queryable, head: Head): Promise<ServingBundle> {
      const key = `${head.seq}:${head.overlay}`
      const cached = cache.get(key)
      if (cached && cached.expires > now()) return cached.bundle
      const bundle = loadServingBundle(tx, head)
      cache.set(key, { bundle, expires: now() + ttl })
      // A failed read is not kept: the next request reads again.
      bundle.catch(() => cache.delete(key))
      while (cache.size > capacity) cache.delete(cache.keys().next().value!)
      return bundle
    },
  }
}
export type BundleCache = ReturnType<typeof createBundleCache>

/** What agents get now, from the cache; refused when nothing is shared yet. */
export async function liveBundle(tx: Queryable, cache: BundleCache): Promise<ServingBundle> {
  const head = await liveHead(tx)
  if (!head) throw nothingLive()
  return cache.bundle(tx, head)
}

const result = (a: Answer, target: Target): AnswerResult => {
  const { overlay: _overlay, ...rest } = a
  return { target, ...rest }
}

/**
 * Ask's look-up (FR-701): the question on the live edition as get_context answers an agent, with
 * no model, each step as it is done and then the answer; then, given `words`, what a real model
 * wrote from the answer's items. The question is read in memory and never
 * stored or logged (FR-602); the bundle is read before the first step, so the steps need no
 * database.
 */
export async function lookupQuestion(
  tx: Queryable,
  clock: Clock,
  cache: BundleCache,
  input: LookupInput,
  /** The words a real model writes from the answer, or null (no model, or none that passed). */
  words?: (answer: AnswerResult) => Promise<string | null>,
): Promise<AsyncGenerator<LookupEvent>> {
  const [bundle, tools] = await Promise.all([liveBundle(tx, cache), enabledTools(tx)])
  const today = clock.today()
  const steps = lookUp(bundle, input, { today, now: clockMs })
  function* events(): Generator<LookupEvent> {
    for (;;) {
      const next = steps.next()
      if (next.done) {
        const answer = result(next.value, { kind: 'live' })
        yield {
          type: 'answer',
          answer: { ...answer, links: linksOf(bundle, answer, tools, today) },
        }
        return
      }
      yield { type: 'step', step: next.value }
    }
  }
  return (async function* () {
    for (const event of events()) {
      yield event
      // Let the stream send this step before the next one runs.
      await new Promise<void>((done) => setImmediate(done))
      if (event.type === 'answer' && words) {
        const text = await words(event.answer)
        if (text) yield { type: 'words', text }
      }
    }
  })()
}

/**
 * What an agent follows from the answer's items with get_related, while the switch has it on
 * (FR-407): one step from each, as get_related reads a link with no dates, so a link reads the
 * same whatever the question's dates.
 */
function linksOf(
  bundle: ServingBundle,
  answer: AnswerResult,
  tools: readonly string[],
  today: string,
): FollowedLinks {
  if (!tools.includes('get_related') || !answer.items.length)
    return { on: tools.includes('get_related'), followed: [], notFollowed: [] }
  const { followed, notFollowed } = followedFrom(
    bundle,
    answer.items.map((i) => i.id),
    today,
  )
  return {
    on: true,
    followed: followed.map(({ from, rel, to }) => ({
      from,
      rel,
      to:
        to.type === 'item'
          ? {
              type: 'item' as const,
              id: to.id,
              label: to.label,
              areaId: to.area,
              read: to.summary,
              sameAs: null,
            }
          : {
              type: 'term' as const,
              id: to.id,
              label: to.label,
              areaId: to.area ?? null,
              read: to.meaning,
              sameAs: to.same_as ?? null,
            },
    })),
    notFollowed,
  }
}

/**
 * Try it (FR-108, FR-505): get_facts's reply for a typed scope and the engine's answer beside it,
 * on the live edition, or with a draft in it when `draft` names a proposal the person may read.
 * Nothing is recorded.
 */
export async function tryItRun(
  tx: Queryable,
  clock: Clock,
  cache: BundleCache,
  input: TryItInput & { draft?: string },
  web: string | null,
  proposal: (id: string) => Promise<ProposalRecord>,
): Promise<TryItRun> {
  const { draft, ...scope } = input
  let bundle: ServingBundle
  let target: Target
  if (draft) {
    const drafted = await draftBundle(tx, await proposal(draft), (head) => cache.bundle(tx, head))
    bundle = drafted.bundle
    target = { kind: 'draft', proposal: draft, item: drafted.item }
  } else {
    bundle = await liveBundle(tx, cache)
    target = { kind: 'live' }
  }
  const reply = await tryIt(tx, clock, scope, web, bundle)
  const ask: AnswerAsk = { question: '', ...scope }
  return {
    ...reply,
    answer: result(answer(bundle, ask, { today: clock.today(), now: clockMs }), target),
  }
}

/** The minimum count under which no count is shown (FR-614, `privacy.min_count`). */
async function minimumCount(tx: Queryable): Promise<number> {
  const [row] = await tx.query<{ minimum: number }>(
    `select (value #>> '{}')::int as minimum from settings_current where key='privacy.min_count'`,
  )
  return row?.minimum ?? 5
}

/**
 * The topics agents asked about in the week of `today` (Monday to Sunday, UTC), with how often:
 * agent calls only, as the topic counts keep them, with no words and no person (FR-602).
 */
async function topicsOfWeek(
  tx: Queryable,
  today: string,
): Promise<{ week: string; topics: TopicCount[] }> {
  const [week] = await tx.query<{ week: string }>(
    `select date_trunc('week', $1::date)::date::text as week`,
    [today],
  )
  const topics = await tx.query<TopicCount>(
    `select t.id::text, t.area_id as area, t.metric_keys as metrics, t.value_keys as values,
            t.dimension_keys as dimensions, t.month::text as month, w.calls
       from v_topic_weeks w join topics t on t.id = w.topic_id
      where w.week = $1::date and w.calls > 0
      order by t.id`,
    [week!.week],
  )
  return { week: week!.week, topics }
}

/** An open Not found card the reader manages, by its topic's parts, with its draft. */
type OpenGap = {
  id: string
  area: string | null
  metrics: string[]
  values: string[]
  dimensions: string[]
  month: string
  draft: string | null
}
const partsKey = (t: Pick<OpenGap, 'area' | 'metrics' | 'values' | 'dimensions'>) =>
  [
    t.area ?? '',
    [...t.metrics].sort(compareIds).join(','),
    [...t.values].sort(compareIds).join(','),
    [...t.dimensions].sort(compareIds).join(','),
  ].join('|')

/**
 * The Not found cards open on the topics the reader manages (`cl_manages_topic`, administrators
 * and the owners of the topic's domains), latest month first, with the draft that waits on each.
 */
async function openGaps(tx: Queryable): Promise<OpenGap[]> {
  return tx.query<OpenGap>(
    `select g.id::text, t.area_id as area, t.metric_keys as metrics, t.value_keys as values,
            t.dimension_keys as dimensions, t.month::text as month,
            (select p.id::text from gap_proposals gp join proposals p on p.id=gp.proposal_id
              where gp.gap_id=g.id and p.discarded_at is null order by p.created_at desc limit 1) as draft
       from gaps g join topics t on t.id=g.topic_id
      where g.status in ('open','proposal_made') and cl_manages_topic(t.area_id, t.metric_keys)
      order by t.month desc, g.id`,
  )
}

/**
 * Asked this week (FR-714): the topics agents asked about most this week, one row per metric,
 * market and dimension with its months joined, each with the state Ask gives it now on the live
 * edition for its latest month. Counts only, never the words, and a count under the minimum is
 * never shown or given away by a total (FR-614). An owner sees the Not found card open on a
 * topic of their domain. Beside them, the workspace's first questions, made from what it has
 * written, for when nothing has been asked yet.
 */
export async function askedThisWeek(
  tx: Queryable,
  clock: Clock,
  cache: BundleCache,
): Promise<Asked> {
  const bundle = await liveBundle(tx, cache)
  const today = clock.today()
  const minimum = await minimumCount(tx)
  const { week, topics } = await topicsOfWeek(tx, today)
  const asked = askedTopics(topics, minimum, today)
  const gaps = await openGaps(tx)
  return {
    week,
    rows: asked.topics.map((topic) => {
      const scope = topicScope(topic)
      const now = answer(bundle, { scope }, { today })
      const gap = now.state === 'missing' ? gaps.find((g) => partsKey(g) === topic.key) : undefined
      return {
        title: topicWords(bundle, scope),
        area: topic.area,
        scope,
        months: topic.months,
        count: topic.count,
        atLeast: topic.atLeast,
        state: now.state,
        items: now.items.length,
        gap: gap ? { card: `gap:${gap.id}`, draft: gap.draft } : null,
      }
    }),
    hidden: asked.hidden,
    // The total beside the rows: shown only when what it adds over the counts the rows show is
    // zero or at least the minimum, so it never gives a small month away by subtraction.
    asked: visibleTotal(
      topics.reduce((sum, t) => sum + t.calls, 0),
      asked.topics.reduce((sum, t) => sum + (t.count ?? t.atLeast), 0) + (asked.hidden ?? 0),
      minimum,
    ),
    askedAtLeast: asked.topics.reduce((sum, t) => sum + (t.count ?? t.atLeast), 0),
    starters: startersOf(bundle, today).map((scope) => ({
      title: topicWords(bundle, scope),
      scope,
    })),
  }
}

/**
 * The answer panel's replay (FR-620): a topic answered now, or before the last publish, on the
 * edition before the live one, step by step and with no model. A topic is read by administrators
 * and the owners of its domains only, as its gap is (`cl_manages_topic`); anyone else is told it
 * does not exist.
 */
export async function replayTopic(
  tx: Queryable,
  clock: Clock,
  cache: BundleCache,
  input: { topic: string; when: 'now' | 'before' },
): Promise<Replay> {
  const [topic] = await tx.query<Omit<TopicCount, 'id' | 'calls'> & { manages: boolean }>(
    `select t.area_id as area, t.metric_keys as metrics, t.value_keys as values,
            t.dimension_keys as dimensions, t.month::text as month,
            cl_manages_topic(t.area_id, t.metric_keys) as manages
       from topics t where t.id = $1`,
    [input.topic],
  )
  if (!topic?.manages) throw new ORPCError('NOT_FOUND')
  const head = input.when === 'now' ? await liveHead(tx) : await headBefore(tx)
  if (!head)
    throw input.when === 'now'
      ? nothingLive()
      : new ORPCError('PRECONDITION_FAILED', {
          message:
            'Agents got nothing before what they get today, so there is nothing to compare with yet.',
        })
  const bundle = await cache.bundle(tx, head)
  const scope = topicScope(topic)
  return {
    when: input.when,
    answer: result(
      answer(bundle, { scope }, { today: clock.today(), now: clockMs }),
      input.when === 'now' ? { kind: 'live' } : { kind: 'edition' },
    ),
  }
}

/**
 * The reach of a draft (the editor's and the review's "12 questions agents asked this week would
 * get it"): this week's topics answered on the live edition with the draft in it, counting the
 * questions of each topic whose answer gives the draft. Only topics asked at least the minimum
 * times count (FR-614).
 */
export async function reachOfDraft(
  tx: Queryable,
  clock: Clock,
  cache: BundleCache,
  p: ProposalRecord,
): Promise<Reach> {
  const today = clock.today()
  const drafted = await draftBundle(tx, p, (head) => cache.bundle(tx, head))
  const { week, topics } = await topicsOfWeek(tx, today)
  return {
    questions: reach(drafted.bundle, drafted.item, topics, today, await minimumCount(tx)),
    week,
  }
}
