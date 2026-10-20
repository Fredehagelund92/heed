import { useState, type ReactNode } from 'react'
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { QueryClientProvider } from '@tanstack/react-query'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { createQueryClient } from '@/api/query-client'
import { MentionList } from '@/components/mentions/mention-list'
import { PreviewBody, type PreviewVariant } from '@/components/preview/preview-card'
import { buildMentionTargets, searchMentionTargets } from '@/lib/mention-targets'
import type { PreviewTarget } from '@/lib/preview'
import { areas, vocabulary } from '@/mocks/reference-data'
import { RouterFrame } from './router-frame'
import { StoryApp } from './story-app'

/**
 * The chip previews (the editor design, section 6): one hover card on pointer and focus, one
 * bottom sheet on touch, and the peek beside the @ list. Each card says what its chip points at
 * from reads the app already caches: a metric or a dimension from the catalogue, a value from its
 * dimension, an item from the library index, a person from the domains they look after. Use the
 * viewport menu for 1440, 1024 and 390 and the theme menu for dark. The same cards, by mouse,
 * keyboard and touch and with axe, are in tests/e2e/previews.spec.ts.
 */

function DataFrame({ children }: { children: ReactNode }) {
  const [client] = useState(() => createQueryClient())
  return (
    <QueryClientProvider client={client}>
      <RouterFrame>{children}</RouterFrame>
    </QueryClientProvider>
  )
}

const withData: Decorator = (Story) => (
  <DataFrame>
    <Story />
  </DataFrame>
)

const meta = {
  title: 'Parts/Chip previews',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** The card's frame, as the hover card draws it (ui/hover-card.tsx). */
function CardFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-caption text-muted-foreground">{title}</figcaption>
      <div className="flex w-popover max-w-full flex-col gap-3 rounded-lg bg-popover p-3 text-dense text-popover-foreground shadow-raised ring-1 ring-foreground/10">
        {children}
      </div>
    </figure>
  )
}

function Gallery({
  cards,
  variant = 'card',
}: {
  cards: { title: string; target: PreviewTarget }[]
  variant?: PreviewVariant
}) {
  return (
    <div className="flex flex-wrap items-start gap-6 bg-background p-6">
      {cards.map((card) => (
        <CardFrame key={card.title} title={card.title}>
          <PreviewBody target={card.target} variant={variant} />
        </CardFrame>
      ))}
    </div>
  )
}

/** Every kind of chip, as its hover card: the term's status, domain, definition and counts. */
export const Cards: Story = {
  decorators: [withData],
  render: () => (
    <Gallery
      cards={[
        {
          title: 'Metric with an issue still going on',
          target: { type: 'metric', id: 'orders' },
        },
        {
          title: 'Metric whose definition changed in Cube',
          target: { type: 'metric', id: 'retention_rate' },
        },
        {
          title: 'Metric with no description in Cube',
          target: { type: 'metric', id: 'verification_pass_rate' },
        },
        { title: 'Dimension', target: { type: 'dim', id: 'market' } },
        {
          title: 'Dimension value with another name',
          target: { type: 'val', dimension: 'market', value: 'norway' },
        },
        { title: 'Context item', target: { type: 'item', id: 'itm_jyfuvl07' } },
        { title: 'Retired item', target: { type: 'item', id: 'itm_22ooyz66' } },
        { title: 'Person', target: { type: 'person', id: 'per_jon' } },
      ]}
    />
  ),
}

/** What a card says when its target has gone, before the reads answer, and for nobody known. */
export const MissingTargets: Story = {
  decorators: [withData],
  render: () => (
    <Gallery
      cards={[
        { title: 'Item no longer in the library', target: { type: 'item', id: 'itm_gone' } },
        { title: 'Metric no longer in the catalogue', target: { type: 'metric', id: 'gone' } },
        {
          title: 'Value no longer in the vocabulary',
          target: { type: 'val', dimension: 'market', value: 'atlantis' },
        },
        { title: 'Unknown person', target: { type: 'person', id: 'per_nobody' } },
      ]}
    />
  ),
}

/** The bottom sheet's body on a phone: the actions are full width at touch height. */
export const PhoneSheet: Story = {
  decorators: [withData],
  globals: { viewport: { value: 'phone', isRotated: false } },
  render: () => (
    <div className="flex flex-col bg-popover pt-4">
      <PreviewBody target={{ type: 'metric', id: 'orders' }} variant="sheet" />
    </div>
  ),
}

const targets = buildMentionTargets({ vocabulary, areas })

/** The @ list with the peek of its highlighted row beside it (beside it from 768 wide). */
export const ListPeek: Story = {
  decorators: [withData],
  render: () => {
    const matches = searchMentionTargets(targets, 'dep', { limit: 8 })
    return (
      <div className="relative h-screen bg-background p-6">
        <MentionList
          id="peek-story"
          label="Mention a metric, value, fact or domain"
          matches={matches}
          query="dep"
          activeKey={matches[0]?.option.key ?? null}
          onPick={() => undefined}
          onActivate={() => undefined}
          request={null}
        />
      </div>
    )
  },
}

/** The item page in the real shell: hover a chip in Where it applies and its card opens. */
export const OnTheItemPage: Story = {
  render: () => <StoryApp path="/library/itm_jyfuvl07" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = await canvas.findByRole(
      'list',
      { name: 'Metrics, dimensions and values' },
      { timeout: 10_000 },
    )
    await userEvent.hover(within(list).getByRole('link', { name: 'Units per order' }))
    const body = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(body.getByText('Metric · group Basket')).toBeVisible(), {
      timeout: 5_000,
    })
  },
}

/** A value's chip opens its dimension's page with the value picked out. */
export const ValuePickedOut: Story = {
  render: () => <StoryApp path="/catalogue/dimension/market?value=netherlands" />,
}
