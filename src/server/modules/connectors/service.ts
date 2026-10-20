import { contentDigest } from '../../../domain/canonical.ts'
import type { Database } from '../../db/database.ts'
import { publishSourceDomains } from '../editions/index.ts'
import {
  noticeDomainChanges,
  noticeStaleLinks,
  reconcileSourceFlags,
  type DomainChange,
} from './flags.ts'
import type { ConnectorRegistry } from './registry.ts'
import {
  domainCoverage,
  snapshotSchema,
  SourceReadError,
  type DefinitionSource,
  type SourceWarning,
  type Definition,
  type SourceSnapshot,
} from './types.ts'

export interface StoredDefinition extends Definition {
  missingSinceSnapshot: string | null
  renamedTo: string | null
}
export interface SyncResult {
  snapshotId: string
  status: 'ok' | 'partial' | 'failed'
  definitionsSeen: number
  coverage: ReturnType<typeof domainCoverage> | null
  /** Items flagged and unflagged by this sync. A failed read changes no flag (CON-213). */
  flags: { raised: number; cleared: number }
  /** Items told that a definition they only mention changed or disappeared. */
  staleLinkNotices: number
  /** Vocabulary terms told that their definition's domain changed in the source. */
  domainNotices: number
  /** The edition that took the domains the source gives now, when they changed (FR-215). */
  domainEdition: string | null
}

/**
 * The members whose domain the server's list gave (a read's `domain_override` warnings), read
 * once and joined by member as `o`: the pilot maps every view with the list, so a read warns once
 * per member, and looking each member up in its read's warnings grew with members times warnings
 * (45 s at 2,000 members). Only the reads definitions were last seen in are opened.
 */
export const overriddenMembers = `left join (
    select distinct s.id as snapshot, w->>'target' as ref
      from connector_snapshots s cross join lateral jsonb_array_elements(s.warnings) w
     where w->>'code' = 'domain_override'
       and s.id in (select distinct last_seen_snapshot from definitions)
  ) o on o.snapshot = d.last_seen_snapshot and o.ref = d.ref`

/** Where a stored definition's domain comes from, with `overriddenMembers` joined as `o`. */
export const domainSource = `case when d.area_hint is null then 'none'
  when o.ref is not null then 'override' else 'cube' end`

const columns = `d.ref, d.kind, d.name, d.title, d.description_copy as "descriptionCopy",
  d.value_type as "valueType", d.visible_groups as "visibleGroups", d.area_hint as "areaHint",
  d.change_mark as "changeMark", d.missing_since_snapshot as "missingSinceSnapshot",
  d.renamed_to as "renamedTo", d.model_file as "modelFile", ${domainSource} as "domainSource"`

/** Stored metadata is the read path. Only sync invokes a source or the compiler. */
export class ConnectorService {
  readonly #database: Database
  readonly #registry: ConnectorRegistry
  constructor(database: Database, registry: ConnectorRegistry) {
    this.#database = database
    this.#registry = registry
  }

  async list(connectorId: string): Promise<StoredDefinition[]> {
    return this.#database.query<StoredDefinition>(
      `select ${columns} from definitions d ${overriddenMembers}
        where d.connector_id=$1 order by d.ref`,
      [connectorId],
    )
  }

  async exists(ref: string): Promise<boolean> {
    const rows = await this.#database.query(
      'select 1 from definitions where ref=$1 and missing_since_snapshot is null',
      [ref],
    )
    return rows.length === 1
  }

  async changesSince(
    connectorId: string,
    snapshotId: string,
  ): Promise<{ changed: string[]; missing: string[] }> {
    const baseline = await this.#database.query(
      `select 1 from connector_snapshots where id=$1 and connector_id=$2 and status <> 'failed'`,
      [snapshotId, connectorId],
    )
    if (!baseline[0]) throw new Error('Unknown successful connector snapshot')
    const rows = await this.#database.query<{ ref: string; missing: boolean }>(
      `select d.ref, d.missing_since_snapshot is not null as missing from definitions d
       where d.connector_id=$1 and (
         exists (select 1 from definition_marks m join connector_snapshots s on s.id=m.snapshot_id
           where m.definition_ref=d.ref and s.fetched_at > (select fetched_at from connector_snapshots where id=$2))
         or exists (select 1 from connector_snapshots s where s.id=d.missing_since_snapshot and s.fetched_at > (select fetched_at from connector_snapshots where id=$2))
       ) order by d.ref`,
      [connectorId, snapshotId],
    )
    return {
      changed: rows.filter((row) => !row.missing).map((row) => row.ref),
      missing: rows.filter((row) => row.missing).map((row) => row.ref),
    }
  }

  /**
   * One refresh (CON-506): read the source, store a snapshot and the definitions it reports, then
   * bring item flags in line and tell owners what changed. A failed read stores only the failed
   * snapshot and changes nothing else (CON-103, CON-213, CON-214).
   */
  async sync(connectorId: string): Promise<SyncResult> {
    return this.syncSource(await this.#registry.find(this.#database, connectorId))
  }

  /** One refresh of a source the registry gave (`ConnectorRegistry.current`). */
  async syncSource(source: DefinitionSource): Promise<SyncResult> {
    const origin = this.#registry.isServer(source.id) ? 'server' : 'workspace'
    return this.#database.transaction(null, async (tx) => {
      // The server's own sources are registered at their first read; an added one already is.
      if (origin === 'server')
        await tx.query(
          `insert into connectors (id,kind,type,name,interface_version) values ($1,'definition_source',$2,$3,$4)
           on conflict (id) do update set interface_version=excluded.interface_version
             where connectors.origin='server' and connectors.interface_version<>excluded.interface_version`,
          [source.id, source.type, source.name, source.interfaceVersion],
        )
      const [registered] = await tx.query<{ enabled: boolean; type: string; origin: string }>(
        'select enabled,type,origin from connectors where id=$1 for update',
        [source.id],
      )
      if (!registered) throw new Error(`Unknown connector: ${source.id}`)
      if (!registered.enabled) throw new Error('Connector is disabled')
      if (registered.type !== source.type) throw new Error('Connector type does not match registry')
      if (registered.origin !== origin) throw new Error('Connector origin does not match registry')
      // The cursor of the newest read that brought data: where this read may start.
      const [last] = await tx.query<{ cursor: string | null }>(
        `select cursor from connector_snapshots where connector_id=$1 and status <> 'failed'
         order by fetched_at desc limit 1`,
        [source.id],
      )
      const started = performance.now()
      let snapshot: SourceSnapshot | undefined
      let failureWarnings: SourceWarning[] = []
      try {
        snapshot = snapshotSchema.parse(await source.read({ cursor: last?.cursor ?? null }))
        const refs = new Set(snapshot.definitions.map((entry) => entry.ref))
        if (refs.size !== snapshot.definitions.length) {
          throw new Error('Duplicate definition reference')
        }
        // A rename leads from a member that is gone to one that is here (CON-512).
        if (snapshot.renames?.some((rename) => refs.has(rename.from) || !refs.has(rename.to)))
          throw new Error('Invalid rename')
      } catch (error) {
        if (error instanceof SourceReadError) failureWarnings = error.warnings
        snapshot = undefined
      }
      if (snapshot) {
        // A ref belongs to one source for good. A member another source already reads stays
        // with it: this read leaves it out, says so, and is in part, so it marks nothing missing.
        const taken = await tx.query<{ ref: string }>(
          'select ref from definitions where ref = any($1::text[]) and connector_id <> $2 order by ref',
          [snapshot.definitions.map((definition) => definition.ref), source.id],
        )
        if (taken.length) {
          const refs = new Set(taken.map((row) => row.ref))
          snapshot = {
            ...snapshot,
            complete: false,
            definitions: snapshot.definitions.filter((definition) => !refs.has(definition.ref)),
            warnings: [
              ...snapshot.warnings,
              ...taken.map((row) => ({ code: 'taken' as const, target: row.ref })),
            ],
          }
        }
      }
      const status = snapshot ? (snapshot.complete ? 'ok' : 'partial') : 'failed'
      const [saved] = await tx.query<{ id: string }>(
        `insert into connector_snapshots
         (connector_id,source_version,status,fetched_at,duration_ms,definitions_seen,warnings,error,content_digest,cursor)
         values ($1,$2,$3,clock_timestamp(),$4,$5,$6,$7,$8,$9) returning id`,
        [
          source.id,
          snapshot?.sourceVersion ?? null,
          status,
          Math.round(performance.now() - started),
          snapshot?.definitions.length ?? 0,
          JSON.stringify(snapshot?.warnings ?? failureWarnings),
          snapshot ? null : 'Definition source could not be read',
          snapshot ? Buffer.from(await contentDigest(snapshot), 'hex') : null,
          snapshot?.cursor ?? null,
        ],
      )
      const snapshotId = saved!.id
      if (!snapshot)
        return {
          snapshotId,
          status,
          definitionsSeen: 0,
          coverage: null,
          flags: { raised: 0, cleared: 0 },
          staleLinkNotices: 0,
          domainNotices: 0,
          domainEdition: null,
        }
      const domainChanges: DomainChange[] = []
      for (const definition of snapshot.definitions) {
        const [previous] = await tx.query<{
          connector_id: string
          change_mark: string
          area_hint: string | null
          missing_since_snapshot: string | null
        }>(
          'select connector_id,change_mark,area_hint,missing_since_snapshot from definitions where ref=$1',
          [definition.ref],
        )
        if (previous && previous.connector_id !== source.id)
          throw new Error('Definition belongs to another connector')
        const upserted = await tx.query(
          `insert into definitions
           (ref,connector_id,kind,name,title,description_copy,value_type,visible_groups,area_hint,change_mark,first_seen_snapshot,last_seen_snapshot,model_file,synonyms,base_name)
           values ($1,$2,$3,$4,$5,$6,$7,null,$8,$9,$10,$10,$11,$12,$13)
           on conflict (ref) do update set kind=excluded.kind,name=excluded.name,title=excluded.title,
             description_copy=excluded.description_copy,value_type=excluded.value_type,visible_groups=null,
             area_hint=excluded.area_hint,change_mark=excluded.change_mark,last_seen_snapshot=excluded.last_seen_snapshot,
             model_file=excluded.model_file,synonyms=excluded.synonyms,base_name=excluded.base_name,
             missing_since_snapshot=null,renamed_to=null
             where definitions.connector_id=excluded.connector_id returning ref`,
          [
            definition.ref,
            source.id,
            definition.kind,
            definition.name,
            definition.title,
            definition.descriptionCopy,
            definition.valueType,
            definition.areaHint,
            definition.changeMark,
            snapshotId,
            definition.modelFile,
            definition.synonyms ?? [],
            definition.baseName ?? null,
          ],
        )
        if (upserted.length !== 1) throw new Error('Definition belongs to another connector')
        if (
          !previous ||
          previous.change_mark !== definition.changeMark ||
          previous.missing_since_snapshot
        ) {
          await tx.query(
            'insert into definition_marks (definition_ref,snapshot_id,change_mark,visible_groups) values ($1,$2,$3,null)',
            [definition.ref, snapshotId, definition.changeMark],
          )
        }
        if (previous && previous.area_hint !== definition.areaHint)
          domainChanges.push({
            ref: definition.ref,
            from: previous.area_hint,
            to: definition.areaHint,
          })
      }
      if (snapshot.complete) {
        await tx.query(
          `update definitions set missing_since_snapshot=$2 where connector_id=$1
           and missing_since_snapshot is null and last_seen_snapshot is distinct from $2`,
          [source.id, snapshotId],
        )
      }
      // The renames list names the new id of each member that is gone (CON-512).
      await tx.query(
        `with renames as (select r."from", r."to" from jsonb_to_recordset($2::jsonb) as r("from" text, "to" text))
         update definitions d set renamed_to=(select r."to" from renames r where r."from"=d.ref)
          where d.connector_id=$1 and d.missing_since_snapshot is not null
            and d.renamed_to is distinct from (select r."to" from renames r where r."from"=d.ref)`,
        [source.id, JSON.stringify(snapshot.renames ?? [])],
      )
      const flags = await reconcileSourceFlags(tx, { snapshotId })
      const staleLinkNotices = await noticeStaleLinks(tx, snapshotId)
      const domainNotices = await noticeDomainChanges(tx, domainChanges)
      // Serving, gaps and the catalogue read the domains from the live edition (CON-206).
      const domainEdition = (await publishSourceDomains(tx))?.label ?? null
      return {
        snapshotId,
        status,
        definitionsSeen: snapshot.definitions.length,
        coverage: domainCoverage(snapshot.definitions),
        flags,
        staleLinkNotices,
        domainNotices,
        domainEdition,
      }
    })
  }
}
