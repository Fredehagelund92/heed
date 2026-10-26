import type { ConnectionScope, ConnectRequest, PersonConnection } from '@/api'
import { productName } from '@/lib/brand'
import type { ConnectionSort, SortDirection } from '@/lib/connection-sorts'

/**
 * Plain words for what an agent may do as the person (FR-414), for the consent screen and the
 * list of connected agents. Each says what the agent can do, never how the token works.
 */
export const scopeWords: Record<ConnectionScope, { title: string; detail: string; short: string }> =
  {
    read: {
      title: 'Read facts',
      detail: 'Read the facts you can see, to answer your questions about the numbers.',
      short: 'Read',
    },
    feedback: {
      title: 'Report gaps and give feedback',
      detail: `Tell ${productName} when a fact is missing or an answer didn't help. Your name isn't sent.`,
      short: 'Feedback',
    },
    propose: {
      title: 'Suggest changes',
      detail:
        'Send suggestions in your name, after you say yes. The owner of the domain checks each one before agents get it.',
      short: 'Suggest changes',
    },
  }

/** "Read and feedback": what an agent may do, in one short phrase. */
export function scopeSummary(scopes: readonly ConnectionScope[]): string {
  const words = scopes.map((scope, index) =>
    index === 0 ? scopeWords[scope].short : scopeWords[scope].short.toLowerCase(),
  )
  return words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/**
 * How the person can tell which agent asks: where it publishes its description, or that it
 * registered itself here, and where Heed sends them back to.
 */
export function clientOrigin(
  request: Pick<ConnectRequest, 'clientKind' | 'clientHost' | 'redirectHost'>,
): string {
  const known =
    request.clientKind === 'document'
      ? `The agent describes itself at ${request.clientHost}.`
      : `The agent registered itself with ${productName}.`
  return `${known} ${productName} sends you back to ${request.redirectHost} when you answer.`
}

// ---- every person's agents, for an administrator (FR-403, FR-807) ----

/** Names sort from A, and moments from the newest. */
export const connectionSortDefaults: Record<ConnectionSort, SortDirection> = {
  person: 'asc',
  app: 'asc',
  connected: 'desc',
  used: 'desc',
}

export const connectionSortWords: Record<ConnectionSort, string> = {
  person: 'Person',
  app: 'Agent',
  connected: 'Connected',
  used: 'Last used',
}

const sortKey: Record<ConnectionSort, (connection: PersonConnection) => string> = {
  person: (connection) => connection.person.name,
  app: (connection) => connection.clientName,
  connected: (connection) => connection.connectedAt,
  used: (connection) => connection.lastUsedAt,
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

/**
 * The connections in an order: by the sort's own key, then by the person, the agent and the id, so
 * the same list always reads the same way.
 */
export function sortConnections(
  connections: readonly PersonConnection[],
  sort: ConnectionSort,
  direction: SortDirection,
): PersonConnection[] {
  const sign = direction === 'asc' ? 1 : -1
  return [...connections].sort(
    (a, b) =>
      sign * collator.compare(sortKey[sort](a), sortKey[sort](b)) ||
      collator.compare(a.person.name, b.person.name) ||
      collator.compare(a.clientName, b.clientName) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/**
 * The connections a search finds: every word in the person's name or email address, or in the
 * agent's name or where it came from, in any case.
 */
export function searchConnections(
  connections: readonly PersonConnection[],
  query: string,
): PersonConnection[] {
  const words = query.toLocaleLowerCase('en').split(/\s+/).filter(Boolean)
  if (!words.length) return [...connections]
  return connections.filter((connection) => {
    const text = [
      connection.person.name,
      connection.person.email ?? '',
      connection.clientName,
      connection.clientHost,
    ]
      .join(' ')
      .toLocaleLowerCase('en')
    return words.every((word) => text.includes(word))
  })
}

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`

/** "9 agents for 8 people", or "2 of 9 agents" while a search narrows the list. */
export function connectionCountWords(
  shown: readonly PersonConnection[],
  all: readonly PersonConnection[],
): string {
  if (shown.length < all.length)
    return `${shown.length.toLocaleString('en')} of ${count(all.length, 'agent', 'agents')}`
  const people = new Set(all.map((connection) => connection.person.id)).size
  return `${count(all.length, 'agent', 'agents')} for ${count(people, 'person', 'people')}`
}

/** "Claude Code and Claude Desktop": the agents of one person, as a list in a sentence. */
export function appListWords(connections: readonly Pick<PersonConnection, 'clientName'>[]) {
  const names = connections.map((connection) => connection.clientName)
  return names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const shortDay = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

/** "Ends 14 Oct": a connection lasts days, never into another year unseen (the tooltip says it). */
export function endsWords(iso: string): string {
  return `Ends ${shortDay.format(new Date(iso))}`
}

/** The reasons an administrator most often gives, offered as chips; the words stay theirs. */
export const disconnectReasons = [
  'Lost or stolen device',
  'Left the company',
  'Agent not approved for work',
  'Asked by the person',
] as const
