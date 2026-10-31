import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { openEdition, people } from './fixtures.ts'
import { signInHarness } from './sign-in-harness.ts'

/*
  Publishing without review (FR-421), end to end on PostgreSQL. It is off for the workspace until an
  admin switches it on; then an owner of a domain lets one app agent publish low-risk new items
  there. A suggestion the policy covers is published in the transaction that sent it, as the
  owner's decision with a link to the policy; anything else waits for review and the reply says
  why. The database refuses a decision under a policy whenever a rule does not hold, whoever
  writes it. An owner of the domain or an admin undoes such a publish later; the person the agent
  works for and the owner turn the policy off.
*/

const harness = await signInHarness()
const { admin, browser, registered, signInFlow, exchange, mcpClient } = harness

// The fixtures' live note about Orders is archived, so a new rule about Orders clashes with
// nothing live unless a test publishes one.
beforeAll(async () => {
  const { rows } = await admin.query<{ item: string; version: string }>(
    `select item_id as item, version_id::text as version from item_version_service
      where editions @> (select seq from live_edition)`,
  )
  const live = rows[0]!
  await admin.query(
    `insert into decisions (item_version_id,area_id,decided_by,capacity,outcome,reason)
     values ($1,'finance',$2,'owner','retire','Archived for these tests')`,
    [live.version, people.owner],
  )
  const seq = await openEdition(admin)
  await admin.query('select edition_close_item($1,$2)', [seq, live.item])
  await admin.query('select edition_seal($1)', [seq])
  await admin.query('select edition_publish($1)', [seq])
})

type Who = Awaited<ReturnType<typeof signedIn>>
type Reply = {
  status: string
  draft_id: string
  message?: string
  url?: string | null
  policy?: { published: boolean; set_by: string; domain: string; waits_because?: string }
}

async function signedIn(name: string) {
  const person = browser()
  await person.signIn(name)
  return person
}

async function connect(person = 'author') {
  const clientId = await registered()
  const flow = await signInFlow(clientId, { person, scope: 'read feedback propose' })
  const tokens = await exchange(clientId, flow.code!, flow.verifier)
  expect(tokens.status).toBe(200)
  const { rows } = await admin.query<{ id: string }>(
    "select id::text from auth.agents where kind='app' and client_id=$1",
    [clientId],
  )
  return { clientId, token: tokens.body.access_token!, agentId: rows[0]!.id }
}

let n = 0
/** A rule about Orders, in Finance; or another kind. */
function suggestion(options: { kind?: string; metrics?: string[]; title?: string } = {}) {
  n += 1
  const title = options.title ?? `Finance closes the books on day ${n} of each month`
  return {
    name: 'suggest_context',
    arguments: {
      text: `${title}.`,
      kind: options.kind ?? 'note',
      area: 'finance',
      scope: { metrics: options.metrics ?? ['Orders'] },
      window: { from: '2026-10-01' },
      evidence: [{ url: `https://wiki.example/finance/close-${n}`, quote: `${title}.` }],
      new_item: true,
    },
  }
}

async function suggest(token: string, call = suggestion()) {
  const wire = await mcpClient(token)
  const reply = await wire.callTool(call)
  await wire.close()
  expect(reply.isError).not.toBe(true)
  return reply.structuredContent as Reply
}

/** Undoes a decision, as the screens do, with a key that makes a retry apply once. */
const undo = (who: Who, decisionId: string) =>
  who.api(
    '/decisions/undo',
    { token: `decision:${decisionId}` },
    { 'idempotency-key': randomUUID() },
  )

const switchTo = (who: Who, on: boolean) =>
  who.api('/agent-policies/switch', { on, reason: on ? 'Trying it in Finance' : 'Stopping it' })

const setPolicy = (
  who: Who,
  agentId: string,
  options: { areaId?: string; perDay?: number } = {},
) =>
  who.api('/agent-policies', {
    agentId,
    areaId: options.areaId ?? 'finance',
    perDay: options.perDay ?? 10,
    reason: 'Its month-end rules have been right for weeks',
  })

const proposal = async (id: string) =>
  (
    await admin.query<{ state: string; item_id: string | null }>(
      'select state::text, item_id from proposals where id=$1',
      [id],
    )
  ).rows[0]!

const decisionsOf = async (id: string) =>
  (
    await admin.query<{
      id: string
      decided_by: string
      capacity: string
      auto_policy_id: string | null
    }>(
      `select id::text, decided_by::text, capacity::text, auto_policy_id::text from decisions
        where proposal_id=$1 order by decided_at`,
      [id],
    )
  ).rows

const live = async (itemId: string) =>
  (
    await admin.query(
      `select 1 from item_version_service s where s.item_id=$1
          and s.editions @> (select seq from live_edition)`,
      [itemId],
    )
  ).rows.length > 0

let boss: Who
let owner: Who
beforeEach(async () => {
  harness.advance(61)
  await admin.query(
    `insert into settings_versions (key,version,value,reason)
     select 'limits.agent_drafts',max(version)+1,'{"per_day":100,"open":100}','test'
       from settings_versions where key='limits.agent_drafts'`,
  )
  boss = await signedIn('admin')
  owner = await signedIn('owner')
  // Every test starts from the workspace switch off, which ends every policy.
  expect((await switchTo(boss, false)).status).toBe(200)
})

describe('publishing without review', () => {
  it('is off for the workspace until an admin switches it on', async () => {
    const app = await connect('author')
    expect(await (await boss.api('/agent-policies/switch')).json()).toEqual({ on: false, open: 0 })
    const refused = await setPolicy(owner, app.agentId)
    expect(refused.status).toBe(409)
    expect(await refused.text()).toMatch(/off for the workspace/)
    // The database refuses one too, whoever writes it.
    await expect(
      admin.query(
        `insert into agent_policies (agent_id,area_id,per_day,set_by,reason)
         values ($1,'finance',5,$2,'test')`,
        [app.agentId, people.owner],
      ),
    ).rejects.toThrow(/off for the workspace/)
    const sent = await suggest(app.token)
    expect(sent.status).toBe('suggestion_sent')
    expect(sent.policy).toBeUndefined()
    // Only an admin switches it.
    expect((await owner.api('/agent-policies/switch', { on: true, reason: 'x' })).status).toBe(403)
  })

  it("publishes a low-risk new rule at once, as the owner's own decision under the policy", async () => {
    const app = await connect('author')
    expect(await (await switchTo(boss, true)).json()).toEqual({ on: true, ended: 0 })
    const set = await setPolicy(owner, app.agentId, { perDay: 3 })
    expect(set.status).toBe(200)
    const policy = (await set.json()) as { id: string; pause: string | null; canEnd: boolean }
    expect(policy).toMatchObject({
      agentId: app.agentId,
      areaId: 'finance',
      areaName: 'Finance',
      perDay: 3,
      setBy: { id: people.owner, name: 'owner' },
      person: { id: people.author, name: 'author' },
      today: 0,
      pause: null,
      canEnd: true,
    })

    const reply = await suggest(app.token)
    expect(reply).toMatchObject({
      status: 'suggestion_published',
      policy: { published: true, set_by: 'owner', domain: 'Finance' },
    })
    expect(reply.message).toMatch(/Published under owner's policy for Finance/)
    const p = await proposal(reply.draft_id)
    expect(p.state).toBe('accepted')
    expect(await live(p.item_id!)).toBe(true)
    expect(reply.url).toBe(`http://localhost:5173/context/${p.item_id}`)

    // The decision names the owner who set the policy, with a link to it.
    const [decision] = await decisionsOf(reply.draft_id)
    expect(decision).toMatchObject({
      decided_by: people.owner,
      capacity: 'owner',
      auto_policy_id: policy.id,
    })
    // The history log names the owner as who decided, with the agent and the policy.
    const { rows: audit } = await admin.query<{ actor: string; details: Record<string, unknown> }>(
      `select actor_id::text as actor, details from audit_log
        where action='decision.accept' and subject_id=$1`,
      [reply.draft_id],
    )
    expect(audit).toMatchObject([
      {
        actor: people.owner,
        details: {
          policy: { id: policy.id, setBy: people.owner, setByName: 'owner' },
          agent: { name: 'Test client', personId: people.author },
        },
      },
    ])
    // The edition that published it names the owner too, and the serving guard passed it.
    const { rows: edition } = await admin.query<{ by: string }>(
      `select e.actor_id::text as by from editions e join live_edition l on l.seq=e.seq`,
    )
    expect(edition[0]?.by).toBe(people.owner)

    // Its row in Agents and access shows the policy, with today's count.
    const rows = (await (await boss.api('/agents')).json()) as {
      id: string
      policies: { id: string; today: number }[]
    }[]
    expect(rows.find((r) => r.id === app.agentId)?.policies).toMatchObject([
      { id: policy.id, today: 1 },
    ])
    // The owner who set it undoes it later, as for any publish under a policy.
    expect((await undo(owner, decision!.id)).status).toBe(200)
    expect(await live(p.item_id!)).toBe(false)
  })

  it('keeps every other suggestion waiting for review, and says why', async () => {
    const app = await connect('author')
    await switchTo(boss, true)
    expect((await setPolicy(owner, app.agentId)).status).toBe(200)

    // Not low risk: a guide and an event start at normal risk, whatever the policy.
    const guide = await suggest(app.token, suggestion({ kind: 'guide' }))
    expect(guide.policy).toMatchObject({ published: false, waits_because: 'it is not low risk' })
    const event = await suggest(app.token, suggestion({ kind: 'event' }))
    expect(event.policy).toMatchObject({ published: false, waits_because: 'it is not low risk' })
    // A clash with a live item: once one rule about Orders is live, the next one clashes with it,
    // and an owner says how they relate.
    const first = await suggest(app.token)
    expect(first.status).toBe('suggestion_published')
    const clash = await suggest(app.token, suggestion({ title: 'Orders exclude gift cards' }))
    expect(clash.policy).toMatchObject({
      published: false,
      waits_because: 'it clashes with live context',
    })
    for (const id of [guide.draft_id, event.draft_id, clash.draft_id]) {
      expect((await proposal(id)).state).toBe('submitted')
      expect(await decisionsOf(id)).toEqual([])
    }
    const [decision] = await decisionsOf(first.draft_id)
    expect((await undo(owner, decision!.id)).status).toBe(200)
  })

  it('stops at the daily cap, counting what was undone', async () => {
    const app = await connect('author')
    await switchTo(boss, true)
    await setPolicy(owner, app.agentId, { perDay: 1 })
    const first = await suggest(app.token)
    expect(first.status).toBe('suggestion_published')
    const [decision] = await decisionsOf(first.draft_id)
    // An owner undoes it later; the suggestion waits for review again and the item goes.
    expect((await undo(owner, decision!.id)).status).toBe(200)
    expect((await proposal(first.draft_id)).state).toBe('submitted')
    expect(await live((await proposal(first.draft_id)).item_id!)).toBe(false)
    const second = await suggest(app.token)
    expect(second.policy).toMatchObject({
      published: false,
      waits_because: 'the policy published its most for today',
    })
  })

  it('lets an owner or an admin undo it later, never the person the agent works for', async () => {
    const app = await connect('author')
    await switchTo(boss, true)
    await setPolicy(owner, app.agentId)
    const reply = await suggest(app.token)
    expect(reply.status).toBe('suggestion_published')
    const [decision] = await decisionsOf(reply.draft_id)
    const author = await signedIn('author')
    expect((await undo(author, decision!.id)).status).toBe(403)
    // The admin did not decide it, and may still undo it.
    expect((await undo(boss, decision!.id)).status).toBe(200)
    expect((await proposal(reply.draft_id)).state).toBe('submitted')
    expect((await undo(owner, decision!.id)).status).toBe(409)
  })

  it('waits for review once the owner who set it is no longer an owner of the domain', async () => {
    const app = await connect('author')
    await switchTo(boss, true)
    await setPolicy(owner, app.agentId)
    // Finance gets another owner, then the one who set the policy stops being one.
    await admin.query(
      "insert into area_assignments (area_id,person_id,role) values ('finance',$1,'owner')",
      [people.stranger],
    )
    await admin.query(
      `update area_assignments set valid_at = tstzrange(lower(valid_at), now())
        where area_id='finance' and person_id=$1 and role='owner' and upper_inf(valid_at)`,
      [people.owner],
    )
    try {
      const listed = (await (await boss.api('/areas/finance/agent-policies')).json()) as {
        policies: { pause: string | null }[]
      }
      expect(listed.policies).toMatchObject([{ pause: 'not_owner' }])
      const reply = await suggest(app.token)
      expect(reply.policy).toMatchObject({
        published: false,
        waits_because: 'the person who set the policy is no longer an owner of the domain',
      })
      expect(await decisionsOf(reply.draft_id)).toEqual([])
    } finally {
      await admin.query(
        `update area_assignments set valid_at = tstzrange(lower(valid_at), now())
          where area_id='finance' and person_id=$1 and role='owner' and upper_inf(valid_at)`,
        [people.stranger],
      )
      await admin.query(
        "insert into area_assignments (area_id,person_id,role) values ('finance',$1,'owner')",
        [people.owner],
      )
    }
  })

  it('is set only by an owner of the domain, never by an admin who is not one, only for an app', async () => {
    const app = await connect('author')
    await switchTo(boss, true)
    const author = await signedIn('author')
    // The person the agent works for owns no domain.
    expect((await setPolicy(author, app.agentId)).status).toBe(403)
    // The owner of Finance owns no Marketing.
    expect((await setPolicy(owner, app.agentId, { areaId: 'marketing' })).status).toBe(403)
    // An admin who owns neither domain sets none, and sees no apps to choose from.
    expect((await setPolicy(boss, app.agentId, { areaId: 'marketing' })).status).toBe(403)
    expect((await setPolicy(boss, app.agentId)).status).toBe(403)
    const view = (await (await boss.api('/areas/finance/agent-policies')).json()) as {
      canSet: boolean
      agents: unknown[]
    }
    expect(view).toMatchObject({ canSet: false, agents: [] })
    await expect(
      admin.query(
        `insert into agent_policies (agent_id,area_id,per_day,set_by,reason)
         values ($1,'finance',5,$2,'test')`,
        [app.agentId, people.admin],
      ),
    ).rejects.toThrow(/Only an owner of the domain/)
    const reply = await suggest(app.token)
    expect(reply.status).toBe('suggestion_sent')
    expect(reply.policy).toBeUndefined()
    // An access key never suggests, so it never has a policy.
    const key = (await (await boss.api('/access-keys', { name: 'Nightly digest' })).json()) as {
      id: string
    }
    const { rows } = await admin.query<{ id: string }>(
      'select id::text from auth.agents where key_id=$1',
      [key.id],
    )
    const refused = await setPolicy(owner, rows[0]!.id)
    expect(refused.status).toBe(409)
    expect(await refused.text()).toMatch(/access key/)
    await expect(
      admin.query(
        `insert into agent_policies (agent_id,area_id,per_day,set_by,reason)
         values ($1,'finance',5,$2,'test')`,
        [rows[0]!.id, people.owner],
      ),
    ).rejects.toThrow(/Only an app/)
  })

  it('turns off at once for the person the agent works for, and for the whole workspace', async () => {
    const app = await connect('author')
    await switchTo(boss, true)
    const policy = (await (await setPolicy(owner, app.agentId)).json()) as { id: string }
    const stranger = await signedIn('stranger')
    expect(
      (await stranger.api(`/agent-policies/${policy.id}/end`, { reason: 'Not mine' })).status,
    ).toBe(403)
    const author = await signedIn('author')
    const ended = await author.api(`/agent-policies/${policy.id}/end`, {
      reason: 'I want to check what it sends',
    })
    expect(await ended.json()).toEqual({ changed: true })
    expect((await suggest(app.token)).status).toBe('suggestion_sent')
    // A policy is never changed, only ended; and ended once.
    await expect(
      admin.query('update agent_policies set per_day=50 where id=$1', [policy.id]),
    ).rejects.toThrow(/never changed/)
    await expect(
      admin.query('delete from agent_policies where id=$1', [policy.id]),
    ).rejects.toThrow(/append-only/)

    // The workspace switch off ends every policy, with the history log keeping each.
    await setPolicy(owner, app.agentId)
    expect(await (await switchTo(boss, false)).json()).toEqual({ on: false, ended: 1 })
    expect((await suggest(app.token)).status).toBe('suggestion_sent')
    const { rows } = await admin.query<{ action: string }>(
      `select action from audit_log where subject_type='agent' and subject_id=$1 order by seq`,
      [app.agentId],
    )
    expect(rows.map((r) => r.action)).toEqual([
      'agent.policy_set',
      'agent.policy_ended',
      'agent.policy_set',
      'agent.policy_ended',
    ])
  })

  it('ends every policy when the setting is switched off on any path', async () => {
    const app = await connect('author')
    await switchTo(boss, true)
    await setPolicy(owner, app.agentId)
    // However the setting changes (here, a version written straight in), the database ends every
    // policy the moment it says false.
    await admin.query(
      `insert into settings_versions (key,version,value,changed_by,reason)
       select 'agents.auto_publish', max(version)+1, 'false', $1, 'Pausing it'
         from settings_versions where key='agents.auto_publish'`,
      [people.admin],
    )
    const { rows } = await admin.query<{ open: number }>(
      'select count(*)::int as open from agent_policies where ended_at is null',
    )
    expect(rows[0]!.open).toBe(0)
    expect((await suggest(app.token)).status).toBe('suggestion_sent')
  })

  it('ends with the last connection of its app, on whatever path it is revoked', async () => {
    const app = await connect('author')
    await switchTo(boss, true)
    await setPolicy(owner, app.agentId)
    // The person disconnects the app from their own connections, not from Agents and access.
    const author = await signedIn('author')
    const mine = (await (await author.api('/connections')).json()) as { id: string }[]
    for (const c of mine)
      expect((await author.api(`/connections/${c.id}/disconnect`, {})).status).toBe(200)
    const { rows } = await admin.query<{ ended: boolean; reason: string | null }>(
      `select ended_at is not null as ended, ended_reason as reason from agent_policies
        where agent_id=$1`,
      [app.agentId],
    )
    expect(rows).toEqual([{ ended: true, reason: 'The agent was revoked.' }])
    const { rows: audit } = await admin.query<{ actor: string }>(
      `select actor_id::text as actor from audit_log
        where action='agent.policy_ended' and subject_id=$1`,
      [app.agentId],
    )
    expect(audit).toEqual([{ actor: people.author }])
  })
})

describe('the database guard on a decision under a policy', () => {
  /** A suggestion waiting for review, and the open policy for its agent, as the guard sees them. */
  async function waiting(kind = 'note') {
    const app = await connect('author')
    await switchTo(boss, true)
    // A policy the owner sets after the suggestion was sent, so it still waits.
    const reply = await suggest(app.token, suggestion({ kind }))
    expect(reply.status).toBe('suggestion_sent')
    const policy = (await (await setPolicy(owner, app.agentId)).json()) as { id: string }
    const { rows } = await admin.query<{ version: string }>(
      'select item_version_id::text as version from proposals where id=$1',
      [reply.draft_id],
    )
    return { app, policy: policy.id, proposal: reply.draft_id, version: rows[0]!.version }
  }

  /** Records an accept under the policy, as the given person, the way the service would. */
  async function decideAs(who: string, w: Awaited<ReturnType<typeof waiting>>, decidedBy = who) {
    await admin.query('begin')
    try {
      await admin.query("select set_config('cl.person_id',$1,true)", [who])
      await admin.query(
        `insert into decisions (proposal_id,item_version_id,area_id,decided_by,capacity,outcome,reason,auto_policy_id)
         values ($1,$2,'finance',$3,'owner','accept','test',$4)`,
        [w.proposal, w.version, decidedBy, w.policy],
      )
    } finally {
      await admin.query('rollback')
    }
  }

  it('accepts one that keeps every rule', async () => {
    const w = await waiting()
    await expect(decideAs(people.owner, w)).resolves.toBeUndefined()
  })

  it('refuses one that is not by the owner who set it, as themselves', async () => {
    const w = await waiting()
    await expect(decideAs(people.author, w, people.owner)).rejects.toThrow(
      /not by the person who set the policy/,
    )
    await expect(decideAs(people.admin, w)).rejects.toThrow(/not by the person who set the policy/)
  })

  it('refuses one above low risk', async () => {
    const w = await waiting('event')
    await expect(decideAs(people.owner, w)).rejects.toThrow(/only publishes low-risk items/)
  })

  it('refuses one while suggest_context is off for the agent', async () => {
    const w = await waiting()
    await admin.query(
      "update auth.agents set tools = array_remove(tools, 'suggest_context') where id=$1",
      [w.app.agentId],
    )
    await expect(decideAs(people.owner, w)).rejects.toThrow(/suggest_context is off/)
  })

  it('refuses one once the workspace switch is off', async () => {
    const w = await waiting()
    await switchTo(boss, false)
    await expect(decideAs(people.owner, w)).rejects.toThrow(/the policy is off/)
  })
})
