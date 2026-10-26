import { beforeAll, describe, expect, it } from 'vitest'
import { localRoles, identifier } from '../../src/server/db/roles.ts'
import { accept, foundation, people, publish, version } from './fixtures.ts'
import { testDatabase, transaction } from './support.ts'

/*
  The tables and the function the review of Heed v1 reads (0005_review_path.sql), as the
  service's own role meets them: read receipts are each person's own (FR-226), the answer to a
  clash is an owner's or an administrator's, written once (FR-225), and a suggestion's difference
  starts from the version in service it was written against (FR-224).
*/

const { client } = testDatabase()

let live = ''
let proposed = ''
let resubmitted = ''
let proposal = ''
let otherProposal = ''
let clashing = ''

async function asApi<T>(person: string | null, work: () => Promise<T>) {
  await client.query(`set role ${identifier(localRoles.api)}`)
  try {
    return await transaction(client, async () => {
      await client.query("select set_config('cl.person_id',$1,true)", [person ?? ''])
      return work()
    })
  } finally {
    await client.query(`set role ${identifier(localRoles.owner)}`)
  }
}

const submittedProposal = async (versionId: string, state = 'submitted') =>
  (
    await client.query<{ id: string }>(
      `insert into proposals (action,state,area_id,item_id,item_version_id,proposer_id,channel,submitted_at,closed_at)
       select 'change',$2::proposal_state,area_id,item_id,id,proposer_id,'form',now(),
              case when $2 in ('accepted','rejected','withdrawn') then now() end
         from item_versions where id=$1 returning id::text`,
      [versionId, state],
    )
  ).rows[0]!.id

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    const first = await version(client, { title: 'Orders in Norway' })
    await accept(client, first.id)
    await publish(client, first.id)
    live = first.id
    const other = await version(client, { title: 'Orders in Norway, another item' })
    await accept(client, other.id)
    await publish(client, other.id)
    clashing = other.item
    // A change written against the live version, then sent again: its base is still the live one.
    const second = await version(client, {
      item: first.item,
      previous: first.id,
      author: people.author,
    })
    const third = await version(client, {
      item: first.item,
      previous: second.id,
      author: people.author,
    })
    proposed = second.id
    resubmitted = third.id
    proposal = await submittedProposal(third.id)
    otherProposal = await submittedProposal(
      (await version(client, { author: people.author, title: 'Decided already' })).id,
      'rejected',
    )
  })
})

describe('the version a suggestion was written against (FR-224)', () => {
  it('is the version in service, through any resubmission', async () => {
    const base = async (id: string) =>
      (
        await asApi(people.owner, () =>
          client.query<{ id: string | null }>('select cl_proposal_base($1)::text as id', [id]),
        )
      ).rows[0]!.id
    expect(await base(proposed)).toBe(live)
    expect(await base(resubmitted)).toBe(live)
    // A version in service has no base of its own.
    expect(await base(live)).toBeNull()
  })
})

describe('read receipts (FR-226)', () => {
  it("keeps each person's own, for a suggestion they can see, and shows nobody else's", async () => {
    await asApi(people.owner, () =>
      client.query(
        `insert into review_reads (proposal_id,person_id,item_version_id,read_at)
         values ($1,cl_person(),$2,now())`,
        [proposal, resubmitted],
      ),
    )
    await asApi(people.author, () =>
      client.query('insert into review_reads (proposal_id,person_id) values ($1,cl_person())', [
        proposal,
      ]),
    )
    const mine = await asApi(people.author, () =>
      client.query<{ person: string }>('select person_id::text as person from review_reads'),
    )
    expect(mine.rows).toEqual([{ person: people.author }])
    const opened = await asApi(people.author, () =>
      client.query(
        'update review_reads set item_version_id=$2, read_at=now() where proposal_id=$1 returning 1',
        [proposal, resubmitted],
      ),
    )
    expect(opened.rowCount).toBe(1)
    // Nobody changes another person's receipt, or writes one for them.
    const theirs = await asApi(people.author, () =>
      client.query('update review_reads set read_at=null where person_id=$1 returning 1', [
        people.owner,
      ]),
    )
    expect(theirs.rowCount).toBe(0)
    await expect(
      asApi(people.author, () =>
        client.query('insert into review_reads (proposal_id,person_id) values ($1,$2)', [
          proposal,
          people.admin,
        ]),
      ),
    ).rejects.toThrow(/row-level security/)
    // Nor for a suggestion they cannot see.
    await expect(
      asApi(people.stranger, () =>
        client.query('insert into review_reads (proposal_id,person_id) values ($1,cl_person())', [
          proposal,
        ]),
      ),
    ).rejects.toThrow(/row-level security/)
    expect((await asApi(null, () => client.query('select 1 from review_reads'))).rowCount).toBe(0)
  })

  it('reads a suggestion only on a version, and never before it was opened', async () => {
    await expect(
      asApi(people.admin, () =>
        client.query(
          'insert into review_reads (proposal_id,person_id,read_at) values ($1,cl_person(),now())',
          [proposal],
        ),
      ),
    ).rejects.toThrow(/review_reads_read_version/)
    await expect(
      asApi(people.admin, () =>
        client.query(
          `insert into review_reads (proposal_id,person_id,item_version_id,opened_at,read_at)
           values ($1,cl_person(),$2,now(),now()-interval '1 minute')`,
          [proposal, resubmitted],
        ),
      ),
    ).rejects.toThrow(/review_reads_read_after_open/)
  })

  it('lets the service never delete one, nor change who it is for', async () => {
    const privilege = async (what: string) =>
      (await client.query<{ allowed: boolean }>(`select ${what} as allowed`, [localRoles.api]))
        .rows[0]!.allowed
    expect(await privilege("has_table_privilege($1,'review_reads','DELETE')")).toBe(false)
    expect(await privilege("has_column_privilege($1,'review_reads','person_id','UPDATE')")).toBe(
      false,
    )
    expect(await privilege("has_column_privilege($1,'review_reads','proposal_id','UPDATE')")).toBe(
      false,
    )
    expect(await privilege("has_column_privilege($1,'review_reads','read_at','UPDATE')")).toBe(true)
  })
})

describe('how a suggestion relates to a live item it clashes with (FR-225)', () => {
  const answer = (
    person: string,
    relation: string,
    patch: { version?: string; item?: string; proposal?: string } = {},
  ) =>
    asApi(person, () =>
      client.query(
        `insert into proposal_relations (proposal_id,item_version_id,item_id,relation,decided_by)
         values ($1,$2,$3,$4::proposal_relation,cl_person()) returning id::text`,
        [
          patch.proposal ?? proposal,
          patch.version ?? resubmitted,
          patch.item ?? clashing,
          relation,
        ],
      ),
    )

  it('takes an answer from an owner of its domain or an administrator, for the version under review', async () => {
    expect((await answer(people.owner, 'disagrees')).rowCount).toBe(1)
    expect((await answer(people.admin, 'replaces')).rowCount).toBe(1)
    // The newest answer for the version and the item counts.
    const current = await asApi(people.author, () =>
      client.query<{ relation: string }>(
        `select relation::text from proposal_relations where item_version_id=$1 and item_id=$2
          order by decided_at desc, id desc limit 1`,
        [resubmitted, clashing],
      ),
    )
    expect(current.rows).toEqual([{ relation: 'replaces' }])
  })

  it('refuses anyone else, another version, its own item and a decided suggestion', async () => {
    for (const person of [people.author, people.approver, people.stranger])
      await expect(answer(person, 'unrelated')).rejects.toThrow(/row-level security/)
    await expect(answer(people.owner, 'unrelated', { version: proposed })).rejects.toThrow(
      /row-level security/,
    )
    const own = (
      await client.query<{ item: string }>(
        'select item_id as item from item_versions where id=$1',
        [resubmitted],
      )
    ).rows[0]!.item
    await expect(answer(people.owner, 'unrelated', { item: own })).rejects.toThrow(
      /row-level security/,
    )
    const decided = (
      await client.query<{ version: string }>(
        'select item_version_id::text as version from proposals where id=$1',
        [otherProposal],
      )
    ).rows[0]!.version
    await expect(
      answer(people.owner, 'unrelated', { proposal: otherProposal, version: decided }),
    ).rejects.toThrow(/row-level security/)
    // As someone else: the answer names who gave it.
    await expect(
      asApi(people.owner, () =>
        client.query(
          `insert into proposal_relations (proposal_id,item_version_id,item_id,relation,decided_by)
           values ($1,$2,$3,'unrelated',$4)`,
          [proposal, resubmitted, clashing, people.admin],
        ),
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('shows the answers to whoever sees the suggestion, and to nobody else', async () => {
    const seen = (person: string | null) =>
      asApi(person, async () => (await client.query('select 1 from proposal_relations')).rowCount)
    expect(await seen(people.author)).toBe(2)
    expect(await seen(people.owner)).toBe(2)
    expect(await seen(people.stranger)).toBe(0)
    expect(await seen(null)).toBe(0)
  })

  it('never changes or removes an answer', async () => {
    for (const verb of [
      "update proposal_relations set relation='unrelated'",
      'delete from proposal_relations',
    ])
      await expect(asApi(people.admin, () => client.query(verb))).rejects.toMatchObject({
        code: '42501',
      })
    // Not even the owner role of the database: an answer is history (append-only).
    await expect(
      transaction(client, () => client.query("update proposal_relations set relation='unrelated'")),
    ).rejects.toThrow(/append-only/)
    await expect(
      transaction(client, () => client.query('truncate proposal_relations')),
    ).rejects.toThrow(/append-only/)
  })
})
