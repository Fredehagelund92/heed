import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { accept, foundation, openEdition, people, publish, version } from './fixtures.ts'
import { testDatabase, transaction } from './support.ts'

const { client } = testDatabase()
beforeAll(() => foundation(client))
it('refuses a version without a decision', async () => {
  await expect(
    transaction(client, async () => {
      const v = await version(client)
      await publish(client, v.id)
    }),
  ).rejects.toThrow('no accept decision by an owner of the domain or an administrator')
})
it('refuses missing and later failed checks', async () => {
  for (const missing of [true, false]) {
    await expect(
      transaction(client, async () => {
        const v = await version(client)
        await accept(client, v.id, { checks: !missing })
        if (!missing)
          await client.query(
            "insert into check_results (item_version_id,level,outcome,ran_at) values ($1,'format','failed',now()+interval '1 second')",
            [v.id],
          )
        await publish(client, v.id)
      }),
    ).rejects.toThrow('required check')
  }
})
// FR-206 (16 October 2026): an administrator and an owner of the area accept their own proposal at
// every risk; high risk still needs the named approver's accept, from a second person.
it.each(['low', 'normal', 'high'] as const)(
  "takes an owner's and an administrator's own accept at %s risk",
  async (risk) => {
    await transaction(client, async () => {
      const v = await version(client, { risk, author: people.owner })
      await accept(client, v.id, { approver: risk === 'high' })
      await publish(client, v.id)
    })
    await transaction(client, async () => {
      const v = await version(client, { risk, author: people.admin })
      await accept(client, v.id, {
        actor: people.admin,
        capacity: 'administrator',
        approver: risk === 'high',
      })
      await publish(client, v.id)
    })
  },
)
it('still refuses a self accept by anyone who is neither an administrator nor an owner of the area', async () => {
  for (const [author, actor, capacity, area] of [
    // Someone with no role, writing a decision straight to the table in either capacity.
    [people.stranger, people.stranger, 'owner', 'finance'],
    [people.stranger, people.stranger, 'administrator', 'finance'],
    // Finance's owner in another area.
    [people.owner, people.owner, 'owner', 'marketing'],
  ] as const)
    await expect(
      transaction(client, async () => {
        const v = await version(client, { author, area })
        await accept(client, v.id, { actor, capacity })
        await publish(client, v.id)
      }),
    ).rejects.toThrow('no accept decision')
  // A high-risk approver who is neither gives no approver's accept to their own proposal.
  await expect(
    transaction(client, async () => {
      const v = await version(client, { risk: 'high', author: people.approver })
      await accept(client, v.id, { approver: true })
      await publish(client, v.id)
    }),
  ).rejects.toThrow('named approver')
})
it('requires a named approver for high risk', async () => {
  await expect(
    transaction(client, async () => {
      const v = await version(client, { risk: 'high' })
      await accept(client, v.id)
      await publish(client, v.id)
    }),
  ).rejects.toThrow('named approver')
  await transaction(client, async () => {
    const v = await version(client, { risk: 'high' })
    await accept(client, v.id, { approver: true })
    await publish(client, v.id)
  })
})
it("takes an administrator's accept in any area as administrator, never as an owner", async () => {
  await expect(
    transaction(client, async () => {
      const v = await version(client)
      await accept(client, v.id, { actor: people.admin })
      await publish(client, v.id)
    }),
  ).rejects.toThrow('no accept decision')
  await transaction(client, async () => {
    const v = await version(client, { area: 'marketing' })
    await accept(client, v.id, { actor: people.admin, capacity: 'administrator' })
    await publish(client, v.id)
  })
})
it('serves a term its proposer accepted only as an administrator or an owner of its area', async () => {
  const served = (author: string, actor: string, capacity: 'owner' | 'administrator') =>
    transaction(client, async () => {
      const term = await client.query<{ id: string }>(
        `insert into vocab_term_versions (term_key,version_no,name,area_id,proposer_id,content_digest)
         values ('metric:orders',(select coalesce(max(version_no),0)+1 from vocab_term_versions where term_key='metric:orders'),
                 'Orders','finance',$1,sha256($2::text::bytea)) returning id`,
        [author, randomUUID()],
      )
      const proposal = await client.query<{ id: string }>(
        "insert into proposals (subject,action,state,area_id,vocab_version_id,proposer_id,channel) values ('vocabulary','change','submitted','finance',$1,$2,'form') returning id",
        [term.rows[0]!.id, author],
      )
      await client.query(
        "insert into decisions (proposal_id,vocab_version_id,area_id,decided_by,capacity,outcome,reason) values ($1,$2,'finance',$3,$4,'accept','Reviewed')",
        [proposal.rows[0]!.id, term.rows[0]!.id, actor, capacity],
      )
      const seq = await openEdition(client)
      await client.query('select edition_serve_vocab_version($1,$2)', [seq, term.rows[0]!.id])
      await client.query('select edition_seal($1)', [seq])
      await client.query('select edition_publish($1)', [seq])
    })
  await served(people.owner, people.owner, 'owner')
  await served(people.admin, people.admin, 'administrator')
  for (const capacity of ['owner', 'administrator'] as const)
    await expect(served(people.stranger, people.stranger, capacity)).rejects.toThrow(
      'no accept decision by an owner of its area or an administrator',
    )
})
it('enforces scope at commit and an open-ended review date', async () => {
  await expect(transaction(client, () => version(client, { scope: false }))).rejects.toThrow(
    'names no metric',
  )
  await expect(
    client.query(
      `insert into item_versions (item_id,version_no,area_id,title,summary,risk,proposer_id,created_via,valid_from,content_digest,core_digest)
    values ('itm_target0001',1,'finance','Title','Summary','low',$1,'form','2026-01-01',sha256('a'),sha256('a'))`,
      [people.author],
    ),
  ).rejects.toMatchObject({ code: '23514' })
})
it('enforces append-only owner writes and sealed range boundaries', async () => {
  const { v, seq } = await transaction(client, async () => {
    const v = await version(client)
    await accept(client, v.id)
    return { v, seq: await publish(client, v.id) }
  })
  for (const sql of [
    "update item_versions set title='Changed'",
    'delete from item_versions',
    'truncate item_version_metrics',
    'delete from decisions',
  ]) {
    await expect(client.query(sql)).rejects.toMatchObject({ code: '23001' })
  }
  await expect(
    client.query("update editions set digest=sha256('changed') where seq=$1", [seq]),
  ).rejects.toMatchObject({ code: '23001' })
  await expect(
    client.query("insert into area_state_service values ('finance','live',int8range($1,null))", [
      seq,
    ]),
  ).rejects.toMatchObject({ code: '23001' })
  await expect(
    client.query('select edition_serve_item_version(999999,$1)', [v.id]),
  ).rejects.toMatchObject({ code: '23001' })
})
it('requires authorized retirement and restores the exact earlier digest in a forward edition', async () => {
  const { v, seq } = await transaction(client, async () => {
    const v = await version(client)
    await accept(client, v.id)
    return { v, seq: await publish(client, v.id) }
  })
  await expect(
    transaction(client, async () => {
      const next = await openEdition(client)
      await client.query('select edition_close_item($1,$2)', [next, v.item])
    }),
  ).rejects.toThrow('without a retire decision')
  await transaction(client, async () => {
    await client.query(
      "insert into decisions (item_version_id,area_id,decided_by,capacity,outcome,reason) values ($1,'finance',$2,'owner','retire','Ended')",
      [v.id, people.owner],
    )
    const next = await openEdition(client)
    await client.query('select edition_close_item($1,$2)', [next, v.item])
    await client.query('select edition_seal($1)', [next])
    await client.query('select edition_publish($1)', [next])
  })
  const restored = await transaction(client, async () =>
    client.query<{ seq: string }>('select edition_restore($1,$2) as seq', [seq, people.admin]),
  )
  const newSeq = restored.rows[0]!.seq
  expect(BigInt(newSeq)).toBeGreaterThan(BigInt(seq))
  const equal = await client.query<{ equal: boolean }>(
    'select (select digest from editions where seq=$1) = edition_content_digest($2) as equal',
    [seq, newSeq],
  )
  expect(equal.rows[0]!.equal).toBe(true)
})
it('allows a content-preserving recheck but refuses changed content', async () => {
  const previous = await transaction(client, async () => {
    const v = await version(client)
    await accept(client, v.id)
    await publish(client, v.id)
    return v
  })
  await expect(
    transaction(client, async () => {
      const v = await version(client, {
        item: previous.item,
        previous: previous.id,
        recheck: true,
        author: people.owner,
        core: 'changed',
      })
      await accept(client, v.id)
      await publish(client, v.id)
    }),
  ).rejects.toThrow('must keep the content')
  await transaction(client, async () => {
    const v = await version(client, {
      item: previous.item,
      previous: previous.id,
      recheck: true,
      author: people.owner,
    })
    await accept(client, v.id)
    await publish(client, v.id)
  })
})
it('enforces proposal transitions and revision increments', async () => {
  const p = await client.query<{ id: string }>(
    "insert into proposals (action,area_id,proposer_id,channel) values ('create','finance',$1,'form') returning id",
    [people.author],
  )
  await expect(
    client.query("update proposals set state='accepted',closed_at=now() where id=$1", [
      p.rows[0]!.id,
    ]),
  ).rejects.toMatchObject({ code: '23514' })
  const updated = await client.query<{ revision: number }>(
    'update proposals set draft=$2 where id=$1 returning revision',
    [p.rows[0]!.id, { title: 'Saved' }],
  )
  expect(updated.rows[0]!.revision).toBe(2)
})

describe('a submitted version', () => {
  /** A submitted proposal for a fresh version, with the owner as the person making changes. */
  async function underReview(state: 'submitted' | 'in_review' = 'submitted') {
    await client.query("select set_config('cl.person_id',$1,true)", [people.owner])
    const v = await version(client)
    const proposal = await client.query<{ id: string }>(
      `insert into proposals (action,state,area_id,item_id,item_version_id,proposer_id,channel,submitted_at)
       select 'create',$2,area_id,item_id,id,proposer_id,'form',now() from item_versions where id=$1 returning id`,
      [v.id, state],
    )
    return { ...v, proposal: proposal.rows[0]!.id }
  }
  const swap = (proposal: string, versionId: string, state?: string) =>
    client.query(
      `update proposals set item_version_id=$2,state=coalesce($3::proposal_state,state) where id=$1`,
      [proposal, versionId, state ?? null],
    )

  it('takes a review edit: same content, another risk, by the person changing it', async () => {
    for (const state of ['submitted', 'in_review'] as const)
      await transaction(client, async () => {
        const v = await underReview(state)
        const edited = await version(client, {
          item: v.item,
          previous: v.id,
          risk: 'high',
          reviewDate: '2027-06-01',
          owner: people.approver,
          editedBy: people.owner,
        })
        await swap(v.proposal, edited.id)
      })
  })

  it.each([
    ['changed content', { title: 'Another title' }],
    ['changed scope', { scope: false }],
    ['no editor', { editedBy: undefined }],
    ['another editor', { editedBy: people.approver }],
    ['no link to the submitted version', { previous: undefined }],
  ] as const)('refuses a new version with %s', async (_case, change) => {
    await expect(
      transaction(client, async () => {
        const v = await underReview()
        const edited = await version(client, {
          item: v.item,
          previous: v.id,
          risk: 'high',
          editedBy: people.owner,
          ...change,
        })
        if ('scope' in change)
          await client.query("insert into item_version_metrics values ($1,'group:payments')", [
            edited.id,
          ])
        await swap(v.proposal, edited.id)
      }),
    ).rejects.toThrow('version is fixed after submit')
  })

  it.each([
    ['the proposer', people.author],
    ['an approver', people.approver],
  ] as const)('refuses a review edit by %s', async (_who, editor) => {
    await expect(
      transaction(client, async () => {
        const v = await underReview()
        await client.query("select set_config('cl.person_id',$1,true)", [editor])
        const edited = await version(client, {
          item: v.item,
          previous: v.id,
          risk: 'low',
          editedBy: editor,
        })
        await swap(v.proposal, edited.id)
      }),
    ).rejects.toThrow('version is fixed after submit')
  })

  it('refuses a review edit that moves the version to an area the editor has no role in', async () => {
    await expect(
      transaction(client, async () => {
        const v = await underReview()
        const edited = await version(client, {
          item: v.item,
          previous: v.id,
          editedBy: people.owner,
          area: 'marketing',
        })
        await swap(v.proposal, edited.id)
      }),
    ).rejects.toThrow('version is fixed after submit')
  })

  it('takes a review edit that moves the version when the editor administers', async () => {
    await transaction(client, async () => {
      const v = await underReview()
      await client.query(
        "insert into area_assignments (area_id,person_id,role) values ('finance',$1,'owner')",
        [people.admin],
      )
      await client.query("select set_config('cl.person_id',$1,true)", [people.admin])
      const edited = await version(client, {
        item: v.item,
        previous: v.id,
        editedBy: people.admin,
        area: 'marketing',
      })
      await swap(v.proposal, edited.id)
    })
  })

  it('refuses a review edit that also moves the state, or one on a decided proposal', async () => {
    await expect(
      transaction(client, async () => {
        const v = await underReview()
        const edited = await version(client, {
          item: v.item,
          previous: v.id,
          editedBy: people.owner,
        })
        await swap(v.proposal, edited.id, 'in_review')
      }),
    ).rejects.toThrow('version is fixed after submit')
    await expect(
      transaction(client, async () => {
        const v = await underReview()
        await client.query("update proposals set state='rejected',closed_at=now() where id=$1", [
          v.proposal,
        ])
        const edited = await version(client, {
          item: v.item,
          previous: v.id,
          editedBy: people.owner,
        })
        await swap(v.proposal, edited.id)
      }),
    ).rejects.toThrow('version is fixed after submit')
  })
})
