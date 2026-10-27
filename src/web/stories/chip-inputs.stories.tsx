import { useState, type ReactNode } from 'react'
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { QueryClientProvider } from '@tanstack/react-query'
import { userEvent, within } from 'storybook/test'
import type { Scope } from '@domain/item'
import { createQueryClient } from '@/api/query-client'
import { MentionText } from '@/components/mentions/mention-text'
import { MentionTextarea } from '@/components/mentions/mention-textarea'
import { ScopeInput } from '@/components/mentions/scope-input'
import { SummaryInput } from '@/components/mentions/summary-input'
import type { MentionStatus } from '@/lib/mention-names'
import { buildMentionTargets, targetsByKey, type MentionOption } from '@/lib/mention-targets'
import { areas, vocabulary } from '@/mocks/reference-data'

/**
 * The chip-aware inputs of contract 9.6, on the fixture vocabulary: "Where it applies" (chips
 * from the vocabulary), "What happened" (one block with @ mentions, # for values) and the Markdown
 * body with mention tokens. Stories that need a key press open themselves with a play function.
 * The same inputs, by keyboard and with axe, are in tests/e2e/mentions.spec.ts.
 */

const library = {
  loadedAt: '2026-10-07T00:00:00Z',
  today: '2026-10-07',
  items: [
    {
      id: 'itm_story001',
      kind: 'event' as const,
      areaId: 'area_sales',
      status: 'accepted' as const,
      version: 1,
      title: 'Norway launch campaign started on 21 September 2025',
      summary: '',
      scope: { metrics: [], dimensions: [], dimensionValues: [] },
      validity: { start: '2025-09-21', end: null },
      reviewDate: null,
      reviewQuestion: 'still_correct' as const,
      checkFlag: null,
      ownerId: 'per_jon',
      proposerId: 'per_maria',
      updatedAt: '2026-10-01T00:00:00Z',
      lastChecked: null,
      trust: 'current' as const,
      chips: [],
      owners: [],
      opened: false,
    },
  ],
}
const longName = `Net revenue after discounts, taxes and the payment provider fees that apply in every market where the product is offered to customers who signed up through a marketplace partner in 2026`
const targets: MentionOption[] = [
  ...buildMentionTargets({ vocabulary, library, areas }),
  {
    key: 'metric:net_revenue_after_fees',
    type: 'metric',
    name: longName,
    aliases: [],
    detail: 'Metric · Revenue',
    status: 'current',
  },
]

const withQueries: Decorator = (Story) => (
  <QueryClientProvider client={createQueryClient()}>
    <div className="flex w-full max-w-reading flex-col gap-2 p-6">
      <Story />
    </div>
  </QueryClientProvider>
)

const meta = {
  title: 'Parts/Chip inputs',
  parameters: { layout: 'fullscreen' },
  decorators: [withQueries],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function Label({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span id={id} className="text-body font-bold">
      {children}
    </span>
  )
}

function Summary({
  initial = '',
  statuses,
  disabled,
  label = 'What happened',
}: {
  initial?: string
  statuses?: Record<string, MentionStatus>
  disabled?: boolean
  label?: string
}) {
  const [markup, setMarkup] = useState(initial)
  return (
    <>
      <Label id="summary-label">{label}</Label>
      <SummaryInput
        value={markup}
        onChange={setMarkup}
        targets={targets}
        statuses={statuses}
        disabled={disabled}
        onRequestTerm={() => undefined}
        labelledBy="summary-label"
        placeholder="What happened? Type @ to mention a metric, a market, another item or a domain."
      />
    </>
  )
}

function ScopeField({
  initial = { metrics: [], dimensions: [], dimensionValues: [] },
  disabled,
}: {
  initial?: Scope
  disabled?: boolean
}) {
  const [scope, setScope] = useState(initial)
  return (
    <>
      <Label id="scope-label">Where it applies</Label>
      <ScopeInput
        value={scope}
        onChange={setScope}
        disabled={disabled}
        onRequestTerm={() => undefined}
        aria-labelledby="scope-label"
      />
    </>
  )
}

/**
 * Types into the first text field of the story, the way a person does. `atEnd` puts the caret at
 * the end of the text first (the keyboard library cannot press End in an editable element).
 */
const typeInto =
  (text: string, role: 'textbox' | 'combobox' = 'textbox', atEnd = false) =>
  async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const field = await within(canvasElement).findByRole(role)
    await userEvent.click(field)
    if (atEnd) {
      const selection = field.ownerDocument.getSelection()
      selection?.selectAllChildren(field)
      selection?.collapseToEnd()
    }
    await userEvent.keyboard(text)
  }

export const SummaryEmpty: Story = { render: () => <Summary /> }

export const SummaryWithMentions: Story = {
  render: () => (
    <Summary initial="Online sales to @[Norway](val:market/norway) stopped on 4 August 2026 after a new customs rule. Filed under @[Sales](area:area_sales). Compare @[Orders](metric:orders) and @[Norway launch campaign started on 21 September 2025](item:itm_story001)." />
  ),
}

export const SummaryMentionStates: Story = {
  render: () => (
    <Summary
      initial="Current @[Orders](metric:orders), retired @[Old payments note](item:itm_gone0001), changed @[Units sold](metric:units_sold), missing @[Net revenue](metric:net_revenue) and unknown @[Discount code](metric:discount_code)."
      statuses={{
        'item:itm_gone0001': 'retired',
        'metric:units_sold': 'source_changed',
        'metric:net_revenue': 'source_missing',
      }}
    />
  ),
}

export const SummaryListOpen: Story = {
  render: () => <Summary />,
  play: typeInto('Compare @ord'),
}

export const SummaryValuesOnly: Story = {
  render: () => <Summary />,
  play: typeInto('Also in #so'),
}

export const SummaryOtherName: Story = {
  render: () => <Summary />,
  play: typeInto('Paused in @Norge'),
}

export const SummaryNoMatch: Story = {
  render: () => <Summary />,
  play: typeInto('Watch @Narnia'),
}

export const SummaryChipFocus: Story = {
  render: () => <Summary initial="Online sales to @[Norway](val:market/norway)" />,
  // The arrow that reaches a chip selects it. The keyboard library sends no key code, which the
  // editor reads for arrows, so this story sends the key itself.
  play: async ({ canvasElement }) => {
    const field = await within(canvasElement).findByRole('textbox')
    await userEvent.click(field)
    const selection = field.ownerDocument.getSelection()
    selection?.selectAllChildren(field)
    selection?.collapseToEnd()
    field.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        keyCode: 37,
        bubbles: true,
        cancelable: true,
      }),
    )
  },
}

export const SummarySuggestion: Story = {
  render: () => <Summary initial="Compare Orders before and after." />,
}

export const SummaryOverLimit: Story = {
  render: () => (
    <Summary
      initial={`${'The text keeps going and a mention counts as its words only. '.repeat(4)}It is too long now: @[Net revenue](metric:net_revenue) ends it.`}
    />
  ),
}

export const SummaryMaxReached: Story = {
  render: () => <Summary initial={'@[Web](val:platform/web) '.repeat(50)} />,
  play: typeInto(' @', 'textbox', true),
}

export const SummaryLongLabel: Story = {
  render: () => (
    <Summary
      label={`What happened, in one or two sentences that a reader who knows nothing about it can follow, with the metric, the market and the date it started, and nothing that is a guess or a cause`}
      initial={`Compare @[${longName.slice(0, 118)}](metric:net_revenue_after_fees) before and after.`}
    />
  ),
}

export const SummaryDisabled: Story = {
  render: () => (
    <Summary disabled initial="Online sales to @[Norway](val:market/norway) stopped." />
  ),
}

export const ScopeEmpty: Story = { render: () => <ScopeField /> }

export const ScopeFilled: Story = {
  render: () => (
    <ScopeField
      initial={{
        metrics: ['metric:units_sold'],
        dimensions: [],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
      }}
    />
  ),
}

/** A dimension on its own, any of its values (FR-126): the chip reads "Market any value". */
export const ScopeAnyValue: Story = {
  render: () => (
    <ScopeField
      initial={{ metrics: ['metric:orders'], dimensions: ['dim:market'], dimensionValues: [] }}
    />
  ),
}

/** Typing a dimension's name offers "Any value", its first values and a search of all of them. */
export const ScopeDimensionRow: Story = {
  render: () => <ScopeField />,
  play: typeInto('market', 'combobox'),
}

/** 2,400 campaigns: a few per dimension with a count, never the whole list. */
export const ScopeManyValues: Story = {
  render: () => <ScopeField />,
  play: typeInto('spring', 'combobox'),
}

/** Inside one dimension the list pages through its values. */
export const ScopeInsideDimension: Story = {
  render: () => <ScopeField />,
  play: async (context) => {
    await typeInto('campaign', 'combobox')(context)
    const field = await within(context.canvasElement).findByRole('combobox')
    await within(context.canvasElement).findByRole('option', { name: /Any value/ })
    await userEvent.type(field, '{ArrowRight}')
  },
}

/** More than eight chips fold into "+N more". */
export const ScopeManyChips: Story = {
  render: () => (
    <ScopeField
      initial={{
        metrics: ['metric:orders', 'metric:units_sold'],
        dimensions: ['dim:product'],
        dimensionValues: vocabulary.dimensions[0]!.values.slice(0, 9).map((value) => ({
          dimension: 'dim:market',
          value: `val:market/${value.id}`,
        })),
      }}
    />
  ),
}

export const ScopeOtherName: Story = {
  render: () => <ScopeField />,
  play: typeInto('Norge', 'combobox'),
}

export const ScopeNoMatch: Story = {
  render: () => <ScopeField />,
  play: typeInto('Narnia', 'combobox'),
}

export const ScopeChipSelected: Story = {
  render: () => (
    <ScopeField initial={{ metrics: ['metric:units_sold'], dimensions: [], dimensionValues: [] }} />
  ),
  play: typeInto('{Backspace}', 'combobox'),
}

/** A chosen term the vocabulary no longer holds keeps its chip, dashed, with a warning. */
export const ScopeSourceMissing: Story = {
  render: () => (
    <ScopeField
      initial={{ metrics: ['metric:net_revenue_old'], dimensions: [], dimensionValues: [] }}
    />
  ),
}

export const ScopeLongName: Story = {
  render: () => (
    <ScopeField
      initial={{
        metrics: ['metric:orders'],
        dimensions: [],
        dimensionValues: [
          {
            dimension: 'dim:campaign',
            value: 'val:campaign/united_states_late_night_sale_2026_display',
          },
          { dimension: 'dim:market', value: 'val:market/norway' },
        ],
      }}
    />
  ),
}

export const ScopeDisabled: Story = {
  render: () => (
    <ScopeField
      disabled
      initial={{ metrics: ['metric:units_sold'], dimensions: [], dimensionValues: [] }}
    />
  ),
}

function Body() {
  const [text, setText] = useState(
    '## How to check\n\n1. Compare @[Norway](val:market/norway) with @[Spain](val:market/spain).\n2. Use @[Orders](metric:orders), not the old tool.',
  )
  return (
    <>
      <Label id="body-label">A longer explanation</Label>
      <MentionTextarea
        value={text}
        onChange={setText}
        targets={targets}
        aria-labelledby="body-label"
        className="font-mono text-body"
      />
      <p className="text-body whitespace-pre-wrap">
        <MentionText markup={text} lookup={targetsByKey(targets)} />
      </p>
    </>
  )
}

export const BodyTokens: Story = { render: () => <Body /> }
