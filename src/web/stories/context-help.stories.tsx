import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, within } from 'storybook/test'
import type { ClaimLevel, ItemKind } from '@domain/item'
import { CaveatField } from '@/components/context/caveat-field'
import { EvidenceFields, NeededBadge, WhyWeAsk } from '@/components/context/context-fields'
import { RailSection } from '@/components/page/page-rail'
import { CircleSlashIcon, LinkIcon } from '@/components/icons'
import {
  caveatStarters,
  caveatWords,
  examplesPlaceholder,
  kindHelp,
  sourceWords,
} from '@/lib/context-help'
import type { ContextFormValues } from '@/lib/context-form'
import { StoryPaper } from './form-story-parts'

/*
  The two Details sections of Add a fact that explain themselves (slice heed-ui-wording-icons):
  "Where this comes from" (the stored evidence) and "What not to conclude" (the stored
  notToConclude): the help, the kind's examples, the Needed and Optional states and "Why we ask";
  for what not to conclude, the starters, "Use this" and the live "What agents get" card.
*/

const meta = {
  title: 'Forms/Where this comes from',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function Sections({
  kind,
  evidence: initialEvidence = [{ url: '', quote: '', date: '' }],
  caveat: initialCaveat = '',
  claimLevel = 'fact_only',
  title = 'Payment provider delays order data in Poland',
}: {
  kind: ItemKind
  evidence?: ContextFormValues['evidence']
  caveat?: string
  claimLevel?: ClaimLevel
  title?: string
}) {
  const [evidence, setEvidence] = useState(initialEvidence)
  const [caveat, setCaveat] = useState(initialCaveat)
  const missing = evidence.some((entry) => !entry.url.trim() || !entry.quote.trim() || !entry.date)
  return (
    <StoryPaper>
      <div className="flex w-companion max-w-full flex-col gap-6">
        <RailSection
          icon={LinkIcon}
          title={sourceWords.title}
          aside={<NeededBadge needed={missing} />}
        >
          <p className="text-caption text-muted-foreground">
            {sourceWords.help} <WhyWeAsk topic="source" section={sourceWords.title} />
          </p>
          <EvidenceFields
            kind={kind}
            value={evidence}
            onChange={setEvidence}
            error={() => undefined}
            disabled={false}
            onBlur={() => {}}
          />
        </RailSection>
        <RailSection
          icon={CircleSlashIcon}
          title={caveatWords.title}
          titleId="story-caveat-title"
          aside={<span className="text-caption text-muted-foreground">{caveatWords.optional}</span>}
        >
          <CaveatField
            id="story-caveat"
            labelledBy="story-caveat-title"
            value={caveat}
            onChange={setCaveat}
            onBlur={() => {}}
            kind={kind}
            itemTitle={title}
            claimLevel={claimLevel}
            disabled={false}
          />
        </RailSection>
      </div>
    </StoryPaper>
  )
}

/** A new event: the source needed, what not to conclude optional and empty. */
export const Event: Story = {
  render: () => <Sections kind="event" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('textbox', { name: 'A sentence copied from the source' }),
    ).toHaveAttribute('placeholder', examplesPlaceholder(kindHelp.event.quotes))
    await expect(canvas.getAllByText('Needed')).toHaveLength(1)
    await expect(canvas.getByText(caveatWords.optional)).toBeVisible()
    await expect(canvas.getByText(caveatWords.how)).toBeVisible()
    await expect(canvas.getByText(caveatWords.empty)).toBeVisible()
  },
}

/** A starter and the example put words in the box, and the card follows as it changes. */
export const IssueStarters: Story = {
  render: () => <Sections kind="issue" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = canvas.getByRole('textbox', { name: caveatWords.title })
    await userEvent.click(canvas.getByRole('button', { name: caveatStarters[1].label }))
    await expect(box).toHaveValue(caveatStarters[1].text)
    await expect(box).toHaveFocus()
    await userEvent.keyboard('comparing markets.')
    await expect(canvas.getByText(/Don't use this for comparing markets\./)).toBeVisible()
    await userEvent.clear(box)
    await userEvent.click(canvas.getByRole('button', { name: 'Use this example' }))
    await expect(box).toHaveValue(kindHelp.issue.caveat)
  },
}

/** A line written: the card shows it, and the app's field on request. */
export const Answered: Story = {
  render: () => (
    <Sections
      kind="note"
      evidence={[
        {
          url: 'https://wiki.example/data/retention',
          quote: kindHelp.note.quotes[0],
          date: '2026-08-04',
        },
      ]}
      caveat={kindHelp.note.caveat}
      title="First-time buyers excludes test accounts"
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText('Needed')).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: caveatWords.showRaw }))
    await expect(canvas.getByText(/"not_to_conclude":/)).toBeVisible()
  },
}

/** A long line wraps in the box and in the card, and the counter shows near the limit. */
export const LongLine: Story = {
  render: () => (
    <Sections kind="event" caveat={`${'Lower orders do not mean fewer customers. '.repeat(44)}`} />
  ),
}

/** An item whose source states the effect: the empty card says so without the cause sentence. */
export const CauseStated: Story = {
  render: () => <Sections kind="event" claimLevel="effect_stated" />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(caveatWords.emptyStated)).toBeVisible()
  },
}

/** "Why we ask" opens two sentences on what the answer is for. */
export const WhyWeAskOpen: Story = {
  render: () => <Sections kind="event" />,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: `Why we ask: ${sourceWords.title}` }),
    )
    await expect(await screen.findByText(/The owner opens the link/)).toBeVisible()
  },
}
