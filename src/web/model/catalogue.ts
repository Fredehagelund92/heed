import type { ConnectorManifest } from '@domain/connector-manifest'
import { builtInManifests } from '../../connectors/manifests'
import { logos, type Connector, type ConnectorKind } from './integrations'

// The catalogue of connectors, drawn from the manifests built into the repository, so a connector
// added there shows in Integrations with no change to the app. Only the pages that list or connect
// connectors (Integrations, Definitions) and the mock load this module: it carries every manifest,
// so the first load must not.

/**
 * How the app words a connector it knows well: the lead of its page, where its definitions say
 * their domain, and an example of its data endpoint. All of it is optional: a connector without
 * an entry is drawn from its manifest alone.
 */
const words: Record<string, Pick<Connector, 'lead' | 'domainField' | 'endpointExample'>> = {
  cube: {
    lead: "Reads your Cube definition files from Git. Read-only, and it keeps no calculation. It has two connections: definitions from Git, and figures, when switched on, from Cube's data API at the time of the answer.",
    domainField: 'meta.domain',
    endpointExample: 'https://cube.example.com/cubejs-api/v1/load',
  },
  'google-drive': {
    lead: 'Reads the Google Docs in folders shared with its service account. Each new or changed document becomes one suggestion for the owners of its domain.',
  },
  'git-markdown': {
    lead: "Reads the Markdown files in a repository. Each new or changed file becomes one suggestion for the owners of its folder's domain.",
  },
}

/** A connector of the catalogue, from its manifest. */
export function connectorOf(manifest: ConnectorManifest): Connector {
  const key = manifest.secrets.find((secret) => secret.file)
  const logo = logos[manifest.id]
  return {
    id: manifest.id,
    name: manifest.tool,
    kind: manifest.kind === 'definitions' ? 'definitions' : 'context',
    ...(logo ? { logo } : {}),
    ...(manifest.icon ? { icon: manifest.icon } : {}),
    blurb: manifest.summary,
    ...(manifest.capabilities.figures ? { figures: true as const } : {}),
    ...(key ? { keyFile: key.key } : {}),
    ...(manifest.egress.git ? { git: true as const } : {}),
    ...(manifest.capabilities.discover ? { discovers: true as const } : {}),
    access: [...manifest.access],
    ...words[manifest.id],
  }
}

/**
 * Shown as Soon, and not connectable: tools the design draws in the catalogue, which have no
 * manifest yet. A design list only: when one gets a manifest, it leaves this list.
 */
const soon: Connector[] = [
  {
    id: 'dbt',
    name: 'dbt',
    kind: 'definitions',
    logo: logos.dbt!,
    blurb: 'Metrics from dbt MetricFlow, read from your project in Git.',
    soon: true,
    access: [],
  },
  {
    id: 'notion',
    name: 'Notion',
    kind: 'context',
    logo: logos.notion!,
    blurb: 'Pages in spaces you choose become suggestions for owners.',
    soon: true,
    access: [],
  },
]

const kindOrder: Record<ConnectorKind, number> = { definitions: 0, context: 1 }

/** The catalogue: definitions first, then context, each by name, as the design lays it out. */
export const connectors: Connector[] = [...builtInManifests.map(connectorOf), ...soon].sort(
  (a, b) =>
    kindOrder[a.kind] - kindOrder[b.kind] ||
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
)

export const connectorById = (id: string | undefined) => connectors.find((c) => c.id === id)

/** The connector of a tool, by the name people say it by ("Google Drive"); none for another. */
export const connectorByTool = (tool: string | undefined) => connectors.find((c) => c.name === tool)

/**
 * Where setup sends someone to connect their definitions: the connect flow of the first
 * definitions tool of the catalogue that can be connected, or Integrations when there is none.
 */
export const definitionsConnectHref = () => {
  const connector = connectors.find((c) => c.kind === 'definitions' && !c.soon)
  return connector ? `/settings/integrations/${connector.id}/connect` : '/settings/integrations'
}
