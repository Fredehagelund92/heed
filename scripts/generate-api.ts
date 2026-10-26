// Writes the files generated from the API contract (src/contract):
//   docs/api/openapi.json       the published OpenAPI document, reviewed as a diff in pull requests
//   src/web/api/contract.json   the routes alone, for the browser client (no schemas to download)
//   src/app/api/contract.json   the same routes, for the new web app's http binding (src/app)
//   src/web/api/api-version.json the digest of the OpenAPI document the service answers with, so
//                               the web app can tell a service that runs other code
// tests/server/api-contract.test.ts fails when any is out of date. Run `npm run api:generate`.
import { writeFile } from 'node:fs/promises'
import { minifyContractRouter } from '@orpc/contract'
import { contract } from '../src/contract/index.ts'
import { apiVersion, openApiDocument } from '../src/server/http/api.ts'

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

const outputs = {
  'docs/api/openapi.json': json(await openApiDocument()),
  'src/web/api/contract.json': json(minifyContractRouter(contract)),
  'src/app/api/contract.json': json(minifyContractRouter(contract)),
  'src/web/api/api-version.json': json({ api: await apiVersion() }),
}
for (const [path, content] of Object.entries(outputs)) {
  await writeFile(new URL(`../${path}`, import.meta.url), content)
  console.log(`wrote ${path}`)
}
