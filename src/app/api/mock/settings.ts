import type { Settings } from '../client'
import { AGENT_TOOLS } from '@/lib/agents'
import { MCP_URL } from '@/lib/brand'
import { LIVE_PHASES, MOCK_SIGN_IN_MS, type Connected, type LivePhase } from '@/lib/connect'
import { connectorById, type ConnectorId } from '@/model/integrations'
import { seedAgents } from './data/agents'
import { figureConnections } from './data/integrations'
import type { Address } from './scenario'

// The mock's switches and connections, kept until the page reloads: the links switch and the other
// tools agents call, Pause sharing, figures in Ask per integration and their data contacts, the
// tools connected, and the agents signed in. The review flags ?links=on|off and
// ?figures=on|off|<integration> set the switches from the address, and ?connect= shows the live
// line in any state.

export const FIGURE_SOURCES: ConnectorId[] = ['cube', 'warehouse']

export function createSettings() {
  let links = true
  /** The tools an admin switched off; every other is on. */
  let off: string[] = []
  let pause: Settings['pause'] = { all: false, domain: null }
  let figures: Partial<Record<ConnectorId, boolean>> = { cube: false, warehouse: false }
  let contacts: Partial<Record<ConnectorId, string>> = Object.fromEntries(
    Object.entries(figureConnections).map(([k, v]) => [k, v.contact]),
  )
  let connected: ConnectorId[] = ['cube', 'google-drive', 'warehouse']
  let agents: Connected[] = [...seedAgents]

  /** A sign-in adds the agent on top, marked new; the same agent for the same person replaces its row. */
  const addAgent = (agent: string, who: string) => {
    const row: Connected = { agent, who, since: '23 Oct 2026', used: 'Just now', fresh: true }
    agents = [
      row,
      ...agents
        .filter((r) => !(r.agent === agent && r.who === who))
        .map((r) => (r.fresh ? { ...r, fresh: false } : r)),
    ]
  }

  return {
    /** The switches as the address shows them: a review flag first. */
    read(address: Address): Settings {
      const flag = address.query.figures
      const only = flag?.replace(/^source[:=]/, '')
      const shown = Object.fromEntries(
        FIGURE_SOURCES.map((id) => [
          id,
          flag === 'on'
            ? true
            : flag === 'off'
              ? false
              : only && connectorById(only)
                ? id === only
                : (figures[id] ?? false),
        ]),
      )
      const l = address.query.links
      return {
        mcpAddress: MCP_URL,
        links: l === 'on' ? true : l === 'off' ? false : links,
        tools: Object.fromEntries(
          AGENT_TOOLS.filter((t) => t.name !== 'get_related').map((t) => [
            t.name,
            !off.includes(t.name),
          ]),
        ),
        pause,
        figures: shown,
        contacts,
        connected,
      }
    },
    setLinks(on: boolean) {
      links = on
    },
    setTool(name: string, on: boolean) {
      off = on ? off.filter((t) => t !== name) : [...new Set([...off, name])]
    },
    setPause(change: { all: boolean } | { domain: string | null }) {
      pause = { ...pause, ...change }
    },
    setFigures(id: ConnectorId, on: boolean) {
      figures = { ...figures, [id]: on }
    },
    setContact(id: ConnectorId, name: string) {
      contacts = { ...contacts, [id]: name }
    },
    connect(id: ConnectorId) {
      if (!connected.includes(id)) connected = [...connected, id]
    },
    disconnect(id: ConnectorId) {
      connected = connected.filter((c) => c !== id)
    },
    agents: () => agents,
    revoke(agent: string, who: string) {
      agents = agents.filter((r) => !(r.agent === agent && r.who === who))
    },
    /** In the demo an agent signs in 8 seconds after a copy; ?connect=declined says it was declined. */
    check(address: Address, since: number, agent: string, me: string) {
      if (address.query.connect === 'declined') return { state: 'declined' as const }
      if (Date.now() - since < MOCK_SIGN_IN_MS) return { state: 'waiting' as const }
      if (agents[0]?.agent !== agent || agents[0]?.who !== me || !agents[0]?.fresh)
        addAgent(agent, me)
      return { state: 'connected' as const, agent }
    },
    /** The live line's state a review address shows; ?connect=connected has the agent signed in. */
    review(address: Address, me: string): LivePhase | null {
      const flag = LIVE_PHASES.find((p) => p === address.query.connect) ?? null
      if (flag === 'connected' && !(agents[0]?.agent === 'Claude Code' && agents[0]?.who === me))
        addAgent('Claude Code', me)
      return flag
    },
  }
}
