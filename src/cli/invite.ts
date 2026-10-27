import { createHash, randomBytes } from 'node:crypto'
import pg from 'pg'
import { INVITE_DAYS, inviteLinkOf } from '../contract/members.ts'

/**
 * `heed invite <email> [--admin] [--domain <id>]...`: the operator's invite, made in the database
 * with the owner's credential (DATABASE_URL_MIGRATE), not through the service. It is how the first
 * admin of a new install that signs in with OIDC gets in (FR-416, FR-417): nobody can sign in to
 * invite them yet. It has no sender, and is accepted with an admin's authority at the person's
 * first sign-in. An open invite of the same address is taken back and replaced. Prints the link;
 * the database keeps only the SHA-256 of its token.
 */
export async function operatorInvite(input: {
  databaseUrl: string
  webOrigin: string
  email: string
  admin: boolean
  domains: readonly string[]
}): Promise<
  | { outcome: 'invited'; link: string; expiresAt: string }
  | { outcome: 'member' }
  | { outcome: 'unknown_domain'; domain: string }
> {
  const client = new pg.Client({ connectionString: input.databaseUrl })
  await client.connect()
  try {
    await client.query('begin')
    await client.query("select pg_advisory_xact_lock(hashtextextended('heed.roles', 0))")
    const email = input.email.trim().toLowerCase()
    const member = await client.query(
      'select 1 from people where email=$1 and deactivated_at is null and erased_at is null',
      [email],
    )
    if (member.rowCount) {
      await client.query('rollback')
      return { outcome: 'member' }
    }
    const domains = [...new Set(input.domains)]
    const live = await client.query<{ id: string }>(
      'select id from areas where id = any($1::text[]) and archived_at is null',
      [domains],
    )
    const missing = domains.find((domain) => !live.rows.some((row) => row.id === domain))
    if (missing) {
      await client.query('rollback')
      return { outcome: 'unknown_domain', domain: missing }
    }
    const replaced = await client.query<{ id: string }>(
      `update invites set revoked_at=now(), revoked_by=null
        where email=$1 and accepted_at is null and revoked_at is null returning id::text`,
      [email],
    )
    const token = randomBytes(32).toString('base64url')
    const made = await client.query<{ id: string; expiresAt: string }>(
      `insert into invites(email,role,area_ids,invited_by,token_hash,expires_at)
       values($1,$2,$3::text[],null,$4,now() + make_interval(days => $5))
       returning id::text, to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as "expiresAt"`,
      [
        email,
        input.admin ? 'admin' : 'member',
        domains,
        createHash('sha256').update(token).digest('hex'),
        INVITE_DAYS,
      ],
    )
    const invite = made.rows[0]!
    for (const [action, id] of [
      ...replaced.rows.map((row) => ['invite.revoked', row.id] as const),
      ['invite.created', invite.id] as const,
    ])
      await client.query(
        `insert into audit_log(actor_kind,action,subject_type,subject_id,details,source)
         values('service',$1,'invite',$2,$3::jsonb,'named')`,
        [
          action,
          id,
          JSON.stringify({
            role: input.admin ? 'admin' : 'member',
            areas: domains,
            by: 'operator',
          }),
        ],
      )
    await client.query('commit')
    return {
      outcome: 'invited',
      link: inviteLinkOf(input.webOrigin, token),
      expiresAt: invite.expiresAt,
    }
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    await client.end()
  }
}
