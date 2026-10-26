import cube from '@/assets/logos/cube.svg'
import dbt from '@/assets/logos/dbt.svg'
import googledrive from '@/assets/logos/googledrive.svg'
import markdown from '@/assets/logos/markdown.svg'
import notion from '@/assets/logos/notion.svg'
import warehouse from '@/assets/logos/warehouse.svg'

import type { DomainId } from './items'

// The tools Heed reads, from the settings and integrations design (round 3, all picks adopted).
// Definitions (what exists: metrics and dimensions), context (what people know: documents) and,
// opt-in, figures for Ask. Heed stores no numbers: it reads one when an answer asks for it, and only
// from an integration an admin has switched figures on for. A sync never publishes: definitions are
// a read-only copy that flags the context relying on them, documents become suggestions in the
// owners' Inbox, one per document.

export type ConnectorKind = 'definitions' | 'context' | 'data'
export type ConnectorId = 'cube' | 'google-drive' | 'markdown-git' | 'dbt' | 'notion' | 'warehouse'

export type Connector = {
  id: ConnectorId
  name: string
  kind: ConnectorKind
  logo: string
  /** One line on the catalog cell. */
  blurb: string
  /** Built in v1, or shown as Soon. */
  soon?: boolean
  /** It can answer a figure for Ask (opt-in, off until an admin switches it on). */
  figures?: true
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
  {
    id: 'warehouse',
    name: 'Larchwood warehouse',
    kind: 'data',
    logo: warehouse,
    blurb: "Figures for Ask from your warehouse's query API, read only when an answer needs one.",
    figures: true,
  },
]

export const kindName: Record<ConnectorKind, string> = {
  definitions: 'Definitions',
  context: 'Context',
  data: 'Figures',
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
 * reviewer can open any of them: nothing connected, syncing, failed, needs a new key, and a sync
 * that created suggestions.
 */
export type IntegrationState =
  'normal' | 'nothing' | 'syncing' | 'failed' | 'reauth' | 'suggestions'

/** What Cube reads: each view, what it holds and the domain it maps to. */
export type CubeView = { view: string; metrics: number; dimensions: number; domain?: DomainId }
/** A Drive folder Heed reads, and the domain its documents go to. */
export type DriveFolder = { folder: string; path: string; domain: DomainId; documents: number }
export type DocState = 'waiting' | 'published' | 'returned' | 'skipped'
/** A document a sync read: the suggestion it became, and where that stands. */
export type DriveDocument = {
  title: string
  folder: string
  domain: DomainId
  state: DocState
  note?: string
  read: string
  card?: string
}
/** How a figure-capable integration is reached. The secret is never shown in full. */
export type FigureConnection = {
  endpoint: string
  host: string
  secretTail: string
  contact: string
  asOf: string
}
