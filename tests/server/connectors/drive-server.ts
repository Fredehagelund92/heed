import { createVerify, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/*
  A Google Drive on this machine for tests: the few parts of Drive's API the connector uses
  (sign-in with a service account's signed request, files.list, files.get, files.export as
  Markdown, changes.getStartPageToken and changes.list), over plain http on 127.0.0.1. Its
  service accounts and their keys are invented when it starts and live in memory only: no real
  key, token or account is ever in a test, a fixture or a log.

  It shows a service account only the folders shared with it and what is under them, keeps a
  change log as Drive does (a moved folder is one change, not one per document in it), and records
  every request, so a test can prove where the key and the token went and that nothing was
  written.
*/

const FOLDER = 'application/vnd.google-apps.folder'
const DOCUMENT = 'application/vnd.google-apps.document'
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

interface FakeFile {
  id: string
  name: string
  mimeType: string
  parents: string[]
  modifiedTime: string
  version: number
  trashed: boolean
  deleted: boolean
  shared: boolean
  markdown: string
  /** Its owner does not let viewers download it. */
  exportBlocked: boolean
}

export interface DriveRequest {
  method: string
  path: string
  authorization: string | null
  body: string
}

/** A refusal the next requests to a path get, to test how a read takes it. */
interface Planned {
  path: RegExp
  status: number
  reason?: string
  retryAfter?: string
  times: number
}

const base64Url = (value: string) => Buffer.from(value, 'base64url')

/**
 * Starts the fake Drive. `pageSize` caps every page it answers, so a test can read lists page by
 * page; `startAt` is when its first file changed, each change a minute after the one before.
 */
export async function driveHost({
  pageSize = 1000,
  startAt = '2026-10-01T06:00:00Z',
}: { pageSize?: number; startAt?: string } = {}) {
  const files = new Map<string, FakeFile>()
  const accounts = new Map<string, KeyObject>()
  const tokens = new Set<string>()
  const log: { seq: number; fileId: string }[] = []
  const requests: DriveRequest[] = []
  const planned: Planned[] = []
  let seq = 0
  let clock = Date.parse(startAt) - 60_000

  const now = () => new Date((clock += 60_000)).toISOString()
  const newId = () => randomBytes(12).toString('base64url')
  const changed = (fileId: string) => log.push({ seq: ++seq, fileId })

  /** Whether the service accounts can see a file: it, or a folder it is in, is shared. */
  const visible = (file: FakeFile | undefined, depth = 0): boolean => {
    if (!file || file.deleted || depth > 50) return false
    if (file.shared) return true
    return file.parents.some((parent) => visible(files.get(parent), depth + 1))
  }
  const meta = (file: FakeFile) => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parents: file.parents,
    modifiedTime: file.modifiedTime,
    version: String(file.version),
    trashed: file.trashed,
  })
  const touch = (file: FakeFile) => {
    file.version++
    file.modifiedTime = now()
    changed(file.id)
  }
  const get = (id: string) => {
    const file = files.get(id)
    if (!file) throw new Error(`No file ${id} in the fake Drive`)
    return file
  }

  /** The files a query of the forms the connector writes finds; null for one it does not. */
  function query(q: string): FakeFile[] | null {
    let found = [...files.values()].filter((file) => visible(file))
    for (const clause of q.split(' and ')) {
      let match: RegExpExecArray | null
      if ((match = /^mimeType='([^']+)'$/.exec(clause))) {
        const type = match[1]
        found = found.filter((file) => file.mimeType === type)
      } else if (clause === 'sharedWithMe') found = found.filter((file) => file.shared)
      else if (clause === 'trashed=false') found = found.filter((file) => !file.trashed)
      else if ((match = /^'([A-Za-z0-9_-]+)' in parents$/.exec(clause))) {
        const parent = match[1]!
        found = found.filter((file) => file.parents.includes(parent))
      } else return null
    }
    return found.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  }

  /** A page of a list: `pageToken` is where it starts. */
  function page<T>(all: T[], url: URL) {
    const size = Math.min(Number(url.searchParams.get('pageSize') ?? 100), pageSize)
    const from = Number(url.searchParams.get('pageToken') ?? 0)
    const items = all.slice(from, from + size)
    return { items, next: from + size < all.length ? String(from + size) : null }
  }

  const json = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  }
  const refuse = (
    response: ServerResponse,
    status: number,
    reason: string,
    retryAfter?: string,
  ) => {
    response.writeHead(status, {
      'content-type': 'application/json',
      ...(retryAfter ? { 'retry-after': retryAfter } : {}),
    })
    response.end(JSON.stringify({ error: { code: status, errors: [{ reason }], message: reason } }))
  }

  /** The service account a signed request comes from, when Google would take it. */
  function signedBy(assertion: string, audience: string): string | null {
    const [header, claims, signature] = assertion.split('.')
    if (!header || !claims || !signature) return null
    try {
      const head = JSON.parse(base64Url(header).toString()) as { alg?: string }
      const body = JSON.parse(base64Url(claims).toString()) as Record<string, unknown>
      const key = typeof body.iss === 'string' ? accounts.get(body.iss) : undefined
      if (head.alg !== 'RS256' || !key) return null
      const verify = createVerify('RSA-SHA256')
      verify.update(`${header}.${claims}`)
      if (!verify.verify(key, base64Url(signature))) return null
      const at = Date.now() / 1000
      if (body.aud !== audience || body.scope !== SCOPE) return null
      if (typeof body.exp !== 'number' || body.exp < at || typeof body.iat !== 'number') return null
      return body.iss as string
    } catch {
      return null
    }
  }

  async function serve(request: IncomingMessage, response: ServerResponse, address: string) {
    let body = ''
    for await (const chunk of request) body += String(chunk)
    const url = new URL(request.url ?? '/', address)
    const authorization = request.headers.authorization ?? null
    requests.push({ method: request.method ?? 'GET', path: url.pathname, authorization, body })

    const plan = planned.find((p) => p.path.test(url.pathname) && p.times > 0)
    if (plan) {
      plan.times--
      refuse(response, plan.status, plan.reason ?? 'backendError', plan.retryAfter)
      return
    }

    if (url.pathname === '/token') {
      const form = new URLSearchParams(body)
      const account =
        request.method === 'POST' &&
        form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer'
          ? signedBy(form.get('assertion') ?? '', `${address}/token`)
          : null
      if (!account) {
        json(response, 400, { error: 'invalid_grant', error_description: 'Invalid signature.' })
        return
      }
      const token = `fake-access-${randomBytes(16).toString('hex')}`
      tokens.add(token)
      json(response, 200, { access_token: token, expires_in: 3599, token_type: 'Bearer' })
      return
    }

    if (!url.pathname.startsWith('/drive/v3/')) {
      response.writeHead(404).end()
      return
    }
    if (request.method !== 'GET') {
      refuse(response, 405, 'methodNotAllowed')
      return
    }
    const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null
    if (!bearer || !tokens.has(bearer)) {
      refuse(response, 401, 'authError')
      return
    }
    const path = url.pathname.slice('/drive/v3/'.length)

    if (path === 'changes/startPageToken') {
      json(response, 200, { startPageToken: String(seq + 1) })
      return
    }
    if (path === 'changes') {
      const token = url.searchParams.get('pageToken') ?? ''
      const from = /^\d+$/.test(token) ? Number(token) : Number.NaN
      if (!(from >= 1 && from <= seq + 1)) {
        refuse(response, 400, 'invalid')
        return
      }
      // Drive pages a change list by the position of its next change.
      const since = log.filter((entry) => entry.seq >= from)
      const size = Math.min(Number(url.searchParams.get('pageSize') ?? 100), pageSize)
      const items = since.slice(0, size)
      const rest = since.slice(size)
      json(response, 200, {
        changes: items.map(({ fileId }) => {
          const file = files.get(fileId)
          return visible(file)
            ? { fileId, removed: false, file: meta(file!) }
            : { fileId, removed: true }
        }),
        ...(rest.length
          ? { nextPageToken: String(rest[0]!.seq) }
          : { newStartPageToken: String(seq + 1) }),
      })
      return
    }
    if (path === 'files') {
      const found = query(url.searchParams.get('q') ?? '')
      if (found === null) {
        refuse(response, 400, 'invalidQuery')
        return
      }
      const { items, next } = page(found, url)
      json(response, 200, { files: items.map(meta), ...(next ? { nextPageToken: next } : {}) })
      return
    }
    const exported = /^files\/([A-Za-z0-9_-]+)\/export$/.exec(path)
    if (exported) {
      const file = files.get(exported[1]!)
      if (!visible(file)) return refuse(response, 404, 'notFound')
      if (file!.mimeType !== DOCUMENT || url.searchParams.get('mimeType') !== 'text/markdown')
        return refuse(response, 400, 'badRequest')
      if (file!.exportBlocked) return refuse(response, 403, 'cannotExportFile')
      response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' })
      response.end(file!.markdown)
      return
    }
    const one = /^files\/([A-Za-z0-9_-]+)$/.exec(path)
    if (one) {
      const file = files.get(one[1]!)
      if (!visible(file)) return refuse(response, 404, 'notFound')
      json(response, 200, meta(file!))
      return
    }
    refuse(response, 404, 'notFound')
  }

  let address = ''
  const server = createServer((request, response) => {
    serve(request, response, address).catch(() => {
      if (!response.headersSent) response.writeHead(500)
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const add = (file: Omit<FakeFile, 'id' | 'modifiedTime' | 'version' | 'deleted'>) => {
    const id = newId()
    files.set(id, { ...file, id, modifiedTime: now(), version: 1, deleted: false })
    changed(id)
    return id
  }

  /** An invented service account key, as Google Cloud gives one, for an account of this Drive. */
  const newKey = (name: string, known: boolean) => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const clientEmail = `${name}@drive-fake.example.test`
    if (known) accounts.set(clientEmail, publicKey)
    return JSON.stringify({
      type: 'service_account',
      project_id: 'drive-fake',
      private_key_id: randomBytes(20).toString('hex'),
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      client_email: clientEmail,
      client_id: '100000000000000000000',
      token_uri: `${address}/token`,
    })
  }

  return {
    /** Where its API is: the Google API address a source is given. */
    address,
    /** Where a service account signs in: the Google sign-in address a source is given. */
    signInAddress: `${address}/token`,
    requests,
    /** The access tokens it gave, which must show nowhere either. */
    issued: () => [...tokens],
    /** A key of a service account this Drive knows. */
    key: (name = 'heed-reader') => newKey(name, true),
    /** A key in the right form that this Drive refuses, as Google refuses a deleted key. */
    strangerKey: () => newKey('stranger', false),
    /** A folder; a shared one is shared with the service accounts. */
    folder: (name: string, parent: string | null = null, { shared = parent === null } = {}) =>
      add({
        name,
        mimeType: FOLDER,
        parents: parent ? [parent] : [],
        trashed: false,
        shared,
        markdown: '',
        exportBlocked: false,
      }),
    /** A Google Doc in a folder, whose Markdown export is the text given. */
    document: (name: string, parent: string, markdown: string) =>
      add({
        name,
        mimeType: DOCUMENT,
        parents: [parent],
        trashed: false,
        shared: false,
        markdown,
        exportBlocked: false,
      }),
    /** Another kind of file, which a read leaves alone. */
    file: (name: string, parent: string, mimeType: string) =>
      add({
        name,
        mimeType,
        parents: [parent],
        trashed: false,
        shared: false,
        markdown: '',
        exportBlocked: false,
      }),
    edit(id: string, markdown: string) {
      const file = get(id)
      file.markdown = markdown
      touch(file)
    },
    rename(id: string, name: string) {
      const file = get(id)
      file.name = name
      touch(file)
    },
    move(id: string, parent: string) {
      const file = get(id)
      file.parents = [parent]
      touch(file)
    },
    trash(id: string) {
      const file = get(id)
      file.trashed = true
      touch(file)
    },
    share(id: string, shared: boolean) {
      const file = get(id)
      file.shared = shared
      touch(file)
    },
    /** Gone without a change in the log: a change a change list missed. */
    forget(id: string) {
      get(id).deleted = true
    },
    blockExport(id: string) {
      get(id).exportBlocked = true
    },
    /** The next `times` requests to a path are refused with this status. */
    refuse(
      path: RegExp,
      status: number,
      { reason, retryAfter, times = 1 } = {} as Partial<Planned>,
    ) {
      planned.push({
        path,
        status,
        times,
        ...(reason ? { reason } : {}),
        ...(retryAfter ? { retryAfter } : {}),
      })
    },
    /** The changes in the log so far, for a test that wants the token Drive would give now. */
    startToken: () => String(seq + 1),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

export type DriveHost = Awaited<ReturnType<typeof driveHost>>
