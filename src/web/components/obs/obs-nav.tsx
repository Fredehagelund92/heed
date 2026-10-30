import { ArrowLeftIcon } from '@/components/icons'
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { savedCounts } from '@/model/saved-questions'
import { useSavedQuestions } from '@/api/queries'
import { BACK_TO_APP } from '@/lib/brand'
import { OBS_SECTIONS } from '@/lib/obs'
import { useMe } from '@/lib/workspace'

// Inside Observability the app sidebar gives way to its own menu, as it does in Settings: the way
// back to the app on top, then seven pages in four small groups. Usage is for admins.

export function ObservabilityNav({ section, close }: { section: string; close: () => void }) {
  const me = useMe()
  const saved = useSavedQuestions()
  // The badge counts what needs a look in the domains this person sees.
  const look = me.admin
    ? savedCounts(saved).look
    : saved.filter((q) => me.owns.includes(q.domain) && q.result === 'look').length
  const groups = OBS_SECTIONS.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.id !== 'usage' || me.admin),
  }))
  return (
    <>
      <SidebarHeader className="h-bar justify-center border-b px-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={BACK_TO_APP} render={<a href="/inbox" onClick={close} />}>
              <ArrowLeftIcon />
              <span>{BACK_TO_APP}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.group}>
            <SidebarGroupLabel>{g.group}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      tooltip={item.title}
                      isActive={section === item.id}
                      render={<a href={`/observability/${item.id}`} onClick={close} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                    {item.id === 'quality' && look > 0 && (
                      <SidebarMenuBadge>
                        {look}
                        <span className="sr-only"> need a look</span>
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </>
  )
}
