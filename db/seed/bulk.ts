import { createHash, randomUUID } from 'node:crypto'
import type pg from 'pg'
import { versionDays, type VersionDays } from '../../src/web/mocks/items.ts'
import { addDays } from '../../src/web/mocks/random.ts'
import { areas, people, roleGrants, vocabulary } from '../../src/web/mocks/reference-data.ts'
import {
  DEMO_FIRST_READ_AT,
  DEMO_MODEL_URL,
  DEMO_READ_AT,
  DEMO_SOURCE_VERSION,
  changedDefinitions,
  definitionRefsOf,
  demoDefinitions,
  demoWarnings,
  termAreas,
} from '../../src/web/mocks/cube-model.ts'
import { contentDigest } from '../../src/domain/canonical.ts'
import type { ContextItem } from '../../src/domain/item.ts'
import { itemVersionDigests } from '../../src/domain/item-version.ts'
import { mentionsInFields } from '../../src/domain/mentions.ts'
import { identifier } from '../../src/server/db/roles.ts'
import { termDigestContent, type Term } from '../../src/domain/vocabulary.ts'
import { readVersions } from '../../src/server/modules/proposals/index.ts'

const bytes = (hex: string) => '\\x' + hex
/** A dimension with more values than this has them added in a vocabulary edition of their own. */
const IMPORTED_VALUES = 100
const placeholder = '0'.repeat(64)
export function seedPersonId(id: string) {
  const hex = createHash('sha256').update(id).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

async function insert(client: pg.Client, table: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return
  const columns = Object.keys(rows[0]!).map(identifier).join(',')
  await client.query(
    `insert into ${identifier(table)} (${columns}) select ${columns}
    from jsonb_populate_recordset(null::${identifier(table)},$1::jsonb)`,
    [JSON.stringify(rows)],
  )
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const at = (day: string, time: string) => `${day}T${time}:00Z`

/**
 * Roles people held during the seeded history and no longer hold, so today's roster stays the
 * mock's. The fixtures have owners propose normal and high risk items in areas with one owner,
 * and high risk items in areas without an approver; someone else accepted those (FR-206, FR-207).
 * Two approvers per area, so one of them is never the proposer.
 */
const formerRoles: { areaId: string; personId: string; role: 'owner' | 'approver' }[] = [
  { areaId: 'area_marketing', personId: 'per_ella', role: 'owner' },
  { areaId: 'area_paid_media', personId: 'per_kofi', role: 'owner' },
  { areaId: 'area_sandbox', personId: 'per_sofia', role: 'owner' },
  { areaId: 'area_sales', personId: 'per_ines', role: 'approver' },
  ...['area_marketing', 'area_paid_media', 'area_customer_value', 'area_sandbox'].flatMap(
    (areaId) =>
      ['per_lars', 'per_ines'].map((personId) => ({ areaId, personId, role: 'approver' as const })),
  ),
]

/**
 * The check levels each risk required before migration 0005, when every seeded version was
 * accepted. The seeded history keeps them, and an approver's accept for high risk, as a database
 * that ran before Heed v1 does; today every level beyond the first three is history only.
 */
const requiredLevels = {
  low: ['format', 'matching', 'delivery'],
  normal: ['format', 'matching', 'delivery', 'answer_impact'],
  high: ['format', 'matching', 'delivery', 'answer_impact', 'answer_full'],
} as const

/**
 * Who accepted a seeded version: an owner of the area, one other than the proposer for a normal or
 * high risk version (as the fixtures' history had it), and an approver who is neither for high risk.
 */
function acceptedBy(item: ContextItem) {
  const area = areas.find((a) => a.id === item.areaId)
  const holders = (role: 'owner' | 'approver') => [
    ...(role === 'owner' ? (area?.ownerIds ?? []) : []),
    ...(role === 'approver'
      ? roleGrants.approvers.filter((a) => a.areaId === item.areaId).map((a) => a.personId)
      : []),
    ...formerRoles
      .filter((r) => r.areaId === item.areaId && r.role === role)
      .map((r) => r.personId),
  ]
  const decider = holders('owner').find((id) => item.riskLevel === 'low' || id !== item.proposerId)
  const approver =
    item.riskLevel === 'high'
      ? holders('approver').find((id) => id !== item.proposerId && id !== decider)
      : null
  if (!decider || approver === undefined)
    throw new Error(`No one in the seeded roles may accept ${item.id} (${item.areaId})`)
  return { decider, capacity: 'owner', approver }
}

/**
 * What a seed adds to the library beyond its items: the golden set's fixtures
 * (db/seed/golden-fixtures.ts) declare conflicts, other names, a renamed Cube member and what an
 * earlier version said. The demo library has none of these.
 */
export type LibraryExtras = {
  /** Pairs of items whose current versions name each other as conflicting (FR-220). */
  conflicts?: readonly (readonly [string, string])[]
  /** Other names of vocabulary terms, by term key. */
  aliases?: Readonly<Record<string, readonly string[]>>
  /** Members the Cube model no longer lists, by id, and the member each was renamed to (CON-210). */
  renames?: Readonly<Record<string, string>>
  /** What an earlier version of an item said instead of its current text, by item id and version. */
  earlier?: Readonly<Record<string, Readonly<Record<number, NonNullable<VersionDays['patch']>>>>>
  /**
   * A domain that holds nothing yet: no item and no vocabulary term, while the Cube model maps a
   * view's members to it (the captain's pilot, where the domain's name had a typo and its members
   * were never proposed as terms).
   */
  emptyDomain?: {
    id: string
    name: string
    members: readonly {
      ref: string
      kind: 'metric' | 'dimension'
      name: string
      title: string
      valueType: string
    }[]
  }
}

/**
 * What the Cube connector read from the demo model (db/seed/cube, src/web/mocks/cube-model.ts),
 * as two reads: a first one on DEMO_FIRST_READ_AT and the newest on DEMO_READ_AT. Between them
 * Cube changed a few definitions and removed a legacy view, whose members fixture items flagged
 * `source_missing` still reference. A new read of the demo model therefore changes no flag.
 */
async function seedDefinitions(
  client: pg.Client,
  items: ContextItem[],
  renames: LibraryExtras['renames'] = {},
  emptyDomain?: LibraryExtras['emptyDomain'],
) {
  await client.query(
    "insert into connectors (id,kind,type,name) values ('cube','definition_source','cube','Cube local model')",
  )
  const current = new Set(demoDefinitions.map((definition) => definition.ref))
  const gone = [...new Set([...items.flatMap((item) => item.references), ...Object.keys(renames)])]
    .filter((ref) => !current.has(ref))
    .sort()
  const snapshot = async (fetchedAt: string, version: string, seen: number, warnings: unknown) =>
    (
      await client.query<{ id: string }>(
        `insert into connector_snapshots (connector_id,source_version,status,fetched_at,duration_ms,definitions_seen,warnings)
         values ('cube',$1,'ok',$2,1200,$3,$4) returning id`,
        [version, fetchedAt, seen, JSON.stringify(warnings)],
      )
    ).rows[0]!.id
  const first = await snapshot(
    DEMO_FIRST_READ_AT,
    sha256(`db/seed/cube ${DEMO_FIRST_READ_AT}`),
    demoDefinitions.length + gone.length,
    demoWarnings,
  )
  const latest = await snapshot(
    DEMO_READ_AT,
    DEMO_SOURCE_VERSION,
    demoDefinitions.length,
    demoWarnings,
  )
  await insert(client, 'definitions', [
    ...demoDefinitions.map((definition) => ({
      ref: definition.ref,
      connector_id: 'cube',
      kind: definition.kind,
      name: definition.name,
      title: definition.title,
      description_copy: definition.descriptionCopy,
      value_type: definition.valueType,
      area_hint: definition.areaHint,
      model_file: definition.modelFile,
      change_mark: definition.changeMark,
      first_seen_snapshot: first,
      last_seen_snapshot: latest,
      missing_since_snapshot: null,
    })),
    // Members of the empty domain's view: read by both reads, and no term names them.
    ...(emptyDomain?.members ?? []).map((member) => ({
      ref: member.ref,
      connector_id: 'cube',
      kind: member.kind,
      name: member.name,
      title: member.title,
      description_copy: null,
      value_type: member.valueType,
      area_hint: emptyDomain!.id,
      model_file: null,
      change_mark: sha256(member.ref),
      first_seen_snapshot: first,
      last_seen_snapshot: latest,
      missing_since_snapshot: null,
    })),
    // `insert` takes its columns from the first row, so every row names all of them.
    ...gone.map((ref) => ({
      ref,
      connector_id: 'cube',
      kind: 'metric',
      name: ref.slice('cube:'.length),
      title: null,
      description_copy: null,
      value_type: 'number',
      area_hint: null,
      model_file: null,
      change_mark: sha256(ref),
      first_seen_snapshot: first,
      last_seen_snapshot: first,
      missing_since_snapshot: latest,
    })),
  ])
  // A rename names a member that exists, so it is recorded once both are in.
  for (const [from, to] of Object.entries(renames))
    await client.query('update definitions set renamed_to=$2 where ref=$1', [from, to])
  // One mark per definition at the first read, and a second one where Cube changed it since.
  await insert(client, 'definition_marks', [
    ...demoDefinitions.flatMap((definition) => {
      const changed = changedDefinitions[definition.ref]
      return [
        {
          definition_ref: definition.ref,
          snapshot_id: first,
          change_mark: changed?.previousMark ?? definition.changeMark,
        },
        ...(changed
          ? [
              {
                definition_ref: definition.ref,
                snapshot_id: latest,
                change_mark: definition.changeMark,
              },
            ]
          : []),
      ]
    }),
    ...gone.map((ref) => ({ definition_ref: ref, snapshot_id: first, change_mark: sha256(ref) })),
    ...(emptyDomain?.members ?? []).map((member) => ({
      definition_ref: member.ref,
      snapshot_id: first,
      change_mark: sha256(member.ref),
    })),
  ])
  // The demo model is in this repository, so its Source tabs link to the model files.
  await client.query(
    `insert into settings_versions (key, version, value, reason)
     select 'sources.cube_model_url', max(version) + 1, to_jsonb($1::text), 'demo: the demo model in this repository'
       from settings_versions where key = 'sources.cube_model_url'`,
    [DEMO_MODEL_URL],
  )
}

/** Performance/screenshot data only. All writes are atomic and foreign keys remain enabled. */
export async function bulkSeed(
  client: pg.Client,
  items: ContextItem[],
  extras: LibraryExtras = {},
) {
  const role = await client.query<{ rolsuper: boolean }>(
    'select rolsuper from pg_roles where rolname=current_user',
  )
  if (!role.rows[0]?.rolsuper)
    throw new Error('Bulk seed requires a superuser; it bypasses review guards')
  const guards = [
    'item_versions',
    'item_version_metrics',
    'item_version_dimension_values',
    'item_version_dimensions',
    'item_version_evidence',
    'item_version_refs',
    'item_version_service',
    'vocab_term_service',
    'source_domain_service',
    'editions',
  ]
  await client.query('begin')
  try {
    await client.query("select pg_advisory_xact_lock(hashtextextended('heed.bulk_seed',0))")
    const existing = await client.query(
      'select 1 from items union all select 1 from people union all select 1 from editions limit 1',
    )
    if (existing.rowCount)
      throw new Error('Bulk seed requires an empty Heed database; it never replaces existing data')
    for (const table of guards)
      await client.query(`alter table ${identifier(table)} disable trigger user`)
    await insert(
      client,
      'people',
      people.map((p) => ({
        id: seedPersonId(p.id),
        email: p.id + '@example.test',
        display_name: p.name,
      })),
    )
    await insert(
      client,
      'areas',
      areas.map((a) => ({
        id: a.id,
        name: a.name,
        label: a.label,
        summary: a.summary,
        description: a.description,
        is_demo: a.id === 'area_sandbox',
      })),
    )
    if (extras.emptyDomain)
      await insert(client, 'areas', [
        {
          id: extras.emptyDomain.id,
          name: extras.emptyDomain.name,
          label: 'gray',
          summary: '',
          description: '',
          is_demo: false,
        },
      ])
    // Roles hold from the first day of the history, so its decisions were made by people who held
    // them then (0006 checks the role at the decision's time). Former roles end the day after it.
    const days = items
      .flatMap((i) => [
        ...versionDays(i).flatMap((v) => [v.proposed, v.accepted]),
        ...(i.status === 'retired' ? [i.updatedAt.slice(0, 10)] : []),
      ])
      .sort()
    const rolesFrom = `[${days[0] ?? '2024-01-01'}T00:00:00Z,`
    const rolesEnded = `${addDays(days.at(-1) ?? '2024-01-01', 1)}T00:00:00Z)`
    await insert(
      client,
      'area_assignments',
      [
        ...areas.flatMap((a) =>
          a.ownerIds.map((id) => ({
            area_id: a.id,
            person_id: seedPersonId(id),
            role: 'owner',
          })),
        ),
        ...roleGrants.approvers.map((a) => ({
          area_id: a.areaId,
          person_id: seedPersonId(a.personId),
          role: 'approver',
        })),
      ]
        .map((row) => ({ ...row, valid_at: rolesFrom + ')' }))
        .concat(
          formerRoles.map((r) => ({
            area_id: r.areaId,
            person_id: seedPersonId(r.personId),
            role: r.role,
            valid_at: rolesFrom + rolesEnded,
          })),
        ),
    )
    await insert(client, 'global_role_grants', [
      ...roleGrants.administrators.map((id) => ({
        person_id: seedPersonId(id),
        role: 'administrator',
      })),
      ...roleGrants.auditors.map((id) => ({ person_id: seedPersonId(id), role: 'auditor' })),
    ])
    const terms: Record<string, unknown>[] = []
    const versions: Record<string, unknown>[] = []
    const termRefs: Record<string, unknown>[] = []
    const term = (
      key: string,
      kind: string,
      parent: string | null,
      name: string,
      ownAliases: string[] = [],
      definitionRefs: string[] = [],
    ) => {
      const areaId = termAreas[key] ?? null
      const aliases = [...ownAliases, ...(extras.aliases?.[key] ?? [])]
      const id = randomUUID()
      terms.push({ key, kind, parent_key: parent })
      versions.push({
        id,
        term_key: key,
        version_no: 1,
        name,
        aliases,
        area_id: areaId,
        // The digest the review path gives the same term (FR-125), so exports and the restore
        // drill can recompute it.
        content_digest: termDigestContent({
          key,
          kind: kind as Term['kind'],
          parentKey: parent,
          name,
          aliases,
          areaId,
          definitionRefs,
        }),
      })
      for (const ref of definitionRefs) termRefs.push({ version_id: id, definition_ref: ref })
    }
    for (const group of new Set(vocabulary.metrics.map((m) => m.group)))
      term('group:' + group.toLowerCase(), 'metric_group', null, group)
    for (const m of vocabulary.metrics) {
      const key = 'metric:' + m.id
      term(
        key,
        'metric',
        'group:' + m.group.toLowerCase(),
        m.name,
        [],
        definitionRefsOf({ key, group: m.group }),
      )
    }
    for (const d of vocabulary.dimensions) {
      const key = 'dim:' + d.id
      term(key, 'dimension', null, d.name, [], definitionRefsOf({ key }))
      for (const v of d.values)
        term(`val:${d.id}/${v.id}`, 'dimension_value', key, v.name, v.aliases)
    }
    for (const version of versions)
      version.content_digest = bytes(await contentDigest(version.content_digest))
    await seedDefinitions(client, items, extras.renames, extras.emptyDomain)
    await insert(client, 'vocab_terms', terms)
    await insert(client, 'vocab_term_versions', versions)
    await insert(client, 'vocab_term_refs', termRefs)
    const bootstrap = (
      await client.query<{ seq: string }>(
        "insert into editions (label,reason,created_at) values ('2024-01-01.1','bootstrap','2024-01-01T00:00:00Z') returning seq",
      )
    ).rows[0]!.seq
    // The values of a dimension with thousands of them (the demo's campaigns) arrive later, in one
    // vocabulary edition of their own at the end, as a bulk import of values would. Every other
    // term is in service from the bootstrap edition.
    const imported = new Set(
      vocabulary.dimensions
        .filter((d) => d.values.length > IMPORTED_VALUES)
        .flatMap((d) => d.values.map((v) => `val:${d.id}/${v.id}`)),
    )
    await client.query(
      'insert into vocab_term_service select term_key,id,int8range($1,null) from vocab_term_versions where not term_key = any($2::text[])',
      [bootstrap, [...imported]],
    )
    // The domains the demo Cube model gives its members, as the edition carries them (0054).
    await client.query(
      `insert into source_domain_service (term_key,area_id,editions)
       select term_key,area_id,int8range($1,null) from cl_source_domains_now($1)`,
      [bootstrap],
    )
    // Every version of every item enters service in its own edition, on the days the fixtures
    // give it (versionDays); a retired item leaves service later the same day. Editions are
    // labelled day.N: N is 2 for the first version accepted that day and up, 9 for retirements.
    const timeline = items.map((item) => ({
      item,
      versions: versionDays(item).map((v) => {
        const earlier = extras.earlier?.[item.id]?.[v.version]
        return earlier ? { ...v, patch: { ...v.patch, ...earlier } } : v
      }),
    }))
    const editionKey = (day: string, order: number) => `${day}.${order}`
    const keys = new Map<string, { day: string; order: number }>()
    for (const { item, versions } of timeline) {
      for (const v of versions)
        keys.set(editionKey(v.accepted, v.version + 1), { day: v.accepted, order: v.version + 1 })
      if (item.status === 'retired') {
        const day = item.updatedAt.slice(0, 10)
        keys.set(editionKey(day, 9), { day, order: 9 })
      }
    }
    const editions = new Map<string, string>()
    let live = bootstrap
    // The imported values enter service first thing on the newest day (`day.1`; acceptances start
    // at 2), so the newest editions still accept items and only the last few serve them.
    const lastDay = [...keys.values()]
      .map((k) => k.day)
      .sort()
      .at(-1)
    let importedFrom: string | null = null
    for (const [key, { day, order }] of [...keys].sort(
      ([, a], [, b]) => a.day.localeCompare(b.day) || a.order - b.order,
    )) {
      if (imported.size && importedFrom === null && day === lastDay) {
        importedFrom = (
          await client.query<{ seq: string }>(
            "insert into editions (label,reason,created_at) values ($1,'vocabulary_changed',$2) returning seq",
            [editionKey(day, 1), day + 'T08:00:00Z'],
          )
        ).rows[0]!.seq
        await client.query(
          'insert into vocab_term_service select term_key,id,int8range($1,null) from vocab_term_versions where term_key = any($2::text[])',
          [importedFrom, [...imported]],
        )
      }
      const row = await client.query<{ seq: string }>(
        'insert into editions (label,reason,created_at) values ($1,$2,$3) returning seq',
        order === 9
          ? [key, 'item_retired', day + 'T10:00:00Z']
          : [key, 'proposal_accepted', day + 'T09:00:00Z'],
      )
      live = row.rows[0]!.seq
      editions.set(key, live)
    }
    for (let offset = 0; offset < timeline.length; offset += 2000) {
      const batch = timeline.slice(offset, offset + 2000)
      const rows = batch.flatMap(({ item, versions }) => {
        const ids = versions.map(() => randomUUID())
        return versions.map((v, index) => ({
          // What this version said: the item, with what it had that the item no longer does.
          item: { ...item, ...v.patch },
          id: ids[index]!,
          previous: index > 0 ? ids[index - 1]! : null,
          version: v,
          // The edition this version left service in: the next version's, or the retirement.
          until:
            index < versions.length - 1
              ? editions.get(editionKey(versions[index + 1]!.accepted, v.version + 2))
              : item.status === 'retired'
                ? editions.get(editionKey(item.updatedAt.slice(0, 10), 9))
                : undefined,
        }))
      })
      await insert(
        client,
        'items',
        batch.map(({ item: i }) => ({ id: i.id, kind: i.kind, created_at: i.createdAt })),
      )
      await insert(
        client,
        'item_versions',
        rows.map(({ item: i, id, previous, version }) => ({
          id,
          item_id: i.id,
          version_no: version.version,
          supersedes_version_id: previous,
          area_id: i.areaId,
          title: i.title,
          summary: i.summary,
          summary_markup: i.summaryMarkup ?? null,
          body: i.body ?? null,
          body_markup: i.bodyMarkup ?? null,
          risk: i.riskLevel,
          claim: i.claimLevel,
          claim_authority: i.claimLevel === 'effect_stated' ? 'Demo source' : null,
          claim_quote: i.claimLevel === 'effect_stated' ? i.evidence[0]?.quote : null,
          audience_groups: null,
          owner_id: seedPersonId(i.ownerId),
          proposer_id: seedPersonId(i.proposerId),
          created_via: i.createdVia,
          valid_from: i.validity.start,
          valid_until: i.validity.end,
          review_date: i.reviewDate,
          // Every row names every column (insert reads the first row's keys).
          not_to_conclude: i.notToConclude,
          // Placeholders: the real digests come from the stored content below.
          content_digest: bytes(placeholder),
          core_digest: bytes(placeholder),
          created_at: version.proposed + 'T08:00:00Z',
        })),
      )
      await insert(
        client,
        'item_version_metrics',
        rows.flatMap(({ item: i, id }) =>
          [...new Set(i.scope.metrics)].map((m) => ({ version_id: id, metric_key: 'metric:' + m })),
        ),
      )
      await insert(
        client,
        'item_version_dimension_values',
        rows.flatMap(({ item: i, id }) =>
          i.scope.dimensionValues.map((v) => ({
            version_id: id,
            dimension_key: 'dim:' + v.dimension,
            value_key: `val:${v.dimension}/${v.value}`,
          })),
        ),
      )
      await insert(
        client,
        'item_version_dimensions',
        rows.flatMap(({ item: i, id }) =>
          i.scope.dimensions.map((d) => ({ version_id: id, dimension_key: 'dim:' + d })),
        ),
      )
      await insert(
        client,
        'item_version_evidence',
        rows.flatMap(({ item: i, id }) =>
          i.evidence.map((e, position) => ({
            version_id: id,
            position,
            url: e.url,
            quote: e.quote,
            read_on: e.date,
          })),
        ),
      )
      await insert(
        client,
        'item_version_refs',
        rows.flatMap(({ item: i, id }) =>
          [...new Set(i.references)].map((ref) => ({
            version_id: id,
            definition_ref: ref,
            change_mark: i.changeMarks[ref],
          })),
        ),
      )
      await insert(
        client,
        'item_version_mentions',
        rows.flatMap(({ item: i, id }) =>
          mentionsInFields(i).map((m) => {
            const [prefix, key = ''] = m.target.split(/:(.*)/s)
            return {
              version_id: id,
              field: m.field,
              position: m.position,
              term_key: prefix === 'item' || prefix === 'area' ? null : m.target,
              item_id: prefix === 'item' ? key : null,
              area_id: prefix === 'area' ? key : null,
              label: m.label,
            }
          }),
        ),
      )
      await insert(
        client,
        'item_version_service',
        rows.map(({ item: i, id, version, until }) => ({
          item_id: i.id,
          version_id: id,
          editions: `[${editions.get(editionKey(version.accepted, version.version + 1))},${until ?? ''})`,
        })),
      )
      // What the review path leaves behind for each version it serves (FR-205): an accepted
      // proposal, passing results of the levels its risk requires and the accept decisions. A
      // retired item also gets the owner's retire decision (FR-218). Going back to an earlier
      // edition serves these versions again, and the database checks them again then.
      const history = rows.map((row) => ({
        ...row,
        proposal: randomUUID(),
        by: acceptedBy(row.item),
      }))
      await insert(
        client,
        'proposals',
        history.map(({ item: i, id, version: v, proposal, by }) => ({
          id: proposal,
          action: v.version === 1 ? 'create' : 'change',
          state: 'accepted',
          area_id: i.areaId,
          item_id: i.id,
          item_version_id: id,
          proposer_id: seedPersonId(i.proposerId),
          channel: i.createdVia,
          claimed_by: seedPersonId(by.decider),
          claimed_at: at(v.accepted, '08:15'),
          created_at: at(v.proposed, '08:00'),
          submitted_at: at(v.proposed, '08:00'),
          updated_at: at(v.accepted, '09:00'),
          closed_at: at(v.accepted, '09:00'),
        })),
      )
      await insert(
        client,
        'check_results',
        history.flatMap(({ item: i, id, version: v }) =>
          requiredLevels[i.riskLevel].map((level) => ({
            item_version_id: id,
            level,
            outcome: 'passed',
            ran_at: at(v.proposed, '08:00'),
          })),
        ),
      )
      const decision = (
        { item: i, id, proposal }: (typeof history)[number],
        decidedBy: string,
        capacity: string,
        outcome: 'accept' | 'retire',
        decidedAt: string,
      ) => ({
        proposal_id: outcome === 'accept' ? proposal : null,
        item_version_id: id,
        area_id: i.areaId,
        decided_by: seedPersonId(decidedBy),
        capacity,
        outcome,
        reason:
          outcome === 'retire' ? 'Retired in the demo history.' : 'Accepted in the demo history.',
        decided_at: decidedAt,
      })
      await insert(client, 'decisions', [
        ...history.map((h) =>
          decision(h, h.by.decider, h.by.capacity, 'accept', at(h.version.accepted, '08:30')),
        ),
        ...history.flatMap((h) =>
          h.by.approver
            ? [decision(h, h.by.approver, 'approver', 'accept', at(h.version.accepted, '08:45'))]
            : [],
        ),
        ...history
          .filter((h) => h.item.status === 'retired' && h.version.version === h.item.version)
          .map((h) =>
            decision(
              h,
              areas.find((a) => a.id === h.item.areaId)!.ownerIds[0]!,
              'owner',
              'retire',
              at(h.item.updatedAt.slice(0, 10), '09:30'),
            ),
          ),
      ])
    }
    // Each conflict is named by the current version of both items, as an owner records it.
    await client.query(
      `insert into item_version_conflicts (version_id,other_item_id)
       select v.id,p.other from jsonb_to_recordset($1::jsonb) as p(item text,other text)
       cross join lateral (select id from item_versions where item_id=p.item
                            order by version_no desc limit 1) v`,
      [
        JSON.stringify(
          (extras.conflicts ?? []).flatMap(([a, b]) => [
            { item: a, other: b },
            { item: b, other: a },
          ]),
        ),
      ],
    )
    await insert(
      client,
      'overlay_events',
      items
        .filter((i) => i.checkFlag !== null)
        .map((i) => ({ kind: 'flag_on', scope: 'item', item_id: i.id, flag: i.checkFlag })),
    )
    // Each version's digests from its stored content, through the same reader and canonical JSON
    // as the write path, so an edition export or the restore drill recomputes them exactly.
    const stored = await readVersions(
      {
        query: async <Row extends pg.QueryResultRow>(text: string, values?: unknown[]) =>
          (await client.query<Row>(text, values)).rows,
      },
      (await client.query<{ id: string }>('select id::text from item_versions')).rows.map(
        (row) => row.id,
      ),
    )
    const digests = await Promise.all(
      stored.map(async (row) => ({
        id: row.id,
        ...(await itemVersionDigests(row.version)),
      })),
    )
    await client.query(
      `update item_versions v set content_digest=decode(d.content,'hex'),core_digest=decode(d.core,'hex')
       from jsonb_to_recordset($1::jsonb) as d(id uuid,content text,core text) where v.id=d.id`,
      [JSON.stringify(digests)],
    )
    // The preimage of edition_content_digest is its sorted lines, and lines sort as area, domain,
    // item, vocab by their first letter. Up to the imported values every edition serves the bootstrap
    // vocabulary, so that block is joined once instead of once per edition: sorting thousands of
    // vocabulary lines again for each of ~1,400 editions took half a minute. The edition of the
    // imported values, and any after it, take the database's own function.
    const vocabularyRanges = await client.query<{ odd: number }>(
      `select count(*)::int as odd from vocab_term_service
        where upper(editions) is not null or not lower(editions) = any($1::bigint[])`,
      [[bootstrap, importedFrom ?? bootstrap]],
    )
    if (vocabularyRanges.rows[0]!.odd !== 0)
      throw new Error('Expected the vocabulary from the bootstrap edition and the imported values')
    await client.query(
      `with lines as (
         select 'vocab:' || s.term_key || ':' || encode(t.content_digest, 'hex') as line
           from vocab_term_service s join vocab_term_versions t on t.id = s.version_id
          where lower(s.editions) = $1),
       vocabulary as (select string_agg(line, E'\\n' order by line collate "C") as block from lines)
       update editions e set sealed_at = now(), digest = sha256(convert_to(concat_ws(E'\\n',
         (select string_agg(line, E'\\n' order by line collate "C") from (
            select 'domain:' || d.term_key || ':' || d.area_id as line
              from source_domain_service d where d.editions @> e.seq) z),
         (select string_agg(line, E'\\n' order by line collate "C") from (
            select 'item:' || s.item_id || ':' || encode(v.content_digest, 'hex') as line
              from item_version_service s join item_versions v on v.id = s.version_id
             where s.editions @> e.seq) y),
         case when e.seq >= $1 then vocabulary.block end), 'UTF8'))
         from vocabulary where e.seq < $2 or $2 = $1`,
      [bootstrap, importedFrom ?? bootstrap],
    )
    if (importedFrom !== null)
      await client.query(
        'update editions set sealed_at = now(), digest = edition_content_digest(seq) where seq >= $1',
        [importedFrom],
      )
    const check = await client.query<{ same: boolean }>(
      'select digest = edition_content_digest(seq) as same from editions where seq = $1',
      [live],
    )
    if (!check.rows[0]?.same) throw new Error('The seeded edition digest differs from the database')
    await client.query('insert into live_edition (seq) values ($1)', [live])
    for (const table of guards)
      await client.query(`alter table ${identifier(table)} enable trigger user`)
    await client.query('commit')
    return items.length
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}
