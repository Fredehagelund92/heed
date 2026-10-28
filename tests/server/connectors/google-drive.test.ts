import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { builtInConnectors } from '../../../src/connectors/index.ts'
import { documentLink, Drive, folderScopes } from '../../../src/connectors/google-drive/runtime.ts'
import {
  parseServiceAccountKey,
  signedAssertion,
} from '../../../src/connectors/google-drive/service-account.ts'
import type { ChosenScope } from '../../../src/domain/connector-runtime.ts'
import {
  registerConnectors,
  type StoredSource,
} from '../../../src/server/modules/connectors/index.ts'
import { SourceReadError } from '../../../src/server/modules/connectors/types.ts'
import { driveHost, type DriveHost } from './drive-server.ts'

/*
  Google Drive's runtime against a fake Drive on this machine, through the core as the content
  pipeline runs it: what it signs in with and where, which folder each document belongs to, what
  a read from a cursor sends when documents and folders change, and how it takes Google's
  refusals. The conformance kit covers the rest (conformance.test.ts).
*/

let drive: DriveHost
let key = ''
const ids: Record<string, string> = {}
const connector = registerConnectors(
  builtInConnectors.filter((module) => module.manifest.id === 'google-drive'),
  [],
)[0]!

const source = (scopes: ChosenScope[], secret = key): StoredSource => ({
  id: 'drive',
  name: 'Drive',
  config: { apiAddress: drive.address, signInAddress: drive.signInAddress },
  secrets: { serviceAccountKey: secret },
  scopes,
})
const read = (scopes: ChosenScope[], cursor: string | null = null) =>
  connector.content!(source(scopes)).read({ cursor })
const failure = async (work: Promise<unknown>) => {
  try {
    await work
  } catch (error) {
    if (error instanceof SourceReadError) return error
    throw error
  }
  throw new Error('It did not fail')
}
const scope = (id: string, domain = 'sales'): ChosenScope => ({ id, title: id, domain })

beforeAll(async () => {
  drive = await driveHost()
  key = drive.key()
  ids.data = drive.folder('Data team')
  ids.definitions = drive.folder('Definitions', ids.data)
  ids.archive = drive.folder('Archive', ids.definitions)
  ids.marketing = drive.folder('Marketing')
  ids.top = drive.document('Data team notes', ids.data, '# Notes\n\nOrders are counted daily.\n')
  ids.orders = drive.document('Orders', ids.definitions, '# Orders\n\nOrders include returns.\n')
  ids.old = drive.document('Old orders', ids.archive, '# Old orders\n\nOrders before 2020.\n')
  ids.spend = drive.document('Spend', ids.marketing, '# Spend\n\nSpend is booked monthly.\n')
  drive.file('Budget', ids.marketing, 'application/vnd.google-apps.spreadsheet')
})
afterAll(() => drive.close())

describe('the service account key', () => {
  it('is read from the JSON key file only', () => {
    const parsed = parseServiceAccountKey(key)
    expect(parsed?.clientEmail).toBe('heed-reader@drive-fake.example.test')
    expect(parseServiceAccountKey('not json')).toBeNull()
    expect(parseServiceAccountKey(JSON.stringify({ type: 'authorized_user' }))).toBeNull()
    const { private_key: _key, ...withoutKey } = JSON.parse(key) as Record<string, string>
    expect(parseServiceAccountKey(JSON.stringify(withoutKey))).toBeNull()
  })

  it('signs a request for read-only access, for the sign-in address, good for an hour', async () => {
    const assertion = await signedAssertion(parseServiceAccountKey(key)!, {
      audience: 'https://sign-in.example.test/token',
      now: new Date('2026-10-28T06:00:00Z'),
    })
    const claims = JSON.parse(Buffer.from(assertion.split('.')[1]!, 'base64url').toString()) as {
      scope: string
      aud: string
      exp: number
      iat: number
    }
    expect(claims.scope).toBe('https://www.googleapis.com/auth/drive.readonly')
    expect(claims.aud).toBe('https://sign-in.example.test/token')
    expect(claims.exp - claims.iat).toBe(3_600)
  })
})

describe('a check', () => {
  it('names the account to share folders with, and what it can see', async () => {
    const report = await connector.check(source([]))
    expect(report.steps.map((step) => [step.id, step.status])).toEqual([
      ['sign-in', 'ok'],
      ['folders', 'ok'],
      ['documents', 'ok'],
    ])
    expect(report.steps[0]!.detail).toContain('heed-reader@drive-fake.example.test')
    expect(report.steps[1]!.detail).toBe('2 folders are shared with it.')
  })

  it('says a file that is not a service account key is for an admin to fix', async () => {
    const report = await connector.check(source([], '{"type":"authorized_user"}'))
    expect(report.steps).toEqual([expect.objectContaining({ id: 'key', status: 'failed' })])
  })

  it('says a key Google refuses needs a new one', async () => {
    const report = await connector.check(source([], drive.strangerKey()))
    expect(report.steps).toEqual([
      expect.objectContaining({
        id: 'sign-in',
        status: 'failed',
        detail: expect.stringContaining('unauthorized') as unknown,
      }),
    ])
  })
})

describe('discover', () => {
  it('lists the shared folders and the folders directly in them, with a domain to suggest', async () => {
    const scopes = await connector.discover!(source([]))
    expect(scopes).toEqual([
      { id: ids.data, title: 'Data team', suggestedDomain: 'data_team' },
      { id: ids.definitions, title: 'Data team / Definitions', suggestedDomain: 'definitions' },
      { id: ids.marketing, title: 'Marketing', suggestedDomain: 'marketing' },
    ])
  })
})

describe('a full read', () => {
  it('sends every Google Doc under the chosen folders, each with the deepest chosen folder', async () => {
    const result = await read([scope(ids.data!), scope(ids.definitions!, 'finance')])
    expect(result.complete).toBe(true)
    expect(
      Object.fromEntries(result.documents.map((document) => [document.id, document.scope])),
    ).toEqual({ [ids.top!]: ids.data, [ids.orders!]: ids.definitions, [ids.old!]: ids.definitions })
    const orders = result.documents.find((document) => document.id === ids.orders)!
    expect(orders).toMatchObject({
      title: 'Orders',
      link: documentLink(ids.orders!),
      mediaType: 'text/markdown',
      text: '# Orders\n\nOrders include returns.\n',
    })
    expect(result.cursor).toMatch(/^\d+$/)
  })

  it('signs in with a POST to the sign-in address only, and reads Drive with GETs', async () => {
    drive.requests.length = 0
    await read([scope(ids.marketing!)])
    const posts = drive.requests.filter((request) => request.method !== 'GET')
    expect(posts.map((request) => request.path)).toEqual(['/token'])
    // The private key never leaves the server: only a signed request does.
    const privateKey = (JSON.parse(key) as { private_key: string }).private_key
    for (const line of privateKey.split('\n').slice(1, -2))
      expect(JSON.stringify(drive.requests)).not.toContain(line)
    for (const request of drive.requests.filter((r) => r.path !== '/token'))
      expect(request.authorization).toMatch(/^Bearer fake-access-/)
  })

  it('is partial when a chosen folder can no longer be seen, and says which', async () => {
    const result = await read([scope(ids.marketing!), scope('gone-folder-id')])
    expect(result.complete).toBe(false)
    expect(result.warnings).toContainEqual({ code: 'folder_missing', target: 'gone-folder-id' })
    expect(result.documents.map((document) => document.id)).toEqual([ids.spend])
  })
})

describe('a read from a cursor', () => {
  it('sends what moved in and tombstones what moved out, for documents and for folders', async () => {
    const chosen = [scope(ids.data!), scope(ids.marketing!, 'marketing')]
    const first = await read(chosen)
    const elsewhere = drive.folder('Elsewhere', null, { shared: true })
    const away = drive.document('Away', elsewhere, '# Away\n\nOrders elsewhere.\n')
    drive.move(ids.spend!, elsewhere)
    drive.move(away, ids.marketing!)
    drive.move(ids.archive!, elsewhere)
    drive.rename(ids.top!, 'Data team notes, 2026')
    const delta = await read(chosen, first.cursor)
    expect(delta.documents.map((document) => [document.id, document.scope]).sort()).toEqual(
      [
        [away, ids.marketing],
        [ids.top, ids.data],
      ].sort(),
    )
    expect(delta.deleted).toEqual([ids.spend])
    expect(delta.deleted).not.toContain(ids.old)
    expect(delta.cursor).toBeUndefined()
    const full = await read(chosen)
    expect(full.documents.map((document) => document.id)).not.toContain(ids.old)
    // Moved back where it was, for the reads after this one.
    drive.move(ids.spend!, ids.marketing!)
    drive.move(ids.archive!, ids.definitions!)
  })

  it('leaves a changed folder outside every chosen folder alone, and tombstones nothing in it', async () => {
    const chosen = drive.folder('Chosen only')
    const other = drive.folder('Not chosen', null, { shared: true })
    const never = drive.document('Never read', other, '# Never\n\nOrders never.\n')
    const first = await read([scope(chosen)])
    drive.rename(other, 'Not chosen, renamed')
    drive.move(drive.folder('Moved', null, { shared: true }), other)
    const before = drive.requests.length
    const delta = await read([scope(chosen)], first.cursor)
    expect(delta.documents).toEqual([])
    expect(delta.deleted).not.toContain(never)
    expect(delta.cursor).toBeUndefined()
    expect(
      drive.requests.slice(before).filter((request) => request.path.endsWith('/export')),
    ).toEqual([])
  })

  it('does not read the siblings of an edited document again', async () => {
    const folder = drive.folder('Edits')
    const edited = drive.document('Edited', folder, '# Edited\n\nOrders edited.\n')
    drive.document('Sibling', folder, '# Sibling\n\nOrders sibling.\n')
    const first = await read([scope(folder)])
    expect(first.documents).toHaveLength(2)
    drive.rename(edited, 'Edited again')
    const before = drive.requests.length
    const delta = await read([scope(folder)], first.cursor)
    expect(delta.documents.map((document) => document.id)).toEqual([edited])
    expect(delta.cursor).toMatch(/^\d+$/)
    expect(
      drive.requests.slice(before).filter((request) => request.path.endsWith('/export')),
    ).toHaveLength(1)
  })

  it('says a walk that stopped at its folder limit is partial', async () => {
    const top = drive.folder('Many')
    drive.folder('One', top)
    drive.folder('Two', top)
    const controller = new AbortController()
    const context = {
      config: { apiAddress: drive.address, signInAddress: drive.signInAddress },
      scopes: [],
      cursor: null,
      secret: () => key,
      fetch: (address: string, init?: RequestInit) => fetch(address, init),
      signal: controller.signal,
      now: () => new Date(),
    }
    const session = new Drive(context as never, parseServiceAccountKey(key)!)
    expect((await folderScopes(session, [scope(top)], 2)).capped).toBe(true)
    expect((await folderScopes(session, [scope(top)], 10)).capped).toBe(false)
  })

  it('keeps the documents of a chosen folder that is no longer shared, and says which', async () => {
    const shared = drive.folder('Shared for a while')
    const inside = drive.document('Inside', shared, '# Inside\n\nOrders inside.\n')
    const first = await read([scope(shared)])
    expect(first.documents.map((document) => document.id)).toEqual([inside])
    drive.share(shared, false)
    // Drive reports the folder gone, not each document in it: an admin chooses what to do.
    const delta = await read([scope(shared)], first.cursor)
    expect(delta.complete).toBe(false)
    expect(delta.warnings).toContainEqual({ code: 'folder_missing', target: shared })
    expect(delta.deleted).not.toContain(inside)
  })

  it('reads everything again from a new start when Drive no longer knows its cursor', async () => {
    const folder = drive.folder('Read again')
    const again = drive.document('Again', folder, '# Again\n\nOrders again.\n')
    const result = await read([scope(folder)], '999999')
    expect(result.documents.map((document) => document.id)).toEqual([again])
    expect(result.cursor).toMatch(/^\d+$/)
  })
})

describe("Google's refusals", () => {
  it('leaves out a document its owner does not let viewers download, and says so', async () => {
    const folder = drive.folder('Locked')
    const locked = drive.document('Locked', folder, '# Locked\n\nOrders locked.\n')
    drive.blockExport(locked)
    const result = await read([scope(folder)])
    expect(result.documents).toEqual([])
    expect(result.unread).toEqual([locked])
    expect(result.warnings).toContainEqual({ code: 'unreadable_file', target: locked })
  })

  it('takes too many requests as a failure that clears, after the time Google asked', async () => {
    drive.refuse(/^\/drive\/v3\/files$/, 429, { retryAfter: '120' })
    const error = await failure(read([scope(ids.marketing!)]))
    expect(error.warnings[0]?.code).toBe('rate_limited')
    expect(error.errorClass).toBe('transient')
    expect(error.retryAfter).toBe(120)
  })

  it('says the Drive API is off in the project, for an admin to fix', async () => {
    drive.refuse(/^\/drive\/v3\/files/, 403, { reason: 'accessNotConfigured' })
    const error = await failure(read([scope(ids.marketing!)]))
    expect(error.warnings[0]?.code).toBe('google-drive.api_disabled')
    expect(error.errorClass).toBe('config')
  })

  it('says a refused key is for an admin to fix, and never what the key was', async () => {
    const stranger = drive.strangerKey()
    const error = await failure(
      connector.content!(source([scope(ids.marketing!)], stranger)).read({ cursor: null }),
    )
    expect(error.warnings).toEqual([{ code: 'unauthorized', target: 'serviceAccountKey' }])
    expect(error.errorClass).toBe('config')
    expect(JSON.stringify(error)).not.toContain('PRIVATE KEY')
  })

  it('takes a host that cannot be reached as a failure that clears', async () => {
    const error = await failure(
      connector.content!({
        ...source([scope(ids.marketing!)]),
        config: { apiAddress: 'http://127.0.0.1:9', signInAddress: 'http://127.0.0.1:9/token' },
      }).read({ cursor: null }),
    )
    expect(error.warnings[0]?.code).toBe('unreachable')
    expect(error.errorClass).toBe('transient')
  })
})
