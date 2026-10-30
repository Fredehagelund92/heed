import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createLoginServer,
  loadKeyRing,
  type LoginServer,
} from '../../../src/server/modules/oauth/index.ts'

/*
  The login server agents sign in with, for the demo week on the real service (the http
  conformance suite and the golden journeys): the service's own, with a signing key made for the
  run in a folder of its own, dynamic registration on, so a journey's agent registers and signs in
  as the people of the demo week do. No key from anywhere else is used.
*/

let keys: ReturnType<typeof loadKeyRing> | undefined

/** The login server at `issuer` (the service's address), with its consent page on `web`. */
export async function demoLoginServer(issuer: string, web: string): Promise<LoginServer> {
  keys ??= mkdtemp(join(tmpdir(), 'heed-demo-oauth-')).then((dir) =>
    loadKeyRing({ file: join(dir, 'oauth.pem'), previousFiles: [], nodeEnv: 'test' }),
  )
  return createLoginServer({
    config: {
      kind: 'builtin',
      issuer,
      consentUrl: `${web}/connect/approve`,
      signingKeyFile: '',
      previousKeyFiles: [],
      dynamicRegistration: true,
      refreshIdleHours: 168,
      connectionDays: 30,
    },
    resource: `${issuer}/mcp`,
    keys: await keys,
    nodeEnv: 'test',
  })
}
