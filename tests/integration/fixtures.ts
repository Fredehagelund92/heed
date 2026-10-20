import { randomUUID } from 'node:crypto'
import type pg from 'pg'

export const people = {
  author: '00000000-0000-4000-8000-000000000001',
  owner: '00000000-0000-4000-8000-000000000002',
  approver: '00000000-0000-4000-8000-000000000003',
  admin: '00000000-0000-4000-8000-000000000004',
  stranger: '00000000-0000-4000-8000-000000000005',
}

/**
 * The schema's word for the role that accepts a domain's facts: `owner` from 0086, `steward`
 * before it. The migration tests run these fixtures on a database migrated only that far.
 */
async function ownerWord(client: pg.Client): Promise<'owner' | 'steward'> {
  const { rows } = await client.query<{ renamed: boolean }>(
    "select 'owner' = any(enum_range(null::area_role)::text[]) as renamed",
  )
  return rows[0]!.renamed ? 'owner' : 'steward'
}

export async function foundation(client: pg.Client) {
  for (const [name, id] of Object.entries(people)) {
    await client.query('insert into people (id,email,display_name) values ($1,$2,$3)', [
      id,
      name + '@example.test',
      name,
    ])
  }
  await client.query(`insert into areas (id,name) values ('finance','Finance'),('marketing','Marketing');
    insert into vocab_terms (key,kind,parent_key) values
      ('metric:orders','metric',null),('dim:market','dimension',null),
      ('val:market/norway','dimension_value','dim:market'),('group:payments','metric_group',null);
    insert into items (id,kind) values ('itm_target0001','note');
    insert into connectors (id,kind,type,name) values ('demo','definition_source','demo','Demo');
    insert into definitions (ref,connector_id,kind,name,change_mark) values ('demo:orders','demo','metric','Orders','1')`)
  await client.query(
    "insert into area_assignments (area_id,person_id,role) values ('finance',$1,$3),('finance',$2,'approver')",
    [people.owner, people.approver, await ownerWord(client)],
  )
  await client.query(
    "insert into global_role_grants (person_id,role) values ($1,'administrator')",
    [people.admin],
  )
}

export async function version(
  client: pg.Client,
  options: {
    risk?: 'low' | 'normal' | 'high'
    author?: string
    summary?: string
    markup?: string | null
    body?: string | null
    bodyMarkup?: string | null
    scope?: boolean
    item?: string
    previous?: string
    recheck?: boolean
    core?: string
    owner?: string
    reviewDate?: string
    title?: string
    audience?: string[]
    validity?: { from: string; until: string | null }
    /** The owner who changed the version under review (FR-105). */
    editedBy?: string
    area?: string
  } = {},
) {
  const item = options.item ?? 'itm_' + randomUUID().replaceAll('-', '').slice(0, 12)
  await client.query("insert into items (id,kind) values ($1,'note') on conflict do nothing", [
    item,
  ])
  const result = await client.query<{ id: string }>(
    `insert into item_versions
    (item_id,version_no,area_id,title,summary,summary_markup,body,body_markup,risk,proposer_id,created_via,
     valid_from,valid_until,review_date,content_digest,core_digest,supersedes_version_id,is_recheck,${await ownerWord(client)}_id,
     audience_groups,edited_by)
    values ($1,(select count(*)+1 from item_versions where item_id=$1),$18,$13,$2,$3,$4,$5,$6,$7,'form',
    $15,$16,$12,sha256('content'),sha256($8::bytea),$9,$10,$11,$14,$17) returning id`,
    [
      item,
      options.summary ?? 'Orders',
      options.markup ?? null,
      options.body ?? null,
      options.bodyMarkup ?? null,
      options.risk ?? 'normal',
      options.author ?? people.author,
      options.core ?? 'core',
      options.previous ?? null,
      options.recheck ?? false,
      options.owner ?? null,
      options.reviewDate ?? '2027-01-01',
      options.title ?? 'A note',
      options.audience ?? null,
      options.validity?.from ?? '2026-08-04',
      options.validity?.until ?? null,
      options.editedBy ?? null,
      options.area ?? 'finance',
    ],
  )
  const id = result.rows[0]!.id
  if (options.scope !== false)
    await client.query("insert into item_version_metrics values ($1,'metric:orders')", [id])
  return { id, item }
}

export async function accept(
  client: pg.Client,
  id: string,
  options: {
    actor?: string
    checks?: boolean
    approver?: boolean
    /** The capacity of the first accept: an owner's, or an administrator's (FR-202). */
    capacity?: 'owner' | 'administrator'
    /** Who gives the approver's accept. */
    approverActor?: string
  } = {},
) {
  const proposal = await client.query<{ id: string }>(
    `insert into proposals
    (action,state,area_id,item_id,item_version_id,proposer_id,channel,submitted_at)
    select 'create','submitted',area_id,item_id,id,proposer_id,'form',now() from item_versions where id=$1 returning id`,
    [id],
  )
  await client.query(
    `insert into decisions (proposal_id,item_version_id,area_id,decided_by,capacity,outcome,reason)
    values ($1,$2,(select area_id from item_versions where id=$2),$3,$4,'accept','Reviewed')`,
    [
      proposal.rows[0]!.id,
      id,
      options.actor ?? people.owner,
      options.capacity === 'administrator' ? 'administrator' : await ownerWord(client),
    ],
  )
  if (options.approver)
    await client.query(
      `insert into decisions (proposal_id,item_version_id,area_id,decided_by,capacity,outcome,reason)
    values ($1,$2,(select area_id from item_versions where id=$2),$3,'approver','accept','Reviewed high risk')`,
      [proposal.rows[0]!.id, id, options.approverActor ?? people.approver],
    )
  if (options.checks !== false)
    await client.query(
      `insert into check_results (item_version_id,level,outcome)
    select id, unnest(cl_required_levels(risk)), 'passed' from item_versions where id=$1`,
      [id],
    )
}

export async function openEdition(client: pg.Client) {
  const result = await client.query<{ seq: string }>(
    "select edition_open('proposal_accepted',null) as seq",
  )
  return result.rows[0]!.seq
}
export async function publish(client: pg.Client, id: string) {
  const seq = await openEdition(client)
  await client.query('select edition_serve_item_version($1,$2)', [seq, id])
  await client.query('select edition_seal($1)', [seq])
  await client.query('select edition_publish($1)', [seq])
  return seq
}

/**
 * One published edition that serves a finance note about orders from 4 August 2026, with the
 * `metric:orders` vocabulary term (defined at `demo:orders`) and the finance area live.
 */
export async function servingEdition(client: pg.Client) {
  const v = await version(client, {
    summary: 'Orders',
    body: 'Norway closed on 4 August.',
    owner: people.owner,
  })
  await accept(client, v.id)
  const edition = await openEdition(client)
  await client.query('select edition_serve_item_version($1,$2)', [edition, v.id])
  const term = await client.query<{ id: string }>(
    "with v as (insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest) values('metric:orders',1,'Orders','finance',sha256('orders')) returning id), r as (insert into vocab_term_refs (version_id,definition_ref) select id,'demo:orders' from v where 'demo:orders'::text is not null) select id from v",
  )
  const proposal = await client.query<{ id: string }>(
    "insert into proposals (subject,action,state,area_id,vocab_version_id,proposer_id,channel) values ('vocabulary','create','submitted','finance',$1,$2,'form') returning id",
    [term.rows[0]!.id, people.author],
  )
  await client.query(
    "insert into decisions (proposal_id,vocab_version_id,area_id,decided_by,capacity,outcome,reason) values ($1,$2,'finance',$3,'owner','accept','Reviewed vocabulary')",
    [proposal.rows[0]!.id, term.rows[0]!.id, people.owner],
  )
  await client.query('select edition_serve_vocab_version($1,$2)', [edition, term.rows[0]!.id])
  await client.query('select edition_seal($1)', [edition])
  await client.query('select edition_publish($1)', [edition])
  return { item: v.item, edition }
}
