import {
  termCandidates,
  type CandidateMember,
  type KnownTerm,
} from '../../../domain/term-candidates.ts'
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
