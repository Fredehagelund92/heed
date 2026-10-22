import { useNavigate } from '@tanstack/react-router'
import { HelpLink } from '@/components/help/help-link'
import { PageContent } from '@/components/page/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { AdminSearch } from '@/lib/search-params'
import { gatewayTabs, type GatewayTab } from '@/lib/settings-sections'
import { ActivityTab } from './activity-tab'
import { ClientsTab } from './clients-tab'
import { ConnectionsTab } from './connections-tab'
import { ToolsTab } from './tools-tab'

const tabTitles: Record<GatewayTab, string> = {
  clients: 'Agents',
  connections: 'Connections',
  tools: 'Tools',
  activity: 'Activity',
}

/**
 * MCP and gateway (FR-407, FR-408; plan slice W11a), a section of Administration: which AI
 * clients may connect and with what limits, the agents people connected (FR-403), which tools
 * agents may call, and the traffic by client and tool. The tab is in the address (`tab=`); Clients is the default. Only an
 * administrator opens it; Administration tells anyone else whose section it is.
 */
export function GatewaySection({ search }: { search: AdminSearch }) {
  const navigate = useNavigate()
  const tab = search.tab ?? 'clients'
  return (
    <Tabs
      value={tab}
      onValueChange={(next: GatewayTab) =>
        void navigate({
          to: '/admin',
          search: { section: 'gateway', ...(next === 'clients' ? {} : { tab: next }) },
        })
      }
      render={<PageContent width="overview" className="gap-6" data-slot="settings-gateway" />}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList aria-label="MCP and gateway">
          {gatewayTabs.map((value) => (
            <TabsTrigger key={value} value={value}>
              {tabTitles[value]}
            </TabsTrigger>
          ))}
        </TabsList>
        <span className="text-caption">
          <HelpLink to="mcp">What is an MCP?</HelpLink>
        </span>
      </div>
      <TabsContent value="clients" className="flex flex-col gap-6">
        <ClientsTab />
      </TabsContent>
      <TabsContent value="connections" className="flex flex-col gap-6">
        <ConnectionsTab search={search} />
      </TabsContent>
      <TabsContent value="tools" className="flex flex-col gap-6">
        <ToolsTab />
      </TabsContent>
      <TabsContent value="activity" className="flex flex-col gap-6">
        <ActivityTab days={search.days} />
      </TabsContent>
    </Tabs>
  )
}
