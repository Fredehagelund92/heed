import { useNavigate } from '@tanstack/react-router'
import type { ProposalRecord } from '@/api'
import { HeaderActions } from '@/components/app-shell/header-actions'
import { ChevronDownIcon, EllipsisIcon } from '@/components/icons'
import { Page, PageDocument, PagePhoneActions } from '@/components/page/page'
import { PageRail } from '@/components/page/page-rail'
import { ProposalStepper } from '@/components/proposal/proposal-stepper'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMediaQuery } from '@/hooks/use-media-query'
import { proposalTabs, type ProposalSearch, type ProposalTab } from '@/lib/search-params'
import {
  ProposalPreview,
  StatusActivity,
  StatusBadges,
  StatusAttachedTests,
  StatusChecks,
  StatusDetails,
  StatusDialogs,
  StatusEditButton,
  StatusFields,
  StatusIssueNote,
  StatusOverlaps,
  StatusPeople,
  StatusWord,
  useProposalStatus,
} from './status-parts'

/*
  A proposal in status mode (frame B of the front end plan, slice W4): where it stands for the
  person who wrote it. The paper holds the badges, the title, who is involved, the four steps,
  the reviewer's word when there is one, and the tabs: Activity (the timeline and the reply),
  Fields (what it says) and What an agent would answer. The rail holds the checks, the overlaps
  and the details; below 1,152 pixels it stacks under the paper. The page's one filled
  button follows the state: Continue editing a draft, Edit and resubmit when changes were asked.
  The parts are the status panel's too (status-parts.tsx).
*/

const tabNames: Record<ProposalTab, string> = {
  activity: 'Activity',
  fields: 'Fields',
  preview: 'What AI apps will get',
}

export function ProposalPage({
  proposal,
  search,
}: {
  proposal: ProposalRecord
  search: ProposalSearch
}) {
  const navigate = useNavigate()
  const status = useProposalStatus(proposal)
  const phone = useMediaQuery('(max-width: 47.99rem)')
  const { title, primary, secondary } = status
  const tab: ProposalTab = search.tab ?? 'activity'

  const showTab = (value: ProposalTab) =>
    void navigate({
      to: '/proposals/$proposalId',
      params: { proposalId: proposal.id },
      search: { ...search, tab: value === 'activity' ? undefined : value },
      replace: true,
      state: true,
    })

  return (
    <Page title={title} heading="paper" data-template="document">
      <HeaderActions>
        {secondary ? (
          <Button variant="outline" onClick={secondary.open}>
            <secondary.icon />
            {secondary.label}
          </Button>
        ) : null}
        {primary ? <StatusEditButton status={status} label={primary} /> : null}
      </HeaderActions>

      <PageDocument className="grow pt-6">
        <article
          data-slot="paper"
          aria-label="Proposal"
          className="flex w-full max-w-reading min-w-0 flex-col gap-6"
        >
          <header className="flex flex-col gap-3">
            <StatusBadges status={status} />
            <h1 className="text-display font-bold tracking-display break-words">{title}</h1>
            <StatusPeople status={status} />
          </header>

          <ProposalStepper steps={status.steps} />

          <StatusWord status={status} />
          <StatusIssueNote status={status} />

          <Tabs value={tab} onValueChange={(value: ProposalTab) => showTab(value)}>
            <TabsList
              variant="line"
              aria-label="Proposal sections"
              className="w-full justify-start border-b @max-xl:hidden"
            >
              {proposalTabs.map((value) => (
                <TabsTrigger key={value} value={value}>
                  {tabNames[value]}
                </TabsTrigger>
              ))}
            </TabsList>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="touch"
                    aria-label={`Section: ${tabNames[tab]}`}
                    className="w-full justify-between @xl:hidden"
                  />
                }
              >
                {tabNames[tab]}
                <ChevronDownIcon className="text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup
                  value={tab}
                  onValueChange={(value: ProposalTab) => showTab(value)}
                >
                  {proposalTabs.map((value) => (
                    <DropdownMenuRadioItem key={value} value={value} closeOnClick>
                      {tabNames[value]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <TabsContent value="activity" className="pt-6">
              <StatusActivity status={status} />
            </TabsContent>
            <TabsContent value="fields" className="pt-6">
              <StatusFields status={status} />
            </TabsContent>
            <TabsContent value="preview" className="pt-6">
              <ProposalPreview proposal={proposal} />
            </TabsContent>
          </Tabs>
        </article>

        <PageRail aria-label="Checks, overlaps and details" className="max-w-reading">
          <StatusChecks status={status} variant={phone ? 'folded' : 'card'} />
          <StatusAttachedTests status={status} />
          <StatusOverlaps status={status} />
          <StatusDetails status={status} />
        </PageRail>
      </PageDocument>

      {primary || secondary ? (
        <PagePhoneActions>
          {primary ? (
            <>
              <StatusEditButton status={status} label={primary} size="touch" className="flex-1" />
              {secondary ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="icon-touch"
                        aria-label="More proposal actions"
                      />
                    }
                  >
                    <EllipsisIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={secondary.open}>
                      <secondary.icon />
                      {secondary.label}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </>
          ) : secondary ? (
            <Button variant="outline" size="touch" className="flex-1" onClick={secondary.open}>
              <secondary.icon />
              {secondary.label}
            </Button>
          ) : null}
        </PagePhoneActions>
      ) : null}

      <StatusDialogs status={status} />
    </Page>
  )
}
