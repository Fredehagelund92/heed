import { ORPCError } from '@orpc/client'
import type * as z from 'zod/mini'
import {
  type AreaHoldings,
  type AreaRemoved,
  type ArchivedArea,
  type deleteEmptyAreaSchema,
  type removeAreaSchema,
} from '../../../contract/areas.ts'
import type { GrantChange } from '../../../contract/auth.ts'
import type { Edition } from '../../../contract/review.ts'
import {
  areaRemovalOutcome,
  confirmsDeletion,
  DELETE_DOMAIN_PHRASE,
  DOMAIN_DELETED_REASON,
  termFates,
} from '../../../domain/area-removal.ts'
import { contentDigest } from '../../../domain/canonical.ts'
import type { ItemKind } from '../../../domain/item.ts'
import { termDigestContent, type Term } from '../../../domain/vocabulary.ts'
import type { Queryable } from '../../db/database.ts'
import { plainReason, recordAudit } from '../admin/index.ts'
import { changeGrants, lockRoles } from '../auth/index.ts'
import { lockReleases, publishEdition } from '../editions/index.ts'
import { proposalEvents } from '../proposals/index.ts'
import { getArea } from './settings.ts'

/*
  Deleting a domain (FR-814, FR-815; src/domain/area-removal.ts decides). The web app deletes only
  an empty domain (`deleteEmptyArea`); `removeArea` does the rest in the request's transaction, so
  it happens whole or not at all: its open proposals are withdrawn, its drafts stay with their
  authors, its team's roles end, and one history log record names everything it did. A domain that
  nothing names is deleted for good; one that history names is archived, which people read as
  deleted (`archivedAreas`). What a deletion did is stored with it (0076).
*/

type TermKind = Term['kind']
type Role = 'owner' | 'approver'

/**
 * What deleting a domain would do, as the database reads it as the owner (0076). An item or a
 * proposal the audience rule hides is `withheld`, without a title (0083): it moves with the
 * domain, but nothing here names it.
 */
type Plan = {
  items: {
    id: string
    versionId: string
    title: string | null
    withheld: boolean
    kind: ItemKind
    proposerId: string
  }[]
  terms: {
    key: string
    versionId: string
    name: string
    kind: TermKind
    parentKey: string | null
    usedElsewhere: boolean
  }[]
  parentsOfOthers: string[]
  sourceTerms: { key: string; name: string; kind: TermKind }[]
  openProposals: {
    id: string
    number: number
    subject: 'item' | 'vocabulary'
    revision: number
    proposerId: string
    title: string | null
    withheld: boolean
  }[]
  drafts: { id: string; proposerId: string; author: string; title: string }[]
  team: { personId: string; name: string; role: Role }[]
  sourceMembers: number
  history: boolean
}

/** What a deletion did, stored with it (0076). */
type Contents = {
  items: { id: string; versionId: string; title: string | null }[]
  terms: { key: string; versionId: string; fate: 'retired' | 'kept'; keptVersionId?: string }[]
  sourceTerms: string[]
  openProposals: string[]
  drafts: string[]
  team: { personId: string; role: Role }[]
}

async function adminOnly(tx: Queryable) {
  const [actor] = await tx.query<{ allowed: boolean }>('select cl_is_admin_now() as allowed')
  if (!actor?.allowed)
    throw new ORPCError('FORBIDDEN', { message: 'Only an admin can delete a domain.' })
}

async function readPlan(tx: Queryable, id: string): Promise<Plan> {
  const [row] = await tx.query<{ plan: Plan }>('select cl_area_deletion_plan($1) as plan', [id])
  return row!.plan
}

function holdingsOf(plan: Plan): AreaHoldings {
  return {
    items: plan.items.length,
    terms: plan.terms.length + plan.sourceTerms.length,
    openProposals: plan.openProposals.length,
    sourceMembers: plan.sourceMembers,
    drafts: plan.drafts.length,
    team: plan.team.length,
    history: plan.history,
  }
}

const fatesOf = (plan: Plan) => termFates(plan.terms, new Set(plan.parentsOfOthers))

/**
 * The entries a person may see named: not the withheld ones, which the counts still hold (the
 * dialog's "and N more").
 */
const named = <T extends { title: string | null; withheld: boolean }>(entries: readonly T[]) =>
  entries.flatMap((entry) =>
    entry.withheld || entry.title === null ? [] : [{ ...entry, title: entry.title }],
  )

/**
 * A term another domain still uses stays in service, without a domain: a new version of it, made
 * by the administrator as an accepted vocabulary proposal with its decision, so the serving guard
 * (0006) reads the same trail as for any other term. Returns each new version's id by key.
 */
async function keepWithoutDomain(
  tx: Queryable,
  areaId: string,
  keys: readonly string[],
): Promise<Map<string, string>> {
  if (!keys.length) return new Map()
  const live = await tx.query<Term & { versionId: string }>(
    `select t.key,t.kind::text as kind,t.parent_key as "parentKey",v.name,v.aliases,v.area_id as "areaId",
            coalesce((select array_agg(r.definition_ref order by r.definition_ref collate "C")
                        from vocab_term_refs r where r.version_id=v.id),'{}') as "definitionRefs",
            v.id::text as "versionId"
       from vocab_term_service s join vocab_term_versions v on v.id=s.version_id
       join vocab_terms t on t.key=s.term_key
      where s.editions @> (select seq from live_edition) and s.term_key=any($1::text[])
      order by t.key`,
    [keys],
  )
  const rows = JSON.stringify(
    await Promise.all(
      live.map(async ({ versionId, ...term }) => {
        const kept = { ...term, areaId: null }
        return {
          ...kept,
          base: versionId,
          digest: await contentDigest(termDigestContent(kept)),
        }
      }),
    ),
  )
  const each = 'from jsonb_array_elements($1::jsonb) with ordinality as e(row, n)'
  const versions = await tx.query<{ id: string; key: string }>(
    `insert into vocab_term_versions(term_key,version_no,name,aliases,area_id,proposer_id,content_digest)
     select row->>'key',
            (select max(version_no)+1 from vocab_term_versions where term_key=row->>'key'),
            row->>'name',array(select jsonb_array_elements_text(row->'aliases')),null,null,
            decode(row->>'digest','hex')
       ${each} order by n
     returning id::text,term_key as key`,
    [rows],
  )
  const versionOf = Object.fromEntries(versions.map((version) => [version.key, version.id]))
  await tx.query(
    `insert into vocab_term_refs(version_id,definition_ref)
     select (($2::jsonb)->>(row->>'key'))::uuid,jsonb_array_elements_text(row->'definitionRefs') ${each}`,
    [rows, JSON.stringify(versionOf)],
  )
  const proposals = await tx.query<{ id: string; revision: number }>(
    `insert into proposals(subject,action,state,area_id,proposer_id,channel,vocab_version_id,draft,reason,submitted_at,closed_at)
     select 'vocabulary','change','accepted',null,cl_person(),'form',(($2::jsonb)->>(row->>'key'))::uuid,
            jsonb_build_object('key',row->>'key','kind',row->>'kind','parentKey',row->'parentKey','name',row->>'name',
              'aliases',row->'aliases','areaId',null,'definitionRefs',row->'definitionRefs','base',row->>'base'),
            $3,now(),now()
       ${each} order by n
     returning id::text,revision`,
    [rows, JSON.stringify(versionOf), DOMAIN_DELETED_REASON],
  )
  const decisions = await tx.query<{ id: string; proposalId: string }>(
    `insert into decisions(proposal_id,vocab_version_id,area_id,decided_by,capacity,outcome,reason)
     select p.id,p.vocab_version_id,null,cl_person(),'administrator','accept',$2
       from proposals p where p.id=any($1::uuid[])
     returning id::text,proposal_id::text as "proposalId"`,
    [proposals.map((p) => p.id), DOMAIN_DELETED_REASON],
  )
  const decisionOf = new Map(decisions.map((d) => [d.proposalId, d.id]))
  await proposalEvents(
    tx,
    proposals.map((p) => ({
      p: { id: p.id, areaId: null, state: 'accepted', revision: p.revision },
      kind: 'decided',
      data: {
        decisionId: decisionOf.get(p.id),
        outcome: 'accept',
        capacity: 'administrator',
        reason: DOMAIN_DELETED_REASON,
        domainDeleted: areaId,
      },
      audit: 'decision.accept',
    })),
  )
  return new Map(versions.map((version) => [version.key, version.id]))
}

/**
 * Deletes a domain and everything under it (FR-814), once the person has typed `permanently
 * delete`. All in the request's transaction, so it happens whole or not at all, and never leaves
 * an accepted item without a domain or a term in the deleted one. Refused only for the demo
 * domain, or when the domain changed since it was read.
 */
async function removeArea(
  tx: Queryable,
  input: z.infer<typeof removeAreaSchema>,
): Promise<AreaRemoved> {
  // The edition lock first, as every release takes it, so the live edition cannot move under us.
  await lockReleases(tx)
  await adminOnly(tx)
  if (input.reason !== undefined) plainReason(input.reason)
  await tx.query("select pg_advisory_xact_lock(hashtextextended('heed.areas',0))")
  // Before the first history entry, as a role change takes it: areas, then roles, then the log.
  await lockRoles(tx)
  const area = await getArea(tx, input.id)
  if (area.revision !== input.revision)
    throw new ORPCError('CONFLICT', {
      message:
        'Someone changed this domain after you opened it. Look at the latest version, then try again.',
    })
  if (!confirmsDeletion(input.confirm))
    throw new ORPCError('BAD_REQUEST', { message: `Type ${DELETE_DOMAIN_PHRASE} to confirm.` })
  const plan = await readPlan(tx, input.id)
  const holdings = holdingsOf(plan)
  const outcome = areaRemovalOutcome(holdings, area.demo)
  if (outcome === 'blocked')
    throw new ORPCError('CONFLICT', { message: "The demo domain can't be deleted." })
  const why = input.reason === undefined ? {} : { reason: input.reason }
  const team = {
    ownerIds: area.ownerIds,
    approverIds: area.approverIds,
  }
  if (outcome === 'delete') {
    await tx.query('select cl_area_delete($1)', [input.id])
    await recordAudit(tx, {
      action: 'area.deleted',
      areaId: input.id,
      subjectType: 'area',
      subjectId: input.id,
      details: { name: area.name, kept: false, team, ...why },
    })
    return { outcome: 'deleted', area, edition: null, holdings }
  }

  const fates = fatesOf(plan)
  const retired = plan.terms.filter((term) => fates.get(term.key) === 'retired')
  const kept = plan.terms.filter((term) => fates.get(term.key) === 'kept')
  // A retire decision by the administrator for each item agents get: the closing guard (0006).
  if (plan.items.length)
    await tx.query(
      `insert into decisions(item_version_id,area_id,decided_by,capacity,outcome,reason)
       select v,$2,cl_person(),'administrator','retire',$3 from unnest($1::uuid[]) v`,
      [plan.items.map((item) => item.versionId), input.id, DOMAIN_DELETED_REASON],
    )
  const keptVersions = await keepWithoutDomain(
    tx,
    input.id,
    kept.map((term) => term.key),
  )
  // Open proposals close for good, with the reason their authors read.
  const withdrawn = plan.openProposals.length
    ? await tx.query<{ id: string; revision: number }>(
        `update proposals set state='withdrawn',closed_at=now(),reason=$2
          where id=any($1::uuid[]) and state in ('submitted','in_review','changes_requested')
          returning id::text,revision`,
        [plan.openProposals.map((p) => p.id), DOMAIN_DELETED_REASON],
      )
    : []
  await proposalEvents(
    tx,
    withdrawn.map((p) => ({
      p: { id: p.id, areaId: input.id, state: 'withdrawn', revision: p.revision },
      kind: 'withdrawn',
      data: { reason: DOMAIN_DELETED_REASON },
    })),
  )
  // The team's roles end at the instant the domain is archived, so restoring finds them.
  const ended: GrantChange[] = plan.team.map(({ personId, role }) => ({
    op: 'revoke' as const,
    personId,
    role,
    areaId: input.id,
  }))
  // The domain goes, so its last owner goes with it.
  if (ended.length)
    await changeGrants(tx, ended, {
      batch: true,
      reason: input.reason ?? null,
      keepOwners: false,
    })
  await tx.query(
    'update areas set archived_at=now(),revision=revision+1 where id=$1 and archived_at is null',
    [input.id],
  )
  // One edition for everything agents get: the items close, the terms retire or lose the domain,
  // and a term whose domain only the source gave loses it, as the archived domain is no longer
  // one the source can give (0076).
  const edition: Edition | null =
    plan.items.length || plan.terms.length || plan.sourceTerms.length
      ? await publishEdition(
          tx,
          {
            reason: 'area_deleted',
            note: input.reason ?? `${DOMAIN_DELETED_REASON}: ${area.name}`,
            close: plan.items.map((item) => item.id),
            vocabulary: [...keptVersions.values()],
            retire: retired.map((term) => term.key),
          },
          input.id,
        )
      : null
  if (plan.items.length) {
    await tx.query(
      `insert into item_bin(item_id,version_id,area_id,reason,binned_by,binned_edition)
       select x.id,x.v,$3,$4,cl_person(),$5
         from unnest($1::text[],$2::uuid[]) with ordinality as x(id,v,n) order by x.n`,
      [
        plan.items.map((item) => item.id),
        plan.items.map((item) => item.versionId),
        input.id,
        DOMAIN_DELETED_REASON,
        edition!.seq,
      ],
    )
    // Each item's own history keeps the move, as the Bin records it.
    await tx.query(
      `insert into audit_log(actor_id,actor_kind,action,area_id,subject_type,subject_id,details)
       select cl_person(),'person','item.binned',$1,'item',row->>'id',
              jsonb_build_object('title',row->>'title','reason',$2::text,'versionId',row->>'versionId',
                                 'edition',$3::text,'openProposals',0)
         from jsonb_array_elements($4::jsonb) with ordinality as e(row, n) order by n`,
      [input.id, DOMAIN_DELETED_REASON, edition!.label, JSON.stringify(plan.items)],
    )
  }
  const contents: Contents = {
    items: plan.items.map(({ id, versionId, title }) => ({ id, versionId, title })),
    terms: plan.terms.map(({ key, versionId }) => {
      const keptVersionId = keptVersions.get(key)
      return keptVersionId
        ? { key, versionId, fate: 'kept' as const, keptVersionId }
        : { key, versionId, fate: 'retired' as const }
    }),
    sourceTerms: plan.sourceTerms.map((term) => term.key),
    openProposals: withdrawn.map((p) => p.id),
    drafts: plan.drafts.map((draft) => draft.id),
    team: plan.team.map(({ personId, role }) => ({ personId, role })),
  }
  const recipients = [
    ...new Set([
      ...plan.items.map((item) => item.proposerId),
      ...plan.openProposals.map((p) => p.proposerId),
      ...plan.drafts.map((draft) => draft.proposerId),
      ...plan.team.map((role) => role.personId),
    ]),
  ].filter(Boolean)
  const [deletion] = await tx.query<{ id: string }>(
    `insert into area_deletions(area_id,deleted_by,reason,edition,contents,recipients)
     values($1,cl_person(),$2,$3,$4,$5::uuid[]) returning id::text`,
    [input.id, input.reason ?? null, edition?.seq ?? null, JSON.stringify(contents), recipients],
  )
  // One record that names everything deleting did, for the history log.
  await recordAudit(tx, {
    action: 'area.deleted',
    areaId: input.id,
    subjectType: 'area',
    subjectId: input.id,
    details: {
      name: area.name,
      kept: true,
      edition: edition?.label ?? null,
      holdings,
      team,
      items: named(plan.items).map(({ id, title }) => ({ id, title })),
      terms: [
        ...plan.terms.map(({ key, name }) => ({ key, name, fate: fates.get(key) })),
        ...plan.sourceTerms.map(({ key, name }) => ({ key, name, fate: 'source' })),
      ],
      openProposals: named(plan.openProposals).map(({ id, number, title }) => ({
        id,
        number,
        title,
      })),
      drafts: plan.drafts.map(({ id, title }) => ({ id, title })),
      roles: plan.team.map(({ personId, name, role }) => ({ personId, name, role })),
      ...why,
    },
  })
  await tx.query(
    `insert into outbox_events(topic,area_id,aggregate_type,aggregate_id,payload)
     values('area.deleted',$1,'area',$1,$2)`,
    [input.id, JSON.stringify({ deletion: deletion!.id, name: area.name })],
  )
  return {
    outcome: 'archived',
    area,
    edition,
    holdings,
  }
}

/** When a deleted domain was deleted: its deletion record, or for one archived before, the row. */
const deletedAt = `coalesce((select d.deleted_at from area_deletions d
  where d.area_id=a.id and d.restored_at is null),a.archived_at)`

/** The deleted domains history keeps, newest first, with what restoring gives back. */
/**
 * Deleting a domain from its page (FR-815): only one that holds no context items and no terms,
 * and never the sandbox. What is left under it (open suggestions, drafts, its owners) goes as
 * `removeArea` lets it go, so a domain history names is kept as history.
 */
export async function deleteEmptyArea(
  tx: Queryable,
  input: z.infer<typeof deleteEmptyAreaSchema>,
): Promise<AreaRemoved> {
  // The locks deleting takes, in its order, before anything is read: nothing moves in meanwhile.
  await lockReleases(tx)
  await adminOnly(tx)
  await tx.query("select pg_advisory_xact_lock(hashtextextended('heed.areas',0))")
  const area = await getArea(tx, input.id)
  if (area.demo)
    throw new ORPCError('CONFLICT', {
      message:
        "The sandbox can't be deleted. It is where people try context, and agents never get it.",
    })
  const holdings = holdingsOf(await readPlan(tx, input.id))
  if (holdings.items || holdings.terms || holdings.sourceMembers)
    throw new ORPCError('CONFLICT', {
      message:
        // eslint-disable-next-line heed/plain-words -- Heed v1's word: the terms written in Definitions
        'Only an empty domain can be deleted. Move its context and terms to another domain first.',
      data: { holdings },
    })
  return removeArea(tx, { id: input.id, revision: area.revision, confirm: DELETE_DOMAIN_PHRASE })
}

export async function archivedAreas(tx: Queryable): Promise<ArchivedArea[]> {
  await adminOnly(tx)
  return tx.query<ArchivedArea>(
    `select a.id, a.name, a.label, a.summary,
       to_char(${deletedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "archivedAt",
       (select count(*)::int from area_assignments x
         where x.area_id = a.id and upper(x.valid_at) = a.archived_at) as team,
       coalesce((select jsonb_array_length(d.contents->'terms') + jsonb_array_length(d.contents->'sourceTerms')
         from area_deletions d where d.area_id=a.id and d.restored_at is null), 0) as terms,
       (select count(*)::int from item_bin b where b.area_id = a.id and b.restored_at is null)
         as "binnedItems"
     from areas a where a.archived_at is not null
     order by a.archived_at desc, a.id`,
  )
}
