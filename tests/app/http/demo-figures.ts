import pg from 'pg'
import { randomBytes } from 'node:crypto'
import { identifier } from '../../../src/server/db/roles.ts'
import type { SecretStore } from '../../../src/server/modules/connectors/index.ts'
import { cubeHost, type CubeHost } from '../../server/connectors/cube-server.ts'
import { seedDemoWarehouse } from '../../server/connectors/demo-warehouse.ts'

/*
  Figures in Ask in the demo week, as the mock has them (data/integrations.ts): Cube's data
  endpoint set, Ravi Kapoor its data contact, and Show figures in Ask off until an admin switches
  it on. Only Cube is a stand-in: a Cube on this machine (tests/server/connectors/cube-server.ts)
  over the demo warehouse, in a PostgreSQL database of its own beside Heed's, with a token invented
  when it starts. The service keeps the token in a secret store of its own that holds that one
  token, as the server's store would.
*/

/** Where the demo week's token is, in the secret store the service is given (demoSecrets). */
export const FIGURES_SECRET_REF = 'local:00000000-0000-4000-8000-0000000f1650'

/** A token for the demo week's stand-in Cube, invented for one run. */
export const inventedToken = () => `demo-cube-${randomBytes(12).toString('hex')}`

/** The demo week's data contact for Cube, as the mock names them. */
export const DATA_CONTACT = 'Ravi Kapoor'

/** The secret store of the service on the demo week: the one token, under its name. */
export function demoSecrets(token: string): SecretStore {
  const kept = new Map<string, Record<string, string>>([[FIGURES_SECRET_REF, { token }]])
  return {
    available: true,
    read: (ref) => Promise.resolve(kept.get(ref) ?? null),
    write: (secrets) => {
      const ref = `local:${crypto.randomUUID()}`
      kept.set(ref, { ...secrets })
      return Promise.resolve(ref)
    },
    remove: (ref) => {
      kept.delete(ref)
      return Promise.resolve()
    },
  }
}

/**
 * The demo warehouse in a database of its own beside the one at `adminUrl` (a superuser's), and a
 * stand-in Cube over it whose data was refreshed at 06:00 this morning on this machine's clock, as
 * the mock's line says it ("data as of today at 06:00").
 */
export async function demoCube(
  adminUrl: string,
  token: string,
): Promise<CubeHost & { drop: () => Promise<void> }> {
  const name = `context_layer_test_wh_${randomBytes(4).toString('hex')}`
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  await admin.query(`create database ${identifier(name)}`)
  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  await seedDemoWarehouse(url.href)
  const refreshed = new Date()
  refreshed.setHours(6, 0, 0, 0)
  const cube = await cubeHost({
    warehouse: url.href,
    token,
    lastRefreshTime: refreshed.toISOString(),
  })
  return {
    ...cube,
    async drop() {
      await cube.close()
      await admin.query(`drop database if exists ${identifier(name)} with (force)`)
      await admin.end()
    },
  }
}

/** Cube's figures settings in the demo week: the endpoint and its token set, the contact, off. */
export async function seedDemoFigures(superuserUrl: string, endpoint: string) {
  const client = new pg.Client({ connectionString: superuserUrl })
  await client.connect()
  try {
    const updated = await client.query(
      `update connectors set
         capabilities = jsonb_set(capabilities, '{figures}', jsonb_build_object(
           'enabled', false, 'endpoint', $1::text, 'secretRef', $2::text)),
         data_contact_id = (select id from people where display_name = $3)
       where id = 'cube'`,
      [endpoint, FIGURES_SECRET_REF, DATA_CONTACT],
    )
    if (updated.rowCount !== 1) throw new Error('The demo week has no Cube source to set up')
  } finally {
    await client.end()
  }
}
