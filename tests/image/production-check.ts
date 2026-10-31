import { request } from 'node:http'
import { startOidcProvider } from '../integration/oidc-provider.ts'

/*
  The production boot check's browser and agent (tests/image/production-boot.sh). It runs in the
  service container's network, so the stand-in OpenID Connect provider it starts listens on the
  same 127.0.0.1 as the service, as a provider on this computer would. Heed's public address is
  PUBLIC_ORIGIN, as if a TLS proxy served it: this script plays that proxy, sending /mcp, the
  login server and its discovery to the service and everything else to the web image's nginx,
  with the public host. Then, as a person: sign in with the provider, as an administrator by
  group; make an access key; and, as an agent with that key, call the MCP server. Each step
  prints one line; the first that fails stops the check with what it got.
*/

const publicOrigin = process.env.PUBLIC_ORIGIN ?? 'https://heed.example.test'
const serviceUrl = process.env.SERVICE_URL ?? 'http://127.0.0.1:3000'
const webUrl = process.env.WEB_URL ?? 'http://127.0.0.1:8080'
const issuerPort = Number(process.env.ISSUER_PORT ?? 9400)

interface Answer {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

/** One request, to where the public address's proxy would send it, with the public host. */
function send(
  address: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Answer> {
  const url = new URL(address)
  let target = url
  if (url.origin === publicOrigin) {
    const toService = /^\/(mcp|oauth\/|\.well-known\/oauth-)/.test(url.pathname)
    target = new URL(url.pathname + url.search, toService ? serviceUrl : webUrl)
  }
  return new Promise((resolve, reject) => {
    const sent = request(target, {
      method: init.method ?? 'GET',
      headers: { host: url.host, ...init.headers },
    })
    sent.setTimeout(15_000, () => sent.destroy(new Error(`no answer from ${address}`)))
    sent.on('error', reject)
    sent.on('response', (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => (body += chunk))
      response.on('end', () =>
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body }),
      )
    })
    sent.end(init.body)
  })
}

/** The browser's cookies, by name: the scenario never needs two with one name. */
const jar = new Map<string, string>()
function keepCookies(answer: Answer) {
  const set = answer.headers['set-cookie'] ?? []
  for (const line of Array.isArray(set) ? set : [set]) {
    const [pair = ''] = line.split(';')
    const [name = '', value = ''] = pair.split('=')
    if (value) jar.set(name.trim(), value)
    else jar.delete(name.trim())
  }
}
const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ')

function check(ok: boolean, step: string, answer?: Answer): void {
  if (ok) {
    console.log(`ok - ${step}`)
    return
  }
  const got = answer ? `: ${answer.status} ${answer.body.slice(0, 500)}` : ''
  throw new Error(`not ok - ${step}${got}`)
}

async function ready() {
  const until = Date.now() + 180_000
  for (;;) {
    const answer = await send(`${serviceUrl}/health/ready`).catch(() => undefined)
    if (answer?.status === 200) return
    if (Date.now() > until) check(false, 'the service is ready within three minutes', answer)
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

/** A JSON-RPC result from the MCP server, which answers as JSON or as one event. */
function rpcResult(answer: Answer): Record<string, unknown> | undefined {
  const text = String(answer.headers['content-type']).includes('text/event-stream')
    ? answer.body
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5))
        .join('')
    : answer.body
  try {
    return (JSON.parse(text) as { result?: Record<string, unknown> }).result
  } catch {
    return undefined
  }
}

const provider = await startOidcProvider({ clientSecret: null, port: issuerPort })
try {
  provider.as({
    sub: 'boot-check-0001',
    email: 'rowan.tester@example.test',
    email_verified: true,
    name: 'Rowan Tester',
    groups: ['heed-admins'],
  })
  await ready()
  check(true, 'the service in production mode is ready')

  // The demo's people picker is not there.
  const people = await send(`${publicOrigin}/api/v1/auth/people`)
  check(
    people.status !== 200 || people.body === '[]',
    'production lists nobody to pick from',
    people,
  )

  // Company sign-in, through the web image's proxy.
  const start = await send(`${publicOrigin}/api/v1/auth/oidc/start`)
  keepCookies(start)
  const authorize = String(start.headers.location)
  check(
    start.status === 302 && authorize.startsWith(`${provider.issuer}/authorize?`),
    'sign-in sends the browser to the OpenID Connect provider',
    start,
  )
  const signedIn = await send(authorize)
  const callback = String(signedIn.headers.location)
  check(
    signedIn.status === 302 && callback.startsWith(`${publicOrigin}/api/v1/auth/oidc/callback?`),
    'the provider sends the browser back to Heed with a code',
    signedIn,
  )
  const finished = await send(callback, { headers: { cookie: cookie() } })
  keepCookies(finished)
  check(
    finished.status === 302 &&
      String(finished.headers.location).startsWith(publicOrigin) &&
      !String(finished.headers.location).includes('error=') &&
      jar.has('heed_session'),
    'Heed signs the person in and sends them to the web app',
    finished,
  )
  const session = await send(`${publicOrigin}/api/v1/auth/session`, {
    headers: { cookie: cookie() },
  })
  const { person, csrfToken } = JSON.parse(session.body) as {
    person?: { name?: string }
    csrfToken?: string
  }
  check(
    session.status === 200 && person?.name === 'Rowan Tester' && Boolean(csrfToken),
    'the session is the person the provider signed in',
    session,
  )

  // An access key for an agent: only an administrator may make one, and the provider's group
  // made this person one.
  const made = await send(`${publicOrigin}/api/v1/access-keys`, {
    method: 'POST',
    headers: {
      cookie: cookie(),
      origin: publicOrigin,
      'x-heed-csrf': csrfToken!,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: 'Production boot check' }),
  })
  const { key } = JSON.parse(made.body) as { key?: string }
  check(
    made.status === 200 && Boolean(key?.startsWith('hak_')),
    'the administrator makes an access key',
    made,
  )

  // The agent, on the MCP server's public address.
  const mcp = (body: unknown, headers: Record<string, string> = {}) =>
    send(`${publicOrigin}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify(body),
    })
  const initialized = await mcp({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'production-boot-check', version: '1.0.0' },
    },
  })
  const server = rpcResult(initialized)?.serverInfo as { name?: string } | undefined
  check(
    initialized.status === 200 && Boolean(server?.name),
    'the MCP server answers initialize on its public host',
    initialized,
  )
  const mcpSession = initialized.headers['mcp-session-id']
  const listed = await mcp(
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    {
      'mcp-protocol-version': '2025-11-25',
      ...(typeof mcpSession === 'string' ? { 'mcp-session-id': mcpSession } : {}),
    },
  )
  const names = ((rpcResult(listed)?.tools ?? []) as { name: string }[]).map((tool) => tool.name)
  check(
    listed.status === 200 && names.includes('get_context'),
    `the agent lists its tools (${names.join(', ')})`,
    listed,
  )
  console.log('The service image signs a person in and serves an agent in production mode.')
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
} finally {
  await provider.close()
}
