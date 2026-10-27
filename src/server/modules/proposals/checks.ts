import { type Draft, type FormatFinding, formatDraft } from '../../../domain/draft.ts'
import type { ItemVersion } from '../../../domain/item-version.ts'
import { mentionsInFields, parseMentions } from '../../../domain/mentions.ts'
import { relevantRefs } from '../../../domain/vocabulary.ts'
import type { Queryable } from '../../db/database.ts'

type LiveTerm = {
  key: string
  kind: string
  name: string
  definition_refs: string[]
  area_id: string | null
}
type Definition = {
  ref: string
  kind: 'metric' | 'dimension' | 'group'
  missing: boolean
  area_hint: string | null
  change_mark: string
  name: string
}
/** What level 1 checks a draft against, by key. */
type FormatReference = {
  /** The live edition's terms. */
  known: Map<string, LiveTerm>
  /** Every definition the sources hold. */
  defs: Map<string, Definition>
  /** People read the term's name, or Cube's title for a definition no term names, never a ref. */
  termNames: Map<string, string>
  areaNames: Map<string, string>
  limit: number
}

/**
 * The reference of a transaction, kept for its live edition: an import or a bulk decision checks
 * many drafts against the same terms and definitions, which at 2,000 terms take a quarter of a
 * second to read. Nothing changes a reference once it is built.
 */
const references = new WeakMap<Queryable, { seq: string | null; reference: FormatReference }>()

/**
 * The live terms, every definition, the domains' names and the mention limit, in one statement.
 * The live edition's number comes first: when it is the one a reference of this transaction was
 * built for, the rest is not read (a CASE never runs the subqueries of a branch it does not take).
 */
async function formatReference(tx: Queryable): Promise<FormatReference> {
  const held = references.get(tx)
  const [row] = await tx.query<{
    seq: string | null
    terms: LiveTerm[] | null
    definitions: Definition[] | null
    areas: { id: string; name: string }[] | null
    limit: number | null
  }>(
    `with live as (select (select seq::text from live_edition) as seq),
     fresh as (select seq, held is null or seq is distinct from held as read
                 from live, (select $1::text as held) h)
     select seq,
       case when read then (select coalesce(json_agg(json_build_object('key', t.key, 'kind', t.kind,
                 'name', t.name, 'definition_refs', t.definition_refs, 'area_id', t.area_id)), '[]')
          from serving_vocabulary((select seq from live_edition)) t) end as terms,
       case when read then (select coalesce(json_agg(json_build_object('ref', d.ref, 'kind', d.kind,
                 'missing', d.missing_since_snapshot is not null, 'area_hint', d.area_hint,
                 'change_mark', d.change_mark, 'name', coalesce(d.title, d.name))), '[]')
          from definitions d) end as definitions,
       case when read then (select coalesce(json_agg(json_build_object('id', a.id, 'name', a.name)), '[]')
          from areas a) end as areas,
       (select least(50,greatest(0,value::int)) from settings_current
         where key='limits.mentions_per_version') as limit
     from fresh`,
    [held ? (held.seq ?? '') : null],
  )
  if (held && held.seq === row!.seq && row!.terms === null) return held.reference
  const terms = row!.terms ?? []
  const reference: FormatReference = {
    known: new Map(terms.map((t) => [t.key, t])),
    defs: new Map((row!.definitions ?? []).map((d) => [d.ref, d])),
    termNames: new Map(
      terms.flatMap((t) => t.definition_refs.map((ref) => [ref, t.name] as const)),
    ),
    areaNames: new Map((row!.areas ?? []).map((a) => [a.id, a.name])),
    limit: row!.limit ?? 50,
  }
  references.set(tx, { seq: row!.seq, reference })
  return reference
}

export async function checkDraft(
  tx: Queryable,
  draft: Draft,
  proposer: string | null,
  channel: ItemVersion['createdVia'],
  itemId: string | null,
) {
  const result = formatDraft(draft, proposer, channel)
  const add = (
    code: string,
    field: string,
    message: string,
    severity: FormatFinding['severity'] = 'error',
  ) => result.findings.push({ code, field, message, severity })
  const { known, defs, termNames, areaNames, limit } = await formatReference(tx)
  if (mentionsInFields(draft).length > limit)
    add('mention_limit', 'summaryMarkup', `You can add at most ${limit} mentions.`)
  // A term's definitions that matter to this item: of a dimension in several views, those in the
  // views of the item's metrics (CON-209).
  const metricRefs = (draft.scope?.metrics ?? []).flatMap(
    (key) => known.get(key)?.definition_refs ?? [],
  )
  const sourceMissing = (term: LiveTerm) =>
    relevantRefs(term.definition_refs, metricRefs).some(
      (ref) => !defs.has(ref) || defs.get(ref)?.missing,
    )
  for (const key of draft.scope?.dimensions ?? []) {
    const term = known.get(key)
    if (term && term.kind !== 'dimension')
      add(
        'unknown_scope',
        'scope',
        `"Any" works for a market, a product or a brand, not for ${term.name}.`,
      )
    // FR-505: a dimension with any value is broad, so the reviewer is told; it never blocks.
    else if (term)
      add(
        'broad_scope',
        'scope',
        `Broad: it applies to all of ${term.name}, so agents get it for any question about ${term.name}.`,
        'warning',
      )
  }
  for (const key of [
    ...(draft.scope?.metrics ?? []),
    ...(draft.scope?.dimensions ?? []),
    ...(draft.scope?.dimensionValues.flatMap((v) => [v.dimension, v.value]) ?? []),
  ]) {
    const term = known.get(key)
    if (!term)
      add('unknown_scope', 'scope', `We don't know the name ${key}. Choose one from the list.`)
    else if (sourceMissing(term))
      add(
        'source_missing',
        'scope',
        `The definition of ${term.name} is missing from its source.`,
        'warning',
      )
  }
  for (const ref of draft.references ?? []) {
    const definition = defs.get(ref)
    if (!definition) add('unknown_definition', 'references', `We don't know the definition ${ref}.`)
    else if (definition.missing)
      add(
        'source_missing',
        'references',
        `The definition ${ref} is missing from its source.`,
        'warning',
      )
    else {
      if (draft.changeMarks?.[ref] !== definition.change_mark)
        add(
          'source_changed',
          'changeMarks',
          `The definition ${ref} changed. Check that the fact still holds.`,
          'warning',
        )
      // Only a metric belongs to a domain: a dimension such as market is in every view.
      if (
        definition.kind === 'metric' &&
        definition.area_hint &&
        definition.area_hint !== draft.areaId
      )
        add(
          'domain_mismatch',
          'areaId',
          `Cube puts ${termNames.get(ref) ?? definition.name} in ${areaNames.get(definition.area_hint) ?? definition.area_hint}`,
          'warning',
        )
    }
  }
  for (const field of ['summary', 'body'] as const) {
    const markup = field === 'summary' ? draft.summaryMarkup : draft.bodyMarkup
    if (markup === undefined) continue
    const parsed = parseMentions(markup)
    if (parsed.errors.length)
      add('mention_syntax', field, "A mention isn't written right. Remove it, then add it again.")
    for (const mention of parsed.mentions) {
      const target = mention.target
      if (target === `item:${itemId}`) add('self_mention', field, "A fact can't mention itself.")
      else if (target.startsWith('item:')) {
        const rows = await tx.query(
          'select 1 from item_version_service s join item_versions v on v.id=s.version_id where s.item_id=$1 and s.editions @> (select seq from live_edition) and cl_audience_allows(v.audience_groups)',
          [target.slice(5)],
        )
        if (!rows.length)
          add('mention_target', field, "A fact you mention isn't accepted, or you can't see it.")
      } else if (target.startsWith('area:')) {
        if (
          !(
            await tx.query('select 1 from areas where id=$1 and archived_at is null', [
              target.slice(5),
            ])
          ).length
        )
          add('mention_target', field, `We couldn't find the domain ${target.slice(5)}.`)
      } else {
        const term = known.get(target)
        if (!term) add('mention_target', field, `We don't know the name ${target}.`)
        else if (sourceMissing(term))
          add(
            'mention_source_missing',
            field,
            `The definition of ${term.name} is missing from its source.`,
          )
      }
    }
  }
  for (const target of [...(draft.replaces ?? []), ...(draft.conflicts ?? [])]) {
    if (
      target === itemId ||
      !(
        await tx.query(
          'select 1 from item_version_service s join item_versions v on v.id=s.version_id where s.item_id=$1 and s.editions @> (select seq from live_edition) and cl_audience_allows(v.audience_groups)',
          [target],
        )
      ).length
    )
      add('item_reference', 'replaces', 'Name another accepted fact.')
  }
  if (
    draft.ownerId &&
    !(
      await tx.query(
        `select 1 from area_assignments a join people p on p.id=a.person_id where a.area_id=$1 and a.person_id=$2 and a.role='owner' and a.valid_at @> now() and p.deactivated_at is null and p.erased_at is null`,
        [draft.areaId, draft.ownerId],
      )
    ).length
  )
    add('owner', 'ownerId', 'Choose an active owner of this domain.')
  return result
}
