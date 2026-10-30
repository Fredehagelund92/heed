import cube from '@/assets/logos/cube.svg'
import dbt from '@/assets/logos/dbt.svg'
import googledrive from '@/assets/logos/googledrive.svg'
import markdown from '@/assets/logos/markdown.svg'
import notion from '@/assets/logos/notion.svg'

import type { DomainId } from './items'

// The tools Heed reads, from the settings and integrations design (round 3, all picks adopted).
// Definitions (what exists: metrics and dimensions) and context (what people know: documents).
// Figures for Ask are not a kind of their own: a definitions tool that can read them (Cube) has a
// second connection for them, off until an admin switches it on, because the tool a metric's
// definition comes from is the one that answers it. Heed stores no numbers: it reads one when an
// answer asks for it. A sync never publishes: definitions are a read-only copy that flags the
// context relying on them, documents become suggestions in the owners' Inbox, one per document.

export type ConnectorKind = 'definitions' | 'context'
export type ConnectorId = 'cube' | 'google-drive' | 'markdown-git' | 'dbt' | 'notion'

export type Connector = {
  id: ConnectorId
  name: string
  kind: ConnectorKind
  logo: string
  /** One line on the catalog cell. */
  blurb: string
  /** Built in v1, or shown as Soon. */
  soon?: boolean
  /**
   * It can also read a figure for Ask, through a second connection of its own: a data endpoint and
   * a token (opt-in, off until an admin switches it on).
   */
  figures?: true
  /** The secret the connect flow takes as a key file someone uploads, not as words typed in. */
  keyFile?: string
}

export const connectors: Connector[] = [
  {
    id: 'cube',
    name: 'Cube',
    kind: 'definitions',
    logo: cube,
    blurb: 'Metrics and dimensions, read from your Cube definition files in Git.',
    figures: true,
  },
  {
    id: 'dbt',
    name: 'dbt',
    kind: 'definitions',
    logo: dbt,
    blurb: 'Metrics from dbt MetricFlow, read from your project in Git.',
    soon: true,
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    kind: 'context',
    logo: googledrive,
    blurb: 'Google Docs in folders you share become suggestions for owners.',
    keyFile: 'serviceAccountKey',
  },
  {
    id: 'markdown-git',
    name: 'Markdown in Git',
    kind: 'context',
    logo: markdown,
    blurb: 'Markdown files in a repository become suggestions for owners.',
  },
  {
    id: 'notion',
    name: 'Notion',
    kind: 'context',
    logo: notion,
    blurb: 'Pages in spaces you choose become suggestions for owners.',
    soon: true,
  },
]

export const kindName: Record<ConnectorKind, string> = {
  definitions: 'Definitions',
  context: 'Context',
}
export const connectorById = (id: string | undefined) => connectors.find((c) => c.id === id)

/** The connected definitions tool, by name: generic copy says it through this, never by hand. */
export const DEFINITIONS_TOOL = connectorById('cube')!.name

export type Activity = {
  when: string
  tone: 'ok' | 'changed' | 'failed'
  what: string
  detail: string
}

/**
 * The five states an admin meets, each reachable by a flag in the address (?state=...), so a
 * reviewer can open any of them on the mock: nothing connected, syncing, failed, needs a new key,
 * and a sync that created suggestions. On the service each comes from what the reads did.
 */
export type IntegrationState =
  'normal' | 'nothing' | 'syncing' | 'failed' | 'reauth' | 'suggestions'

/**
 * How a connected tool is: read as it should be; asked to read now and waiting for its read; its
 * last read failed; its key was refused; or paused by an admin.
 */
export type Health = 'healthy' | 'reading' | 'failed' | 'reauth' | 'paused'

/** A moment as the integrations' pages say it: a day ("Today", "Tomorrow", "21 Oct") and a time. */
export type When = {
  day: string
  time: string
  /** How long ago, where a page says it ("24 hours ago"). */
  ago?: string
}

/** What Cube reads: each view, what it holds and the domain it maps to. */
export type CubeView = { view: string; metrics: number; dimensions: number; domain?: DomainId }
/** A folder a content tool reads, and the domain its documents go to. */
export type DriveFolder = { folder: string; path: string; domain: DomainId; documents: number }
/**
 * What became of a document a read looked at: its suggestion waits for owners, was published,
 * returned, declined or withdrawn; it waits for the next read (past the day's suggestions); it was
 * skipped; or it is gone from the tool.
 */
export type DocState =
  'waiting' | 'published' | 'returned' | 'declined' | 'withdrawn' | 'held' | 'skipped' | 'gone'
/** A document a sync read: the suggestion it became, and where that stands. */
export type DriveDocument = {
  title: string
  folder: string
  domain?: DomainId
  state: DocState
  note?: string
  read: string
  /** The address of its suggestion in the Inbox, while it waits there. */
  href?: string
}

/** A connected tool, as its row on Integrations and the head of its page show it. */
export type Source = {
  /** Its page's address: /settings/integrations/<id>. */
  id: string
  /** The tool it reads, as the catalog has it (its name, logo and kind). */
  connector: ConnectorId
  health: Health
  /** How often it is read: "every hour", "every day". */
  every: string
  /** How long it may go unread before what it read is out of date: "6 hours". */
  staleAfter: string
  /** Its last read; null before the first. Complete, how long it took, what it looked at. */
  last: { at: When; complete: boolean; seconds: number | null; seen: number } | null
  /** Its last read that did not fail, when the last one did. */
  lastGood: When | null
  /** When it is read next; null before its first read is planned, and while paused. */
  next: When | null
  /** How far a read that runs now has got, where the tool says. */
  progress?: { done: number; total: number }
  /** Reads in a row that failed, and why the last one did, in words. */
  failures: number
  failure: string | null
  /** A definitions tool's copy: its metrics, dimensions and views, and the context flagged by it. */
  definitions: {
    metrics: number
    dimensions: number
    views: number
    noDomain: number
    flagged: number
  } | null
  /**
   * A context tool's documents, its suggestions waiting and for how many domains, and its
   * suggestions over the last day against its daily cap.
   */
  documents: {
    held: number
    waiting: number
    domains: number
    madeToday: number
    perDay: number
  } | null
  /** What its last read did, when it created suggestions: new, replacing, and skipped and why. */
  created: { suggested: number; replaced: number; skipped: string[] } | null
  /** The Inbox, at the first of its suggestions waiting; null when none waits. */
  inbox: string | null
  /** Who connected it and when ("1 Oct"); null for a tool whoever runs the server connected. */
  added: { by: string | null; when: string } | null
}

/** Settings › Integrations: the tools connected, and which of the others can be connected here. */
export type IntegrationsView = { sources: Source[]; connectable: ConnectorId[] }

/** One connected tool's page. */
export type SourcePage = {
  source: Source
  /** A definitions tool: each view, with its domain. */
  views: CubeView[]
  /** The last day a definitions read changed definitions ("7 Oct"); null when none did. */
  changedOn: string | null
  /** A context tool: each folder chosen, with its domain. */
  folders: DriveFolder[]
  /** A context tool's documents read most recently, newest first. */
  documents: DriveDocument[]
  /** Every read, newest first. */
  activity: Activity[]
  /** How it is connected, setting by setting: never a secret, only whether one is set. */
  connection: { label: string; value: string; code?: boolean }[]
}

/**
 * How a figure-capable integration is reached: its data endpoint, the one host it calls, and
 * whether its secret is set. The secret itself, or any part of it, is never shown.
 */
export type FigureConnection = {
  endpoint: string | null
  host: string | null
  secretSet: boolean
  contact: string
  /** When the integration last refreshed its data, when known. */
  asOf?: string
}

/* ---------- the connect flow (Pick, Connect, Choose, Map, Schedule) and Change settings ---------- */

/**
 * A setting of the connect form, as its connector's manifest declares it: an address, a branch,
 * a folder, a name. Its value is what is set, or the manifest's default.
 */
export type ConnectField = {
  key: string
  kind: 'text' | 'address' | 'path' | 'ref'
  label: string
  description: string
  placeholder?: string
  required: boolean
  /** Folded under More settings: what most people leave as it is. */
  advanced: boolean
  value: string
}

/**
 * A secret of the connect form: a token, a key. It is written once and never read back: the form
 * only knows whether the store holds one, so that leaving it empty keeps it.
 */
export type ConnectSecret = {
  key: string
  label: string
  description: string
  required: boolean
  set: boolean
  /** A key file the form already holds: its name, and the account it reads as, when known. */
  file?: { name: string; account: string | null }
}

/** A tool's connect form: to connect it, or, for one connected, its settings to change. */
export type ConnectForm = {
  connector: ConnectorId
  /** Change settings: the source and the revision read; null to connect the tool anew. */
  source: { id: string; revision: number } | null
  fields: ConnectField[]
  secrets: ConnectSecret[]
  /** How often it is read ("every hour") and how long it may go unread ("6 hours"). */
  every: string
  staleAfter: string
  /** A content tool's suggestions a day, at most; null for definitions. */
  perDay: number | null
  /** What it reads now, with each one's domain: Change settings starts from these. */
  chosen: ConnectChoice[]
}

/** What the form says for each setting and secret: settings by key, secrets as written. */
export type ConnectValues = { config: Record<string, string>; secrets: Record<string, string> }

/**
 * What a tool may read, as its test found it: a view of a definitions tool, with what it holds, or
 * a folder of a content tool; each with the domain it most likely belongs to.
 */
export type ConnectScope = {
  id: string
  title: string
  /** What it holds, in words: "4 metrics, 3 dimensions", "14 documents"; empty when unknown. */
  detail: string
  metrics?: number
  dimensions?: number
  documents?: number
  domain?: DomainId
  /** Left out at first, and why: "its file names people, and those are skipped". */
  leftOut?: string
}

/** One step of a tool's check, in its connector's words. */
export type ConnectStep = {
  title: string
  status: 'ok' | 'warning' | 'failed' | 'skipped'
  detail?: string
  fix?: string
}

/** What Test connection found: its steps, and what may be chosen when it could read. */
export type ConnectTest = {
  ok: boolean
  steps: ConnectStep[]
  scopes: ConnectScope[]
  /** Why it could not read, in words, when no step says. */
  failure?: string
}

/** A view or folder chosen to read, and the domain it maps to (none: a view left shared). */
export type ConnectChoice = { id: string; title: string; domain: DomainId | null }

/** A tool connected: its page's id, and the time of its first read ("07:00"), or null for now. */
export type ConnectedSource = { id: string; firstRead: string | null }
