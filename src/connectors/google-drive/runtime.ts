import {
  defineRuntime,
  SourceError,
  type CheckReport,
  type ChosenScope,
  type RuntimeContext,
  type RuntimeMessage,
  type Scope,
} from '../../domain/connector-runtime.ts'
import { DOCUMENT_TEXT_MAX, READ_TEXT_MAX } from '../../domain/content-document.ts'
import {
  parseServiceAccountKey,
  signedAssertion,
  type ServiceAccountKey,
} from './service-account.ts'

/*
  Google Drive's runtime (docs/connectors.md, "Interface 3.0"): the Google Docs in the folders
  shared with a service account. It signs in with the account's key for a token that can only
  view, lists the folders shared with the account as the scopes to choose, exports each document
  as Markdown (`files.export`) and reads the changes since its cursor (`changes.list`).

  A read from no cursor lists every document of the chosen folders and the folders under them,
  so the core may count one it leaves out as gone. A read from a cursor sends what changed since
  it: each changed document of a chosen folder, and a tombstone for one that was removed, trashed,
  or moved out of the chosen folders. The core hands no cursor now and then, so a full read finds
  what a change list missed (`deletions: 'both'`).

  Everything Google answers is untrusted: ids are checked before they go into an address or a
  query, answers are capped in size, and a document's link is built from its id.
*/

interface Config {
  apiAddress?: string
  signInAddress?: string
}

/** Google's own addresses, used when the settings name none. */
export const GOOGLE_API = 'https://www.googleapis.com'
export const GOOGLE_SIGN_IN = 'https://oauth2.googleapis.com/token'

const FOLDER = 'application/vnd.google-apps.folder'
const DOCUMENT = 'application/vnd.google-apps.document'
const SECRET = 'serviceAccountKey'
/** The most bytes of a list or a sign-in answer a read takes. */
const ANSWER_MAX = 8_000_000
/** The most bytes of one exported document: its text in UTF-8 at the longest. */
const EXPORT_MAX = DOCUMENT_TEXT_MAX * 4
/** The most folders a read walks under the chosen ones. */
const FOLDERS_MAX = 5_000
/** The most scopes discover lists, as the core takes them. */
const SCOPES_MAX = 200
const PAGE_SIZE = '1000'
/** The most documents a check counts: one page. */
const DOCUMENTS_COUNTED = 1_000
const FILE_FIELDS = 'id,name,mimeType,parents,modifiedTime,version,trashed'
/** What every list asks for: folders in shared drives as well as in someone's own Drive. */
const ALL_DRIVES = { supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' }

const driveId = /^[A-Za-z0-9_-]{1,200}$/
const pageToken = /^[\x21-\x7e]{1,500}$/

/** A file as a read uses it, checked: a folder, a document or something else. */
interface DriveFile {
  id: string
  name: string
  mimeType: string
  parents: string[]
  modifiedTime: string | null
  version: string | null
  trashed: boolean
}

interface Change {
  fileId: string
  removed: boolean
  file: DriveFile | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A file from an answer, or null when it is not one a read can use. */
function fileOf(raw: unknown): DriveFile | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !driveId.test(raw.id)) return null
  const time =
    typeof raw.modifiedTime === 'string' && !Number.isNaN(Date.parse(raw.modifiedTime))
      ? new Date(raw.modifiedTime).toISOString()
      : null
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : '',
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : '',
    parents: Array.isArray(raw.parents)
      ? raw.parents.filter((p): p is string => typeof p === 'string' && driveId.test(p))
      : [],
    modifiedTime: time,
    version: typeof raw.version === 'string' && /^\d{1,30}$/.test(raw.version) ? raw.version : null,
    trashed: raw.trashed === true,
  }
}

/** A document's title: its name in Drive, or words for one without a name. */
const titleOf = (file: DriveFile) => [...file.name.trim()].slice(0, 300).join('') || 'Untitled'

/** A document's address in Google Docs, built from its checked id. */
export const documentLink = (id: string) =>
  `https://docs.google.com/document/d/${encodeURIComponent(id)}/edit`

/** The domain a folder's name would most likely be, as a domain id. */
const suggestedDomain = (name: string) => {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return /^[a-z][a-z0-9_]{1,39}$/.test(id) ? id : null
}

/** Seconds to wait from a `Retry-After` header: seconds, or a date. */
function retryAfterOf(response: Response, now: Date): number | undefined {
  const header = response.headers.get('retry-after')
  if (!header) return undefined
  if (/^\d{1,6}$/.test(header.trim())) return Number(header.trim())
  const at = Date.parse(header)
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now.getTime()) / 1000))
}

/** An answer's body as text, read only up to `max` bytes; null when it is longer or not text. */
async function bodyOf(response: Response, max: number): Promise<string | null> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** Google's reason for a refusal, from its error answer, if it says one. */
async function reasonOf(response: Response): Promise<string> {
  const text = await bodyOf(response, 100_000)
  try {
    const error = (JSON.parse(text ?? '') as { error?: unknown }).error
    if (!isRecord(error)) return ''
    const first = Array.isArray(error.errors) ? (error.errors[0] as unknown) : undefined
    const reason = isRecord(first) && typeof first.reason === 'string' ? first.reason : ''
    const details = Array.isArray(error.details) ? error.details : []
    const disabled = details.some(
      (detail) => isRecord(detail) && detail.reason === 'SERVICE_DISABLED',
    )
    return disabled ? 'accessNotConfigured' : reason
  } catch {
    return ''
  }
}

const rateReasons = ['rateLimitExceeded', 'userRateLimitExceeded', 'sharingRateLimitExceeded']

/** One session with Drive: signed in once, then every request with the same short-lived token. */
export class Drive {
  readonly #context: RuntimeContext<Config>
  readonly #key: ServiceAccountKey
  #token: string | null = null

  constructor(context: RuntimeContext<Config>, key: ServiceAccountKey) {
    this.#context = context
    this.#key = key
  }

  get #api() {
    return (this.#context.config.apiAddress ?? GOOGLE_API).replace(/\/+$/, '')
  }

  get #signIn() {
    return this.#context.config.signInAddress ?? GOOGLE_SIGN_IN
  }

  /** A request through `ctx.fetch`; a host that cannot be reached is a failure that clears. */
  async #request(address: string, init: Parameters<RuntimeContext['fetch']>[1]) {
    try {
      return await this.#context.fetch(address, init)
    } catch (error) {
      if (error instanceof SourceError || this.#context.signal.aborted) throw error
      throw new SourceError({
        code: 'unreachable',
        target: URL.parse(address)?.host ?? 'address',
        class: 'transient',
      })
    }
  }

  /** Why a request was refused, as the core says it: its code, its target and its class. */
  async #refusal(response: Response, target: string): Promise<SourceError> {
    const retryAfter = retryAfterOf(response, this.#context.now())
    const after = retryAfter === undefined ? {} : { retryAfter }
    const { status } = response
    if (status === 401) {
      await response.body?.cancel()
      return new SourceError({ code: 'unauthorized', target: SECRET, class: 'config' })
    }
    if (status === 403) {
      const reason = await reasonOf(response)
      // Google exports at most 10 MB of a document; an owner may forbid viewers to download it.
      if (reason === 'exportSizeLimitExceeded')
        return new SourceError({ code: 'document_too_large', target, class: 'source' })
      if (reason === 'cannotExportFile' || reason === 'cannotDownloadFile')
        return new SourceError({ code: 'unreadable_file', target, class: 'source' })
      if (rateReasons.includes(reason))
        return new SourceError({ code: 'rate_limited', target, class: 'transient', ...after })
      if (reason === 'accessNotConfigured')
        return new SourceError({ code: 'google-drive.api_disabled', target, class: 'config' })
      return new SourceError({ code: 'unauthorized', target, class: 'config' })
    }
    await response.body?.cancel()
    if (status === 404) return new SourceError({ code: 'not_found', target, class: 'config' })
    if (status === 429)
      return new SourceError({ code: 'rate_limited', target, class: 'transient', ...after })
    if (status >= 500)
      return new SourceError({ code: 'unreachable', target, class: 'transient', ...after })
    return new SourceError({ code: 'fetch_failed', target, class: 'source' })
  }

  /** Signs in with the key, once per session, for a token that can only view (CON-106). */
  async signIn(): Promise<void> {
    if (this.#token !== null) return
    let assertion: string
    try {
      assertion = await signedAssertion(this.#key, {
        audience: this.#signIn,
        now: this.#context.now(),
      })
    } catch {
      // A private key that cannot sign is one Google would refuse too.
      throw new SourceError({ code: 'unauthorized', target: SECRET, class: 'config' })
    }
    const response = await this.#request(this.#signIn, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    })
    const host = URL.parse(this.#signIn)?.host ?? 'sign-in'
    // Google refuses a key it does not know, or one deleted or switched off, with a 400.
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      throw new SourceError({ code: 'unauthorized', target: SECRET, class: 'config' })
    }
    if (!response.ok) throw await this.#refusal(response, host)
    const body = await bodyOf(response, ANSWER_MAX)
    let token: unknown
    try {
      token = (JSON.parse(body ?? '') as { access_token?: unknown }).access_token
    } catch {
      token = undefined
    }
    if (typeof token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token))
      throw new SourceError({ code: 'fetch_failed', target: host, class: 'source' })
    this.#token = token
  }

  /** A GET of Drive's API, signed in; a refusal is a `SourceError`. */
  async #get(path: string, params: Record<string, string>, target: string) {
    await this.signIn()
    const query = new URLSearchParams(params).toString()
    const response = await this.#request(`${this.#api}/drive/v3/${path}?${query}`, {
      headers: { authorization: `Bearer ${this.#token}`, accept: 'application/json' },
    })
    if (!response.ok) throw await this.#refusal(response, target)
    return response
  }

  async #json(path: string, params: Record<string, string>, target: string) {
    const body = await bodyOf(await this.#get(path, params, target), ANSWER_MAX)
    try {
      const parsed: unknown = JSON.parse(body ?? '')
      if (isRecord(parsed)) return parsed
    } catch {
      // Not JSON: said below.
    }
    throw new SourceError({ code: 'fetch_failed', target, class: 'source' })
  }

  /** Every file a query finds, page by page, in name order; past `max`, the pages stop. */
  async list(q: string, target: string, max = 100_000): Promise<DriveFile[]> {
    const files: DriveFile[] = []
    let page: string | undefined
    do {
      const answer = await this.#json(
        'files',
        {
          q,
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          pageSize: PAGE_SIZE,
          orderBy: 'name',
          ...ALL_DRIVES,
          ...(page ? { pageToken: page } : {}),
        },
        target,
      )
      for (const raw of Array.isArray(answer.files) ? answer.files : []) {
        const file = fileOf(raw)
        if (file) files.push(file)
      }
      page =
        typeof answer.nextPageToken === 'string' && pageToken.test(answer.nextPageToken)
          ? answer.nextPageToken
          : undefined
    } while (page !== undefined && files.length < max)
    return files
  }

  /** One file by its id; null when the account cannot see it. */
  async file(id: string): Promise<DriveFile | null> {
    try {
      return fileOf(
        await this.#json(`files/${id}`, { fields: FILE_FIELDS, supportsAllDrives: 'true' }, id),
      )
    } catch (error) {
      if (error instanceof SourceError && error.code === 'not_found') return null
      throw error
    }
  }

  /**
   * A Google Doc as Markdown, or why it cannot be read this time: too long, or its owner does not
   * let viewers download it, or not text.
   */
  async export(id: string): Promise<{ text: string } | { unread: string }> {
    try {
      const response = await this.#get(`files/${id}/export`, { mimeType: 'text/markdown' }, id)
      const text = await bodyOf(response, EXPORT_MAX)
      return text === null ? { unread: 'document_too_large' } : { text }
    } catch (error) {
      if (
        error instanceof SourceError &&
        error.target === id &&
        (error.code === 'document_too_large' || error.code === 'unreadable_file')
      )
        return { unread: error.code }
      throw error
    }
  }

  /** Where the changes from now on start. */
  async startToken(): Promise<string> {
    const answer = await this.#json(
      'changes/startPageToken',
      { supportsAllDrives: 'true' },
      'changes',
    )
    const token = answer.startPageToken
    if (typeof token !== 'string' || !pageToken.test(token))
      throw new SourceError({ code: 'fetch_failed', target: 'changes', class: 'source' })
    return token
  }

  /**
   * Every change since a token, the last change of each file, and the token to start from next;
   * null when Drive no longer knows the token.
   */
  async changes(from: string): Promise<{ changes: Change[]; next: string } | null> {
    const changes = new Map<string, Change>()
    let page = from
    for (;;) {
      let answer: Record<string, unknown>
      try {
        answer = await this.#json(
          'changes',
          {
            pageToken: page,
            pageSize: PAGE_SIZE,
            includeRemoved: 'true',
            spaces: 'drive',
            fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
            ...ALL_DRIVES,
          },
          'changes',
        )
      } catch (error) {
        if (error instanceof SourceError && error.code === 'fetch_failed' && page === from)
          return null
        throw error
      }
      for (const raw of Array.isArray(answer.changes) ? answer.changes : []) {
        if (!isRecord(raw) || typeof raw.fileId !== 'string' || !driveId.test(raw.fileId)) continue
        changes.delete(raw.fileId)
        changes.set(raw.fileId, {
          fileId: raw.fileId,
          removed: raw.removed === true,
          file: fileOf(raw.file),
        })
      }
      const next = answer.newStartPageToken
      if (typeof next === 'string' && pageToken.test(next))
        return { changes: [...changes.values()], next }
      const more = answer.nextPageToken
      if (typeof more !== 'string' || !pageToken.test(more) || more === page)
        throw new SourceError({ code: 'fetch_failed', target: 'changes', class: 'source' })
      page = more
    }
  }
}

/** The key from the source's secret; a missing or malformed one is for an admin to fix. */
function keyOf(context: RuntimeContext<Config>): ServiceAccountKey {
  const secret = context.secret(SECRET)
  if (secret === null)
    throw new SourceError({ code: 'secret_missing', target: SECRET, class: 'config' })
  const key = parseServiceAccountKey(secret)
  if (!key) throw new SourceError({ code: 'unauthorized', target: SECRET, class: 'config' })
  return key
}

/** The folders shared with the account, in name order: where its documents can be. */
const sharedFolders = (drive: Drive) =>
  drive.list(`mimeType='${FOLDER}' and sharedWithMe and trashed=false`, 'folders')

const childrenOf = (drive: Drive, folder: string, foldersOnly = false) =>
  drive.list(
    `'${folder}' in parents${foldersOnly ? ` and mimeType='${FOLDER}'` : ''} and trashed=false`,
    folder,
  )

/**
 * The folders under the chosen ones, each with the scope it belongs to: the deepest chosen
 * folder it is in, so a folder chosen inside another takes its own documents. Also the chosen
 * folders the account can no longer see, and whether the walk stopped at its limit.
 */
export async function folderScopes(
  drive: Drive,
  scopes: readonly ChosenScope[],
  limit = FOLDERS_MAX,
) {
  const chosen = new Set(scopes.map((scope) => scope.id))
  const owner = new Map<string, string>()
  const missing: string[] = []
  let capped = false
  walk: for (const scope of [...scopes].sort((a, b) => a.id.localeCompare(b.id))) {
    const folder = driveId.test(scope.id) ? await drive.file(scope.id) : null
    if (!folder || folder.trashed || folder.mimeType !== FOLDER) {
      missing.push(scope.id)
      continue
    }
    owner.set(scope.id, scope.id)
    const queue = [scope.id]
    while (queue.length) {
      const at = queue.shift()!
      for (const child of await childrenOf(drive, at, true)) {
        if (chosen.has(child.id) || owner.has(child.id)) continue
        // Past the limit the walk stops, and the read is partial: nothing it did not reach is gone.
        if (owner.size >= limit) {
          capped = true
          break walk
        }
        owner.set(child.id, scope.id)
        queue.push(child.id)
      }
    }
  }
  return { owner, missing, capped }
}

/** The Google Docs directly in a folder. */
async function documentsIn(drive: Drive, folder: string) {
  return (await childrenOf(drive, folder)).filter((file) => file.mimeType === DOCUMENT)
}

/** Words for a failed sign-in or reach, as the check shows them. */
const reachFix: Record<string, string> = {
  unauthorized:
    'Google refused the key. Create a new key for the service account and give it here.',
  secret_missing: 'Give the service account key again: it is gone from the secret store.',
  unreachable: 'Check that this server can reach Google, then test again.',
  private_address: 'Use an https address on a public host.',
  rate_limited: 'Google asked to slow down. Test again in a minute.',
  not_found: 'Check the Google API address.',
  'google-drive.api_disabled':
    'Switch the Google Drive API on in the service account’s Google Cloud project.',
}

/** The runtime of Google Drive: the documents in the folders shared with a service account. */
export const runtime = defineRuntime<Config>({
  async check(context): Promise<CheckReport> {
    const key = parseServiceAccountKey(context.secret(SECRET) ?? '')
    if (!key)
      return {
        steps: [
          {
            id: 'key',
            title: 'Read the service account key',
            status: 'failed',
            detail: 'This is not the JSON key of a service account.',
            fix: 'Give the JSON key file Google Cloud made for the service account, as it is.',
          },
        ],
      }
    const drive = new Drive(context, key)
    try {
      await drive.signIn()
      const folders = await sharedFolders(drive)
      const documents = await drive.list(
        `mimeType='${DOCUMENT}' and trashed=false`,
        'documents',
        DOCUMENTS_COUNTED,
      )
      const share = `Share each folder with ${key.clientEmail}, as Viewer.`
      return {
        steps: [
          {
            id: 'sign-in',
            title: 'Sign in to Google',
            status: 'ok',
            detail: `Google accepted the service account ${key.clientEmail}.`,
          },
          {
            id: 'folders',
            title: 'Find the shared folders',
            status: folders.length ? 'ok' : 'warning',
            detail: `${folders.length} ${folders.length === 1 ? 'folder is' : 'folders are'} shared with it.`,
            ...(folders.length ? {} : { fix: share }),
          },
          {
            id: 'documents',
            title: 'Find Google Docs',
            status: documents.length ? 'ok' : 'warning',
            detail: `${documents.length >= DOCUMENTS_COUNTED ? `${DOCUMENTS_COUNTED.toLocaleString('en')} or more` : documents.length.toLocaleString('en')} Google ${documents.length === 1 ? 'Doc' : 'Docs'}, titles only.`,
            ...(documents.length ? {} : { fix: share }),
          },
        ],
      }
    } catch (error) {
      if (!(error instanceof SourceError) || !(error.code in reachFix)) throw error
      return {
        steps: [
          {
            id: 'sign-in',
            title: 'Sign in to Google',
            status: 'failed',
            detail: `Google could not be read (${error.code}).`,
            fix: reachFix[error.code]!,
          },
        ],
      }
    }
  },

  async discover(context): Promise<Scope[]> {
    const drive = new Drive(context, keyOf(context))
    const scopes: Scope[] = []
    for (const folder of await sharedFolders(drive)) {
      if (scopes.length >= SCOPES_MAX) break
      const name = [...folder.name.trim()].slice(0, 140).join('') || 'Untitled folder'
      scopes.push({ id: folder.id, title: name, suggestedDomain: suggestedDomain(name) })
      for (const child of await childrenOf(drive, folder.id, true)) {
        if (scopes.length >= SCOPES_MAX) break
        if (scopes.some((scope) => scope.id === child.id)) continue
        const inner = [...child.name.trim()].slice(0, 140).join('') || 'Untitled folder'
        scopes.push({
          id: child.id,
          title: `${name} / ${inner}`,
          suggestedDomain: suggestedDomain(inner),
        })
      }
    }
    return scopes
  },

  async *read(context): AsyncIterable<RuntimeMessage> {
    const drive = new Drive(context, keyOf(context))
    const sent = new Set<string>()
    let held = 0
    let complete = true

    /** A document as a message: its Markdown, or a warning when it cannot be read. */
    async function* send(file: DriveFile, scope: string): AsyncIterable<RuntimeMessage> {
      if (sent.has(file.id)) return
      sent.add(file.id)
      if (held > READ_TEXT_MAX) {
        if (complete)
          yield { type: 'warning', code: 'too_much_text', target: String(READ_TEXT_MAX) }
        complete = false
        return
      }
      const exported = await drive.export(file.id)
      // Seen but not read: its suggestion stays as it is.
      if ('unread' in exported) {
        yield { type: 'warning', code: exported.unread, target: file.id }
        return
      }
      const { text } = exported
      held += text.length
      yield {
        type: 'document',
        document: {
          id: file.id,
          scope,
          title: titleOf(file),
          link: documentLink(file.id),
          modifiedAt: file.modifiedTime ?? context.now().toISOString(),
          version: file.version ?? file.modifiedTime ?? 'unknown',
          text,
          mediaType: 'text/markdown',
        },
      }
    }

    const chosen = new Set(context.scopes.map((scope) => scope.id))
    const delta = context.cursor === null ? null : await drive.changes(context.cursor)
    // Changes from now on are read next time, so none made during this read is missed.
    const start = delta === null ? await drive.startToken() : null
    const { owner, missing, capped } = await folderScopes(drive, context.scopes)
    for (const scope of missing) yield { type: 'warning', code: 'folder_missing', target: scope }
    if (capped) yield { type: 'warning', code: 'too_many_records', target: String(FOLDERS_MAX) }
    // A chosen folder the account cannot see is not taken for empty: nothing in it is gone.
    if (missing.length || capped) complete = false

    if (delta === null) {
      // A full read: every document of every chosen folder and the folders under them. A cursor
      // Drive no longer knows reads everything too, from a new start.
      for (const [folder, scope] of owner)
        for (const file of await documentsIn(drive, folder)) yield* send(file, scope)
      yield { type: 'end', version: start!, complete, cursor: start! }
      return
    }

    // What changed since the cursor. A document in a chosen folder is sent again; one removed,
    // trashed or now outside every chosen folder is a tombstone. A folder that changed may have
    // moved in, so every document under a changed folder inside a chosen one is sent again. A
    // folder outside every chosen one is left alone: what is in it was never read. A document
    // edit is its own change, so a folder's siblings are not read again for it.
    const scopeOf = (file: DriveFile) =>
      file.parents.map((parent) => owner.get(parent)).find((scope) => scope !== undefined)
    for (const change of delta.changes) {
      const file = change.file
      if (change.removed || !file || file.trashed) {
        if (!sent.has(change.fileId)) yield { type: 'deleted', id: change.fileId }
        continue
      }
      if (file.mimeType === DOCUMENT) {
        const scope = scopeOf(file)
        if (scope !== undefined) yield* send(file, scope)
        else if (!sent.has(file.id) && !capped) yield { type: 'deleted', id: file.id }
        continue
      }
      if (file.mimeType !== FOLDER) continue
      const scope = owner.get(file.id)
      if (scope === undefined || chosen.has(file.id)) continue
      const queue = [file.id]
      const walked = new Set(queue)
      while (queue.length) {
        const at = queue.shift()!
        for (const child of await childrenOf(drive, at)) {
          if (child.mimeType === FOLDER) {
            if (owner.has(child.id) && !walked.has(child.id)) {
              walked.add(child.id)
              queue.push(child.id)
            }
          } else if (child.mimeType === DOCUMENT) {
            yield* send(child, owner.get(at) ?? scope)
          }
        }
      }
    }
    yield { type: 'end', version: delta.next, complete, cursor: delta.next }
  },
})
