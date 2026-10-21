import type { Meta, StoryObj } from '@storybook/react-vite'
import { QueryClientProvider } from '@tanstack/react-query'
import { expect, screen, userEvent, within } from 'storybook/test'
import type { TryIt } from '@/api'
import { createQueryClient } from '@/api/query-client'
import { ReportGapDialog } from '@/components/gaps/report-gap-dialog'
import { CopyBlock } from '@/components/try-it/copy-block'
import { TryItReply } from '@/components/try-it/try-it-reply'
import { readTryIt, type TryItScope } from '@/lib/try-it'
import { QueryFrame, RouterFrame } from './router-frame'
import { StoryApp } from './story-app'

/*
  What an agent would get (Try it; Assistant board) on the mock: the page and the panel, a scope
  that delivers facts, one that matches nothing, one without dates, a slow and a failed answer,
  and the reply's parts with every note (a conflict, an unverified fact, held back and cut) from
  an invented reply. Connect an agent is a section of Settings (settings.stories.tsx). Use the
  viewport menu for 1440, 1024 and 390 and the theme menu for dark.
*/

const meta = {
  title: 'Assistant/Try it',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const unitedKingdom = 'about=metric:average_order_value,val:market/united_kingdom'
const delivered = `/try-it?${unitedKingdom}&from=2026-09-08&to=2026-10-07`

const facts = () =>
  screen.findByRole('list', { name: 'What the agent gets, in order' }, { timeout: 5000 })

/** Before anything is asked: what it shows, with the last 30 days ready. */
export const Empty: Story = {
  render: () => <StoryApp path="/try-it" />,
  play: async () => {
    await expect(await screen.findByText('See what an agent gets')).toBeVisible()
  },
}

/** Average order value in the United Kingdom: the facts an agent gets, ranked, and what it is told. */
export const Delivered: Story = {
  render: () => <StoryApp path={delivered} />,
  play: async () => {
    await expect(within(await facts()).getAllByRole('listitem').length).toBeGreaterThan(0)
    await expect(screen.getByText('Applies to Product: Climbing only.')).toBeVisible()
  },
}

/** Typed in the bar and asked from the keyboard. */
export const AskFromTheBar: Story = {
  render: () => <StoryApp path="/try-it" />,
  play: async () => {
    const chips = await screen.findByRole('combobox', { name: 'What it is about' })
    for (const [words, name] of [
      ['Average order', 'Average order value'],
      ['United Kingdom', 'United Kingdom'],
    ] as const) {
      await userEvent.type(chips, words)
      await screen.findByRole('option', { name: new RegExp(`^${name}`) })
      await userEvent.keyboard('{Enter}')
    }
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await expect(await facts()).toBeVisible()
  },
}

/** No fact applies: Start a draft, with the scope and the first day. */
export const NoMatch: Story = {
  render: () => <StoryApp path={`/try-it?${unitedKingdom}&from=1999-01-01&to=1999-01-31`} />,
  play: async () => {
    await expect(await screen.findByText('Nothing is written down for this')).toBeVisible()
    await expect(screen.getByRole('link', { name: 'Start a draft' })).toBeVisible()
  },
}

/** No fact applies: Report a gap opens the dialog with the scope in words. */
export const ReportAGap: Story = {
  render: () => <StoryApp path={`/try-it?${unitedKingdom}&from=1999-01-01&to=1999-01-31`} />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Report a gap' }))
    const dialog = await screen.findByRole('dialog', { name: 'Report a gap' })
    await expect(within(dialog).getByText(/Average order value, United Kingdom/)).toBeVisible()
    await expect(within(dialog).getByRole('combobox', { name: "What's wrong" })).toHaveTextContent(
      'Missing',
    )
  },
}

/** What's wrong, in a contributor's words: three plain questions, each with its precise types. */
export const ReportAGapTypes: Story = {
  render: () => <StoryApp path={`/try-it?${unitedKingdom}&from=1999-01-01&to=1999-01-31`} />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Report a gap' }))
    const dialog = await screen.findByRole('dialog', { name: 'Report a gap' })
    await userEvent.click(within(dialog).getByRole('combobox', { name: "What's wrong" }))
    await expect(await screen.findByText('Something is wrong or out of date')).toBeVisible()
    await expect(screen.getByText('The wrong thing came back')).toBeVisible()
  },
}

/** Reported: the dialog closes and a toast says the owners see it, never who. */
export const ReportAGapSent: Story = {
  render: () => <StoryApp path={`/try-it?${unitedKingdom}&from=1999-01-01&to=1999-01-31`} />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Report a gap' }))
    const dialog = await screen.findByRole('dialog', { name: 'Report a gap' })
    await userEvent.type(within(dialog).getByRole('textbox'), 'No facts for January 1999.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Report gap' }))
    await expect(await screen.findByText('Gap reported')).toBeVisible()
  },
}

/** A note with personal data is refused, and the note says why. */
export const ReportAGapRefusedNote: Story = {
  render: () => <StoryApp path={`/try-it?${unitedKingdom}&from=1999-01-01&to=1999-01-31`} />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Report a gap' }))
    const dialog = await screen.findByRole('dialog', { name: 'Report a gap' })
    await userEvent.type(within(dialog).getByRole('textbox'), 'Ask me at someone@example.test')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Report gap' }))
    await expect(await within(dialog).findByText(/an email address/)).toBeVisible()
  },
}

/** The dialog on its own, with a long scope that wraps. */
export const ReportGapLongScope: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <QueryClientProvider client={createQueryClient()}>
      <ReportGapDialog
        open
        onOpenChange={() => {}}
        scope={{ metrics: ['metric:orders'], window: { from: '2026-09-01', to: '2026-09-30' } }}
        about="Orders, Gross sales, Average order value, Active customers, Norway, Spain, United Kingdom, Poland, Clothing, Footwear, 1 September 2026 to 30 September 2026"
        defaultType="outdated"
      />
    </QueryClientProvider>
  ),
}

/** No dates: what applies today, and a note that the agent is told it assumed today. */
export const NoDates: Story = {
  render: () => <StoryApp path={`/try-it?${unitedKingdom}`} />,
  play: async () => {
    await expect(
      await screen.findByText(/^You didn.t choose dates, so this is what applies today/),
    ).toBeVisible()
  },
}

export const Loading: Story = {
  render: () => <StoryApp path={delivered} scenario="slow" />,
  play: async () => {
    await expect(await screen.findByText('Asking as an agent would.')).toBeInTheDocument()
  },
}

export const Failed: Story = {
  render: () => <StoryApp path={delivered} scenario="error" />,
  play: async () => {
    await expect(
      await screen.findByText("We couldn't get what agents get", {}, { timeout: 5000 }),
    ).toBeVisible()
  },
}

/** The phone: the dates stack, nothing scrolls sideways. */
export const PhoneDelivered: Story = {
  render: () => <StoryApp path={delivered} />,
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: async () => {
    await expect(await facts()).toBeVisible()
  },
}

/** The panel from the launcher, on Home. */
export const InThePanel: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Assistant' }))
    const panel = await screen.findByRole('region', { name: 'Assistant' })
    await userEvent.click(within(panel).getByRole('tab', { name: 'Try a question' }))
    await expect(await within(panel).findByText('See what an agent gets')).toBeVisible()
  },
}

const fact = (
  id: string,
  title: string,
  extra: Partial<NonNullable<TryIt['result']['items']>[number]> = {},
) => ({
  id,
  version: 2,
  edition: '2026-10-07.2',
  kind: 'event' as const,
  title,
  summary: `${title}. Treat any comparison across this date with care.`,
  validity: { start: '2026-06-12', end: null },
  claim_level: 'fact_only' as const,
  risk: 'normal' as const,
  freshness: 'verified' as const,
  evidence: [],
  owner: { team: null, role: 'Jon Abara' },
  links: [],
  match: 'exact' as const,
  ...extra,
})

/** An invented reply with every note: a conflict, an unverified fact, held back and cut. */
const everyNote: TryIt = {
  bytes: 61_420,
  limit: 100_000,
  result: {
    say: "2 facts apply to Average order value in the United Kingdom in June 2026. Only that was checked. 1 of them applies to only part of that question. 1 of them may be out of date. Some of them disagree. 1 more fact applies but didn't fit in this reply. 1 more fact matches but isn't shared with agents: it's for another group.",
    next: 'applies_note says which part each partial fact covers. Give both sides of conflicts_with and say they disagree. cut_ids lists the facts left out: call again with response_format concise or a higher max_bytes to get them.',
    status: 'conflict',
    edition: '2026-10-07.2',
    tool_schema_digest: '9f2c4e1a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60',
    items: [
      fact('itm_wsd3duw0', 'Payment provider switched in the United Kingdom on 12 June 2026', {
        conflicts_with: ['itm_kwiriumn'],
        not_to_conclude:
          'Lower orders in the United Kingdom after 12 June do not mean that customers ordered less.',
      }),
      fact('itm_kwiriumn', 'United Kingdom launch campaign started on 21 February 2025', {
        match: 'partial',
        applies_note: 'Applies to dim:product: val:product/climbing only.',
        validity: { start: '2025-02-21', end: '2025-04-01' },
        freshness: 'unverified',
        unverified_reason: 'past_review_date',
        conflicts_with: ['itm_wsd3duw0'],
      }),
    ],
    options: [],
    check_report: {
      status: 'conflict',
      matched: 4,
      withheld: 1,
      links_withheld: 0,
      cut: true,
      cut_ids: ['itm_69p3ldsd'],
      checked: [],
      statements: ['No match does not prove that no caveat exists.'],
    },
    instructions:
      'State the documented fact with its source and dates. Say "might be related" only for an event whose dates overlap and whose metric is in scope, and state that the context does not prove a cause.',
  },
}
const tried: TryItScope = {
  scope: {
    metrics: ['metric:average_order_value'],
    dimensions: [],
    dimensionValues: [{ dimension: 'dim:market', value: 'val:market/united_kingdom' }],
  },
  from: '2026-06-01',
  to: '2026-06-30',
}

/** The reply on its own, with every note it can carry. */
export const ReplyWithEveryNote: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <QueryFrame>
      <RouterFrame>
        <div className="max-w-prose">
          <TryItReply
            reply={readTryIt(everyNote, (key) =>
              key === 'dim:product'
                ? 'Product'
                : key === 'val:product/climbing'
                  ? 'Climbing'
                  : undefined,
            )}
            tried={tried}
            about="Average order value, United Kingdom, 1 June 2026 to 30 June 2026"
            today="2026-10-07"
            domainOf={() => ({ name: 'Sales', label: 'teal' })}
          />
        </div>
      </RouterFrame>
    </QueryFrame>
  ),
  play: async () => {
    await expect(await screen.findByText(/says something different from #2/)).toBeVisible()
    // What the agent may tell the person, and the next step it is told (FR-344).
    await expect(
      screen.getByText(/^2 facts apply to Average order value in the United Kingdom/),
    ).toBeVisible()
    await expect(screen.getByText(/cut_ids lists the facts left out/)).toBeVisible()
    await expect(screen.getByText(/The agent is told this is not verified/)).toBeVisible()
    await expect(screen.getByText('2 delivered, 1 held back, 1 cut to fit.')).toBeVisible()
  },
}

/** Text to copy, short and long. */
export const CopyBlocks: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div className="flex max-w-prose flex-col gap-4">
      <CopyBlock text="http://localhost:3000/mcp" label="the address" />
      <CopyBlock
        text={
          'claude mcp add --transport http heed http://localhost:3000/mcp \\\n  --header "Authorization: Bearer <your token>"'
        }
        label="the setup for Claude Code"
      />
    </div>
  ),
}
