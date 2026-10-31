import { ORPCError } from '@orpc/client'
import type * as z from 'zod/mini'
import type { decideSchema, Edition, Gate, ReviewProposal } from '../../../contract/review.ts'
import { canonicalJson } from '../../../domain/canonical.ts'
import { addWorkingDays } from '../../../domain/review.ts'
import { reviewQuestion } from '../../../domain/item.ts'
import { shiftDate } from '../../../domain/validity.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { lockReleases, publishEdition } from '../editions/index.ts'
import {
  insertVersion,
  openIssueDays,
  readVersion,
  rejectMentions,
  rejectSensitive,
  type StoredVersion,
} from '../proposals/index.ts'
import { draftOf, gatePasses, readGate, runChecks } from './checks.ts'
import {
  deciderIn,
  insertDecision,
  isAdmin,
  liveVersionId,
  loadProposal,
  loadProposals,
  proposalEvent,
  proposalEvents,
  publicRecord,
  rolesIn,
  type LoadedProposal,
  type Role,
} from './records.ts'

export const sourceToolQuestion =
  'Does this change a definition or the way agents choose data? That belongs in the source tool.'
type Decide = z.infer<typeof decideSchema>
/**
 * An accept made under an owner's policy, without a review round (FR-421): the decision names the
 * policy, and its timeline entry and history log line carry what the policy and the agent were.
 */
export type UnderPolicy = { policyId: string; details: Record<string, unknown> }
type Capacity = Role | 'administrator'
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
    proposerId: string | null,
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

  async function decideItem(p: LoadedProposal, input: Decide, policy?: UnderPolicy) {
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
    const id = policy
      ? await insertDecision(tx, { ...decision, outcome: 'accept', autoPolicyId: policy.policyId })
      : ((await insertDecision(tx, { ...decision, outcome: 'accept' })) ??
        (await waitingAccept(version.id)))
    if (!id) throw new ORPCError('CONFLICT', { message: 'You already accepted this version.' })
    const data = {
      decisionId: id,
      outcome: 'accept',
      capacity,
      reason: input.reason,
      ...byProposer(p, await me()),
      ...policy?.details,
    }
    const [waiting] = await tx.query<{ problem: string | null }>(
      'select cl_item_version_problem($1) as problem',
      [version.id],
    )
    // A policy publishes at once or not at all: the suggestion then waits for review as it is.
    if (waiting?.problem && policy)
      throw new ORPCError('CONFLICT', {
        message: `It can't be shared with agents: ${waiting.problem}.`,
      })
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

  async function decideRetirement(p: LoadedProposal, input: Decide) {
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

  let person: string | undefined
  async function me() {
    person ??= (await tx.query<{ id: string }>('select cl_person()::text as id'))[0]!.id
    return person
  }

  return {
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

    async decide(input: Decide, policy?: UnderPolicy) {
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
      if (policy && (p.action !== 'create' || input.outcome !== 'accept'))
        throw new ORPCError('CONFLICT', { message: 'A policy only publishes a new fact.' })
      const result =
        p.action === 'retire'
          ? await decideRetirement(p, input)
          : await decideItem(p, input, policy)
      if (comment) await decisionComment(result.proposal, comment)
      return { proposal: publicRecord(result.proposal), edition: result.edition }
    },

    /**
     * Closes a suggestion to archive that its sender took back in the comments (migration 0028):
     * the owners' decision not to archive, so nothing changes and the item stays live. An owner of
     * its domain or an admin closes it, as they would decide it, and may undo it in the window.
     */
    async close(input: { id: string; revision: number }) {
      const p = await loadProposal(tx, input.id, true)
      if (p.revision !== input.revision)
        throw new ORPCError('CONFLICT', {
          message:
            'Someone changed this suggestion after you opened it. Look at the latest version, then try again.',
        })
      if (!['submitted', 'in_review'].includes(p.state))
        throw new ORPCError('CONFLICT', { message: 'It no longer waits for a decision.' })
      const [withdrawn] = await tx.query<{ yes: boolean }>(
        `select exists(select 1 from comments c where c.proposal_id=$1 and c.withdrew_at is not null
                         and c.deleted_at is null and c.author_id=$2::uuid) as yes`,
        [p.id, p.proposerId],
      )
      if (p.subject !== 'item' || p.action !== 'retire' || !withdrawn?.yes)
        throw new ORPCError('CONFLICT', {
          message:
            'Only a suggestion to archive that its sender took back in the comments is closed. Decide this one instead.',
        })
      const capacity = await capacityFor(p.areaId!, undefined, p.proposerId)
      if (p.claimedBy && p.claimedBy !== (await me()))
        throw new ORPCError('CONFLICT', { message: 'Another owner is reviewing it.' })
      const reason = 'Closed: its sender took it back in the comments.'
      const id = await insertDecision(tx, {
        proposalId: p.id,
        itemVersionId: p.itemVersionId,
        areaId: p.areaId,
        capacity,
        outcome: 'reject',
        reason,
      })
      if (!id) throw new ORPCError('CONFLICT', { message: 'You already closed it.' })
      const data = {
        decisionId: id,
        outcome: 'reject',
        capacity,
        reason,
        closed: true,
        ...byProposer(p, await me()),
      }
      const closed = await moved(p, 'rejected', 'decided', data, 'proposal.closed')
      return { proposal: publicRecord(closed), decision: id }
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
  }
}
export type ReviewService = ReturnType<typeof createReviewService>
