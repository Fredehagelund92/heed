import { ORPCError } from '@orpc/client'
import { contentDigest } from '../../../domain/canonical.ts'
import type { Queryable } from '../../db/database.ts'

/** A transaction lock makes an in-flight retry a conflict without committing a reservation. */
export async function retryWrite<T>(
  tx: Queryable,
  key: string | undefined,
  path: string,
  input: unknown,
  work: () => Promise<T>,
): Promise<T> {
  if (!key || !/^[\x21-\x7e]{8,128}$/.test(key))
    throw new ORPCError('BAD_REQUEST', {
      message: 'Supply an Idempotency-Key of 8 to 128 printable characters',
    })
  const [lock] = await tx.query<{ ok: boolean }>(
    "select pg_try_advisory_xact_lock(hashtextextended(cl_person()::text || ':' || $1,0)) as ok",
    [key],
  )
  if (!lock?.ok) throw new ORPCError('CONFLICT', { message: 'This retry key is in flight' })
  const hash = await contentDigest(input)
  const [prior] = await tx.query<{
    hash: string
    path: string
    response: T
    status: number | null
  }>(
    `select encode(request_hash,'hex') as hash,path,response,status from idempotency_keys where person_id=cl_person() and key=$1 and expires_at>now()`,
    [key],
  )
  if (prior) {
    if (prior.hash !== hash || prior.path !== path)
      throw new ORPCError('UNPROCESSABLE_CONTENT', {
        message: 'This retry key was used for a different request',
      })
    if (!prior.status) throw new ORPCError('CONFLICT', { message: 'This retry key is in flight' })
    return prior.response
  }
  const response = await work()
  await tx.query(
    `insert into idempotency_keys(person_id,key,method,path,request_hash,status,response)
    values(cl_person(),$1,'POST',$2,decode($3,'hex'),200,$4)
    on conflict(person_id,key) do update set method=excluded.method,path=excluded.path,request_hash=excluded.request_hash,
    status=excluded.status,response=excluded.response,created_at=now(),expires_at=now()+interval '24 hours'`,
    [key, path, hash, JSON.stringify(response)],
  )
  return response
}
