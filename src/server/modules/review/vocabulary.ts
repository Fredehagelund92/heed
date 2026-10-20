import { ORPCError } from '@orpc/client'
import { contentDigest } from '../../../domain/canonical.ts'
import {
  addWorkingDays,
  vocabularyFindings,
  type VocabularyChange,
  type VocabularyContext,
} from '../../../domain/review.ts'
import type { FormatFinding } from '../../../domain/draft.ts'
import {
  termCandidates,
  type CandidateMember,
  type KnownTerm,
} from '../../../domain/term-candidates.ts'
import { termDigestContent, type Term } from '../../../domain/vocabulary.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { connectorType } from '../connectors/index.ts'
import { loadProposals, proposalEvents, publicRecord } from './records.ts'

type TermRow = Term & { versionId: string }

/** The definitions a term version names, as a sorted array: `version` is the SQL of its id. */
export const termRefs = (version: string) =>
  `coalesce((select array_agg(r.definition_ref order by r.definition_ref collate "C") from vocab_term_refs r where r.version_id=${version}),'{}')`

/**
 * What the vocabulary checks read, read once for a whole step however many terms it holds (a
 * batch of a source's members is hundreds): the live vocabulary, the stored definitions, the
 * active areas with their review time, and the fixed identity of each term the step names.
 */
export type VocabularyBase = {
  live: readonly TermRow[]
  definitions: VocabularyContext['definitions']
  areas: ReadonlyMap<string, { name: string; reviewDays: number }>
  identities: ReadonlyMap<string, NonNullable<VocabularyContext['existing']>>
}

export async function vocabularyBase(
  tx: Queryable,
  keys: readonly string[],
): Promise<VocabularyBase> {
  const live = await tx.query<TermRow>(
    `select s.term_key as key,t.kind::text as kind,t.parent_key as "parentKey",v.name,v.aliases,
            v.area_id as "areaId",${termRefs('v.id')} as "definitionRefs",v.id::text as "versionId"
       from vocab_term_service s join vocab_term_versions v on v.id=s.version_id
       join vocab_terms t on t.key=s.term_key where s.editions @> (select seq from live_edition)`,
  )
  const identities = await tx.query<{
    key: string
    kind: Term['kind']
    parentKey: string | null
  }>(
    'select key,kind::text as kind,parent_key as "parentKey" from vocab_terms where key=any($1::text[])',
    [keys],
  )
  const definitions = await tx.query<{
    ref: string
    kind: 'metric' | 'dimension' | 'group'
    missing: boolean
    areaHint: string | null
  }>(
    `select ref,kind::text as kind,missing_since_snapshot is not null as missing,area_hint as "areaHint" from definitions`,
  )
  const areas = await tx.query<{ id: string; name: string; reviewDays: number }>(
    'select id,name,review_days as "reviewDays" from areas where archived_at is null',
  )
  return {
    live,
    identities: new Map(identities.map(({ key, ...identity }) => [key, identity])),
    definitions: new Map(definitions.map(({ ref, ...d }) => [ref, d])),
    areas: new Map(areas.map(({ id, ...area }) => [id, area])),
  }
}

/**
 * The context the checks read for one term: the live vocabulary with `pending`, the terms of the
 * same step before it, read as if they were live (a batch). `current` is the live term itself.
 */
export function contextFor(base: VocabularyBase, key: string, pending: readonly Term[] = []) {
  const context: VocabularyContext = {
    live: pending.length ? [...base.live, ...pending] : base.live,
    existing: base.identities.get(key) ?? null,
    definitions: base.definitions,
    areas: new Map([...base.areas].map(([id, area]) => [id, area.name])),
  }
  return { context, current: base.live.find((t) => t.key === key) ?? null }
}

/** The live vocabulary, the term's fixed identity, the stored definitions and the areas. */
export async function vocabularyContext(tx: Queryable, key: string) {
  return contextFor(await vocabularyBase(tx, [key]), key)
}

export const termOf = ({ versionId: _v, ...term }: TermRow): Term => term

/** One version of a term, live or not; null when there is none by that id. */
export async function termVersion(tx: Queryable, id: string | null): Promise<Term | null> {
  if (!id) return null
  const [row] = await tx.query<TermRow>(
    `select t.key,t.kind::text as kind,t.parent_key as "parentKey",v.name,v.aliases,
            v.area_id as "areaId",${termRefs('v.id')} as "definitionRefs",v.id::text as "versionId"
       from vocab_term_versions v join vocab_terms t on t.key=v.term_key where v.id=$1`,
    [id],
  )
  return row ? termOf(row) : null
}

/**
 * Maps each term the step names to one of 64 lock buckets and takes each distinct bucket's lock
 * once, in ascending bucket order, so two steps naming the same term wait for each other instead
 * of each holding half, and a step holds at most 64 locks whatever its size.
 */
async function lockTerms(tx: Queryable, keys: readonly string[]) {
  await tx.query(
    `select pg_advisory_xact_lock(hashtextextended('heed.vocabulary.bucket:' || bucket, 0))
       from (
         select distinct abs(hashtextextended('heed.vocabulary:' || k, 0) % 64) as bucket
           from unnest($1::text[]) k
          order by bucket
          offset 0
       ) buckets`,
    [[...new Set(keys)]],
  )
}

/** Each term's findings, the terms before it in `changes` read as live (a batch, in its order). */
function findingsTogether(base: VocabularyBase, changes: readonly VocabularyChange[]) {
  const pending: Term[] = []
  return changes.map((change) => {
    const findings = vocabularyFindings(change, contextFor(base, change.key, pending).context)
    pending.push({ ...change })
    return findings
  })
}

const refused = (findings: readonly FormatFinding[]) =>
  new ORPCError('UNPROCESSABLE_CONTENT', {
    message: 'Fix the problems with this name first.',
    data: { findings },
  })

/**
 * Stores checked terms as submitted proposals, one each, in their order: their identities, their
 * new versions, the proposals and their timeline, a fixed handful of statements for any number of
 * terms. The caller has taken the terms' locks and checked them against `base`.
 */
async function submitTerms(
  tx: Queryable,
  clock: Clock,
  base: VocabularyBase,
  changes: readonly VocabularyChange[],
  findings: readonly (readonly FormatFinding[])[],
  importBatchId: string | null,
) {
  const now = clock.now().toISOString()
  const rows = JSON.stringify(
    await Promise.all(
      changes.map(async (change, index) => {
        const area = change.areaId ? base.areas.get(change.areaId) : undefined
        const current = base.live.find((t) => t.key === change.key) ?? null
        return {
          ...change,
          digest: await contentDigest(termDigestContent(change)),
          action: current ? 'change' : 'create',
          draft: { ...change, base: current?.versionId ?? null },
          findings: findings[index],
          dueAt: area ? addWorkingDays(now, area.reviewDays) : null,
        }
      }),
    ),
  )
  const each = 'from jsonb_array_elements($1::jsonb) with ordinality as e(row, n)'
  await tx.query(
    `insert into vocab_terms(key,kind,parent_key)
     select row->>'key',(row->>'kind')::term_kind,row->>'parentKey' ${each} order by n
     on conflict (key) do nothing`,
    [rows],
  )
  const versions = await tx.query<{ id: string; key: string }>(
    `insert into vocab_term_versions(term_key,version_no,name,aliases,area_id,proposer_id,content_digest)
     select row->>'key',
            (select coalesce(max(version_no),0)+1 from vocab_term_versions where term_key=row->>'key'),
            row->>'name',array(select jsonb_array_elements_text(row->'aliases')),row->>'areaId',
            cl_person(),decode(row->>'digest','hex')
       ${each} order by n
     returning id::text,term_key as key`,
    [rows],
  )
  const versionOf = new Map(versions.map((version) => [version.key, version.id]))
  // Each version's definitions: a metric's one, or every view's member of a dimension (CON-208).
  await tx.query(
    `insert into vocab_term_refs(version_id,definition_ref)
     select (($2::jsonb)->>(row->>'key'))::uuid,jsonb_array_elements_text(row->'definitionRefs') ${each}`,
    [rows, JSON.stringify(Object.fromEntries(versionOf))],
  )
  const inserted = await tx.query<{ id: string; versionId: string }>(
    `insert into proposals(subject,action,state,area_id,proposer_id,channel,vocab_version_id,draft,draft_findings,submitted_at,due_at,import_batch_id)
     select 'vocabulary',(row->>'action')::proposal_action,'submitted',row->>'areaId',cl_person(),$3::creation_channel,
            (($2::jsonb)->>(row->>'key'))::uuid,row->'draft',row->'findings',now(),(row->>'dueAt')::timestamptz,$4::uuid
       ${each} order by n
     returning id::text,vocab_version_id::text as "versionId"`,
    [
      rows,
      JSON.stringify(Object.fromEntries(versionOf)),
      importBatchId ? 'import' : 'form',
      importBatchId,
    ],
  )
  const proposalOf = new Map(inserted.map((row) => [row.versionId, row.id]))
  const proposals = await loadProposals(
    tx,
    changes.map((change) => proposalOf.get(versionOf.get(change.key)!)!),
  )
  await proposalEvents(
    tx,
    proposals.map((p) => ({ p, kind: 'submitted', data: { versionId: p.vocabularyVersionId } })),
  )
  return proposals.map(publicRecord)
}

/**
 * A vocabulary change is a submitted proposal holding a new term version (FR-125). It enters
 * service only through a decision and an edition, like an item.
 */
export async function proposeTerm(tx: Queryable, clock: Clock, change: VocabularyChange) {
  await lockTerms(tx, [change.key])
  const base = await vocabularyBase(tx, [change.key])
  const [findings] = findingsTogether(base, [change])
  if (findings!.some((f) => f.severity === 'error')) throw refused(findings!)
  const [proposal] = await submitTerms(tx, clock, base, [change], [findings!], null)
  return proposal!
}

/** Groups, then metrics and dimensions, then values: a parent comes before what it holds. */
const kindOrder: Record<Term['kind'], number> = {
  metric_group: 0,
  metric: 1,
  dimension: 1,
  dimension_value: 2,
}

/**
 * Proposes many terms in one step (an administrator turning the source's members and a pasted
 * list of values into vocabulary): one proposal per term, all in one batch, all or none. A term
 * may name a parent proposed in the same step. Nothing is accepted here: each term still needs a
 * decision, and `decideTermBatch` accepts the batch's open terms as one edition. The vocabulary is
 * read once for the whole step, and its terms are stored together.
 */
export async function proposeTerms(
  tx: Queryable,
  clock: Clock,
  input: { terms: readonly VocabularyChange[]; sourceName?: string | undefined },
) {
  const terms = input.terms
    .map((term, index) => ({ term, index }))
    .sort((a, b) => kindOrder[a.term.kind] - kindOrder[b.term.kind] || a.index - b.index)
  const changes = terms.map(({ term }) => term)
  await lockTerms(
    tx,
    changes.map((change) => change.key),
  )
  const base = await vocabularyBase(
    tx,
    changes.map((change) => change.key),
  )
  const each = findingsTogether(base, changes)
  const findings: FormatFinding[] = []
  const seen = new Set<string>()
  terms.forEach(({ term, index }, at) => {
    const named = (finding: FormatFinding): FormatFinding => ({
      ...finding,
      field: `terms.${index}.${finding.field}`,
      message: `${term.name}: ${finding.message}`,
    })
    if (seen.has(term.key))
      findings.push(
        named({
          code: 'duplicate_key',
          field: 'key',
          message: `You proposed ${term.key} twice.`,
          severity: 'error',
        }),
      )
    seen.add(term.key)
    findings.push(...each[at]!.map(named))
  })
  if (findings.some((f) => f.severity === 'error')) throw refused(findings)
  const [batch] = await tx.query<{ id: string }>(
    `insert into import_batches(created_by,mode,source_name,summary) values(cl_person(),'apply',$1,$2)
     returning id::text`,
    [
      input.sourceName ?? 'Vocabulary terms',
      JSON.stringify({ subject: 'vocabulary', terms: terms.length }),
    ],
  )
  const proposals = await submitTerms(tx, clock, base, changes, each, batch!.id)
  return { batchId: batch!.id, proposals }
}

/**
 * The current members of the definition sources, the live terms, and the terms of the open
 * vocabulary proposals the reader may read (row security: an administrator reads them all). With
 * `everyone`, only the members whose source shows them to every reader: a member its source
 * limits to some groups is left out, as serving leaves its definition out (groups are parked).
 */
async function sourceVocabulary(tx: Queryable, everyone = false) {
  const members = await tx.query<CandidateMember>(
    `select ref,connector_id as source,kind::text as kind,name,title,description_copy as description,
            value_type as "valueType",area_hint as "areaHint",synonyms,base_name as "baseName"
       from definitions where missing_since_snapshot is null${everyone ? ' and visible_groups is null' : ''}`,
  )
  const known = await tx.query<KnownTerm>(
    `select s.term_key as key,t.kind::text as kind,v.name,v.aliases,v.area_id as "areaId",
            ${termRefs('v.id')} as "definitionRefs",false as open
       from vocab_term_service s join vocab_term_versions v on v.id=s.version_id
       join vocab_terms t on t.key=s.term_key where s.editions @> (select seq from live_edition)
     union all
     select tv.term_key,t.kind::text,tv.name,tv.aliases,tv.area_id,${termRefs('tv.id')},true
       from proposals p join vocab_term_versions tv on tv.id=p.vocab_version_id
       join vocab_terms t on t.key=tv.term_key
      where p.subject='vocabulary' and p.state in ('submitted','in_review')`,
  )
  return { members, known }
}

/** The members of the definition sources no term or open proposal links yet, as terms to propose. */
export async function candidateTerms(tx: Queryable) {
  const { members, known } = await sourceVocabulary(tx)
  return termCandidates(members, known)
}

/** A member of a definition source that a domain has and Heed's vocabulary does not yet. */
export type WaitingMember = {
  areaId: string
  kind: 'metric' | 'dimension'
  /** The name the term would take ("Avg rank"). */
  name: string
  /** The source that reads it, by id, and the tool it comes from ("Cube"). */
  source: string
  tool: string
  /**
   * An open proposal the reader may read makes it a term, waiting for review. A reader who is no
   * administrator reads only their own proposals, so a member someone else proposed reads as
   * not proposed to them; the next step they are told, that an administrator proposes it, holds.
   */
  proposed: boolean
}

/**
 * The members of the definition sources that belong to a domain and are no vocabulary term yet,
 * as the candidates an administrator would propose (`termCandidates`): never a date or an id,
 * which items do not need, and never a dimension several domains share, which belongs to none.
 * Each says whether an open proposal already makes it a term. People are told of them so a
 * domain's metrics are never said to be missing when its source has them (the captain's pilot).
 * Only members every reader may see are named: never one its source limits to some groups.
 */
export async function waitingMembers(tx: Queryable): Promise<WaitingMember[]> {
  const { members, known } = await sourceVocabulary(tx, true)
  const sources = await tx.query<{ id: string; type: string; name: string }>(
    'select id,type,name from connectors',
  )
  const tool = (id: string) => {
    const source = sources.find((s) => s.id === id)
    return source ? connectorType(source.type, source.name).tool : id
  }
  // The members no open proposal links yet: the candidates against live and open terms alike.
  const unproposed = new Set(
    termCandidates(members, known).flatMap((candidate) => candidate.definitionRefs),
  )
  // A candidate that links more members to a live dimension is a term already, never missing.
  return termCandidates(
    members,
    known.filter((term) => !term.open),
  ).flatMap((candidate) =>
    candidate.suggested && candidate.areaId && !candidate.linked.length
      ? [
          {
            areaId: candidate.areaId,
            kind: candidate.kind,
            name: candidate.name,
            source: candidate.source,
            tool: tool(candidate.source),
            proposed: !candidate.definitionRefs.some((ref) => unproposed.has(ref)),
          },
        ]
      : [],
  )
}
