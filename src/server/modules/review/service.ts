import { ORPCError } from '@orpc/client'
import type * as z from 'zod/mini'
import type {
  BulkSkip,
  bulkDecideSchema,
  bulkPlanInputSchema,
  decideSchema,
  decideTermBatchSchema,
  Edition,
  Gate,
  ReviewProposal,
  reviewEditSchema,
} from '../../../contract/review.ts'
import { bulkSkipWords, levelList, termKindOrder } from '../../../domain/bulk-review.ts'
import { canonicalJson } from '../../../domain/canonical.ts'
import { formatDraft, type FormatFinding } from '../../../domain/draft.ts'
import type { ItemVersion } from '../../../domain/item-version.ts'
import {
  addWorkingDays,
  mentionDiff,
  narrowerAudienceWarnings,
  versionDiff,
  sameRefs,
  vocabularyChangeOf,
  vocabularyFindings,
  type FieldChange,
  type MentionAudience,
} from '../../../domain/review.ts'
import { reviewQuestion } from '../../../domain/item.ts'
import { shiftDate } from '../../../domain/validity.ts'
import type { Term } from '../../../domain/vocabulary.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { lockReleases, publishEdition } from '../editions/index.ts'
import { forReader } from '../library/index.ts'
import {
  checkDraft,
  insertVersion,
  openIssueDays,
  readVersion,
  rejectMentions,
  rejectSensitive,
  type StoredVersion,
  rescueOf,
} from '../proposals/index.ts'
import { draftOf, gatePasses, readGate, runChecks } from './checks.ts'
import {
  deciderIn,
  insertDecision,
  insertDecisions,
  isAdmin,
  liveVersionId,
  loadProposal,
  loadProposals,
  proposalEvent,
  proposalEvents,
  publicRecord,
  reviewQueue,
  rolesIn,
  rolesInAreas,
  type LoadedProposal,
  type Role,
} from './records.ts'
import {
  candidateTerms,
  contextFor,
  proposeTerm,
  proposeTerms,
  termOf,
  termVersion,
  vocabularyBase,
  vocabularyContext,
  type VocabularyBase,
} from './vocabulary.ts'

export const sourceToolQuestion =
  'Does this change a definition or the way agents choose data? That belongs in the source tool.'
type Decide = z.infer<typeof decideSchema>
type DecideTermBatch = z.infer<typeof decideTermBatchSchema>
type Edit = z.infer<typeof reviewEditSchema>
type Capacity = Role | 'administrator'
type BulkDecide = z.infer<typeof bulkDecideSchema>
type Data = Record<string, unknown>
/**
 * The accepts of a bulk decision that wait to be published together: new and changed items in
 * one edition, terms in one, retirements in one (FR-223).
 */
type Deferred = {
  items: { p: LoadedProposal; version: StoredVersion; data: Data }[]
  terms: { p: LoadedProposal; data: Data; change: Term; onlyArea: boolean }[]
  retirements: { p: LoadedProposal; data: Data }[]
}

/** What a review edit may change (FR-105, FR-106, FR-123, FR-324); the rest stays the proposer's. */
const editableFields = [
  'riskLevel',
  'reviewDate',
  'claimLevel',
  'claimAuthority',
  'claimQuote',
  'ownerId',
  'areaId',
] as const satisfies readonly (keyof ItemVersion)[]
type Editable = Pick<ItemVersion, (typeof editableFields)[number]>
/** Format findings an edit causes: on an edited field, or on the whole version (field ''). */
const causedByEdit = (finding: FormatFinding) =>
  finding.severity === 'error' &&
  (finding.field === '' || (editableFields as readonly string[]).includes(finding.field))

/** The selected proposals, each once, in the order they were selected. */
function uniqueTargets<T extends { id: string }>(targets: readonly T[]): T[] {
  const seen = new Set<string>()
  return targets.filter((target) => !seen.has(target.id) && Boolean(seen.add(target.id)))
}

/**
 * Marks a decision its proposer made, so its timeline entry and the history log say so plainly: an
 * administrator, or an owner of the area, decides their own proposal (FR-206).
 */
const byProposer = (p: Pick<LoadedProposal, 'proposerId'>, decider: string) =>
  p.proposerId === decider ? { byProposer: true } : {}

function plainReason(reason: string) {
  rejectSensitive(reason)
  rejectMentions(reason)
}

export function createReviewService(tx: Queryable, clock: Clock) {
  async function stored(versionId: string | null): Promise<StoredVersion> {
    const version = versionId ? await readVersion(tx, versionId) : null
    if (!version) throw new ORPCError('NOT_FOUND')
    if (version.audienceGroups !== null)
      throw new ORPCError('CONFLICT', {
        message:
          "This version limits who can see it, which isn't available yet. Ask the data team.",
      })
    return version
  }
  async function liveStored(itemId: string) {
    const id = await liveVersionId(tx, itemId)
    if (!id)
      throw new ORPCError('NOT_FOUND', {
        message: "We couldn't find an accepted version of this fact. Someone may have archived it.",
      })
    return stored(id)
  }
  /** The accepted version a proposed version was written against, through any resubmissions. */
  async function baseVersionId(versionId: string): Promise<string | null> {
    const [row] = await tx.query<{ id: string | null }>('select cl_proposal_base($1)::text as id', [
      versionId,
    ])
    return row?.id ?? null
  }
  /**
   * The person's own accept of a version that still waits: one given while a high-risk version
   * also needed an approver's (before migration 0005). It publishes now, once the checks pass.
   */
  async function waitingAccept(versionId: string): Promise<string | null> {
    const [row] = await tx.query<{ id: string }>(
      `select d.id::text from decisions d
        where d.item_version_id=$1 and d.decided_by=cl_person() and d.outcome='accept'
          and d.capacity<>'approver' and cl_item_version_problem($1) is null
          and not exists(select 1 from item_version_service s where s.version_id=$1)
        order by d.decided_at desc limit 1`,
      [versionId],
    )
    return row?.id ?? null
  }
  /**
   * FR-202: deciding is an owner's of the area or an administrator's, in any area. One accept
   * publishes at every risk level: an approver no longer decides (FR-207 is withdrawn). FR-206:
   * the proposer decides their own proposal only as an administrator or an owner of its area
   * (cl_decides_own).
   */
  async function capacityFor(
    area: string,
    wanted: Capacity | undefined,
    proposerId: string,
  ): Promise<Capacity> {
    const { person: decider, admin, roles } = await deciderIn(tx, area)
    person ??= decider
    if (proposerId === (await me()) && !admin && !roles.has('owner'))
      throw new ORPCError('FORBIDDEN', {
        message: 'You wrote this proposal, so an owner of its domain or an admin decides it.',
      })
    const choice = wanted ?? (roles.has('owner') ? 'owner' : 'administrator')
    if (choice === 'approver' || (choice === 'administrator' ? !admin : !roles.has(choice)))
      throw new ORPCError('FORBIDDEN', {
        message: 'Only the owners of this domain, or an admin, can decide.',
      })
    return choice
  }
  async function mentionAudiences(targets: string[]): Promise<MentionAudience[]> {
    return tx.query<MentionAudience>(
      `select t.target,coalesce(
         (select v.audience_groups from item_version_service s join item_versions v on v.id=s.version_id
           where 'item:'||s.item_id=t.target and s.editions @> (select seq from live_edition)),
         (select d.visible_groups from serving_vocabulary((select seq from live_edition)) x
           join definitions d on d.ref=x.definition_refs[1] where x.key=t.target)) as groups
       from unnest($1::text[]) as t(target)`,
      [targets],
    )
  }
  async function decisions(p: LoadedProposal) {
    return tx.query<{
      id: string
      decidedBy: string
      capacity: Capacity
      outcome: 'accept' | 'request_changes' | 'reject' | 'retire'
      reason: string
      decidedAt: string
    }>(
      `select id::text,decided_by::text as "decidedBy",capacity::text as capacity,outcome::text as outcome,
              reason,decided_at::text as "decidedAt"
         from decisions where proposal_id=$1 order by decided_at,id`,
      [p.id],
    )
  }
  async function moved(
    p: LoadedProposal,
    state: string,
    kind: string,
    data: Record<string, unknown>,
    audit: string,
  ) {
    const [updated] = await movedTogether([{ p, data }], state, kind, audit)
    return updated!
  }
  /** Moves many proposals to one state at once, each with its own timeline data, in their order. */
  async function movedTogether(
    changes: readonly { p: LoadedProposal; data: Record<string, unknown> }[],
    state: string,
    kind: string,
    audit: string,
  ) {
    const ids = changes.map(({ p }) => p.id)
    await tx.query(
      `update proposals set state=$2::proposal_state,
        closed_at=case when $2 in ('accepted','rejected') then now() else closed_at end,
        claimed_by=case when $2='changes_requested' then null else claimed_by end,
        claimed_at=case when $2='changes_requested' then null else claimed_at end
       where id=any($1::uuid[])`,
      [ids, state],
    )
    const updated = await loadProposals(tx, ids)
    await proposalEvents(
      tx,
      updated.map((p, index) => ({ p, kind, data: changes[index]!.data, audit })),
    )
    return updated
  }
  function blocked(
    gate: Gate,
    message = 'Every required check must pass before you accept it.',
  ): never {
    throw new ORPCError('UNPROCESSABLE_CONTENT', { message, data: { gate } })
  }
  /** Re-runs levels 1 to 3 on the current live edition; the gate must then pass (FR-514). */
  async function checkedGate(p: Pick<LoadedProposal, 'id' | 'channel'>, version: StoredVersion) {
    await runChecks(tx, clock, { id: p.id, channel: p.channel }, version)
    const gate = await readGate(tx, version.id)
    if (!gatePasses(gate)) blocked(gate)
    return gate
  }

  async function decideItem(p: LoadedProposal, input: Decide, defer: Deferred | null = null) {
    const version = await stored(p.itemVersionId)
    const capacity = await capacityFor(
      version.version.areaId,
      input.capacity,
      version.version.proposerId,
    )
    if (p.claimedBy && p.claimedBy !== (await me()))
      throw new ORPCError('CONFLICT', {
        message: 'Another owner is already reviewing this proposal.',
      })
    const decision = {
      proposalId: p.id,
      itemVersionId: version.id,
      areaId: version.version.areaId,
      capacity,
      reason: input.reason,
    }
    if (input.outcome !== 'accept') {
      const id = await insertDecision(tx, { ...decision, outcome: input.outcome })
      if (!id) throw new ORPCError('CONFLICT', { message: 'You already decided this version.' })
      const state = input.outcome === 'reject' ? 'rejected' : 'changes_requested'
      const data = {
        decisionId: id,
        outcome: input.outcome,
        capacity,
        reason: input.reason,
        ...byProposer(p, await me()),
      }
      return {
        proposal: await moved(p, state, 'decided', data, `decision.${input.outcome}`),
        edition: null,
      }
    }
    // A rescue (FR-814) changes a retired item: it is accepted while the item is still retired and
    // out of the Bin, and accepting it serves the item again. The live version and the rescue are
    // read together, so an ordinary accept pays nothing for the rescue path.
    const [state] = await tx.query<{ live: string | null; rescue: boolean; binned: boolean }>(
      `select (select version_id::text from item_version_service
                where item_id=$1 and editions @> (select seq from live_edition)) as live,
              exists(select 1 from item_bin b join areas a on a.id=b.area_id
                      where b.rescue_proposal=$2) as rescue,
              exists(select 1 from item_bin where item_id=$1 and restored_at is null) as binned`,
      [version.itemId, p.id],
    )
    const live = state?.live ?? null
    if (state?.rescue) {
      if (live)
        throw new ORPCError('CONFLICT', {
          message:
            'Agents get this fact again since it was restored, so this proposal is out of date. Reject it.',
        })
      if (state.binned)
        throw new ORPCError('CONFLICT', {
          message: 'This fact is in the Bin again. You can accept it once an admin restores it.',
        })
    } else if ((await baseVersionId(version.id)) !== live)
      throw new ORPCError('CONFLICT', {
        message: 'The accepted fact changed after this version was written. Ask for changes.',
      })
    await checkedGate(p, version)
    const id =
      (await insertDecision(tx, { ...decision, outcome: 'accept' })) ??
      (await waitingAccept(version.id))
    if (!id) throw new ORPCError('CONFLICT', { message: 'You already accepted this version.' })
    const data = {
      decisionId: id,
      outcome: 'accept',
      capacity,
      reason: input.reason,
      ...byProposer(p, await me()),
    }
    const [waiting] = await tx.query<{ problem: string | null }>(
      'select cl_item_version_problem($1) as problem',
      [version.id],
    )
    if (waiting?.problem) {
      const updated = await loadProposal(tx, p.id)
      await proposalEvent(
        tx,
        updated,
        'approved',
        { ...data, waitingFor: waiting.problem },
        'decision.accept',
      )
      return { proposal: updated, edition: null }
    }
    // A re-check carries its own note, so it stays an edition of its own.
    if (defer && p.action !== 'recheck') {
      defer.items.push({ p, version, data })
      return { proposal: p, edition: null }
    }
    return publishAccepted(p, version, data)
  }

  async function publishAccepted(
    p: LoadedProposal,
    version: StoredVersion,
    data: Record<string, unknown>,
  ) {
    const recheck = p.action === 'recheck'
    const replaced = []
    for (const target of version.version.replaces)
      if (await liveVersionId(tx, target)) replaced.push(target)
    const edition = await publishEdition(
      tx,
      recheck
        ? { reason: 'source_rechecked', serve: [version.id], note: p.reason }
        : { reason: 'proposal_accepted', serve: [version.id], close: replaced },
      version.version.areaId,
    )
    return {
      proposal: await moved(
        p,
        'accepted',
        'decided',
        { ...data, edition: edition.label },
        recheck ? 'item.rechecked' : 'decision.accept',
      ),
      edition,
    }
  }

  async function decideRetirement(p: LoadedProposal, input: Decide, defer: Deferred | null = null) {
    if (input.outcome === 'request_changes')
      throw new ORPCError('CONFLICT', {
        message: 'A proposal to archive a fact can only be accepted or rejected.',
      })
    const capacity = await capacityFor(p.areaId!, input.capacity, p.proposerId)
    if ((await liveVersionId(tx, p.itemId!)) !== p.itemVersionId)
      throw new ORPCError('CONFLICT', {
        message:
          'This fact changed, or agents stopped getting it, after someone proposed to archive it.',
      })
    const outcome = input.outcome === 'accept' ? 'retire' : 'reject'
    const id = await insertDecision(tx, {
      proposalId: p.id,
      itemVersionId: p.itemVersionId,
      areaId: p.areaId,
      capacity,
      outcome,
      reason: input.reason,
    })
    if (!id && outcome === 'reject')
      throw new ORPCError('CONFLICT', { message: 'You already decided this version.' })
    const data = {
      decisionId: id,
      outcome,
      capacity,
      reason: input.reason,
      ...byProposer(p, await me()),
    }
    if (outcome === 'reject')
      return {
        proposal: await moved(p, 'rejected', 'decided', data, 'decision.reject'),
        edition: null,
      }
    if (defer) {
      defer.retirements.push({ p, data })
      return { proposal: p, edition: null }
    }
    const edition = await publishEdition(
      tx,
      { reason: 'item_retired', close: [p.itemId!], note: input.reason },
      p.areaId,
    )
    return {
      proposal: await moved(
        p,
        'accepted',
        'decided',
        { ...data, edition: edition.label },
        'decision.retire',
      ),
      edition,
    }
  }

  /**
   * Who decides vocabulary in one step, read once however many terms the step decides: their
   * roles in each area the terms are in or move from, whether they are an administrator, and who
   * they are.
   */
  async function vocabularyDecider(areaIds: readonly (string | null)[]) {
    const roles = await rolesInAreas(tx, areaIds)
    return {
      rolesIn: (area: string | null) => (area ? roles.get(area) : undefined) ?? new Set<Role>(),
      admin: await isAdmin(tx),
      me: await me(),
    }
  }
  type Decider = Awaited<ReturnType<typeof vocabularyDecider>>
  type VocabularyDraft = Parameters<typeof vocabularyFindings>[0] & { base: string | null }
  // A draft stored before a term could name several definitions holds one, as `definitionRef`.
  const draftOfTerm = (p: LoadedProposal) =>
    vocabularyChangeOf(p.draft as unknown as VocabularyDraft)

  /**
   * Checks a vocabulary decision (FR-125): an owner of the term's area, or an administrator,
   * their own proposal too (FR-206). An accept reads `base`, the vocabulary as the step read it,
   * and `pending`, the terms accepted before it in the same step, as live. The caller records the
   * decision, publishes an accept and moves the proposal.
   */
  function checkVocabularyDecision(
    p: LoadedProposal,
    input: Pick<Decide, 'outcome' | 'reason' | 'capacity'>,
    who: Decider,
    base: VocabularyBase | null,
    pending: readonly Term[] = [],
  ) {
    if (input.outcome === 'request_changes')
      throw new ORPCError('CONFLICT', {
        message:
          'A proposed name can only be accepted or rejected. To change it, propose it again.',
      })
    const roles = who.rolesIn(p.areaId)
    const capacity: Capacity | null =
      input.capacity === 'administrator'
        ? who.admin
          ? 'administrator'
          : null
        : roles.has('owner')
          ? 'owner'
          : who.admin
            ? 'administrator'
            : null
    if (!capacity)
      throw new ORPCError('FORBIDDEN', {
        message: "Only an owner of this name's domain or an admin can decide it.",
      })
    const change = draftOfTerm(p)
    if (input.outcome === 'reject' || !base) return { capacity, change, onlyArea: false }
    const { context, current } = contextFor(base, change.key, pending)
    // Moving a term out of an area, or giving an unmapped term one, needs the owner's authority
    // too: an owner of the current area, or an administrator (decision 4).
    if (current && current.areaId !== change.areaId && capacity !== 'administrator') {
      const owner = who.rolesIn(current.areaId)
      if (!owner.has('owner'))
        throw new ORPCError('FORBIDDEN', {
          message: current.areaId
            ? `Moving this name to another domain also needs an owner of ${base.areas.get(current.areaId)?.name ?? 'its domain'}, or an admin.`
            : 'Only an admin can give this name a domain.',
        })
    }
    if ((current?.versionId ?? null) !== change.base)
      throw new ORPCError('CONFLICT', {
        message: 'This name changed after it was proposed. Propose it again.',
      })
    const findings = vocabularyFindings(change, context, true).filter((f) => f.severity === 'error')
    if (findings.length)
      throw new ORPCError('UNPROCESSABLE_CONTENT', {
        message: 'Fix the problems with this name first.',
        data: { findings },
      })
    const onlyArea =
      current !== null &&
      current.name === change.name &&
      canonicalJson(current.aliases) === canonicalJson(change.aliases) &&
      sameRefs(current.definitionRefs, change.definitionRefs)
    return { capacity, change, onlyArea }
  }

  /** The areas the terms of `open` are in, and those their live terms are in now. */
  const touchedAreas = (open: readonly LoadedProposal[], base: VocabularyBase | null) => [
    ...open.map((p) => p.areaId),
    ...(base ? open.map((p) => contextFor(base, draftOfTerm(p).key).current?.areaId ?? null) : []),
  ]

  async function decideVocabulary(p: LoadedProposal, input: Decide, defer: Deferred | null = null) {
    const base = input.outcome === 'accept' ? await vocabularyBase(tx, [draftOfTerm(p).key]) : null
    const who = await vocabularyDecider(touchedAreas([p], base))
    // In a bulk decision, the terms accepted before this one in the same step read as live.
    const { capacity, onlyArea, change } = checkVocabularyDecision(
      p,
      input,
      who,
      base,
      defer?.terms.map((term) => term.change) ?? [],
    )
    const [id] = await insertDecisions(tx, [
      {
        proposalId: p.id,
        vocabularyVersionId: p.vocabularyVersionId,
        areaId: p.areaId,
        capacity,
        outcome: input.outcome === 'accept' ? 'accept' : 'reject',
        reason: input.reason,
      },
    ])
    if (!id)
      throw new ORPCError('CONFLICT', {
        message:
          input.outcome === 'accept'
            ? 'You already accepted this version.'
            : 'You already decided this version.',
      })
    const data = {
      decisionId: id,
      outcome: input.outcome,
      capacity,
      reason: input.reason,
      ...byProposer(p, who.me),
    }
    if (input.outcome === 'reject')
      return {
        proposal: await moved(p, 'rejected', 'decided', data, 'decision.reject'),
        edition: null,
      }
    if (defer) {
      defer.terms.push({ p, data, change, onlyArea })
      return { proposal: p, edition: null }
    }
    const edition = await publishEdition(
      tx,
      {
        reason: onlyArea ? 'area_map_changed' : 'vocabulary_changed',
        vocabulary: [p.vocabularyVersionId!],
      },
      p.areaId,
    )
    return {
      proposal: await moved(
        p,
        'accepted',
        'decided',
        { ...data, edition: edition.label },
        'decision.accept',
      ),
      edition,
    }
  }

  /**
   * Accepts or rejects every open term of a batch the person may see, all or none: an accept is
   * one edition. Each term still gets its own decision, so the serving guards check each one, and
   * a value whose dimension is in the same batch is accepted after it. The batch is read, checked
   * and recorded together, in a fixed handful of statements for any number of terms.
   */
  async function decideTermBatch(input: DecideTermBatch) {
    await lockReleases(tx)
    plainReason(input.reason)
    const rows = await tx.query<{ id: string }>(
      `select p.id::text from proposals p
        where p.import_batch_id=$1 and p.subject='vocabulary' and p.state in ('submitted','in_review')
        order by p.number`,
      [input.batchId],
    )
    if (!rows.length)
      throw new ORPCError('NOT_FOUND', {
        message: 'None of these names wait for a decision any more.',
      })
    const open = await loadProposals(
      tx,
      rows.map((row) => row.id),
      true,
    )
    const order = (p: LoadedProposal) =>
      ({ metric_group: 0, metric: 1, dimension: 1, dimension_value: 2 })[draftOfTerm(p).kind] ?? 1
    open.sort((a, b) => order(a) - order(b) || a.number - b.number)
    const base =
      input.outcome === 'accept'
        ? await vocabularyBase(
            tx,
            open.map((p) => draftOfTerm(p).key),
          )
        : null
    const who = await vocabularyDecider(touchedAreas(open, base))
    const pending: Term[] = []
    const checked = open.map((p) => {
      const check = checkVocabularyDecision(p, input, who, base, pending)
      if (input.outcome === 'accept') pending.push(check.change)
      return check
    })
    const ids = await insertDecisions(
      tx,
      open.map((p, index) => ({
        proposalId: p.id,
        vocabularyVersionId: p.vocabularyVersionId,
        areaId: p.areaId,
        capacity: checked[index]!.capacity,
        outcome: input.outcome === 'accept' ? 'accept' : 'reject',
        reason: input.reason,
      })),
    )
    if (ids.some((id) => !id))
      throw new ORPCError('CONFLICT', {
        message:
          input.outcome === 'accept'
            ? 'You already accepted this version.'
            : 'You already decided this version.',
      })
    const areas = new Set(open.map((p) => p.areaId))
    const edition =
      input.outcome === 'accept'
        ? await publishEdition(
            tx,
            {
              reason: checked.every((check) => check.onlyArea)
                ? 'area_map_changed'
                : 'vocabulary_changed',
              vocabulary: open.map((p) => p.vocabularyVersionId!),
            },
            areas.size === 1 ? [...areas][0] : null,
          )
        : null
    const proposals = await movedTogether(
      open.map((p, index) => ({
        p,
        data: {
          decisionId: ids[index],
          outcome: input.outcome,
          capacity: checked[index]!.capacity,
          reason: input.reason,
          ...byProposer(p, who.me),
          ...(edition ? { edition: edition.label } : {}),
        },
      })),
      edition ? 'accepted' : 'rejected',
      'decided',
      edition ? 'decision.accept' : 'decision.reject',
    )
    return { proposals: proposals.map(publicRecord), edition }
  }

  const termOrder = (p: LoadedProposal) =>
    p.subject !== 'vocabulary'
      ? 1
      : (termKindOrder[(p.draft as unknown as { kind: string }).kind] ?? 1)

  /**
   * Whether a bulk decision may decide one proposal, and what it would do to it (FR-223): every
   * rule a single decision has, read before anything is written, so the plan and the step agree.
   * A proposal the person proposed is left out unless they are an administrator or an owner of
   * its area (FR-206), and so is an accept with a failed required check.
   */
  async function bulkCheck(
    target: { id: string; revision: number },
    outcome: BulkDecide['outcome'],
    lock: boolean,
  ): Promise<{ p: LoadedProposal; effect: 'publish' | 'decide' } | BulkSkip> {
    let p: LoadedProposal
    try {
      p = await loadProposal(tx, target.id, lock)
    } catch {
      return {
        id: target.id,
        number: null,
        title: null,
        code: 'not_found',
        message: bulkSkipWords.notFound,
      }
    }
    const skip = (code: BulkSkip['code'], message: string): BulkSkip => ({
      id: p.id,
      number: p.number,
      title: p.title,
      code,
      message,
    })
    if (p.revision !== target.revision) return skip('changed', bulkSkipWords.changed)
    if (!['submitted', 'in_review'].includes(p.state))
      return skip('not_waiting', bulkSkipWords.notWaiting)
    const roles = await rolesIn(tx, p.areaId)
    const admin = await isAdmin(tx)
    const decidesAny = admin || roles.has('owner')
    if (p.proposerId === (await me()) && !decidesAny) return skip('own', bulkSkipWords.own)
    const decides = outcome === 'accept' ? 'publish' : 'decide'
    if (p.subject === 'vocabulary') {
      if (outcome === 'request_changes') return skip('not_allowed', bulkSkipWords.termChanges)
      if (!decidesAny) return skip('forbidden', bulkSkipWords.termDecider)
      return { p, effect: decides }
    }
    if (!decidesAny) return skip('forbidden', bulkSkipWords.itemDecider)
    if (p.action === 'retire') {
      if (outcome === 'request_changes') return skip('not_allowed', bulkSkipWords.retirementChanges)
      return { p, effect: decides }
    }
    if (p.claimedBy && p.claimedBy !== (await me())) return skip('claimed', bulkSkipWords.claimed)
    if (outcome !== 'accept') return { p, effect: 'decide' }
    // Levels 1 to 3 run again on accept, and one accept publishes (FR-513).
    const gate = await readGate(tx, p.itemVersionId!)
    const failed = gate.levels.filter((level) => level.outcome === 'failed')
    if (failed.length) return skip('checks_failed', bulkSkipWords.failed(levelList(failed)))
    return { p, effect: 'publish' }
  }

  /** How many editions the accepts of a bulk decision publish. */
  function editionCount(decided: readonly { p: LoadedProposal; effect: string }[]) {
    const published = decided.filter((entry) => entry.effect === 'publish').map((entry) => entry.p)
    const kinds = new Set(
      published
        .filter((p) => p.action !== 'recheck')
        .map((p) =>
          p.subject === 'vocabulary' ? 'terms' : p.action === 'retire' ? 'retire' : 'items',
        ),
    )
    return kinds.size + published.filter((p) => p.action === 'recheck').length
  }

  /** Leaves out an accept of an item that an earlier proposal of the same step already takes. */
  function sameItemSkip(
    p: LoadedProposal,
    outcome: BulkDecide['outcome'],
    taken: Set<string>,
  ): BulkSkip | null {
    if (outcome !== 'accept' || !p.itemId) return null
    if (taken.has(p.itemId))
      return {
        id: p.id,
        number: p.number,
        title: p.title,
        code: 'refused',
        message: bulkSkipWords.sameItem,
      }
    taken.add(p.itemId)
    return null
  }

  /** What a bulk decision would do to each selected proposal, and which it leaves out. */
  async function planDecisions(input: z.infer<typeof bulkPlanInputSchema>) {
    const decided: { p: LoadedProposal; effect: 'publish' | 'decide' }[] = []
    const skipped: BulkSkip[] = []
    const taken = new Set<string>()
    for (const target of uniqueTargets(input.proposals)) {
      const checked = await bulkCheck(target, input.outcome, false)
      const same = 'code' in checked ? null : sameItemSkip(checked.p, input.outcome, taken)
      if ('code' in checked) skipped.push(checked)
      else if (same) skipped.push(same)
      else decided.push(checked)
    }
    return {
      decided: decided.map(({ p, effect }) => ({
        id: p.id,
        number: p.number,
        title: p.title,
        effect,
      })),
      skipped,
      editions: input.outcome === 'accept' ? editionCount(decided) : 0,
    }
  }

  /** Why a decision the plan allowed was refused all the same, in words for the person. */
  function refusedSkip(p: LoadedProposal, error: unknown): BulkSkip {
    const named = { id: p.id, number: p.number, title: p.title }
    if (!(error instanceof ORPCError)) throw error
    const gate = (error.data as { gate?: Gate } | undefined)?.gate
    if (gate) {
      const failed = gate.levels.filter((level) => level.outcome !== 'passed')
      return {
        ...named,
        code: 'checks_failed',
        message: bulkSkipWords.failedAgain(levelList(failed)),
      }
    }
    if (error.code === 'FORBIDDEN') return { ...named, code: 'forbidden', message: error.message }
    return { ...named, code: 'refused', message: error.message }
  }

  /**
   * One decision for several proposals, with one reason (FR-223). Each is checked and decided as
   * on its own, in a savepoint, so one that is refused is left out and named while the rest go
   * through. The accepts are then published together: new and changed items in one edition,
   * terms in one (a value after its dimension), retirements in one; a re-check keeps its own.
   */
  async function decideMany(input: BulkDecide) {
    await lockReleases(tx)
    plainReason(input.reason)
    const skipped: BulkSkip[] = []
    const ready: LoadedProposal[] = []
    const taken = new Set<string>()
    for (const target of uniqueTargets(input.proposals)) {
      const checked = await bulkCheck(target, input.outcome, true)
      const same = 'code' in checked ? null : sameItemSkip(checked.p, input.outcome, taken)
      if ('code' in checked) skipped.push(checked)
      else if (same) skipped.push(same)
      else ready.push(checked.p)
    }
    ready.sort((a, b) => termOrder(a) - termOrder(b))
    const defer: Deferred = { items: [], terms: [], retirements: [] }
    const settled: string[] = []
    const editions: Edition[] = []
    const decide: Decide = { id: '', revision: 0, outcome: input.outcome, reason: input.reason }
    for (const p of ready) {
      await tx.query('savepoint bulk_decision')
      const deferred = {
        items: defer.items.length,
        terms: defer.terms.length,
        retirements: defer.retirements.length,
      }
      try {
        const one = { ...decide, id: p.id, revision: p.revision }
        const result =
          p.subject === 'vocabulary'
            ? await decideVocabulary(p, one, defer)
            : p.action === 'retire'
              ? await decideRetirement(p, one, defer)
              : await decideItem(p, one, defer)
        // Only a re-check publishes as it is decided: its own edition, with its own note.
        if (result.edition) editions.push(result.edition)
        await tx.query('release savepoint bulk_decision')
        settled.push(p.id)
      } catch (error) {
        await tx.query('rollback to savepoint bulk_decision')
        defer.items.length = deferred.items
        defer.terms.length = deferred.terms
        defer.retirements.length = deferred.retirements
        skipped.push(refusedSkip(p, error))
      }
    }
    const oneArea = (ps: readonly LoadedProposal[]) => {
      const areas = new Set(ps.map((p) => p.areaId))
      return areas.size === 1 ? [...areas][0]! : null
    }
    if (defer.items.length) {
      const close: string[] = []
      for (const { version } of defer.items)
        for (const target of version.version.replaces)
          if (!close.includes(target) && (await liveVersionId(tx, target))) close.push(target)
      const edition = await publishEdition(
        tx,
        { reason: 'proposal_accepted', serve: defer.items.map((d) => d.version.id), close },
        oneArea(defer.items.map((d) => d.p)),
      )
      editions.push(edition)
      for (const { p, data } of defer.items)
        await moved(
          p,
          'accepted',
          'decided',
          { ...data, edition: edition.label },
          'decision.accept',
        )
    }
    if (defer.terms.length) {
      const edition = await publishEdition(
        tx,
        {
          reason: defer.terms.every((d) => d.onlyArea) ? 'area_map_changed' : 'vocabulary_changed',
          vocabulary: defer.terms.map((d) => d.p.vocabularyVersionId!),
        },
        oneArea(defer.terms.map((d) => d.p)),
      )
      editions.push(edition)
      for (const { p, data } of defer.terms)
        await moved(
          p,
          'accepted',
          'decided',
          { ...data, edition: edition.label },
          'decision.accept',
        )
    }
    if (defer.retirements.length) {
      const edition = await publishEdition(
        tx,
        {
          reason: 'item_retired',
          close: defer.retirements.map((d) => d.p.itemId!),
          note: input.reason,
        },
        oneArea(defer.retirements.map((d) => d.p)),
      )
      editions.push(edition)
      for (const { p, data } of defer.retirements)
        await moved(
          p,
          'accepted',
          'decided',
          { ...data, edition: edition.label },
          'decision.retire',
        )
    }
    const proposals = []
    for (const id of settled) proposals.push(publicRecord(await loadProposal(tx, id)))
    return { proposals, skipped, editions }
  }

  /**
   * The comment a request for changes carries, in the proposal's discussion beside the decision.
   * The decision already tells the proposer, so it is not announced again, and the history log
   * names it without its text, as it does every comment.
   */
  async function decisionComment(p: LoadedProposal, text: string) {
    const [decision] = await tx.query<{ id: string }>(
      `select id::text from decisions where proposal_id=$1 and outcome='request_changes'
        order by decided_at desc,id desc limit 1`,
      [p.id],
    )
    await tx.query(
      'insert into proposal_events(proposal_id,actor_id,kind,data) values($1,cl_person(),$2,$3)',
      [p.id, 'commented', JSON.stringify({ text, decisionId: decision?.id ?? null })],
    )
    await tx.query(
      `insert into audit_log(actor_id,actor_kind,action,area_id,subject_type,subject_id,details)
       values(cl_person(),'person','proposal.commented',$1,'proposal',$2,$3)`,
      [p.areaId, p.id, JSON.stringify({ revision: p.revision, decisionId: decision?.id ?? null })],
    )
  }

  /** A rescue's note for its reviewers (FR-814): where the item came from, and who restored it. */
  async function rescueView(id: string) {
    const rescue = await rescueOf(tx, id)
    return rescue
      ? {
          deletedDomain: rescue.deletedDomain,
          restoredBy: rescue.restoredBy,
          restoredAt: rescue.restoredAt,
        }
      : null
  }

  async function review(id: string) {
    const p = await loadProposal(tx, id)
    let diff: FieldChange[] = []
    let mentions: ReturnType<typeof mentionDiff> = { added: [], removed: [] }
    let warnings: ReturnType<typeof narrowerAudienceWarnings> = []
    let sinceRequest: { decisionId: string; diff: FieldChange[] } | null = null
    let gate: Gate | null = null
    let vocabulary = null
    let termBatch: { id: string; open: number; total: number } | null = null
    let findings = p.findings
    if (p.subject === 'vocabulary') {
      const change = draftOfTerm(p)
      const { context, current } = await vocabularyContext(tx, change.key)
      const open = ['submitted', 'in_review'].includes(p.state)
      vocabulary = {
        // An open proposal reads against the live term, which accepting it replaces; a decided one
        // against the version it was proposed on, as the live term may be the proposal itself.
        before: open
          ? current
            ? termOf(current)
            : null
          : await termVersion(tx, (p.draft as { base?: string | null }).base ?? null),
        after: {
          key: change.key,
          kind: change.kind,
          parentKey: change.parentKey,
          name: change.name,
          aliases: change.aliases,
          areaId: change.areaId,
          definitionRefs: change.definitionRefs,
        },
      }
      if (['submitted', 'in_review'].includes(p.state))
        findings = vocabularyFindings(change, context, true)
      // The terms proposed in the same step that the person can see (proposeTerms).
      const [batch] = await tx.query<{ id: string; open: number; total: number }>(
        `select p.import_batch_id::text as id,
                count(*) filter (where o.state in ('submitted','in_review'))::int as open,
                count(*)::int as total
           from proposals p join proposals o on o.import_batch_id=p.import_batch_id and o.subject='vocabulary'
          where p.id=$1 and p.import_batch_id is not null group by p.import_batch_id`,
        [p.id],
      )
      termBatch = batch ?? null
    } else if (p.action === 'retire') {
      diff = [{ field: 'status', before: 'accepted', after: 'retired' }]
    } else {
      const proposed = p.itemVersionId
        ? (await stored(p.itemVersionId)).version
        : formatDraft(p.draft, p.proposerId, p.channel).version
      if (proposed) {
        const baseId = p.itemVersionId
          ? await baseVersionId(p.itemVersionId)
          : p.itemId
            ? await liveVersionId(tx, p.itemId)
            : null
        const base = baseId ? (await stored(baseId)).version : null
        // The versions as the reviewer may read them: a mention of an item the audience rule
        // hides from them reads as its words only, in the diff and in the mention lists.
        const shown = await forReader(tx, base ? [proposed, base] : [proposed])
        const after = shown[0]!
        const before = shown[1] ?? null
        diff = versionDiff(before, after)
        mentions = mentionDiff(before?.mentions ?? [], after.mentions)
        warnings = narrowerAudienceWarnings(
          null,
          after.mentions,
          await mentionAudiences(after.mentions.map((m) => m.target)),
        )
        // A resubmission: what changed since the newest request for changes (heed-ux B2).
        if (p.itemVersionId && ['submitted', 'in_review'].includes(p.state)) {
          const [asked] = await tx.query<{ id: string; versionId: string }>(
            `select id::text,item_version_id::text as "versionId" from decisions
              where proposal_id=$1 and outcome='request_changes' order by decided_at desc,id desc limit 1`,
            [p.id],
          )
          if (asked && asked.versionId !== p.itemVersionId) {
            const [requested] = await forReader(tx, [(await stored(asked.versionId)).version])
            sinceRequest = { decisionId: asked.id, diff: versionDiff(requested!, after) }
          }
        }
      }
      if (p.itemVersionId) gate = await readGate(tx, p.itemVersionId)
    }
    return {
      proposal: publicRecord(p),
      diff,
      sinceRequest,
      mentions,
      warnings,
      findings,
      gate,
      decisions: await decisions(p),
      vocabulary,
      termBatch,
      rescue: p.subject === 'item' && p.action === 'change' ? await rescueView(p.id) : null,
      sourceToolQuestion,
      provenance: p.provenance,
    }
  }

  let person: string | undefined
  async function me() {
    person ??= (await tx.query<{ id: string }>('select cl_person()::text as id'))[0]!.id
    return person
  }

  return {
    async queue(input: Parameters<typeof reviewQueue>[1]) {
      return (await reviewQueue(tx, input)).map(({ checks, ...p }) => ({
        ...publicRecord(p),
        checks,
      }))
    },

    get: review,

    async runChecks(id: string): Promise<Gate> {
      const p = await loadProposal(tx, id, true)
      if (p.subject !== 'item' || !p.itemVersionId || p.action === 'retire')
        throw new ORPCError('CONFLICT', {
          message: 'Checks run only on a fact that was sent for review.',
        })
      if (!['submitted', 'in_review'].includes(p.state))
        throw new ORPCError('CONFLICT', {
          message: 'Checks run only while a proposal is in review.',
        })
      const version = await stored(p.itemVersionId)
      const runs = await runChecks(tx, clock, { id: p.id, channel: p.channel }, version)
      await proposalEvent(tx, p, 'checked', {
        levels: Object.fromEntries(runs.map((r) => [r.level, r.outcome])),
      })
      return readGate(tx, version.id)
    },

    /**
     * After submit (which records level 1), levels 2 and 3 run in the same transaction so the
     * review screen has them at once (NFR-054). Before the first edition there is nothing to run.
     */
    async checkSubmitted(id: string) {
      const p = await loadProposal(tx, id)
      if (!p.itemVersionId || !(await tx.query('select 1 from live_edition')).length) return
      const runs = await runChecks(
        tx,
        clock,
        { id: p.id, channel: p.channel },
        await stored(p.itemVersionId),
        ['matching', 'delivery'],
      )
      await proposalEvent(tx, p, 'checked', {
        levels: Object.fromEntries(runs.map((r) => [r.level, r.outcome])),
      })
    },

    /**
     * FR-105, FR-106, FR-123, FR-324: an owner changes the risk level, the review date,
     * the claim level, the owner or the area of a proposal under review. The change is a new
     * version that supersedes the submitted one and keeps its content and proposer, so earlier
     * accepts and check results stay with the version they were made on. Every check runs again
     * on the new version; every risk level needs the same three (FR-513).
     */
    async edit(input: Edit) {
      await lockReleases(tx)
      const p = await loadProposal(tx, input.id, true)
      if (p.revision !== input.revision)
        throw new ORPCError('CONFLICT', {
          message:
            'Someone changed this proposal after you opened it. Look at the latest version, then try again.',
        })
      if (p.subject !== 'item' || !['create', 'change'].includes(p.action) || !p.itemVersionId)
        throw new ORPCError('CONFLICT', {
          message: 'Only a proposal for a new or changed fact can be edited in review.',
        })
      if (!['submitted', 'in_review'].includes(p.state))
        throw new ORPCError('CONFLICT', { message: "This proposal isn't in review any more." })
      if (input.reason !== undefined) plainReason(input.reason)
      const current = await stored(p.itemVersionId)
      const from = current.version.areaId
      const roles = await rolesIn(tx, from)
      if (!roles.has('owner'))
        throw new ORPCError('FORBIDDEN', {
          message: 'Only an owner of the domain can edit a proposal in review.',
        })
      const editor = await me()
      // A proposer who also owners the area cannot lower the bar for their own proposal (FR-206).
      if (current.version.proposerId === editor)
        throw new ORPCError('FORBIDDEN', {
          message: 'You wrote this proposal, so another owner edits it in review.',
        })
      if (p.claimedBy && p.claimedBy !== editor)
        throw new ORPCError('CONFLICT', {
          message: 'Another owner is already reviewing this proposal.',
        })
      const area = input.areaId ?? from
      if (area !== from) {
        const [target] = await tx.query<{ name: string }>(
          'select name from areas where id=$1 and archived_at is null',
          [area],
        )
        if (!target)
          throw new ORPCError('UNPROCESSABLE_CONTENT', { message: 'Choose an active domain.' })
        const there = await rolesIn(tx, area)
        if (!there.has('owner') && !(await isAdmin(tx)))
          throw new ORPCError('FORBIDDEN', {
            message: `Moving this proposal to ${target.name} also needs an owner of ${target.name}, or an admin.`,
          })
      }
      let ownerId = input.ownerId ?? current.version.ownerId
      // A moved proposal goes to its new area's owner, as a new draft would (FR-104).
      if (area !== from && input.ownerId === undefined) {
        const [assigned] = await tx.query<{ id: string }>(
          `select a.person_id::text as id from area_assignments a join people p on p.id=a.person_id
            where a.area_id=$1 and a.role='owner' and a.valid_at @> now()
              and p.deactivated_at is null and p.erased_at is null
            order by a.person_id limit 1`,
          [area],
        )
        if (assigned) ownerId = assigned.id
      }
      const claim: Pick<ItemVersion, 'claimLevel' | 'claimAuthority' | 'claimQuote'> = !input.claim
        ? {
            claimLevel: current.version.claimLevel,
            ...(current.version.claimAuthority === undefined
              ? {}
              : { claimAuthority: current.version.claimAuthority }),
            ...(current.version.claimQuote === undefined
              ? {}
              : { claimQuote: current.version.claimQuote }),
          }
        : input.claim.level === 'effect_stated'
          ? {
              claimLevel: 'effect_stated',
              claimAuthority: input.claim.authority,
              claimQuote: input.claim.quote,
            }
          : { claimLevel: 'fact_only' }
      const edited: Editable = {
        riskLevel: input.riskLevel ?? current.version.riskLevel,
        reviewDate: input.reviewDate === undefined ? current.version.reviewDate : input.reviewDate,
        ...claim,
        ownerId,
        areaId: area,
      }
      const changes = editableFields.flatMap((field) =>
        current.version[field] === edited[field]
          ? []
          : [[field, { before: current.version[field] ?? null, after: edited[field] ?? null }]],
      )
      if (!changes.length)
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: "There's nothing to save. Change a field first.",
        })
      rejectSensitive(input.claim ?? {})
      const { claimAuthority: _authority, claimQuote: _quote, ...kept } = current.version
      const version: ItemVersion = { ...kept, ...edited }
      const format = await checkDraft(
        tx,
        draftOf(version),
        version.proposerId,
        version.createdVia,
        current.itemId,
      )
      const problems = format.findings.filter(causedByEdit)
      if (!format.version || problems.length)
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: 'Fix the problems shown, then try again.',
          data: { findings: problems.length ? problems : format.findings },
        })
      const inserted = await insertVersion(tx, current.itemId, version, current.id, {
        editedBy: editor,
      })
      // The writer's draft follows the edit, so a resubmission after "ask for changes" keeps it.
      const { claimAuthority: _a, claimQuote: _q, ...draft } = p.draft
      await tx.query(
        'update proposals set item_version_id=$2,area_id=$3,draft=$4,draft_findings=$5 where id=$1',
        [
          p.id,
          inserted.id,
          area,
          JSON.stringify({ ...draft, ...edited }),
          JSON.stringify(format.findings),
        ],
      )
      // The replaced version can no longer be accepted: its answer tests would only cost money.
      const cancelled = await tx.query<{ id: string }>(
        `update eval_runs set state='cancelled',finished_at=now()
          where item_version_id=$1 and state in ('estimated','awaiting_approval','queued','running')
          returning id::text`,
        [current.id],
      )
      const updated = await loadProposal(tx, p.id)
      await proposalEvent(
        tx,
        updated,
        'edited',
        {
          versionId: inserted.id,
          replaces: current.id,
          changes: Object.fromEntries(changes),
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(cancelled.length ? { cancelledRuns: cancelled.map((r) => r.id) } : {}),
        },
        'proposal.edited',
      )
      if ((await tx.query('select 1 from live_edition')).length) {
        const runs = await runChecks(
          tx,
          clock,
          { id: p.id, channel: p.channel },
          await stored(inserted.id),
        )
        await proposalEvent(tx, updated, 'checked', {
          levels: Object.fromEntries(runs.map((r) => [r.level, r.outcome])),
        })
      }
      return review(p.id)
    },

    async decide(input: Decide) {
      await lockReleases(tx)
      const p = await loadProposal(tx, input.id, true)
      if (p.revision !== input.revision)
        throw new ORPCError('CONFLICT', {
          message:
            'Someone changed this proposal after you opened it. Look at the latest version, then try again.',
        })
      if (!['submitted', 'in_review'].includes(p.state))
        throw new ORPCError('CONFLICT', {
          message: 'This proposal no longer waits for a decision.',
        })
      plainReason(input.reason)
      const comment = input.comment?.trim()
      if (comment !== undefined) {
        if (input.outcome !== 'request_changes')
          throw new ORPCError('UNPROCESSABLE_CONTENT', {
            message: 'Only a request for changes takes a comment. Write a reason instead.',
          })
        if (!comment) throw new ORPCError('UNPROCESSABLE_CONTENT', { message: 'Write a comment.' })
        plainReason(comment)
      }
      const result =
        p.subject === 'vocabulary'
          ? await decideVocabulary(p, input)
          : p.action === 'retire'
            ? await decideRetirement(p, input)
            : await decideItem(p, input)
      if (comment) await decisionComment(result.proposal, comment)
      return { proposal: publicRecord(result.proposal), edition: result.edition }
    },

    /** FR-218: an owner or administrator retires an item at once, with a reason. */
    async retire(itemId: string, reason: string): Promise<Edition> {
      await lockReleases(tx)
      plainReason(reason)
      const version = await liveStored(itemId)
      const roles = await rolesIn(tx, version.version.areaId)
      const capacity: Capacity | null = roles.has('owner')
        ? 'owner'
        : (await isAdmin(tx))
          ? 'administrator'
          : null
      if (!capacity)
        throw new ORPCError('FORBIDDEN', {
          message: 'Only an owner of the domain or an admin can archive a fact.',
        })
      // A rolled-back item may be retired again by the same person: the first decision stands.
      await insertDecision(tx, {
        proposalId: null,
        itemVersionId: version.id,
        areaId: version.version.areaId,
        capacity,
        outcome: 'retire',
        reason,
      })
      const edition = await publishEdition(
        tx,
        { reason: 'item_retired', close: [itemId], note: reason },
        version.version.areaId,
      )
      await tx.query(
        `insert into audit_log(actor_id,actor_kind,action,area_id,subject_type,subject_id,details)
         values(cl_person(),'person','item.retired',$1,'item',$2,$3)`,
        [
          version.version.areaId,
          itemId,
          JSON.stringify({ reason, versionId: version.id, capacity }),
        ],
      )
      return edition
    },

    /** FR-112: anyone may propose that an item is retired; an owner decides. */
    async proposeRetirement(itemId: string, reason: string): Promise<ReviewProposal> {
      plainReason(reason)
      const version = await liveStored(itemId)
      const [area] = await tx.query<{ review_days: number }>(
        'select review_days from areas where id=$1',
        [version.version.areaId],
      )
      const [row] = await tx
        .query<{ id: string }>(
          `insert into proposals(action,state,area_id,item_id,item_version_id,proposer_id,channel,reason,submitted_at,due_at)
           values('retire','submitted',$1,$2,$3,cl_person(),'form',$4,now(),$5) returning id::text`,
          [
            version.version.areaId,
            itemId,
            version.id,
            reason,
            addWorkingDays(clock.now().toISOString(), area!.review_days),
          ],
        )
        .catch((error: unknown) => {
          if ((error as { code?: string }).code === '23505')
            throw new ORPCError('CONFLICT', {
              message: 'Someone already proposed to archive this fact.',
            })
          throw error
        })
      const p = await loadProposal(tx, row!.id)
      await proposalEvent(tx, p, 'submitted', { reason })
      return publicRecord(p)
    },

    /**
     * CON-211: an owner records "checked, still correct". The new version keeps the content and
     * takes the current change marks and a new review date; the edition clears the needs-check flag.
     */
    async recheck(
      itemId: string,
      reason: string,
      /**
       * Heed v1's Mark as checked (FR-139): an admin checks too, and a check is recorded even when
       * nothing else moved, since who checked it, and when, is what people read.
       */
      { v1 = false }: { v1?: boolean } = {},
    ) {
      await lockReleases(tx)
      plainReason(reason)
      const live = await liveStored(itemId)
      const roles = await rolesIn(tx, live.version.areaId)
      const capacity: Capacity | null = roles.has('owner')
        ? 'owner'
        : v1 && (await isAdmin(tx))
          ? 'administrator'
          : null
      if (!capacity)
        throw new ORPCError('FORBIDDEN', {
          message: v1
            ? 'Only an owner of the domain or an admin can check this fact again.'
            : 'Only an owner of the domain can check this fact again.',
        })
      const marks = await tx.query<{ ref: string; mark: string; missing: boolean }>(
        `select r.ref,d.change_mark as mark,coalesce(d.missing_since_snapshot is not null,true) as missing
           from unnest($1::text[]) as r(ref) left join definitions d on d.ref=r.ref`,
        [live.version.references],
      )
      if (marks.some((m) => m.missing))
        throw new ORPCError('CONFLICT', {
          message: 'A definition this fact uses is gone. Suggest a change instead.',
        })
      // A changed definition the item only mentions is also checked here: the new version
      // records the current marks, so its links read as current again.
      const [flag] = await tx.query<{ on: boolean }>(
        `select exists(select 1 from v_overlay_on where item_id=$1 and kind='flag_on' and flag='needs_check')
           or exists(select 1 from v_mention_status where version_id=$2 and status='source_changed') as on`,
        [itemId, live.id],
      )
      const [setting] = await tx.query<{ days: number }>(
        "select (value #>> '{}')::int as days from settings_current where key='review.default_days'",
      )
      // An open issue that is still going on is asked again after the shorter issue period (FR-135).
      const days =
        reviewQuestion(live.version) === 'still_going_on'
          ? await openIssueDays(tx)
          : (setting?.days ?? 90)
      // A check moves the next one on: an open-ended item always has one, and an item with an end
      // date keeps one only when it was given one.
      const version = {
        ...live.version,
        changeMarks: Object.fromEntries(marks.map((m) => [m.ref, m.mark])),
        reviewDate:
          live.version.validity.end === null || live.version.reviewDate !== null
            ? shiftDate(clock.today(), days)
            : null,
      }
      if (
        !v1 &&
        !flag?.on &&
        version.reviewDate === live.version.reviewDate &&
        canonicalJson(version.changeMarks) === canonicalJson(live.version.changeMarks)
      )
        throw new ORPCError('CONFLICT', {
          message: "Nothing changed since the last check, so this fact doesn't need checking.",
        })
      const inserted = await insertVersion(tx, itemId, version, live.id, { recheck: true })
      const [row] = await tx.query<{ id: string }>(
        `insert into proposals(action,state,area_id,item_id,item_version_id,proposer_id,channel,draft,reason,submitted_at)
         values('recheck','submitted',$1,$2,$3,cl_person(),'form',$4,$5,now()) returning id::text`,
        [live.version.areaId, itemId, inserted.id, JSON.stringify(draftOf(version)), reason],
      )
      const p = await loadProposal(tx, row!.id)
      const checked = await stored(inserted.id)
      await runChecks(tx, clock, { id: p.id, channel: p.channel }, checked)
      const gate = await readGate(tx, checked.id)
      if (!gatePasses(gate)) blocked(gate)
      const id = await insertDecision(tx, {
        proposalId: p.id,
        itemVersionId: inserted.id,
        areaId: live.version.areaId,
        capacity,
        outcome: 'accept',
        reason,
      })
      const data = { decisionId: id, outcome: 'accept', capacity, reason }
      const [waiting] = await tx.query<{ problem: string | null }>(
        'select cl_item_version_problem($1) as problem',
        [inserted.id],
      )
      if (waiting?.problem) {
        await proposalEvent(
          tx,
          p,
          'approved',
          { ...data, waitingFor: waiting.problem },
          'item.rechecked',
        )
        return { proposal: publicRecord(p), edition: null }
      }
      const result = await publishAccepted(p, await stored(inserted.id), data)
      return { proposal: publicRecord(result.proposal), edition: result.edition }
    },

    proposeTerm(change: Parameters<typeof proposeTerm>[2]) {
      rejectSensitive(change)
      return proposeTerm(tx, clock, change)
    },

    proposeTerms(input: Parameters<typeof proposeTerms>[2]) {
      rejectSensitive(input)
      return proposeTerms(tx, clock, input)
    },

    candidateTerms() {
      return candidateTerms(tx)
    },

    decideTermBatch,
    planDecisions,
    decideMany,
  }
}
export type ReviewService = ReturnType<typeof createReviewService>
