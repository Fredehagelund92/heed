import { ORPCError } from '@orpc/client'
import type {
  DecideNames,
  NamesDecision,
  NamesRead,
  SourceNameRead,
} from '../../../contract/inbox.ts'
import { contentDigest } from '../../../domain/canonical.ts'
import { nameRefusal, sourceNames, wordsOf, type SourceName } from '../../../domain/source-names.ts'
import { memberName } from '../../../domain/term-candidates.ts'
import { termName, termWord } from '../../../domain/terms.ts'
import { termDigestContent } from '../../../domain/vocabulary.ts'
import type { Queryable } from '../../db/database.ts'
import { recordAudit } from '../admin/index.ts'
import { connectorType } from '../connectors/index.ts'
import { lockReleases, publishEdition } from '../editions/index.ts'
import { wordHolders } from '../terms/index.ts'
import { proposalEvents } from './records.ts'
import { sourceVocabulary } from './vocabulary.ts'

/*
  The names a read makes, and the one card an owner accepts them with (FR-141, CON-201, CON-206).

  A read stores definitions. Everything people and agents see reads terms, so a member reaches
  them once a term names it and an owner or an administrator accepts it (FR-125). The names are
  worked out from the stored definitions and the live vocabulary each time they are asked for, so
  one can never disagree with the source or with what is live now: a read that adds a metric adds
  its name, one that drops it drops the name, and a domain added later counts at once. The only
  thing kept is which members an owner left out (0042).

  Accepting goes the way every vocabulary change goes: a term version, an accepted proposal, a
  decision by an owner of its domain or an administrator, which the database checks, and an edition,
  which on a new install is the first. All the names of one step are one edition. The read that made
  a name is its only author, so its version names no proposer.
*/

export type NamesView = NamesRead & {
  /** When the newest of the names to look at was first read; null with none. */
  at: string | null
}

const REASON = 'Accepted the names a read made.'

/** The names as the person read them: any change to what they would decide changes this. */
const revisionOf = (names: readonly SourceNameRead[]) =>
  contentDigest(
    names.map(({ key, name, aliases, definitionRefs, linked, areaId, state, flags }) => ({
      key,
      name,
      aliases,
      definitionRefs,
      linked,
      areaId,
      state,
      flags: flags.map((flag) => flag.code),
    })),
  )

export type NamesService = ReturnType<typeof createNamesService>

export function createNamesService(tx: Queryable) {
  /** The domains the person accepts names of, and whether they accept those of no domain too. */
  async function mine() {
    const rows = await tx.query<{ id: string; owned: boolean }>(
      'select a.id, cl_is_owner_now(a.id) as owned from areas a where a.archived_at is null',
    )
    const [me] = await tx.query<{ admin: boolean }>('select cl_is_admin_now() as admin')
    return {
      admin: me?.admin === true,
      active: new Set(rows.map((row) => row.id)),
      owned: new Set(rows.filter((row) => row.owned).map((row) => row.id)),
    }
  }

  async function namesNow() {
    const { members, known } = await sourceVocabulary(tx)
    const who = await mine()
    const live = known.filter((term) => !term.open)
    // A hint never makes a domain (CON-206): one with no domain yet reads as none, for now.
    const mapped = members.map((member) => ({
      ...member,
      areaHint: member.areaHint && who.active.has(member.areaHint) ? member.areaHint : null,
    }))
    const left = await tx.query<{ ref: string }>('select definition_ref as ref from names_left_out')
    const sources = await tx.query<{ id: string; type: string; name: string }>(
      'select id,type,name from connectors',
    )
    const tool = (id: string) => {
      const source = sources.find((s) => s.id === id)
      return source ? connectorType(source.type, source.name).tool : id
    }
    const draft = sourceNames(mapped, live, new Map(), new Set())
    const holders = await wordHolders(tx, [
      ...new Set([...wordsOf(draft), ...members.map((member) => termWord(memberName(member)))]),
    ])
    const names = sourceNames(mapped, live, holders, new Set(left.map((row) => row.ref))).filter(
      (name) => who.admin || (name.areaId !== null && who.owned.has(name.areaId)),
    )
    return { names, tool, holders, who }
  }

  const asRead = (name: SourceName, tool: (id: string) => string): SourceNameRead => ({
    key: name.key,
    kind: name.kind,
    name: name.name,
    aliases: name.aliases,
    definitionRefs: name.definitionRefs,
    linked: name.linked,
    areaId: name.areaId,
    description: name.description,
    tool: tool(name.source),
    state: name.state,
    flags: name.flags,
    leftByOwner: name.leftByOwner,
  })

  async function read(): Promise<NamesView> {
    const { names, tool } = await namesNow()
    const shown = names.map((name) => asRead(name, tool))
    const looking = shown.filter((name) => name.state !== 'left_out')
    const [newest] = looking.length
      ? await tx.query<{ at: string | null }>(
          `select to_char(max(s.fetched_at) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as at
             from definitions d join connector_snapshots s on s.id=d.first_seen_snapshot
            where d.ref=any($1::text[])`,
          [looking.flatMap((name) => name.definitionRefs)],
        )
      : [{ at: null }]
    return { revision: await revisionOf(shown), names: shown, at: newest?.at ?? null }
  }

  /** Stores accepted names as terms, versions, accepted proposals and decisions, and their edition. */
  async function accept(
    picked: readonly (SourceName & { chosen: string })[],
    owned: ReadonlySet<string>,
    tool: (id: string) => string,
  ) {
    const rows = JSON.stringify(
      await Promise.all(
        picked.map(async (name) => {
          const term = {
            key: name.key,
            kind: name.kind,
            parentKey: null,
            name: name.chosen,
            aliases: name.aliases.filter((alias) => termWord(alias) !== termWord(name.chosen)),
            areaId: name.areaId,
            definitionRefs: name.definitionRefs,
          }
          return {
            ...term,
            digest: await contentDigest(termDigestContent(term)),
            action: name.linked.length ? 'change' : 'create',
            capacity: name.areaId && owned.has(name.areaId) ? 'owner' : 'administrator',
            draft: { ...term, base: null },
          }
        }),
      ),
    )
    const each = 'from jsonb_array_elements($1::jsonb) with ordinality as e(row, n)'
    await tx.query(
      `insert into vocab_terms(key,kind,parent_key)
       select row->>'key',(row->>'kind')::term_kind,null ${each} order by n
       on conflict (key) do nothing`,
      [rows],
    )
    const versions = await tx.query<{ id: string; key: string }>(
      `insert into vocab_term_versions(term_key,version_no,name,aliases,area_id,proposer_id,content_digest)
       select row->>'key',
              (select coalesce(max(version_no),0)+1 from vocab_term_versions where term_key=row->>'key'),
              row->>'name',array(select jsonb_array_elements_text(row->'aliases')),row->>'areaId',null,
              decode(row->>'digest','hex')
         ${each} order by n
       returning id::text,term_key as key`,
      [rows],
    )
    const versionOf = JSON.stringify(Object.fromEntries(versions.map((v) => [v.key, v.id])))
    await tx.query(
      `insert into vocab_term_refs(version_id,definition_ref)
       select (($2::jsonb)->>(row->>'key'))::uuid,jsonb_array_elements_text(row->'definitionRefs') ${each}`,
      [rows, versionOf],
    )
    const tools = [...new Set(picked.map((name) => tool(name.source)))]
    const [batch] = await tx.query<{ id: string }>(
      `insert into import_batches(created_by,mode,source_name,summary)
       values(cl_person(),'apply',$1,$2) returning id::text`,
      [tools.join(', '), JSON.stringify({ subject: 'vocabulary', terms: picked.length })],
    )
    const proposals = await tx.query<{
      id: string
      revision: number
      areaId: string | null
    }>(
      `insert into proposals(subject,action,state,area_id,proposer_id,channel,vocab_version_id,draft,reason,submitted_at,closed_at,import_batch_id)
       select 'vocabulary',(row->>'action')::proposal_action,'accepted',row->>'areaId',cl_person(),'import',
              (($2::jsonb)->>(row->>'key'))::uuid,row->'draft',$3,now(),now(),$4::uuid
         ${each} order by n
       returning id::text,revision,area_id as "areaId"`,
      [rows, versionOf, REASON, batch!.id],
    )
    const decisions = await tx.query<{ id: string; proposalId: string; capacity: string }>(
      `insert into decisions(proposal_id,vocab_version_id,area_id,decided_by,capacity,outcome,reason)
       select p.id,p.vocab_version_id,p.area_id,cl_person(),
              (select (row->>'capacity')::decision_capacity ${each}
                where (($3::jsonb)->>(row->>'key'))::uuid=p.vocab_version_id),'accept',$2
         from proposals p where p.id=any($4::uuid[])
       returning id::text,proposal_id::text as "proposalId",capacity::text`,
      [rows, REASON, versionOf, proposals.map((p) => p.id)],
    )
    const decisionOf = new Map(decisions.map((d) => [d.proposalId, d]))
    const areas = new Set(picked.map((name) => name.areaId))
    const edition = await publishEdition(
      tx,
      { reason: 'vocabulary_changed', vocabulary: versions.map((v) => v.id) },
      areas.size === 1 ? [...areas][0] : null,
    )
    await proposalEvents(
      tx,
      proposals.map((p) => ({
        p: { id: p.id, areaId: p.areaId, state: 'accepted', revision: p.revision },
        kind: 'decided',
        data: {
          decisionId: decisionOf.get(p.id)?.id,
          outcome: 'accept',
          capacity: decisionOf.get(p.id)?.capacity,
          reason: REASON,
          edition: edition.label,
        },
        audit: 'decision.accept',
      })),
    )
    return edition
  }

  async function decide(input: DecideNames): Promise<NamesDecision> {
    await lockReleases(tx)
    const { names, tool, holders, who } = await namesNow()
    const shown = names.map((name) => asRead(name, tool))
    if ((await revisionOf(shown)) !== input.revision)
      throw new ORPCError('CONFLICT', {
        message:
          'The names changed after you opened them. Look at the latest list, then try again.',
      })
    const byKey = new Map(names.map((name) => [name.key, name]))
    const found = (key: string) => {
      const name = byKey.get(key)
      if (!name)
        throw new ORPCError('CONFLICT', {
          message: 'A name here is no longer waiting. Look at the latest list, then try again.',
        })
      return name
    }
    const picked = input.accept.map(({ key, name }) => {
      const waiting = found(key)
      return { ...waiting, chosen: name === undefined ? waiting.name : termName(name) }
    })
    const left = input.leaveOut.map(found)
    const live = left.find((name) => name.linked.length)
    if (live)
      throw new ORPCError('UNPROCESSABLE_CONTENT', {
        message: `“${live.name}” is live already and gains a view when you publish it. It can't be left out.`,
      })
    const renamed = picked.find((name) => name.linked.length && name.chosen !== name.name)
    if (renamed)
      throw new ORPCError('UNPROCESSABLE_CONTENT', {
        message: `“${renamed.name}” is live already. Rename it where it is edited.`,
      })
    if (new Set([...picked, ...left].map((name) => name.key)).size !== picked.length + left.length)
      throw new ORPCError('CONFLICT', { message: 'Accept a name or leave it out, not both.' })
    const chosen = new Map(
      picked.map((name) => [
        name.key,
        [name.chosen, ...name.aliases.filter((alias) => termWord(alias) !== termWord(name.chosen))],
      ]),
    )
    // A name changed by hand can land on a word nobody read yet.
    const typed = picked.flatMap((name) => {
      const word = termWord(name.chosen)
      return holders.has(word) ? [] : [word]
    })
    const also = typed.length ? await wordHolders(tx, typed) : new Map()
    const known = new Map([...holders, ...also])
    const findings = picked.flatMap((name) => {
      const message = name.linked.length ? null : nameRefusal(name.key, name.chosen, known, chosen)
      return message
        ? [{ code: 'word_taken', field: name.key, message, severity: 'error' as const }]
        : []
    })
    if (findings.length)
      throw new ORPCError('UNPROCESSABLE_CONTENT', {
        message: findings[0]!.message,
        data: { findings },
      })
    const edition = picked.length ? await accept(picked, who.owned, tool) : null
    await tx.query('delete from names_left_out where definition_ref=any($1::text[])', [
      picked.flatMap((name) => name.definitionRefs),
    ])
    if (left.length) {
      await tx.query(
        `insert into names_left_out(definition_ref)
         select unnest($1::text[]) on conflict (definition_ref) do nothing`,
        [left.flatMap((name) => name.definitionRefs)],
      )
      await recordAudit(tx, {
        action: 'names.left_out',
        subjectType: 'names',
        subjectId: 'waiting',
        details: { names: left.map((name) => name.name) },
      })
    }
    return { edition: edition?.label ?? null, accepted: picked.length, leftOut: left.length }
  }

  return { read, decide }
}
