import { ORPCError } from '@orpc/client'
import type { SourceDocument } from '../../../domain/connector-runtime.ts'
import {
  documentDraft,
  documentMark,
  documentQuote,
  type SkipReason,
} from '../../../domain/content-document.ts'
import { textFindings } from '../../../domain/draft.ts'
import { provenanceOf } from '../../../domain/provenance.ts'
import { nextReadAt } from '../../../domain/source-schedule.ts'
import type { Clock } from '../../clock.ts'
import type { Database, Queryable } from '../../db/database.ts'
import { draftVocabulary } from '../../mcp/draft-tool.ts'
import { createSourceProposals } from '../proposals/index.ts'
import type { ContentSource } from './platform.ts'
import { scheduleOf } from './schedule.ts'
import { SourceReadError, type SourceWarning } from './types.ts'

/*
  The content pipeline (docs/connectors.md, "The two pipelines", content; CON-601 to CON-611). A
  connector only returns documents; this is the one place that turns them into suggestions, and
  it has no way to accept, publish or change an item or an edition (CON-604): it writes as
  nobody, in its own transaction, which row security lets write the suggestions of this source
  and nothing else. Per document it keeps only what CON-605 allows, never the text.

  For each document of a read, in the order the waiting ones first:
  1. its change mark; a mark it already handled means nothing to do;
  2. a document that appears to name people or holds a secret is skipped (CON-608), and one that
     names nothing in the vocabulary has nowhere to apply;
  3. past the source's suggestions for the day it waits, and goes first next time (CON-607);
  4. it becomes a draft for its scope's domain and is submitted to that domain's owners, through
     the same defaults and checks as any proposal, marked on every field (CON-603);
  5. a changed document replaces its open suggestion instead of adding one; a mark an owner
     declined is not offered again (CON-606).
  A document that is deleted, or leaves the chosen scopes, withdraws its open suggestion, and an
  item it became is listed for its owners (CON-609). Owners are told once per source per read.
*/

/** What one read of a content source did, for the job's summary and the source's page. */
export interface ContentResult {
  readId: string
  status: 'ok' | 'partial' | 'failed'
  documentsSeen: number
  suggested: number
  replaced: number
  withdrawn: number
  waiting: number
  skipped: number
}

/** The share of a source's documents a full read may find gone at once (docs/connectors.md). */
export const REMOVAL_SHARE_MAX = 0.5
/** A source this small may lose every document in one read. */
export const REMOVAL_FLOOR = 5
/** Suggestions a source makes in a day when its manifest says nothing (CON-607). */
export const DRAFTS_PER_DAY = 20

interface Known {
  document_id: string
  scope: string
  change_mark: string
  state: 'drafted' | 'waiting' | 'skipped' | 'gone'
  proposal_id: string | null
  first_seen_at: Date
}

interface Previous {
  id: string
  state: string
  action: string
  item_id: string | null
  revision: number
  live: boolean
}

const open = ['submitted', 'in_review', 'changes_requested']

const skipWarning: Record<SkipReason | 'not_valid', SourceWarning['code']> = {
  names_people: 'document_names_people',
  holds_secret: 'document_holds_secret',
  no_scope: 'document_no_scope',
  empty: 'document_empty',
  not_valid: 'document_not_valid',
}

export class ContentPipeline {
  readonly #database: Database
  readonly #clock: Clock
  constructor(database: Database, clock: Clock) {
    this.#database = database
    this.#clock = clock
  }

  /** One read of a content source, and everything it changes, in one transaction. */
  async sync(source: ContentSource): Promise<ContentResult> {
    return this.#database.transaction(null, (tx) => this.#sync(tx, source), {
      source: source.id,
    })
  }

  async #sync(tx: Queryable, source: ContentSource): Promise<ContentResult> {
    const clock = this.#clock
    const [registered] = await tx.query<{ enabled: boolean; type: string; kind: string }>(
      'select enabled, type, kind::text as kind from connectors where id=$1 for update',
      [source.id],
    )
    if (!registered) throw new Error(`Unknown connector: ${source.id}`)
    if (!registered.enabled) throw new Error('Connector is disabled')
    if (registered.type !== source.type || registered.kind !== 'context_source')
      throw new Error('Connector type does not match registry')
    const { manifest } = source
    const schedule = await scheduleOf(tx, source.id, manifest)
    const [last] = await tx.query<{ cursor: string | null }>(
      `select cursor from connector_snapshots where connector_id=$1 and status <> 'failed'
        order by fetched_at desc limit 1`,
      [source.id],
    )
    const started = performance.now()
    let read
    try {
      read = await source.read({ cursor: last?.cursor ?? null })
    } catch (error) {
      if (!(error instanceof SourceReadError)) throw error
      const [failed] = await tx.query<{ id: string }>(
        `insert into connector_snapshots
           (connector_id, status, fetched_at, duration_ms, warnings, error, connector_version)
         values ($1, 'failed', clock_timestamp(), $2, $3, 'Content source could not be read', $4)
         returning id`,
        [
          source.id,
          Math.round(performance.now() - started),
          JSON.stringify(error.warnings),
          manifest.version,
        ],
      )
      const failures = schedule.failures + 1
      await tx.query('update connectors set failures=$2, next_read_at=$3 where id=$1', [
        source.id,
        failures,
        nextReadAt(clock.now(), {
          ...schedule,
          failures,
          failure: error.errorClass,
          ...(error.retryAfter === undefined ? {} : { retryAfterSeconds: error.retryAfter }),
        }),
      ])
      return {
        readId: failed!.id,
        status: 'failed',
        documentsSeen: 0,
        suggested: 0,
        replaced: 0,
        withdrawn: 0,
        waiting: 0,
        skipped: 0,
      }
    }
    const warnings: SourceWarning[] = [...read.warnings]
    const [saved] = await tx.query<{ id: string }>(
      `insert into connector_snapshots
         (connector_id, source_version, status, fetched_at, duration_ms, warnings, connector_version,
          documents_seen, cursor)
       values ($1, $2, $3, clock_timestamp(), $4, '[]', $5, $6, $7) returning id`,
      [
        source.id,
        read.version,
        read.complete ? 'ok' : 'partial',
        Math.round(performance.now() - started),
        manifest.version,
        read.documents.length + read.unread.length,
        read.cursor ?? null,
      ],
    )
    const readId = saved!.id
    const counts = { suggested: 0, replaced: 0, withdrawn: 0, waiting: 0, skipped: 0 }
    /** What each domain's owners are told, once for this read. */
    const told = new Map<string, { suggested: number; replaced: number }>()

    const known = new Map(
      (
        await tx.query<Known>(
          `select document_id, scope, change_mark, state, proposal_id::text, first_seen_at
             from connector_documents where source_id=$1 for update`,
          [source.id],
        )
      ).map((row) => [row.document_id, row]),
    )
    const previousOf = async (proposalId: string | null): Promise<Previous | null> => {
      if (!proposalId) return null
      const [row] = await tx.query<Previous>(
        `select p.id::text, p.state::text as state, p.action::text as action, p.item_id, p.revision,
                exists (select 1 from item_version_service s where s.item_id = p.item_id
                          and s.editions @> (select seq from live_edition)) as live
           from proposals p where p.id=$1`,
        [proposalId],
      )
      return row ?? null
    }
    const proposalsFor = (document: string) =>
      createSourceProposals(tx, clock, { source: source.id, read: readId, document })
    const withdraw = async (document: string, previous: Previous | null, reason: string) => {
      if (!previous || !open.includes(previous.state)) return false
      await proposalsFor(document).withdraw(previous.id, previous.revision, reason)
      return true
    }
    /**
     * Its title as kept: the document's own, unless it holds what may name a person or a secret,
     * as the text of a skipped document may; then its id stands in for it.
     */
    const titleOf = (document: SourceDocument) => {
      const title = [...document.title.trim()].slice(0, 300).join('')
      return title && !textFindings(title).length ? title : document.id.slice(0, 300)
    }
    /** What is kept of a document (CON-605); a skipped one keeps no quote of its words. */
    const remember = (
      document: SourceDocument,
      mark: string,
      state: Known['state'],
      quote = documentQuote(document.text),
    ) =>
      tx.query(
        `insert into connector_documents
           (source_id, document_id, scope, title, link, modified_at, change_mark, quote, state,
            skip_reason, first_read_id, last_read_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
         on conflict (source_id, document_id) do update set scope=excluded.scope,
           title=excluded.title, link=excluded.link, modified_at=excluded.modified_at,
           change_mark=excluded.change_mark, quote=excluded.quote, state=excluded.state,
           skip_reason=excluded.skip_reason, last_read_id=excluded.last_read_id,
           last_seen_at=now(), gone_at=null`,
        [
          source.id,
          document.id,
          document.scope,
          titleOf(document),
          document.link,
          document.modifiedAt,
          mark,
          quote,
          state === 'skipped' ? 'waiting' : state,
          null,
          readId,
        ],
      )
    const skip = async (
      document: SourceDocument,
      mark: string,
      reason: SkipReason | 'not_valid',
    ) => {
      // It may name a person or hold a secret: none of its words are kept, not even a quote.
      await remember(document, mark, 'waiting', '')
      await tx.query(
        `update connector_documents set state='skipped', skip_reason=$3
          where source_id=$1 and document_id=$2`,
        [source.id, document.id, reason],
      )
      warnings.push({ code: skipWarning[reason], target: document.id })
      counts.skipped++
    }

    const scopes = new Map(source.scopes.map((scope) => [scope.id, scope]))
    const vocabulary = { ...(await draftVocabulary(tx)), today: clock.today() }
    const perDay = manifest.limits.draftsPerDay ?? DRAFTS_PER_DAY
    const [today] = await tx.query<{ made: number }>(
      `select count(*)::int as made from proposals
        where source_id=$1 and created_at > now() - interval '24 hours'`,
      [source.id],
    )
    let made = today?.made ?? 0
    // The documents that waited go first, the longest waiting first (CON-607).
    const waitedSince = (document: SourceDocument) => {
      const row = known.get(document.id)
      return row?.state === 'waiting' ? row.first_seen_at.getTime() : Number.POSITIVE_INFINITY
    }
    const documents = read.documents
      .map((document, index) => ({ document, index }))
      .sort((a, b) => waitedSince(a.document) - waitedSince(b.document) || a.index - b.index)
      .map(({ document }) => document)

    for (const document of documents) {
      const scope = scopes.get(document.scope)!
      const mark = await documentMark(document)
      const before = known.get(document.id)
      if (
        before &&
        before.change_mark === mark &&
        before.scope === document.scope &&
        (before.state === 'drafted' || before.state === 'skipped')
      ) {
        // Nothing new: it is still there, as it was.
        await tx.query(
          `update connector_documents set title=$3, link=$4, modified_at=$5, last_read_id=$6,
             last_seen_at=now() where source_id=$1 and document_id=$2`,
          [source.id, document.id, titleOf(document), document.link, document.modifiedAt, readId],
        )
        continue
      }
      const previous = await previousOf(before?.proposal_id ?? null)
      const drafted = documentDraft(document, scope.domain, vocabulary)
      await tx.query('savepoint content_document')
      try {
        if ('skip' in drafted) {
          // What it says now cannot stand as a suggestion, so the one it replaced goes too.
          if (
            await withdraw(
              document.id,
              previous,
              'The document changed, and cannot be suggested any more.',
            )
          )
            counts.withdrawn++
          await skip(document, mark, drafted.skip)
          await tx.query('release savepoint content_document')
          continue
        }
        if (made >= perDay) {
          // It keeps the suggestion it had, if any, until it is drafted again.
          await remember(document, mark, 'waiting')
          counts.waiting++
          await tx.query('release savepoint content_document')
          continue
        }
        // A suggestion for the item the document became, or a new one.
        const itemId =
          previous && previous.item_id && previous.live && previous.action !== 'retire'
            ? previous.item_id
            : null
        const replaced = await withdraw(
          document.id,
          previous,
          'The document changed, so a newer suggestion from it replaces this one.',
        )
        await remember(document, mark, 'waiting')
        const proposals = proposalsFor(document.id)
        const { draft, marks } = drafted
        const created = await proposals.create(
          { draft, ...(itemId ? { itemId } : {}) },
          { provenance: (filled) => provenanceOf('source', marks, filled) },
        )
        await proposals.submit(created.id, created.revision)
        await tx.query(
          `update connector_documents set state='drafted', skip_reason=null, proposal_id=$3
            where source_id=$1 and document_id=$2`,
          [source.id, document.id, created.id],
        )
        await tx.query('release savepoint content_document')
        made++
        counts.suggested++
        if (replaced) counts.replaced++
        const area = told.get(scope.domain) ?? { suggested: 0, replaced: 0 }
        area.suggested++
        if (replaced) area.replaced++
        told.set(scope.domain, area)
      } catch (error) {
        // A draft the checks refuse is not offered; nothing it began is kept.
        if (!(error instanceof ORPCError)) throw error
        await tx.query('rollback to savepoint content_document')
        if (
          await withdraw(
            document.id,
            previous,
            'The document changed, and cannot be suggested any more.',
          )
        )
          counts.withdrawn++
        await skip(document, mark, 'not_valid')
        await tx.query('release savepoint content_document')
      }
    }

    // What is gone: tombstones, documents outside the chosen scopes, and on a complete read
    // without tombstones whatever it did not list. A read that would withdraw too much at once
    // keeps it all and is in part, so a broken scope never empties the Inbox.
    const seen = new Set([...read.documents.map((d) => d.id), ...read.unread])
    const present = [...known.values()].filter((row) => row.state !== 'gone')
    const outside = present.filter((row) => !scopes.has(row.scope))
    const deleted = new Set(read.deleted)
    const absent =
      read.complete && manifest.capabilities.deletions !== 'tombstones'
        ? present.filter(
            (row) =>
              scopes.has(row.scope) && !seen.has(row.document_id) && !deleted.has(row.document_id),
          )
        : []
    let complete = read.complete
    let removals = absent
    if (absent.length > REMOVAL_FLOOR && absent.length > present.length * REMOVAL_SHARE_MAX) {
      warnings.push({ code: 'too_many_removals', target: String(absent.length) })
      removals = []
      complete = false
    }
    const gone = [
      ...outside,
      ...removals,
      ...present.filter(
        (row) =>
          deleted.has(row.document_id) && scopes.has(row.scope) && !seen.has(row.document_id),
      ),
    ]
    for (const row of new Map(gone.map((r) => [r.document_id, r])).values()) {
      const previous = await previousOf(row.proposal_id)
      if (await withdraw(row.document_id, previous, 'The document is gone from the source.'))
        counts.withdrawn++
      else if (previous?.state === 'accepted' && previous.live && previous.item_id) {
        // The item it became stays; its owners are told its document is gone (CON-609).
        const [item] = await tx.query<{ area: string }>(
          `select v.area_id as area from item_version_service s join item_versions v on v.id=s.version_id
            where s.item_id=$1 and s.editions @> (select seq from live_edition)`,
          [previous.item_id],
        )
        await tx.query(
          `insert into outbox_events (topic, area_id, aggregate_type, aggregate_id, payload)
           values ('source.document_gone', $1, 'item', $2, $3)`,
          [
            item?.area ?? null,
            previous.item_id,
            JSON.stringify({ source: source.id, read: readId, item: previous.item_id }),
          ],
        )
      }
      await tx.query(
        `update connector_documents set state='gone', skip_reason=null, gone_at=now(), last_read_id=$3
          where source_id=$1 and document_id=$2`,
        [source.id, row.document_id, readId],
      )
    }

    // Owners are told once per source per read (CON-611).
    for (const [area, made] of told)
      await tx.query(
        `insert into outbox_events (topic, area_id, aggregate_type, aggregate_id, payload)
         values ('source.suggested', $1, 'source', $2, $3)`,
        [area, source.id, JSON.stringify({ source: source.id, read: readId, ...made })],
      )

    // A document that waits holds the cursor back, so the next read brings it again.
    await tx.query(
      `update connector_snapshots set status=$2, warnings=$3, cursor=$4, suggested=$5, replaced=$6,
         withdrawn=$7, waiting=$8, skipped=$9 where id=$1`,
      [
        readId,
        complete ? 'ok' : 'partial',
        JSON.stringify(warnings.slice(0, 1_000)),
        counts.waiting ? (last?.cursor ?? null) : (read.cursor ?? null),
        counts.suggested,
        counts.replaced,
        counts.withdrawn,
        counts.waiting,
        counts.skipped,
      ],
    )
    await tx.query('update connectors set failures=0, next_read_at=$2 where id=$1', [
      source.id,
      nextReadAt(clock.now(), { ...schedule, failures: 0 }),
    ])
    return {
      readId,
      status: complete ? 'ok' : 'partial',
      documentsSeen: read.documents.length + read.unread.length,
      ...counts,
    }
  }
}
