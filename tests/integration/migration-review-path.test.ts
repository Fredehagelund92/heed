import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { migrate, migrationDirectory } from '../../src/server/db/migrate.ts'
import { accept, foundation, people, publish, version } from './fixtures.ts'
import { testDatabase, transaction } from './support.ts'

const { client } = testDatabase({ unmigrated: true })

/*
  0005_review_path.sql: one review path for every context item. A database at 0004 holds a
  high-risk version an owner accepted that waits for its approver, and a normal one whose answer
  tests were still due. After the migration both need only levels 1 to 3 and the accept they have,
  nothing queues answer tests any more, and the review's new tables are there with their row
  security. (A test file shares one database, so the whole change is one test.)
*/

async function atVersion4() {
  const before = await mkdtemp(join(tmpdir(), 'heed-migration-0004-'))
  for (const name of [
    '0001_baseline.sql',
    '0002_edition_digest_byte_order.sql',
    '0003_agent_wording.sql',
    '0004_agent_contract.sql',
  ])
    await copyFile(new URL(name, migrationDirectory), join(before, name))
  expect(await migrate(client, pathToFileURL(`${before}/`))).toBe(4)
  return before
}

it('takes risk and the approver out of the gate, and adds what the review reads', async () => {
  const before = await atVersion4()
  try {
    await foundation(client)
    const problem = async (id: string) =>
      (
        await client.query<{ problem: string | null }>(
          'select cl_item_version_problem($1) as problem',
          [id],
        )
      ).rows[0]!.problem
    const { high, normal } = await transaction(client, async () => {
      // A first edition, so a version can be due for answer tests.
      const first = await version(client)
      await accept(client, first.id)
      await publish(client, first.id)
      const high = await version(client, { risk: 'high', title: 'High, waiting for the approver' })
      await accept(client, high.id)
      const normal = await version(client, { risk: 'normal', title: 'Normal, answer tests due' })
      await client.query(
        `insert into proposals (action,state,area_id,item_id,item_version_id,proposer_id,channel,submitted_at)
         select 'create','submitted',area_id,item_id,id,proposer_id,'form',now() from item_versions where id=$1`,
        [normal.id],
      )
      return { high, normal }
    })
    expect(await problem(high.id)).toBe('high risk needs an accept decision by a named approver')
    const due = await client.query<{ version: string }>(
      'select version_id::text as version from cl_eval_versions_due()',
    )
    expect(due.rows.map((r) => r.version)).toContain(normal.id)

    expect(await migrate(client)).toBe(1)

    // Every risk level needs levels 1 to 3, and the owner's accept is all the high one needs.
    const levels = await client.query<{ risk: string; levels: string[] }>(
      `select r::text as risk, cl_required_levels(r)::text[] as levels
         from unnest(enum_range(null::risk_level)) as r order by r`,
    )
    expect(levels.rows).toEqual(
      ['low', 'normal', 'high'].map((risk) => ({
        risk,
        levels: ['format', 'matching', 'delivery'],
      })),
    )
    expect(await problem(high.id)).toBeNull()
    expect(await problem(normal.id)).toBe(
      'no accept decision by an owner of the domain or an administrator',
    )
    // The approver's own accept never stood in for an owner's, and still does not.
    const approverOnly = await transaction(client, async () => {
      const v = await version(client, { risk: 'high' })
      await accept(client, v.id, { actor: people.approver })
      return v.id
    })
    expect(await problem(approverOnly)).toBe(
      'no accept decision by an owner of the domain or an administrator',
    )
    const gone = await client.query("select to_regprocedure('cl_eval_versions_due()') as fn")
    expect(gone.rows).toEqual([{ fn: null }])

    // The review's records, with their row security, and the base of a suggestion's difference.
    const tables = await client.query<{ name: string; rls: boolean }>(
      `select relname as name, relrowsecurity as rls from pg_class
        where relname in ('review_reads','proposal_relations') order by relname`,
    )
    expect(tables.rows).toEqual([
      { name: 'proposal_relations', rls: true },
      { name: 'review_reads', rls: true },
    ])
    const relations = await client.query<{ value: string }>(
      'select unnest(enum_range(null::proposal_relation))::text as value',
    )
    expect(relations.rows.map((r) => r.value)).toEqual(['replaces', 'disagrees', 'unrelated'])
    const triggers = await client.query<{ name: string }>(
      `select tgname as name from pg_trigger where tgrelid='public.proposal_relations'::regclass
        and not tgisinternal order by tgname`,
    )
    expect(triggers.rows.map((r) => r.name)).toEqual([
      'ao_row_proposal_relations',
      'ao_trunc_proposal_relations',
    ])
    expect(
      (await client.query("select to_regprocedure('cl_proposal_base(uuid)') is not null as ok"))
        .rows,
    ).toEqual([{ ok: true }])
    expect(await migrate(client)).toBe(0)
  } finally {
    await rm(before, { recursive: true })
  }
})
