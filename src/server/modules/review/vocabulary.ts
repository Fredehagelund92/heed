import {
  termCandidates,
  type CandidateMember,
  type KnownTerm,
} from '../../../domain/term-candidates.ts'
import type { AuditMembers } from '../../../domain/audit.ts'
import type { Queryable } from '../../db/database.ts'
import { connectorType } from '../connectors/index.ts'

/** The definitions a term version names, as a sorted array: `version` is the SQL of its id. */
export const termRefs = (version: string) =>
  `coalesce((select array_agg(r.definition_ref order by r.definition_ref collate "C") from vocab_term_refs r where r.version_id=${version}),'{}')`

/**
 * The current members of the definition sources, the live terms, and the terms of the open
 * vocabulary proposals the reader may read (row security: an administrator reads them all). With
 * `everyone`, only the members whose source shows them to every reader: a member its source
 * limits to some groups is left out, as serving leaves its definition out (groups are parked).
 */
export async function sourceVocabulary(tx: Queryable, everyone = false) {
  const rows = await tx.query<CandidateMember & { type: string | null; sourceName: string | null }>(
    `select d.ref,d.connector_id as source,d.kind::text as kind,d.name,d.title,
            d.description_copy as description,d.value_type as "valueType",d.area_hint as "areaHint",
            d.synonyms,d.base_name as "baseName",c.type,c.name as "sourceName"
       from definitions d left join connectors c on c.id=d.connector_id
      where d.missing_since_snapshot is null and (c.id is null or c.removed_at is null)
        and c.type is distinct from 'demo'
        ${everyone ? 'and d.visible_groups is null' : ''}`,
  )
  // Whether a source's same-named dimensions are one is its connector's to say (CON-201).
  const members = rows.map(({ type, sourceName, ...member }): CandidateMember => ({
    ...member,
    mergeDimensions:
      type === null ? 'by-name' : connectorType(type, sourceName ?? member.source).mergeDimensions,
  }))
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

/**
 * What the sources list that no live term names (FR-720), for an analysis of what may be missing:
 * how many members they list, and each one no term links, a date or an id marked as left out on
 * purpose. Only members every reader may see are counted.
 */
export async function unlinkedMembers(tx: Queryable): Promise<AuditMembers> {
  const { members, known } = await sourceVocabulary(tx, true)
  const candidates = termCandidates(
    members,
    known.filter((term) => !term.open),
  ).filter((candidate) => !candidate.linked.length)
  return {
    total: members.length,
    unlinked: candidates.map((c) => ({
      name: c.name,
      valueType: c.valueType,
      suggested: c.suggested,
    })),
  }
}

/** A member of a definition source that a domain has and Heed's vocabulary does not yet. */
export type WaitingMember = {
  areaId: string
  kind: 'metric' | 'dimension'
  /** The name the term would take ("Avg rank"). */
  name: string
  /** The tool it comes from ("Cube"). */
  tool: string
}

/**
 * The members of the definition sources that belong to a domain and are no vocabulary term yet,
 * as the names a read made wait for an owner (`termCandidates`, FR-141): never a date or an id,
 * which items do not need, and never a dimension several domains share, which belongs to none.
 * People are told of them so a domain's metrics are never said to be missing when its source has
 * them. Only members every reader may see are named: never one its source limits to some groups.
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
  const left = new Set(
    (await tx.query<{ ref: string }>('select definition_ref as ref from names_left_out')).map(
      (row) => row.ref,
    ),
  )
  // A candidate that links more members to a live dimension is a term already, never missing, and
  // a name an owner left out is no longer waiting.
  return termCandidates(
    members,
    known.filter((term) => !term.open),
  ).flatMap((candidate) =>
    candidate.suggested &&
    candidate.areaId &&
    !candidate.linked.length &&
    !candidate.definitionRefs.every((ref) => left.has(ref))
      ? [
          {
            areaId: candidate.areaId,
            kind: candidate.kind,
            name: candidate.name,
            tool: tool(candidate.source),
          },
        ]
      : [],
  )
}
