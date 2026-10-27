import { ORPCError } from '@orpc/client'
import type {
  DefinitionCoverage,
  DeletedTerm,
  Term,
  TermChangeResult,
  TermCreateInput,
  TermList,
  TermRestoreResult,
  TermUpdateInput,
  TermVersion,
} from '../../../contract/terms.ts'
import {
  parseTermRef,
  termName,
  termRefOf,
  termsSummary,
  termWord,
  wordRefusal,
  type TermRefusal,
  type WordHolder,
} from '../../../domain/terms.ts'
import type { Queryable } from '../../db/database.ts'
import { connectorType } from '../connectors/index.ts'

/**
 * Terms and synonyms (FR-138): the words people write in Definitions. A term has its own meaning;
 * a synonym is another name for a metric, a dimension or a term. One word has one meaning across
 * the workspace: a word the vocabulary, the definitions source or another term already uses is
 * refused, naming who has it (`wordRefusal`). An owner of the term's domain or an admin writes it;
 * a synonym's domain is what it means. Nothing is ever removed: a deleted term keeps its row, its
 * synonyms go with it, and it can be restored. A change to many terms records one term_changes
 * row, and its Undo takes back exactly what it did, within limits.undo_seconds, by its maker only.
 * Row security and the database's own checks (db/migrations/0009_terms.sql) keep the same rules
 * on every path; agents do not read terms yet.
 */
export type TermsService = ReturnType<typeof createTermsService>

type Row = {
  id: string
  name: string
  word: string
  meaning: string | null
  sameAsKey: string | null
  sameAsTerm: string | null
  /** What a synonym means, by name, and whether agents get it now. */
  targetName: string | null
  targetType: 'metric' | 'dimension' | 'term' | null
  targetLive: boolean
  areaId: string | null
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  revision: number
  deletedAt: string | null
  deletedWith: string | null
  canChange: boolean
}

/** What a synonym would mean: a metric, a dimension or a term with its own meaning. */
type Point = {
  ref: string
  name: string
  type: 'metric' | 'dimension' | 'term'
  key: string | null
  term: string | null
  areaId: string | null
}

const iso = (column: string) =>
  `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

/** The live vocabulary's metrics and dimensions, by key. */
const liveVocabulary = `
  select s.term_key as key, v.name, t.kind::text as kind,
         coalesce(v.area_id, d.area_id) as area_id
    from vocab_term_service s
    join vocab_term_versions v on v.id = s.version_id
    join vocab_terms t on t.key = s.term_key
    left join source_domain_service d on d.term_key = s.term_key and d.editions @> (select seq from live_edition)
   where s.editions @> (select seq from live_edition) and t.kind in ('metric', 'dimension')`

/** Every term the person may read, with what a synonym means. */
const termRows = `
  with live as materialized (${liveVocabulary})
  select t.id::text, t.name, t.word, t.meaning, t.same_as_key as "sameAsKey",
         t.same_as_term::text as "sameAsTerm",
         coalesce(l.name, m.name,
                  (select v.name from vocab_term_versions v where v.term_key = t.same_as_key
                    order by v.version_no desc limit 1)) as "targetName",
         case when t.same_as_term is not null then 'term'
              when t.same_as_key like 'metric:%' then 'metric'
              when t.same_as_key is not null then 'dimension' end as "targetType",
         (t.same_as_key is null or l.key is not null) as "targetLive",
         t.area_id as "areaId", t.created_by::text as "createdBy", ${iso('t.created_at')} as "createdAt",
         t.updated_by::text as "updatedBy", ${iso('t.updated_at')} as "updatedAt", t.revision,
         ${iso('t.deleted_at')} as "deletedAt", t.deleted_with::text as "deletedWith",
         (cl_is_admin_now() or (t.area_id is not null and cl_is_owner_now(t.area_id))) as "canChange"
    from terms t
    left join live l on l.key = t.same_as_key
    left join terms m on m.id = t.same_as_term`

/** Characters a PostgreSQL pattern reads as its own, escaped so a word matches as written. */
const patternOf = (name: string) =>
  `\\m${termName(name).replace(/[\\.^$*+?()[\]{}|-]/g, '\\$&')}s?\\M`

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'

export function createTermsService(tx: Queryable) {
  const names = {
    async person(id: string) {
      const [row] = await tx.query<{ name: string }>(
        'select display_name as name from people where id = $1::uuid',
        [id],
      )
      return row?.name ?? 'someone'
    },
    async area(id: string | null) {
      if (!id) return null
      const [row] = await tx.query<{ name: string }>('select name from areas where id = $1', [id])
      return row?.name ?? id
    },
  }

  async function me() {
    const [row] = await tx.query<{ admin: boolean }>('select cl_is_admin_now() as admin')
    return { admin: !!row?.admin }
  }

  async function mayWrite(areaId: string | null) {
    if ((await me()).admin) return true
    if (!areaId) return false
    const [row] = await tx.query<{ owner: boolean }>('select cl_is_owner_now($1) as owner', [
      areaId,
    ])
    return !!row?.owner
  }

  /** Why the person may not write a term of this domain. */
  async function forbidden(areaId: string | null) {
    return areaId
      ? `Only an owner of ${await names.area(areaId)} or an admin can change its terms.`
      : 'Only an admin can change a word that belongs to no domain.'
  }

  async function rows(where: string, values: unknown[] = []) {
    return tx.query<Row>(`${termRows} where ${where} order by t.word, t.id`, values)
  }

  async function rowOf(id: string) {
    const [row] = await rows('t.id = $1::uuid', [id])
    return row
  }

  /** What a synonym would mean, followed past a synonym to its meaning. */
  async function pointOf(ref: string): Promise<Point> {
    const parsed = parseTermRef(ref)
    if (parsed.key) {
      const [row] = await tx.query<{ key: string; name: string; kind: string; area_id: string }>(
        `with live as (${liveVocabulary}) select * from live where key = $1`,
        [parsed.key],
      )
      if (!row)
        throw new ORPCError('NOT_FOUND', {
          message: "What it is another name for isn't in Definitions any more.",
        })
      return {
        ref: row.key,
        name: row.name,
        type: row.kind === 'metric' ? 'metric' : 'dimension',
        key: row.key,
        term: null,
        areaId: row.area_id,
      }
    }
    const target = await rowOf(parsed.term!)
    if (!target || target.deletedAt)
      throw new ORPCError('NOT_FOUND', {
        message: "What it is another name for isn't in Definitions any more.",
      })
    // A synonym of a synonym means what that one means.
    if (target.sameAsKey) return pointOf(target.sameAsKey)
    if (target.sameAsTerm) return pointOf(`term:${target.sameAsTerm}`)
    return {
      ref: `term:${target.id}`,
      name: target.name,
      type: 'term',
      key: null,
      term: target.id,
      areaId: target.areaId,
    }
  }

  /** Everything that has the word now, besides the term `except`. */
  async function holders(word: string, except: string | null): Promise<WordHolder[]> {
    const vocabulary = await tx.query<{
      origin: 'vocabulary' | 'source'
      key: string
      name: string
      type: string | null
      connector: string | null
    }>(
      `select w.origin, w.key, w.name, c.type, c.name as connector
         from cl_vocabulary_words() w left join connectors c on c.id = w.connector_id
        where w.word = $1 order by w.origin, w.key`,
      [word],
    )
    const terms = await rows(
      't.word = $1 and t.deleted_at is null and t.id is distinct from $2::uuid',
      [word, except],
    )
    const found: WordHolder[] = vocabulary.map((h) => ({
      origin: h.origin,
      ref: h.key,
      name: h.name,
      tool: h.type ? connectorType(h.type, h.connector ?? '').tool : null,
    }))
    // One after the other: a transaction's client runs one query at a time.
    for (const t of terms) {
      const ref = termRefOf(t)
      found.push({
        origin: 'term',
        id: t.id,
        name: t.name,
        sameAs: ref ? { ref, name: t.targetName ?? '' } : null,
        by: await names.person(t.createdBy),
      })
    }
    return found
  }

  function refused(refusal: TermRefusal): never {
    throw new ORPCError('CONFLICT', {
      message: refusal.message,
      data: { refusal: { code: refusal.code, holder: refusal.holder, by: refusal.by } },
    })
  }

  /** A word taken while this write was on its way: someone else wrote it at the same moment. */
  function raced(name: string): never {
    throw new ORPCError('CONFLICT', {
      message: `“${termName(name)}” was just given a meaning. Look again, then try again.`,
    })
  }

  /** The person's view of a term, with its coverage and conflict. */
  function termOf(row: Row, items: Map<string, number>, conflict: Term['conflict']): Term {
    const ref = termRefOf(row)
    return {
      id: row.id,
      name: row.name,
      meaning: row.meaning,
      sameAs:
        ref && row.targetName && row.targetType
          ? { ref, name: row.targetName, type: row.targetType }
          : null,
      areaId: row.areaId,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
      revision: row.revision,
      items: row.meaning === null ? null : (items.get(row.id) ?? 0),
      conflict,
      canChange: row.canChange,
    }
  }

  /**
   * Why each written term misleads agents now: a sync gave its word to a metric or a dimension it
   * does not mean, or what it means is no longer in the definitions.
   */
  async function conflictsOf(terms: readonly Row[]): Promise<Map<string, Term['conflict']>> {
    const holders = await tx.query<{
      word: string
      key: string
      name: string
      type: string | null
      connector: string | null
    }>(
      `select w.word, w.key, w.name, c.type, c.name as connector
         from cl_vocabulary_words() w left join connectors c on c.id = w.connector_id
        where w.word = any ($1::text[]) order by w.origin, w.key`,
      [[...new Set(terms.map((t) => t.word))]],
    )
    const conflicts = new Map<string, Term['conflict']>()
    for (const row of terms) {
      if (!row.targetLive) {
        conflicts.set(row.id, {
          code: 'missing',
          holder: null,
          message: `${row.targetName ?? 'What it meant'} isn't in Definitions any more. Point ${row.name} at something else.`,
        })
        continue
      }
      const other = holders.find((h) => h.word === row.word && h.key !== row.sameAsKey)
      if (!other) continue
      const tool = other.type ? connectorType(other.type, other.connector ?? '').tool : null
      conflicts.set(row.id, {
        code: 'source',
        holder: other.name,
        message: `“${row.name}” already means ${other.name}${tool ? ` in ${tool}` : ' here'}${row.targetName ? `, and this term says it means ${row.targetName}` : ''}. An agent can't tell which one a person means. Rename this term or point it at ${other.name}.`,
      })
    }
    return conflicts
  }

  /** The person's view of these terms. */
  async function termsOf(found: readonly Row[]): Promise<Term[]> {
    const items = await termCoverage(found.map((row) => row.id))
    const conflicts = await conflictsOf(found)
    return found.map((row) => termOf(row, items, conflicts.get(row.id) ?? null))
  }

  /**
   * How many live context items each term with its own meaning is about: those agents get whose
   * words use the term, or one of its synonyms, as a word (a plural "s" too), by the audience rule.
   * `only` narrows it to those terms; each term reads every live item's words.
   */
  async function termCoverage(only?: readonly string[]): Promise<Map<string, number>> {
    if (only && !only.length) return new Map()
    const words = await tx.query<{ id: string; names: string[] }>(
      `select t.id::text, array_agg(n.name order by n.name) as names
         from terms t
         join lateral (select t.name union all
                       select s.name from terms s where s.same_as_term = t.id and s.deleted_at is null) n(name) on true
        where t.deleted_at is null and t.meaning is not null
          and ($1::uuid[] is null or t.id = any ($1::uuid[]))
        group by t.id`,
      [only ?? null],
    )
    if (!words.length) return new Map()
    const counts = await tx.query<{ id: string; items: number }>(
      `with live as materialized (
         select s.item_id, concat_ws(' ', s.title, s.summary, s.body) as text
           from serving_items((select seq from live_edition)) s
          where cl_audience_allows(s.audience_groups))
       select w.id, (select count(*)::int from live i where i.text ~* any (w.patterns)) as items
         from jsonb_to_recordset($1::jsonb) as w(id text, patterns text[])`,
      [JSON.stringify(words.map((w) => ({ id: w.id, patterns: w.names.map(patternOf) })))],
    )
    return new Map(counts.map((c) => [c.id, c.items]))
  }

  async function list(): Promise<TermList> {
    return { terms: await termsOf(await rows('t.deleted_at is null')) }
  }

  async function view(id: string): Promise<Term> {
    const row = await rowOf(id)
    if (!row) throw new ORPCError('NOT_FOUND')
    return (await termsOf([row]))[0]!
  }

  /** The fields a write keeps: the word, and its own meaning or what it means, in its domain. */
  async function fieldsOf(input: TermCreateInput, self: string | null) {
    if ((input.meaning === undefined) === (input.sameAs === undefined))
      throw new ORPCError('BAD_REQUEST', {
        message: 'Give the word its own meaning, or say what it is another name for.',
      })
    const name = termName(input.name)
    const point = input.sameAs ? await pointOf(input.sameAs) : null
    if (point && self && point.term === self)
      throw new ORPCError('BAD_REQUEST', { message: "A word can't be another name for itself." })
    return {
      name,
      word: termWord(name),
      meaning: point ? null : input.meaning!.trim(),
      point,
      areaId: point ? point.areaId : (input.areaId ?? null),
    }
  }

  async function create(input: TermCreateInput): Promise<Term> {
    const fields = await fieldsOf(input, null)
    if (!(await mayWrite(fields.areaId)))
      throw new ORPCError('FORBIDDEN', { message: await forbidden(fields.areaId) })
    const refusal = wordRefusal(fields.name, await holders(fields.word, null), fields.point)
    if (refusal) refused(refusal)
    try {
      const [made] = await tx.query<{ id: string }>(
        `insert into terms (name, meaning, same_as_key, same_as_term, area_id, created_by, updated_by)
         values ($1, $2, $3, $4::uuid, $5, cl_person(), cl_person()) returning id::text`,
        [
          fields.name,
          fields.meaning,
          fields.point?.key ?? null,
          fields.point?.term ?? null,
          fields.areaId,
        ],
      )
      return view(made!.id)
    } catch (error) {
      if (isUniqueViolation(error)) raced(fields.name)
      throw error
    }
  }

  async function update(input: TermUpdateInput): Promise<Term> {
    const row = await rowOf(input.id)
    if (!row || row.deletedAt) throw new ORPCError('NOT_FOUND')
    if (!row.canChange) throw new ORPCError('FORBIDDEN', { message: await forbidden(row.areaId) })
    if (row.revision !== input.revision)
      throw new ORPCError('CONFLICT', {
        message: 'Someone changed this word after you opened it. Look at it again, then try again.',
      })
    const fields = await fieldsOf(input, row.id)
    if (fields.areaId !== row.areaId && !(await mayWrite(fields.areaId)))
      throw new ORPCError('FORBIDDEN', { message: await forbidden(fields.areaId) })
    if (fields.point) {
      const [pointed] = await tx.query<{ n: number }>(
        `select count(*)::int as n from terms where same_as_term = $1::uuid and deleted_at is null`,
        [row.id],
      )
      if (pointed!.n)
        throw new ORPCError('CONFLICT', {
          message: `Other words are another name for “${row.name}”, so it keeps its own meaning. Point them at something else first.`,
        })
    }
    // The word claims a meaning again only when it or what it means changes: a conflict a sync
    // made later stays visible, and the term can still be edited until its owner settles it.
    const claims = fields.word !== row.word || (fields.point?.ref ?? null) !== termRefOf(row)
    if (claims) {
      const refusal = wordRefusal(fields.name, await holders(fields.word, row.id), fields.point)
      if (refusal) refused(refusal)
    }
    try {
      await tx.query(
        `update terms set name = $2, meaning = $3, same_as_key = $4, same_as_term = $5::uuid,
                area_id = $6, updated_by = cl_person()
          where id = $1::uuid`,
        [
          row.id,
          fields.name,
          fields.meaning,
          fields.point?.key ?? null,
          fields.point?.term ?? null,
          fields.areaId,
        ],
      )
    } catch (error) {
      if (isUniqueViolation(error)) raced(fields.name)
      throw error
    }
    return view(row.id)
  }

  /** One change to many terms, recorded for its Undo. */
  async function record(
    action: 'deleted' | 'moved',
    summary: string,
    changed: Row[],
    undo: object,
  ) {
    const [made] = await tx.query<{ id: string }>(
      `insert into term_changes (action, made_by, summary, terms, undo)
       values ($1, cl_person(), $2, $3::jsonb, $4::jsonb) returning id::text`,
      [
        action,
        summary,
        JSON.stringify(changed.map((t) => ({ id: t.id, name: t.name, areaId: t.areaId }))),
        JSON.stringify(undo),
      ],
    )
    return `terms:${made!.id}`
  }

  /** The terms asked for, in the order asked, each once; those the person may not read are gone. */
  async function asked(ids: readonly string[]) {
    const unique = [...new Set(ids)]
    const found = new Map(
      (await rows('t.id = any($1::uuid[])', [unique])).map((row) => [row.id, row]),
    )
    return unique.map((id) => ({ id, row: found.get(id) }))
  }

  const gone = (id: string) => ({
    id,
    name: '',
    message: "It isn't in Definitions any more.",
  })

  async function remove({ ids }: { ids: string[] }): Promise<TermChangeResult> {
    const skipped: TermChangeResult['skipped'] = []
    const chosen: Row[] = []
    for (const { id, row } of await asked(ids)) {
      if (!row || row.deletedAt) skipped.push(gone(id))
      else if (!row.canChange)
        skipped.push({ id, name: row.name, message: await forbidden(row.areaId) })
      else chosen.push(row)
    }
    const deleting = new Set(chosen.map((t) => t.id))
    // A term's synonyms go with it: they only meant it.
    const along = chosen.length
      ? await rows('t.same_as_term = any($1::uuid[]) and t.deleted_at is null', [[...deleting]])
      : []
    const done: Row[] = [...chosen]
    for (const synonym of along)
      if (!deleting.has(synonym.id)) {
        deleting.add(synonym.id)
        done.push(synonym)
      }
    if (!done.length) return { done: [], skipped, undo: null }
    const roots = new Set(chosen.map((t) => t.id))
    // Synonyms first: a term goes only once nothing points at it.
    for (const t of [...done].sort((a, b) => Number(!!b.sameAsTerm) - Number(!!a.sameAsTerm)))
      await tx.query(
        `update terms set deleted_at = now(), deleted_with = $2::uuid, updated_by = cl_person()
          where id = $1::uuid`,
        [t.id, t.sameAsTerm && roots.has(t.sameAsTerm) && !roots.has(t.id) ? t.sameAsTerm : null],
      )
    const undo = await record(
      'deleted',
      termsSummary(
        'Deleted',
        chosen.map((t) => t.name),
      ),
      done,
      { terms: done.map((t) => t.id) },
    )
    return { done: done.map((t) => ({ id: t.id, name: t.name })), skipped, undo }
  }

  async function move({ ids, areaId }: { ids: string[]; areaId: string }) {
    const [area] = await tx.query<{ name: string }>('select name from areas where id = $1', [
      areaId,
    ])
    if (!area) throw new ORPCError('NOT_FOUND', { message: 'Choose a domain that exists.' })
    const skipped: TermChangeResult['skipped'] = []
    const moving: Row[] = []
    const mayMoveThere = await mayWrite(areaId)
    for (const { id, row } of await asked(ids)) {
      if (!row || row.deletedAt) skipped.push(gone(id))
      else if (row.meaning === null)
        skipped.push({
          id,
          name: row.name,
          message: `A synonym is in the domain of what it means: move ${row.targetName ?? 'that'} instead.`,
        })
      else if (row.areaId === areaId)
        skipped.push({ id, name: row.name, message: `It is in ${area.name} already.` })
      else if (!row.canChange)
        skipped.push({ id, name: row.name, message: await forbidden(row.areaId) })
      else if (!mayMoveThere) skipped.push({ id, name: row.name, message: await forbidden(areaId) })
      else moving.push(row)
    }
    if (!moving.length) return { done: [], skipped, undo: null }
    for (const t of moving)
      await tx.query(
        'update terms set area_id = $2, updated_by = cl_person() where id = $1::uuid',
        [t.id, areaId],
      )
    const undo = await record(
      'moved',
      termsSummary(
        `Moved to ${area.name}:`,
        moving.map((t) => t.name),
      ),
      moving,
      { areas: Object.fromEntries(moving.map((t) => [t.id, t.areaId])) },
    )
    return { done: moving.map((t) => ({ id: t.id, name: t.name })), skipped, undo }
  }

  /**
   * Brings one deleted term back, if its word still means nothing else; null when it did, or the
   * sentence that says why not.
   */
  async function bringBack(row: Row): Promise<string | null> {
    if (!row.targetLive || (row.sameAsTerm && !(await liveTerm(row.sameAsTerm))))
      return `What “${row.name}” meant isn't in Definitions any more.`
    const point = termRefOf(row) ? { ref: termRefOf(row)!, name: row.targetName ?? '' } : null
    const refusal = wordRefusal(row.name, await holders(row.word, row.id), point)
    if (refusal) return refusal.message
    await tx.query('savepoint term_restore')
    try {
      await tx.query(
        'update terms set deleted_at = null, updated_by = cl_person() where id = $1::uuid',
        [row.id],
      )
      await tx.query('release savepoint term_restore')
      return null
    } catch (error) {
      await tx.query('rollback to savepoint term_restore')
      if (isUniqueViolation(error))
        return `“${row.name}” means something else now, so it stays deleted.`
      throw error
    }
  }

  async function liveTerm(id: string) {
    const [row] = await tx.query<{ id: string }>(
      'select id from terms where id = $1::uuid and deleted_at is null and meaning is not null',
      [id],
    )
    return !!row
  }

  async function restore({ ids }: { ids: string[] }): Promise<TermRestoreResult> {
    const restored: TermRestoreResult['restored'] = []
    const skipped: TermRestoreResult['skipped'] = []
    for (const { id, row } of await asked(ids)) {
      if (!row) skipped.push(gone(id))
      else if (!row.deletedAt)
        skipped.push({ id, name: row.name, message: 'It is in Definitions already.' })
      else if (!row.canChange)
        skipped.push({ id, name: row.name, message: await forbidden(row.areaId) })
      else {
        const why = await bringBack(row)
        if (why) {
          skipped.push({ id, name: row.name, message: why })
          continue
        }
        restored.push({ id, name: row.name })
        // The synonyms deleted with it come back with it, where their word is still free.
        for (const synonym of await rows('t.deleted_with = $1::uuid and t.deleted_at is not null', [
          row.id,
        ])) {
          const not = await bringBack(synonym)
          if (not) skipped.push({ id: synonym.id, name: synonym.name, message: not })
          else restored.push({ id: synonym.id, name: synonym.name })
        }
      }
    }
    return { restored, skipped }
  }

  async function undoChange(id: string): Promise<{ edition: string | null }> {
    const [change] = await tx.query<{
      action: 'deleted' | 'moved'
      undo: { terms?: string[]; areas?: Record<string, string | null> }
      mine: boolean
      undone: boolean
    }>(
      `select action, undo, made_by = cl_person() as mine, undone_at is not null as undone
         from term_changes where id = $1::uuid`,
      [id],
    )
    if (!change) throw new ORPCError('NOT_FOUND')
    if (!change.mine)
      throw new ORPCError('FORBIDDEN', {
        message: 'Only the person who made the change can undo it.',
      })
    if (change.undone)
      throw new ORPCError('CONFLICT', { message: 'This change is already undone.' })
    const [marked] = await tx.query<{ id: string }>(
      'update term_changes set undone_at = now() where id = $1::uuid returning id::text',
      [id],
    )
    if (!marked)
      throw new ORPCError('CONFLICT', {
        message: 'It is too late to undo this change. Change them again instead.',
      })
    if (change.action === 'moved') {
      for (const [termId, areaId] of Object.entries(change.undo.areas ?? {}))
        await tx.query(
          `update terms set area_id = $2, updated_by = cl_person()
            where id = $1::uuid and deleted_at is null`,
          [termId, areaId],
        )
      return { edition: null }
    }
    // Terms with their own meaning first: a synonym comes back once what it means is back.
    const back = await rows('t.id = any($1::uuid[]) and t.deleted_at is not null', [
      change.undo.terms ?? [],
    ])
    for (const row of back.sort((a, b) => Number(!!a.sameAsTerm) - Number(!!b.sameAsTerm))) {
      const why = await bringBack(row)
      if (why) throw new ORPCError('CONFLICT', { message: why })
    }
    return { edition: null }
  }

  async function deleted(): Promise<DeletedTerm[]> {
    const found = await tx.query<{
      id: string
      name: string
      sameAs: string | null
      areaId: string | null
      personId: string
      at: string
      synonyms: string[]
    }>(
      `with live as materialized (${liveVocabulary})
       select t.id::text, t.name, coalesce(l.name, m.name) as "sameAs", t.area_id as "areaId",
              t.deleted_by::text as "personId", ${iso('t.deleted_at')} as at,
              array(select s.name from terms s where s.deleted_with = t.id and s.deleted_at is not null
                     order by s.word) as synonyms
         from terms t
         left join live l on l.key = t.same_as_key
         left join terms m on m.id = t.same_as_term
        where t.deleted_at is not null and t.deleted_with is null
        order by t.deleted_at desc, t.word`,
    )
    return found
  }

  async function history(id: string): Promise<TermVersion[]> {
    const row = await rowOf(id)
    if (!row) throw new ORPCError('NOT_FOUND')
    return tx.query<TermVersion>(
      `select v.revision, v.change, v.name, v.meaning,
              coalesce(m.name, (select x.name from vocab_term_versions x where x.term_key = v.same_as_key
                                 order by x.version_no desc limit 1)) as "sameAs",
              v.area_id as "areaId", v.made_by::text as "personId", ${iso('v.made_at')} as at
         from term_versions v left join terms m on m.id = v.same_as_term
        where v.term_id = $1::uuid
        order by v.revision desc`,
      [id],
    )
  }

  async function coverage(): Promise<DefinitionCoverage> {
    const metrics = await tx.query<{
      ref: string
      name: string
      areaId: string | null
      items: number
    }>(
      `with live as materialized (${liveVocabulary}),
       served as materialized (
         select s.item_id, s.metrics from serving_items((select seq from live_edition)) s
          where cl_audience_allows(s.audience_groups))
       select l.key as ref, l.name, l.area_id as "areaId",
              (select count(*)::int from served i where l.key = any (i.metrics)) as items
         from live l
        where l.kind = 'metric'
          -- As the catalogue: a metric whose definition the source limits to groups is left out.
          and not exists (
            select 1 from vocab_term_service s join vocab_term_refs r on r.version_id = s.version_id
              join definitions d on d.ref = r.definition_ref
             where s.term_key = l.key and s.editions @> (select seq from live_edition)
               and d.visible_groups is not null)`,
    )
    const items = await termCoverage()
    const terms = await rows('t.deleted_at is null and t.meaning is not null')
    const all: DefinitionCoverage['rows'] = [
      ...metrics.map((m) => ({ ...m, type: 'metric' as const })),
      ...terms.map((t) => ({
        ref: `term:${t.id}`,
        name: t.name,
        type: 'term' as const,
        areaId: t.areaId,
        items: items.get(t.id) ?? 0,
      })),
    ].sort(
      (a, b) => Number(b.items === 0) - Number(a.items === 0) || a.name.localeCompare(b.name, 'en'),
    )
    return {
      measurable: all.length,
      uncovered: all.filter((r) => r.items === 0).length,
      rows: all,
    }
  }

  return {
    list,
    create,
    update,
    remove,
    move,
    restore,
    undoChange,
    deleted,
    history,
    coverage,
  }
}
