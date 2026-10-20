import { useRef, useState } from 'react'
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { QueryClientProvider } from '@tanstack/react-query'
import { expect, userEvent, within } from 'storybook/test'
import type { ItemKind } from '@domain/item'
import { createQueryClient } from '@/api/query-client'
import { BodyInput } from '@/components/editor/body-input'
import { slashItems } from '@/components/editor/body-commands'
import { FormatToolbar } from '@/components/editor/format-toolbar'
import { SlashMenu } from '@/components/editor/slash-menu'
import { TextCheckNote } from '@/components/editor/text-check-note'
import { SummaryInput } from '@/components/mentions/summary-input'
import { buildMentionTargets } from '@/lib/mention-targets'
import { areas, vocabulary } from '@/mocks/reference-data'

/**
 * The page editor of Add a fact and Suggest a change (contract 9.6): the summary zone, the body
 * with the Markdown subset rendering as it is typed, the / menu, the selection toolbar and the
 * text check's sentence. The whole page is in Pages/Add a fact; the keyboard paths, with axe,
 * are in tests/e2e/context.spec.ts.
 */

const targets = buildMentionTargets({ vocabulary, areas })

const withQueries: Decorator = (Story) => (
  <QueryClientProvider client={createQueryClient()}>
    <div className="flex w-full max-w-reading flex-col gap-6 p-6">
      <Story />
    </div>
  </QueryClientProvider>
)

const meta = {
  title: 'Parts/Page editor',
  parameters: { layout: 'fullscreen' },
  decorators: [withQueries],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const instruction = `## Before you start

- Confirm the **period** and the @[Norway](val:market/norway) market you were asked about.
- Check that the @[Orders](metric:orders) number comes from the source tool.

## Steps

1. Compare the affected market with one that was not affected, before and after the date.
2. If the dates overlap, say the item *might be related*. Never write "caused by".

> A closure and a drop in the same week is not proof of a cause.

Run \`select count(*)\` only through the source tool, and read [the notice](https://regulator.example/notice).`

function Body({
  initial = '',
  kind = 'guide',
  disabled,
}: {
  initial?: string
  kind?: ItemKind
  disabled?: boolean
}) {
  const [markdown, setMarkdown] = useState(initial)
  return (
    <>
      <BodyInput
        label="Body"
        kind={kind}
        value={markdown}
        onChange={setMarkdown}
        targets={targets}
        placeholder="Add detail, steps or examples. Type / for blocks, @ to mention."
        disabled={disabled}
        checkText
      />
      <pre data-slot="stored" className="text-caption whitespace-pre-wrap text-muted-foreground">
        {markdown}
      </pre>
    </>
  )
}

function Summary({ initial = '' }: { initial?: string }) {
  const [markup, setMarkup] = useState(initial)
  return (
    <SummaryInput
      appearance="zone"
      label="Summary"
      value={markup}
      onChange={setMarkup}
      targets={targets}
      checkText
      placeholder="When should an agent use this guide? One or two sentences."
    />
  )
}

export const EmptyBody: Story = { render: () => <Body /> }
export const Instruction: Story = { render: () => <Body initial={instruction} /> }
export const LongBody: Story = {
  render: () => <Body initial={`${instruction}\n\n`.repeat(6)} />,
}
export const DisabledBody: Story = { render: () => <Body initial={instruction} disabled /> }
export const TextCheck: Story = {
  render: () => <Body initial="If the owner asks, send the detail to anna.berg@example.com." />,
}

export const SlashMenuOpen: Story = {
  render: () => <Body />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('textbox', { name: 'Body' }))
    await userEvent.keyboard('/')
    await expect(await canvas.findByRole('listbox', { name: 'Add a block' })).toBeVisible()
  },
}

/**
 * The same editor as a bordered field for other Markdown text (what a domain is, About our
 * business): mentions off, so `@` is a plain character and neither the / menu nor the keys offer
 * a mention; the text at the size a record reads it.
 */
function About({ initial = '', max = 1500 }: { initial?: string; max?: number }) {
  const [markdown, setMarkdown] = useState(initial)
  return (
    <>
      <BodyInput
        label="Description"
        appearance="field"
        size="reading"
        mentions={false}
        value={markdown}
        onChange={setMarkdown}
        max={max}
        count={(text) => [...text].length}
        placeholder="For example: Payments covers orders and returns, by market and payment provider."
      />
      <pre data-slot="stored" className="text-caption whitespace-pre-wrap text-muted-foreground">
        {markdown}
      </pre>
    </>
  )
}

const domainDescription = areas.find((area) => area.id === 'area_sales')?.description ?? ''

export const AboutField: Story = { render: () => <About initial={domainDescription} /> }
export const AboutFieldEmpty: Story = { render: () => <About /> }
export const AboutFieldTooLong: Story = {
  render: () => <About initial={domainDescription} max={200} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText(/of 200 characters, \d+ too many/)).toBeVisible()
    await expect(await canvas.findByRole('textbox', { name: 'Description' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  },
}
export const AboutFieldNoMentions: Story = {
  render: () => <About />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('textbox', { name: 'Description' }))
    await userEvent.keyboard('Ask @')
    await expect(canvas.queryByRole('listbox')).toBeNull()
    await userEvent.keyboard('{Enter}/')
    const menu = await canvas.findByRole('listbox', { name: 'Add a block' })
    await expect(within(menu).queryByRole('option', { name: /Mention/ })).toBeNull()
    // The keys under the field leave out @.
    await expect(canvasElement.textContent).not.toContain('@mention')
  },
}

export const SummaryZone: Story = {
  render: () => (
    <Summary initial="Use this when a metric moves in a market and nobody has said why." />
  ),
}
export const SummaryEmpty: Story = { render: () => <Summary /> }
export const SummaryTooLong: Story = {
  render: () => <Summary initial={'A long observation without an end. '.repeat(9)} />,
}

export const SlashMenuParts: Story = {
  render: () => (
    <SlashMenu
      id="story-slash"
      items={slashItems('guide')}
      activeId="steps"
      onPick={() => undefined}
      onActivate={() => undefined}
    />
  ),
}

function Toolbar({ link }: { link: string | null }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <FormatToolbar
      toolbarRef={ref}
      pressed={{ bold: true, h2: false }}
      available={{ h2: true, h3: true, mention: true }}
      link={link}
      onAction={() => undefined}
      onLink={() => undefined}
      onReturn={() => undefined}
    />
  )
}
export const ToolbarParts: Story = { render: () => <Toolbar link={null} /> }
export const ToolbarOnALink: Story = {
  render: () => <Toolbar link="https://regulator.example/notice" />,
}

export const TextCheckSentence: Story = {
  render: () => (
    <TextCheckNote id="story-check" code="email_address" more={1} onRemove={() => undefined} />
  ),
}
