import { parseArgs } from 'node:util'
import { devKey, mintDevToken } from './auth.ts'

const { values } = parseArgs({
  options: {
    client: { type: 'string', default: 'claude-code' },
    service: { type: 'boolean', default: false },
    'expires-in': { type: 'string', default: '8h' },
  },
})
// The gateway serves only labels with an enabled client policy (PUT /api/v1/clients/{label}).
if (!/^[a-z0-9_.-]{1,40}$/.test(values.client))
  throw new Error(
    'A client label has 1 to 40 lowercase letters, digits, dots, dashes or underscores',
  )
const key = await devKey(
  process.env.MCP_DEV_KEY_FILE ?? '.heed-dev-key.pem',
  process.env.NODE_ENV ?? 'development',
)
const token = await mintDevToken(key, process.env.MCP_RESOURCE_URL ?? 'http://localhost:3000/mcp', {
  client: values.client,
  scopes: ['read', 'feedback', ...(values.service ? ['edition'] : [])],
  expiresIn: values['expires-in'],
})
console.log(token)
