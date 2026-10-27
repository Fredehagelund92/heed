import { ORPCError } from '@orpc/client'
import type * as z from 'zod/mini'
import type {
  answerBriefSchema,
  publishInputSchema,
  publishReadResultSchema,
  ReviewSheet,
} from '../../../contract/review-path.ts'
import { answer, topicWords, type Answer, type AnswerBundle } from '../../../domain/answer.ts'
import { CLAIMS_SHOWN, claimCheck } from '../../../domain/claim-check.ts'
import {
  docDiff,
  docMarkdown,
  plainText,
  sourceDiff,
  type DocSide,
} from '../../../domain/doc-diff.ts'
import type { ItemVersion } from '../../../domain/item-version.ts'
import {
  readiness,
  readinessWords,
  readTimeMs,
  type ClashRelation,
} from '../../../domain/readiness.ts'
import { matchingProbes } from '../../../domain/review.ts'
import type { ResolvedScope } from '../../../domain/scope.ts'
import type { ProposalRecord } from '../../../contract/proposals.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { reachOfDraft, type BundleCache } from '../answer/index.ts'
import { loadServingBundle, publishEdition, type ServingBundle } from '../editions/index.ts'
import { forReader } from '../library/index.ts'
import {
  acceptedOverlaps,
  candidateBundle,
  insertVersion,
  readVersion,
  type StoredVersion,
} from '../proposals/index.ts'
import {
  isAdmin,
  liveVersionId,
  loadProposal,
  proposalEvent,
  publicRecord,
  rolesIn,
  type LoadedProposal,
} from './records.ts'
import type { CommentsService } from '../comments/index.ts'
import type { ReviewService } from './service.ts'

/*
  The review of Heed v1 (FR-224 to FR-227): the sheet a review page reads, and its decisions.
  The difference, the claim check and the Ready line are the domain's (doc-diff.ts,
  claim-check.ts, readiness.ts); what agents say before and after is the answer engine's, on the
  live edition and with the suggestion in it. Deciding goes through the review service's own
  decide, so every rule of a decision holds (FR-202 to FR-206); Undo writes a new edition.
*/

type AnswerBrief = z.infer<typeof answerBriefSchema>
type Head = { seq: string; label: string; overlay: string }

const brief = (a: Answer): AnswerBrief => ({
  state: a.state,
  say: a.say,
  items: a.items.map((item) => ({ id: item.id, title: item.title, kind: item.kind })),
})

/** The default reason of a publish, as the history keeps it. */
const publishedReason = 'Published from the review.'
const returnedReason = 'Returned with a note.'

/** How long after a decision its maker may undo it (`limits.undo_seconds`, FR-227). */
async function undoSeconds(tx: Queryable): Promise<number> {
  const [row] = await tx.query<{ seconds: number }>(
    `select (value #>> '{}')::int as seconds from settings_current where key='limits.undo_seconds'`,
  )
  return row?.seconds ?? 15
}

export function createReviewPath(
  tx: Queryable,
  clock: Clock,
  cache: BundleCache,
  review: ReviewService,
  /** The proposal as its write API reads it, for the reach of its draft. */
  proposalRecord: (id: string) => Promise<ProposalRecord>,
  /** Where a return's note becomes the suggestion's first comment, and goes again on its undo. */
  comments: Pick<CommentsService, 'returned' | 'unreturn'>,
) {
  let person: string | undefined
  async function me() {
    person ??= (await tx.query<{ id: string }>('select cl_person()::text as id'))[0]!.id
    return person
  }
  async function liveHead(): Promise<Head | null> {
    const [head] = await tx.query<Head>(
      `select e.seq::text,e.label,coalesce((select seq::text from serving_overlay),'0') as overlay
         from editions e join live_edition l on l.seq=e.seq`,
    )
    return head ?? null
  }
  async function liveBundle(): Promise<ServingBundle> {
    const head = await liveHead()
    if (!head) return loadServingBundle(tx, { seq: '0', label: '', overlay: '0' })
    return cache.bundle(tx, head)
  }
  async function stored(id: string): Promise<StoredVersion> {
    const version = await readVersion(tx, id)
    if (!version) throw new ORPCError('NOT_FOUND')
    return version
  }
  async function baseOf(versionId: string): Promise<string | null> {
    const [row] = await tx.query<{ id: string | null }>('select cl_proposal_base($1)::text as id', [
      versionId,
    ])
    return row?.id ?? null
  }

  /** The version of an item agents got last, live or not. */
  async function lastServedId(itemId: string): Promise<string | null> {
    const [row] = await tx.query<{ id: string }>(
      `select version_id::text as id from item_version_service where item_id=$1
        order by lower(editions) desc limit 1`,
      [itemId],
    )
    return row?.id ?? null
  }

  /** A version as the difference reads it, its scope in the names agents know. */
  function sideOf(v: ItemVersion, bundle: Pick<ServingBundle, 'terms'>): DocSide {
    const name = (key: string) => bundle.terms.find((t) => t.key === key)?.name ?? key
    return {
      kind: v.kind,
      title: v.title,
      summary: v.summaryMarkup ?? v.summary,
      body: v.bodyMarkup ?? v.body ?? null,
      where: [
        ...v.scope.metrics.map(name),
        ...v.scope.dimensionValues.map((d) => name(d.value)),
        ...v.scope.dimensions.map(name),
      ],
      validFrom: v.validity.start,
      validUntil: v.validity.end,
      reviewDate: v.reviewDate,
      sources: v.evidence.map((e) => ({ url: e.url, quote: e.quote ?? null })),
      notToConclude: v.notToConclude,
    }
  }

  /** The suggestion's own question: its scope on its first day, as level 2 asks it. */
  function ownScope(bundle: ServingBundle, itemId: string): ResolvedScope | null {
    const own = bundle.items.find((i) => i.id === itemId)
    if (!own) return null
    return matchingProbes(own, bundle, bundle.terms)[0]?.scope ?? null
  }

  /** What one suggestion is, read once: its versions, the bundles with and without it, its clashes. */
  async function reading(p: LoadedProposal) {
    if (p.subject !== 'item') throw new ORPCError('NOT_FOUND')
    const bundle = await liveBundle()
    const gapId = await gapOf(p)
    if (p.action === 'retire') {
      // Once archived, the item is no longer live: the review shows the version it archived.
      const live = p.itemId
        ? ((await liveVersionId(tx, p.itemId)) ?? (await lastServedId(p.itemId)))
        : null
      const version = live ? await stored(live) : null
      if (!version) throw new ORPCError('NOT_FOUND')
      const without: ServingBundle = {
        ...bundle,
        items: bundle.items.filter((i) => i.id !== version.itemId),
      }
      return {
        p,
        mode: 'retire' as const,
        before: version,
        after: null,
        bundle,
        candidate: without,
        itemId: version.itemId,
        scope: ownScope(bundle, version.itemId),
        clashes: [] as string[],
        gapId,
      }
    }
    if (!p.itemVersionId) throw new ORPCError('NOT_FOUND')
    const after = await stored(p.itemVersionId)
    const baseId = await baseOf(after.id)
    const before = baseId ? await stored(baseId) : null
    const candidate = candidateBundle(bundle, {
      id: after.itemId,
      versionNo: after.versionNo,
      proposerId: after.version.proposerId,
      version: after.version,
    })
    const scope = ownScope(candidate, after.itemId)
    // A clash: a live item agents would get in the same answer, that the suggestion neither
    // changes nor already names as replaced or conflicting (FR-225, decided 26 October 2026). An
    // edit whose difference is only formatting, only order or only dates is no clash and has no
    // clash check; an edit that changes anything else besides still has one.
    const named = new Set([after.itemId, ...after.version.replaces, ...after.version.conflicts])
    const only = before
      ? docDiff(sideOf(before.version, candidate), sideOf(after.version, candidate)).only
      : null
    const clashes =
      scope && only !== 'formatting' && only !== 'order' && only !== 'dates'
        ? answer(candidate as AnswerBundle, { scope }, { today: clock.today() })
            .items.map((item) => item.id)
            .filter((id) => !named.has(id))
        : []
    return {
      p,
      mode: before ? ('edit' as const) : ('new' as const),
      before,
      after,
      bundle,
      candidate,
      itemId: after.itemId,
      scope,
      clashes,
      gapId,
    }
  }
  type Reading = Awaited<ReturnType<typeof reading>>

  /**
   * The reading as the person may see it: a mention of an item the audience rule hides from them
   * reads as its words only (FR-128), in the difference and in the stored text.
   */
  async function shown(r: Reading): Promise<Reading> {
    const versions = [r.before, r.after].filter((v) => v !== null)
    const masked = await forReader(
      tx,
      versions.map((v) => v.version),
    )
    const swap = (v: StoredVersion | null) => v && { ...v, version: masked[versions.indexOf(v)]! }
    return { ...r, before: swap(r.before), after: swap(r.after) } as Reading
  }

  /** The owner's newest answer for each clash of the version under review. */
  async function relationsOf(r: Reading): Promise<Map<string, ClashRelation>> {
    if (!r.after || !r.clashes.length) return new Map()
    const rows = await tx.query<{ item: string; relation: ClashRelation }>(
      `select distinct on (item_id) item_id as item,relation::text as relation from proposal_relations
        where item_version_id=$1 and item_id=any($2::text[]) order by item_id,decided_at desc,id desc`,
      [r.after.id, r.clashes],
    )
    return new Map(rows.map((row) => [row.item, row.relation]))
  }

  /** Whether an agent or the assistant wrote it for the person, from its provenance. */
  const writtenBy = (p: LoadedProposal) => p.provenance?.by ?? null

  /** The claims of what an agent or the assistant wrote, against the sentence it copied. */
  function claimsOf(r: Reading) {
    if (!r.after || !writtenBy(r.p)) return null
    const sentence = r.after.version.evidence[0]?.quote?.trim()
    if (!sentence) return null
    const text = plainText(
      docMarkdown({ summary: r.after.version.summary, body: r.after.version.body ?? null }),
    )
    return { sentence, rows: claimCheck(text, sentence) }
  }

  function readinessOf(r: Reading, relations: Map<string, ClashRelation>) {
    const names = r.candidate
    const diff = docDiff(
      r.before ? sideOf(r.before.version, names) : null,
      r.after ? sideOf(r.after.version, names) : null,
    )
    const claims = claimsOf(r)
    const unanswered = r.clashes.find((id) => !relations.has(id))
    const clashItem = unanswered ?? r.clashes[0]
    const ready = readiness({
      diff,
      // Drafted for a Not found card by an agent or the assistant: nobody has checked its words.
      drafted: r.gapId !== null && writtenBy(r.p) !== null,
      claims: claims?.rows ?? null,
      clash: clashItem
        ? { itemId: clashItem, relation: unanswered ? null : (relations.get(clashItem) ?? null) }
        : null,
      withdrawn: false,
      synced: false,
    })
    return { diff, claims, ready }
  }

  async function gapOf(p: LoadedProposal): Promise<string | null> {
    const [row] = await tx.query<{ gap: string | null }>(
      'select source_gap_id::text as gap from proposals where id=$1',
      [p.id],
    )
    return row?.gap ?? null
  }

  /** Whether the person may publish it now, and why not. */
  async function publishRight(p: LoadedProposal): Promise<string | null> {
    if (!['submitted', 'in_review'].includes(p.state)) return 'It no longer waits for a decision.'
    const roles = await rolesIn(tx, p.areaId)
    if (!roles.has('owner') && !(await isAdmin(tx)))
      return 'Only an owner of its domain, or an admin, publishes it.'
    if (p.claimedBy && p.claimedBy !== (await me())) return 'Another owner is reviewing it.'
    return null
  }

  async function readState(p: LoadedProposal) {
    const [row] = await tx.query<{ opened: boolean; read: boolean }>(
      `select true as opened, (r.read_at is not null and r.item_version_id is not distinct from $2::uuid) as read
         from review_reads r where r.proposal_id=$1 and r.person_id=cl_person()`,
      [p.id, p.itemVersionId],
    )
    return row ?? { opened: false, read: false }
  }

  async function sheet(id: string): Promise<ReviewSheet> {
    const p = await loadProposal(tx, id)
    const r = await shown(await reading(p))
    const relations = await relationsOf(r)
    const { diff, claims, ready } = readinessOf(r, relations)
    const words = readinessWords(ready, { diff })
    const beforeMarkdown = r.before
      ? docMarkdown({
          summary: r.before.version.summaryMarkup ?? r.before.version.summary,
          body: r.before.version.bodyMarkup ?? r.before.version.body ?? null,
        })
      : ''
    const afterMarkdown = r.after
      ? docMarkdown({
          summary: r.after.version.summaryMarkup ?? r.after.version.summary,
          body: r.after.version.bodyMarkup ?? r.after.version.body ?? null,
        })
      : ''
    const today = clock.today()
    const ask = r.scope ? { scope: r.scope } : null
    const empty = { state: 'missing' as const, say: '', items: [] }
    const before = ask ? brief(answer(r.bundle, ask, { today })) : empty
    const after = ask ? brief(answer(r.candidate, ask, { today })) : empty
    const [name] = await tx.query<{ name: string | null }>(
      'select display_name as name from people where id=$1',
      [p.proposerId],
    )
    const live = new Map(r.candidate.items.map((i) => [i.id, i]))
    const whyNot = await publishRight(p)
    let reach: ReviewSheet['reach'] = null
    if (p.action === 'create' || p.action === 'change')
      reach = await reachOfDraft(tx, clock, cache, await proposalRecord(p.id)).catch(() => null)
    return {
      proposal: publicRecord(p),
      mode: r.mode,
      from: { personId: p.proposerId, name: name?.name ?? null },
      writtenBy: writtenBy(p),
      gapId: r.gapId,
      note: p.reason,
      diff,
      source: {
        before: beforeMarkdown,
        after: afterMarkdown,
        rows: sourceDiff(beforeMarkdown, afterMarkdown),
      },
      claims: claims
        ? { sentence: claims.sentence, rows: claims.rows.slice(0, CLAIMS_SHOWN) }
        : null,
      clashes: r.clashes.map((itemId) => ({
        itemId,
        title: live.get(itemId)?.title ?? itemId,
        summary: live.get(itemId)?.summary ?? '',
        relation: relations.get(itemId) ?? null,
      })),
      overlaps: r.after ? await acceptedOverlaps(tx, p.draft, r.itemId) : [],
      readiness: { ...ready, ...words },
      readMs: readTimeMs(afterMarkdown),
      read: await readState(p),
      tryIt: {
        question: r.scope ? topicWords(r.candidate, r.scope) : '',
        before,
        after,
      },
      reach,
      canPublish: whyNot === null && ready.publishable,
      whyNot: whyNot ?? (ready.publishable ? null : words.text),
    }
  }

  /**
   * The owner's answer to a clash (FR-225), on the version under review: "replaces" and
   * "disagrees" go into a new version's replaced items or conflicts, the content unchanged, so
   * agents get what the owner said; every answer is kept in proposal_relations.
   */
  async function relate(
    p: LoadedProposal,
    after: StoredVersion,
    relations: readonly { itemId: string; relation: ClashRelation }[],
  ): Promise<{ p: LoadedProposal; versionId: string }> {
    const replaces = relations.filter((r) => r.relation === 'replaces').map((r) => r.itemId)
    const conflicts = relations.filter((r) => r.relation === 'disagrees').map((r) => r.itemId)
    const add = (list: readonly string[], more: readonly string[]) =>
      [...new Set([...list, ...more])].sort()
    const version: ItemVersion = {
      ...after.version,
      replaces: add(after.version.replaces, replaces),
      conflicts: add(after.version.conflicts, conflicts),
    }
    let versionId = after.id
    let current = p
    if (
      version.replaces.length !== after.version.replaces.length ||
      version.conflicts.length !== after.version.conflicts.length
    ) {
      const inserted = await insertVersion(tx, after.itemId, version, after.id, {
        editedBy: await me(),
      })
      versionId = inserted.id
      await tx.query('update proposals set item_version_id=$2 where id=$1', [p.id, inserted.id])
      current = await loadProposal(tx, p.id, true)
      await proposalEvent(
        tx,
        current,
        'edited',
        {
          versionId: inserted.id,
          replaces: after.id,
          changes: {
            ...(replaces.length
              ? { replaces: { before: after.version.replaces, after: version.replaces } }
              : {}),
            ...(conflicts.length
              ? { conflicts: { before: after.version.conflicts, after: version.conflicts } }
              : {}),
          },
        },
        'proposal.edited',
      )
    }
    for (const r of relations)
      await tx.query(
        `insert into proposal_relations (proposal_id,item_version_id,item_id,relation,decided_by)
         values ($1,$2,$3,$4::proposal_relation,cl_person())`,
        [p.id, versionId, r.itemId, r.relation],
      )
    return { p: current, versionId }
  }

  /** The newest decision of the person on the proposal, of these outcomes: what an undo takes back. */
  async function lastDecision(proposalId: string, outcomes: readonly string[]) {
    const [row] = await tx.query<{ id: string }>(
      `select id::text from decisions where proposal_id=$1 and decided_by=cl_person()
          and outcome::text=any($2::text[]) order by decided_at desc,id desc limit 1`,
      [proposalId, outcomes],
    )
    if (!row) throw new Error('The decision was not recorded')
    return row.id
  }

  /**
   * `clashesOnly` is for a publish from the editor, which lists what overlaps by its own rule: an
   * answer for an item this does not clash with is left out instead of refused.
   */
  async function publish(
    input: z.infer<typeof publishInputSchema>,
    { clashesOnly = false }: { clashesOnly?: boolean } = {},
  ) {
    let p = await loadProposal(tx, input.id, true)
    if (p.revision !== input.revision)
      throw new ORPCError('CONFLICT', {
        message:
          'Someone changed this suggestion after you opened it. Look at the latest version, then try again.',
      })
    const why = await publishRight(p)
    if (why)
      throw new ORPCError(why.startsWith('Only') ? 'FORBIDDEN' : 'CONFLICT', { message: why })
    const r = await reading(p)
    const given = new Map(
      (input.relations ?? [])
        .filter((x) => !clashesOnly || r.clashes.includes(x.itemId))
        .map((x) => [x.itemId, x.relation]),
    )
    for (const itemId of given.keys())
      if (!r.clashes.includes(itemId))
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: 'Answer only for the live facts this suggestion clashes with.',
        })
    const known = await relationsOf(r)
    const open = r.clashes.filter((id) => !given.has(id) && !known.has(id))
    if (open.length) {
      const title = r.candidate.items.find((i) => i.id === open[0])?.title ?? open[0]!
      throw new ORPCError('UNPROCESSABLE_CONTENT', {
        message: `Say how this relates to “${title}” first: it replaces it, they disagree, or they are unrelated.`,
      })
    }
    if (r.after && given.size)
      p = (
        await relate(
          p,
          r.after,
          [...given].map(([itemId, relation]) => ({ itemId, relation })),
        )
      ).p
    const decided = await review.decide({
      id: p.id,
      revision: p.revision,
      outcome: 'accept',
      reason: input.reason ?? publishedReason,
    })
    const decision = await lastDecision(p.id, p.action === 'retire' ? ['retire'] : ['accept'])
    return { proposal: decided.proposal, edition: decided.edition, undo: `decision:${decision}` }
  }

  async function returnWithNote(input: {
    id: string
    revision: number
    note: string
    body?: Record<string, unknown> | undefined
  }) {
    const p = await loadProposal(tx, input.id)
    if (p.action === 'retire')
      throw new ORPCError('CONFLICT', {
        message: 'A suggestion to archive is archived or closed, not returned.',
      })
    const note = input.note.trim()
    const decided = await review.decide({
      id: input.id,
      revision: input.revision,
      outcome: 'request_changes',
      reason: [...note].length <= 500 ? note : returnedReason,
      comment: note,
    })
    const decision = await lastDecision(p.id, ['request_changes'])
    await comments.returned(p.id, decision, note, input.body)
    return { proposal: decided.proposal, undo: `decision:${decision}` }
  }

  async function markRead(input: { id: string; itemVersionId: string }) {
    const p = await loadProposal(tx, input.id)
    if (p.itemVersionId !== input.itemVersionId)
      throw new ORPCError('CONFLICT', {
        message: 'The suggestion changed after you read it. Read the latest version.',
      })
    await tx.query(
      `insert into review_reads (proposal_id,person_id,item_version_id,read_at) values ($1,cl_person(),$2,now())
       on conflict (proposal_id,person_id) do update set item_version_id=excluded.item_version_id,read_at=now()`,
      [p.id, input.itemVersionId],
    )
    return { read: true }
  }

  /** "Publish the N you've read" (FR-226): only plain changes the person read, each as Publish. */
  async function publishRead(ids: readonly string[]) {
    const result: z.infer<typeof publishReadResultSchema> = {
      published: [],
      skipped: [],
      undo: null,
    }
    const decisions: string[] = []
    for (const id of [...new Set(ids)]) {
      const skip = (code: (typeof result.skipped)[number]['code'], message: string) =>
        result.skipped.push({ id, code, message })
      let p: LoadedProposal
      try {
        p = await loadProposal(tx, id, true)
      } catch {
        skip('not_waiting', "You can't see it any more.")
        continue
      }
      const why = await publishRight(p)
      if (why) {
        skip(why.startsWith('Only') ? 'not_allowed' : 'not_waiting', why)
        continue
      }
      const { read } = await readState(p)
      if (!read) {
        skip('not_read', "You haven't read it yet: it goes out once you have.")
        continue
      }
      await tx.query('savepoint publish_read')
      try {
        const r = await reading(p)
        const { ready } = readinessOf(r, await relationsOf(r))
        if (!ready.bulk) {
          await tx.query('release savepoint publish_read')
          skip('needs_care', 'It needs a look of its own first, so it stays out.')
          continue
        }
        const decided = await review.decide({
          id: p.id,
          revision: p.revision,
          outcome: 'accept',
          reason: "Published with the others you'd read.",
        })
        await tx.query('release savepoint publish_read')
        decisions.push(await lastDecision(p.id, ['accept']))
        result.published.push({ id, edition: decided.edition?.label ?? null })
      } catch (error) {
        await tx.query('rollback to savepoint publish_read')
        skip('refused', error instanceof ORPCError ? error.message : "It couldn't be published.")
      }
    }
    if (decisions.length) result.undo = `decisions:${decisions.join(',')}`
    return result
  }

  /**
   * Takes back decisions their maker made within the window (FR-227), in one new edition that
   * serves again what they changed: a publish's earlier version (or no item, for a new one) and
   * the items it replaced; an archive's item. A suggestion whose publish is undone waits again; a
   * returned one too, and its note leaves its comments (the history keeps the decision).
   */
  async function undoDecisions(ids: readonly string[]): Promise<{ edition: string | null }> {
    const seconds = await undoSeconds(tx)
    const rows = await tx.query<{
      id: string
      outcome: string
      versionId: string
      itemId: string
      areaId: string
      proposalId: string | null
      action: string | null
      fresh: boolean
      mine: boolean
      undone: boolean
      servedAt: string | null
    }>(
      `select d.id::text,d.outcome::text,d.item_version_id::text as "versionId",v.item_id as "itemId",
              d.area_id as "areaId",d.proposal_id::text as "proposalId",p.action::text as action,
              d.decided_at > now() - make_interval(secs => $2) as fresh,
              d.decided_by = cl_person() as mine,
              exists(select 1 from decision_undos u where u.decision_id=d.id) as undone,
              (select lower(s.editions)::text from item_version_service s where s.version_id=d.item_version_id
                order by lower(s.editions) desc limit 1) as "servedAt"
         from decisions d join item_versions v on v.id=d.item_version_id
         left join proposals p on p.id=d.proposal_id
        where d.id=any($1::uuid[])`,
      [ids, seconds],
    )
    if (rows.length !== new Set(ids).size) throw new ORPCError('NOT_FOUND')
    for (const d of rows) {
      if (!d.mine)
        throw new ORPCError('FORBIDDEN', { message: 'Only the person who decided can undo it.' })
      if (d.undone) throw new ORPCError('CONFLICT', { message: 'This decision is already undone.' })
      if (!d.fresh)
        throw new ORPCError('CONFLICT', {
          message: 'It is too late to undo this decision. Change it again instead.',
        })
    }
    const serve: string[] = []
    const close: string[] = []
    for (const d of rows) {
      if (d.outcome === 'request_changes') {
        await comments.unreturn(d.id)
        continue
      }
      if (d.outcome === 'retire') {
        // An archive: the archived version comes back, unless something else is live for it now.
        if (await liveVersionId(tx, d.itemId))
          throw new ORPCError('CONFLICT', {
            message: 'This fact changed since it was archived, so the archive stays.',
          })
        serve.push(d.versionId)
        continue
      }
      if (d.outcome !== 'accept')
        throw new ORPCError('CONFLICT', {
          message: 'Only a publish, an archive or a return is undone.',
        })
      if ((await liveVersionId(tx, d.itemId)) !== d.versionId)
        throw new ORPCError('CONFLICT', {
          message: 'This fact changed since then, so the publish stays.',
        })
      const [before] = await tx.query<{ id: string | null }>(
        `select s.version_id::text as id from item_version_service s
          where s.item_id=$1 and upper(s.editions)=$2::bigint order by lower(s.editions) desc limit 1`,
        [d.itemId, d.servedAt],
      )
      if (before?.id) serve.push(before.id)
      else close.push(d.itemId)
      // The items it replaced, as they were just before it.
      const replaced = await tx.query<{ id: string }>(
        `select s.version_id::text as id from item_version_service s
           join item_version_replaces r on r.replaced_item_id=s.item_id and r.version_id=$1
          where upper(s.editions)=$2::bigint and not exists (
            select 1 from item_version_service n where n.item_id=s.item_id and upper_inf(n.editions))`,
        [d.versionId, d.servedAt],
      )
      serve.push(...replaced.map((x) => x.id))
    }
    let edition: { seq: string; label: string } | null = null
    if (serve.length || close.length) {
      const published = await publishEdition(
        tx,
        { reason: 'decision_undone', serve, close, note: 'Undone by the person who decided.' },
        rows[0]!.areaId,
      )
      edition = { seq: String(published.seq), label: published.label }
    }
    for (const d of rows) {
      await tx.query(
        'insert into decision_undos (decision_id,undone_by,edition_seq) values ($1,cl_person(),$2)',
        [d.id, d.outcome === 'request_changes' ? null : (edition?.seq ?? null)],
      )
      if (!d.proposalId) continue
      const p = await loadProposal(tx, d.proposalId, true)
      if (d.outcome === 'request_changes' && p.state === 'changes_requested') {
        await tx.query("update proposals set state='submitted' where id=$1", [p.id])
      } else if (p.state === 'accepted') {
        await tx.query("update proposals set state='submitted',closed_at=null where id=$1", [p.id])
        // A check undone is no suggestion to decide: it goes, and the item is due again.
        if (d.action === 'recheck')
          await tx.query(
            "update proposals set state='withdrawn',closed_at=now(),reason='Undone by the person who checked it.' where id=$1",
            [p.id],
          )
      }
      await proposalEvent(
        tx,
        await loadProposal(tx, p.id),
        'undone',
        { decisionId: d.id, outcome: d.outcome, ...(edition ? { edition: edition.label } : {}) },
        'decision.undone',
      )
    }
    return { edition: edition?.label ?? null }
  }

  /** What needs care before publishing, for an Inbox row: claims to check, and an unanswered clash. */
  async function care(p: LoadedProposal): Promise<{ claims: number; clash: boolean }> {
    const r = await reading(p)
    const relations = await relationsOf(r)
    const { ready } = readinessOf(r, relations)
    return { claims: ready.claimsToCheck, clash: r.clashes.some((id) => !relations.has(id)) }
  }

  return { sheet, publish, returnWithNote, markRead, publishRead, undoDecisions, care }
}

export type ReviewPath = ReturnType<typeof createReviewPath>
