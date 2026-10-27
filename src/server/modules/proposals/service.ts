import { ORPCError } from '@orpc/client'
import type * as z from 'zod/mini'
import type { BulkSkip } from '../../../contract/review.ts'
import type {
  createProposalSchema,
  overlapSchema,
  proposalListSchema,
  ProposalRecord,
  ProposalListResult,
} from '../../../contract/proposals.ts'
import { bulkSkipWords } from '../../../domain/bulk-review.ts'
import { type Draft, formatOutcome, textFindings } from '../../../domain/draft.ts'
import type { ItemKind } from '../../../domain/item.ts'
import { parseMentions } from '../../../domain/mentions.ts'
import { keepMarks, type Provenance } from '../../../domain/provenance.ts'
import { addWorkingDays, vocabularyChangeOf } from '../../../domain/review.ts'
import { isCalendarDate, shiftDate } from '../../../domain/validity.ts'
import { relevantRefs } from '../../../domain/vocabulary.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { forReader } from '../library/index.ts'
import { checkDraft } from './checks.ts'
import { eventData } from './events.ts'
import { attachedTests } from './tests.ts'
import { insertVersion } from './versions.ts'

const fields = `id::text,number::float8,subject,action,state,area_id as "areaId",item_id as "itemId",
 vocab_version_id::text as "vocabularyVersionId",reason,
 coalesce(draft->>'title', (select title from item_versions where id=proposals.item_version_id),
   (select name from vocab_term_versions where id=proposals.vocab_version_id),'Untitled proposal') as title,
 case when subject='vocabulary' then draft - 'base' else null end as vocabulary,
 item_version_id::text as "itemVersionId",proposer_id::text as "proposerId",channel,revision,
 case when subject='item' then coalesce(draft,'{}'::jsonb) else '{}'::jsonb end as draft,
 provenance,draft_findings as findings,claimed_by::text as "claimedBy",due_at::text as "dueAt",
 created_at::text as "createdAt",updated_at::text as "updatedAt"`
/**
 * A proposal as the API returns it. A term proposed before a term could name several definitions
 * (0070) stored the one it named as `definitionRef`; it reads as `definitionRefs`.
 */
const record = (row: ProposalRecord): ProposalRecord =>
  row.vocabulary ? { ...row, vocabulary: vocabularyChangeOf(row.vocabulary) } : row
/**
 * Proposals as the API returns them to the reader: a draft that names an item the audience rule
 * hides from them reads without it (`forReader`). Row security leaves out the proposals they may
 * not read at all (0083).
 */
async function forReaders(tx: Queryable, rows: readonly ProposalRecord[]) {
  const drafts = await forReader(
    tx,
    rows.map((row) => row.draft),
  )
  return rows.map((row, index) => ({ ...row, draft: drafts[index]! }))
}
const open = ['draft', 'submitted', 'in_review', 'changes_requested']
/** An accepted item of `serving_items` as a draft's scope and validity, for cl_scopes_overlap. */
const servedScope = `jsonb_build_object('validity',jsonb_build_object('start',valid_from,'end',valid_until),'scope',jsonb_build_object('metrics',metrics,'dimensions',to_jsonb(dimension_keys),'dimensionValues',coalesce((select jsonb_agg(jsonb_build_object('dimension','dim:'||split_part(substr(value,5),'/',1),'value',value)) from unnest(value_keys) value),'[]')))`
type Overlapping = z.infer<typeof overlapSchema>['otherProposals'][number]

/**
 * Accepted items in service, that the person may read, whose scope and dates overlap a draft's:
 * possible duplicates and conflicts (FR-209). The item the draft changes is left out.
 */
export function acceptedOverlaps(tx: Queryable, draft: Draft, itemId: string | null) {
  return tx.query<{ id: string; title: string; kind: ItemKind }>(
    `select item_id as id,title,kind::text as kind from serving_items((select seq from live_edition)) v where cl_audience_allows(audience_groups) and item_id is distinct from $2 and cl_scopes_overlap($1::jsonb,${servedScope}) order by item_id`,
    [JSON.stringify(draft), itemId],
  )
}
export function rejectSensitive(value: unknown) {
  const findings = textFindings(value)
  if (findings.length)
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message: 'Remove the email address, phone number or secret from the text.',
      data: { findings },
    })
}
export function rejectMentions(text: string) {
  if (!text.trim() || parseMentions(text).mentions.length || parseMentions(text).errors.length)
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message: 'Write it in plain text, without mentions.',
    })
}

/**
 * What is wrong with the current version, as a change to an item stores it (heed-ux B5): trimmed,
 * null when empty, plain text without mentions or sensitive text. A new item has no current version.
 */
export function changeReason(text: string | null | undefined, action: ProposalRecord['action']) {
  const reason = text?.trim() || null
  if (reason === null) return null
  if (action !== 'change')
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message: 'Only a suggested change says what is wrong with a fact.',
    })
  rejectSensitive(reason)
  rejectMentions(reason)
  return reason
}

/**
 * The Bin record of a rescue (FR-814): an administrator restored an item of a deleted domain into
 * another domain, and this proposal opened there. Null for any other proposal. A restored record
 * is history that everyone who reads the item reads (0067).
 */
export async function rescueOf(tx: Queryable, proposalId: string) {
  const [row] = await tx.query<{
    versionId: string
    deletedDomain: string
    restoredBy: string
    restoredAt: string
  }>(
    `select b.version_id::text as "versionId",a.name as "deletedDomain",b.restored_by::text as "restoredBy",
            to_char(b.restored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as "restoredAt"
       from item_bin b join areas a on a.id=b.area_id where b.rescue_proposal=$1`,
    [proposalId],
  )
  return row ?? null
}

/** The review period of an issue with no end date, in days (FR-135). */
export async function openIssueDays(tx: Queryable): Promise<number> {
  const [setting] = await tx.query<{ days: number }>(
    "select (value #>> '{}')::int as days from settings_current where key='review.open_issue_days'",
  )
  return setting?.days ?? 14
}

export function createProposalsService(tx: Queryable, clock: Clock, personId: string) {
  async function get(id: string, lock = false): Promise<ProposalRecord> {
    const [row] = await tx.query<ProposalRecord>(
      `select ${fields} from proposals where id=$1 and discarded_at is null${lock ? ' for update' : ''}`,
      [id],
    )
    if (!row) throw new ORPCError('NOT_FOUND')
    return record(row)
  }
  async function getItem(id: string, lock = false) {
    const p = await get(id, lock)
    if (p.subject !== 'item' || !['create', 'change'].includes(p.action) || !p.areaId)
      throw new ORPCError('NOT_FOUND')
    return { ...p, areaId: p.areaId }
  }
  function conflict(proposal: ProposalRecord): never {
    throw new ORPCError('CONFLICT', {
      message:
        'Someone changed this proposal after you opened it. Look at the latest version, then try again.',
      data: { current: proposal },
    })
  }
  async function current(id: string, revision: number) {
    const proposal = await getItem(id, true)
    if (proposal.revision !== revision) conflict(proposal)
    return proposal
  }
  function proposerOnly(p: ProposalRecord) {
    if (p.proposerId !== personId) throw new ORPCError('FORBIDDEN')
  }
  async function owner(area: string, actor = personId) {
    const rows = await tx.query(
      `select 1 from area_assignments a join people p on p.id=a.person_id
      where a.area_id=$1 and a.person_id=$2 and a.role='owner' and a.valid_at @> now()
      and p.deactivated_at is null and p.erased_at is null`,
      [area, actor],
    )
    if (!rows.length)
      throw new ORPCError('FORBIDDEN', { message: 'Only an owner of this domain can do this.' })
  }
  /** Whether the person reviews the proposal: its area's reviewer, or an administrator for a term. */
  async function reviews(p: Pick<ProposalRecord, 'areaId' | 'subject'>) {
    const [row] = await tx.query<{ ok: boolean }>(
      `select (cl_is_reviewer_now($1) or ($2 = 'vocabulary' and cl_is_admin_now())) as ok`,
      [p.areaId, p.subject],
    )
    return row?.ok ?? false
  }
  async function event(p: ProposalRecord, kind: string, data: Record<string, unknown> = {}) {
    await tx.query(
      'insert into proposal_events(proposal_id,actor_id,kind,data) values($1,cl_person(),$2,$3)',
      [p.id, kind, JSON.stringify(data)],
    )
    await tx.query(
      `insert into outbox_events(topic,area_id,aggregate_type,aggregate_id,payload)
      values($1,$2,'proposal',$3,$4)`,
      [
        `proposal.${kind}`,
        p.areaId,
        p.id,
        // Ids and states only. A hand-over names its new reviewer, who gets the inbox item.
        JSON.stringify({
          id: p.id,
          state: p.state,
          revision: p.revision,
          ...(typeof data.personId === 'string' ? { personId: data.personId } : {}),
        }),
      ],
    )
    await tx.query(
      `insert into audit_log(actor_id,actor_kind,action,area_id,subject_type,subject_id,details)
      values(cl_person(),'person',$1,$2,'proposal',$3,$4)`,
      [`proposal.${kind}`, p.areaId, p.id, JSON.stringify({ revision: p.revision })],
    )
  }
  async function audit(p: ProposalRecord, action: string, details: Record<string, unknown>) {
    await tx.query(
      `insert into audit_log(actor_id,actor_kind,action,area_id,subject_type,subject_id,details)
      values(cl_person(),'person',$1,$2,'proposal',$3,$4)`,
      [action, p.areaId, p.id, JSON.stringify(details)],
    )
  }
  /**
   * FR-524: the draft's author attaches and detaches tests while it is a draft; the area's
   * owners and administrators until a decision. Row security holds the same rule.
   */
  async function attachable(id: string) {
    const p = await getItem(id)
    if (!open.includes(p.state))
      throw new ORPCError('CONFLICT', {
        message: 'Test questions can be attached only until the proposal is decided.',
      })
    if (p.state === 'draft' && p.proposerId === personId) return p
    const [maintains] = await tx.query<{ ok: boolean }>(
      'select cl_is_admin_now() or cl_is_owner_now($1) as ok',
      [p.areaId],
    )
    if (!maintains?.ok)
      throw new ORPCError('FORBIDDEN', {
        message:
          "The writer attaches test questions while it's a draft. After that, the owners of the domain and admins do, until it's decided.",
      })
    return p
  }
  /**
   * The definitions behind the scope's terms in the live vocabulary. A dimension in several views
   * brings only its members in the views of the scope's metrics, or all of them when the scope
   * names no metric (CON-209), so a change elsewhere does not flag the item.
   */
  async function scopeDefinitions(scope: Draft['scope']) {
    const terms = [
      ...(scope?.metrics ?? []),
      ...(scope?.dimensions ?? []),
      ...(scope?.dimensionValues.map((v) => v.dimension) ?? []),
    ]
    const rows = await tx.query<{ key: string; refs: string[] }>(
      `select key,definition_refs as refs from serving_vocabulary((select seq from live_edition))
        where key=any($1::text[])`,
      [terms],
    )
    const metrics = new Set(scope?.metrics ?? [])
    const metricRefs = rows.filter((row) => metrics.has(row.key)).flatMap((row) => row.refs)
    const refs = [...new Set(rows.flatMap((row) => relevantRefs(row.refs, metricRefs)))]
    return tx.query<{ ref: string; change_mark: string }>(
      'select ref,change_mark from definitions where ref=any($1::text[]) order by ref',
      [refs],
    )
  }
  /** `before` is the scope the draft had, whose definitions leave with the terms taken out of it. */
  async function defaults(
    input: Draft,
    areaFallback?: string,
    before?: Draft['scope'],
  ): Promise<Draft> {
    input = { ...input }
    for (const field of ['summary', 'body'] as const) {
      const markupField = field === 'summary' ? 'summaryMarkup' : 'bodyMarkup'
      const markup = input[markupField] ?? input[field]
      if (markup === undefined) continue
      const parsed = parseMentions(markup)
      if (input[markupField] !== undefined || parsed.mentions.length || parsed.errors.length) {
        input[markupField] = markup
        input[field] = parsed.text
      }
    }
    const definitionRows = await scopeDefinitions(input.scope)
    // A reference the scope brought in goes when its term is taken out of the scope; one given
    // on its own stays.
    const kept = new Set(definitionRows.map((d) => d.ref))
    const dropped = new Set(
      before
        ? (await scopeDefinitions(before)).flatMap((d) => (kept.has(d.ref) ? [] : [d.ref]))
        : [],
    )
    const references = [
      ...new Set([
        ...(input.references ?? []).filter((ref) => !dropped.has(ref)),
        ...definitionRows.map((d) => d.ref),
      ]),
    ]
    const changeMarks = Object.fromEntries(
      Object.entries({
        ...Object.fromEntries(definitionRows.map((d) => [d.ref, d.change_mark])),
        ...input.changeMarks,
      }).filter(([ref]) => !dropped.has(ref)),
    )
    let area = input.areaId ?? areaFallback
    if (!area) {
      const rows = await tx.query<{ area_id: string }>(
        `select distinct area_id from serving_vocabulary((select seq from live_edition))
        where area_id is not null and (key=any($1::text[]) or definition_refs && $2::text[])`,
        [input.scope?.metrics ?? [], input.references ?? []],
      )
      if (rows.length === 1) area = rows[0]!.area_id
    }
    if (
      !area ||
      !(await tx.query('select 1 from areas where id=$1 and archived_at is null', [area])).length
    )
      throw new ORPCError('UNPROCESSABLE_CONTENT', { message: 'Choose an active domain.' })
    const [assigned] = await tx.query<{ person_id: string }>(
      `select a.person_id from area_assignments a join people p on p.id=a.person_id
      where a.area_id=$1 and a.role='owner' and a.valid_at @> now() and p.deactivated_at is null and p.erased_at is null
      order by a.person_id limit 1`,
      [area],
    )
    const issue = input.kind === 'issue'
    const draft: Draft = {
      kind: 'note',
      summary: '',
      scope: { metrics: [], dimensions: [], dimensionValues: [] },
      evidence: [],
      claimLevel: 'fact_only',
      riskLevel: input.kind && input.kind !== 'note' ? 'normal' : 'low',
      audience: { kind: 'everyone' },
      notToConclude: 'cause not proven',
      replaces: [],
      conflicts: [],
      // An issue with an end date stops by itself; an open one gets its own default below.
      reviewDate: issue ? null : shiftDate(clock.today(), 90),
      ...(assigned ? { ownerId: assigned.person_id } : {}),
      ...input,
      title: input.title ?? [...(input.summary ?? '')].slice(0, 200).join(''),
      references,
      changeMarks,
      areaId: area,
    }
    // An open-ended item needs a review date (FR-127). A change to an item that ended starts with
    // none, so taking its end date away gives it the default a new draft has.
    if (!issue && draft.validity?.end === null && !draft.reviewDate)
      draft.reviewDate = shiftDate(clock.today(), 90)
    // FR-135: an issue with no end date is asked "Is this still going on?" a set number of days
    // after it starts, unless the author gave a review date.
    const start = draft.validity?.start
    if (
      issue &&
      draft.validity?.end === null &&
      !draft.reviewDate &&
      start &&
      isCalendarDate(start)
    )
      draft.reviewDate = shiftDate(start, await openIssueDays(tx))
    return draft
  }
  async function seedItem(id: string): Promise<Draft> {
    const [row] = await tx.query<{ draft: Draft }>(
      `select jsonb_build_object(
      'kind',i.kind,'areaId',v.area_id,'title',v.title,'summary',v.summary,'scope',jsonb_build_object(
        'metrics',coalesce((select jsonb_agg(metric_key order by metric_key) from item_version_metrics where version_id=v.id),'[]'),
        'dimensions',coalesce((select jsonb_agg(dimension_key order by dimension_key) from item_version_dimensions where version_id=v.id),'[]'),
        'dimensionValues',coalesce((select jsonb_agg(jsonb_build_object('dimension',dimension_key,'value',value_key) order by value_key) from item_version_dimension_values where version_id=v.id),'[]')),
      'validity',jsonb_build_object('start',v.valid_from,'end',v.valid_until),'reviewDate',v.review_date,
      'evidence',coalesce((select jsonb_agg(jsonb_build_object('url',url,'quote',quote,'date',read_on) order by position) from item_version_evidence where version_id=v.id),'[]'),
      'references',coalesce((select jsonb_agg(definition_ref order by definition_ref) from item_version_refs where version_id=v.id),'[]'),
      'changeMarks',coalesce((select jsonb_object_agg(definition_ref,change_mark) from item_version_refs where version_id=v.id),'{}'),
      'claimLevel',v.claim,'riskLevel',v.risk,'audience',jsonb_build_object('kind','everyone'),
      'notToConclude',v.not_to_conclude,'replaces','[]'::jsonb,'conflicts',coalesce((select jsonb_agg(other_item_id order by other_item_id) from item_version_conflicts where version_id=v.id),'[]')) ||
      jsonb_strip_nulls(jsonb_build_object('ownerId',v.owner_id,'body',v.body,'summaryMarkup',v.summary_markup,'bodyMarkup',v.body_markup,'claimAuthority',v.claim_authority,'claimQuote',v.claim_quote)) as draft
      from item_version_service s join item_versions v on v.id=s.version_id join items i on i.id=s.item_id
      where s.item_id=$1 and s.editions @> (select seq from live_edition) and cl_audience_allows(v.audience_groups)`,
      [id],
    )
    if (!row) throw new ORPCError('NOT_FOUND')
    // The new draft starts from what the person may read of the item: not a link to a hidden one.
    const [draft] = await forReader(tx, [row.draft])
    return draft!
  }
  async function prepare(input: z.infer<typeof createProposalSchema>) {
    let source: Draft = {}
    let itemId = input.itemId
    if (input.itemId) source = await seedItem(input.itemId)
    if (input.derivedFrom) {
      const prior = await getItem(input.derivedFrom)
      proposerOnly(prior)
      if (prior.state !== 'rejected')
        throw new ORPCError('CONFLICT', {
          message: 'You can start a new draft only from a rejected proposal.',
        })
      if (input.itemId && (prior.action !== 'change' || input.itemId !== prior.itemId))
        throw new ORPCError('CONFLICT', {
          message: 'That proposal is about a different fact.',
        })
      itemId = prior.action === 'change' ? (prior.itemId ?? undefined) : undefined
      source = prior.draft
    }
    const draft = await defaults({ ...source, ...input.draft }, undefined, source.scope)
    const checks = await checkDraft(tx, draft, personId, input.channel ?? 'form', itemId ?? null)
    return { draft, itemId: itemId ?? null, checks }
  }
  /** A rescue's draft and level 1 findings, without storing anything: the Restore dialog's preview. */
  async function prepareRescue(itemId: string, input: Draft) {
    const draft = await defaults(input)
    return { draft, checks: await checkDraft(tx, draft, personId, 'form', itemId) }
  }
  return {
    get,
    getItem,
    prepareRescue,
    /** One proposal as the API returns it to the reader. */
    async read(id: string) {
      const [p] = await forReaders(tx, [await get(id)])
      return p!
    },
    async list(input: z.infer<typeof proposalListSchema>) {
      const limit = input.limit ?? 50
      const offset = input.offset ?? 0
      const [result] = await tx.query<Pick<ProposalListResult, 'rows' | 'total'>>(
        `with matches as materialized (
          select id,created_at from proposals where discarded_at is null
          and ($1::text is null or area_id=$1) and ($2::proposal_state is null or state=$2)
          and (not $3::boolean or proposer_id=cl_person()) and ($6::text is null or item_id=$6)),
        page as (select id,created_at from matches order by created_at desc,id limit $4 offset $5),
        records as (select ${fields} from proposals where id in (select id from page))
        select (select count(*)::int from matches) as total,
          coalesce((select jsonb_agg(records order by page.created_at desc,page.id)
            from records join page on records.id=page.id::text),'[]'::jsonb) as rows`,
        [
          input.areaId ?? null,
          input.state ?? null,
          input.own ?? false,
          limit,
          offset,
          input.itemId ?? null,
        ],
      )
      return {
        rows: await forReaders(tx, (result?.rows ?? []).map(record)),
        total: result?.total ?? 0,
        limit,
        offset,
      }
    },
    /**
     * The draft and level 1 findings a create would store, without storing anything: the import
     * dry run (FR-120) checks each entry exactly as the form's create does.
     */
    prepare,
    async create(
      input: z.infer<typeof createProposalSchema>,
      /**
       * `assisted` records where each field of an assistant's draft came from, on the draft's
       * history, with the label every assistant draft carries until a person submits it (FR-707).
       * `provenance` marks each field of a draft an agent or the assistant wrote (FR-121); only
       * `saveAgentDraft` passes it, never a client.
       */
      options: {
        importBatchId?: string
        assisted?: Record<string, string>
        provenance?: (draft: Draft) => Provenance
        /** The question round whose answers saved it (FR-121); only `saveAgentDraft` passes it. */
        answersRound?: string
      } = {},
    ) {
      const { draft, itemId, checks } = await prepare(input)
      rejectSensitive(draft)
      const channel = input.channel ?? 'form'
      const action = itemId ? 'change' : 'create'
      const reason = changeReason(input.reason, action)
      const [p] = await tx.query<ProposalRecord>(
        `insert into proposals(action,area_id,item_id,proposer_id,channel,draft,draft_saved_at,draft_findings,derived_from,import_batch_id,provenance,answers_round,reason)
        values($1,$2,$3,cl_person(),$4,$5,now(),$6,$7,$8,$9,$10,$11) returning ${fields}`,
        [
          action,
          draft.areaId,
          itemId ?? null,
          channel,
          JSON.stringify(draft),
          JSON.stringify(checks.findings),
          input.derivedFrom ?? null,
          options.importBatchId ?? null,
          options.provenance ? JSON.stringify(options.provenance(draft)) : null,
          options.answersRound ?? null,
          reason,
        ],
      )
      await event(
        p!,
        'created',
        options.assisted
          ? { assistant: { label: 'unreviewed draft', sources: options.assisted } }
          : {},
      )
      return p!
    },
    /**
     * The proposal a rescue opens (FR-814): an administrator restores an item of a deleted domain
     * into another domain, and this proposal carries its last content, fitted to that domain
     * (bin-rescue.ts), to change the retired item. It is created as a draft of the administrator's;
     * the Bin service records the rescue and then submits it, so the domain's owners review it.
     */
    async rescue(itemId: string, input: Draft) {
      const { draft, checks } = await prepareRescue(itemId, input)
      rejectSensitive(draft)
      const [p] = await tx.query<ProposalRecord>(
        `insert into proposals(action,area_id,item_id,proposer_id,channel,draft,draft_saved_at,draft_findings)
        values('change',$1,$2,cl_person(),'form',$3,now(),$4) returning ${fields}`,
        [draft.areaId, itemId, JSON.stringify(draft), JSON.stringify(checks.findings)],
      )
      await event(p!, 'created', { rescue: true })
      return { proposal: p!, checks }
    },
    /** `reason` left out keeps the stored one; null or empty clears it. */
    async save(id: string, revision: number, input: Draft, reasonInput?: string | null) {
      const p = await current(id, revision)
      proposerOnly(p)
      if (!['draft', 'changes_requested'].includes(p.state))
        throw new ORPCError('CONFLICT', {
          message: 'You can only edit a draft, or a proposal sent back for changes.',
        })
      const draft = await defaults(input, p.areaId, p.draft.scope)
      rejectSensitive(draft)
      const reason = reasonInput === undefined ? p.reason : changeReason(reasonInput, p.action)
      const checks = await checkDraft(tx, draft, personId, p.channel, p.itemId)
      // A field the person changed is theirs from now on: it loses the agent's mark (FR-121).
      const provenance = p.provenance ? keepMarks(p.provenance, p.draft, draft) : null
      await tx.query(
        'update proposals set draft=$2,area_id=$3,draft_saved_at=now(),draft_findings=$4,provenance=$5,reason=$6 where id=$1',
        [
          id,
          JSON.stringify(draft),
          draft.areaId,
          JSON.stringify(checks.findings),
          provenance ? JSON.stringify(provenance) : null,
          reason,
        ],
      )
      const saved = await get(id)
      await event(saved, 'saved')
      return saved
    },
    async submit(id: string, revision: number) {
      const p = await current(id, revision)
      proposerOnly(p)
      if (!['draft', 'changes_requested'].includes(p.state))
        throw new ORPCError('CONFLICT', {
          message: 'Only a draft, or a proposal sent back for changes, can be sent for review.',
        })
      // Match edition_lock's key without granting write privileges on the live pointer.
      await tx.query(
        "select pg_advisory_xact_lock_shared(hashtextextended('context_layer.edition',0))",
      )
      const checks = await checkDraft(tx, p.draft, personId, p.channel, p.itemId)
      if (!checks.version || checks.findings.some((f) => f.severity === 'error'))
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: 'Fix the problems shown before you send it for review.',
          data: { findings: checks.findings },
        })
      const v = checks.version
      let item = p.itemId
      let previous = p.itemVersionId
      // A rescue changes a retired item (FR-814): it has no live version, and its first version
      // follows the one the Bin kept.
      const rescue = p.action === 'change' ? await rescueOf(tx, p.id) : null
      if (!item) {
        const [created] = await tx.query<{ id: string }>(
          'insert into items(kind) values($1) returning id',
          [v.kind],
        )
        item = created!.id
      } else {
        const [base] = await tx.query<{ kind: string; id: string }>(
          `select i.kind,v.id from items i join item_version_service s on s.item_id=i.id join item_versions v on v.id=s.version_id
          where i.id=$1 and s.editions @> (select seq from live_edition) and cl_audience_allows(v.audience_groups)`,
          [item],
        )
        // A resubmitted create has no live version yet.
        if (p.action === 'change' && !rescue && (!base || base.kind !== v.kind))
          throw new ORPCError('CONFLICT', {
            message: "The accepted fact is gone, or it's now a different kind.",
          })
        if (rescue && base)
          throw new ORPCError('CONFLICT', {
            message:
              'Agents get this fact again since it was restored, so this proposal is out of date.',
          })
        const [identity] = await tx.query<{ kind: string }>('select kind from items where id=$1', [
          item,
        ])
        if (identity?.kind !== v.kind)
          throw new ORPCError('CONFLICT', { message: "A fact can't change its kind." })
        previous ??= base?.id ?? rescue?.versionId ?? null
      }
      const version = await insertVersion(tx, item, v, previous)
      const [area] = await tx.query<{ review_days: number }>(
        'select review_days from areas where id=$1',
        [p.areaId],
      )
      const due = addWorkingDays(clock.now().toISOString(), area!.review_days)
      await tx.query(
        `update proposals set state='submitted',item_id=$2,item_version_id=$3,submitted_at=now(),due_at=$4,
        claimed_by=null,claimed_at=null,draft_findings=$5 where id=$1`,
        [id, item, version.id, due, JSON.stringify(checks.findings)],
      )
      await tx.query(
        `insert into check_results(item_version_id,level,outcome,inputs_digest,details) values($1,'format',$2,decode($3,'hex'),$4)`,
        [
          version.id,
          formatOutcome(checks.findings),
          version.digest,
          JSON.stringify({ findings: checks.findings }),
        ],
      )
      const submitted = await get(id)
      await event(submitted, 'submitted', { versionId: version.id })
      await event(submitted, 'checked', { level: 'format', findings: checks.findings })
      return submitted
    },
    async claim(id: string, revision: number, recipient?: string) {
      const p = await current(id, revision)
      await owner(p.areaId)
      if (!['submitted', 'in_review'].includes(p.state)) throw new ORPCError('CONFLICT')
      if (p.claimedBy && p.claimedBy !== personId)
        throw new ORPCError('CONFLICT', {
          message: 'Another owner is already reviewing this proposal.',
        })
      if (recipient) {
        if (p.state !== 'in_review' || p.claimedBy !== personId) throw new ORPCError('CONFLICT')
        await owner(p.areaId, recipient)
      }
      await tx.query(
        "update proposals set state='in_review',claimed_by=$2,claimed_at=now() where id=$1",
        [id, recipient ?? personId],
      )
      const claimed = await get(id)
      await event(claimed, recipient ? 'handed_over' : 'claimed', {
        personId: recipient ?? personId,
      })
      return claimed
    },
    /**
     * Claims several proposals for a reviewer of their area, or hands them over to one (FR-211,
     * FR-223): each as Claim and Hand over do it alone, in a savepoint, so one that cannot be
     * assigned is left out and named while the rest go through. Only a new item or a change is
     * claimed; a retirement, a re-check and a term are decided as they come.
     */
    async assignMany(targets: readonly { id: string; revision: number }[], recipient: string) {
      const seen = new Set<string>()
      const assigned: ProposalRecord[] = []
      const skipped: BulkSkip[] = []
      for (const target of targets) {
        if (seen.has(target.id)) continue
        seen.add(target.id)
        const p = await get(target.id).catch(() => null)
        const skip = (code: BulkSkip['code'], message: string) =>
          skipped.push({
            id: target.id,
            number: p?.number ?? null,
            title: p?.title ?? null,
            code,
            message,
          })
        if (!p) {
          skip('not_found', bulkSkipWords.notFound)
          continue
        }
        if (p.subject !== 'item' || !['create', 'change'].includes(p.action)) {
          skip('not_allowed', bulkSkipWords.notClaimed)
          continue
        }
        if (p.revision !== target.revision) {
          skip('changed', bulkSkipWords.changed)
          continue
        }
        if (!['submitted', 'in_review'].includes(p.state)) {
          skip('not_waiting', bulkSkipWords.notWaiting)
          continue
        }
        if (p.claimedBy === recipient) {
          skip('claimed', bulkSkipWords.alreadyTheirs)
          continue
        }
        if (p.claimedBy && p.claimedBy !== personId) {
          skip('claimed', bulkSkipWords.claimed)
          continue
        }
        await tx.query('savepoint bulk_assignment')
        try {
          let current = p.claimedBy ? p : await this.claim(p.id, p.revision)
          if (recipient !== personId)
            current = await this.claim(current.id, current.revision, recipient)
          await tx.query('release savepoint bulk_assignment')
          assigned.push(current)
        } catch (error) {
          await tx.query('rollback to savepoint bulk_assignment')
          if (!(error instanceof ORPCError)) throw error
          skip(
            error.code === 'FORBIDDEN' ? 'forbidden' : 'refused',
            error.code === 'FORBIDDEN' ? bulkSkipWords.assigner : error.message,
          )
        }
      }
      return { proposals: assigned, skipped }
    },
    async withdraw(id: string, revision: number, reason: string) {
      // A proposed term is withdrawn the same way: it never had an item draft to edit.
      const term = await get(id, true).catch(() => null)
      const p =
        term?.subject === 'vocabulary'
          ? term.revision === revision
            ? term
            : conflict(term)
          : await current(id, revision)
      proposerOnly(p)
      if (!['submitted', 'in_review', 'changes_requested'].includes(p.state))
        throw new ORPCError('CONFLICT')
      rejectSensitive(reason)
      rejectMentions(reason)
      await tx.query(
        "update proposals set state='withdrawn',closed_at=now(),reason=$2 where id=$1",
        [id, reason],
      )
      const withdrawn = await get(id)
      await event(withdrawn, 'withdrawn', { reason })
      return withdrawn
    },
    /**
     * The author, or an administrator, discards a draft that was never sent (withdraw is for a
     * sent proposal). The row stays for its timeline and audit entries, and reads as not found.
     */
    async discard(id: string, revision: number) {
      const p = await current(id, revision)
      if (p.proposerId !== personId) {
        const [admin] = await tx.query<{ ok: boolean }>('select cl_is_admin_now() as ok')
        if (!admin?.ok) throw new ORPCError('FORBIDDEN')
      }
      if (p.state !== 'draft')
        throw new ORPCError('CONFLICT', {
          message: 'Only a draft can be discarded. To take back a proposal you sent, withdraw it.',
        })
      const [discarded] = await tx.query<{ revision: number; discardedAt: string }>(
        'update proposals set discarded_at=now() where id=$1 returning revision,discarded_at::text as "discardedAt"',
        [id],
      )
      await event({ ...p, revision: discarded!.revision }, 'discarded')
      return { id, discardedAt: discarded!.discardedAt }
    },
    /**
     * A comment in a proposal's discussion, from its proposer or a reviewer: an owner or
     * approver of its area, or an administrator for a term (which an administrator decides).
     * Any open proposal takes one, whatever it changes: an item, a retirement, a re-check or a
     * term. The text is the small Markdown subset, without mentions.
     */
    async comment(id: string, revision: number, text: string, replyTo?: string) {
      const p = await get(id, true)
      if (p.revision !== revision) conflict(p)
      if (p.proposerId !== personId && !(await reviews(p)))
        throw new ORPCError('FORBIDDEN', {
          message: 'Only the writer and the owners of its domain can comment on a proposal.',
        })
      if (!open.includes(p.state)) throw new ORPCError('CONFLICT')
      rejectSensitive(text)
      rejectMentions(text)
      if (
        replyTo &&
        !(
          await tx.query(
            "select 1 from proposal_events where id=$1 and proposal_id=$2 and kind='commented'",
            [replyTo, id],
          )
        ).length
      )
        throw new ORPCError('NOT_FOUND')
      await tx.query('update proposals set revision=revision+1 where id=$1', [id])
      const updated = await get(id)
      await event(updated, 'commented', { text, ...(replyTo ? { replyTo } : {}) })
      return updated
    },
    async events(id: string) {
      await get(id)
      const rows = await tx.query<{
        id: string
        at: string
        actorId: string | null
        kind: string
        data: Record<string, unknown>
      }>(
        `select id::text,at::text,actor_id::text as "actorId",kind,data from proposal_events where proposal_id=$1 order by at,id`,
        [id],
      )
      return rows.map((row) => ({ ...row, data: eventData(row.data) }))
    },
    /** FR-524: the test questions attached to the proposal's check. */
    async tests(id: string) {
      await getItem(id)
      return attachedTests(tx, id)
    },
    /**
     * FR-524: attaches a test question of the proposal's area to its check, reported with the
     * change and never blocking it. A held-out question is never attached (FR-503), and is not
     * found for anyone but its area's maintainers. Attaching it again changes nothing.
     */
    async attachTest(id: string, question: string) {
      const p = await attachable(id)
      const [found] = await tx.query<{
        area: string
        heldOut: boolean
        active: boolean
        readable: boolean
      }>(
        `select area_id as area, split = 'held_out' as "heldOut", status = 'active' as active,
                split = 'development' or cl_is_admin_now() or cl_is_owner_now(area_id) as readable
           from golden_questions where id = $1`,
        [question],
      )
      if (!found?.readable)
        throw new ORPCError('NOT_FOUND', {
          message: "We couldn't find this test question, or you can't see it.",
        })
      if (found.heldOut)
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: "A hidden test question can't be attached to a proposal.",
        })
      if (found.area !== p.areaId)
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: 'This test question belongs to another domain than the proposal.',
        })
      if (!found.active)
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: 'Only an active test question can be attached.',
        })
      const attached = await tx.query(
        `insert into proposal_tests (proposal_id, question_id) values ($1, $2)
         on conflict (proposal_id, question_id) do nothing returning question_id`,
        [id, question],
      )
      if (attached.length) await audit(p, 'proposal.test_attached', { question })
      return attachedTests(tx, id)
    },
    /** Detaches a test question; detaching one that is not attached changes nothing. */
    async detachTest(id: string, question: string) {
      const p = await attachable(id)
      const detached = await tx.query(
        'delete from proposal_tests where proposal_id = $1 and question_id = $2 returning question_id',
        [id, question],
      )
      if (detached.length) await audit(p, 'proposal.test_detached', { question })
      return attachedTests(tx, id)
    },
    /**
     * Before an agent's draft is saved (FR-121): the accepted items whose scope and dates overlap
     * it (FR-109) or whose title or summary reads like it (a trigram score from 0 to 1), and the
     * person's own open proposals that overlap it. Nothing about other people's proposals.
     */
    async matches(draft: Draft, itemId: string | null) {
      const accepted = await tx.query<{
        id: string
        title: string
        kind: ItemKind
        overlaps: boolean
        score: number | null
      }>(
        `with alike as (select item_id,score from cl_similar_items($3,$4))
         select v.item_id as id,v.title,v.kind::text as kind,
           coalesce(cl_scopes_overlap($1::jsonb,${servedScope}),false) as overlaps,s.score::float8 as score
         from serving_items((select seq from live_edition)) v left join alike s on s.item_id=v.item_id
         where cl_audience_allows(v.audience_groups) and v.item_id is distinct from $2
           and (s.item_id is not null or coalesce(cl_scopes_overlap($1::jsonb,${servedScope}),false))
         order by s.score desc nulls last,v.item_id limit 20`,
        [JSON.stringify(draft), itemId, draft.title ?? null, draft.summary ?? null],
      )
      const own = await tx.query<Overlapping>(
        `select p.id::text,p.number::float8 as number,coalesce(v.title,p.draft->>'title','Untitled proposal') as title,
           coalesce(i.kind::text,p.draft->>'kind','note') as kind,p.state::text as state
         from proposals p left join item_versions v on v.id=p.item_version_id left join items i on i.id=p.item_id
         where p.proposer_id=cl_person() and p.subject='item' and p.action in ('create','change') and p.discarded_at is null
           and p.state in ('draft','submitted','in_review','changes_requested') and coalesce(cl_scopes_overlap($1::jsonb,p.draft),false)
         order by p.number limit 20`,
        [JSON.stringify(draft)],
      )
      return { accepted, ownProposals: own }
    },
    /**
     * Duplicates and conflicts (FR-109, FR-209): accepted items and open proposals whose scope
     * and dates overlap. Other people's proposals are listed only where row security lets the
     * person read them, as a reviewer of their area or an administrator; anyone else learns only
     * that one exists.
     */
    async overlap(id: string) {
      const p = await getItem(id)
      const accepted = await acceptedOverlaps(tx, p.draft, p.itemId)
      const proposals = await tx.query<Overlapping & { own: boolean }>(
        `select p.id::text,p.number::float8 as number,coalesce(v.title,p.draft->>'title','Untitled proposal') as title,
           coalesce(i.kind::text,p.draft->>'kind','note') as kind,p.state::text as state,p.proposer_id=cl_person() as own
         from proposals p left join item_versions v on v.id=p.item_version_id left join items i on i.id=p.item_id
         where p.id<>$1 and p.subject='item' and p.action in ('create','change') and p.discarded_at is null
           and p.state in ('draft','submitted','in_review','changes_requested') and cl_scopes_overlap($2::jsonb,p.draft)
         order by p.number`,
        [id, JSON.stringify(p.draft)],
      )
      const [other] = await tx.query<{ exists: boolean }>(
        'select cl_other_proposal_overlap($1) as exists',
        [id],
      )
      const listed = ({ own: _own, ...row }: Overlapping & { own: boolean }) => row
      return {
        accepted,
        ownProposals: proposals.filter((row) => row.own).map(listed),
        // A draft stays with its writer until it is sent.
        otherProposals: proposals.filter((row) => !row.own && row.state !== 'draft').map(listed),
        otherProposalExists: other!.exists,
      }
    },
  }
}

export type ProposalsService = ReturnType<typeof createProposalsService>
