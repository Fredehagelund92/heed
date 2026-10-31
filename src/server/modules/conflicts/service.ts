import { ORPCError } from '@orpc/client'
import type {
  ConflictDecision,
  ConflictList,
  ConflictRow,
  ConflictSide,
  ConflictView,
  SettleConflictInput,
  SettledConflict,
} from '../../../contract/conflicts.ts'
import { answer, topicWords, type Answer } from '../../../domain/answer.ts'
import {
  conflictPairs,
  maySettle,
  pairOf,
  settleRights,
  stillKept,
  type ConflictPair,
  type SettleOutcome,
  type Settler,
  type SettledItem,
} from '../../../domain/conflicts.ts'
import type { CommentNode } from '../../../domain/comments.ts'
import { matchingProbes } from '../../../domain/review.ts'
import type { ResolvedScope } from '../../../domain/scope.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { liveServingBundle, type BundleCache } from '../answer/index.ts'
import type { ServingBundle, ServingItem } from '../editions/index.ts'
import type { LibraryService } from '../library/index.ts'
import { rejectMentions, rejectSensitive, type ProposalsService } from '../proposals/index.ts'
import type { ReviewPath, ReviewService } from '../review/index.ts'

/**
 * Conflicts (FR-220, the conflict view): the pairs of live items an owner said disagree, one pair
 * read side by side, and settling it with a reason. A conflict is declared by a person; nothing here
 * compares what the items say. What a decision changes goes through the paths that already guard
 * it: keeping one archives the other with a retire decision, removing the flag is a new version
 * its owner publishes. Keeping both changes nothing agents get. Every decision is kept with its
 * reason on both items' history, and the other owners hear of it in a comment that mentions them.
 */
export type ConflictsDeps = {
  library: LibraryService
  proposals: ProposalsService
  review: ReviewService
  path: ReviewPath
  comments: { create(input: { subject: string; body: unknown }): Promise<unknown> }
}

type Me = Settler & { name: string }
type Decided = {
  id: string
  holder: string
  other: string
  outcome: SettleOutcome
  keptId: string | null
  reason: string
  quote: string | null
  holderVersion: number
  otherVersion: number
  personId: string
  at: string
}

const decisionColumns = `d.id::text, d.holder_item_id as holder, d.other_item_id as other,
  d.outcome, d.kept_item_id as "keptId", d.reason, d.quote, d.holder_version as "holderVersion",
  d.other_version as "otherVersion", d.decided_by::text as "personId", d.decided_at::text as at`

const brief = (a: Answer) => ({
  state: a.state,
  say: a.say,
  items: a.items.map((item) => ({ id: item.id, title: item.title, kind: item.kind })),
})

const publicDecision = (d: Decided): ConflictDecision => ({
  id: d.id,
  outcome: d.outcome,
  keptId: d.keptId,
  reason: d.reason,
  quote: d.quote,
  personId: d.personId,
  at: d.at,
})

/** A reason or a quote as the rules keep them: plain words, no address, number or secret. */
function plainWords(text: string) {
  rejectSensitive(text)
  rejectMentions(text)
}

export function createConflictsService(
  tx: Queryable,
  clock: Clock,
  cache: BundleCache,
  { library, proposals, review, path, comments }: ConflictsDeps,
) {
  async function me(): Promise<Me> {
    const [row] = await tx.query<Me>(
      `select p.id::text, p.display_name as name, cl_is_admin(p.id, now()) as admin,
              coalesce((select array_agg(a.area_id order by a.area_id) from area_assignments a
                         where a.person_id = p.id and a.role = 'owner' and a.valid_at @> now()), '{}') as owns
         from people p
        where p.id = cl_person() and p.deactivated_at is null and p.erased_at is null`,
    )
    if (!row) throw new ORPCError('UNAUTHORIZED')
    return row
  }

  /** The items the person may read, of those asked: the audience rule (FR-128). */
  async function readable(ids: readonly string[]): Promise<Set<string>> {
    const rows = await tx.query<{ id: string }>(
      `select i.id from v_item_list i where i.id = any($1::text[]) and cl_audience_allows(i.audience_groups)`,
      [ids],
    )
    return new Set(rows.map((r) => r.id))
  }

  /** Each item's own owners, by id; an item with none is answered for by its domain's owners. */
  async function ownersOf(ids: readonly string[]): Promise<Map<string, string[]>> {
    const rows = await tx.query<{ item: string; owners: string[] }>(
      `select o.item_id as item, array_agg(o.person_id::text order by o.person_id) as owners
         from item_owners o join people p on p.id = o.person_id
        where o.item_id = any($1::text[]) and p.deactivated_at is null and p.erased_at is null
        group by o.item_id`,
      [ids],
    )
    return new Map(rows.map((r) => [r.item, r.owners]))
  }

  async function domainOwners(areaIds: readonly string[]): Promise<Map<string, string[]>> {
    const rows = await tx.query<{ area: string; owners: string[] }>(
      `select a.area_id as area, array_agg(a.person_id::text order by a.person_id) as owners
         from area_assignments a join people p on p.id = a.person_id
        where a.area_id = any($1::text[]) and a.role = 'owner' and a.valid_at @> now()
          and p.deactivated_at is null and p.erased_at is null
        group by a.area_id`,
      [areaIds],
    )
    return new Map(rows.map((r) => [r.area, r.owners]))
  }

  async function names(ids: readonly string[]): Promise<Map<string, string>> {
    const rows = await tx.query<{ id: string; name: string }>(
      'select id::text, display_name as name from people where id = any($1::uuid[])',
      [ids],
    )
    return new Map(rows.map((r) => [r.id, r.name]))
  }

  /** Who answers for each item: its own owners, or else its domain's. */
  async function answering(items: readonly ServingItem[]) {
    const own = await ownersOf(items.map((i) => i.id))
    const domains = await domainOwners([...new Set(items.map((i) => i.areaId))])
    return (item: ServingItem): SettledItem => ({
      id: item.id,
      areaId: item.areaId,
      owners: own.get(item.id) ?? domains.get(item.areaId) ?? [],
    })
  }

  /** The live, non-undone decision that kept a pair as both, if both items are still as it saw them. */
  async function keptBoth(pairs: readonly ConflictPair[], bundle: ServingBundle) {
    if (!pairs.length) return new Map<string, Decided>()
    const rows = await tx.query<Decided>(
      `select distinct on (least(d.holder_item_id, d.other_item_id), greatest(d.holder_item_id, d.other_item_id))
              ${decisionColumns}
         from conflict_decisions d
        where d.undone_at is null and d.outcome = 'kept_both'
          and (d.holder_item_id = any($1::text[]) or d.other_item_id = any($1::text[]))
        order by least(d.holder_item_id, d.other_item_id), greatest(d.holder_item_id, d.other_item_id),
                 d.decided_at desc, d.id desc`,
      [pairs.flatMap((p) => [p.holderId, p.otherId])],
    )
    const version = (id: string) => bundle.items.find((i) => i.id === id)?.version ?? 0
    const kept = new Map<string, Decided>()
    for (const pair of pairs) {
      const d = rows.find(
        (r) =>
          (r.holder === pair.holderId && r.other === pair.otherId) ||
          (r.holder === pair.otherId && r.other === pair.holderId),
      )
      if (!d) continue
      const [hv, ov] =
        d.holder === pair.holderId
          ? [d.holderVersion, d.otherVersion]
          : [d.otherVersion, d.holderVersion]
      if (
        stillKept(
          { holderVersion: hv, otherVersion: ov },
          { holderVersion: version(pair.holderId), otherVersion: version(pair.otherId) },
        )
      )
        kept.set(`${pair.holderId}.${pair.otherId}`, d)
    }
    return kept
  }

  /** The holder's own question, as the review asks it: its scope on its first day. */
  function questionOf(bundle: ServingBundle, holder: ServingItem): ResolvedScope | null {
    return matchingProbes(holder, bundle, bundle.terms)[0]?.scope ?? null
  }

  function topicOf(bundle: ServingBundle, holder: ServingItem): string {
    const scope = questionOf(bundle, holder)
    return (scope && topicWords(bundle, scope)) || holder.title
  }

  /** Agent questions that got both items as a Conflict in the last 7 days. */
  async function askedOf(pairs: readonly ConflictPair[]): Promise<Map<string, number>> {
    if (!pairs.length) return new Map()
    const rows = await tx.query<{ holder: string; other: string; n: number }>(
      `select p.holder, p.other,
              (select count(*)::int from deliveries d
                where d.caller = 'agent' and d.answer_state = 'conflict'
                  and d.delivered_hour >= $2::date - 6 and d.delivered_hour < $2::date + 1
                  and d.delivered @> jsonb_build_array(jsonb_build_object('id', p.holder))
                  and d.delivered @> jsonb_build_array(jsonb_build_object('id', p.other))) as n
         from jsonb_to_recordset($1) as p(holder text, other text)`,
      [JSON.stringify(pairs.map((p) => ({ holder: p.holderId, other: p.otherId }))), clock.today()],
    )
    return new Map(rows.map((r) => [`${r.holder}.${r.other}`, r.n]))
  }

  /** The day the later of the two first went live: since when agents get both. */
  async function sinceOf(pair: ConflictPair): Promise<string | null> {
    const [row] = await tx.query<{ since: string | null }>(
      `select max(f.first)::date::text as since from (
         select min(e.created_at) as first from item_version_service s
           join editions e on e.seq = lower(s.editions)
          where s.item_id = any($1::text[]) group by s.item_id) f`,
      [[pair.holderId, pair.otherId]],
    )
    return row?.since ?? null
  }

  async function live() {
    const bundle = await liveServingBundle(tx, cache)
    const served = bundle.items.filter((i) => i.status === 'accepted')
    return { bundle, served, pairs: conflictPairs(served) }
  }

  async function list(input: { whose?: 'mine' | 'all' | undefined }): Promise<ConflictList> {
    const mine = await me()
    const { bundle, served, pairs } = await live()
    const open = await readable(pairs.flatMap((p) => [p.holderId, p.otherId]))
    const shown = pairs.filter((p) => open.has(p.holderId) && open.has(p.otherId))
    const kept = await keptBoth(shown, bundle)
    const onList = shown.filter((p) => !kept.has(`${p.holderId}.${p.otherId}`))
    const asked = await askedOf(onList)
    const byId = new Map(served.map((i) => [i.id, i]))
    const settled = await answering(
      onList.flatMap((p) => [byId.get(p.holderId)!, byId.get(p.otherId)!]),
    )
    const rows: ConflictRow[] = []
    for (const p of onList) {
      const holder = byId.get(p.holderId)!
      const other = byId.get(p.otherId)!
      const rights = settleRights(
        mine,
        settled(holder),
        settled(other),
        other.conflicts.includes(holder.id),
      )
      const isMine = mine.owns.includes(holder.areaId) || mine.owns.includes(other.areaId)
      if (input.whose === 'mine' && !isMine) continue
      rows.push({
        key: `${p.holderId}.${p.otherId}`,
        holder: { id: holder.id, title: holder.title, areaId: holder.areaId },
        other: { id: other.id, title: other.title, areaId: other.areaId },
        topic: topicOf(bundle, holder),
        asked: asked.get(`${p.holderId}.${p.otherId}`) ?? 0,
        since: await sinceOf(p),
        canSettle: Object.values(rights).some(Boolean),
        mine: isMine,
      })
    }
    rows.sort(
      (a, b) => b.asked - a.asked || a.topic.localeCompare(b.topic) || a.key.localeCompare(b.key),
    )
    return { rows }
  }

  /** The pair two ids name, holder first, as it is live now; not found when it is not a pair. */
  async function pairAt(aId: string, bId: string) {
    const { bundle, served } = await live()
    const a = served.find((i) => i.id === aId)
    const b = served.find((i) => i.id === bId)
    const pair = a && b ? pairOf(a, b) : null
    if (!a || !b || !pair) return null
    const holder = pair.holderId === a.id ? a : b
    const other = holder === a ? b : a
    return { bundle, pair, holder, other }
  }

  async function sideOf(
    item: ServingItem,
    open: boolean,
    settled: SettledItem,
  ): Promise<ConflictSide> {
    const row = open ? await library.getIndexRow(item.id) : null
    const area = await tx.query<{ name: string }>('select name from areas where id = $1', [
      item.areaId,
    ])
    const people = await names(settled.owners)
    const source = item.evidence[0]
    return {
      id: item.id,
      readable: open,
      title: open ? item.title : null,
      summary: open ? item.summary : null,
      kind: item.kind,
      area: { id: item.areaId, name: area[0]?.name ?? item.areaId },
      owners: settled.owners.map((id) => ({ id, name: people.get(id) ?? '' })),
      version: open ? item.version : 0,
      checked:
        open && row?.lastChecked
          ? { on: row.lastChecked.on, personId: row.lastChecked.personId }
          : null,
      source: open && source ? { url: source.url, quote: source.quote } : null,
      from: open ? item.validity.start || null : null,
    }
  }

  async function read(input: { holderId: string; otherId: string }): Promise<ConflictView> {
    const found = await pairAt(input.holderId, input.otherId)
    if (!found) throw new ORPCError('NOT_FOUND', { message: 'These two no longer disagree.' })
    const { bundle, pair, holder, other } = found
    const open = await readable([holder.id, other.id])
    // A pair the person can read neither side of is not theirs to see.
    if (!open.size) throw new ORPCError('NOT_FOUND')
    const mine = await me()
    const settled = await answering([holder, other])
    const rights = settleRights(
      mine,
      settled(holder),
      settled(other),
      other.conflicts.includes(holder.id),
    )
    const scope = open.size === 2 ? questionOf(bundle, holder) : null
    const today = clock.today()
    const ask = scope ? { scope } : null
    const without = (id: string): ServingBundle => ({
      ...bundle,
      items: bundle.items.filter((i) => i.id !== id),
    })
    const unflagged: ServingBundle = {
      ...bundle,
      items: bundle.items.map((i) =>
        i.id === holder.id || i.id === other.id
          ? { ...i, conflicts: i.conflicts.filter((c) => c !== holder.id && c !== other.id) }
          : i,
      ),
    }
    const kept = await keptBoth([pair], bundle)
    const asked = await askedOf([pair])
    return {
      key: `${holder.id}.${other.id}`,
      holder: await sideOf(holder, open.has(holder.id), settled(holder)),
      other: await sideOf(other, open.has(other.id), settled(other)),
      topic: open.size === 2 ? topicOf(bundle, holder) : '',
      where:
        open.size === 2
          ? [...holder.scope.metrics, ...holder.scope.dimensionValues.map((v) => v.value)]
          : [],
      asked: asked.get(`${holder.id}.${other.id}`) ?? 0,
      since: await sinceOf(pair),
      said: ask
        ? {
            now: brief(answer(bundle, ask, { today })),
            onlyHolder: brief(answer(without(other.id), ask, { today })),
            onlyOther: brief(answer(without(holder.id), ask, { today })),
            withoutFlag: brief(answer(unflagged, ask, { today })),
          }
        : null,
      rights:
        open.size === 2
          ? rights
          : {
              keepHolder: false,
              keepOther: false,
              editHolder: false,
              editOther: false,
              keepBoth: false,
              notConflict: false,
            },
      keptBoth:
        open.size === 2 && kept.has(`${holder.id}.${other.id}`)
          ? publicDecision(kept.get(`${holder.id}.${other.id}`)!)
          : null,
    }
  }

  /**
   * Publishes the item without the flag on `withoutId`, as its owner in one step; the decision it
   * made. Its words do not change, so the review asks nothing about the items it overlaps (FR-225).
   */
  async function unflag(item: ServingItem, withoutId: string): Promise<string> {
    const created = await proposals.create({
      itemId: item.id,
      draft: { conflicts: item.conflicts.filter((c) => c !== withoutId) },
    })
    const submitted = await proposals.submit(created.id, created.revision)
    await review.checkSubmitted(submitted.id)
    const current = await proposals.get(submitted.id)
    const published = await path.publish({ id: current.id, revision: current.revision })
    return published.undo.slice('decision:'.length)
  }

  async function retireDecision(itemId: string): Promise<string> {
    const [row] = await tx.query<{ id: string }>(
      `select d.id::text from decisions d join item_versions v on v.id = d.item_version_id
        where v.item_id = $1 and d.decided_by = cl_person() and d.outcome = 'retire'
        order by d.decided_at desc, d.id desc limit 1`,
      [itemId],
    )
    if (!row) throw new Error('The archive was not recorded')
    return row.id
  }

  /**
   * Tells the other owners, in a comment that mentions them (FR-817): on each item for its own
   * owners, or, when one was archived, all of them on the item that stays.
   */
  async function tell(on: ServingItem, owners: readonly string[], mine: Me, words: string) {
    const others = [...new Set(owners)].filter((o) => o !== mine.id)
    if (!others.length) return
    const people = await names(others)
    const body: CommentNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            ...others.flatMap((id): CommentNode[] => [
              { type: 'mention', attrs: { id: `person:${id}`, label: people.get(id) ?? '' } },
              { type: 'text', text: ' ' },
            ]),
            { type: 'text', text: words },
          ],
        },
      ],
    }
    await comments.create({ subject: `context:${on.id}`, body })
  }

  async function settle(input: SettleConflictInput): Promise<SettledConflict> {
    const reason = input.reason.trim()
    const quote = input.quote?.trim() || null
    plainWords(reason)
    if (quote) rejectSensitive(quote)
    const found = await pairAt(input.holderId, input.otherId)
    if (!found)
      throw new ORPCError('CONFLICT', {
        message:
          'Someone settled this already, or one of the two changed. There is nothing left to decide here.',
      })
    const { holder, other } = found
    const open = await readable([holder.id, other.id])
    if (open.size !== 2) throw new ORPCError('NOT_FOUND')
    // The versions the person saw: a newer one of either holds the decision, as Publish does.
    const saw =
      input.holderId === holder.id
        ? input.versions
        : { holder: input.versions.other, other: input.versions.holder }
    if (saw.holder !== holder.version || saw.other !== other.version)
      throw new ORPCError('CONFLICT', {
        message: 'One of the two changed while you read. Look at what changed, then decide again.',
      })
    const mine = await me()
    const settled = await answering([holder, other])
    const otherHolds = other.conflicts.includes(holder.id)
    const rights = settleRights(mine, settled(holder), settled(other), otherHolds)
    const keep =
      input.outcome === 'kept_one'
        ? input.keepId === holder.id
          ? 'holder'
          : input.keepId === other.id
            ? 'other'
            : null
        : null
    if (input.outcome === 'kept_one' && !keep)
      throw new ORPCError('UNPROCESSABLE_CONTENT', { message: 'Say which of the two stays.' })
    if (!maySettle(rights, input.outcome, keep))
      throw new ORPCError('FORBIDDEN', { message: refusal(input.outcome) })

    const made: string[] = []
    if (input.outcome === 'kept_one') {
      const [stays, goes] = keep === 'holder' ? [holder, other] : [other, holder]
      await review.retire(goes.id, reason)
      made.push(await retireDecision(goes.id))
      // The item that stays drops its flag on the archived one, so its next change is not refused.
      if (stays.conflicts.includes(goes.id) && (mine.admin || mayChangeItem(mine, settled(stays))))
        made.push(await unflag(stays, goes.id))
    }
    if (input.outcome === 'not_conflict') {
      made.push(await unflag(holder, other.id))
      if (otherHolds) made.push(await unflag(other, holder.id))
    }
    const [row] = await tx.query<Decided>(
      `insert into conflict_decisions as d
         (holder_item_id, other_item_id, outcome, kept_item_id, reason, quote, holder_version, other_version, decisions)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid[])
       returning ${decisionColumns}`,
      [
        holder.id,
        other.id,
        input.outcome,
        keep === 'holder' ? holder.id : keep === 'other' ? other.id : null,
        reason,
        quote,
        holder.version,
        other.version,
        made,
      ],
    )
    await tx.query(
      `insert into audit_log(actor_id,actor_kind,action,area_id,subject_type,subject_id,details)
       values(cl_person(),'person','conflict.settled',$1,'item',$2,$3)`,
      [
        holder.areaId,
        holder.id,
        JSON.stringify({ id: row!.id, other: other.id, outcome: input.outcome }),
      ],
    )
    // A comment on one item is read by everyone who may read that item, not the other one: it
    // names the other item and gives the reason only when neither item limits who reads it
    // (FR-128). Otherwise it says what happened, and the reason stays in History, which only
    // someone who may read both items sees.
    const [audience] = await tx.query<{ open: boolean }>(
      `select bool_and(i.audience_groups is null) and count(*) = 2 as open
         from v_item_list i where i.id = any($1::text[])`,
      [[holder.id, other.id]],
    )
    const titled = !!audience?.open
    const said = {
      kept_one: `I kept “${keep === 'holder' ? holder.title : other.title}” and archived “${keep === 'holder' ? other.title : holder.title}”.`,
      kept_both: `I kept both “${holder.title}” and “${other.title}”. Agents keep saying they disagree until one of them changes.`,
      not_conflict: `“${holder.title}” and “${other.title}” are not a conflict any more: agents now get both with no flag.`,
    }[input.outcome]
    const plain = {
      kept_one: 'I settled a conflict this item was in: one item stays and the other is archived.',
      kept_both:
        'I kept both items of a conflict this item is in. Agents keep saying they disagree.',
      not_conflict:
        'This item and another are not a conflict any more: agents get both with no flag.',
    }[input.outcome]
    const told = titled
      ? `${said} Reason: ${reason}${quote ? ` “${quote}”` : ''}`
      : `${plain} The reason is in the item's history.`
    if (keep) {
      const stays = keep === 'holder' ? holder : other
      await tell(stays, [...settled(holder).owners, ...settled(other).owners], mine, told)
    } else {
      await tell(holder, settled(holder).owners, mine, told)
      await tell(other, settled(other).owners, mine, told)
    }
    return { decision: publicDecision(row!), undo: `conflict:${row!.id}` }
  }

  /** Takes back a decision, by the person who made it, within the undo window. */
  async function undo(input: { id: string }): Promise<{ edition: string | null }> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id))
      throw new ORPCError('NOT_FOUND')
    const [row] = await tx.query<{
      decisions: string[]
      mine: boolean
      undone: boolean
      fresh: boolean
    }>(
      `select d.decisions::text[] as decisions, d.decided_by = cl_person() as mine,
              d.undone_at is not null as undone,
              d.decided_at > now() - make_interval(secs => coalesce(
                (select (value #>> '{}')::int from settings_current where key = 'limits.undo_seconds'), 0)) as fresh
         from conflict_decisions d where d.id = $1::uuid`,
      [input.id],
    )
    if (!row) throw new ORPCError('NOT_FOUND')
    if (!row.mine)
      throw new ORPCError('FORBIDDEN', { message: 'Only the person who decided can undo it.' })
    if (row.undone) throw new ORPCError('CONFLICT', { message: 'This decision is already undone.' })
    if (!row.fresh)
      throw new ORPCError('CONFLICT', {
        message: 'It is too late to undo this decision. Decide again instead.',
      })
    await tx.query('update conflict_decisions set undone_at = now() where id = $1::uuid', [
      input.id,
    ])
    return row.decisions.length ? path.undoDecisions(row.decisions) : { edition: null }
  }

  /** A pair's decisions, newest first, for an item's history. */
  async function decisionsOn(itemId: string): Promise<Decided[]> {
    return tx.query<Decided>(
      `select ${decisionColumns} from conflict_decisions d
        where d.undone_at is null and (d.holder_item_id = $1 or d.other_item_id = $1)
        order by d.decided_at desc, d.id desc`,
      [itemId],
    )
  }

  return { list, read, settle, undo, decisionsOn }
}

const mayChangeItem = (person: Settler, item: SettledItem) =>
  person.owns.includes(item.areaId) || item.owners.includes(person.id)

/** Why a person may not settle a pair this way, in a sentence. */
function refusal(outcome: SettleOutcome): string {
  if (outcome === 'kept_one')
    return 'Only an owner of the item it archives, or an admin, can keep the other one.'
  if (outcome === 'not_conflict')
    return 'Only an owner of the item that holds the Conflict flag, or an admin, can remove it.'
  return 'Only an owner of one of the two items, or an admin, can keep both.'
}

export type ConflictsService = ReturnType<typeof createConflictsService>
